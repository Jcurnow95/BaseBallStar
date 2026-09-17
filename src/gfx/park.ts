import type { Ballpark } from '../core/ballpark';
import { fenceAt, wallHeightAt } from '../core/ballpark';
import type { Vec2 } from '../core/fieldGeometry';
import { BASES, BASE_LEG, MOUND } from '../core/fieldGeometry';
import type { Camera } from './camera';
import { RISE } from './camera';
import type { Lighting } from './palette';
import { CROWD_COLOURS, alpha, hash, mix, scale as shade, unit } from './palette';

/**
 * The ballpark, drawn for the tilted field camera: the grounds outside the
 * gates, the playing field with its checker-cut grass and clay infield, the
 * warning track, a padded wall the park's own height all the way round, tiers
 * of seats climbing away behind it, grandstands and dugouts down each line,
 * and the light towers over everything.
 *
 * Ground is traced in feet under the camera's world transform, so it tilts
 * and scales for free. Anything with height — walls, tiers, towers — is
 * projected point by point so it stands up off the plane.
 */

/** Samples along the outfield wall, foul pole to foul pole. */
const WALL_STEPS = 64;
/** Samples along the seating bowl, which wraps past the poles to meet the grandstands. */
const BOWL_STEPS = 80;
/** Warning track width in feet. */
const TRACK = 16;
/** Concrete apron between the wall and the first row. */
const STAND_GAP = 5;
const STAND_ROWS = 8;
const ROW_DEPTH = 8;
/** Height gained per row, feet. */
const ROW_RISE = 2.6;
const SEAT_COUNT = 1700;

/** Grandstands down each line: where they start along the line, how far off it, their tiers. */
const SIDE_ALONG0 = 24;
const SIDE_OFFSET = 62;
const SIDE_ROWS = 4;
const SIDE_SEATS = 380;

/** Foul-ground wall down each line — the edge of the playing surface. */
const SIDE_WALL_OFFSET = SIDE_OFFSET - 2;
/** Backstop radius from the plate. */
const BACKSTOP = 64;
/** Height of the low wall round foul ground. */
const SIDE_WALL_HEIGHT = 4;

/** Dugouts: centred this far down the line, this far off it, this big. */
export const DUGOUT_ALONG = 78;
export const DUGOUT_OFFSET = 42;
export const DUGOUT_LENGTH = 60;
export const DUGOUT_DEPTH = 12;
const DUGOUT_ROOF_HEIGHT = 7;

/** Infield radius from the rubber to the outfield grass edge. */
const INFIELD_ARC = 95;
const BASEPATH_WIDTH = 4.5;
const MOUND_RADIUS = 9;
const HOME_CIRCLE = 13;
/** Bases drawn bigger than life so they read at phone scale. */
const BASE_SIZE = 2.6;

interface Seat {
  x: number;
  y: number;
  z: number;
  colour: string;
}

export interface DugoutSpots {
  rail: Vec2[];
  bench: Vec2[];
}

const dirAt = (angle: number): Vec2 => ({ x: Math.sin(angle), y: Math.cos(angle) });

export class ParkRenderer {
  readonly park: Ballpark;
  private readonly wallBearings: Vec2[] = [];
  private readonly bowlBearings: Vec2[] = [];
  /** How far down each line the grandstand runs before it meets the bowl. */
  private readonly sideEnd: Record<1 | -1, number>;
  private readonly seats: Seat[];

  constructor(park: Ballpark) {
    this.park = park;
    for (let i = 0; i <= WALL_STEPS; i++) {
      this.wallBearings.push(dirAt(-Math.PI / 4 + (i / WALL_STEPS) * (Math.PI / 2)));
    }
    const left = -this.meetAngle(-1, STAND_GAP, SIDE_OFFSET);
    const right = this.meetAngle(1, STAND_GAP, SIDE_OFFSET);
    for (let i = 0; i <= BOWL_STEPS; i++) {
      this.bowlBearings.push(dirAt(left + (i / BOWL_STEPS) * (right - left)));
    }
    this.sideEnd = {
      1: this.meetAlong(1, STAND_GAP, SIDE_OFFSET) - 3,
      [-1]: this.meetAlong(-1, STAND_GAP, SIDE_OFFSET) - 3,
    };
    this.seats = this.buildSeats();
  }

  /** Radius to the wall (or its continuation past the poles) plus `extra`. */
  private radiusAt(dir: Vec2, extra: number): number {
    return fenceAt(this.park, dir) + extra;
  }

  private pointAt(dir: Vec2, extra: number): Vec2 {
    const r = this.radiusAt(dir, extra);
    return { x: dir.x * r, y: dir.y * r };
  }

  /** Foul-line frame: `a` feet down the line, `o` feet off it into foul ground. */
  static sideAt(side: 1 | -1, a: number, o: number): Vec2 {
    return { x: (side * (a + o)) / Math.SQRT2, y: (a - o) / Math.SQRT2 };
  }

  /** Feet down a line where a strip `o` feet off it reaches the arc `extra` past the pole. */
  private meetAlong(side: 1 | -1, extra: number, o: number): number {
    const r = this.radiusAt(dirAt((side * Math.PI) / 4), extra);
    return Math.sqrt(Math.max(0, r * r - o * o));
  }

  /** Bearing (unsigned) of that meeting point. */
  private meetAngle(side: 1 | -1, extra: number, o: number): number {
    const a = this.meetAlong(side, extra, o);
    return Math.atan2(a + o, a - o);
  }

  /** The ball or a player is past the fence, out of the playing field. */
  isBeyondWall(p: Vec2): boolean {
    return Math.abs(p.x) <= p.y && Math.hypot(p.x, p.y) > fenceAt(this.park, p);
  }

  /* ------------------------------------------------------------- ground */

  /** Everything at ground level, in painter's order. */
  drawGround(ctx: CanvasRenderingContext2D, cam: Camera, light: Lighting): void {
    ctx.fillStyle = light.outside;
    ctx.fillRect(0, 0, cam.width, cam.height);

    cam.enterWorld(ctx);
    this.drawSurroundings(ctx, cam, light);
    this.drawGrass(ctx, cam, light);
    this.drawTrack(ctx, light);
    this.drawInfield(ctx, light);
    this.drawChalk(ctx, cam, light);
    cam.leaveWorld(ctx);
  }

  /**
   * Outline of the park: round the outfield `arcExtra` feet past the wall,
   * down each side `sideOff` feet off the lines, and round a backstop of
   * radius `back` behind the plate.
   */
  private traceFootprint(ctx: CanvasRenderingContext2D, arcExtra: number, sideOff: number, back: number): void {
    const left = -this.meetAngle(-1, arcExtra, sideOff);
    const right = this.meetAngle(1, arcExtra, sideOff);
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const p = this.pointAt(dirAt(left + (i / steps) * (right - left)), arcExtra);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    const radius = Math.max(back, sideOff + 8);
    const a = Math.sqrt(radius * radius - sideOff * sideOff);
    const pr = ParkRenderer.sideAt(1, a, sideOff);
    const pl = ParkRenderer.sideAt(-1, a, sideOff);
    ctx.lineTo(pr.x, pr.y);
    ctx.arc(0, 0, radius, Math.atan2(pr.y, pr.x), Math.atan2(pl.y, pl.x), true);
    ctx.closePath();
  }

  /** Concourse and trees around the park. World transform is active. */
  private drawSurroundings(ctx: CanvasRenderingContext2D, cam: Camera, light: Lighting): void {
    const bowlBack = STAND_GAP + STAND_ROWS * ROW_DEPTH;
    const sideBack = SIDE_OFFSET + SIDE_ROWS * ROW_DEPTH;
    ctx.fillStyle = light.concrete;
    ctx.beginPath();
    this.traceFootprint(ctx, bowlBack + 18, sideBack + 18, BACKSTOP + 30);
    ctx.fill();
    // Paving lines, faint.
    ctx.strokeStyle = alpha('#000000', 0.06);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    this.traceFootprint(ctx, bowlBack + 9, sideBack + 9, BACKSTOP + 22);
    ctx.stroke();

    const b = cam.bounds(30);
    for (let i = 0; i < 160; i++) {
      const h = hash(i + 900);
      const angle = -Math.PI * 0.8 + unit(h) * Math.PI * 1.6;
      const dir = dirAt(angle);
      const radius = this.outsideRadius(dir) + 16 + unit(h, 7) * 110;
      const x = dir.x * radius;
      const y = dir.y * radius;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      const r = 7 + unit(h, 3) * 8;
      ctx.fillStyle = alpha('#000000', light.shadow * 0.6);
      ctx.beginPath();
      ctx.ellipse(x + 3, y - 3, r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = unit(h, 11) > 0.5 ? light.tree : light.treeDark;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = alpha('#ffffff', 0.12);
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y + r * 0.3, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Radius to the outside edge of the concourse along a bearing. */
  private outsideRadius(dir: Vec2): number {
    const bowlBack = STAND_GAP + STAND_ROWS * ROW_DEPTH + 18;
    const angle = Math.atan2(dir.x, dir.y);
    const side: 1 | -1 = angle >= 0 ? 1 : -1;
    const limit = this.meetAngle(side, bowlBack, SIDE_OFFSET + SIDE_ROWS * ROW_DEPTH + 18);
    if (Math.abs(angle) <= limit) return this.radiusAt(dir, bowlBack);
    // Beyond the corner the edge runs down the side to the backstop.
    const o = SIDE_OFFSET + SIDE_ROWS * ROW_DEPTH + 18;
    const t = (Math.abs(angle) - limit) / (Math.PI - limit);
    const corner = this.radiusAt(dirAt(side * limit), bowlBack);
    return corner * (1 - t) + (BACKSTOP + 30 + o * 0.2) * t;
  }

  private drawGrass(ctx: CanvasRenderingContext2D, cam: Camera, light: Lighting): void {
    ctx.save();
    ctx.beginPath();
    this.traceFootprint(ctx, 0, SIDE_WALL_OFFSET, BACKSTOP);
    ctx.clip();

    ctx.fillStyle = light.grass;
    const b = cam.bounds(20);
    ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);

    // Checker cut: two families of stripes, each parallel to a foul line.
    // Where a dark band from one crosses a dark band from the other the
    // grass is darkest, which is the mown diamond pattern of a real park.
    const band = 30;
    ctx.fillStyle = alpha(light.grassAlt, 0.5);
    for (const d of [
      { x: Math.SQRT1_2, y: Math.SQRT1_2 },
      { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
    ]) {
      const n = { x: -d.y, y: d.x };
      const cu = n.x * cam.x + n.y * cam.y;
      const cv = d.x * cam.x + d.y * cam.y;
      const span = (b.maxX - b.minX + b.maxY - b.minY) / 2 + band;
      const from = Math.floor((cu - span) / band);
      const to = Math.ceil((cu + span) / band);
      ctx.beginPath();
      for (let i = from; i <= to; i++) {
        if (i % 2 !== 0) continue;
        const u0 = i * band;
        const u1 = u0 + band;
        ctx.moveTo(n.x * u0 + d.x * (cv - span), n.y * u0 + d.y * (cv - span));
        ctx.lineTo(n.x * u1 + d.x * (cv - span), n.y * u1 + d.y * (cv - span));
        ctx.lineTo(n.x * u1 + d.x * (cv + span), n.y * u1 + d.y * (cv + span));
        ctx.lineTo(n.x * u0 + d.x * (cv + span), n.y * u0 + d.y * (cv + span));
        ctx.closePath();
      }
      ctx.fill();
    }

    if (light.wet > 0) {
      ctx.fillStyle = alpha('#9fc4ff', 0.08 * light.wet);
      ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    }
    ctx.restore();
  }

  private drawTrack(ctx: CanvasRenderingContext2D, light: Lighting): void {
    ctx.fillStyle = light.track;
    ctx.beginPath();
    for (let i = 0; i <= BOWL_STEPS; i++) {
      const p = this.pointAt(this.bowlBearings[i], -TRACK);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = BOWL_STEPS; i >= 0; i--) {
      const p = this.pointAt(this.bowlBearings[i], 1);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();

    // A strip along each side wall too.
    for (const side of [-1, 1] as const) {
      const end = this.meetAlong(side, -TRACK, SIDE_WALL_OFFSET);
      const pts = [
        ParkRenderer.sideAt(side, 26, SIDE_WALL_OFFSET - 9),
        ParkRenderer.sideAt(side, end, SIDE_WALL_OFFSET - 9),
        ParkRenderer.sideAt(side, end + 12, SIDE_WALL_OFFSET + 2),
        ParkRenderer.sideAt(side, 26, SIDE_WALL_OFFSET + 2),
      ];
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Clay, the grass diamond inside it, the mound and the plate circle. */
  private drawInfield(ctx: CanvasRenderingContext2D, light: Lighting): void {
    // Where the 95-foot arc meets the foul lines.
    const meet = (121 + Math.sqrt(121 * 121 + 8 * (INFIELD_ARC * INFIELD_ARC - MOUND.y * MOUND.y))) / 4;
    const a0 = Math.atan2(meet - MOUND.y, meet);
    const a1 = Math.atan2(meet - MOUND.y, -meet);
    const lip = 3.5;
    const nR = { x: lip / Math.SQRT2, y: -lip / Math.SQRT2 };
    const nL = { x: -lip / Math.SQRT2, y: -lip / Math.SQRT2 };

    const clay = () => {
      ctx.beginPath();
      ctx.moveTo(nR.x, nR.y - 2);
      ctx.lineTo(meet + nR.x, meet + nR.y);
      ctx.arc(MOUND.x, MOUND.y, INFIELD_ARC, a0, a1, false);
      ctx.lineTo(nL.x, nL.y - 2);
      ctx.closePath();
    };
    ctx.fillStyle = light.dirt;
    clay();
    ctx.fill();

    // Grass inside the base paths.
    const centre = { x: 0, y: BASE_LEG };
    const inset = BASEPATH_WIDTH * Math.SQRT2;
    ctx.fillStyle = light.grass;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const b = BASES[i];
      const dx = centre.x - b.x;
      const dy = centre.y - b.y;
      const len = Math.hypot(dx, dy);
      const p = { x: b.x + (dx / len) * inset, y: b.y + (dy / len) * inset };
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = alpha(light.grassAlt, 0.4);
    ctx.beginPath();
    ctx.moveTo(-14, BASE_LEG);
    ctx.lineTo(0, BASE_LEG * 2 - inset);
    ctx.lineTo(14, BASE_LEG);
    ctx.lineTo(0, inset);
    ctx.closePath();
    ctx.fill();

    // Cut-outs around the bases and the plate.
    ctx.fillStyle = light.dirt;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(BASES[i].x, BASES[i].y, 8.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, HOME_CIRCLE, 0, Math.PI * 2);
    ctx.fill();

    // The mound: a raised disc, lit at the crown, shadowed on the near side.
    ctx.fillStyle = alpha('#000000', light.shadow * 0.5);
    ctx.beginPath();
    ctx.ellipse(MOUND.x + 1.5, MOUND.y - 2, MOUND_RADIUS + 1, MOUND_RADIUS * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    const dome = ctx.createRadialGradient(MOUND.x, MOUND.y + 2, 1, MOUND.x, MOUND.y, MOUND_RADIUS);
    dome.addColorStop(0, light.dirtLight);
    dome.addColorStop(0.7, light.dirt);
    dome.addColorStop(1, light.dirtDark);
    ctx.fillStyle = dome;
    ctx.beginPath();
    ctx.arc(MOUND.x, MOUND.y, MOUND_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = light.chalk;
    ctx.fillRect(MOUND.x - 1.2, MOUND.y - 0.3, 2.4, 0.7);

    if (light.wet > 0) {
      ctx.fillStyle = alpha('#2a1e14', 0.16 * light.wet);
      clay();
      ctx.fill();
    }
  }

  /** Foul lines, boxes, lanes, bases and the plate. */
  private drawChalk(ctx: CanvasRenderingContext2D, cam: Camera, light: Lighting): void {
    const lineW = Math.max(0.6, 1.4 / cam.scale);
    ctx.strokeStyle = alpha(light.chalk, 0.92);
    ctx.fillStyle = alpha(light.chalk, 0.92);
    ctx.lineWidth = lineW;
    ctx.lineCap = 'butt';

    for (const side of [-1, 1] as const) {
      const pole = this.pointAt(dirAt((side * Math.PI) / 4), 2);
      ctx.beginPath();
      ctx.moveTo(side * 1.2, 1.2);
      ctx.lineTo(pole.x, pole.y);
      ctx.stroke();

      const box = [
        ParkRenderer.sideAt(side, 72, 12),
        ParkRenderer.sideAt(side, 92, 12),
        ParkRenderer.sideAt(side, 92, 22),
        ParkRenderer.sideAt(side, 72, 22),
      ];
      ctx.beginPath();
      box.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();

      const deck = ParkRenderer.sideAt(side, 14, 30);
      ctx.beginPath();
      ctx.arc(deck.x, deck.y, 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    const laneA = ParkRenderer.sideAt(1, 45, 0);
    const laneB = ParkRenderer.sideAt(1, 45, 3);
    const laneC = ParkRenderer.sideAt(1, 90, 3);
    ctx.beginPath();
    ctx.moveTo(laneA.x, laneA.y);
    ctx.lineTo(laneB.x, laneB.y);
    ctx.lineTo(laneC.x, laneC.y);
    ctx.stroke();

    for (const side of [-1, 1]) {
      ctx.strokeRect(side > 0 ? 1.3 : -5.3, -3, 4, 6);
    }
    ctx.strokeRect(-1.9, -11, 3.8, 8);

    for (let i = 1; i <= 3; i++) {
      const b = BASES[i];
      const s = BASE_SIZE;
      ctx.fillStyle = alpha('#000000', light.shadow);
      ctx.beginPath();
      ctx.moveTo(b.x + 0.6, b.y - s - 0.6);
      ctx.lineTo(b.x + s + 0.6, b.y - 0.6);
      ctx.lineTo(b.x + 0.6, b.y + s - 0.6);
      ctx.lineTo(b.x - s + 0.6, b.y - 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = light.chalk;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y - s);
      ctx.lineTo(b.x + s, b.y);
      ctx.lineTo(b.x, b.y + s);
      ctx.lineTo(b.x - s, b.y);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = light.chalk;
    ctx.beginPath();
    ctx.moveTo(-1.3, 1.2);
    ctx.lineTo(1.3, 1.2);
    ctx.lineTo(1.3, 0);
    ctx.lineTo(0, -1.3);
    ctx.lineTo(-1.3, 0);
    ctx.closePath();
    ctx.fill();
  }

  /* ------------------------------------------------------------- stands */

  private buildSeats(): Seat[] {
    const seats: (Seat & { order: number })[] = [];
    const add = (x: number, y: number, z: number, h: number) =>
      seats.push({
        x,
        y,
        z,
        colour: CROWD_COLOURS[h % CROWD_COLOURS.length],
        order: Math.imul(h ^ 0x9e3779b9, 2246822519) >>> 0,
      });

    const left = Math.atan2(this.bowlBearings[0].x, this.bowlBearings[0].y);
    const right = Math.atan2(this.bowlBearings[BOWL_STEPS].x, this.bowlBearings[BOWL_STEPS].y);
    for (let i = 0; i < SEAT_COUNT; i++) {
      const h = hash(i);
      const dir = dirAt(left + unit(h) * (right - left));
      const row = (h >>> 4) % STAND_ROWS;
      const radius = this.radiusAt(dir, STAND_GAP + row * ROW_DEPTH + 2 + unit(h, 9) * (ROW_DEPTH - 4));
      add(dir.x * radius, dir.y * radius, row * ROW_RISE + 2.2, h);
    }
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < SIDE_SEATS; i++) {
        const h = hash(i + (side > 0 ? 70001 : 40009));
        const a = SIDE_ALONG0 + 3 + unit(h) * (this.sideEnd[side] - SIDE_ALONG0 - 6);
        const row = (h >>> 4) % SIDE_ROWS;
        const o = SIDE_OFFSET + row * ROW_DEPTH + 2 + unit(h, 9) * (ROW_DEPTH - 4);
        const p = ParkRenderer.sideAt(side, a, o);
        add(p.x, p.y, row * ROW_RISE + 2.2, h);
      }
    }
    seats.sort((p, q) => p.order - q.order);
    return seats;
  }

  /** Tiers of seats behind the wall and down both lines, with the crowd in them. */
  drawStands(ctx: CanvasRenderingContext2D, cam: Camera, light: Lighting, crowd: number): void {
    // Grandstands first: the bowl's corners overlap their far ends.
    for (const side of [-1, 1] as const) {
      const end = this.sideEnd[side];
      this.fillSideBand(ctx, cam, side, end, light.concreteDark, SIDE_OFFSET - 4, SIDE_OFFSET, 0, 0);
      for (let row = 0; row < SIDE_ROWS; row++) {
        const o0 = SIDE_OFFSET + row * ROW_DEPTH;
        const z = row * ROW_RISE;
        if (row > 0) this.fillSideBand(ctx, cam, side, end, shade(light.seats, 0.55), o0, o0, z - ROW_RISE, z);
        this.fillSideBand(ctx, cam, side, end, row % 2 === 0 ? light.seats : light.seatsAlt, o0, o0 + ROW_DEPTH, z, z);
      }
      const back = SIDE_OFFSET + SIDE_ROWS * ROW_DEPTH;
      this.fillSideBand(ctx, cam, side, end, shade(light.concrete, 0.8), back, back, SIDE_ROWS * ROW_RISE - ROW_RISE, SIDE_ROWS * ROW_RISE + 1);
    }

    this.fillArcBand(ctx, cam, light.concreteDark, 0, STAND_GAP, 0, 0);
    for (let row = 0; row < STAND_ROWS; row++) {
      const r0 = STAND_GAP + row * ROW_DEPTH;
      const z = row * ROW_RISE;
      if (row > 0) this.fillArcBand(ctx, cam, shade(light.seats, 0.55), r0, r0, z - ROW_RISE, z);
      this.fillArcBand(ctx, cam, row % 2 === 0 ? light.seats : light.seatsAlt, r0, r0 + ROW_DEPTH, z, z);
    }
    const backR = STAND_GAP + STAND_ROWS * ROW_DEPTH;
    this.fillArcBand(ctx, cam, shade(light.concrete, 0.8), backR, backR, STAND_ROWS * ROW_RISE - ROW_RISE, STAND_ROWS * ROW_RISE + 1);

    this.drawCrowd(ctx, cam, crowd);
  }

  /** A band between two radial offsets from the wall, at two heights (front, back). */
  private fillArcBand(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    colour: string,
    r0: number,
    r1: number,
    z0: number,
    z1: number,
  ): void {
    ctx.fillStyle = colour;
    ctx.beginPath();
    for (let i = 0; i <= BOWL_STEPS; i++) {
      const p = cam.project(this.pointAt(this.bowlBearings[i], r0), z0);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = BOWL_STEPS; i >= 0; i--) {
      const p = cam.project(this.pointAt(this.bowlBearings[i], r1), z1);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  }

  private fillSideBand(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    side: 1 | -1,
    end: number,
    colour: string,
    o0: number,
    o1: number,
    z0: number,
    z1: number,
  ): void {
    const pts = [
      cam.project(ParkRenderer.sideAt(side, SIDE_ALONG0, o0), z0),
      cam.project(ParkRenderer.sideAt(side, end, o0), z0),
      cam.project(ParkRenderer.sideAt(side, end, o1), z1),
      cam.project(ParkRenderer.sideAt(side, SIDE_ALONG0, o1), z1),
    ];
    ctx.fillStyle = colour;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  }

  private drawCrowd(ctx: CanvasRenderingContext2D, cam: Camera, crowd: number): void {
    const taken = Math.round(this.seats.length * Math.max(0, Math.min(1, crowd)));
    if (taken <= 0) return;
    const w = Math.max(1.6, 1.3 * cam.scale);
    const h = Math.max(2, 2 * cam.scale);
    for (let i = 0; i < taken; i++) {
      const seat = this.seats[i];
      const p = cam.project(seat, seat.z);
      if (!cam.onScreen(p, 6)) continue;
      ctx.fillStyle = seat.colour;
      ctx.fillRect(p.x - w / 2, p.y - h, w, h);
    }
  }

  /* ---------------------------------------------------------------- wall */

  /** The outfield wall standing up off the track, the low foul-ground wall, poles, distances. */
  drawWall(ctx: CanvasRenderingContext2D, cam: Camera, light: Lighting): void {
    const rise = cam.scale * RISE;

    // Low wall round foul ground: the bowl corners beyond the poles, and down each line.
    ctx.fillStyle = light.wallDark;
    const lowH = SIDE_WALL_HEIGHT * rise;
    const corner = (from: number, to: number) => {
      ctx.beginPath();
      for (let i = from; i <= to; i++) {
        const p = cam.project(this.pointAt(this.bowlBearings[i], 0));
        if (i === from) ctx.moveTo(p.x, p.y + 0.5);
        else ctx.lineTo(p.x, p.y + 0.5);
      }
      for (let i = to; i >= from; i--) {
        const p = cam.project(this.pointAt(this.bowlBearings[i], 0));
        ctx.lineTo(p.x, p.y - lowH);
      }
      ctx.closePath();
      ctx.fill();
    };
    const poleIndexL = this.bowlBearings.findIndex((d) => Math.atan2(d.x, d.y) >= -Math.PI / 4);
    const poleIndexR = this.bowlBearings.findIndex((d) => Math.atan2(d.x, d.y) > Math.PI / 4) - 1;
    corner(0, Math.max(0, poleIndexL));
    corner(Math.min(BOWL_STEPS, poleIndexR), BOWL_STEPS);
    for (const side of [-1, 1] as const) {
      const w0 = cam.project(ParkRenderer.sideAt(side, 22, SIDE_WALL_OFFSET));
      const w1 = cam.project(ParkRenderer.sideAt(side, this.meetAlong(side, 0, SIDE_WALL_OFFSET), SIDE_WALL_OFFSET));
      ctx.beginPath();
      ctx.moveTo(w0.x, w0.y + 0.5);
      ctx.lineTo(w1.x, w1.y + 0.5);
      ctx.lineTo(w1.x, w1.y - lowH);
      ctx.lineTo(w0.x, w0.y - lowH);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = light.wallCap;
      ctx.lineWidth = Math.max(1, 0.45 * cam.scale);
      ctx.beginPath();
      ctx.moveTo(w0.x, w0.y - lowH);
      ctx.lineTo(w1.x, w1.y - lowH);
      ctx.stroke();
    }

    // The outfield wall proper: one quad per segment, shaded toward the sides.
    const base = this.wallBearings.map((dir) => cam.project(this.pointAt(dir, 0)));
    const heights = this.wallBearings.map((dir) => wallHeightAt(this.park, dir));
    for (let i = 0; i < WALL_STEPS; i++) {
      const b0 = base[i];
      const b1 = base[i + 1];
      const facing = Math.abs(this.wallBearings[i].x);
      ctx.fillStyle = mix(light.wall, light.wallDark, facing * 0.8);
      ctx.beginPath();
      ctx.moveTo(b0.x, b0.y + 0.5);
      ctx.lineTo(b1.x, b1.y + 0.5);
      ctx.lineTo(b1.x, b1.y - heights[i + 1] * rise);
      ctx.lineTo(b0.x, b0.y - heights[i] * rise);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = alpha('#000000', 0.18);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 4; i < WALL_STEPS; i += 4) {
      ctx.moveTo(base[i].x, base[i].y);
      ctx.lineTo(base[i].x, base[i].y - heights[i] * rise);
    }
    ctx.stroke();
    ctx.strokeStyle = light.wallCap;
    ctx.lineWidth = Math.max(1.5, 0.7 * cam.scale);
    ctx.beginPath();
    for (let i = 0; i <= WALL_STEPS; i++) {
      const p = base[i];
      if (i === 0) ctx.moveTo(p.x, p.y - heights[i] * rise);
      else ctx.lineTo(p.x, p.y - heights[i] * rise);
    }
    ctx.stroke();

    if (cam.scale > 1.7) {
      ctx.fillStyle = alpha('#ffffff', 0.85);
      ctx.font = `bold ${Math.round(cam.scale * 3.6)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const i of [4, WALL_STEPS / 4, WALL_STEPS / 2, (WALL_STEPS * 3) / 4, WALL_STEPS - 4]) {
        const p = base[i];
        if (!cam.onScreen(p)) continue;
        ctx.fillText(String(Math.round(fenceAt(this.park, this.wallBearings[i]))), p.x, p.y - (heights[i] * rise) / 2);
      }
    }

    for (const i of [0, WALL_STEPS]) {
      const p = base[i];
      const top = p.y - 55 * rise;
      ctx.strokeStyle = '#f2d34b';
      ctx.lineWidth = Math.max(2, 0.9 * cam.scale);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, top);
      ctx.stroke();
      ctx.fillStyle = '#f2d34b';
      ctx.fillRect(i === 0 ? p.x : p.x - 3 * cam.scale, top, 3 * cam.scale, 0.8 * cam.scale);
    }
  }

  /** Light towers over the bowl. Tall, so they're drawn last of the scenery. */
  drawTowers(ctx: CanvasRenderingContext2D, cam: Camera, light: Lighting): void {
    const rise = cam.scale * RISE;
    const lit = light.sun < 0.5;
    for (const angle of [-0.68, -0.24, 0.24, 0.68]) {
      const dir = dirAt(angle);
      const radius = this.outsideRadius(dir) - 8;
      const foot = cam.project({ x: dir.x * radius, y: dir.y * radius });
      if (foot.x < -60 || foot.x > cam.width + 60) continue;
      const top = foot.y - 120 * rise;
      if (top > cam.height + 20 || foot.y < -20) continue;

      ctx.strokeStyle = '#6b6f78';
      ctx.lineWidth = Math.max(1.5, 0.6 * cam.scale);
      ctx.beginPath();
      ctx.moveTo(foot.x, foot.y);
      ctx.lineTo(foot.x, top);
      ctx.stroke();

      const bankW = 12 * cam.scale;
      const bankH = 7 * cam.scale;
      ctx.fillStyle = '#3a3e47';
      ctx.fillRect(foot.x - bankW / 2, top - bankH, bankW, bankH);
      ctx.fillStyle = lit ? '#fff2b8' : '#c9ccd3';
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
          ctx.beginPath();
          ctx.arc(
            foot.x - bankW / 2 + ((c + 0.5) / 5) * bankW,
            top - bankH + ((r + 0.5) / 3) * bankH,
            Math.max(0.8, cam.scale * 0.55),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      if (lit) {
        const glow = ctx.createRadialGradient(foot.x, top - bankH / 2, 2, foot.x, top - bankH / 2, bankW * 1.6);
        glow.addColorStop(0, 'rgba(255,240,190,0.35)');
        glow.addColorStop(1, 'rgba(255,240,190,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(foot.x - bankW * 1.6, top - bankH / 2 - bankW * 1.6, bankW * 3.2, bankW * 3.2);
      }
    }
  }

  /* ------------------------------------------------------------- dugouts */

  /**
   * The sunken part of a dugout: apron, walls and floor, the bench in the
   * team's colour. Returns where the bench players stand and sit so the
   * caller can draw them before `drawDugoutRoof` covers the back.
   */
  drawDugoutPit(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    light: Lighting,
    side: 1 | -1,
    shirt: string,
  ): DugoutSpots | null {
    const at = (a: number, o: number, z = 0) => cam.project(ParkRenderer.sideAt(side, a, o), z);
    const a0 = DUGOUT_ALONG - DUGOUT_LENGTH / 2;
    const a1 = DUGOUT_ALONG + DUGOUT_LENGTH / 2;
    const o0 = DUGOUT_OFFSET;
    const o1 = DUGOUT_OFFSET + DUGOUT_DEPTH;

    const corners = [at(a0, o0), at(a1, o0), at(a1, o1), at(a0, o1)];
    if (corners.every((c) => !cam.onScreen(c, 80))) return null;

    const poly = (pts: Vec2[]) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
    };

    ctx.fillStyle = light.dirt;
    poly([at(a0 - 3, o0 - 5), at(a1 + 3, o0 - 5), at(a1 + 3, o0 + 0.5), at(a0 - 3, o0 + 0.5)]);
    ctx.fill();
    ctx.fillStyle = light.concrete;
    poly([at(a0 - 2, o0 - 0.5), at(a1 + 2, o0 - 0.5), at(a1 + 2, o1 + 2), at(a0 - 2, o1 + 2)]);
    ctx.fill();
    ctx.fillStyle = shade(light.concreteDark, 0.7);
    poly(corners);
    ctx.fill();
    for (const [s0, s1] of [[a0 + 0.5, a0 + 6], [a1 - 6, a1 - 0.5]]) {
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = shade(light.concrete, 0.95 - k * 0.1);
        poly([at(s0, o0 + k * 1.3), at(s1, o0 + k * 1.3), at(s1, o0 + (k + 1) * 1.3), at(s0, o0 + (k + 1) * 1.3)]);
        ctx.fill();
      }
    }
    ctx.fillStyle = shirt;
    poly([at(a0 + 3, o1 - 4.2, 1.5), at(a1 - 3, o1 - 4.2, 1.5), at(a1 - 3, o1 - 1.8, 1.5), at(a0 + 3, o1 - 1.8, 1.5)]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const rail: Vec2[] = [];
    const bench: Vec2[] = [];
    for (let i = 0; i < 5; i++) {
      const stagger = ((i * 7 + (side > 0 ? 3 : 0)) % 5) * 0.6;
      rail.push(ParkRenderer.sideAt(side, a0 + 9 + i * ((DUGOUT_LENGTH - 18) / 4), o0 + 3.5 + stagger));
    }
    for (let i = 0; i < 3; i++) {
      bench.push(ParkRenderer.sideAt(side, DUGOUT_ALONG + (i - 1) * 10, o1 - 3.2));
    }
    return { rail, bench };
  }

  /** The roof over the back of the pit, and the rail along the front. */
  drawDugoutRoof(ctx: CanvasRenderingContext2D, cam: Camera, light: Lighting, side: 1 | -1): void {
    const at = (a: number, o: number, z = 0) => cam.project(ParkRenderer.sideAt(side, a, o), z);
    const a0 = DUGOUT_ALONG - DUGOUT_LENGTH / 2;
    const a1 = DUGOUT_ALONG + DUGOUT_LENGTH / 2;
    const o0 = DUGOUT_OFFSET;
    const o1 = DUGOUT_OFFSET + DUGOUT_DEPTH;
    const poly = (pts: Vec2[]) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
    };

    ctx.fillStyle = shade(light.concrete, 0.72);
    poly([at(a0 - 2, o1 + 2), at(a1 + 2, o1 + 2), at(a1 + 2, o1 + 2, DUGOUT_ROOF_HEIGHT), at(a0 - 2, o1 + 2, DUGOUT_ROOF_HEIGHT)]);
    ctx.fill();
    ctx.fillStyle = alpha(shade(light.concrete, 1.05), 0.92);
    poly([
      at(a0 - 2, o1 - 5.5, DUGOUT_ROOF_HEIGHT),
      at(a1 + 2, o1 - 5.5, DUGOUT_ROOF_HEIGHT),
      at(a1 + 2, o1 + 2, DUGOUT_ROOF_HEIGHT),
      at(a0 - 2, o1 + 2, DUGOUT_ROOF_HEIGHT),
    ]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const r0 = at(a0 + 7, o0, 2.8);
    const r1 = at(a1 - 7, o0, 2.8);
    ctx.strokeStyle = '#e8ebf2';
    ctx.lineWidth = Math.max(1.5, 0.6 * cam.scale);
    ctx.beginPath();
    ctx.moveTo(r0.x, r0.y);
    ctx.lineTo(r1.x, r1.y);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k <= 4; k++) {
      const a = a0 + 7 + ((a1 - a0 - 14) * k) / 4;
      const p0 = at(a, o0);
      const p1 = at(a, o0, 2.8);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    ctx.stroke();
  }
}
