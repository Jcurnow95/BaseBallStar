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
import { effectiveAttributes } from './gear';
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
  | { kind: 'stealChance'; fromBase: 0 | 1; chance: number }
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

/**
 * What a steal attempt takes out of you, safe or not — the sprint happens
 * either way. Energy is the daily tank shared with training, so a running
 * game today is a lighter session tomorrow; stamina is the season-long tank
 * the swing already leans on.
 */
export const STEAL_ENERGY_COST = 6;
export const STEAL_STAMINA_COST = 2;

/**
 * How the timing minigame graded the break: 'early' is before the pitcher
 * ever moved (a pickoff waiting to happen), 'great' beat the reaction
 * window fatigue allows, 'good' is an ordinary clean jump, 'late' left
 * with the catcher already loading up.
 */
export type StealJump = 'early' | 'great' | 'good' | 'late';


/**
 * How often a ball in play beats the simulated defense.
 *
 * Every ball in play that ISN'T hit at the player used to be an automatic out,
 * while the ones hit at the player were handed to the live field — where about
 * a fifth of them drop in. That made the player's own position the only hole
 * in an otherwise flawless defense. Measured over a few hundred games it cost
 * the club about two thirds of a run a night, which was enough on its own to
 * turn a .545 side into a .467 one: the game was quietly punishing you for the
 * one defensive job it gives you.
 *
 * Letting the simulated fielders miss at the same rate closes that hole, and
 * fixes the thing that made these games 2-1 slogs — nine innings where every
 * ball not hit at you was a guaranteed out.
 */
const BIP_HIT_CHANCE = 0.2;

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
function describeHit(bb: BattedBall, bases: number): string {
  const field = fieldFor(bb.spray, 'R');
  if (bases >= 4) return `drives one out to ${field} — home run`;
  if (bases === 2) return `doubles into the ${field}-field gap`;
  if (bb.launchAngle < 8) return `sneaks a ground ball through the ${field} side`;
  if (bb.launchAngle > 32) return `bloops one into shallow ${field}`;
  return `lines a single to ${field}`;
}

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

  /** Runs per inning (index 0 = 1st), for the linescore grid. */
  readonly lineScore = { us: [] as number[], them: [] as number[] };
  /** Team hit totals — the H column. */
  readonly teamHits: GameScore = { us: 0, them: 0 };
  /**
   * Team error totals — the E column. Only the errors the sim actually models:
   * the player's own misplays, and misplays that put the player aboard.
   */
  readonly teamErrors: GameScore = { us: 0, them: 0 };

  /**
   * Our starter. He works their half the way their starter works ours: the
   * strikeouts he gets and the contact he gives up both come off his rating.
   *
   * He used to be decorative — their half was pitched by `level.pitcherRating`,
   * the league average, while our at-bats faced the opposition's real arm. So
   * their good starter made our night harder and ours did nothing for us, and
   * the club's whole pitching staff was a name on a screen.
   */
  readonly ourPitcher: PitcherAI;

  /** The day's air, so "is this ball mine?" is judged on the same flight the field plays. */
  private readonly air: AirConditions;
  private lineupIndex = 0;
  private opponentLineupIndex = 0;
  private pending: SimEvent | null = null;
  private inningAnnounced = false;

  /**
   * Which base the player himself is standing on (0 = first), or null when
   * he isn't aboard. The bases array stays anonymous booleans; this is the
   * one runner the game follows by name, so he can steal and be credited
   * with the runs he scores.
   */
  private playerBase: 0 | 1 | 2 | null = null;
  /** A steal window is open: the UI has been offered the jump this PA. */
  private stealWindow = false;

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

    // With the player aboard and the next bag open, offer the jump before the
    // teammate's PA resolves. The window lasts one tick: if the UI comes back
    // without an attempt, the at-bat just happens.
    if (this.stealWindow) {
      this.stealWindow = false;
    } else if (this.playerBase !== null && this.playerBase < 2 && !this.bases[this.playerBase + 1]) {
      this.stealWindow = true;
      const fromBase = this.playerBase as 0 | 1;
      return { kind: 'stealChance', fromBase, chance: this.stealChance(fromBase) };
    }

    const batter = nextBatter(this.teammates, this.lineupIndex);
    this.lineupIndex++;
    return this.simulateGenericPA(batter, true);
  }

  /**
   * Odds of making it if the player takes off right now. Speed is the engine;
   * the two condition bars are the tuning: a season-worn body (stamina) never
   * gets its full jump, and a day spent burning energy leaves nothing for the
   * sprint. Deliberately generous at full freshness — stealing should feel
   * like a weapon you manage, not a coin flip.
   */
  stealChance(fromBase: 0 | 1): number {
    const speed = effectiveAttributes(this.player).speed;
    let chance = 0.38 + speed * 0.005;
    chance *= 0.8 + (this.player.stamina / 100) * 0.2;
    if (this.player.energy < 35) chance *= 0.72 + (this.player.energy / 35) * 0.28;
    chance -= (this.level.defenseRating - 50) * 0.002;
    // Third is a shorter throw for the catcher.
    if (fromBase === 1) chance -= 0.1;
    return clamp(chance, 0.08, 0.95);
  }

  /**
   * How sharp a tap has to be to count as each jump, in milliseconds after
   * the pitcher's first move. The great-jump window is where fatigue lives
   * in your fingers: fresh legs get a third of a second, a body running on
   * fumes barely half that — the elite jump stops being reachable before
   * stealing itself does.
   */
  stealJumpWindows(): { great: number; good: number } {
    const freshness =
      (this.player.stamina / 100) * 0.5 + (Math.min(this.player.energy, 50) / 50) * 0.5;
    return { great: 160 + Math.round(freshness * 180), good: 650 };
  }

  /**
   * The player takes off. Costs come out whether he makes it or not; the
   * result comes back as a feed line. The jump quality comes from the timing
   * minigame: break before the pitcher moves and he has you dead to rights,
   * go on his first flinch and the posted odds get a bonus, leave late and
   * the catcher gets a head start. Null when no window is open (the UI
   * raced a resolved play).
   */
  attemptSteal(jump: StealJump = 'good'): { text: string; tone: LogTone; success: boolean } | null {
    if (!this.stealWindow || this.playerBase === null || this.playerBase > 1) return null;
    this.stealWindow = false;
    const from = this.playerBase as 0 | 1;
    const target = from + 1;
    const bag = target === 1 ? 'second' : 'third';
    let chance = this.stealChance(from);
    if (jump === 'early') chance *= 0.4;
    else if (jump === 'great') chance = clamp(chance + 0.12, 0.08, 0.97);
    else if (jump === 'late') chance = clamp(chance - 0.18, 0.05, 0.95);

    this.player.energy = clamp(this.player.energy - STEAL_ENERGY_COST, 0, 100);
    this.player.stamina = clamp(this.player.stamina - STEAL_STAMINA_COST, 0, 100);

    if (this.rng.next() < chance) {
      this.bases[from] = false;
      this.bases[target] = true;
      this.playerBase = target as 1 | 2;
      this.gameStats.stolenBases++;
      const text =
        jump === 'early'
          ? `You gamble on the first flinch and he never gets a play off — stolen ${bag}!`
          : jump === 'great'
            ? `Huge jump — you're into ${bag} standing up. Stolen base!`
            : jump === 'late'
              ? `Slow out of the blocks, but you sneak in under the tag — stolen ${bag}!`
              : `You take off and slide in ahead of the tag — stolen ${bag}!`;
      return { text, tone: 'good', success: true };
    }

    this.bases[from] = false;
    this.playerBase = null;
    this.recordOut();
    const text =
      jump === 'early'
        ? 'You break too soon — he steps off and runs you down. Picked off.'
        : jump === 'late'
          ? `Late jump, and the throw beats you to ${bag} by a mile — caught stealing.`
          : `The throw beats you to ${bag} — caught stealing.`;
    return { text, tone: 'bad', success: false };
  }

  /**
   * The player showed steal but never went — froze past the pitcher's move
   * and had to dive back in. No attempt, no real cost beyond a little
   * wasted adrenaline; the window closes and the at-bat goes on.
   */
  bailSteal(): { text: string; tone: LogTone } | null {
    if (!this.stealWindow) return null;
    this.stealWindow = false;
    this.player.energy = clamp(this.player.energy - 2, 0, 100);
    return { text: 'You bluff the break, then dive back in ahead of the pickoff.', tone: 'neutral' };
  }

  /**
   * The player finished a plate appearance in the minigame. Apply it.
   */
  submitAtBat(outcome: AtBatOutcome): { text: string; tone: LogTone; runs: number } {
    this.pending = null;
    this.lineupIndex++;

    const stats = this.gameStats;
    stats.pa++;

    let runs = 0;
    let tone: LogTone = 'neutral';

    switch (outcome.result) {
      case 'walk':
        stats.walks++;
        runs = this.walkRunners();
        this.playerBase = 0;
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
        else this.playerBase = Math.min(outcome.basesAdvanced - 1, 2) as 0 | 1 | 2;
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
    const quality = clamp(this.ourPitcher.rating, 10, 99) / 100;
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

    if (this.ballInPlayFalls(battedBall.quality)) {
      const bases = this.hitBasesFor(battedBall);
      const runs = this.advanceOnHitOpponent(bases);
      this.addRuns('them', runs);
      this.teamHits.them++;
      return this.log(`${name} ${describeHit(battedBall, bases)}.`, 'hit', runs, false);
    }

    this.recordOut();
    return this.log(`${name} ${describeOut(battedBall)}.`, 'good');
  }

  /**
   * Did a ball in play beat the defense behind the pitcher? Better contact
   * falls in more often, and a better league turns more of it into outs. See
   * `BIP_HIT_CHANCE` for why this is not simply "no".
   */
  private ballInPlayFalls(quality?: ContactQuality): boolean {
    const defense = clamp(this.level.defenseRating, 10, 99) / 100;
    const contact =
      quality === 'barrel'
        ? 1.7
        : quality === 'solid'
          ? 1.25
          : quality === 'flare'
            ? 0.9
            : quality === 'weak'
              ? 0.55
              : // A simulated plate appearance has no batted ball behind it.
                0.95;
    return this.rng.chance(clamp(BIP_HIT_CHANCE * contact * (1.25 - defense * 0.5), 0.03, 0.6));
  }

  /** How far a ball that fell in goes. Most of them are singles. */
  private hitBasesFor(bb?: BattedBall): number {
    if (bb?.quality === 'barrel') {
      if (this.rng.chance(0.14)) return 4;
      return this.rng.chance(0.42) ? 2 : 1;
    }
    if (bb?.quality === 'solid') return this.rng.chance(0.26) ? 2 : 1;
    return this.rng.chance(0.14) ? 2 : 1;
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
    if (batting === 'us') {
      this.lineupIndex++;
      const stats = this.gameStats;
      stats.pa++;
      stats.ab++;
      // Reaching on a misplay is an at-bat, but never a hit.
      if (result.reachedOnError) {
        this.bases = [...result.basesAfter];
        this.trackBatterAfterPlay(result);
        this.addRuns('us', runs);
        this.teamErrors.them++;
        stats.rbi += runs;
        const room = Math.max(0, 3 - this.outs);
        for (let i = 0; i < Math.min(result.outs, room); i++) this.recordOut();
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
    if (batting === 'us') this.trackBatterAfterPlay(result);

    // Never record more outs than the half-inning has room for, or the extras
    // would leak into the next inning.
    const room = Math.max(0, 3 - this.outs);
    for (let i = 0; i < Math.min(result.outs, room); i++) this.recordOut();

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

  /**
   * After the player's own live ball, remember which bag he pulled up on so
   * the steal game can pick him up from there. Scoring on the play (any way
   * other than the homer, which is already credited) counts on his line.
   */
  private trackBatterAfterPlay(result: PlayOutcome): void {
    if (result.batterBase >= 1 && result.batterBase <= 3) {
      this.playerBase = (result.batterBase - 1) as 0 | 1 | 2;
    } else {
      if (result.batterBase >= 4 && result.kind !== 'homeRun') this.gameStats.runs++;
      this.playerBase = null;
    }
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
    // A ball in play the defense didn't get to. Symmetric with their half, so
    // closing the hole at the player's position doesn't hand the opposition a
    // scoring edge instead.
    if (this.ballInPlayFalls()) {
      const bases = this.hitBasesFor();
      const runs = ours ? this.advanceOnHit(bases) : this.advanceOnHitOpponent(bases);
      this.addRuns(ours ? 'us' : 'them', runs);
      this.teamHits[ours ? 'us' : 'them']++;
      const label =
        bases === 2
          ? this.rng.pick(['doubles down the line', 'doubles into the gap'])
          : this.rng.pick([
              'singles through the right side',
              'lines a single to left',
              'bloops one into center',
              'beats out an infield single',
            ]);
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

  /** The tracked runner crosses the plate: off the bases, onto his line. */
  private scorePlayerRunner(): void {
    this.playerBase = null;
    this.gameStats.runs++;
  }

  private endHalfInning(): void {
    this.outs = 0;
    this.bases = [false, false, false];
    this.playerBase = null;
    this.stealWindow = false;
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
    // If the player is aboard and every bag behind him is full, he's forced
    // along with the rest. Judged before the bases move.
    if (this.playerBase !== null && this.bases.slice(0, this.playerBase + 1).every(Boolean)) {
      if (this.playerBase === 2) this.scorePlayerRunner();
      else this.playerBase++;
    }
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
    if (this.playerBase !== null) {
      const target = this.playerBase + bases;
      if (target >= 3) this.scorePlayerRunner();
      else this.playerBase = target as 0 | 1 | 2;
    }
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
