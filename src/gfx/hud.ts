import { CUE_GOLD, CUE_RED, alpha } from './palette';

/**
 * In-canvas HUD pieces shared across the views: rings that mean "act here",
 * the tap marker, the joystick. One visual language — gold for the cue,
 * red for danger, white for information.
 */

/** A dashed pulsing ring on a screen point, optionally squashed for the tilted ground. */
export function drawCueRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  options: { colour?: string; pulse?: number; dashed?: boolean; squash?: number; width?: number; dot?: boolean } = {},
): void {
  const colour = options.colour ?? CUE_GOLD;
  const pulse = options.pulse ?? 1;
  const squash = options.squash ?? 1;
  ctx.save();
  ctx.strokeStyle = alpha(colour, pulse);
  ctx.lineWidth = options.width ?? 2.5;
  if (options.dashed) ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * squash, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (options.dot) {
    ctx.fillStyle = alpha(colour, pulse);
    ctx.beginPath();
    ctx.ellipse(x, y, 2.5, 2.5 * squash, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A dashed guide line between two screen points. */
export function drawGuideLine(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  colour: string,
  a: number,
  width = 2,
): void {
  ctx.save();
  ctx.strokeStyle = alpha(colour, a);
  ctx.lineWidth = width;
  ctx.setLineDash([6, 5]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

/** The X where a tap landed. */
export function drawTapMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - size, y - size);
  ctx.lineTo(x + size, y + size);
  ctx.moveTo(x + size, y - size);
  ctx.lineTo(x - size, y + size);
  ctx.stroke();
  ctx.strokeStyle = CUE_GOLD;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

/** The drag joystick: a base ring where the finger went down and a thumb on the stick. */
export function drawJoystick(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  x: number,
  y: number,
  range: number,
): void {
  const dx = x - originX;
  const dy = y - originY;
  const len = Math.hypot(dx, dy);
  const capped = Math.min(len, range);
  const nx = len > 0 ? (dx / len) * capped : 0;
  const ny = len > 0 ? (dy / len) * capped : 0;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(originX, originY, range, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (capped > 4) {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(originX + nx, originY + ny);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(originX + nx, originY + ny, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export const DANGER = CUE_RED;
