import type { BallPhysics } from '../core/ballFlight';
import { launchBall, stepBall } from '../core/ballFlight';
import type { Ballpark } from '../core/ballpark';
import { fenceAt, wallHeightAt } from '../core/ballpark';
import type { Vec2 } from '../core/fieldGeometry';
import { isFair, magnitude } from '../core/fieldGeometry';
import type { BattedBall } from '../core/types';
import type { AirConditions } from '../core/weather';
import { clamp } from '../core/rng';
import { createSurface } from '../ui/canvas';
import type { Surface } from '../ui/canvas';
import { CROWD_COLOURS } from './atBatView';

/**
 * The derby's payoff: the ball you just hit, flying. A top-down camera chases
 * it out toward the wall using the same physics integration the field sim
 * uses, so what you watch IS the ruling — the ball that clears the wall on
 * screen is the ball that counts. No fielders; nobody plays defense at a
 * derby. A tap skips to the landing.
 *
 * Drawn in the visual language of `playView.ts` — world-space grass stripes,
 * the park's real fence arc, the comet-tail ball — cut down to just what a
 * flight needs.
 */

export interface DerbyFlightResult {
  homeRun: boolean;
  /** Carry to the landing spot, in feet. */
  distance: number;
}

export interface DerbyFlightOptions {
  battedBall: BattedBall;
  park: Ballpark;
  air: AirConditions;
  /** Fired the moment the ball clears the wall, for the roar. */
  onHomeRun?(): void;
  onDone(result: DerbyFlightResult): void;
}

/** Vertical squash applied to ball height, matching the field view. */
const HEIGHT_SCALE = 0.62;
/** Physics runs a little faster than life so a moonshot doesn't drag. */
const PLAYBACK = 1.5;
/** Fixed physics step — the same integration the probes and field sim use. */
const STEP = 1 / 120;
/** How long the landing (or the wall clearing) stays on screen. */
const LINGER_MS = 1300;

const GRASS_DARK = '#1f7a3f';
const GRASS_LIGHT = '#26924b';
const STAND_DEPTH = 70;
const SEAT_COUNT = 900;
/** A derby night sells; the bowl is close to full whatever your level. */
const CROWD_FILL = 0.85;

export class DerbyFlightView {
  private readonly root: HTMLElement;
  private readonly surface: Surface;
  private readonly banner: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly opts: DerbyFlightOptions;

  private readonly ball: BallPhysics;
  private homeRun = false;
  private landed = false;
  private doneTimer = 0;
  private raf = 0;
  private destroyed = false;
  private lastFrame = 0;
  /** Leftover time not yet consumed by fixed physics steps. */
  private accumulator = 0;
  private simTime = 0;

  private camera: Vec2 = { x: 0, y: 110 };
  private scale = 2.4;
  private trail: { x: number; y: number; z: number }[] = [];
  private readonly seats: (Vec2 & { colour: string })[];

  constructor(root: HTMLElement, opts: DerbyFlightOptions) {
    this.root = root;
    this.opts = opts;
    this.root.classList.add('atbat');
    this.root.innerHTML = '';

    const bb = opts.battedBall;
    this.ball = launchBall(
      bb.exitVelocity,
      bb.launchAngle,
      bb.spray,
      1,
      bb.sideSpin ?? 0,
      opts.air,
    );

    this.surface = createSurface(this.root);
    this.seats = this.buildSeats();

    this.readout = document.createElement('div');
    this.readout.className = 'atbat-read';
    // The derby's goal pill owns the top of the stage; the live distance
    // ticks along the bottom instead.
    this.readout.style.top = 'auto';
    this.readout.style.bottom = '14px';
    this.root.appendChild(this.readout);

    this.banner = document.createElement('div');
    this.banner.className = 'atbat-banner';
    this.root.appendChild(this.banner);

    this.surface.canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });

    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.doneTimer);
    this.surface.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.surface.dispose();
    this.root.classList.remove('atbat');
    this.root.innerHTML = '';
  }

  /** A tap fast-forwards the rest of the flight to its landing. */
  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    while (!this.landed && this.simTime < 12) this.stepOnce();
  };

  /* ------------------------------------------------------------ simulation */

  private stepOnce(): void {
    if (this.landed) return;
    stepBall(this.ball, STEP);
    this.simTime += STEP;

    const spot = { x: this.ball.x, y: this.ball.y };
    if (
      !this.homeRun &&
      isFair(spot) &&
      magnitude(spot) > fenceAt(this.opts.park, spot) &&
      this.ball.z > wallHeightAt(this.opts.park, spot)
    ) {
      this.homeRun = true;
      this.banner.textContent = 'GONE!';
      this.banner.className = 'atbat-banner show good';
      this.opts.onHomeRun?.();
    }

    if (this.ball.bounced || this.ball.atRest || this.simTime >= 12) {
      this.landed = true;
      const distance = Math.round(Math.hypot(this.ball.x, this.ball.y));
      if (!this.homeRun) {
        this.banner.textContent = `${distance} FT — STAYS IN THE YARD`;
        this.banner.className = 'atbat-banner show neutral';
      } else {
        this.banner.textContent = `GONE! ${distance} FT`;
      }
      this.doneTimer = window.setTimeout(() => {
        if (!this.destroyed) {
          this.opts.onDone({ homeRun: this.homeRun, distance });
        }
      }, LINGER_MS);
    }
  }

  private loop = (): void => {
    if (this.destroyed) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 1 / 20);
    this.lastFrame = now;

    if (!this.landed) {
      this.accumulator += dt * PLAYBACK;
      while (this.accumulator >= STEP && !this.landed) {
        this.stepOnce();
        this.accumulator -= STEP;
      }
      this.readout.textContent = `${Math.round(Math.hypot(this.ball.x, this.ball.y))} ft`;
    }

    this.updateCamera(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  /* ---------------------------------------------------------------- camera */

  private updateCamera(dt: number): void {
    // Chase the ball, pulling back the further it gets from the plate so the
    // wall comes into frame right as the ball threatens it.
    const range = Math.hypot(this.ball.x, this.ball.y);
    const desired = clamp(2.6 - range / 220, 1.5, 2.6);
    const follow = 1 - Math.exp(-dt * 5);
    // Lead the camera slightly up-field so the plate context trails behind.
    this.camera.x += (this.ball.x - this.camera.x) * follow;
    this.camera.y += (this.ball.y + 40 - this.camera.y) * follow;
    this.scale += (desired - this.scale) * (1 - Math.exp(-dt * 3.5));
  }

  private toScreen(p: Vec2, z = 0): Vec2 {
    return {
      x: (p.x - this.camera.x) * this.scale + this.surface.width / 2,
      y:
        this.surface.height / 2 -
        (p.y - this.camera.y) * this.scale -
        z * this.scale * HEIGHT_SCALE,
    };
  }

  /* ---------------------------------------------------------------- render */

  private draw(): void {
    const { ctx } = this.surface;
    const W = this.surface.width;
    const H = this.surface.height;
    if (W <= 0 || H <= 0) return;

    this.drawGrass(ctx, W, H);
    this.drawFence(ctx);
    this.drawLines(ctx);
    this.updateTrail();
    this.drawBall(ctx);
  }

  private drawGrass(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    ctx.fillStyle = GRASS_DARK;
    ctx.fillRect(0, 0, W, H);

    // Mown stripes in world space, same cut as the field view.
    const band = 26;
    const d = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    const n = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
    const centreU = n.x * this.camera.x + n.y * this.camera.y;
    const centreV = d.x * this.camera.x + d.y * this.camera.y;
    const halfSpan = (W + H) / this.scale / 2 + band * 2;
    const startBand = Math.floor((centreU - halfSpan) / band);
    const endBand = Math.ceil((centreU + halfSpan) / band);

    ctx.fillStyle = GRASS_LIGHT;
    ctx.beginPath();
    for (let i = startBand; i <= endBand; i++) {
      if (i % 2 !== 0) continue;
      const u0 = i * band;
      const u1 = (i + 1) * band;
      const corner = (u: number, v: number): Vec2 =>
        this.toScreen({ x: n.x * u + d.x * v, y: n.y * u + d.y * v });
      const c0 = corner(u0, centreV - halfSpan);
      const c1 = corner(u1, centreV - halfSpan);
      const c2 = corner(u1, centreV + halfSpan);
      const c3 = corner(u0, centreV + halfSpan);
      ctx.moveTo(c0.x, c0.y);
      ctx.lineTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.lineTo(c3.x, c3.y);
      ctx.closePath();
    }
    ctx.fill();
  }

  /** Warning track, wall, dead ground, stand and crowd — the park itself. */
  private drawFence(ctx: CanvasRenderingContext2D): void {
    const park = this.opts.park;
    const bearings: Vec2[] = [];
    for (let i = 0; i <= 60; i++) {
      const angle = -Math.PI / 4 + (i / 60) * (Math.PI / 2);
      bearings.push({ x: Math.sin(angle), y: Math.cos(angle) });
    }

    const arc = (radiusOffset: number): Vec2[] =>
      bearings.map((dir) => {
        const radius = fenceAt(park, dir) + radiusOffset;
        return this.toScreen({ x: dir.x * radius, y: dir.y * radius });
      });

    const trace = (points: Vec2[], reverse = false) => {
      const list = reverse ? [...points].reverse() : points;
      for (const p of list) ctx.lineTo(p.x, p.y);
    };

    const inner = arc(-18);
    const wall = arc(0);

    ctx.save();
    // Warning track.
    ctx.fillStyle = '#9a6b3f';
    ctx.beginPath();
    ctx.moveTo(inner[0].x, inner[0].y);
    trace(inner);
    trace(wall, true);
    ctx.closePath();
    ctx.fill();

    // Everything past the wall is out of play.
    ctx.fillStyle = '#0e2a1c';
    ctx.beginPath();
    ctx.moveTo(wall[0].x, wall[0].y);
    trace(wall);
    trace(arc(260), true);
    ctx.closePath();
    ctx.fill();

    // The stand behind it, and the derby crowd.
    ctx.fillStyle = '#141c30';
    ctx.beginPath();
    ctx.moveTo(wall[0].x, wall[0].y);
    trace(wall);
    trace(arc(STAND_DEPTH), true);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    this.drawCrowd(ctx);

    // The wall, thicker where it's taller.
    ctx.save();
    for (let i = 0; i < wall.length - 1; i++) {
      const height = wallHeightAt(park, bearings[i]);
      ctx.strokeStyle = height > 18 ? '#2f6b48' : '#1c5c3c';
      ctx.lineWidth = Math.max(3, (2 + height * 0.22) * this.scale * 0.6);
      ctx.beginPath();
      ctx.moveTo(wall[i].x, wall[i].y);
      ctx.lineTo(wall[i + 1].x, wall[i + 1].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCrowd(ctx: CanvasRenderingContext2D): void {
    const taken = Math.round(this.seats.length * CROWD_FILL);
    const W = this.surface.width;
    const H = this.surface.height;
    const size = Math.max(1.5, 1.1 * this.scale);

    ctx.save();
    for (let i = 0; i < taken; i++) {
      const seat = this.seats[i];
      const p = this.toScreen(seat);
      if (p.x < -8 || p.x > W + 8 || p.y < -8 || p.y > H + 8) continue;
      ctx.fillStyle = seat.colour;
      ctx.fillRect(p.x, p.y, size, size);
    }
    ctx.restore();
  }

  private buildSeats(): (Vec2 & { colour: string })[] {
    const park = this.opts.park;
    const seats: (Vec2 & { colour: string })[] = [];
    for (let i = 0; i < SEAT_COUNT; i++) {
      const h = (i * 2654435761) >>> 0;
      const angle = -Math.PI / 4 + ((h % SEAT_COUNT) / SEAT_COUNT) * (Math.PI / 2);
      const dir = { x: Math.sin(angle), y: Math.cos(angle) };
      const radius = fenceAt(park, dir) + 6 + ((h >>> 9) % (STAND_DEPTH - 12));
      seats.push({
        x: dir.x * radius,
        y: dir.y * radius,
        colour: CROWD_COLOURS[h % CROWD_COLOURS.length],
      });
    }
    return seats;
  }

  /** Foul lines, the mound, and home plate — enough diamond to read the shot. */
  private drawLines(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.5, 1.2 * this.scale);
    for (const side of [-1, 1]) {
      const a = this.toScreen({ x: 0, y: 0 });
      const b = this.toScreen({ x: side * 250, y: 250 });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = '#b07a45';
    const mound = this.toScreen({ x: 0, y: 60.5 });
    ctx.beginPath();
    ctx.arc(mound.x, mound.y, 9 * this.scale, 0, Math.PI * 2);
    ctx.fill();

    const home = this.toScreen({ x: 0, y: 0 });
    ctx.beginPath();
    ctx.arc(home.x, home.y, 13 * this.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f6fa';
    const s = Math.max(5, 4 * this.scale);
    ctx.fillRect(home.x - s / 2, home.y - s / 2, s, s);
  }

  private updateTrail(): void {
    const last = this.trail[this.trail.length - 1];
    const p = { x: this.ball.x, y: this.ball.y, z: this.ball.z };
    if (this.landed) {
      if (this.trail.length > 0) this.trail.shift();
      return;
    }
    if (!last || Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > 0.9) {
      this.trail.push(p);
      if (this.trail.length > 9) this.trail.shift();
    }
  }

  private drawBall(ctx: CanvasRenderingContext2D): void {
    const ground = this.toScreen({ x: this.ball.x, y: this.ball.y });
    const air = this.toScreen({ x: this.ball.x, y: this.ball.y }, this.ball.z);

    if (this.ball.z > 1) {
      const shrink = clamp(1 - this.ball.z / 260, 0.55, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(ground.x, ground.y, 4 * shrink, 2.2 * shrink, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const radius = clamp(3.2 + this.ball.z / 34, 3, 7.5);

    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const p = this.toScreen({ x: t.x, y: t.y }, t.z);
      const frac = (i + 1) / (this.trail.length + 1);
      ctx.globalAlpha = frac * frac * 0.45;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * (0.25 + frac * 0.65), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 5;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(air.x, air.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
