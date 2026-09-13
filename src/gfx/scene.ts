import type { Weather } from '../core/weather';
import type { Lighting } from './palette';
import { CROWD_COLOURS, alpha, hash, mix, scale as shade, unit } from './palette';
import { drawClouds } from './weather';

/**
 * The at-bat backdrop: the park seen from behind the plate.
 *
 * Everything on the ground is real geometry — the plate, the boxes, the
 * grass diamond, the clay skin, the mound, the foul lines, the wall — put
 * through one simple perspective (`SceneLayout.proj`) so the scene hangs
 * together the way a photo from the backstop does: the mound is where a
 * mound is, the wall is 400 feet off, and the mowing converges on the horizon.
 *
 * Above the wall: the seating bowl, a scoreboard and two light towers under
 * the sky the weather gives us.
 */

/** Width / height of the play area. Portrait phone shape; letterboxed elsewhere. */
export const STAGE_ASPECT = 0.6;
/** Vanishing line as a fraction of stage height. */
const HORIZON = 0.36;
/** Where the plate sits on screen. */
const PLATE_Y = 0.86;
/** Feet from the plate to the crest of the mound. */
const MOUND_D = 60.5;
/** Where the crest of the mound sits on screen. */
export const MOUND_Y = 0.405;
/** Where the batter's feet are, laterally, in feet from the plate's centre. */
const BATTER_LAT = 4.2;
/** ...and on screen, as a fraction of stage width. */
const BATTER_X = 0.36;

export interface SceneLayout {
  W: number;
  H: number;
  cx: number;
  horizon: number;
  /** Ground point `lat` feet across (right positive) and `d` feet out from the plate, to stage space. */
  proj(lat: number, d: number): { x: number; y: number };
  /** Pixels per foot at depth `d`. */
  ppf(d: number): number;
}

export function sceneLayout(W: number, H: number): SceneLayout {
  // y = horizon + A / (d + B): fixed by where the plate and the mound land.
  const A0 = PLATE_Y - HORIZON;
  const A1 = MOUND_Y - HORIZON;
  const B = (A1 * MOUND_D) / (A0 - A1);
  const A = A0 * B;
  const S = (BATTER_X * W * B) / BATTER_LAT;
  const horizon = H * HORIZON;
  return {
    W,
    H,
    cx: W / 2,
    horizon,
    proj: (lat, d) => {
      const depth = Math.max(d, -B * 0.85);
      return { x: W / 2 + (lat * S) / (depth + B), y: horizon + (A * H) / (depth + B) };
    },
    ppf: (d) => S / (Math.max(d, -B * 0.85) + B),
  };
}

export interface SceneBleed {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Sky, sun, clouds. Fills the whole canvas above the horizon. */
export function drawSky(
  ctx: CanvasRenderingContext2D,
  L: SceneLayout,
  bleed: SceneBleed,
  light: Lighting,
  weather: Weather,
  time: number,
): void {
  const sky = ctx.createLinearGradient(0, bleed.top, 0, L.horizon);
  sky.addColorStop(0, light.skyTop);
  sky.addColorStop(0.6, light.skyMid);
  sky.addColorStop(1, light.skyHorizon);
  ctx.fillStyle = sky;
  ctx.fillRect(bleed.left, bleed.top, bleed.right - bleed.left, L.horizon - bleed.top);

  if (light.sun > 0) {
    const sx = L.W * 0.8;
    const sy = L.H * 0.07;
    const halo = ctx.createRadialGradient(sx, sy, 2, sx, sy, L.W * 0.4);
    halo.addColorStop(0, `rgba(255,248,220,${0.55 * light.sun})`);
    halo.addColorStop(0.25, `rgba(255,240,200,${0.18 * light.sun})`);
    halo.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(bleed.left, bleed.top, bleed.right - bleed.left, L.horizon - bleed.top);
    ctx.fillStyle = `rgba(255,252,235,${0.95 * light.sun})`;
    ctx.beginPath();
    ctx.arc(sx, sy, L.W * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }

  drawClouds(ctx, bleed.right - bleed.left, bleed.top, L.horizon * 0.7, light, weather, time);
}

/**
 * The bowl beyond the wall, the scoreboard over centre and the light towers,
 * then the wall itself. `crowd` is how full the seats are.
 */
export function drawFarPark(
  ctx: CanvasRenderingContext2D,
  L: SceneLayout,
  bleed: SceneBleed,
  light: Lighting,
  crowd: number,
): void {
  const wallBase = L.proj(0, 400).y;
  const wallH = L.H * 0.03;
  const wallTop = wallBase - wallH;
  const standsTop = L.horizon * 0.5;
  const rows = 7;
  const width = bleed.right - bleed.left;

  // Tiers, thinner toward the back. The front row sits on the wall right
  // across the frame; the bowl wraps round toward us at the edges, so out
  // there it's nearer and reads taller, which is what lifts the top edge.
  const edge = (x: number): number => 1 + 0.55 * Math.pow(((x - L.cx) / L.W) * 2, 2);
  const rowFrac = (k: number): number => 1 - Math.pow(1 - k / rows, 1.5);
  const rowAt = (k: number, x: number): number => wallTop - (wallTop - standsTop) * rowFrac(k) * edge(x);
  const traceBand = (kBottom: number, kTop: number) => {
    ctx.beginPath();
    ctx.moveTo(bleed.left, rowAt(kBottom, bleed.left));
    for (let x = bleed.left; x <= bleed.right; x += 24) ctx.lineTo(x, rowAt(kBottom, x));
    ctx.lineTo(bleed.right, rowAt(kBottom, bleed.right));
    ctx.lineTo(bleed.right, rowAt(kTop, bleed.right));
    for (let x = bleed.right; x >= bleed.left; x -= 24) ctx.lineTo(x, rowAt(kTop, x));
    ctx.lineTo(bleed.left, rowAt(kTop, bleed.left));
    ctx.closePath();
  };
  for (let k = 0; k < rows; k++) {
    ctx.fillStyle = k % 2 === 0 ? light.seats : light.seatsAlt;
    traceBand(k, k + 1);
    ctx.fill();
    // Riser shadow along the front of each row.
    ctx.strokeStyle = alpha('#000000', 0.22);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = bleed.left; x <= bleed.right; x += 24) {
      if (x === bleed.left) ctx.moveTo(x, rowAt(k, x));
      else ctx.lineTo(x, rowAt(k, x));
    }
    ctx.stroke();
  }

  // The crowd, scattered by hash so nobody moves between frames.
  const fill = Math.max(0, Math.min(1, crowd));
  const seats = Math.round((width / 4) * rows);
  const taken = Math.round(seats * fill);
  const size = Math.max(1.6, L.W * 0.007);
  for (let i = 0; i < taken; i++) {
    const h = hash(i + 1200);
    const row = (h >>> 3) % rows;
    const x = bleed.left + unit(h) * width;
    const y0 = rowAt(row + 1, x);
    const y1 = rowAt(row, x);
    const y = y0 + (y1 - y0) * (0.35 + unit(h, 9) * 0.5);
    ctx.fillStyle = CROWD_COLOURS[h % CROWD_COLOURS.length];
    ctx.fillRect(x, y - size * 1.4, size, size * 1.4);
  }

  // Back wall of the bowl, and the scoreboard sitting on it.
  ctx.fillStyle = shade(light.concrete, 0.85);
  ctx.beginPath();
  ctx.moveTo(bleed.left, rowAt(rows, bleed.left));
  for (let x = bleed.left; x <= bleed.right; x += 24) ctx.lineTo(x, rowAt(rows, x));
  ctx.lineTo(bleed.right, rowAt(rows, bleed.right));
  ctx.lineTo(bleed.right, rowAt(rows, bleed.right) - L.H * 0.012);
  for (let x = bleed.right; x >= bleed.left; x -= 24) ctx.lineTo(x, rowAt(rows, x) - L.H * 0.012);
  ctx.closePath();
  ctx.fill();
  // A dark facade under the front row, so the stand plants on the wall.
  ctx.fillStyle = shade(light.concreteDark, 0.75);
  ctx.fillRect(bleed.left, wallTop - L.H * 0.008, width, L.H * 0.008);
  drawScoreboard(ctx, L, light, standsTop - L.H * 0.012);
  drawTowers(ctx, L, light, standsTop);

  // The wall: padding in the park's green, a yellow cap, a distance sign.
  const face = ctx.createLinearGradient(bleed.left, 0, bleed.right, 0);
  face.addColorStop(0, light.wallDark);
  face.addColorStop(0.5, light.wall);
  face.addColorStop(1, light.wallDark);
  ctx.fillStyle = face;
  ctx.fillRect(bleed.left, wallTop, width, wallH + 1);
  ctx.strokeStyle = alpha('#000000', 0.18);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = L.cx % 26; x < bleed.right; x += 26) {
    ctx.moveTo(x, wallTop);
    ctx.lineTo(x, wallBase);
  }
  ctx.stroke();
  ctx.fillStyle = light.wallCap;
  ctx.fillRect(bleed.left, wallTop - 1.5, width, Math.max(2, L.H * 0.004));
  ctx.fillStyle = alpha('#ffffff', 0.85);
  ctx.font = `bold ${Math.max(8, L.H * 0.014)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('400', L.cx, wallTop + wallH * 0.52);
}

function drawScoreboard(ctx: CanvasRenderingContext2D, L: SceneLayout, light: Lighting, baseY: number): void {
  const w = L.W * 0.34;
  const h = L.H * 0.075;
  const x = L.cx - w / 2;
  const y = baseY - h - L.H * 0.012;
  // Posts, frame, screen.
  ctx.fillStyle = '#2e3138';
  ctx.fillRect(L.cx - w * 0.3, y + h, L.W * 0.012, L.H * 0.014);
  ctx.fillRect(L.cx + w * 0.3 - L.W * 0.012, y + h, L.W * 0.012, L.H * 0.014);
  ctx.fillStyle = '#1b1d24';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = light.sun > 0.5 ? '#26304a' : '#1c2338';
  ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  // A video-board abstraction: a name in lights and a bar of colour.
  ctx.fillStyle = '#ffd166';
  ctx.font = `900 ${Math.max(8, L.H * 0.016)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BASEBALL STAR', L.cx, y + h * 0.36);
  const barY = y + h * 0.62;
  const cols = ['#ff6b6b', '#5aa9ff', '#35c26a', '#ffd166', '#c9b3ff'];
  const cw = (w - 16) / cols.length;
  cols.forEach((c, i) => {
    ctx.fillStyle = alpha(c, 0.8);
    ctx.fillRect(x + 8 + i * cw + 2, barY, cw - 4, h * 0.22);
  });
}

function drawTowers(ctx: CanvasRenderingContext2D, L: SceneLayout, light: Lighting, standsTop: number): void {
  const lit = light.sun < 0.5;
  for (const fx of [0.16, 0.84]) {
    const x = L.W * fx;
    const base = standsTop + L.H * 0.02;
    const top = L.H * 0.04;
    ctx.strokeStyle = '#5f636c';
    ctx.lineWidth = Math.max(2, L.W * 0.008);
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, top + L.H * 0.05);
    ctx.stroke();
    const bw = L.W * 0.11;
    const bh = L.H * 0.05;
    ctx.fillStyle = '#33363e';
    ctx.fillRect(x - bw / 2, top, bw, bh);
    ctx.fillStyle = lit ? '#fff1b0' : '#d5d8de';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 6; c++) {
        ctx.beginPath();
        ctx.arc(x - bw / 2 + ((c + 0.5) / 6) * bw, top + ((r + 0.5) / 3) * bh, Math.max(1, bw * 0.05), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (lit) {
      const glow = ctx.createRadialGradient(x, top + bh / 2, 2, x, top + bh / 2, bw * 1.4);
      glow.addColorStop(0, 'rgba(255,240,190,0.4)');
      glow.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - bw * 1.4, top + bh / 2 - bw * 1.4, bw * 2.8, bw * 2.8);
    }
  }
}

/**
 * The playing surface from the wall down to the bottom of the stage: grass
 * with its checker cut, the clay skin and diamond, the mound, base paths,
 * the plate with its boxes and the foul lines.
 */
export function drawGround(ctx: CanvasRenderingContext2D, L: SceneLayout, bleed: SceneBleed, light: Lighting): void {
  const wallBase = L.proj(0, 400).y;
  const width = bleed.right - bleed.left;
  const { proj } = L;

  // Grass, hazier toward the wall.
  const grass = ctx.createLinearGradient(0, wallBase, 0, bleed.bottom);
  grass.addColorStop(0, light.grassFar);
  grass.addColorStop(0.25, light.grass);
  grass.addColorStop(1, light.grass);
  ctx.fillStyle = grass;
  ctx.fillRect(bleed.left, wallBase - 1, width, bleed.bottom - wallBase + 1);

  // Checker cut in perspective: lateral bands converging on the horizon,
  // crossed by depth bands.
  ctx.save();
  ctx.beginPath();
  ctx.rect(bleed.left, wallBase, width, bleed.bottom - wallBase);
  ctx.clip();
  ctx.fillStyle = alpha(light.grassAlt, 0.45);
  const band = 24;
  for (let lat = -600; lat < 600; lat += band * 2) {
    const a = proj(lat, 400);
    const b = proj(lat + band, 400);
    const c = proj(lat + band, -3);
    const d = proj(lat, -3);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = alpha(light.grassAlt, 0.3);
  for (let d = 0; d < 400; d += band * 2) {
    const y0 = proj(0, d + band).y;
    const y1 = proj(0, d).y;
    ctx.fillRect(bleed.left, y0, width, y1 - y0);
  }
  ctx.restore();

  const path = (pts: { x: number; y: number }[]) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  };

  // Warning track along the base of the wall.
  ctx.fillStyle = light.track;
  const trackTop = proj(0, 400).y;
  const trackBottom = proj(0, 372).y;
  ctx.fillRect(bleed.left, trackTop - 1, width, trackBottom - trackTop + 1);

  // The clay skin around the base paths, then the grass diamond inside them.
  ctx.fillStyle = light.dirt;
  path([proj(-3.5, -2), proj(-95, 63.6), proj(0, 140), proj(95, 63.6), proj(3.5, -2)]);
  ctx.fill();
  const inset = 6.4;
  ctx.fillStyle = light.grass;
  path([
    proj(0, inset * 2),
    proj(63.6 - inset, 63.6),
    proj(0, 127.3 - inset * 1.6),
    proj(-(63.6 - inset), 63.6),
  ]);
  ctx.fill();

  // Plate circle, then the mound on the grass.
  ctx.fillStyle = light.dirt;
  const circle: { x: number; y: number }[] = [];
  for (let i = 0; i <= 40; i++) {
    const ang = (i / 40) * Math.PI * 2;
    circle.push(proj(Math.cos(ang) * 11, Math.sin(ang) * 11));
  }
  path(circle);
  ctx.fill();
  if (light.wet > 0) {
    ctx.fillStyle = alpha('#2a1e14', 0.16 * light.wet);
    path(circle);
    ctx.fill();
  }

  drawMound(ctx, L, light);

  // Chalk: foul lines, batter's boxes, the plate.
  ctx.save();
  ctx.beginPath();
  ctx.rect(bleed.left, wallBase, width, bleed.bottom - wallBase);
  ctx.clip();
  ctx.strokeStyle = alpha(light.chalk, 0.9);
  ctx.lineWidth = Math.max(1.5, L.W * 0.006);
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const a = proj(side * 1.5, 1);
    const b = proj(side * 300, 300);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    const box = [proj(side * 2.2, 3), proj(side * 6.2, 3), proj(side * 6.2, -1.5), proj(side * 2.2, -1.5)];
    path(box);
    ctx.stroke();
  }
  ctx.restore();

  // Home plate, with a soft shadow so it sits in the clay.
  const plate = [proj(-1, 1), proj(1, 1), proj(1, 0), proj(0, -1), proj(-1, 0)];
  ctx.fillStyle = alpha('#000000', light.shadow);
  path(plate.map((p) => ({ x: p.x + 2, y: p.y + 3 })));
  ctx.fill();
  ctx.fillStyle = light.chalk;
  path(plate);
  ctx.fill();
}

function drawMound(ctx: CanvasRenderingContext2D, L: SceneLayout, light: Lighting): void {
  const centre = L.proj(0, MOUND_D);
  const rx = L.ppf(MOUND_D) * 9 * 1.5;
  const ry = (L.proj(0, MOUND_D - 9).y - L.proj(0, MOUND_D + 9).y) * 0.7;
  const hump = L.H * 0.028;

  // Ground shadow on the near side, the flat disc, then the hump.
  ctx.fillStyle = alpha('#000000', light.shadow * 0.7);
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y + ry * 0.4, rx * 1.02, ry * 1.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = light.dirtDark;
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  const dome = ctx.createLinearGradient(0, centre.y - hump, 0, centre.y + ry);
  dome.addColorStop(0, light.dirtLight);
  dome.addColorStop(0.6, light.dirt);
  dome.addColorStop(1, light.dirtDark);
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.moveTo(centre.x - rx * 0.85, centre.y + ry * 0.2);
  ctx.quadraticCurveTo(centre.x - rx * 0.5, centre.y - hump, centre.x, centre.y - hump);
  ctx.quadraticCurveTo(centre.x + rx * 0.5, centre.y - hump, centre.x + rx * 0.85, centre.y + ry * 0.2);
  ctx.quadraticCurveTo(centre.x, centre.y + ry * 0.9, centre.x - rx * 0.85, centre.y + ry * 0.2);
  ctx.closePath();
  ctx.fill();
  // Front lip, so the hump reads as rounded.
  ctx.fillStyle = alpha('#000000', 0.14);
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y + ry * 0.2, rx * 0.85, ry * 0.7, 0, 0, Math.PI);
  ctx.fill();
  // The rubber on the crest.
  ctx.fillStyle = light.chalk;
  ctx.fillRect(centre.x - rx * 0.18, centre.y - hump * 0.72, rx * 0.36, Math.max(1.5, hump * 0.14));
}

/** Where the pitcher's feet go, and how tall he is on screen. */
export function pitcherAnchor(L: SceneLayout): { x: number; y: number; h: number } {
  const c = L.proj(0, MOUND_D);
  return { x: c.x, y: c.y - L.H * 0.026, h: L.H * 0.135 };
}

/** Where the batter's feet go for a batter on `side` (-1 left of the plate, +1 right). */
export function batterAnchor(L: SceneLayout, side: -1 | 1): { x: number; y: number; h: number } {
  const p = L.proj(side * BATTER_LAT, 0.6);
  return { x: p.x, y: p.y + L.H * 0.035, h: L.H * 0.27 };
}

/** Haze over the far field on a wet day, so distance reads. */
export function drawHaze(ctx: CanvasRenderingContext2D, L: SceneLayout, bleed: SceneBleed, light: Lighting): void {
  if (light.cloud < 0.9) return;
  const g = ctx.createLinearGradient(0, L.horizon, 0, L.H * 0.6);
  g.addColorStop(0, alpha(mix(light.skyHorizon, '#ffffff', 0.2), 0.35));
  g.addColorStop(1, alpha(light.skyHorizon, 0));
  ctx.fillStyle = g;
  ctx.fillRect(bleed.left, L.horizon, bleed.right - bleed.left, L.H * 0.6 - L.horizon);
}
