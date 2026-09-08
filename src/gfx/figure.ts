import type { Uniform } from '../core/uniforms';
import { alpha, mix, scale } from './palette';

/**
 * Ballplayers, drawn from parts.
 *
 * Two families share one look — round head, cap with a brim, jersey over
 * pants, round-capped limbs with a dark edge so they stay legible over grass:
 *
 *  - `drawFieldFigure`: the little upright players on the tilted field. They
 *    face where they're going (front, back or either side) and their legs turn
 *    over in proportion to how fast they're really moving.
 *  - `drawPitcher` / `drawBatter`: the big figures in the at-bat scene, posed
 *    from keyframed skeletons so the delivery and the swing read as real
 *    motion rather than a lever flipping.
 */

const DEFAULT_SKIN = '#d9a37a';
const GLOVE = '#7a4a26';
const GLOVE_DARK = '#59331a';
const BAT_HANDLE = '#6e5238';
const BAT_BARREL = '#d5a56a';
const BAT_BARREL_LIGHT = '#e8c08a';
const EDGE = 'rgba(0,0,0,0.38)';

/* ================================================================ animation */

export interface FigureAnim {
  x: number;
  y: number;
  /** Run-cycle position, radians. */
  phase: number;
  /** Screen-space direction the figure faces, radians. */
  facing: number;
  /** 0 standing, 1 flat out. */
  effort: number;
}

export function createAnim(x: number, y: number, facing = Math.PI / 2): FigureAnim {
  return { x, y, phase: 0, facing, effort: 0 };
}

/**
 * Advance a figure's animation from where it actually moved on screen. Feet
 * turn over in proportion to real speed, so a sprinting fielder churns and a
 * standing one doesn't.
 */
export function updateAnim(anim: FigureAnim, x: number, y: number, dt: number, pixelsPerStride = 16): void {
  const dx = x - anim.x;
  const dy = y - anim.y;
  const moved = Math.hypot(dx, dy);
  anim.x = x;
  anim.y = y;

  if (dt > 0) {
    const target = Math.min(moved / dt / 70, 1);
    anim.effort += (target - anim.effort) * Math.min(1, dt * 9);
  }
  if (moved > 0.35) {
    anim.facing = Math.atan2(dy, dx);
    anim.phase += (moved / pixelsPerStride) * Math.PI;
  } else {
    anim.phase += dt * 2.2;
    anim.effort *= Math.max(0, 1 - dt * 6);
  }
}

type View = 'front' | 'back' | 'left' | 'right';

function viewFor(facing: number): View {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  if (Math.abs(c) > 0.55) return c > 0 ? 'right' : 'left';
  // Screen y grows downward: facing "down" is toward the camera.
  return s > 0 ? 'front' : 'back';
}

/* ============================================================ field figures */

export interface FieldFigureOptions {
  height: number;
  kit: Uniform;
  anim: FigureAnim;
  skin?: string;
  /** Gold ring under the feet: the one you control. */
  highlight?: boolean;
  /** Fielder's glove on the lead hand. */
  glove?: boolean;
  /** Batting helmet instead of a cap. */
  helmet?: boolean;
  /** Ball held up in the throwing hand. */
  holdingBall?: boolean;
  /** Alpha of the ground shadow. */
  shadow?: number;
  /** Squad number on the back. */
  number?: string;
}

/** A small upright player, feet at (x, y). */
export function drawFieldFigure(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  o: FieldFigureOptions,
): void {
  const h = o.height;
  const kit = o.kit;
  const skin = o.skin ?? DEFAULT_SKIN;
  const view = viewFor(o.anim.facing);
  const effort = Math.max(0.12, o.anim.effort);
  const swing = Math.sin(o.anim.phase) * effort;
  const bob = Math.abs(Math.sin(o.anim.phase)) * o.anim.effort * h * 0.035;
  const dir = view === 'left' ? -1 : 1;
  const side = view === 'left' || view === 'right';

  const headR = h * 0.155;
  const hipY = y - h * 0.31 - bob;
  const shoulderY = y - h * 0.6 - bob;
  const legW = Math.max(2.5, h * 0.105);
  const armW = Math.max(2, h * 0.08);
  const lean = side ? dir * o.anim.effort * h * 0.06 : 0;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Ground shadow and the control ring.
  ctx.fillStyle = alpha('#000000', o.shadow ?? 0.25);
  ctx.beginPath();
  ctx.ellipse(x, y + h * 0.02, h * 0.24, h * 0.085, 0, 0, Math.PI * 2);
  ctx.fill();
  if (o.highlight) {
    ctx.strokeStyle = 'rgba(255,209,102,0.95)';
    ctx.lineWidth = 2.5;
    ctx.fillStyle = 'rgba(255,209,102,0.16)';
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.03, h * 0.38, h * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  const limb = (x0: number, y0: number, x1: number, y1: number, w: number, colour: string, kx = 0, ky = 0) => {
    const mx = (x0 + x1) / 2 + kx;
    const my = (y0 + y1) / 2 + ky;
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = w + 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx, my, x1, y1);
    ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx, my, x1, y1);
    ctx.stroke();
  };

  // ---- Legs.
  const legs: [number, number, number][] = [];
  if (side) {
    for (const s of [swing, -swing]) {
      legs.push([x + lean * 0.4 + s * h * 0.2 * dir, y - Math.max(0, s) * h * 0.08, s]);
    }
  } else {
    const spread = h * 0.085;
    legs.push([x - spread, y - Math.max(0, swing) * h * 0.06, swing]);
    legs.push([x + spread, y - Math.max(0, -swing) * h * 0.06, -swing]);
  }
  // Back leg first, so the forward one overlaps it.
  legs.sort((a, b) => a[2] - b[2]);
  for (const [fx, fy, s] of legs) {
    const hipX = side ? x + lean * 0.4 : fx * 0.5 + x * 0.5;
    limb(hipX, hipY, fx, fy, legW, kit.pants, side ? dir * Math.abs(s) * h * 0.05 : 0, -Math.abs(s) * h * 0.02);
    // Shoe.
    ctx.fillStyle = '#1e1e26';
    ctx.beginPath();
    ctx.ellipse(fx + (side ? dir * h * 0.03 : 0), fy + h * 0.005, h * 0.06, h * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Back arm (behind the torso).
  const armLen = h * 0.24;
  const shoulderX = x + lean * 0.8;
  const armSwing = -swing;
  const backArm = (s: number) => {
    const hx = side ? shoulderX + s * armLen * 0.8 * dir : shoulderX + (s > 0 ? 1 : -1) * h * 0.2;
    const hy = shoulderY + armLen * 0.85 - Math.abs(s) * armLen * 0.35;
    return { hx, hy };
  };
  const holding = !!o.holdingBall;
  if (side) {
    const b = backArm(armSwing);
    limb(shoulderX, shoulderY + h * 0.03, b.hx, b.hy, armW, kit.shirt);
  } else {
    const b = backArm(-1);
    limb(shoulderX - h * 0.02, shoulderY + h * 0.03, b.hx, b.hy, armW, kit.shirt);
  }

  // ---- Torso: a jersey with shoulders, tapering to the belt.
  const torsoW = side ? h * 0.3 : h * 0.42;
  ctx.fillStyle = kit.shirt;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(shoulderX - torsoW / 2, shoulderY + h * 0.02);
  ctx.quadraticCurveTo(shoulderX, shoulderY - h * 0.06, shoulderX + torsoW / 2, shoulderY + h * 0.02);
  ctx.quadraticCurveTo(x + lean * 0.3 + torsoW * 0.42, (shoulderY + hipY) / 2, x + lean * 0.2 + torsoW * 0.36, hipY);
  ctx.quadraticCurveTo(x + lean * 0.2, hipY + h * 0.04, x + lean * 0.2 - torsoW * 0.36, hipY);
  ctx.quadraticCurveTo(x + lean * 0.3 - torsoW * 0.42, (shoulderY + hipY) / 2, shoulderX - torsoW / 2, shoulderY + h * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Belt.
  ctx.fillStyle = '#20222b';
  ctx.fillRect(x + lean * 0.2 - torsoW * 0.34, hipY - h * 0.025, torsoW * 0.68, Math.max(1.5, h * 0.03));
  // Number on the back, placket on the front.
  if (view === 'back' && o.number && h >= 32) {
    ctx.fillStyle = mix(kit.pants, '#ffffff', 0.4);
    ctx.font = `bold ${Math.round(h * 0.16)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.number, shoulderX, shoulderY + h * 0.15);
  } else if (view === 'front' && h >= 28) {
    ctx.strokeStyle = alpha(scale(kit.shirt, 0.6), 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY + h * 0.02);
    ctx.lineTo(x + lean * 0.2, hipY - h * 0.03);
    ctx.stroke();
  }

  // ---- Front arm, glove and ball.
  const f = side ? backArm(-armSwing) : backArm(1);
  let ballAt: { x: number; y: number } | null = null;
  if (holding) {
    // Ball up by the ear, ready to throw.
    const hx = shoulderX + (side ? -dir : 1) * h * 0.14;
    const hy = shoulderY - h * 0.16;
    limb(shoulderX + (side ? -dir : 1) * h * 0.03, shoulderY + h * 0.03, hx, hy, armW, kit.shirt, 0, h * 0.06);
    ballAt = { x: hx, y: hy };
    if (side) {
      // Glove hand out front for balance.
      limb(shoulderX, shoulderY + h * 0.03, shoulderX + dir * h * 0.24, shoulderY + h * 0.1, armW, kit.shirt);
      if (o.glove) glove(ctx, shoulderX + dir * h * 0.26, shoulderY + h * 0.1, h * 0.075);
    } else {
      limb(shoulderX - h * 0.02, shoulderY + h * 0.03, f.hx, f.hy, armW, kit.shirt);
      if (o.glove) glove(ctx, f.hx, f.hy, h * 0.075);
    }
  } else {
    limb(shoulderX + (side ? 0 : h * 0.02), shoulderY + h * 0.03, f.hx, f.hy, armW, kit.shirt);
    if (o.glove) glove(ctx, f.hx, f.hy + h * 0.02, h * 0.075);
  }

  // ---- Head, cap or helmet.
  const headX = shoulderX + (side ? dir * h * 0.02 : 0);
  const headY = shoulderY - headR * 0.95;
  ctx.fillStyle = skin;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (view !== 'back' && h >= 26) {
    // Eyes: two dots looking the way they're going.
    ctx.fillStyle = '#1b1b22';
    const ey = headY + headR * 0.1;
    if (side) {
      ctx.beginPath();
      ctx.arc(headX + dir * headR * 0.45, ey, headR * 0.11, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(headX - headR * 0.32, ey, headR * 0.11, 0, Math.PI * 2);
      ctx.arc(headX + headR * 0.32, ey, headR * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Cap dome over the top of the head, brim the way they're looking.
  ctx.fillStyle = kit.cap;
  ctx.strokeStyle = EDGE;
  ctx.beginPath();
  ctx.arc(headX, headY, headR * 1.04, Math.PI * 1.02, Math.PI * 1.98);
  ctx.lineTo(headX + headR * 1.04, headY - headR * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (o.helmet) {
    // Helmet: rounder, with a flap over the ear and a gloss.
    ctx.fillStyle = kit.cap;
    ctx.beginPath();
    ctx.arc(headX, headY, headR * 1.08, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.ellipse(headX - headR * 0.35, headY - headR * 0.62, headR * 0.35, headR * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const brimW = view === 'back' ? headR * 0.5 : headR * 0.9;
    const bx = side ? headX + dir * headR * 0.7 : headX;
    const by = headY - headR * 0.05;
    ctx.fillStyle = scale(kit.cap, 0.8);
    ctx.beginPath();
    if (side) ctx.ellipse(bx, by, brimW * 0.75, headR * 0.28, 0, 0, Math.PI * 2);
    else if (view === 'front') ctx.ellipse(bx, by + headR * 0.08, brimW * 1.05, headR * 0.3, 0, 0, Math.PI * 2);
    else ctx.ellipse(bx, by, brimW, headR * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (ballAt) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ballAt.x, ballAt.y, Math.max(2.2, h * 0.07), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function glove(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = GLOVE;
  ctx.strokeStyle = GLOVE_DARK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/* ============================================================== keyframes */

type Joint = [number, number];

interface Pose {
  footBack: Joint;
  kneeBack: Joint;
  footFront: Joint;
  kneeFront: Joint;
  hip: Joint;
  shoulder: Joint;
  head: Joint;
  handA: Joint;
  handB: Joint;
  /** Bat angle, radians, y-up; batter only. */
  bat: number;
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const j = (p: Joint, q: Joint): Joint => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  return {
    footBack: j(a.footBack, b.footBack),
    kneeBack: j(a.kneeBack, b.kneeBack),
    footFront: j(a.footFront, b.footFront),
    kneeFront: j(a.kneeFront, b.kneeFront),
    hip: j(a.hip, b.hip),
    shoulder: j(a.shoulder, b.shoulder),
    head: j(a.head, b.head),
    handA: j(a.handA, b.handA),
    handB: j(a.handB, b.handB),
    bat: a.bat + (b.bat - a.bat) * t,
  };
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Sample a keyframe track at `t`. Keys are [time, pose], ascending. */
function sample(track: [number, Pose][], t: number): Pose {
  if (t <= track[0][0]) return track[0][1];
  for (let i = 1; i < track.length; i++) {
    const [t1, p1] = track[i];
    if (t <= t1) {
      const [t0, p0] = track[i - 1];
      return lerpPose(p0, p1, smooth((t - t0) / (t1 - t0)));
    }
  }
  return track[track.length - 1][1];
}

/*
 * The pitcher faces the camera. His throwing arm is on screen-left (a
 * right-hander seen from the plate), and `handA` is that hand; `handB` is
 * the glove. The lead leg is `footFront`. Units are body heights; y is up
 * from the feet.
 */
const PITCH_SET: Pose = {
  footBack: [-0.11, 0], kneeBack: [-0.11, 0.24], footFront: [0.11, 0], kneeFront: [0.11, 0.24],
  hip: [0, 0.47], shoulder: [0, 0.79], head: [0, 0.95], handA: [-0.03, 0.66], handB: [0.06, 0.66], bat: 0,
};
const PITCH_LIFT: Pose = {
  footBack: [-0.08, 0], kneeBack: [-0.08, 0.24], footFront: [0.07, 0.31], kneeFront: [0.14, 0.44],
  hip: [-0.02, 0.49], shoulder: [-0.03, 0.81], head: [-0.03, 0.97], handA: [-0.04, 0.71], handB: [0.05, 0.71], bat: 0,
};
const PITCH_STRIDE: Pose = {
  footBack: [-0.17, 0.02], kneeBack: [-0.14, 0.26], footFront: [0.27, -0.02], kneeFront: [0.23, 0.24],
  hip: [0.03, 0.43], shoulder: [0, 0.77], head: [0, 0.93], handA: [-0.37, 0.47], handB: [0.35, 0.75], bat: 0,
};
const PITCH_COCK: Pose = {
  footBack: [-0.2, 0.04], kneeBack: [-0.16, 0.27], footFront: [0.29, -0.02], kneeFront: [0.23, 0.24],
  hip: [0.06, 0.43], shoulder: [0.04, 0.75], head: [0.03, 0.92], handA: [-0.3, 1.04], handB: [0.28, 0.6], bat: 0,
};
const PITCH_RELEASE: Pose = {
  footBack: [-0.16, 0.08], kneeBack: [-0.12, 0.27], footFront: [0.29, -0.02], kneeFront: [0.21, 0.22],
  hip: [0.08, 0.41], shoulder: [0.06, 0.71], head: [0.05, 0.87], handA: [-0.17, 0.99], handB: [0.12, 0.52], bat: 0,
};
const PITCH_FOLLOW: Pose = {
  footBack: [0.03, 0.1], kneeBack: [-0.02, 0.29], footFront: [0.29, -0.02], kneeFront: [0.19, 0.2],
  hip: [0.1, 0.39], shoulder: [0.15, 0.6], head: [0.17, 0.76], handA: [0.26, 0.3], handB: [0.02, 0.44], bat: 0,
};

const PITCH_TRACK: [number, Pose][] = [
  [0, PITCH_SET],
  [0.33, PITCH_LIFT],
  [0.63, PITCH_STRIDE],
  [0.84, PITCH_COCK],
  [1, PITCH_RELEASE],
];

/** Where the ball leaves the hand, relative to the feet, in body heights (y up). */
export const PITCH_RELEASE_POINT: Joint = PITCH_RELEASE.handA;

export interface PitcherPose {
  /** 0 set, 1 release. */
  windup: number;
  /** 0 at release, 1 fully followed through. */
  follow: number;
}

export function drawPitcher(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  kit: Uniform,
  pose: PitcherPose,
  skin = DEFAULT_SKIN,
): void {
  const p = pose.follow > 0
    ? lerpPose(PITCH_RELEASE, PITCH_FOLLOW, smooth(Math.min(1, pose.follow)))
    : sample(PITCH_TRACK, pose.windup);
  const armInFront = pose.windup >= 0.92 || pose.follow > 0;
  const holdsBall = pose.follow <= 0 && pose.windup < 0.97;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(h, -h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const W = 1 / h;

  const limb = (a: Joint, mid: Joint, b: Joint, w: number, colour: string) => {
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = w + 2.4 * W;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(mid[0], mid[1], b[0], b[1]);
    ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(mid[0], mid[1], b[0], b[1]);
    ctx.stroke();
  };
  const elbow = (s: Joint, hand: Joint, bend: number): Joint => {
    const mx = (s[0] + hand[0]) / 2;
    const my = (s[1] + hand[1]) / 2;
    const dx = hand[0] - s[0];
    const dy = hand[1] - s[1];
    const len = Math.hypot(dx, dy) || 1;
    return [mx - (dy / len) * bend, my + (dx / len) * bend];
  };

  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.beginPath();
  ctx.ellipse(0.04, -0.01, 0.34, 0.07, 0, 0, Math.PI * 2);
  ctx.fill();

  const shoulderA: Joint = [p.shoulder[0] - 0.17, p.shoulder[1] - 0.02];
  const shoulderB: Joint = [p.shoulder[0] + 0.17, p.shoulder[1] - 0.02];

  // Back (pivot) leg and the throwing arm while it's behind the body.
  limb(p.hip, p.kneeBack, p.footBack, 0.15, kit.pants);
  shoe(ctx, p.footBack, 0.09);
  if (!armInFront) {
    limb(shoulderA, elbow(shoulderA, p.handA, -0.06), p.handA, 0.11, kit.shirt);
    hand(ctx, p.handA, skin, 0.045);
    if (holdsBall) ball(ctx, p.handA, 0.05);
  }

  // Torso.
  torso(ctx, p.hip, p.shoulder, 0.44, 0.3, kit);

  // Lead leg.
  limb(p.hip, p.kneeFront, p.footFront, 0.15, kit.pants);
  shoe(ctx, p.footFront, 0.09);

  // Glove arm, always in front.
  limb(shoulderB, elbow(shoulderB, p.handB, 0.07), p.handB, 0.11, kit.shirt);
  ctx.fillStyle = GLOVE;
  ctx.strokeStyle = GLOVE_DARK;
  ctx.lineWidth = 1.5 * W;
  ctx.beginPath();
  ctx.arc(p.handB[0], p.handB[1], 0.085, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Throwing arm across the front once it has come over the top.
  if (armInFront) {
    limb(shoulderA, elbow(shoulderA, p.handA, -0.07), p.handA, 0.11, kit.shirt);
    hand(ctx, p.handA, skin, 0.045);
    if (holdsBall) ball(ctx, p.handA, 0.05);
  }

  // Head: face toward the plate, cap brim over the eyes.
  head(ctx, p.head, 0.14, skin, kit, 'front', W);

  ctx.restore();
}

/*
 * The batter is side-on, with +x toward the plate. `handA` is both hands on
 * the bat; `handB` unused. `footFront` is the stride foot.
 */
const BAT_STANCE: Pose = {
  footBack: [-0.17, 0], kneeBack: [-0.15, 0.26], footFront: [0.17, 0], kneeFront: [0.15, 0.26],
  hip: [0, 0.48], shoulder: [-0.02, 0.8], head: [0.02, 0.96], handA: [-0.16, 0.78], handB: [0, 0], bat: 1.9,
};
const BAT_LOAD: Pose = {
  footBack: [-0.19, 0], kneeBack: [-0.17, 0.26], footFront: [0.1, 0.04], kneeFront: [0.13, 0.28],
  hip: [-0.04, 0.47], shoulder: [-0.08, 0.79], head: [-0.02, 0.95], handA: [-0.24, 0.82], handB: [0, 0], bat: 2.2,
};
const BAT_CONTACT: Pose = {
  footBack: [-0.15, 0.02], kneeBack: [-0.11, 0.25], footFront: [0.2, 0], kneeFront: [0.17, 0.26],
  hip: [0.04, 0.47], shoulder: [0.06, 0.78], head: [0.06, 0.94], handA: [0.24, 0.6], handB: [0, 0], bat: -0.05,
};
const BAT_FOLLOW: Pose = {
  footBack: [-0.1, 0.05], kneeBack: [-0.06, 0.26], footFront: [0.2, 0], kneeFront: [0.17, 0.26],
  hip: [0.07, 0.47], shoulder: [0.11, 0.78], head: [0.09, 0.94], handA: [-0.02, 0.9], handB: [0, 0], bat: 2.5,
};

export interface BatterPose {
  /** 0 relaxed stance, 1 coiled and ready. */
  load: number;
  /** 0 not swinging, 1 fully followed through. Contact lands around 0.55. */
  swing: number;
  /** Idle sway, radians of phase. */
  sway?: number;
}

/**
 * The batter, feet at (x, y), facing +x. Mirror with a negative `dir` for a
 * left-hander standing on the other side of the plate.
 */
export function drawBatter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  kit: Uniform,
  pose: BatterPose,
  dir: 1 | -1 = 1,
  skin = DEFAULT_SKIN,
): void {
  let p: Pose;
  if (pose.swing > 0) {
    const s = pose.swing;
    p = s < 0.55
      ? lerpPose(BAT_LOAD, BAT_CONTACT, smooth(s / 0.55))
      : lerpPose(BAT_CONTACT, BAT_FOLLOW, smooth((s - 0.55) / 0.45));
  } else {
    p = lerpPose(BAT_STANCE, BAT_LOAD, smooth(Math.max(0, Math.min(1, pose.load))));
    if (pose.sway !== undefined) {
      const k = Math.sin(pose.sway) * (1 - pose.load) * 0.012;
      p = { ...p, hip: [p.hip[0] + k, p.hip[1]], shoulder: [p.shoulder[0] + k * 1.5, p.shoulder[1]], head: [p.head[0] + k * 1.5, p.head[1]], handA: [p.handA[0] + k * 1.5, p.handA[1] + Math.abs(k) * 0.5] };
    }
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(h * dir, -h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const W = 1 / h;

  const limb = (a: Joint, mid: Joint, b: Joint, w: number, colour: string) => {
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = w + 2.4 * W;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(mid[0], mid[1], b[0], b[1]);
    ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(mid[0], mid[1], b[0], b[1]);
    ctx.stroke();
  };

  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0.02, -0.01, 0.32, 0.065, 0, 0, Math.PI * 2);
  ctx.fill();

  const backShoulder: Joint = [p.shoulder[0] - 0.08, p.shoulder[1] - 0.02];
  const frontShoulder: Joint = [p.shoulder[0] + 0.08, p.shoulder[1] - 0.02];
  const elbowBack: Joint = [(backShoulder[0] + p.handA[0]) / 2 - 0.08, (backShoulder[1] + p.handA[1]) / 2 - 0.05];
  const elbowFront: Joint = [(frontShoulder[0] + p.handA[0]) / 2 + 0.02, (frontShoulder[1] + p.handA[1]) / 2 - 0.08];

  // Back leg, back arm, torso, front leg, front arm, bat, head.
  limb(p.hip, p.kneeBack, p.footBack, 0.14, kit.pants);
  shoe(ctx, p.footBack, 0.085);
  limb(backShoulder, elbowBack, p.handA, 0.1, kit.shirt);
  torso(ctx, p.hip, p.shoulder, 0.32, 0.26, kit);
  limb(p.hip, p.kneeFront, p.footFront, 0.14, kit.pants);
  shoe(ctx, p.footFront, 0.085);
  limb(frontShoulder, elbowFront, p.handA, 0.1, kit.shirt);

  // Bat: handle from the hands, barrel flaring toward the tip.
  const len = 0.56;
  const tip: Joint = [p.handA[0] + Math.cos(p.bat) * len, p.handA[1] + Math.sin(p.bat) * len];
  const mid: Joint = [p.handA[0] + Math.cos(p.bat) * len * 0.4, p.handA[1] + Math.sin(p.bat) * len * 0.4];
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 0.075;
  ctx.beginPath();
  ctx.moveTo(p.handA[0], p.handA[1]);
  ctx.lineTo(tip[0], tip[1]);
  ctx.stroke();
  ctx.strokeStyle = BAT_HANDLE;
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.moveTo(p.handA[0], p.handA[1]);
  ctx.lineTo(mid[0], mid[1]);
  ctx.stroke();
  ctx.strokeStyle = BAT_BARREL;
  ctx.lineWidth = 0.062;
  ctx.beginPath();
  ctx.moveTo(mid[0], mid[1]);
  ctx.lineTo(tip[0], tip[1]);
  ctx.stroke();
  ctx.strokeStyle = BAT_BARREL_LIGHT;
  ctx.lineWidth = 0.018;
  ctx.beginPath();
  ctx.moveTo(mid[0] + Math.cos(p.bat + Math.PI / 2) * 0.012, mid[1] + Math.sin(p.bat + Math.PI / 2) * 0.012);
  ctx.lineTo(tip[0] + Math.cos(p.bat + Math.PI / 2) * 0.012 - Math.cos(p.bat) * 0.03, tip[1] + Math.sin(p.bat + Math.PI / 2) * 0.012 - Math.sin(p.bat) * 0.03);
  ctx.stroke();
  // Batting gloves.
  ctx.fillStyle = kit.cap;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1.2 * W;
  ctx.beginPath();
  ctx.arc(p.handA[0], p.handA[1], 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  head(ctx, p.head, 0.13, skin, kit, 'helmet', W);
  ctx.restore();
}

/* ---------------------------------------------------------------- parts */

function torso(
  ctx: CanvasRenderingContext2D,
  hip: Joint,
  shoulder: Joint,
  shoulderW: number,
  hipW: number,
  kit: Uniform,
): void {
  const sx = shoulder[0];
  const sy = shoulder[1];
  const hx = hip[0];
  const hy = hip[1];
  ctx.fillStyle = kit.shirt;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(sx - shoulderW / 2, sy - 0.03);
  ctx.quadraticCurveTo(sx, sy + 0.07, sx + shoulderW / 2, sy - 0.03);
  ctx.quadraticCurveTo(sx + shoulderW * 0.42, (sy + hy) / 2, hx + hipW / 2, hy);
  ctx.quadraticCurveTo(hx, hy - 0.05, hx - hipW / 2, hy);
  ctx.quadraticCurveTo(sx - shoulderW * 0.42, (sy + hy) / 2, sx - shoulderW / 2, sy - 0.03);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Belt, and a placket down the front.
  ctx.fillStyle = '#20222b';
  ctx.fillRect(hx - hipW / 2 + 0.01, hy - 0.015, hipW - 0.02, 0.035);
  ctx.strokeStyle = alpha(scale(kit.shirt, 0.55), 0.5);
  ctx.lineWidth = 0.012;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(hx, hy + 0.03);
  ctx.stroke();
}

function head(
  ctx: CanvasRenderingContext2D,
  at: Joint,
  r: number,
  skin: string,
  kit: Uniform,
  style: 'front' | 'helmet',
  W: number,
): void {
  const [x, y] = at;
  ctx.fillStyle = skin;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1.2 * W;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#1b1b22';
  if (style === 'front') {
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.05, r * 0.1, 0, Math.PI * 2);
    ctx.arc(x + r * 0.35, y - r * 0.05, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    // Cap: dome plus a brim across the brow.
    ctx.fillStyle = kit.cap;
    ctx.beginPath();
    ctx.arc(x, y + r * 0.05, r * 1.05, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = scale(kit.cap, 0.75);
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.18, r * 1.1, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Side-on: one eye on the pitcher, helmet with the ear flap toward him.
    ctx.beginPath();
    ctx.arc(x + r * 0.5, y - r * 0.02, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = kit.cap;
    ctx.beginPath();
    ctx.arc(x, y + r * 0.02, r * 1.08, 0.05, Math.PI - 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x + r * 0.62, y - r * 0.15, r * 0.4, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = scale(kit.cap, 0.75);
    ctx.beginPath();
    ctx.ellipse(x + r * 0.85, y + r * 0.3, r * 0.55, r * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.25, y + r * 0.65, r * 0.4, r * 0.14, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function shoe(ctx: CanvasRenderingContext2D, foot: Joint, r: number): void {
  ctx.fillStyle = '#1e1e26';
  ctx.beginPath();
  ctx.ellipse(foot[0], foot[1] - 0.005, r, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
}

function hand(ctx: CanvasRenderingContext2D, at: Joint, skin: string, r: number): void {
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(at[0], at[1], r, 0, Math.PI * 2);
  ctx.fill();
}

function ball(ctx: CanvasRenderingContext2D, at: Joint, r: number): void {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(at[0] - 0.01, at[1] + 0.02, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
