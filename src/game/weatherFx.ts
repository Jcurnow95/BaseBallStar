import type { Weather } from '../core/weather';
import { windLabel, windMph } from '../core/weather';

/**
 * Canvas weather: rain streaks and the wind flag. Shared by the at-bat view
 * (catcher POV) and the field view (top-down). Both put right field on the
 * right and centre field up the screen, so one direction mapping serves both:
 * screen dx = wind.x, screen dy = -wind.y.
 */

/** Pixels the rain falls per second. Fast enough to read as rain, not snow. */
const RAIN_SPEED = 720;
const RAIN_STREAKS = 140;

/**
 * Rain streaks over the whole canvas. Positions come from an index hash and
 * the clock rather than rng, so the streaks stream instead of jittering.
 * `time` is in seconds and only needs to advance while the view is live —
 * paused, the rain hangs in the air, which is fine.
 */
export function drawRain(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  weather: Weather,
  time: number,
): void {
  const rain = weather.rain;
  if (rain <= 0 || W <= 0 || H <= 0) return;

  // Crosswind slants the streaks. Capped: a gale still has to look like rain.
  const slant = Math.max(-0.6, Math.min(0.6, weather.wind.x / 40));
  const count = Math.round(RAIN_STREAKS * (0.4 + rain * 0.6));
  const length = 10 + rain * 10;
  const drop = time * RAIN_SPEED;

  ctx.save();
  ctx.strokeStyle = `rgba(200, 220, 255, ${0.16 + rain * 0.16})`;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const h = hash(i);
    // Each streak owns a column and a phase, and loops top to bottom. The
    // extra width on both sides covers what the slant would otherwise reveal.
    const speedJitter = 0.75 + (h & 0xff) / 512;
    const y = ((drop * speedJitter + ((h >>> 8) & 0xffff)) % (H + length)) - length;
    const x = ((((h >>> 16) & 0xffff) / 0xffff) * (W + 200) - 100 + y * slant + W * 2) % W;
    ctx.moveTo(x, y);
    ctx.lineTo(x - length * slant, y - length);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * A grey wash over the scene on a wet day, so the field reads as soaked before
 * the first ball dies in the outfield.
 */
export function drawGloom(ctx: CanvasRenderingContext2D, W: number, H: number, weather: Weather): void {
  const gloom = weather.sky === 'storm' ? 0.28 : weather.sky === 'rain' ? 0.18 : weather.sky === 'overcast' ? 0.08 : 0;
  if (gloom <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(30, 40, 60, ${gloom})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/**
 * The wind flag: a pill in the corner with an arrow the way the wind blows
 * and the speed in mph, and a raindrop when it's raining. Anchored at its
 * top-left corner in canvas pixels. Draws nothing on a calm, dry day.
 */
export function drawWindFlag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  weather: Weather,
): void {
  const mph = Math.round(windMph(weather));
  const wet = weather.rain > 0;
  if (mph < 3 && !wet) return;

  const label = mph < 3 ? 'Calm' : `${mph} mph`;
  ctx.save();
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const textW = ctx.measureText(label).width;
  const arrowW = mph >= 3 ? 24 : 0;
  const dropW = wet ? 16 : 0;
  const w = 12 + arrowW + textW + dropW + 10;
  const h = 26;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, 13);
  ctx.fill();

  let cursor = x + 10;
  if (mph >= 3) {
    // Arrow points where the wind is going. Screen y is down, field y is out.
    const angle = Math.atan2(-weather.wind.y, weather.wind.x);
    const cx = cursor + 8;
    const cy = y + h / 2;
    // Nested save: the surface carries a device-pixel scale, so the transform
    // is restored rather than reset.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.strokeStyle = '#ffd166';
    ctx.fillStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(5, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(3, -4);
    ctx.lineTo(3, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    cursor += arrowW;
  }

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(label, cursor, y + h / 2 + 0.5);
  cursor += textW + 6;

  if (wet) {
    // A raindrop, heavier in a storm.
    const cx = cursor + 5;
    const cy = y + h / 2 + 1;
    ctx.fillStyle = weather.sky === 'storm' ? '#7fb8ff' : '#b8d8ff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.quadraticCurveTo(cx + 5, cy + 1, cx, cy + 5);
    ctx.quadraticCurveTo(cx - 5, cy + 1, cx, cy - 6);
    ctx.fill();
  }
  ctx.restore();
}

/** Text form of the flag, for a HUD line or a coach tip. */
export function windFlagText(weather: Weather): string {
  return windLabel(weather);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
}

function hash(i: number): number {
  let h = (i + 1) * 0x9e3779b1;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
