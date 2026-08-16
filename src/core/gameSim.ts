import type { AtBatOutcome, BattedBall, BattingStats, ContactQuality, PlayerProfile } from './types';
import type { LeagueLevel } from './league';
import { pitcherName } from './league';
import type { PitcherAI } from './pitching';
import { Rng, clamp } from './rng';
import { emptyBattingStats } from './player';
import { launchBall, predictLanding } from './ballFlight';
import type { PositionId } from './fieldGeometry';
import { ALL_POSITIONS, FIELDER_HOME, distance, isFair, toPositionId } from './fieldGeometry';
import type { PlayOutcome } from './playSim';
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
  | { kind: 'log'; text: string; tone: LogTone }
  | { kind: 'inning'; text: string }
  | { kind: 'atBat'; pitcher: PitcherAI; outs: number; bases: boolean[] }
  | { kind: 'fielding'; hitter: string; battedBall: BattedBall }
  | { kind: 'gameOver'; win: boolean; tie: boolean };

export type LogTone = 'neutral' | 'good' | 'bad' | 'big';

/** Where the player hits in the order. */
const PLAYER_SLOT = 2;
const LINEUP_SIZE = 9;
const REGULATION_INNINGS = 9;
const MAX_INNINGS = 12;

const TEAMMATE_NAMES = [
  'Ruiz', 'Halloran', 'Sato', 'Beckman', 'Vance', 'Ortiz', 'Nakagawa', 'Pryor',
];
const OPPONENT_NAMES = [
  'Dunphy', 'Ibarra', 'Kowalski', 'Reyes', 'Achebe', 'Salas', 'Brandt', 'Muir',
];

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

  /** The day's air, so "is this ball mine?" is judged on the same flight the field plays. */
  private readonly air: AirConditions;
  private lineupIndex = 0;
  private opponentLineupIndex = 0;
  private pending: SimEvent | null = null;
  private inningAnnounced = false;

  constructor(
    player: PlayerProfile,
    level: LeagueLevel,
    opponentName: string,
    home: boolean,
    rng: Rng,
    weather: Weather = CALM,
  ) {
    this.player = player;
    this.level = level;
    this.opponentName = opponentName;
    this.playerIsHome = home;
    this.rng = rng;
    this.air = airFor(weather);
    this.pitcher = {
      name: pitcherName(rng),
      rating: clamp(level.pitcherRating + rng.gaussian() * 8, 10, 99),
    };
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

    const name = TEAMMATE_NAMES[this.lineupIndex % TEAMMATE_NAMES.length];
    this.lineupIndex++;
    return this.simulateGenericPA(name, true);
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
        if (outcome.result === 'single') stats.singles++;
        if (outcome.result === 'double') stats.doubles++;
        if (outcome.result === 'triple') stats.triples++;
        if (outcome.result === 'homeRun') stats.homeRuns++;
        runs = this.advanceOnHit(outcome.basesAdvanced);
        stats.rbi += runs;
        if (outcome.result === 'homeRun') stats.runs++;
        tone = outcome.result === 'homeRun' ? 'big' : 'good';
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

    this.score.us += runs;
    return { text: outcome.description, tone, runs };
  }

  /* ---------------------------------------------------------- their half */

  private stepTheirHalf(): SimEvent {
    // Walk their order rather than picking at random, so nobody bats twice in
    // the same inning.
    const name = OPPONENT_NAMES[this.opponentLineupIndex % OPPONENT_NAMES.length];
    this.opponentLineupIndex++;
    const roll = this.rng.next();
    const quality = this.level.pitcherRating / 100;

    if (roll < 0.2 + quality * 0.06) {
      this.recordOut();
      return this.log(`${name} strikes out swinging.`, 'good');
    }
    if (roll < 0.28) {
      const runs = this.walkRunnersOpponent();
      this.score.them += runs;
      return this.log(`${name} draws a walk.`, 'bad');
    }
    if (roll < 0.48) {
      const bases = this.rng.chance(0.78) ? 1 : this.rng.chance(0.75) ? 2 : 4;
      const runs = this.advanceOnHitOpponent(bases);
      this.score.them += runs;
      const label = bases === 1 ? 'lines a single' : bases === 2 ? 'doubles into the gap' : 'goes deep — home run';
      return this.log(`${name} ${label}.`, 'bad');
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
    if (batting === 'us') {
      this.lineupIndex++;
      const stats = this.gameStats;
      stats.pa++;
      stats.ab++;
      // Reaching on a misplay is an at-bat, but never a hit.
      if (result.reachedOnError) {
        this.bases = [...result.basesAfter];
        this.score.us += runs;
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
      stats.rbi += runs;
      this.score.us += runs;
    } else {
      this.score.them += runs;
      if (result.userPutout) this.putouts++;
      if (result.userError) this.errors++;
    }

    this.bases = [...result.basesAfter];

    // Never record more outs than the half-inning has room for, or the extras
    // would leak into the next inning.
    const room = Math.max(0, 3 - this.outs);
    for (let i = 0; i < Math.min(result.outs, room); i++) this.recordOut();

    const good = batting === 'us' ? result.kind !== 'out' : result.kind === 'out';
    const tone: LogTone =
      result.kind === 'homeRun' && batting === 'us' ? 'big' : good ? 'good' : 'bad';

    return { text: result.description, tone };
  }

  /* ----------------------------------------------------- generic sim PAs */

  private simulateGenericPA(name: string, ours: boolean): SimEvent {
    const roll = this.rng.next();
    if (roll < 0.22) {
      this.recordOut();
      return this.log(`${name} strikes out.`, ours ? 'bad' : 'good');
    }
    if (roll < 0.3) {
      const runs = ours ? this.walkRunners() : this.walkRunnersOpponent();
      if (ours) this.score.us += runs;
      return this.log(`${name} walks.`, ours ? 'good' : 'bad');
    }
    if (roll < 0.5) {
      const bases = this.rng.chance(0.76) ? 1 : this.rng.chance(0.78) ? 2 : 4;
      const runs = ours ? this.advanceOnHit(bases) : this.advanceOnHitOpponent(bases);
      if (ours) this.score.us += runs;
      const label = bases === 1 ? 'singles' : bases === 2 ? 'doubles' : 'homers';
      return this.log(`${name} ${label}.`, ours ? 'good' : 'bad');
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

  private log(text: string, tone: LogTone): SimEvent {
    return { kind: 'log', text, tone };
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
    if (this.inning > MAX_INNINGS) return true;
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
