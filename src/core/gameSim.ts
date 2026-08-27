import type { AtBatOutcome, BattedBall, BattingStats, ContactQuality, PlayerProfile } from './types';
import type { LeagueLevel, RosterPlayer, Team } from './league';
import { randomName, teamBatters, teamPitchers } from './league';
import type { PitcherAI } from './pitching';
import { Rng, clamp } from './rng';
import { emptyBattingStats } from './player';
import { launchBall, predictLanding } from './ballFlight';
import type { PositionId } from './fieldGeometry';
import { ALL_POSITIONS, FIELDER_HOME, distance, isFair, toPositionId } from './fieldGeometry';
import type { PlayOutcome } from './playSim';
import type { GameFeats } from './achievements';
import { emptyGameFeats } from './achievements';
import { fieldFor, infielderFor } from './outcome';
import type { AirConditions, Weather } from './weather';
import { CALM, airFor } from './weather';

/**
 * Drives a nine-inning game. Everything that doesn't involve the player is
 * simulated instantly; the player's own plate appearances and any ball hit at
 * their position are surfaced as interactive events for the UI to hand off to
 * a minigame.
 */

export type SimEvent =
  | { kind: 'log'; text: string; tone: LogTone; runs?: { count: number; ours: boolean } }
  | { kind: 'inning'; text: string }
  | { kind: 'atBat'; pitcher: PitcherAI; outs: number; bases: boolean[] }
  | { kind: 'fielding'; hitter: string; battedBall: BattedBall }
  | { kind: 'gameOver'; win: boolean; tie: boolean };

/**
 * Feed colour. Colour codes the *event*, not the allegiance: red is reserved
 * for outs and genuine bad news, hits are gold whoever hit them, and routine
 * traffic (a batter stepping in, the opponent working a walk) stays grey.
 * Painting the opponent's whole half red made the log read like a siren.
 */
export type LogTone = 'neutral' | 'good' | 'bad' | 'hit' | 'big';

/** Where the player hits in the order. */
const PLAYER_SLOT = 2;
const LINEUP_SIZE = 9;
const REGULATION_INNINGS = 9;
/**
 * Regular-season games are called after twelve. Postseason games are not:
 * a series game has to have a winner, so it plays on until one side leads at
 * the end of an inning.
 */
const MAX_INNINGS = 12;
/** Where "late in the game" starts, for the sake of a clutch hit. */
const CLUTCH_INNING = 7;

/** The state of a game at the moment before a pitch. See `recordFeats`. */
interface Situation {
  bases: boolean[];
  us: number;
  them: number;
  inning: number;
  half: 'top' | 'bottom';
}


/** Only reachable if a save has a team with no roster at all. */
const FILL_IN: RosterPlayer = { name: 'the utility man', age: 27, rating: 50, role: 'batter' };

function nextBatter(order: RosterPlayer[], index: number): RosterPlayer {
  return order.length > 0 ? order[index % order.length] : FILL_IN;
}

/**
 * Play-by-play for a ball in play that was retired. The trajectory is already
 * known, so the line may as well match it — every out reading "flies out to
 * center" is most of what a spectator sees over nine innings.
 */
function describeOut(bb: BattedBall): string {
  const field = fieldFor(bb.spray, 'R');
  if (bb.launchAngle < 8) return `grounds out to ${infielderFor(bb.spray, 'R')}`;
  if (bb.launchAngle > 48) return `pops out to ${infielderFor(bb.spray, 'R')}`;
  if (bb.launchAngle < 18) return `lines out to ${field}`;
  return `flies out to ${field}`;
}

export interface GameScore {
  us: number;
  them: number;
}

export class GameSim {
  readonly rng: Rng;
  readonly level: LeagueLevel;
  readonly player: PlayerProfile;
  readonly opponentName: string;
  readonly playerIsHome: boolean;
  readonly pitcher: PitcherAI;
  /** True for a game that cannot end in a tie (the postseason). */
  readonly mustDecide: boolean;

  inning = 1;
  half: 'top' | 'bottom' = 'top';
  outs = 0;
  bases: boolean[] = [false, false, false];
  score: GameScore = { us: 0, them: 0 };
  finished = false;

  /** The player's own line for this game. */
  gameStats: BattingStats = emptyBattingStats();
  putouts = 0;
  errors = 0;

  /**
   * The moments a box score can't hold: what was on the bases, and what the
   * scoreboard said, when the player put a ball in play. Read after the game
   * by `core/achievements.ts` — nothing in the sim acts on them.
   */
  readonly feats: GameFeats = emptyGameFeats();

  /** Runs per inning (index 0 = 1st), for the linescore grid. */
  readonly lineScore = { us: [] as number[], them: [] as number[] };
  /** Team hit totals — the H column. */
  readonly teamHits: GameScore = { us: 0, them: 0 };
  /**
   * Team error totals — the E column. Only the errors the sim actually models:
   * the player's own misplays, and misplays that put the player aboard.
   */
  readonly teamErrors: GameScore = { us: 0, them: 0 };

  /** Our starter. Cosmetic — the sim of their half never consults him. */
  readonly ourPitcher: PitcherAI;

  /** The day's air, so "is this ball mine?" is judged on the same flight the field plays. */
  private readonly air: AirConditions;
  private lineupIndex = 0;
  private opponentLineupIndex = 0;
  private pending: SimEvent | null = null;
  private inningAnnounced = false;

  /** The named clubs, batting in a fixed order so the same men come up all game. */
  private readonly teammates: RosterPlayer[];
  private readonly opponentBatters: RosterPlayer[];

  constructor(
    player: PlayerProfile,
    level: LeagueLevel,
    myTeam: Team,
    opponent: Team,
    home: boolean,
    rng: Rng,
    weather: Weather = CALM,
    mustDecide = false,
  ) {
    this.mustDecide = mustDecide;
    this.player = player;
    this.level = level;
    this.opponentName = opponent.name;
    this.playerIsHome = home;
    this.rng = rng;
    this.air = airFor(weather);
    this.teammates = teamBatters(myTeam);
    this.opponentBatters = teamBatters(opponent);

    // Today's starter comes off the opponent's staff, pitching about as well
    // as his rating says, give or take an outing.
    const starter = teamPitchers(opponent);
    const todays = starter.length > 0 ? rng.pick(starter) : null;
    this.pitcher = {
      name: todays?.name ?? randomName(rng),
      rating: clamp(
        todays ? todays.rating + rng.gaussian() * 3 : level.pitcherRating + rng.gaussian() * 8,
        10,
        99,
      ),
    };

    const ourStaff = teamPitchers(myTeam);
    const oursToday = ourStaff.length > 0 ? rng.pick(ourStaff) : null;
    this.ourPitcher = {
      name: oursToday?.name ?? randomName(rng),
      rating: clamp(oursToday ? oursToday.rating : 50, 10, 99),
    };
  }

  /** Who's due up next, for the sim screen's matchup strip. */
  dueUp(): { name: string; rating: number; isPlayer: boolean } {
    if (this.weAreBatting) {
      if (this.lineupIndex % LINEUP_SIZE === PLAYER_SLOT) {
        return { name: this.player.name, rating: 0, isPlayer: true };
      }
      const batter = nextBatter(this.teammates, this.lineupIndex);
      return { name: batter.name, rating: batter.rating, isPlayer: false };
    }
    const batter = nextBatter(this.opponentBatters, this.opponentLineupIndex);
    return { name: batter.name, rating: batter.rating, isPlayer: false };
  }

  /** The arm the due-up batter is facing: theirs when we bat, ours when they do. */
  facingPitcher(): PitcherAI {
    return this.weAreBatting ? this.pitcher : this.ourPitcher;
  }

  /** Score runs and file them under the current inning for the linescore. */
  private addRuns(side: 'us' | 'them', runs: number): void {
    if (runs <= 0) return;
    this.score[side] += runs;
    const slot = this.inning - 1;
    this.lineScore[side][slot] = (this.lineScore[side][slot] ?? 0) + runs;
  }

  get weAreBatting(): boolean {
    return this.playerIsHome ? this.half === 'bottom' : this.half === 'top';
  }

  get inningLabel(): string {
    return `${this.half === 'top' ? 'Top' : 'Bot'} ${this.inning}`;
  }

  /** Advance the game until something needs the player, or it ends. */
  step(): SimEvent {
    if (this.pending) return this.pending;
    if (this.finished) return { kind: 'gameOver', ...this.gameResult() };

    if (!this.inningAnnounced) {
      this.inningAnnounced = true;
      const batting = this.weAreBatting ? 'You bat' : `${this.opponentName} bats`;
      return { kind: 'inning', text: `${this.inningLabel} — ${batting}` };
    }

    if (this.checkGameEnd()) {
      this.finished = true;
      return { kind: 'gameOver', ...this.gameResult() };
    }

    return this.weAreBatting ? this.stepOurHalf() : this.stepTheirHalf();
  }

  /* ------------------------------------------------------------ our half */

  private stepOurHalf(): SimEvent {
    if (this.lineupIndex % LINEUP_SIZE === PLAYER_SLOT) {
      const event: SimEvent = {
        kind: 'atBat',
        pitcher: this.pitcher,
        outs: this.outs,
        bases: [...this.bases],
      };
      this.pending = event;
      return event;
    }

    const batter = nextBatter(this.teammates, this.lineupIndex);
    this.lineupIndex++;
    return this.simulateGenericPA(batter, true);
  }

  /**
   * The player finished a plate appearance in the minigame. Apply it.
   */
  submitAtBat(outcome: AtBatOutcome): { text: string; tone: LogTone; runs: number } {
    this.pending = null;
    this.lineupIndex++;

    // Taken before anything moves: the swing is judged against the game as it
    // stood when the pitch was thrown, not the one it leaves behind.
    const before = this.situation();
    const stats = this.gameStats;
    stats.pa++;

    let runs = 0;
    let tone: LogTone = 'neutral';

    switch (outcome.result) {
      case 'walk':
        stats.walks++;
        runs = this.walkRunners();
        tone = 'good';
        break;
      case 'strikeout':
        stats.ab++;
        stats.strikeouts++;
        this.recordOut();
        tone = 'bad';
        break;
      case 'single':
      case 'double':
      case 'triple':
      case 'homeRun': {
        stats.ab++;
        stats.hits++;
        this.teamHits.us++;
        if (outcome.result === 'single') stats.singles++;
        if (outcome.result === 'double') stats.doubles++;
        if (outcome.result === 'triple') stats.triples++;
        if (outcome.result === 'homeRun') stats.homeRuns++;
        runs = this.advanceOnHit(outcome.basesAdvanced);
        stats.rbi += runs;
        if (outcome.result === 'homeRun') stats.runs++;
        tone = outcome.result === 'homeRun' ? 'big' : 'hit';
        break;
      }
      default:
        // Every kind of out in play.
        stats.ab++;
        runs = this.outInPlay(outcome.result === 'groundout');
        stats.rbi += runs;
        tone = 'bad';
        break;
    }

    this.addRuns('us', runs);
    this.recordFeats(before, {
      homeRun: outcome.result === 'homeRun',
      insideThePark: false,
      runs,
    });
    return { text: outcome.description, tone, runs };
  }

  /* ---------------------------------------------------------- their half */

  private stepTheirHalf(): SimEvent {
    // Walk their order rather than picking at random, so nobody bats twice in
    // the same inning.
    const batter = nextBatter(this.opponentBatters, this.opponentLineupIndex);
    const name = batter.name;
    this.opponentLineupIndex++;
    const roll = this.rng.next();
    const quality = this.level.pitcherRating / 100;
    // Their better hitters strike out a touch less and hit a touch more.
    const skill = (batter.rating - 50) / 100;

    if (roll < 0.2 + quality * 0.06 - skill * 0.04) {
      this.recordOut();
      return this.log(`${name} strikes out swinging.`, 'good');
    }
    if (roll < 0.28) {
      const runs = this.walkRunnersOpponent();
      this.addRuns('them', runs);
      // The walk itself is routine traffic; the run against is the bad news,
      // and that gets its own red line in the feed.
      return this.log(`${name} draws a walk.`, 'neutral', runs, false);
    }
    if (roll < 0.48 + skill * 0.05) {
      const bases = this.rng.chance(0.78) ? 1 : this.rng.chance(0.75) ? 2 : 4;
      const runs = this.advanceOnHitOpponent(bases);
      this.addRuns('them', runs);
      this.teamHits.them++;
      const label = bases === 1 ? 'lines a single' : bases === 2 ? 'doubles into the gap' : 'goes deep — home run';
      // A hit is gold whoever hit it; the runs line carries the sting.
      return this.log(`${name} ${label}.`, 'hit', runs, false);
    }

    // Ball in play. If it's headed into the player's zone, hand it over and
    // let them field it live; otherwise resolve it abstractly for pace.
    const battedBall = this.opponentBattedBall();
    if (this.isUserPlay(battedBall)) {
      const event: SimEvent = { kind: 'fielding', hitter: name, battedBall };
      this.pending = event;
      return event;
    }

    this.recordOut();
    return this.log(`${name} ${describeOut(battedBall)}.`, 'good');
  }

  /** A plausible batted ball off an opposing hitter at this level. */
  private opponentBattedBall(): BattedBall {
    const rng = this.rng;
    const strength = clamp(this.level.pitcherRating, 10, 99) / 100;
    const roll = rng.next();
    const quality: ContactQuality =
      roll < 0.12 ? 'barrel' : roll < 0.34 ? 'solid' : roll < 0.66 ? 'flare' : 'weak';

    const base = 74 + strength * 14;
    const bonus = quality === 'barrel' ? 20 : quality === 'solid' ? 12 : quality === 'flare' ? 4 : -6;

    return {
      quality,
      exitVelocity: clamp(base + bonus + rng.gaussian() * 5, 45, 118),
      launchAngle: clamp(rng.gaussian() * 18 + 14, -20, 62),
      // Most batted balls are pulled or up the middle.
      spray: clamp(rng.gaussian() * 0.4, -0.73, 0.73),
    };
  }

  /** True when the player's position is the closest one to where it lands. */
  private isUserPlay(battedBall: BattedBall): boolean {
    const landing = predictLanding(
      launchBall(battedBall.exitVelocity, battedBall.launchAngle, battedBall.spray, 1, 0, this.air),
    );
    if (!isFair(landing.point)) return false;

    const userPosition = toPositionId(this.player.position);
    let nearest: PositionId = 'CF';
    let best = Infinity;
    for (const id of ALL_POSITIONS) {
      const d = distance(FIELDER_HOME[id], landing.point);
      if (d < best) {
        best = d;
        nearest = id;
      }
    }
    return nearest === userPosition;
  }

  /**
   * Apply a play that was resolved live on the field. The play already worked
   * out where every runner ended up, so this just folds it into the game.
   */
  submitLivePlay(result: PlayOutcome, batting: 'us' | 'them'): { text: string; tone: LogTone } {
    this.pending = null;

    if (result.kind === 'foul') {
      return { text: result.description, tone: 'neutral' };
    }

    const runs = result.runs;
    const before = this.situation();
    if (batting === 'us') {
      this.lineupIndex++;
      const stats = this.gameStats;
      stats.pa++;
      stats.ab++;
      // Reaching on a misplay is an at-bat, but never a hit.
      if (result.reachedOnError) {
        this.bases = [...result.basesAfter];
        this.addRuns('us', runs);
        this.teamErrors.them++;
        stats.rbi += runs;
        const room = Math.max(0, 3 - this.outs);
        for (let i = 0; i < Math.min(result.outs, room); i++) this.recordOut();
        // A game can end on a misplay, and it still counts as a walk-off — the
        // run came home on your ball. It just isn't a home run.
        this.recordFeats(before, { homeRun: false, insideThePark: false, runs });
        return { text: result.description, tone: 'neutral' };
      }
      if (result.kind === 'homeRun') {
        stats.hits++;
        stats.homeRuns++;
        stats.runs++;
      } else if (result.kind === 'triple') {
        stats.hits++;
        stats.triples++;
      } else if (result.kind === 'double') {
        stats.hits++;
        stats.doubles++;
      } else if (result.kind === 'single') {
        stats.hits++;
        stats.singles++;
      }
      if (result.kind !== 'out') this.teamHits.us++;
      stats.rbi += runs;
      this.addRuns('us', runs);
    } else {
      this.addRuns('them', runs);
      if (result.kind !== 'out') this.teamHits.them++;
      if (result.userPutout) this.putouts++;
      if (result.userError) {
        this.errors++;
        this.teamErrors.us++;
      }
    }

    this.bases = [...result.basesAfter];

    // Never record more outs than the half-inning has room for, or the extras
    // would leak into the next inning.
    const room = Math.max(0, 3 - this.outs);
    for (let i = 0; i < Math.min(result.outs, room); i++) this.recordOut();

    if (batting === 'us') {
      this.recordFeats(before, {
        homeRun: result.kind === 'homeRun',
        insideThePark: result.insideThePark,
        runs,
      });
    }

    // Ours: gold for hits, big gold for the homer, red for the out. Theirs:
    // green when we got them out; their hit is gold like any hit — the runs
    // line that follows it in the feed carries the bad news.
    const tone: LogTone =
      batting === 'us'
        ? result.kind === 'homeRun'
          ? 'big'
          : result.kind === 'out'
            ? 'bad'
            : 'hit'
        : result.kind === 'out'
          ? 'good'
          : 'hit';

    return { text: result.description, tone };
  }

  /* ----------------------------------------------------- generic sim PAs */

  private simulateGenericPA(batter: RosterPlayer, ours: boolean): SimEvent {
    const name = batter.name;
    const roll = this.rng.next();
    // A light thumb on the scale from the batter's rating: rosters centre
    // around 50, so the game as a whole plays exactly as it did — but the kid
    // hitting 62 earns his headlines honestly.
    const skill = (batter.rating - 50) / 100;
    if (roll < 0.22 - skill * 0.05) {
      this.recordOut();
      return this.log(`${name} strikes out.`, ours ? 'bad' : 'good');
    }
    if (roll < 0.3) {
      const runs = ours ? this.walkRunners() : this.walkRunnersOpponent();
      this.addRuns(ours ? 'us' : 'them', runs);
      return this.log(`${name} walks.`, ours ? 'good' : 'neutral', runs, ours);
    }
    if (roll < 0.5 + skill * 0.06) {
      const bases = this.rng.chance(0.76) ? 1 : this.rng.chance(0.78) ? 2 : 4;
      const runs = ours ? this.advanceOnHit(bases) : this.advanceOnHitOpponent(bases);
      this.addRuns(ours ? 'us' : 'them', runs);
      this.teamHits[ours ? 'us' : 'them']++;
      const label = bases === 1 ? 'singles' : bases === 2 ? 'doubles' : 'homers';
      return this.log(`${name} ${label}.`, 'hit', runs, ours);
    }
    this.recordOut();
    // No batted ball behind a simulated PA, so vary the line directly — half of
    // these otherwise read "grounds out" every time.
    const out = this.rng.pick([
      'grounds out to short',
      'grounds out to second',
      'flies out to left',
      'flies out to right',
      'flies out to center',
      'lines out to third',
      'pops out to first',
    ]);
    return this.log(`${name} ${out}.`, ours ? 'bad' : 'good');
  }

  /* --------------------------------------------------------------- feats */

  /** The game as it stood before a pitch: what a feat is measured against. */
  private situation(): Situation {
    return {
      bases: [...this.bases],
      us: this.score.us,
      them: this.score.them,
      inning: this.inning,
      half: this.half,
    };
  }

  /**
   * Fold one of the player's completed plate appearances into `feats`.
   *
   * Called *after* the runs are on the board and the bases have moved, with
   * the pre-pitch situation passed back in — that pairing is the whole trick.
   * A grand slam is "three men on, then the ball left the yard"; a walk-off is
   * "batting last, ninth or later, behind or level, and now ahead". Neither
   * question can be answered from one side of the swing alone.
   */
  private recordFeats(
    before: Situation,
    play: { homeRun: boolean; insideThePark: boolean; runs: number },
  ): void {
    const feats = this.feats;

    if (play.homeRun && before.bases[0] && before.bases[1] && before.bases[2]) {
      feats.grandSlam = true;
    }
    if (play.insideThePark) feats.insideThePark = true;
    if (play.runs > feats.bestRbiPa) feats.bestRbiPa = play.runs;

    // Late and behind, and you fixed it — level or better. The seventh is
    // where a nine-inning game starts counting outs.
    if (
      play.runs > 0 &&
      before.inning >= CLUTCH_INNING &&
      before.us < before.them &&
      this.score.us >= this.score.them
    ) {
      feats.clutchHit = true;
    }

    // A walk-off needs the home half of the ninth or later, and a score that
    // crossed over on this swing. `mustDecide` games run past twelve; the
    // condition doesn't care how deep it got, only that this ended it.
    const battingLast = this.playerIsHome && before.half === 'bottom';
    if (
      battingLast &&
      before.inning >= REGULATION_INNINGS &&
      play.runs > 0 &&
      before.us <= before.them &&
      this.score.us > this.score.them
    ) {
      feats.walkOff = true;
      if (play.homeRun) feats.walkOffHomeRun = true;
    }
  }

  /* ------------------------------------------------------------- helpers */

  private log(text: string, tone: LogTone, runs = 0, ours = false): SimEvent {
    return runs > 0
      ? { kind: 'log', text, tone, runs: { count: runs, ours } }
      : { kind: 'log', text, tone };
  }

  private recordOut(): void {
    this.outs++;
    if (this.outs >= 3) this.endHalfInning();
  }

  private endHalfInning(): void {
    this.outs = 0;
    this.bases = [false, false, false];
    this.inningAnnounced = false;
    if (this.half === 'top') {
      this.half = 'bottom';
    } else {
      this.half = 'top';
      this.inning++;
    }
  }

  /** Runners forced ahead by a walk. Returns runs scored. */
  private walkRunners(): number {
    let runs = 0;
    if (this.bases[0] && this.bases[1] && this.bases[2]) runs = 1;
    else if (this.bases[0] && this.bases[1]) this.bases[2] = true;
    else if (this.bases[0]) this.bases[1] = true;
    this.bases[0] = true;
    return runs;
  }

  private walkRunnersOpponent(): number {
    return this.walkRunners();
  }

  /** Move everyone up `bases` and put the batter on. Returns runs scored. */
  private advanceOnHit(bases: number): number {
    let runs = 0;
    const next: boolean[] = [false, false, false];

    for (let b = 2; b >= 0; b--) {
      if (!this.bases[b]) continue;
      const target = b + bases;
      if (target >= 3) runs++;
      else next[target] = true;
    }

    if (bases >= 4) runs++;
    else next[bases - 1] = true;

    this.bases = next;
    return runs;
  }

  private advanceOnHitOpponent(bases: number): number {
    return this.advanceOnHit(bases);
  }

  /** An out where a runner might still come home. */
  private outInPlay(isGrounder: boolean): number {
    let runs = 0;
    // Double play chance on a grounder with a man on first.
    if (isGrounder && this.bases[0] && this.outs < 2 && this.rng.chance(0.28)) {
      this.bases[0] = false;
      this.recordOut();
      this.recordOut();
      return 0;
    }
    // Sac fly: runner on third scores with fewer than two outs.
    if (!isGrounder && this.bases[2] && this.outs < 2 && this.rng.chance(0.55)) {
      this.bases[2] = false;
      runs = 1;
    }
    this.recordOut();
    return runs;
  }

  private checkGameEnd(): boolean {
    if (this.inning > MAX_INNINGS && !this.mustDecide) return true;
    if (this.inning <= REGULATION_INNINGS) {
      // Home team doesn't bat in the ninth if already ahead.
      const homeScore = this.playerIsHome ? this.score.us : this.score.them;
      const awayScore = this.playerIsHome ? this.score.them : this.score.us;
      if (this.inning === REGULATION_INNINGS && this.half === 'bottom' && homeScore > awayScore) {
        return true;
      }
      return false;
    }
    // Extras: end as soon as a full inning finishes with a leader.
    return this.half === 'top' && this.score.us !== this.score.them;
  }

  private gameResult(): { win: boolean; tie: boolean } {
    return {
      win: this.score.us > this.score.them,
      tie: this.score.us === this.score.them,
    };
  }
}
