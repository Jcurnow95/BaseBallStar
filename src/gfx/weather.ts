import type { Weather } from '../core/weather';
import { windMph } from '../core/weather';
import type { Lighting } from './palette';
import { alpha, hash, unit } from './palette';

/**
 * Weather on the canvas: clouds in the sky, rain over everything, a wash of
 * gloom on a wet day, a flash of lightning in a storm, and the wind flag.
 * Shared by the at-bat scene (catcher's view) and the field views (tilted
 * camera). Both put right field on the right and centre field up the screen,
 * so one direction mapping serves all: screen dx = wind.x, screen dy = -wind.y.
 */

/** Pixels the rain falls per second. */
const RAIN_SPEED = 760;
const RAIN_STREAKS = 150;

/** Soft clouds drifting with the wind across a sky band `top..bottom`. */
export function drawClouds(
  ctx: CanvasRenderingContext2D,
  W: number,
  top: number,
  bottom: number,
  light: Lighting,
  weather: Weather,
  time: number,
): void {
  if (light.cloud <= 0) return;
  const count = Math.round(4 + light.cloud * 10);
  const drift = weather.wind.x * 0.35 * time;
  const band = bottom - top;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const h = hash(i + 300);
    const speed = 0.6 + unit(h, 3) * 0.8;
    const x = (((unit(h) * (W + 300) - 150 + drift * speed) % (W + 300)) + W + 300) % (W + 300) - 150;
    const y = top + band * (0.1 + unit(h, 7) * 0.7);
    const w = 60 + unit(h, 11) * 120;
    const hh = w * (0.22 + unit(h, 5) * 0.12);
    const a = light.cloud >= 0.9 ? 0.55 : 0.75;
    const colour = light.cloud >= 0.9 ? '#c8d0da' : '#ffffff';
    ctx.fillStyle = alpha(colour, a);
    // Three lobes over a flat base.
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.5, hh * 0.5, 0, 0, Math.PI * 2);
    ctx.ellipse(x - w * 0.22, y - hh * 0.2, w * 0.28, hh * 0.55, 0, 0, Math.PI * 2);
    ctx.ellipse(x + w * 0.18, y - hh * 0.3, w * 0.32, hh * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = alpha('#8a98ad', light.cloud >= 0.9 ? 0.25 : 0.12);
    ctx.beginPath();
    ctx.ellipse(x + w * 0.05, y + hh * 0.22, w * 0.46, hh * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Rain streaks over the whole canvas, leaning with the crosswind. */
export function drawRain(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  weather: Weather,
  time: number,
): void {
  const rain = weather.rain;
  if (rain <= 0 || W <= 0 || H <= 0) return;

  const slant = Math.max(-0.75, Math.min(0.75, weather.wind.x / 30));
  const count = Math.round(RAIN_STREAKS * (0.4 + rain * 0.6));
  const length = 12 + rain * 14;
  const drop = time * RAIN_SPEED;

  ctx.save();
  ctx.strokeStyle = `rgba(210, 226, 255, ${0.18 + rain * 0.18})`;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const h = hash(i);
    const speedJitter = 0.75 + (h & 0xff) / 512;
    const y = ((drop * speedJitter + ((h >>> 8) & 0xffff)) % (H + length)) - length;
    const x = ((((h >>> 16) & 0xffff) / 0xffff) * (W + 200) - 100 + y * slant + W * 2) % W;
    ctx.moveTo(x, y);
    ctx.lineTo(x - length * slant, y - length);
  }
  ctx.stroke();
  ctx.restore();
}

/** Rings blooming where the rain lands, below `groundY`. */
export function drawRainSplashes(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  weather: Weather,
  time: number,
  groundY: number,
): void {
  const rain = weather.rain;
  const band = H - groundY;
  if (rain <= 0 || W <= 0 || band <= 4) return;

  const count = Math.round(28 * (0.4 + rain * 0.6));
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    const h = hash(i + 4099);
    const period = 0.5 + ((h >>> 4) & 0xff) / 340;
    const phase = ((time + ((h >>> 12) & 0xff) / 32) % period) / period;
    const gen = Math.floor((time + ((h >>> 12) & 0xff) / 32) / period);
    const gh = hash(i * 31 + gen);
    const x = ((gh & 0xffff) / 0xffff) * W;
    const y = groundY + (((gh >>> 16) & 0xffff) / 0xffff) * band;
    const r = 1 + phase * 3.5;
    ctx.strokeStyle = `rgba(220, 234, 255, ${(1 - phase) * (0.16 + rain * 0.2)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** The lighting's wash over the finished frame. */
export function drawTint(ctx: CanvasRenderingContext2D, W: number, H: number, light: Lighting): void {
  if (light.tintAlpha <= 0) return;
  ctx.save();
  ctx.fillStyle = alpha(light.tint, light.tintAlpha);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/**
 * Lightning: in a storm, every so often the whole frame flashes for a few
 * frames. Driven by the clock so it's deterministic and pauses with the game.
 */
export function drawLightning(ctx: CanvasRenderingContext2D, W: number, H: number, weather: Weather, time: number): void {
  if (weather.sky !== 'storm') return;
  const period = 7.5;
  const cycle = Math.floor(time / period);
  const within = time - cycle * period;
  const h = hash(cycle + 77);
  const at = 1 + unit(h) * (period - 2);
  const since = within - at;
  if (since < 0 || since > 0.45) return;
  // Two flickers: a sharp one, then a weaker echo.
  const a = since < 0.08 ? 0.55 : since < 0.16 ? 0.12 : since < 0.24 ? 0.3 : Math.max(0, 0.3 - (since - 0.24) * 1.5);
  if (a <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(225, 232, 255, ${a})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/**
 * The wind flag: a pill with an arrow the way the wind blows, the speed in
 * mph, and a raindrop when it's wet. Anchored at its top-left. Nothing on a
 * calm dry day.
 */
export function drawWindFlag(ctx: CanvasRenderingContext2D, x: number, y: number, weather: Weather): void {
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

  ctx.fillStyle = 'rgba(8, 14, 26, 0.55)';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  pill(ctx, x, y, w, h);
  ctx.fill();
  ctx.stroke();

  let cursor = x + 10;
  if (mph >= 3) {
    const angle = Math.atan2(-weather.wind.y, weather.wind.x);
    ctx.save();
    ctx.translate(cursor + 8, y + h / 2);
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

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const r = h / 2;
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
