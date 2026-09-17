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
const ROW_DEPTH = 8;
/** Height gained per row, feet. */
const ROW_RISE = 2.6;
/** People per row of each section: the bowl is long, the sides and the backstop shorter. */
const BOWL_SEATS_PER_ROW = 210;
const SIDE_SEATS_PER_ROW = 95;
const HOME_SEATS_PER_ROW = 80;
/** A second deck: how far it sits above the lower deck's top row, and how far it hangs over it. */
const DECK_RISE = 9;
const DECK_OVERHANG = 12;
/** Seats behind the plate wrap this far round (radians) from dead behind, to meet the grandstands. */
const HOME_HALF_SPAN = 1.22;
const HOME_STEPS = 40;

/** Grandstands down each line: where they start along the line, how far off it. */
const SIDE_ALONG0 = 24;
const SIDE_OFFSET = 62;

/**
 * How much stadium there is. Single-A is a few rows of bleachers past the
 * wall; the Majors is a bowl all the way round with a second deck on top.
 * It is the quickest read on where a career has got to, so each rung of the
 * ladder gets its own silhouette rather than the same park with more people.
 */
export interface StadiumSpec {
  /** Rows of seats round the outfield, past the wall. */
  bowlRows: number;
  /** Rows down each foul line. */
  sideRows: number;
  /** Rows wrapping behind the plate, joining the two grandstands. 0 for none. */
  homeRows: number;
  /** Rows in a second deck over every section. 0 for a single-deck park. */
  upperRows: number;
}

/** The park a rung of the ladder plays in. */
export function stadiumForLevel(levelId: number): StadiumSpec {
  switch (Math.max(0, Math.round(levelId))) {
    case 0:
      return { bowlRows: 4, sideRows: 2, homeRows: 0, upperRows: 0 };
    case 1:
      return { bowlRows: 6, sideRows: 3, homeRows: 3, upperRows: 0 };
    case 2:
      return { bowlRows: 8, sideRows: 4, homeRows: 5, upperRows: 0 };
    default:
      return { bowlRows: 8, sideRows: 5, homeRows: 6, upperRows: 6 };
  }
}

/** What the renderer draws when nobody says: the old single-deck park. */
const DEFAULT_STADIUM: StadiumSpec = { bowlRows: 8, sideRows: 4, homeRows: 0, upperRows: 0 };

/** Foul-ground wall down each line — the edge of the playing surface. */
const SIDE_WALL_OFFSET = SIDE_OFFSET - 2;
/** Backstop radius from the plate. */
const BACKSTOP = 64;
/** Where the first row behind the plate starts: just past the backstop. */
const HOME_GAP = BACKSTOP + 2;
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
  readonly spec: StadiumSpec;
  private readonly wallBearings: Vec2[] = [];
  private readonly bowlBearings: Vec2[] = [];
  /** How far down each line the grandstand runs before it meets the bowl. */
  private readonly sideEnd: Record<1 | -1, number>;
  private readonly seats: Seat[];

  constructor(park: Ballpark, spec: StadiumSpec = DEFAULT_STADIUM) {
    this.park = park;
    this.spec = spec;
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

  /* ----------------------------------------------------- stadium extents */

  /** How much further out a second deck pushes the back of every section. */
  private upperExtra(): number {
    return this.spec.upperRows > 0 ? Math.max(0, this.spec.upperRows * ROW_DEPTH - DECK_OVERHANG) : 0;
  }

  /** Radial offset past the wall to the back of the outfield seating. */
  private bowlBack(): number {
    return STAND_GAP + this.spec.bowlRows * ROW_DEPTH + this.upperExtra();
  }

  /** Offset off each foul line to the back of the grandstands. */
  private sideBack(): number {
    return SIDE_OFFSET + this.spec.sideRows * ROW_DEPTH + this.upperExtra();
  }

  /** Radius from the plate to the back of whatever is behind it. */
  private homeBack(): number {
    return this.spec.homeRows > 0
      ? HOME_GAP + this.spec.homeRows * ROW_DEPTH + this.upperExtra()
      : BACKSTOP;
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
    const bowlBack = this.bowlBack();
    const sideBack = this.sideBack();
    const homeBack = this.homeBack();
    ctx.fillStyle = light.concrete;
    ctx.beginPath();
    this.traceFootprint(ctx, bowlBack + 18, sideBack + 18, homeBack + 30);
    ctx.fill();
    // Paving lines, faint.
    ctx.strokeStyle = alpha('#000000', 0.06);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    this.traceFootprint(ctx, bowlBack + 9, sideBack + 9, homeBack + 22);
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
    const bowlBack = this.bowlBack() + 18;
    const angle = Math.atan2(dir.x, dir.y);
    const side: 1 | -1 = angle >= 0 ? 1 : -1;
    const o = this.sideBack() + 18;
    const limit = this.meetAngle(side, bowlBack, o);
    if (Math.abs(angle) <= limit) return this.radiusAt(dir, bowlBack);
    // Beyond the corner the edge runs down the side to the backstop.
    const t = (Math.abs(angle) - limit) / (Math.PI - limit);
    const corner = this.radiusAt(dirAt(side * limit), bowlBack);
    return corner * (1 - t) + (this.homeBack() + 30 + o * 0.2) * t;
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

  /**
   * Where the people sit. Each section is scattered row by row: `place`
   * turns a row's offset from the section's front and a 0-1 position along
   * it into a spot on the ground, and the height comes from the row. A park
   * with a second deck gets the same scatter again, further out and up.
   */
  private buildSeats(): Seat[] {
    const seats: (Seat & { order: number })[] = [];
    const spec = this.spec;
    const add = (p: Vec2, z: number, h: number) =>
      seats.push({
        x: p.x,
        y: p.y,
        z,
        colour: CROWD_COLOURS[h % CROWD_COLOURS.length],
        order: Math.imul(h ^ 0x9e3779b9, 2246822519) >>> 0,
      });

    let salt = 0;
    const scatter = (
      rows: number,
      perRow: number,
      o0: number,
      z0: number,
      place: (o: number, u: number) => Vec2,
    ): void => {
      salt += 100003;
      for (let i = 0; i < rows * perRow; i++) {
        const h = hash(i + salt);
        const row = (h >>> 4) % rows;
        const o = o0 + row * ROW_DEPTH + 2 + unit(h, 9) * (ROW_DEPTH - 4);
        add(place(o, unit(h)), z0 + row * ROW_RISE + 2.2, h);
      }
    };
    const section = (
      rows: number,
      perRow: number,
      o0: number,
      place: (o: number, u: number) => Vec2,
    ): void => {
      if (rows <= 0) return;
      scatter(rows, perRow, o0, 0, place);
      if (spec.upperRows > 0) {
        const back = o0 + rows * ROW_DEPTH;
        scatter(spec.upperRows, perRow, back - DECK_OVERHANG, rows * ROW_RISE + DECK_RISE, place);
      }
    };

    const left = Math.atan2(this.bowlBearings[0].x, this.bowlBearings[0].y);
    const right = Math.atan2(this.bowlBearings[BOWL_STEPS].x, this.bowlBearings[BOWL_STEPS].y);
    section(spec.bowlRows, BOWL_SEATS_PER_ROW, STAND_GAP, (o, u) =>
      this.pointAt(dirAt(left + u * (right - left)), o),
    );
    for (const side of [-1, 1] as const) {
      section(spec.sideRows, SIDE_SEATS_PER_ROW, SIDE_OFFSET, (o, u) =>
        ParkRenderer.sideAt(side, SIDE_ALONG0 + 3 + u * (this.sideEnd[side] - SIDE_ALONG0 - 6), o),
      );
    }
    section(spec.homeRows, HOME_SEATS_PER_ROW, HOME_GAP, (o, u) => {
      const dir = dirAt(Math.PI - HOME_HALF_SPAN + u * 2 * HOME_HALF_SPAN);
      return { x: dir.x * o, y: dir.y * o };
    });
    seats.sort((p, q) => p.order - q.order);
    return seats;
  }

  /**
   * Tiers of seats behind the wall, down both lines and — in the bigger
   * parks — round behind the plate, with a second deck over the lot in the
   * biggest, and the crowd in them.
   */
  drawStands(ctx: CanvasRenderingContext2D, cam: Camera, light: Lighting, crowd: number): void {
    type Band = (colour: string, o0: number, o1: number, z0: number, z1: number) => void;
    const spec = this.spec;

    // Rows from `o0` outward and `z0` upward: riser, tread, riser, tread,
    // then the wall along the back. Returns how high the back row got.
    const tier = (band: Band, rows: number, o0: number, z0: number): number => {
      for (let row = 0; row < rows; row++) {
        const o = o0 + row * ROW_DEPTH;
        const z = z0 + row * ROW_RISE;
        if (row > 0) band(shade(light.seats, 0.55), o, o, z - ROW_RISE, z);
        band(row % 2 === 0 ? light.seats : light.seatsAlt, o, o + ROW_DEPTH, z, z);
      }
      const back = o0 + rows * ROW_DEPTH;
      const top = z0 + rows * ROW_RISE;
      band(shade(light.concrete, 0.8), back, back, top - ROW_RISE, top + 1);
      return top;
    };
    // A whole section: the apron in front, the lower deck, and where the
    // park has one, a concrete facade and a second deck hanging over the top.
    const section = (band: Band, rows: number, o0: number, apron: number): void => {
      if (rows <= 0) return;
      band(light.concreteDark, apron, o0, 0, 0);
      const top = tier(band, rows, o0, 0);
      if (spec.upperRows > 0) {
        const back = o0 + rows * ROW_DEPTH;
        const front = back - DECK_OVERHANG;
        const floor = top + DECK_RISE;
        band(shade(light.concreteDark, 0.85), back, back, top, floor);
        band(shade(light.concrete, 0.6), front, front, floor - 3, floor);
        tier(band, spec.upperRows, front, floor);
      }
    };

    // Behind the plate first, then the grandstands over its ends, then the
    // bowl over theirs: nearest the camera to farthest, so the overlaps land
    // the right way round.
    section(
      (c, o0, o1, z0, z1) => this.fillHomeBand(ctx, cam, c, o0, o1, z0, z1),
      spec.homeRows,
      HOME_GAP,
      BACKSTOP,
    );
    for (const side of [-1, 1] as const) {
      section(
        (c, o0, o1, z0, z1) => this.fillSideBand(ctx, cam, side, this.sideEnd[side], c, o0, o1, z0, z1),
        spec.sideRows,
        SIDE_OFFSET,
        SIDE_OFFSET - 4,
      );
    }
    section(
      (c, o0, o1, z0, z1) => this.fillArcBand(ctx, cam, c, o0, o1, z0, z1),
      spec.bowlRows,
      STAND_GAP,
      0,
    );

    this.drawCrowd(ctx, cam, crowd);
  }

  /** A band of the seating behind the plate, between two radii, at two heights (front, back). */
  private fillHomeBand(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    colour: string,
    r0: number,
    r1: number,
    z0: number,
    z1: number,
  ): void {
    const at = (i: number, r: number, z: number): Vec2 => {
      const dir = dirAt(Math.PI - HOME_HALF_SPAN + (i / HOME_STEPS) * 2 * HOME_HALF_SPAN);
      return cam.project({ x: dir.x * r, y: dir.y * r }, z);
    };
    ctx.fillStyle = colour;
    ctx.beginPath();
    for (let i = 0; i <= HOME_STEPS; i++) {
      const p = at(i, r0, z0);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = HOME_STEPS; i >= 0; i--) {
      const p = at(i, r1, z1);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
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
