import type { Vec2 } from './fieldGeometry';
import type { AirConditions } from './weather';
import { STILL_AIR } from './weather';

/**
 * Batted-ball flight. Quadratic drag matters enormously for a baseball — a
 * drag-free 100 mph ball at 28 degrees would carry 550 feet, so without it
 * every fly ball leaves the park.
 */

export const GRAVITY = 32.174;

/**
 * Aerodynamic constants, exposed as a mutable object so `tools/flight.ts` can
 * sweep them against real batted-ball distances rather than being hand-guessed.
 *
 * These are *fitted*, not derived — see `tools/fitFlight.ts`, which grid
 * searches them against real carry distances. Weighted RMSE is about 23 ft,
 * and inside the barrel range that decides home runs (80-105 mph, 20-40
 * degrees) the model lands within roughly 10 ft.
 *
 * `drag` is the standard quadratic term: acceleration = drag * speed^2. The
 * textbook value for a baseball is near 0.0019; the fit wants heavier air than
 * that because a single lift term and an Euler integrator are a coarse stand-in
 * for real aerodynamics.
 *
 * `lift` is Magnus force from backspin, and it is the reason a barrel carries.
 * It acts perpendicular to the flight path, so on a line drive it points almost
 * straight up and adds distance, while on a towering popup it points backwards
 * against the flight and kills it.
 */
export const FLIGHT = {
  drag: 0.0026,
  lift: 0.09,
  /** Backspin decays as launch angle climbs past this, per degree. */
  spinFalloffStart: 28,
  spinFalloffRate: 0.075,
  /** Extra backspin per mph of exit velocity above 90. Harder contact spins more. */
  evSpin: 0.09,
  /**
   * Magnus force from sidespin, per unit of `sideSpin`. Acts sideways,
   * perpendicular to the flight path, so a ball caught on its edge visibly
   * hooks or slices. Not fitted against data like `lift` — it's tuned so a
   * full-rim tap bends a fly ball roughly 60-70 ft over its flight, enough to
   * carry a ball down the line into foul ground, while a tap in the middle
   * third of the ball barely bends at all.
   */
  sideLift: 0.09,
};

/**
 * Backspin on a batted ball, as a multiplier on lift.
 *
 * Two things drive it. Harder contact imparts more spin, which is why a
 * 103 mph barrel carries disproportionately further than a 95 mph one. And
 * useful backspin falls away as launch angle climbs — a ball struck well under
 * center goes up with far less carrying spin than one squared up at 25
 * degrees, which is what makes a popup die shallow instead of floating.
 */
function spinForBattedBall(exitVelocity: number, launchAngle: number, base: number): number {
  const fromVelocity = 1 + (exitVelocity - 90) * FLIGHT.evSpin;
  const falloff =
    1.05 - Math.max(0, launchAngle - FLIGHT.spinFalloffStart) * FLIGHT.spinFalloffRate;
  return base * clampRange(fromVelocity, 0.25, 2.2) * clampRange(falloff, 0.1, 1.05);
}

const clampRange = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

/**
 * How far past the foul lines the spray range reaches. A spray magnitude above
 * 1 / this value lands in foul ground.
 */
export const FOUL_ANGLE_SCALE = 1.35;

/** Energy kept on a bounce, and the speed lost to the turf when it lands. */
const BOUNCE_RESTITUTION = 0.3;
const BOUNCE_FRICTION = 0.56;
/** Rolling deceleration on grass, ft/s^2. */
const ROLL_FRICTION = 26;
/** How much a soaked field (wet = 1) adds to rolling friction, as a fraction. */
const WET_ROLL_PENALTY = 0.9;
/** How much a soaked field takes off the bounce, and off the speed kept through it. */
const WET_BOUNCE_PENALTY = 0.5;
const WET_SKID_PENALTY = 0.25;
/** Height, in feet, by which the ball feels the full wind. Nothing blows at grass level. */
const WIND_EXPOSURE_HEIGHT = 6;
/**
 * How much of the wind the ball actually feels. The fitted `drag` is heavier
 * than real air, so a raw wind vector shoves the ball around far too much —
 * unscaled, 10 mph out added 70 ft to a fly ball. Real batted-ball data puts
 * it near 3-4 ft per mph, and this lands there: about 30 ft for 10 mph out,
 * with a 25 mph storm blowing in taking roughly 90 ft off a home-run swing.
 */
const WIND_GRIP = 0.42;

export interface BallPhysics {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Backspin, as a multiplier on lift. 1 is a normally struck ball. */
  spin: number;
  /** Sidespin, -1..1. Negative curves toward -x (left field), positive right. */
  sideSpin: number;
  /** Once true, the ball can no longer be caught for an out. */
  bounced: boolean;
  atRest: boolean;
  /**
   * The air it flies through. Wind and rain live on the ball rather than as a
   * step parameter so a probe copy inherits them for free.
   */
  air: AirConditions;
}

export function launchBall(
  exitVelocity: number,
  launchAngle: number,
  spray: number,
  spin = 1,
  sideSpin = 0,
  air: AirConditions = STILL_AIR,
): BallPhysics {
  const speed = exitVelocity * 1.4667; // mph -> ft/s
  const elevation = (launchAngle * Math.PI) / 180;
  // spray -1 pulls to left field (-x), +1 to right. The scale overshoots the
  // 45-degree foul lines so that a spray beyond about 0.74 is genuinely foul —
  // without it nothing could ever be hit out of play.
  const bearing = spray * (Math.PI / 4) * FOUL_ANGLE_SCALE;
  const horizontal = speed * Math.cos(elevation);

  return {
    x: 0,
    y: 0,
    z: 3,
    vx: horizontal * Math.sin(bearing),
    vy: horizontal * Math.cos(bearing),
    vz: speed * Math.sin(elevation),
    spin: spinForBattedBall(exitVelocity, launchAngle, spin),
    sideSpin,
    bounced: false,
    atRest: false,
    air,
  };
}

export function stepBall(ball: BallPhysics, dt: number): void {
  if (ball.atRest) return;

  // Airborne while it has height OR real vertical motion. Checking only height
  // would treat a ball still falling hard at knee level as already rolling,
  // and it would never pay the friction of actually landing.
  if (ball.z > 0.08 || Math.abs(ball.vz) > 0.6) {
    const air = ball.air;
    // Drag works against the air, not the ground. With the wind at its back
    // the ball feels a gentler headwind and keeps its speed; into it, the ball
    // gets shoved back. The wind fades out near the turf, so a grounder or a
    // ball on its last hop isn't pushed around.
    const exposure = Math.min(1, ball.z / WIND_EXPOSURE_HEIGHT) * WIND_GRIP;
    const relX = ball.vx - air.windX * exposure;
    const relY = ball.vy - air.windY * exposure;
    const relSpeed = Math.hypot(relX, relY, ball.vz) || 0.001;
    const decay = FLIGHT.drag * air.density * relSpeed;
    ball.vx -= relX * decay * dt;
    ball.vy -= relY * decay * dt;
    ball.vz -= (ball.vz * decay + GRAVITY) * dt;

    const speed = Math.hypot(ball.vx, ball.vy, ball.vz) || 0.001;
    if (ball.spin > 0) {
      // Lift acts perpendicular to the flight path, in the vertical plane.
      const horizontal = Math.hypot(ball.vx, ball.vy) || 0.001;
      const accel = FLIGHT.lift * speed * ball.spin * air.liftScale;
      const ux = ball.vx / horizontal;
      const uy = ball.vy / horizontal;
      ball.vx += accel * (-(ball.vz / speed) * ux) * dt;
      ball.vy += accel * (-(ball.vz / speed) * uy) * dt;
      ball.vz += accel * (horizontal / speed) * dt;
    }

    if (ball.sideSpin !== 0) {
      // Sidespin bends the ball sideways: perpendicular to its heading, in the
      // horizontal plane. Positive sideSpin pushes toward +x, so a ball flying
      // to centre (heading +y) with positive spin drifts toward right field.
      const horizontal = Math.hypot(ball.vx, ball.vy) || 0.001;
      const accel = FLIGHT.sideLift * speed * ball.sideSpin * air.liftScale;
      const ux = ball.vx / horizontal;
      const uy = ball.vy / horizontal;
      ball.vx += accel * uy * dt;
      ball.vy += accel * -ux * dt;
    }
  } else {
    // On the ground: roll and slow down.
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed < 1.2) {
      ball.vx = 0;
      ball.vy = 0;
      ball.vz = 0;
      ball.z = 0;
      ball.atRest = true;
      return;
    }
    // Wet grass grabs the ball: a soaked outfield nearly doubles the drag on a
    // roller, so what runs to the wall on a dry day pulls up in the gap.
    const friction = ROLL_FRICTION * (1 + ball.air.wet * WET_ROLL_PENALTY);
    const drop = Math.min(speed, friction * dt);
    ball.vx -= (ball.vx / speed) * drop;
    ball.vy -= (ball.vy / speed) * drop;
    ball.vz = 0;
    ball.z = 0;
  }

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;

  if (ball.z <= 0) {
    ball.z = 0;
    ball.bounced = true;
    if (ball.vz < -2) {
      // A wet ball on wet turf sits down instead of skipping.
      const wet = ball.air.wet;
      ball.vz = -ball.vz * BOUNCE_RESTITUTION * (1 - wet * WET_BOUNCE_PENALTY);
      ball.vx *= BOUNCE_FRICTION * (1 - wet * WET_SKID_PENALTY);
      ball.vy *= BOUNCE_FRICTION * (1 - wet * WET_SKID_PENALTY);
    } else {
      ball.vz = 0;
    }
  }
}

export interface LandingPrediction {
  point: Vec2;
  /** Seconds until it first touches the ground. */
  hangTime: number;
  /** Carry distance from home plate, in feet. */
  distance: number;
  /** Peak height, in feet. */
  apex: number;
}

/**
 * Integrate a copy of the ball forward to find where and when it lands. Used
 * for the landing marker the fielder camps under, and for fielder pursuit.
 */
export function predictLanding(ball: BallPhysics): LandingPrediction {
  const probe: BallPhysics = { ...ball };
  const dt = 1 / 120;
  let time = 0;
  let apex = probe.z;

  while (!probe.atRest && time < 12) {
    stepBall(probe, dt);
    time += dt;
    if (probe.z > apex) apex = probe.z;
    if (probe.bounced) break;
  }

  const point = { x: probe.x, y: probe.y };
  return { point, hangTime: time, distance: Math.hypot(point.x, point.y), apex };
}

/** Where the ball finally comes to rest, so fielders can chase a rolling ball. */
export function predictRest(ball: BallPhysics): Vec2 {
  const probe: BallPhysics = { ...ball };
  const dt = 1 / 120;
  let time = 0;
  while (!probe.atRest && time < 15) {
    stepBall(probe, dt);
    time += dt;
  }
  return { x: probe.x, y: probe.y };
}
