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
import { Camera } from '../gfx/camera';
import { ParkRenderer } from '../gfx/park';
import { lightingFor } from '../gfx/palette';
import { drawBallTail, drawFieldBall } from '../gfx/ball';

/**
 * The derby's payoff: the ball you just hit, flying. The field camera chases
 * it out toward the wall using the same physics integration the field sim
 * uses, so what you watch IS the ruling — the ball that clears the wall on
 * screen is the ball that counts. No fielders; nobody plays defense at a
 * derby. A tap skips to the landing.
 *
 * Drawn with the same park renderer as the live play, so the derby is the
 * same yard on a fine evening, with the seats close to full.
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

/** Physics runs a little faster than life so a moonshot doesn't drag. */
const PLAYBACK = 1.5;
/** Fixed physics step — the same integration the probes and field sim use. */
const STEP = 1 / 120;
/** How long the landing (or the wall clearing) stays on screen. */
const LINGER_MS = 1300;
/** A derby night sells; the bowl is close to full whatever your level. */
const CROWD_FILL = 0.85;

export class DerbyFlightView {
  private readonly root: HTMLElement;
  private readonly surface: Surface;
  private readonly banner: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly opts: DerbyFlightOptions;
  private readonly park: ParkRenderer;
  private readonly light = lightingFor(undefined);
  private readonly cam = new Camera();

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
  private trail: { x: number; y: number; z: number }[] = [];

  constructor(root: HTMLElement, opts: DerbyFlightOptions) {
    this.root = root;
    this.opts = opts;
    this.root.classList.add('atbat');
    this.root.innerHTML = '';

    const bb = opts.battedBall;
    this.ball = launchBall(bb.exitVelocity, bb.launchAngle, bb.spray, 1, bb.sideSpin ?? 0, opts.air);

    this.surface = createSurface(this.root);
    this.park = new ParkRenderer(opts.park);
    this.cam.x = 0;
    this.cam.y = 110;
    this.cam.scale = 2.4;

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
    const cam = this.cam;
    cam.width = this.surface.width;
    cam.height = this.surface.height;

    // Chase the ball, pulling back the further it gets from the plate so the
    // wall comes into frame right as the ball threatens it.
    const range = Math.hypot(this.ball.x, this.ball.y);
    const desired = clamp(2.6 - range / 260, 1.9, 2.6);
    const follow = 1 - Math.exp(-dt * 5);
    // Lead the camera up-field, and keep the airborne ball in the frame.
    cam.x += (this.ball.x - cam.x) * follow;
    cam.y += (this.ball.y + 40 + this.ball.z * 0.5 - cam.y) * follow;
    cam.scale += (desired - cam.scale) * (1 - Math.exp(-dt * 3.5));
  }

  /* ---------------------------------------------------------------- render */

  private draw(): void {
    const { ctx } = this.surface;
    const cam = this.cam;
    if (cam.width <= 0 || cam.height <= 0) return;

    const park = this.park;
    const beyond = park.isBeyondWall(this.ball);
    park.drawGround(ctx, cam, this.light);
    park.drawStands(ctx, cam, this.light, CROWD_FILL);
    this.updateTrail();
    if (beyond) this.drawBall(ctx);
    park.drawWall(ctx, cam, this.light);
    park.drawTowers(ctx, cam, this.light);
    if (!beyond) this.drawBall(ctx);
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
    const cam = this.cam;
    const ground = cam.project({ x: this.ball.x, y: this.ball.y });
    const air = cam.project({ x: this.ball.x, y: this.ball.y }, this.ball.z);
    const radius = Math.min(7.5, Math.max(3, 3 + this.ball.z / 40));
    const tail: Vec2[] = this.trail.map((t) => cam.project({ x: t.x, y: t.y }, t.z));
    tail.push(air);
    drawBallTail(ctx, tail, radius);
    drawFieldBall(ctx, air, ground, this.ball.z, cam.scale, this.light.shadow);
  }
}
