/**
 * Little top-down ballplayers. Drawn from parts rather than as a blob so they
 * can actually run: the legs and arms swing on a cycle driven by how fast the
 * player is really moving, and they turn to face where they're going.
 */

import type { Uniform } from '../core/uniforms';
import { DEFAULT_KIT } from '../core/uniforms';

export type PlayerColors = Uniform;

const SKIN = '#c98d63';

export const FIELDER_COLORS: PlayerColors = DEFAULT_KIT.home;
export const RUNNER_COLORS: PlayerColors = DEFAULT_KIT.away;

export interface SpriteAnim {
  x: number;
  y: number;
  /** Run-cycle position, in radians. */
  phase: number;
  /** Screen-space direction the player is facing, in radians. */
  facing: number;
  /** 0 = standing, 1 = full sprint. */
  effort: number;
}

export function createAnim(x: number, y: number): SpriteAnim {
  return { x, y, phase: 0, facing: -Math.PI / 2, effort: 0 };
}

/**
 * Advance a sprite's animation from where it actually moved on screen. Feet
 * turn over in proportion to real speed, so a sprinting fielder's legs churn
 * and a standing one's don't.
 */
export function updateAnim(
  anim: SpriteAnim,
  x: number,
  y: number,
  dt: number,
  pixelsPerStride = 16,
): void {
  const dx = x - anim.x;
  const dy = y - anim.y;
  const moved = Math.hypot(dx, dy);
  anim.x = x;
  anim.y = y;

  if (dt > 0) {
    const speed = moved / dt;
    // Screen speed, so this is divided by a value that reaches full stride at
    // a normal sprint at typical zoom. Smoothed so the cycle doesn't stutter.
    const target = Math.min(speed / 70, 1);
    anim.effort += (target - anim.effort) * Math.min(1, dt * 9);
  }

  if (moved > 0.35) {
    anim.facing = Math.atan2(dy, dx);
    anim.phase += (moved / pixelsPerStride) * Math.PI;
  } else {
    // Idle bob so nobody looks frozen.
    anim.phase += dt * 2.2;
    anim.effort *= Math.max(0, 1 - dt * 6);
  }
}

export interface DrawPlayerOptions {
  height: number;
  colors: PlayerColors;
  anim: SpriteAnim;
  highlight?: boolean;
  /** Draw the glove arm reaching out, for a fielder holding the ball. */
  holdingBall?: boolean;
}

export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  options: DrawPlayerOptions,
): void {
  const { height: h, colors, anim } = options;
  const w = h * 0.52;
  const effort = Math.max(0.16, anim.effort);
  const swing = Math.sin(anim.phase) * effort;
  const counterSwing = Math.sin(anim.phase + Math.PI) * effort;

  // Lean into the run, in the direction of travel.
  const leanX = Math.cos(anim.facing) * effort * h * 0.09;

  const hipY = y - h * 0.34;
  const shoulderY = y - h * 0.62;
  const legLength = h * 0.34;
  const armLength = h * 0.26;

  if (options.highlight) {
    ctx.save();
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.06, w * 1.25, w * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y + h * 0.08, w * 0.62, w * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.lineCap = 'round';

  // ---- Legs. One swings forward while the other drives back.
  ctx.lineWidth = Math.max(2.5, h * 0.16);
  for (const side of [swing, -swing]) {
    const footX = x + leanX * 0.5 + side * legLength * 0.7;
    const footY = hipY + legLength - Math.abs(side) * legLength * 0.24;
    // Dark edge first, so legs stay legible over bright grass.
    ctx.strokeStyle = 'rgba(0,0,0,0.32)';
    ctx.lineWidth = Math.max(3.5, h * 0.21);
    ctx.beginPath();
    ctx.moveTo(x, hipY);
    ctx.lineTo(footX, footY);
    ctx.stroke();

    ctx.strokeStyle = colors.pants;
    ctx.lineWidth = Math.max(2.5, h * 0.16);
    ctx.beginPath();
    ctx.moveTo(x, hipY);
    ctx.lineTo(footX, footY);
    ctx.stroke();
  }

  // ---- Torso. Curved and tapered rather than a flat-sided box, so the body
  // reads like the round-capped limbs instead of a brick with arms.
  const shoulderHalf = w * 0.5;
  const hipHalf = w * 0.36;
  const waistY = shoulderY + (hipY - shoulderY) * 0.55;
  const waistHalf = w * 0.33;
  const lean = leanX * 0.3;

  ctx.fillStyle = colors.shirt;
  ctx.strokeStyle = 'rgba(0,0,0,0.32)';
  ctx.lineWidth = Math.max(1, h * 0.035);
  ctx.beginPath();
  // Rounded shoulder line.
  ctx.moveTo(x - shoulderHalf, shoulderY + h * 0.02);
  ctx.quadraticCurveTo(x, shoulderY - h * 0.07, x + shoulderHalf, shoulderY + h * 0.02);
  // Right side, pinched at the waist and flaring back out at the hip.
  ctx.quadraticCurveTo(x + waistHalf, waistY, x + hipHalf + lean, hipY);
  // Rounded seat.
  ctx.quadraticCurveTo(x + lean, hipY + h * 0.055, x - hipHalf + lean, hipY);
  // Left side back up to the shoulder.
  ctx.quadraticCurveTo(x - waistHalf, waistY, x - shoulderHalf, shoulderY + h * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // ---- Arms, swinging opposite the legs.
  ctx.strokeStyle = colors.shirt;
  ctx.lineWidth = Math.max(1.8, h * 0.1);
  const armPairs = options.holdingBall ? [counterSwing * 0.3, -0.9] : [counterSwing, -counterSwing];
  for (const side of armPairs) {
    const handX = x + leanX + side * armLength * 0.85;
    const handY = shoulderY + armLength * 0.75 - Math.abs(side) * armLength * 0.28;
    ctx.beginPath();
    ctx.moveTo(x, shoulderY + h * 0.03);
    ctx.lineTo(handX, handY);
    ctx.stroke();
  }

  if (options.holdingBall) {
    // Ball tucked in the throwing hand.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + leanX - armLength * 0.75, shoulderY + armLength * 0.5, h * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Head and cap.
  const headY = shoulderY - h * 0.12;
  const headR = h * 0.15;
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(x + leanX * 0.6, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = colors.cap;
  ctx.beginPath();
  ctx.arc(x + leanX * 0.6, headY, headR, Math.PI, Math.PI * 2);
  ctx.fill();
  // Brim points where they're looking.
  ctx.beginPath();
  ctx.ellipse(
    x + leanX * 0.6 + Math.cos(anim.facing) * headR * 0.7,
    headY + Math.sin(anim.facing) * headR * 0.7,
    headR * 0.75,
    headR * 0.45,
    anim.facing,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}
