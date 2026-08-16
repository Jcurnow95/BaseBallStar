import type { Attributes, BattedBall, Handedness } from './types';
import type { BallPhysics } from './ballFlight';
import { launchBall, predictLanding, predictRest, stepBall } from './ballFlight';
import type { BaseId, PositionId, Vec2 } from './fieldGeometry';
import {
  ALL_POSITIONS,
  BASES,
  BASE_DISTANCE,
  FIELDER_HOME,
  coveringPosition,
  distance,
  isFair,
  isOutfield,
  magnitude,
} from './fieldGeometry';
import type { Ballpark } from './ballpark';
import { DEFAULT_PARK, fenceAt, wallHeightAt } from './ballpark';
import type { AirConditions, Weather } from './weather';
import { CALM, airFor } from './weather';
import { Rng, clamp } from './rng';

/**
 * A live baseball play, from the crack of the bat until the ball is back in
 * the infield and nobody is running. DOM-free: the view layer just renders
 * this and feeds it input.
 *
 * Deliberately simplified: every throw is treated as a force play, there are
 * no tag-ups, rundowns or relay men, and runners make one advancement decision
 * rather than reading the play continuously.
 */

export type PlayPhase = 'live' | 'held' | 'throw' | 'catch' | 'dead';

export type UserSide = 'offense' | 'defense';

export interface FielderState {
  id: PositionId;
  x: number;
  y: number;
  speed: number;
  isUser: boolean;
  hasBall: boolean;
  /** Where the AI is currently headed. Null for the user's fielder. */
  target: Vec2 | null;
  coverBase: BaseId | null;
  /** Chasers track the ball; backups hold their spot behind the play. */
  role: 'idle' | 'chase' | 'backup' | 'cover';
  /** Seconds before they read the ball and start moving. */
  reaction: number;
  /** Seconds before they can handle the ball again after muffing it. */
  recovery: number;
  /** Closest the ball has come while inside this fielder's reach. */
  minDist: number;
  prevDist: number;
}

export interface RunnerState {
  id: string;
  isUser: boolean;
  /** The base they occupied before the pitch. Intent is measured from here. */
  startBase: number;
  /** Last base reached: 0 = batter's box, 1..3 = bases, 4 = scored. */
  at: number;
  /** Fraction of the way to base `at + 1`. */
  progress: number;
  /** Highest base this runner will try for. */
  intent: number;
  speed: number;
  out: boolean;
  /** Stopped safely on a base. */
  done: boolean;
}

export interface PlayOutcome {
  kind: 'out' | 'single' | 'double' | 'triple' | 'homeRun' | 'foul';
  outs: number;
  runs: number;
  /** 0 when the batter is out, otherwise the base they finished on (4 = scored). */
  batterBase: number;
  /** Bases occupied when the dust settles: index 0 = first, 1 = second, 2 = third. */
  basesAfter: boolean[];
  description: string;
  userPutout: boolean;
  userError: boolean;
  /** The batter reached because of a misplay — an at-bat, but not a hit. */
  reachedOnError: boolean;
}

export interface PlaySetup {
  battedBall: BattedBall;
  bats: Handedness;
  /** The human player's attributes, whichever side they're on. */
  attributes: Attributes;
  /** The position the human plays in the field. */
  userPosition: PositionId;
  userSide: UserSide;
  /** Bases occupied before the pitch: index 0 = first, 1 = second, 2 = third. */
  runnersOn: boolean[];
  outs: number;
  /** Overall quality of the opposing side, 0-100. */
  opponentRating: number;
  /** The park being played in. Defaults to the symmetrical one. */
  park?: Ballpark;
  /** The day's weather. Defaults to a calm, dry one. */
  weather?: Weather;
  rng: Rng;
}

/** Glove height: a fly ball is judged for a catch once it drops below this. */
const CATCH_REACH = 7.5;
/** Inside this fraction of a fielder's range, the catch is routine. */
const CLEAN_CATCH_RATIO = 0.55;
const RECEIVE_RADIUS = 7;
const PLAY_TIMEOUT = 15;
/** How long the user can stand there holding the ball before they just throw it. */
const HOLD_LIMIT = 4.5;
/** Fielding the ball, transferring to the hand and setting to throw. */
const TRANSFER_TIME = 0.75;
/**
 * How much a runner has to beat the return throw by before trying for a base.
 * The defense only throws when it wins the race, so a runner who leaves with
 * less cushion than this is running into an out.
 */
const RUNNER_CAUTION = 0.35;
/**
 * How deep the ball has to settle before the batter will think about second.
 *
 * A thrown ball moves six times faster than a runner, and the batter starts
 * 180 feet from second rather than 90, so scoring that trip strictly means
 * they lose every race an outfielder is involved in and every hit is a
 * single.
 */
const STRETCH_DISTANCE = 250;
/**
 * The most of a basepath a runner is credited with having already covered
 * when the read is made.
 *
 * Runners sit frozen on their bag until `planRunnerIntents` gives them an
 * intent, which doesn't happen until the ball is down — but the defense's
 * clock starts at that same instant, so the race was scored as if the runner
 * had spent the ball's entire flight standing still. A real runner is well
 * off the bag by then. Without this the man on second never took third on a
 * clean single, because he was made to run all 90 feet after the outfielder
 * had already caught up to the ball.
 */
const MAX_LEAD = 0.4;
/** Fielders pull up this far short of the wall, so they stand in front of it. */
const WALL_MARGIN = 3;
/** Gap kept between runners, as a fraction of a basepath — about seven feet. */
const RUNNER_GAP = 0.08;
/** How long a fielder holds a ball with no play before returning it. */
const THROW_IN_DELAY = 0.7;
/** A throw covers this much ground before it needs a cut-off man. */
const RELAY_DISTANCE = 130;
/** What each relay costs in handling time. */
const RELAY_HANDLING = 0.55;

export class PlaySim {
  readonly setup: PlaySetup;
  readonly ball: BallPhysics;
  readonly fielders: FielderState[] = [];
  readonly runners: RunnerState[] = [];
  readonly landingPoint: Vec2;
  readonly hangTime: number;
  readonly park: Ballpark;
  readonly weather: Weather;
  readonly air: AirConditions;

  phase: PlayPhase = 'live';
  elapsed = 0;
  outcome: PlayOutcome | null = null;
  /** How the batter was retired, for tuning and play-by-play. */
  outMethod: 'none' | 'caught' | 'thrown' = 'none';
  /** Set while the ball is a throw in flight, so the view can draw it differently. */
  throwTarget: BaseId | null = null;
  ballCarrier: PositionId | null = null;
  /** Set when the play is waiting on the player's stretch-catch attempt. */
  pendingCatch: { fielderId: PositionId; wasFly: boolean; difficulty: number } | null = null;
  /** Short freeze after a decisive moment, before the play is declared dead. */
  private deadTimer = 0;
  private caughtInAir = false;
  /** True until somebody first touches the ball. Fair/foul only applies then. */
  private battedBallLive = true;
  /** Once set, CPU runners stop re-reading the play and run out what they have. */
  private intentsFrozen = false;
  /**
   * True once the player has used GO or HOLD. Until then their runner reads the
   * ball the same way a CPU runner does; after it, their call sticks.
   */
  private userIntentSet = false;
  /** Bags the user was left to cover themselves, for scoring an uncovered throw. */
  private readonly userCoverBases = new Set<BaseId>();
  /** Whether the throw currently in the air came from the user. */
  private throwByUser = false;
  /** Where the ball will finally settle. Worked out once, when it first lands. */
  private restPoint: Vec2 | null = null;
  private foul = false;
  private homeRun = false;
  private hitWall = false;
  private outsRecorded = 0;
  private userPutout = false;
  private userError = false;
  private errorOnPlay = false;
  private throwReaction = 0;
  private holdTimer = 0;
  private looseTimer = 0;
  private throwFrom: Vec2 | null = null;
  private throwRange = 0;
  private throwDuration = 0;
  private throwElapsed = 0;
  private lastEvent = '';
  /** Set when the user threw the ball, so they get credit if it retires a runner. */
  private userPutoutPending = false;

  constructor(setup: PlaySetup) {
    this.setup = setup;
    this.park = setup.park ?? DEFAULT_PARK;
    this.weather = setup.weather ?? CALM;
    this.air = airFor(this.weather);
    const bb = setup.battedBall;

    // Barrels carry more backspin, mishits much less.
    const spin = bb.quality === 'barrel' ? 1.1 : bb.quality === 'solid' ? 1 : 0.85;
    this.ball = launchBall(
      bb.exitVelocity,
      bb.launchAngle,
      bb.spray,
      spin,
      bb.sideSpin ?? 0,
      this.air,
    );

    const prediction = predictLanding(this.ball);
    this.landingPoint = prediction.point;
    this.hangTime = prediction.hangTime;

    this.buildFielders();
    this.buildRunners();
    this.assignRoles();
  }

  /* ------------------------------------------------------------------ setup */

  private buildFielders(): void {
    const skill = clamp(this.setup.opponentRating, 10, 99) / 100;
    const userFielding =
      this.setup.userSide === 'defense' ? clamp(this.setup.attributes.speed, 1, 99) / 100 : skill;

    for (const id of ALL_POSITIONS) {
      const home = FIELDER_HOME[id];
      const isUser = this.setup.userSide === 'defense' && id === this.setup.userPosition;
      this.fielders.push({
        id,
        x: home.x,
        y: home.y,
        speed: 20 + (isUser ? userFielding : skill) * 7,
        isUser,
        hasBall: false,
        target: null,
        coverBase: null,
        role: 'idle',
        // Reading the ball off the bat takes a beat; better fielders take less.
        reaction: isUser ? 0 : 0.55 - skill * 0.25,
        recovery: 0,
        minDist: Infinity,
        prevDist: Infinity,
      });
    }
  }

  private buildRunners(): void {
    const { runnersOn, userSide, attributes, opponentRating, rng } = this.setup;
    const cpuSpeed = 21 + (clamp(opponentRating, 10, 99) / 100) * 6;

    // Runners already on base, furthest along first so forcing reads cleanly.
    for (let base = 2; base >= 0; base--) {
      if (!runnersOn[base]) continue;
      this.runners.push({
        id: `r${base + 1}`,
        isUser: false,
        startBase: base + 1,
        at: base + 1,
        progress: 0,
        intent: base + 1,
        speed: cpuSpeed + rng.range(-1.5, 1.5),
        out: false,
        done: true,
      });
    }

    const batterSpeed =
      userSide === 'offense' ? 19 + (clamp(attributes.speed, 1, 99) / 100) * 10 : cpuSpeed;

    this.runners.push({
      id: 'batter',
      isUser: userSide === 'offense',
      startBase: 0,
      at: 0,
      progress: 0,
      intent: 1,
      speed: batterSpeed,
      out: false,
      done: false,
    });
  }

  /**
   * Decide who chases and who covers. The user's fielder is never given a job —
   * if the ball is theirs and they don't go get it, nobody else will in time,
   * and if they're covering a bag and don't show up, the throw goes past them.
   */
  private assignRoles(): void {
    const chaseTarget = this.ball.vz > 4 ? this.landingPoint : predictRest(this.ball);
    const candidates = this.fielders.filter((f) => !f.isUser);

    const sorted = [...candidates].sort(
      (a, b) => distance(a, chaseTarget) - distance(b, chaseTarget),
    );
    const userFielder = this.fielders.find((f) => f.isUser);
    const userIsNearest =
      !!userFielder &&
      distance(userFielder, chaseTarget) < distance(sorted[0] ?? { x: 999, y: 999 }, chaseTarget);

    // Back-up spot: 45 feet beyond the ball, away from home.
    const range = Math.hypot(chaseTarget.x, chaseTarget.y) || 1;
    const backup = {
      x: chaseTarget.x + (chaseTarget.x / range) * 45,
      y: chaseTarget.y + (chaseTarget.y / range) * 45,
    };

    // If the ball belongs to the user, no CPU fielder goes and gets it — the
    // nearest one only backs the play up. Letting them chase it directly would
    // mean standing still cost the player almost nothing.
    let chaser: FielderState | undefined;
    if (userIsNearest) {
      if (sorted[0]) {
        sorted[0].target = backup;
        sorted[0].role = 'backup';
      }
    } else {
      chaser = sorted[0];
      if (chaser) {
        chaser.target = chaseTarget;
        chaser.role = 'chase';
      }
      if (sorted[1]) {
        sorted[1].target = backup;
        sorted[1].role = 'backup';
      }
    }

    const busy = new Set<PositionId>(
      [chaser?.id, sorted[0]?.id].filter(Boolean) as PositionId[],
    );

    for (const base of [1, 2, 3, 0] as BaseId[]) {
      const cover = coveringPosition(base, chaser?.id ?? null);
      if (busy.has(cover)) continue;
      const fielder = this.fielders.find((f) => f.id === cover);
      if (!fielder || fielder.isUser) {
        // The user covers this bag. They have to get there themselves — and
        // an uncovered throw here is on them.
        if (fielder?.isUser) this.userCoverBases.add(base);
        busy.add(cover);
        continue;
      }
      fielder.coverBase = base;
      fielder.target = BASES[base];
      fielder.role = 'cover';
      busy.add(cover);
    }
  }

  /* ----------------------------------------------------------------- queries */

  get userFielder(): FielderState | null {
    return this.fielders.find((f) => f.isUser) ?? null;
  }

  get userRunner(): RunnerState | null {
    return this.runners.find((r) => r.isUser) ?? null;
  }

  get batter(): RunnerState {
    return this.runners[this.runners.length - 1];
  }

  get event(): string {
    return this.lastEvent;
  }

  /** True when the user is holding the ball and can pick a base to throw to. */
  get userHasBall(): boolean {
    return this.phase === 'held' && (this.userFielder?.hasBall ?? false);
  }

  runnerPosition(runner: RunnerState): Vec2 {
    if (runner.at >= 4) return BASES[0];
    const from = BASES[runner.at % 4];
    const to = BASES[(runner.at + 1) % 4];
    return {
      x: from.x + (to.x - from.x) * runner.progress,
      y: from.y + (to.y - from.y) * runner.progress,
    };
  }

  /* -------------------------------------------------------------------- input */

  /** Defense: throw the held ball to a base. */
  throwTo(base: BaseId): void {
    const fielder = this.userFielder;
    if (!fielder?.hasBall || this.phase !== 'held') return;
    this.releaseThrow(fielder, base);
  }

  /**
   * The base a GO command would commit the runner to. If they're already
   * running somewhere it's one past that; if they're stood on a bag it's the
   * next one up.
   */
  private goTargetFor(runner: RunnerState): number {
    // One base past wherever they're already committed. Deliberately NOT capped
    // by `roomAheadOf`: this drives the player's GO button, and taking a base
    // the man ahead is sitting on is allowed — pressing GO shoves him along too
    // (`makeRoomAhead`). The auto-read and `moveRunners` still respect the cap,
    // so nobody piles onto an occupied bag unless the player asks for it.
    return Math.min(4, this.committedBase(runner) + 1);
  }

  /** The base a runner is going to end up on if nothing changes. */
  private committedBase(runner: RunnerState): number {
    return runner.intent > runner.at ? runner.intent : runner.at;
  }

  /**
   * The runner directly in front of this one who is still on the bases.
   * Runners are stored lead-first and can't pass each other, so it's the
   * nearest earlier entry still in play.
   */
  private runnerAhead(runner: RunnerState): RunnerState | null {
    const index = this.runners.indexOf(runner);
    for (let i = index - 1; i >= 0; i--) {
      const ahead = this.runners[i];
      if (ahead.out || ahead.at >= 4) continue;
      return ahead;
    }
    return null;
  }

  /**
   * The furthest base this runner can be sent to without running into the man
   * ahead: one short of wherever he is committed to. Never less than the base
   * they already own, and never less than the one they're forced to take —
   * a forced runner's man ahead is forced too, so he will be moving.
   *
   * Without this the batter was allowed to run all the way up to a runner
   * standing on second and park next to him, so a clean single ended with two
   * men on the same bag.
   */
  private roomAheadOf(runner: RunnerState): number {
    // Everybody trots home on a homer; nobody is in anybody's way.
    if (this.homeRun) return 4;
    const ahead = this.runnerAhead(runner);
    if (!ahead) return 4;
    const room = this.committedBase(ahead) - 1;
    const owed = this.isForced(runner) ? runner.startBase + 1 : runner.startBase;
    return Math.max(room, runner.at, owed);
  }

  /**
   * Where a HOLD would stop them. Once you've left the bag you're committed to
   * reaching the next one — you can't stop in the dirt.
   */
  private holdTargetFor(runner: RunnerState): number {
    return runner.progress > 0 ? Math.min(4, runner.at + 1) : runner.at;
  }

  /** Base the GO button would send the user's runner to, or null if they can't. */
  get userGoTarget(): number | null {
    const runner = this.userRunner;
    if (!runner || runner.out || runner.at >= 4 || this.phase === 'dead') return null;
    const target = this.goTargetFor(runner);
    // Nothing to go for when the next bag is spoken for.
    return target > this.committedBase(runner) ? target : null;
  }

  /** Base the HOLD button would stop them at, or null if holding is meaningless. */
  get userHoldTarget(): number | null {
    const runner = this.userRunner;
    if (!runner || runner.out || runner.at >= 4 || this.phase === 'dead') return null;
    const hold = this.holdTargetFor(runner);
    // Nothing to hold if they're already only going that far.
    return runner.intent > hold ? hold : null;
  }

  /** The base the user's runner is currently committed to reaching. */
  get userRunnerTarget(): number | null {
    const runner = this.userRunner;
    if (!runner || runner.out || runner.at >= 4) return null;
    return runner.intent > runner.at ? runner.intent : runner.at;
  }

  /** True when a throw is on its way to the base the user is running into. */
  get throwBeatingUserRunner(): boolean {
    const runner = this.userRunner;
    if (!runner || this.throwTarget === null || runner.at >= 4) return false;
    return this.throwTarget === (runner.at + 1) % 4 && runner.intent > runner.at;
  }

  /** Offense: try for the next base. */
  advanceRunner(): void {
    const runner = this.userRunner;
    if (!runner || runner.out || runner.at >= 4) return;
    const target = this.goTargetFor(runner);
    if (target <= this.committedBase(runner)) return;
    // Clear the path first: any runner ahead sitting on the bag we're taking is
    // forced along, and his man too, on up the line. Without this the frame
    // loop's collision cap (`roomAheadOf`) would just snap our man back to the
    // base behind the traffic, and pressing GO would do nothing.
    this.makeRoomAhead(runner, target);
    runner.intent = target;
    runner.done = false;
    this.userIntentSet = true;
  }

  /**
   * Push everyone ahead of `runner` far enough forward that `target` is open.
   * A runner can't share a bag, so taking one the man ahead holds forces him to
   * the next — and if someone's on that one too, it cascades up to the plate.
   * Home takes any number of runners, so nothing needs clearing past it.
   */
  private makeRoomAhead(runner: RunnerState, target: number): void {
    const ahead = this.runnerAhead(runner);
    if (!ahead) return;
    const need = target + 1;
    if (need > 4 || this.committedBase(ahead) >= need) return;
    this.makeRoomAhead(ahead, need);
    ahead.intent = need;
    ahead.done = false;
  }

  /** Offense: pull up at the base you're heading for. */
  holdRunner(): void {
    const runner = this.userRunner;
    if (!runner || runner.out) return;
    runner.intent = this.holdTargetFor(runner);
    this.userIntentSet = true;
  }

  /** Defense: move the user's fielder. `dx`/`dy` is a unit-ish direction. */
  moveUserFielder(dx: number, dy: number, dt: number): void {
    const fielder = this.userFielder;
    if (!fielder || this.phase === 'dead') return;
    const magnitude = Math.hypot(dx, dy);
    if (magnitude < 0.05) return;
    const scale = (fielder.speed * Math.min(magnitude, 1) * dt) / magnitude;
    fielder.x += dx * scale;
    fielder.y += dy * scale;
    this.containFielder(fielder);
  }

  /* --------------------------------------------------------------------- loop */

  update(dt: number): void {
    if (this.phase === 'dead') return;
    // The whole play holds while the player is making a stretch catch.
    if (this.phase === 'catch') return;
    this.elapsed += dt;

    for (const fielder of this.fielders) {
      if (fielder.recovery > 0) fielder.recovery -= dt;
    }

    if (this.deadTimer > 0) {
      this.deadTimer -= dt;
      this.moveRunners(dt);
      if (this.deadTimer <= 0) this.finish();
      return;
    }

    if (this.phase === 'live') {
      stepBall(this.ball, dt);
      this.checkBoundaries();
    } else if (this.phase === 'throw') {
      this.stepThrow(dt);
    }

    this.moveFielders(dt);
    this.moveRunners(dt);

    if (this.phase === 'live') {
      this.checkFieldingContact();
      this.checkLooseBall(dt);
    } else if (this.phase === 'held') this.considerCpuThrow(dt);

    this.updateRunnerIntent();

    if (this.elapsed > PLAY_TIMEOUT) {
      this.finish();
      return;
    }
    this.checkPlayOver();
  }

  private checkBoundaries(): void {
    // Only the batted ball can be fair, foul, or a home run. Once a fielder has
    // touched it, an errant throw rolling into foul ground is just a bad throw.
    if (this.homeRun || this.foul || !this.battedBallLive) return;

    const spot = { x: this.ball.x, y: this.ball.y };
    if (isFair(spot) && magnitude(spot) > fenceAt(this.park, spot)) {
      if (this.ball.z > wallHeightAt(this.park, spot)) {
        this.homeRun = true;
        this.lastEvent = 'Gone!';
        for (const runner of this.runners) {
          runner.intent = 4;
          runner.done = false;
        }
        this.deadTimer = 2.4;
        return;
      }

      if (!this.hitWall) {
        // High enough to reach the wall but not to clear it. Play it off the
        // padding — this is what makes a tall wall turn homers into doubles.
        this.hitWall = true;
        this.lastEvent = 'Off the wall!';
        this.ball.bounced = true;
        const range = magnitude(spot) || 1;
        const speed = Math.hypot(this.ball.vx, this.ball.vy) * 0.42;
        this.ball.vx = (-spot.x / range) * speed;
        this.ball.vy = (-spot.y / range) * speed;
        this.ball.vz = Math.abs(this.ball.vz) * 0.25;
      }
      return;
    }

    if (this.ball.bounced && !isFair({ x: this.ball.x, y: this.ball.y })) {
      // A ball that first touches down in foul ground is a foul ball.
      this.foul = true;
      this.lastEvent = 'Foul ball.';
      this.deadTimer = 0.8;
    }
  }

  private moveFielders(dt: number): void {
    for (const fielder of this.fielders) {
      if (fielder.isUser || fielder.hasBall) continue;
      if (fielder.reaction > 0) {
        fielder.reaction -= dt;
        continue;
      }
      // Still scrambling after a muff.
      if (fielder.recovery > 0) continue;

      // Chasers re-aim as the play develops: camp under a fly ball, but lead a
      // rolling one slightly. Leading beats re-integrating the ball's whole
      // future path every frame, which is far too expensive on a phone.
      if (fielder.role === 'chase' && this.phase === 'live') {
        fielder.target = this.ball.bounced
          ? { x: this.ball.x + this.ball.vx * 0.45, y: this.ball.y + this.ball.vy * 0.45 }
          : this.landingPoint;
      }

      const target = fielder.target;
      if (!target) continue;

      const dx = target.x - fielder.x;
      const dy = target.y - fielder.y;
      const range = Math.hypot(dx, dy);
      if (range < 0.4) continue;
      const step = Math.min(range, fielder.speed * dt);
      fielder.x += (dx / range) * step;
      fielder.y += (dy / range) * step;
      this.containFielder(fielder);
    }
  }

  /**
   * Nobody runs through the wall. A ball hit out of the park is chased to the
   * warning track and no further — without this, outfielders tracked a home
   * run out into the parking lot and stood there fielding it.
   */
  private containFielder(fielder: FielderState): void {
    const spot = { x: fielder.x, y: fielder.y };
    const range = magnitude(spot);
    if (range < 1) return;
    const limit = fenceAt(this.park, spot) - WALL_MARGIN;
    if (range <= limit) return;
    const scale = limit / range;
    fielder.x = spot.x * scale;
    fielder.y = spot.y * scale;
  }

  /**
   * Runners are stored lead-first, so each one is fenced in by the man ahead
   * of him.
   *
   * Nothing used to stop a fast hitter running straight through a slower
   * team-mate: with a runner on first and the player pushing for an extra
   * base, the two ended up on the same bag on three quarters of plays. That is
   * what let a single throw retire both of them.
   */
  private moveRunners(dt: number): void {
    let ahead = Infinity;

    for (const runner of this.runners) {
      if (runner.out || runner.at >= 4) continue;

      // Nobody runs into an occupied bag. If the man ahead has pulled up, the
      // target is the base behind him — and a runner already past that base
      // turns round and goes back to it.
      const room = this.roomAheadOf(runner);
      if (runner.intent > room) runner.intent = room;

      if (runner.at >= runner.intent) {
        if (runner.progress > 0) {
          // Caught off the bag with nowhere to go: back to the one they left.
          runner.done = false;
          runner.progress -= (runner.speed * dt) / BASE_DISTANCE;
          if (runner.progress <= 0) {
            runner.progress = 0;
            runner.done = true;
          }
        } else {
          runner.done = true;
        }
      } else {
        runner.done = false;
        runner.progress += (runner.speed * dt) / BASE_DISTANCE;
        while (runner.progress >= 1) {
          runner.progress -= 1;
          runner.at += 1;
          if (runner.at >= runner.intent || runner.at >= 4) {
            runner.progress = 0;
            runner.done = true;
            break;
          }
        }
      }

      // Crossed the plate: off the field, so no longer in anybody's way.
      if (runner.at >= 4) {
        ahead = Infinity;
        continue;
      }

      const limit = ahead - RUNNER_GAP;
      const pos = runner.at + runner.progress;
      if (pos > limit) {
        const held = Math.max(0, limit);
        runner.at = Math.floor(held);
        runner.progress = held - runner.at;
        // Stuck behind somebody. They are not getting anywhere this play, so
        // the play must not sit waiting on them to arrive.
        runner.done = true;
      }
      ahead = runner.at + runner.progress;
    }
  }

  /**
   * CPU runners read the play as it develops, then commit. Intent is always
   * measured from the base they started on — measuring from their *current*
   * base would keep pushing the target ahead of them and they would circle the
   * bases forever.
   */
  private updateRunnerIntent(): void {
    if (this.homeRun || this.foul || this.intentsFrozen) return;

    if (this.caughtInAir) {
      // Everybody retreats on a catch; there are no tag-ups in this model.
      for (const runner of this.runners) {
        if (runner.isUser || runner.id === 'batter') continue;
        runner.intent = runner.startBase;
      }
      this.freezeIntents();
      return;
    }

    // Nothing is decided until the ball is down and through.
    if (!this.ball.bounced) return;

    this.ensurePlanned();

    // Once a fielder has it, the running decisions are made.
    if (!this.battedBallLive) this.freezeIntents();
  }

  /** Work out where the ball settles and make the runners' reads, once. */
  private ensurePlanned(): void {
    if (this.restPoint) return;
    // Where the ball ends up, not just where it first touched down. A grounder
    // that skips through the infield and rolls to the track is two bases for
    // everyone aboard; judging it on the landing point alone treated it as an
    // infield single and left runners stranded 90 feet short all game.
    this.restPoint = predictRest(this.ball);
    this.planRunnerIntents();
  }

  /**
   * Forced off their bag: every base behind them, back to the batter, is
   * occupied, so standing still surrenders the force. Only these runners owe
   * the defense a base — everyone else gets to choose.
   */
  private isForced(runner: RunnerState): boolean {
    if (runner.startBase === 0) return true;
    for (let base = 1; base < runner.startBase; base++) {
      if (!this.setup.runnersOn[base - 1]) return false;
    }
    return true;
  }

  /**
   * One read per play, made when the ball first touches down.
   *
   * Runners used to be handed a flat allotment — two bases if the ball
   * reached the outfield grass, one otherwise, forced or not. Since the
   * defense only throws when it wins the race, every one of those blind reads
   * was an out: the man on third broke for home on routine grounders, and the
   * man on second ran into a tag at third on balls hit right in front of him.
   *
   * Now each runner races the same clock the defense uses in
   * `bestThrowTarget`: nearest fielder to the ball, pickup, transfer, throw.
   * Forced runners take the base they owe; nobody takes another one without
   * beating the return throw by a margin.
   */
  private planRunnerIntents(): void {
    const rest = this.restPoint!;

    let nearest: FielderState | null = null;
    let nearestDist = Infinity;
    for (const fielder of this.fielders) {
      const d = distance(fielder, rest);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = fielder;
      }
    }
    const pickupTime = nearest ? nearestDist / nearest.speed : 1;
    const armSpeed = nearest ? this.armSpeedFor(nearest) : 130;

    // Judged on where it finishes as well as where it landed, so a grounder
    // that skips through and rolls to the corner counts as the gap ball it is.
    const stretched =
      Math.max(magnitude(this.landingPoint), magnitude(rest)) >= STRETCH_DISTANCE;

    for (const runner of this.runners) {
      if (runner.out || runner.at >= 4) continue;
      // The player's runner reads the ball exactly like a CPU one until they
      // say otherwise. Skipping them here meant their intent never left 1, so
      // a ball into the gap was still only ever a single unless they hit GO —
      // while every CPU hitter took the extra base for free.
      if (runner.isUser && this.userIntentSet) continue;

      // Ground they'd have covered while the ball was in the air. The batter
      // ran out of the box on contact; everyone else was off on the pitch.
      const lead = Math.min((this.elapsed * runner.speed) / BASE_DISTANCE, MAX_LEAD);
      const from = runner.at + runner.progress + lead;

      // The base they owe, then every further one they can win the race to.
      // Only set intent here. `done` belongs to moveRunners — clearing it
      // here too would keep the play permanently "in progress".
      let target = this.isForced(runner) ? runner.startBase + 1 : runner.startBase;
      // On a gap ball the batter runs the race for second without the cushion
      // every other read gets: it's a coin flip they're willing to take, and
      // with a lead runner aboard second isn't where the defense wants the
      // ball anyway. Everyone else is already 90 feet from the next bag and
      // wins outright on a ball hit this deep, so the race below covers them.
      // The player's runner doesn't take that gamble on their behalf — the GO
      // button is how they choose to. Watching your man take off for second
      // uninvited and get thrown out is a fair complaint.
      if (stretched && runner.startBase === 0 && !runner.isUser) {
        const runTime = ((2 - from) * BASE_DISTANCE) / runner.speed;
        const returnTime = pickupTime + TRANSFER_TIME + this.throwFlightTime(rest, 2, armSpeed);
        if (runTime <= returnTime) target = 2;
      }
      while (target < 4) {
        const next = target + 1;
        const runTime = ((next - from) * BASE_DISTANCE) / runner.speed;
        const returnTime =
          pickupTime +
          TRANSFER_TIME +
          this.throwFlightTime(rest, (next % 4) as BaseId, armSpeed);
        if (runTime + RUNNER_CAUTION > returnTime) break;
        target = next;
      }
      runner.intent = Math.min(4, target, this.roomAheadOf(runner));
      // Say so when the read sends the player's runner past first on its own,
      // so an extra base never looks like the game running them unasked. The
      // HOLD button is up the whole time.
      if (runner.isUser && runner.startBase === 0 && runner.intent > 1) {
        this.lastEvent = 'Waved on!';
      }
    }
  }

  /**
   * Stop re-evaluating runner intent. Anyone caught between bases is allowed to
   * finish reaching the next one rather than being stranded mid-path.
   */
  private freezeIntents(): void {
    this.intentsFrozen = true;
    for (const runner of this.runners) {
      if (runner.isUser || runner.out || runner.at >= 4) continue;
      if (runner.progress > 0 && runner.intent > runner.at) {
        runner.intent = Math.max(runner.intent, runner.at + 1);
      }
    }
  }

  /**
   * Decide whether a fielder gets to the ball, and how cleanly.
   *
   * A fly ball is judged the moment it drops to glove height — the hang time
   * was the player's chance to get under it. A ball on the ground is judged at
   * its closest approach, so running onto a grounder isn't scored as a stretch
   * just because the first frame in range was at the edge of it.
   */
  private checkFieldingContact(): void {
    if (this.foul || this.homeRun) return;

    const inAir = !this.ball.bounced;

    for (const fielder of this.fielders) {
      if (fielder.recovery > 0) continue;

      const reach = this.catchReachFor(fielder);
      const flat = Math.hypot(this.ball.x - fielder.x, this.ball.y - fielder.y);

      if (flat > reach) {
        fielder.minDist = Infinity;
        fielder.prevDist = flat;
        continue;
      }

      if (inAir) {
        if (this.ball.z > CATCH_REACH) continue;
        this.attemptCatch(fielder, flat / reach, true);
        return;
      }

      fielder.minDist = Math.min(fielder.minDist, flat);
      const receding = flat > fielder.prevDist + 0.02;
      fielder.prevDist = flat;

      const surelyOnIt = fielder.minDist <= reach * 0.3;
      if (!receding && !surelyOnIt && !this.ball.atRest) continue;

      this.attemptCatch(fielder, fielder.minDist / reach, false);
      return;
    }
  }

  /**
   * `ratio` is how far out on the glove the ball was, 0 = right at them,
   * 1 = the very edge of their range.
   */
  /**
   * How far out on the glove still counts as a routine catch.
   *
   * For the player this widens with Fielding. At the flat 0.55 the AI uses, a
   * rookie's glove window meant being within about four feet of the ball, and
   * the stretch-catch minigame fired on roughly three quarters of their
   * chances — it is meant to be a moment, not the default way you catch a
   * baseball.
   */
  private cleanRatioFor(fielder: FielderState): number {
    // A wet ball is a slippery ball: in the rain a few more chances become
    // stretch catches instead of routine ones.
    const slick = this.air.wet * 0.06;
    if (!fielder.isUser) return CLEAN_CATCH_RATIO - slick;
    // Capped: even a Gold Glove should still have to earn one occasionally,
    // otherwise the best fielders never see the minigame at all.
    return (
      Math.min(0.97, 0.9 + (clamp(this.setup.attributes.fielding, 1, 99) / 100) * 0.09) - slick
    );
  }

  private attemptCatch(fielder: FielderState, ratio: number, wasFly: boolean): void {
    const cleanLimit = this.cleanRatioFor(fielder);
    const clean = ratio <= cleanLimit;

    if (fielder.isUser) {
      if (clean) {
        this.completeCatch(fielder, wasFly);
        return;
      }
      // Out on the edge of their range: the player has to earn this one.
      this.phase = 'catch';
      this.pendingCatch = {
        fielderId: fielder.id,
        wasFly,
        difficulty: clamp((ratio - cleanLimit) / (1 - cleanLimit), 0, 1),
      };
      return;
    }

    // AI fielders muff one occasionally, more often the further they reach.
    // Kept low deliberately: professionals convert nearly everything they get
    // a glove on, and a few points here move league batting average a lot.
    const skill = clamp(this.setup.opponentRating, 10, 99) / 100;
    const errorChance =
      (clean
        ? 0.008 + (1 - skill) * 0.015
        : 0.028 + (1 - skill) * 0.06 + (ratio - cleanLimit) * 0.07) *
      // Wet ball, wet glove: a downpour roughly doubles the muff rate.
      (1 + this.air.wet);

    if (this.setup.rng.chance(errorChance)) this.dropBall(fielder, clean, wasFly);
    else this.completeCatch(fielder, wasFly);
  }

  /** The player has finished the stretch-catch minigame. */
  resolveCatchAttempt(success: boolean): void {
    const pending = this.pendingCatch;
    if (!pending || this.phase !== 'catch') return;
    this.pendingCatch = null;

    const fielder = this.fielders.find((f) => f.id === pending.fielderId);
    if (!fielder) {
      this.phase = 'live';
      return;
    }

    this.phase = 'live';
    if (success) this.completeCatch(fielder, pending.wasFly);
    // A ball you had to dive for and didn't hold isn't an error, it's a hit —
    // same as a real scorer would rule it.
    else this.dropBall(fielder, false, pending.wasFly);
  }

  private completeCatch(fielder: FielderState, wasFly: boolean): void {
    fielder.hasBall = true;
    this.ballCarrier = fielder.id;
    this.phase = 'held';
    this.battedBallLive = false;
    this.throwReaction = fielder.isUser ? 0 : TRANSFER_TIME;
    this.holdTimer = 0;

    if (wasFly) {
      this.caughtInAir = true;
      this.outsRecorded += 1;
      this.batter.out = true;
      this.outMethod = 'caught';
      if (fielder.isUser) this.userPutout = true;
      this.lastEvent = fielder.isUser ? 'You made the catch!' : `Caught by the ${fielder.id}.`;
      this.deadTimer = 1.4;
    } else {
      this.lastEvent = fielder.isUser ? 'You field it.' : `Fielded by the ${fielder.id}.`;
    }
  }

  /** The ball is dropped or gets past a fielder. It stays live on the ground. */
  private dropBall(fielder: FielderState, clean: boolean, wasFly: boolean): void {
    fielder.recovery = 0.75;
    fielder.role = 'chase';
    fielder.minDist = Infinity;
    fielder.prevDist = Infinity;

    // Touched, so it can no longer be a catch, a home run, or a foul ball.
    this.battedBallLive = false;
    this.ball.bounced = true;
    this.ball.x = fielder.x;
    this.ball.y = fielder.y;
    this.ball.z = 0;
    this.ball.atRest = false;

    const angle = this.setup.rng.range(0, Math.PI * 2);
    const speed = this.setup.rng.range(10, 24);
    this.ball.vx = Math.cos(angle) * speed;
    this.ball.vy = Math.sin(angle) * speed;
    this.ball.vz = 0;
    this.phase = 'live';

    if (clean) {
      this.errorOnPlay = true;
      if (fielder.isUser) this.userError = true;
      this.lastEvent = fielder.isUser ? 'You dropped it!' : `Muffed by the ${fielder.id}!`;
      // A misplay everyone can see: runners take off. Plan first so the
      // extra base is stacked on their normal read instead of being
      // overwritten by it on the next frame.
      this.ensurePlanned();
      for (const runner of this.runners) {
        if (runner.out || runner.at >= 4) continue;
        runner.intent = Math.min(4, runner.intent + 1);
      }
      this.intentsFrozen = false;
    } else {
      this.lastEvent = wasFly ? "Can't hang on to it!" : 'It scoots past!';
    }
  }

  private catchReachFor(fielder: FielderState): number {
    if (!fielder.isUser) return 4.6;
    // The user's glove window is their Fielding attribute, same idea as the
    // sweet spot on the bat. A rookie's seven feet meant a running fielder
    // almost always met the ball at the very edge of it, which is what turned
    // the stretch catch from a highlight into the normal way to catch a ball.
    return 6 + (clamp(this.setup.attributes.fielding, 1, 99) / 100) * 7;
  }

  private considerCpuThrow(dt: number): void {
    const carrier = this.fielders.find((f) => f.hasBall);
    if (!carrier) return;

    if (carrier.isUser) {
      // Dithering with the ball shouldn't stall the play forever.
      this.holdTimer += dt;
      if (this.holdTimer > HOLD_LIMIT) {
        const base = this.bestThrowTarget(carrier) ?? 1;
        this.lastEvent = 'You fire it in.';
        this.sendBallToBase(carrier, base);
      }
      return;
    }

    this.throwReaction -= dt;
    if (this.throwReaction > 0) return;

    const base = this.bestThrowTarget(carrier);
    if (base !== null) {
      this.sendBallToBase(carrier, base);
      return;
    }

    // No play on. A fielder with no throw used to just stand there holding it,
    // which is how a runner could keep tapping GO and jog all the way round:
    // nobody ever put the ball back where it could hurt him. Get it in to the
    // bag in front of the lead runner.
    this.holdTimer += dt;
    if (this.holdTimer < THROW_IN_DELAY) return;

    const target = this.throwInTarget(carrier);
    if (target === null) return;
    // Already standing on that bag: hold it and let the play die out rather
    // than throwing to ourselves every time the timer comes round.
    if (distance(carrier, BASES[target]) <= RECEIVE_RADIUS) return;

    this.lastEvent = `${carrier.id} throws it back in.`;
    this.sendBallToBase(carrier, target);
  }

  /**
   * Where a fielder with nothing to play for should return the ball: the bag
   * ahead of the furthest runner, so taking another base means running into a
   * waiting glove rather than into open space.
   */
  private throwInTarget(carrier: FielderState): BaseId | null {
    // The runner worth getting in front of is the furthest one still moving.
    // A man parked on second isn't going anywhere, and firing the ball to
    // third with the batter still legging it to first looked, as one tester
    // put it, like the AI throwing to a base with nobody on it. Fall back to
    // the lead runner only if nobody is moving.
    let lead = -1;
    let parked = 0;
    for (const runner of this.runners) {
      if (runner.out || runner.at >= 4) continue;
      if (!runner.done && runner.at > lead) lead = runner.at;
      if (runner.at > parked) parked = runner.at;
    }
    if (lead < 0) lead = parked;
    // The bag in front of that runner, then whatever else is manned. Home
    // is not a throw-in target — with nothing to play for you get it to an
    // infielder, you don't fire it at the catcher.
    const preferred = clamp(lead + 1, 1, 3) as BaseId;
    for (const base of [preferred, 2, 1, 3] as BaseId[]) {
      if (this.hasCover(base, carrier)) return base;
    }
    return null;
  }

  /**
   * Either step on the bag or throw to it. Without the first case, a fielder
   * already standing on the base would throw to himself, catch his own throw,
   * and repeat until the play timed out.
   */
  private sendBallToBase(fielder: FielderState, base: BaseId): void {
    if (distance(fielder, BASES[base]) <= RECEIVE_RADIUS) {
      this.resolveForceAt(base, fielder);
      return;
    }
    this.releaseThrow(fielder, base);
  }

  /**
   * Is anybody there to take a throw at that bag?
   *
   * A fielder who throws to an unmanned base watches it skip into the outfield
   * and every runner take another base. Real ones look first, and the AI now
   * does too — the player can still throw wherever they like, which is what
   * makes covering the bag their job.
   */
  private hasCover(base: BaseId, thrower: FielderState): boolean {
    return this.fielders.some(
      (f) =>
        f !== thrower &&
        !f.hasBall &&
        f.recovery <= 0 &&
        (f.coverBase === base || distance(f, BASES[base]) <= RECEIVE_RADIUS),
    );
  }

  /** Throw velocity in ft/s for whoever is holding it. */
  private armSpeedFor(fielder: FielderState): number {
    const arm = fielder.isUser
      ? clamp(this.setup.attributes.arm, 1, 99)
      : clamp(this.setup.opponentRating, 10, 99);
    return (68 + (arm / 100) * 32) * 1.4667;
  }

  /**
   * How long a throw to a bag takes.
   *
   * Long ones go through a cut-off man. A flat velocity over any distance made
   * outfield arms superhuman — a throw from the warning track beat a runner
   * home every time, which is why the AI had to be stopped from trying it.
   * Charging for the relay lets plays at the plate exist without every one of
   * them being an out.
   */
  private throwFlightTime(from: Vec2, base: BaseId, speed: number): number {
    const range = distance(from, BASES[base]);
    const relays = Math.floor(range / RELAY_DISTANCE);
    return range / speed + relays * RELAY_HANDLING;
  }

  /**
   * The lead base where the throw would actually beat the runner. Fielders
   * only make throws they can win — without this check an outfielder would
   * gun down the batter at first base on a clean single, because the ball
   * travels far faster than a runner and nothing stopped them trying.
   */
  private bestThrowTarget(carrier: FielderState): BaseId | null {
    const throwSpeed = this.armSpeedFor(carrier);

    let best: BaseId | null = null;
    let bestLead = -1;

    for (const runner of this.runners) {
      if (runner.out || runner.at >= 4) continue;
      // A runner standing on a base can't be forced off it, and one heading
      // back to the bag he left isn't forced at the next one.
      if (runner.progress <= 0 && runner.done) continue;
      if (runner.intent <= runner.at) continue;

      // How far up the line they are, 1..4, where 4 is the plate. The bag id
      // wraps home round to 0, so the two are tracked apart — ranking on raw
      // base ids would make a play at the plate look like the least valuable
      // one available. Without this a runner who reached third could not be
      // retired at all, and simply jogged in.
      const reach = runner.at + 1;
      const target = (reach % 4) as BaseId;
      if (!this.hasCover(target, carrier)) continue;
      const runnerTime = ((1 - runner.progress) * BASE_DISTANCE) / runner.speed;
      const throwTime = TRANSFER_TIME + this.throwFlightTime(carrier, target, throwSpeed);

      if (throwTime < runnerTime && reach > bestLead) {
        bestLead = reach;
        best = target;
      }
    }
    return best;
  }

  /**
   * Throws travel a guaranteed arc from fielder to bag rather than being
   * integrated as projectiles. A real ballistic throw from deep in the
   * outfield lands well short of the base, which left the play stuck waiting
   * for a ball that was never going to arrive.
   */
  private releaseThrow(fielder: FielderState, base: BaseId): void {
    const speed = this.armSpeedFor(fielder);

    fielder.hasBall = false;
    this.ballCarrier = null;
    this.throwTarget = base;
    this.phase = 'throw';
    this.throwByUser = fielder.isUser;
    if (fielder.isUser) this.userPutoutPending = true;

    this.throwFrom = { x: fielder.x, y: fielder.y };
    this.throwRange = distance(this.throwFrom, BASES[base]);
    // Same cost model the AI decided on, so a throw takes as long as it
    // predicted rather than arriving early and retiring someone unfairly.
    this.throwDuration = Math.max(0.18, this.throwFlightTime(this.throwFrom, base, speed));
    this.throwElapsed = 0;

    this.ball.x = fielder.x;
    this.ball.y = fielder.y;
    this.ball.z = 5;
    this.ball.atRest = false;
  }

  private stepThrow(dt: number): void {
    const base = this.throwTarget;
    const from = this.throwFrom;
    if (base === null || !from) return;

    this.throwElapsed += dt;
    const t = Math.min(1, this.throwElapsed / this.throwDuration);
    const target = BASES[base];

    this.ball.x = from.x + (target.x - from.x) * t;
    this.ball.y = from.y + (target.y - from.y) * t;
    this.ball.z = 5 + Math.sin(Math.PI * t) * Math.min(this.throwRange * 0.1, 16);

    if (t < 1) return;

    // Somebody has to actually be on the bag to take the throw.
    const receiver = this.fielders.find(
      (f) => distance(f, target) <= RECEIVE_RADIUS && !f.hasBall,
    );

    this.throwTarget = null;
    this.throwFrom = null;

    if (!receiver) {
      // Only the player's own miss counts: they made the throw, or the bag was
      // theirs to cover and they never got there. This used to fire for every
      // uncovered throw, so a CPU-to-CPU throw was charged to the player — and
      // on offense it charged an error to a man running the bases.
      if (this.throwByUser || this.userCoverBases.has(base)) this.userError = true;
      this.userPutoutPending = false;
      this.lastEvent = 'Nobody covering — the throw gets away!';
      for (const runner of this.runners) {
        if (runner.out || runner.at >= 4) continue;
        runner.intent = Math.min(4, runner.at + 1);
      }
      // Let it skip past the bag so somebody has to run it down.
      const dx = target.x - from.x;
      const dy = target.y - from.y;
      const range = Math.hypot(dx, dy) || 1;
      this.ball.z = 0;
      this.ball.vx = (dx / range) * 45;
      this.ball.vy = (dy / range) * 45;
      this.ball.vz = 0;
      this.ball.bounced = true;
      this.ball.atRest = false;
      this.phase = 'live';
      this.reassignChaser();
      return;
    }

    this.ball.x = target.x;
    this.ball.y = target.y;
    this.ball.z = 3;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.vz = 0;
    this.ball.atRest = true;

    this.resolveForceAt(base, receiver);
  }

  /** A fielder has the ball at `base`. Anyone forced there and short is out. */
  private resolveForceAt(base: BaseId, receiver: FielderState): void {
    receiver.hasBall = true;
    this.ballCarrier = receiver.id;
    this.phase = 'held';
    this.throwReaction = receiver.isUser ? 0 : TRANSFER_TIME;
    this.holdTimer = 0;

    // One bag, one out.
    //
    // This used to retire *every* runner whose next base matched, so a throw
    // that forced the lead runner also rang up the batter jogging up behind
    // him — two outs on one tag, and the hitter was one of them. It also
    // retired runners standing on a bag with nobody forcing them off it.
    //
    // `at + 1` is the bag a runner is forced into, wrapped so a man coming
    // from third is forced at home rather than at a base that can never match.
    let victim: RunnerState | null = null;
    for (const runner of this.runners) {
      if (runner.out || runner.at >= 4) continue;
      // Parked on a bag: you can only be forced off one you have to leave.
      // Same for a runner scrambling back to the one he came from.
      if (runner.progress <= 0 && runner.done) continue;
      if (runner.intent <= runner.at) continue;
      if ((runner.at + 1) % 4 !== base) continue;
      // Whoever is closest to the bag is the one the force is against.
      if (!victim || runner.progress > victim.progress) victim = runner;
    }

    if (victim) {
      victim.out = true;
      this.outsRecorded += 1;
      if (victim.id === 'batter') this.outMethod = 'thrown';
      if (receiver.isUser || this.userPutoutPending) this.userPutout = true;
      this.lastEvent =
        receiver.isUser || this.userPutoutPending ? 'Got him!' : 'Out on the play!';
      this.deadTimer = 1.2;
    } else {
      this.lastEvent = 'Safe!';
    }
    this.userPutoutPending = false;
  }

  /**
   * When the ball belongs to the user, nobody else goes for it — but if the
   * user doesn't come get it, the backup eventually reads that and comes in.
   * The delay is the player's window: miss it and the runner banks a base.
   */
  private checkLooseBall(dt: number): void {
    if (!this.ball.bounced || this.ballCarrier) return;
    if (this.fielders.some((f) => f.role === 'chase' && !f.isUser)) {
      this.looseTimer = 0;
      return;
    }
    this.looseTimer += dt;
    if (this.looseTimer > 1.1) {
      this.looseTimer = 0;
      this.reassignChaser();
    }
  }

  /**
   * Send somebody after a loose ball. Without this, a throw that gets past an
   * unattended bag would sit in the outfield until the play timed out.
   */
  private reassignChaser(): void {
    const loose = predictRest(this.ball);
    let best: FielderState | null = null;
    let bestRange = Infinity;
    for (const fielder of this.fielders) {
      if (fielder.isUser || fielder.hasBall) continue;
      const range = distance(fielder, loose);
      if (range < bestRange) {
        bestRange = range;
        best = fielder;
      }
    }
    if (best) {
      best.coverBase = null;
      best.target = loose;
      best.role = 'chase';
    }
  }

  private checkPlayOver(): void {
    if (this.deadTimer > 0) return;
    if (this.foul || this.homeRun) return;

    const running = this.runners.some((r) => !r.out && r.at < 4 && !r.done);
    const defenseHasBall = this.phase === 'held';

    if (!running && defenseHasBall) {
      this.deadTimer = 0.5;
      return;
    }

    // Ball dead in the outfield with nobody able to get it (rare, but keeps
    // the play from hanging).
    if (this.ball.atRest && this.phase === 'live' && !running) {
      this.deadTimer = 0.5;
    }
  }

  /* ------------------------------------------------------------------ result */

  private finish(): void {
    if (this.phase === 'dead') return;
    this.phase = 'dead';

    const batter = this.batter;
    // On a home run everyone scores by rule; we don't make them jog 360 feet
    // of basepath before the play is allowed to end.
    const runs = this.homeRun
      ? this.runners.filter((r) => !r.out).length
      : this.runners.filter((r) => !r.out && r.at >= 4).length;
    const batterBase = batter.out ? 0 : Math.min(4, batter.at);

    let kind: PlayOutcome['kind'];
    if (this.foul) kind = 'foul';
    else if (this.homeRun) kind = 'homeRun';
    else if (batter.out) kind = 'out';
    else if (batterBase >= 3) kind = batterBase >= 4 ? 'homeRun' : 'triple';
    else if (batterBase === 2) kind = 'double';
    else if (batterBase === 1) kind = 'single';
    else kind = 'out';

    const basesAfter = [false, false, false];
    if (!this.homeRun && !this.foul) {
      for (const runner of this.runners) {
        if (runner.out || runner.at < 1 || runner.at > 3) continue;
        basesAfter[runner.at - 1] = true;
      }
    } else if (this.foul) {
      // Nothing moves on a foul ball.
      for (let base = 0; base < 3; base++) basesAfter[base] = this.setup.runnersOn[base];
    }

    this.outcome = {
      kind,
      outs: this.outsRecorded,
      runs: this.homeRun ? Math.max(runs, 1) : runs,
      batterBase: this.homeRun ? 4 : batterBase,
      basesAfter,
      description: this.describe(kind),
      userPutout: this.userPutout,
      userError: this.userError,
      reachedOnError: this.errorOnPlay && !batter.out && batterBase >= 1,
    };
  }

  private describe(kind: PlayOutcome['kind']): string {
    if (this.errorOnPlay && kind !== 'out' && kind !== 'foul' && kind !== 'homeRun') {
      return 'Reaches on the error.';
    }
    const spray = this.setup.battedBall.spray;
    const pulled = this.setup.bats === 'L' ? -spray : spray;
    const field = pulled < -0.33 ? 'left' : pulled > 0.33 ? 'right' : 'center';
    const deep = isOutfield(this.landingPoint);

    switch (kind) {
      case 'foul':
        return 'Fouled off.';
      case 'homeRun':
        return `Deep to ${field} — it's gone!`;
      case 'triple':
        return `Into the ${field}-field gap. Triple!`;
      case 'double':
        return `Off the bat to ${field}. Double!`;
      case 'single':
        return deep ? `Base hit to ${field}.` : `Finds a hole on the ${field} side. Base hit.`;
      default:
        if (this.caughtInAir) {
          return deep ? `Fly ball to ${field}. Caught.` : `Popped up. Caught.`;
        }
        return `Thrown out on the play.`;
    }
  }
}
