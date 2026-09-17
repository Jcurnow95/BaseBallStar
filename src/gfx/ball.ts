import { alpha } from './palette';

/**
 * The baseball. One drawing for every size it appears at: a shaded sphere with
 * two horseshoe seams that spin, stitches once it's big enough to carry them,
 * and a motion streak behind it when it's moving fast. Nothing about contact
 * or catching reads from what's drawn here.
 */

const LEATHER_LIGHT = '#ffffff';
const LEATHER = '#f3efe4';
const LEATHER_SHADE = '#d2cbb9';
const LEATHER_RIM = '#a49c8a';
const SEAM = '#c9423a';
const STITCH = '#a5302a';

export interface BallStyle {
  /** Seam rotation in radians. */
  rot?: number;
  /** Screen-space velocity for the streak, in px per frame-ish. Omit for none. */
  vx?: number;
  vy?: number;
  /** Drop the cast shadow (the ball is drawn over a sky, say). */
  noShadow?: boolean;
}

export function drawBaseball(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  style: BallStyle = {},
): void {
  const rot = style.rot ?? 0;

  // Motion streak: a soft elongated ghost trailing the ball.
  if (style.vx !== undefined && style.vy !== undefined) {
    const speed = Math.hypot(style.vx, style.vy);
    if (speed > r * 0.6) {
      const len = Math.min(speed * 1.6, r * 5);
      const ang = Math.atan2(style.vy, style.vx);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      const g = ctx.createLinearGradient(-len, 0, 0, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,0.4)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(-len / 2, 0, len / 2, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.save();
  if (!style.noShadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = r * 0.5;
    ctx.shadowOffsetY = r * 0.2;
  }
  const shade = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.08, x, y, r);
  shade.addColorStop(0, LEATHER_LIGHT);
  shade.addColorStop(0.5, LEATHER);
  shade.addColorStop(0.86, LEATHER_SHADE);
  shade.addColorStop(1, LEATHER_RIM);
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (r < 5) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.98, 0, Math.PI * 2);
  ctx.clip();
  ctx.lineCap = 'round';

  const seam = (cx: number, from: number, to: number): void => {
    ctx.strokeStyle = SEAM;
    ctx.lineWidth = Math.max(1, r * 0.055);
    ctx.beginPath();
    ctx.arc(cx, 0, r * 0.98, from, to);
    ctx.stroke();

    if (r > 11) {
      ctx.strokeStyle = STITCH;
      ctx.lineWidth = Math.max(1, r * 0.04);
      ctx.beginPath();
      const ticks = Math.round(7 + r / 6);
      for (let i = 0; i < ticks; i++) {
        const a = from + ((i + 0.5) / ticks) * (to - from);
        const px = cx + Math.cos(a) * r * 0.98;
        const py = Math.sin(a) * r * 0.98;
        const tilt = a + 0.7;
        const len = r * 0.11;
        ctx.moveTo(px - Math.cos(tilt) * len, py - Math.sin(tilt) * len);
        ctx.lineTo(px + Math.cos(tilt) * len, py + Math.sin(tilt) * len);
      }
      ctx.stroke();
    }
  };

  seam(-r * 0.42, -0.95, 0.95);
  seam(r * 0.42, Math.PI - 0.95, Math.PI + 0.95);

  // Specular glint, on top of the seams.
  ctx.rotate(-rot);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.4, -r * 0.45, r * 0.22, r * 0.14, -0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The ball as seen from the field camera: a few pixels of white with a rim so
 * it stays visible over chalk, plus a shadow on the ground under it that
 * shrinks and softens with height. `air` and `ground` are screen points.
 */
export function drawFieldBall(
  ctx: CanvasRenderingContext2D,
  air: { x: number; y: number },
  ground: { x: number; y: number },
  z: number,
  scale: number,
  shadowAlpha: number,
): void {
  if (z > 0.5) {
    const shrink = Math.max(0.45, 1 - z / 220);
    ctx.fillStyle = alpha('#000000', shadowAlpha * 0.9 * shrink);
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, 2.2 * scale * shrink, 1.1 * scale * shrink, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const radius = Math.min(7.5, Math.max(3, 3 + z / 40));
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(70,60,50,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(air.x, air.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // A red seam hint, so it's a baseball and not a dot.
  if (radius > 4.5) {
    ctx.strokeStyle = 'rgba(201,66,58,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(air.x - radius * 0.35, air.y, radius * 0.9, -0.8, 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Comet tail for the field ball: the last few positions, fading and thinning
 * toward the oldest, so the eye finds a fast-moving dot instantly.
 */
export function drawBallTail(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  radius: number,
): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < points.length; i++) {
    const frac = i / points.length;
    ctx.strokeStyle = `rgba(255,255,255,${frac * frac * 0.5})`;
    ctx.lineWidth = Math.max(1, radius * 1.6 * frac);
    ctx.beginPath();
    ctx.moveTo(points[i - 1].x, points[i - 1].y);
    ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }
  ctx.restore();
}
