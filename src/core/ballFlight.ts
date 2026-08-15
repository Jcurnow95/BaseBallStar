import type { Vec2 } from './fieldGeometry';

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

export interface BallPhysics {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Backspin, as a multiplier on lift. 1 is a normally struck ball. */
  spin: number;
  /** Once true, the ball can no longer be caught for an out. */
  bounced: boolean;
  atRest: boolean;
}

export function launchBall(
  exitVelocity: number,
  launchAngle: number,
  spray: number,
  spin = 1,
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
    bounced: false,
    atRest: false,
  };
}

export function stepBall(ball: BallPhysics, dt: number): void {
  if (ball.atRest) return;

  // Airborne while it has height OR real vertical motion. Checking only height
  // would treat a ball still falling hard at knee level as already rolling,
  // and it would never pay the friction of actually landing.
  if (ball.z > 0.08 || Math.abs(ball.vz) > 0.6) {
    const speed = Math.hypot(ball.vx, ball.vy, ball.vz) || 0.001;
    const decay = FLIGHT.drag * speed;
    ball.vx -= ball.vx * decay * dt;
    ball.vy -= ball.vy * decay * dt;
    ball.vz -= (ball.vz * decay + GRAVITY) * dt;

    if (ball.spin > 0) {
      // Lift acts perpendicular to the flight path, in the vertical plane.
      const horizontal = Math.hypot(ball.vx, ball.vy) || 0.001;
      const accel = FLIGHT.lift * speed * ball.spin;
      const ux = ball.vx / horizontal;
      const uy = ball.vy / horizontal;
      ball.vx += accel * (-(ball.vz / speed) * ux) * dt;
      ball.vy += accel * (-(ball.vz / speed) * uy) * dt;
      ball.vz += accel * (horizontal / speed) * dt;
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
    const drop = Math.min(speed, ROLL_FRICTION * dt);
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
      ball.vz = -ball.vz * BOUNCE_RESTITUTION;
      ball.vx *= BOUNCE_FRICTION;
      ball.vy *= BOUNCE_FRICTION;
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
