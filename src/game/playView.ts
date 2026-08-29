import type { PlayOutcome, PlaySim, RunnerState } from '../core/playSim';
import type { BaseId, Vec2 } from '../core/fieldGeometry';
import { BASES, BASE_LABELS } from '../core/fieldGeometry';
import { fenceAt, wallHeightAt } from '../core/ballpark';
import { clamp } from '../core/rng';
import { createSurface, pointerPos, vibrate } from '../ui/canvas';
import type { Surface } from '../ui/canvas';
import type { PlayerColors, SpriteAnim } from '../ui/sprites';
import { createAnim, drawPlayer, updateAnim } from '../ui/sprites';
import { CROWD_COLOURS } from './atBatView';
import { CatchOverlay } from './catchOverlay';
import { drawGloom, drawRain, drawWindFlag } from './weatherFx';

/**
 * Top-down view of a live play. Camera tracks the ball and whoever the player
 * is controlling, zooming out when they spread apart so both stay on screen.
 *
 * On defense you drag anywhere to steer your fielder, then tap a base to throw
 * — or run the ball to the bag yourself.
 * On offense you decide whether to take the extra base.
 */

export interface PlayViewOptions {
  sim: PlaySim;
  /** Uniform worn by the nine in the field. */
  fieldingKit: PlayerColors;
  /** Uniform worn by the side on the bases. */
  battingKit: PlayerColors;
  /** How full the stands are, 0-1. Comes from the level being played. */
  crowd: number;
  /**
   * Which of the two sides is the home team. Home takes the first-base
   * dugout, the visitors sit on the third-base side.
   */
  homeSide: 'fielding' | 'batting';
  onComplete(outcome: PlayOutcome): void;
}

const MIN_SCALE = 1.5;
const MAX_SCALE = 3.2;
/** Vertical squash applied to ball height, so a fly ball reads as elevation. */
const HEIGHT_SCALE = 0.62;

/** How deep the outfield stand is, in feet, and how many seats it holds. */
const STAND_DEPTH = 70;
const SEAT_COUNT = 1500;

/**
 * Grandstands also run down each foul line behind the dugouts — where the
 * fans sit for the infield. Measured like the dugout: feet down the line
 * where the deck starts and ends (stopping short of the outfield bowl),
 * feet off the line to its front wall, how deep it is, and how many seats
 * each side holds.
 */
const SIDE_STAND_ALONG0 = 20;
const SIDE_STAND_ALONG1 = 225;
const SIDE_STAND_OFFSET = 64;
const SIDE_STAND_DEPTH = 32;
const SIDE_SEAT_COUNT = 320;

/**
 * Dugouts sit in foul territory, parallel to the lines. Measured in feet:
 * how far down the line the bench is centred, how far off the line it sits,
 * and its footprint. Eight players fill each one — the rest of the side that
 * isn't on the field or the bases — split between the rail and the bench.
 */
const DUGOUT_ALONG = 76;
// Far enough off the line that the bench reads as scenery beyond the playing
// field, not furniture parked in live foul ground.
const DUGOUT_OFFSET = 46;
const DUGOUT_LENGTH = 62;
const DUGOUT_DEPTH = 13;
const DUGOUT_BENCH = 8;
/** How many of the eight stand at the rail; the rest sit the bench. */
const DUGOUT_RAIL = 5;

const GRASS_DARK = '#1f7a3f';
const GRASS_LIGHT = '#26924b';
const DIRT = '#b07a45';
const LINE = 'rgba(255,255,255,0.85)';

interface Joystick {
  active: boolean;
  originX: number;
  originY: number;
  x: number;
  y: number;
  pointerId: number;
}

export class PlayView {
  private readonly root: HTMLElement;
  private readonly surface: Surface;
  private readonly sim: PlaySim;
  private readonly opts: PlayViewOptions;
  private readonly banner: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly status: HTMLElement;

  private raf = 0;
  private destroyed = false;
  private lastFrame = 0;
  private camera: Vec2 = { x: 0, y: 90 };
  private scale = 2.2;
  private lastEvent = '';
  private completed = false;
  private catchOverlay: CatchOverlay | null = null;
  private _paused = false;
  /** Last rendered control set, so the DOM is only rebuilt when it changes. */
  private controlSignature = '';
  private statusText = '';
  /** Seconds the rain has been falling; frozen while paused. */
  private weatherClock = 0;
  /** Animation state per fielder/runner, so run cycles persist across frames. */
  private anims = new Map<string, SpriteAnim>();
  /** Recent ball positions in world space — the comet tail that makes a
   * 4px ball trackable at a glance. */
  private ballTrail: { x: number; y: number; z: number }[] = [];
  /** Every seat in the park in world space, built once — outfield bowl and
   * both side grandstands. The stands never move. */
  private readonly seats: (Vec2 & { colour: string })[];

  private joystick: Joystick = {
    active: false,
    originX: 0,
    originY: 0,
    x: 0,
    y: 0,
    pointerId: -1,
  };

  constructor(root: HTMLElement, opts: PlayViewOptions) {
    this.root = root;
    this.opts = opts;
    this.sim = opts.sim;
    this.root.classList.add('atbat');
    this.root.innerHTML = '';

    this.surface = createSurface(this.root);
    this.seats = this.buildSeats();

    this.banner = document.createElement('div');
    this.banner.className = 'atbat-banner';
    this.root.appendChild(this.banner);

    this.status = document.createElement('div');
    this.status.className = 'play-hint';
    this.root.appendChild(this.status);

    this.controls = document.createElement('div');
    this.controls.className = 'play-controls';
    this.root.appendChild(this.controls);

    const canvas = this.surface.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', this.onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', this.onPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', this.onPointerUp, { passive: false });
    this.controls.addEventListener('pointerdown', this.onControlDown, { passive: false });

    this.centreCamera();
    this.renderControls();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.catchOverlay?.destroy();
    this.catchOverlay = null;
    const canvas = this.surface.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.controls.removeEventListener('pointerdown', this.onControlDown);
    this.surface.dispose();
    this.root.classList.remove('atbat');
    this.root.innerHTML = '';
  }

  /* ------------------------------------------------------------------ input */

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this._paused) return;
    if (this.sim.setup.userSide !== 'defense') return;
    const p = pointerPos(this.surface.canvas, e);
    this.joystick = {
      active: true,
      originX: p.x,
      originY: p.y,
      x: p.x,
      y: p.y,
      pointerId: e.pointerId,
    };
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.joystick.active || e.pointerId !== this.joystick.pointerId) return;
    e.preventDefault();
    const p = pointerPos(this.surface.canvas, e);
    this.joystick.x = p.x;
    this.joystick.y = p.y;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.joystick.pointerId) return;
    this.joystick.active = false;
  };

  /**
   * Acts on pointerdown rather than click. A click needs press and release on
   * the same element, and these buttons are rebuilt as the play develops — so
   * click drops most taps. Pointerdown also just feels quicker in a game.
   */
  private onControlDown = (e: PointerEvent): void => {
    const target = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!target || this._paused) return;
    e.preventDefault();
    const act = target.dataset.act;
    vibrate(12);

    if (act === 'advance') this.sim.advanceRunner();
    else if (act === 'hold') this.sim.holdRunner();
    else if (act === 'back') this.sim.retreatRunner();
    else if (act?.startsWith('throw')) this.sim.throwTo(Number(act.slice(5)) as BaseId);

    this.renderControls();
  };

  /**
   * Buttons depend on which side you're on and what's available right now.
   * Guarded by a signature so the DOM is only rebuilt when the options
   * actually change — rebuilding every frame is what was eating taps.
   */
  private renderControls(): void {
    const sim = this.sim;
    let signature = '';
    let html = '';

    if (sim.phase === 'dead') {
      signature = 'dead';
    } else if (sim.setup.userSide === 'offense') {
      const go = sim.userGoTarget;
      const hold = sim.userHoldTarget;
      const back = sim.userBackTarget;
      signature = `off:${go}:${hold}:${back}`;
      html =
        (back !== null
          ? `<button class="play-btn back" data-act="back">BACK TO ${BASE_LABELS[back]}</button>`
          : '') +
        (hold !== null
          ? `<button class="play-btn hold" data-act="hold">HOLD AT ${BASE_LABELS[hold]}</button>`
          : '') +
        (go !== null
          ? `<button class="play-btn go" data-act="advance">GO FOR ${BASE_LABELS[go]}</button>`
          : '');
    } else if (sim.userHasBall) {
      signature = 'throw';
      html = `
        <button class="play-btn throw" data-act="throw0">HOME</button>
        <button class="play-btn throw" data-act="throw3">3RD</button>
        <button class="play-btn throw" data-act="throw2">2ND</button>
        <button class="play-btn throw" data-act="throw1">1ST</button>`;
    } else {
      signature = 'none';
    }

    if (signature === this.controlSignature) return;
    this.controlSignature = signature;
    this.controls.innerHTML = html;
  }

  /** Running status line: what you're committed to, and whether it's contested. */
  private renderStatus(): void {
    const sim = this.sim;
    let text = '';
    let tone = '';

    if (sim.setup.userSide === 'offense' && sim.phase !== 'dead') {
      const runner = sim.userRunner;
      const target = sim.userRunnerTarget;
      if (runner && target !== null) {
        const next = sim.userRunnerNextBase;
        if (sim.throwBeatingUserRunner && next !== null) {
          text = sim.userRunnerRetreating
            ? `BALL TO ${BASE_LABELS[next]} — DIVE!`
            : `BALL TO ${BASE_LABELS[next]} — RUN OR GO BACK!`;
          tone = 'danger';
        } else if (target > runner.at) {
          text = `RUNNING TO ${BASE_LABELS[target]}`;
          tone = 'going';
        } else if (runner.progress > 0) {
          // Heading back — by choice, or because the bag ahead is taken.
          text = `BACK TO ${BASE_LABELS[runner.at]}`;
          tone = 'holding';
        } else {
          text = `HOLDING AT ${BASE_LABELS[runner.at]}`;
          tone = 'holding';
        }
      }
    } else if (sim.setup.userSide === 'defense' && sim.userHasBall) {
      text = sim.forcePlayBases.length > 0 ? 'THROW TO A BASE — OR RUN IT THERE' : 'TAP A BASE TO THROW';
      tone = 'going';
    }

    if (text === this.statusText) return;
    this.statusText = text;
    this.status.textContent = text;
    this.status.className = `play-hint ${tone}`;
  }

  /* ------------------------------------------------------------------- loop */

  /** Frozen: still drawn, but the sim doesn't advance and input is ignored. */
  get paused(): boolean {
    return this._paused;
  }

  set paused(value: boolean) {
    this._paused = value;
    if (value) this.joystick.active = false;
    if (this.catchOverlay) this.catchOverlay.paused = value;
  }

  private loop = (): void => {
    if (this.destroyed) return;
    const now = performance.now();
    const dt = this._paused ? 0 : Math.min((now - this.lastFrame) / 1000, 1 / 20);
    this.lastFrame = now;

    const sim = this.sim;
    const hadBall = sim.userHasBall;

    if (this.joystick.active && sim.setup.userSide === 'defense') {
      const dx = this.joystick.x - this.joystick.originX;
      const dy = this.joystick.y - this.joystick.originY;
      const range = Math.hypot(dx, dy);
      if (range > 6) {
        const power = Math.min(range / 52, 1);
        // Screen y grows downward; field y grows toward the outfield.
        sim.moveUserFielder((dx / range) * power, (-dy / range) * power, dt);
      }
    }

    if (!this._paused) sim.update(dt);
    this.syncCatchOverlay();

    if (sim.userHasBall !== hadBall) this.controlSignature = '';
    this.renderControls();
    this.renderStatus();

    if (sim.event !== this.lastEvent) {
      this.lastEvent = sim.event;
      if (sim.event) {
        this.banner.textContent = sim.event;
        this.banner.className = `atbat-banner show ${this.toneFor(sim.event)}`;
      }
    }

    this.updateCamera(dt);
    this.draw(dt);

    if (sim.phase === 'dead' && sim.outcome && !this.completed) {
      this.completed = true;
      this.controls.innerHTML = '';
      this.controlSignature = 'dead';
      this.status.textContent = '';
      window.setTimeout(() => {
        if (!this.destroyed) this.opts.onComplete(sim.outcome!);
      }, 700);
    }

    this.raf = requestAnimationFrame(this.loop);
  };

  /**
   * The play pauses when the player reaches the ball at full stretch. Put the
   * catch minigame up, and hand the result back when they're done.
   */
  private syncCatchOverlay(): void {
    const pending = this.sim.pendingCatch;

    if (!pending || this.catchOverlay) {
      if (this.catchOverlay && !pending && this.sim.phase !== 'catch') {
        this.catchOverlay.destroy();
        this.catchOverlay = null;
      }
      return;
    }

    this.joystick.active = false;
    this.controls.innerHTML = '';
    this.controlSignature = 'catch';

    this.catchOverlay = new CatchOverlay(this.root, {
      fielding: this.sim.setup.attributes.fielding,
      difficulty: pending.difficulty,
      wasFly: pending.wasFly,
      rng: this.sim.setup.rng,
      onComplete: (success) => {
        this.catchOverlay?.destroy();
        this.catchOverlay = null;
        this.sim.resolveCatchAttempt(success);
        this.controlSignature = '';
        this.renderControls();
      },
    });
    this.catchOverlay.paused = this._paused;
  }

  private toneFor(event: string): string {
    const defense = this.sim.setup.userSide === 'defense';
    if (/gone|hit|safe|away/i.test(event)) return defense ? 'bad' : 'good';
    if (/caught|out|got him/i.test(event)) return defense ? 'good' : 'bad';
    return 'neutral';
  }

  /* ----------------------------------------------------------------- camera */

  private focusPoints(): Vec2[] {
    const sim = this.sim;
    const points: Vec2[] = [{ x: sim.ball.x, y: sim.ball.y }];

    if (sim.setup.userSide === 'defense') {
      const fielder = sim.userFielder;
      if (fielder) points.push({ x: fielder.x, y: fielder.y });
      if (sim.phase === 'live' && !sim.ball.bounced) points.push(sim.landingPoint);
    } else {
      const runner = sim.userRunner;
      if (runner) points.push(sim.runnerPosition(runner));
      points.push(BASES[1]);
    }
    return points;
  }

  private centreCamera(): void {
    const points = this.focusPoints();
    this.camera = this.midpoint(points);
  }

  private midpoint(points: Vec2[]): Vec2 {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  private updateCamera(dt: number): void {
    const points = this.focusPoints();
    const target = this.midpoint(points);

    let spanX = 0;
    let spanY = 0;
    for (const p of points) {
      spanX = Math.max(spanX, Math.abs(p.x - target.x) * 2);
      spanY = Math.max(spanY, Math.abs(p.y - target.y) * 2);
    }

    const W = this.surface.width;
    const H = this.surface.height;
    const fit = Math.min(
      W / Math.max(spanX + 90, 1),
      H / Math.max(spanY + 120, 1),
    );
    const desiredScale = clamp(fit, MIN_SCALE, MAX_SCALE);

    // When the view can't zoom out far enough to hold every focus point
    // (small screens), lean the camera toward the ball: it is the thing the
    // player must see, and the other points can fall off the edge instead.
    const ball = points[0];
    const overflow = Math.max(
      (spanX + 90) / (W / desiredScale),
      (spanY + 120) / (H / desiredScale),
      1,
    );
    const ballBias = clamp((overflow - 1) * 2, 0, 1);
    target.x += (ball.x - target.x) * ballBias;
    target.y += (ball.y - target.y) * ballBias;

    // Ease toward the target so the camera never snaps.
    const follow = 1 - Math.exp(-dt * 6);
    this.camera.x += (target.x - this.camera.x) * follow;
    this.camera.y += (target.y - this.camera.y) * follow;
    this.scale += (desiredScale - this.scale) * (1 - Math.exp(-dt * 3.5));

    // Keep the camera roughly over the field.
    this.camera.x = clamp(this.camera.x, -300, 300);
    this.camera.y = clamp(this.camera.y, -30, 380);

    // Hard guarantee: the ball (including its drawn height) never leaves the
    // inner part of the screen, whatever the easing or clamps above did.
    this.keepBallOnScreen();
  }

  private keepBallOnScreen(): void {
    const sim = this.sim;
    const W = this.surface.width;
    const H = this.surface.height;
    const marginX = Math.max(40, W * 0.18);
    const marginY = Math.max(40, H * 0.18);
    const air = this.toScreen({ x: sim.ball.x, y: sim.ball.y }, sim.ball.z);
    const ground = this.toScreen({ x: sim.ball.x, y: sim.ball.y });

    if (air.x < marginX) this.camera.x -= (marginX - air.x) / this.scale;
    else if (air.x > W - marginX) this.camera.x += (air.x - (W - marginX)) / this.scale;

    // Keep both the airborne ball and its shadow inside the vertical band.
    const top = Math.min(air.y, ground.y);
    const bottom = Math.max(air.y, ground.y);
    if (top < marginY) this.camera.y += (marginY - top) / this.scale;
    else if (bottom > H - marginY) this.camera.y -= (bottom - (H - marginY)) / this.scale;
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

  /* ----------------------------------------------------------------- render */

  private draw(dt: number): void {
    const { ctx } = this.surface;
    const W = this.surface.width;
    const H = this.surface.height;
    if (W <= 0 || H <= 0) return;

    this.drawGrass(ctx, W, H);
    this.drawFence(ctx);
    this.drawInfield(ctx);
    this.drawBases(ctx);
    this.drawForceRings(ctx);
    this.drawDugouts(ctx, dt);
    this.drawLandingMarker(ctx);
    this.drawThrowTelegraph(ctx);
    this.drawRunners(ctx, dt);
    this.drawFielders(ctx, dt);
    this.updateBallTrail();
    this.drawBall(ctx);
    if (this.joystick.active) this.drawJoystick(ctx);

    this.weatherClock += dt;
    drawGloom(ctx, W, H, this.sim.weather);
    drawRain(ctx, W, H, this.sim.weather, this.weatherClock);
    // Under the pause button, clear of the coach tip once it's gone.
    drawWindFlag(ctx, 10, 52, this.sim.weather);
  }

  private drawGrass(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    ctx.fillStyle = GRASS_DARK;
    ctx.fillRect(0, 0, W, H);

    // Mown stripes live in world space so they scroll and zoom with the
    // camera — and they run parallel to the first-base line, so the pattern
    // reads as cut for this diamond rather than for the screen. `d` runs
    // along a stripe, `n` across them; a stripe is the slab of field where
    // the n-coordinate falls in its band.
    const band = 26;
    const d = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    const n = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
    const centreU = n.x * this.camera.x + n.y * this.camera.y;
    const centreV = d.x * this.camera.x + d.y * this.camera.y;
    // Generous half-span so the diagonal slabs cover the corners at any zoom.
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

  /** Warning track, wall, and the dead ground beyond it — shaped by the park. */
  private drawFence(ctx: CanvasRenderingContext2D): void {
    const park = this.sim.park;
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
      list.forEach((p, i) => (i === 0 ? ctx.lineTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    };

    const inner = arc(-18);
    const wall = arc(0);

    // Warning track.
    ctx.save();
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
    const far = arc(220);
    trace(far, true);
    ctx.closePath();
    ctx.fill();

    // The stand, sitting on the dead ground behind the wall.
    ctx.fillStyle = '#141c30';
    ctx.beginPath();
    ctx.moveTo(wall[0].x, wall[0].y);
    trace(wall);
    trace(arc(STAND_DEPTH), true);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    this.drawSideStands(ctx);
    this.drawCrowd(ctx);
    ctx.save();

    // The wall itself, drawn thicker where it's taller so a 36-foot monster in
    // left actually looks like one.
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

  /**
   * The crowd — in the outfield bowl and the side grandstands alike.
   *
   * Seats are generated in *world* space from an index hash, so they scroll
   * and zoom with the camera instead of swimming across it, and stay put frame
   * to frame. How many of them are occupied is the level: a Single-A crowd is
   * a scattering, the Majors is solid.
   */
  private drawCrowd(ctx: CanvasRenderingContext2D): void {
    const taken = Math.round(this.seats.length * clamp(this.opts.crowd, 0, 1));
    if (taken <= 0) return;

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

  /**
   * Lay every stand out once. Seat order is shuffled by hash rather than
   * sequential, so taking the first N of them for a given crowd size scatters
   * people through the bowl and both side stands instead of packing them in
   * from one foul pole round.
   */
  private buildSeats(): (Vec2 & { colour: string })[] {
    const park = this.sim.park;
    const seats: (Vec2 & { colour: string; order: number })[] = [];
    const add = (x: number, y: number, h: number) =>
      seats.push({
        x,
        y,
        colour: CROWD_COLOURS[h % CROWD_COLOURS.length],
        order: Math.imul(h ^ 0x9e3779b9, 2246822519) >>> 0,
      });

    // The outfield bowl.
    for (let i = 0; i < SEAT_COUNT; i++) {
      const h = (i * 2654435761) >>> 0;
      const angle = -Math.PI / 4 + ((h % SEAT_COUNT) / SEAT_COUNT) * (Math.PI / 2);
      const dir = { x: Math.sin(angle), y: Math.cos(angle) };
      const radius = fenceAt(park, dir) + 6 + ((h >>> 9) % (STAND_DEPTH - 12));
      add(dir.x * radius, dir.y * radius, h);
    }

    // The grandstands down each line. Seats live in the dugout's local frame
    // — feet along the foul line and out from it — mapped to world space.
    for (const side of [-1, 1]) {
      for (let i = 0; i < SIDE_SEAT_COUNT; i++) {
        const h = Math.imul(i + (side > 0 ? 70001 : 40009), 2654435761) >>> 0;
        const a = SIDE_STAND_ALONG0 + 4 + (h % (SIDE_STAND_ALONG1 - SIDE_STAND_ALONG0 - 8));
        const o = SIDE_STAND_OFFSET + 4 + ((h >>> 9) % (SIDE_STAND_DEPTH - 8));
        add((side * (a + o)) / Math.SQRT2, (a - o) / Math.SQRT2, h);
      }
    }

    seats.sort((p, q) => p.order - q.order);
    return seats;
  }

  /**
   * The grandstands flanking the infield — a concrete deck down each foul
   * line behind the dugouts, with a low wall on the field side. The fans in
   * them come from the shared seat list, so the same crowd fraction fills
   * the bowl and the sides alike.
   */
  private drawSideStands(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const side of [-1, 1]) {
      const at = (a: number, o: number): Vec2 =>
        this.toScreen({ x: (side * (a + o)) / Math.SQRT2, y: (a - o) / Math.SQRT2 });

      const a0 = SIDE_STAND_ALONG0;
      const a1 = SIDE_STAND_ALONG1;
      const o0 = SIDE_STAND_OFFSET;
      const o1 = SIDE_STAND_OFFSET + SIDE_STAND_DEPTH;

      // The deck, in the same concrete as the outfield stand.
      ctx.fillStyle = '#141c30';
      ctx.beginPath();
      [at(a0, o0), at(a1, o0), at(a1, o1), at(a0, o1)].forEach((p, i) =>
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
      );
      ctx.closePath();
      ctx.fill();

      // Faint breaks so the deck reads as tiers of seating.
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = Math.max(1, 0.5 * this.scale);
      for (let k = 1; k < 4; k++) {
        const o = o0 + (SIDE_STAND_DEPTH * k) / 4;
        const r0 = at(a0, o);
        const r1 = at(a1, o);
        ctx.beginPath();
        ctx.moveTo(r0.x, r0.y);
        ctx.lineTo(r1.x, r1.y);
        ctx.stroke();
      }

      // Low wall between the front row and foul ground.
      ctx.strokeStyle = '#2c3a5c';
      ctx.lineWidth = Math.max(2, 1.4 * this.scale);
      const w0 = at(a0, o0);
      const w1 = at(a1, o0);
      ctx.beginPath();
      ctx.moveTo(w0.x, w0.y);
      ctx.lineTo(w1.x, w1.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawInfield(ctx: CanvasRenderingContext2D): void {
    // Base paths as dirt strips.
    ctx.save();
    ctx.strokeStyle = DIRT;
    ctx.lineWidth = Math.max(4, 13 * this.scale);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const p = this.toScreen(BASES[i % 4]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // Mound and home circles.
    ctx.fillStyle = DIRT;
    const mound = this.toScreen({ x: 0, y: 60.5 });
    ctx.beginPath();
    ctx.arc(mound.x, mound.y, 9 * this.scale, 0, Math.PI * 2);
    ctx.fill();

    const home = this.toScreen(BASES[0]);
    ctx.beginPath();
    ctx.arc(home.x, home.y, 13 * this.scale, 0, Math.PI * 2);
    ctx.fill();

    // Foul lines out to the fence.
    ctx.save();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = Math.max(1.5, 1.2 * this.scale);
    for (const side of [-1, 1]) {
      const end = { x: side * 250, y: 250 };
      ctx.beginPath();
      const a = this.toScreen(BASES[0]);
      const b = this.toScreen(end);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * The two dugouts, one either side of the plate in foul ground, with each
   * team's bench standing at the rail in its own uniform. Home is on the
   * first-base side, so which kit fills which dugout follows from who's
   * hosting, not who's batting.
   */
  private drawDugouts(ctx: CanvasRenderingContext2D, dt: number): void {
    const homeIsFielding = this.opts.homeSide === 'fielding';
    const homeKit = homeIsFielding ? this.opts.fieldingKit : this.opts.battingKit;
    const awayKit = homeIsFielding ? this.opts.battingKit : this.opts.fieldingKit;
    this.drawDugout(ctx, dt, 1, homeKit);
    this.drawDugout(ctx, dt, -1, awayKit);
  }

  private drawDugout(
    ctx: CanvasRenderingContext2D,
    dt: number,
    side: 1 | -1,
    kit: PlayerColors,
  ): void {
    // Unit vectors along the foul line and away from it, into foul ground.
    const along: Vec2 = { x: side / Math.SQRT2, y: 1 / Math.SQRT2 };
    const out: Vec2 = { x: side / Math.SQRT2, y: -1 / Math.SQRT2 };
    const at = (a: number, o: number): Vec2 =>
      this.toScreen({ x: along.x * a + out.x * o, y: along.y * a + out.y * o });

    const a0 = DUGOUT_ALONG - DUGOUT_LENGTH / 2;
    const a1 = DUGOUT_ALONG + DUGOUT_LENGTH / 2;
    const o0 = DUGOUT_OFFSET;
    const o1 = DUGOUT_OFFSET + DUGOUT_DEPTH;

    const W = this.surface.width;
    const H = this.surface.height;
    const corners = [at(a0, o0), at(a1, o0), at(a1, o1), at(a0, o1)];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const margin = 60;
    if (
      Math.max(...xs) < -margin || Math.min(...xs) > W + margin ||
      Math.max(...ys) < -margin || Math.min(...ys) > H + margin
    ) {
      return;
    }

    const poly = (points: Vec2[]) => {
      ctx.beginPath();
      points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
    };

    // The whole dugout, bench included, is drawn a touch faded — it's
    // scenery, and at full strength it competed with the play for the eye.
    ctx.save();
    ctx.globalAlpha = 0.85;

    ctx.save();

    // Dirt apron in front, so the dugout doesn't sit straight on the grass.
    ctx.fillStyle = DIRT;
    poly([at(a0 - 3, o0 - 5), at(a1 + 3, o0 - 5), at(a1 + 3, o0 + 1), at(a0 - 3, o0 + 1)]);
    ctx.fill();

    // Concrete walls wrap the pit on three sides; their tops show as a
    // lighter band round the sunken floor. The field side stays open.
    ctx.fillStyle = '#6a7490';
    poly([at(a0 - 2, o0), at(a1 + 2, o0), at(a1 + 2, o1 + 2), at(a0 - 2, o1 + 2)]);
    ctx.fill();

    // The sunken floor.
    ctx.fillStyle = '#4a5468';
    poly(corners);
    ctx.fill();

    // Steps down into the pit at each end, where the rail leaves a gap.
    const stepShades = ['#707a96', '#5f6984', '#525c76'];
    for (const [s0, s1] of [
      [a0 + 0.5, a0 + 6],
      [a1 - 6, a1 - 0.5],
    ]) {
      stepShades.forEach((shade, k) => {
        ctx.fillStyle = shade;
        poly([
          at(s0, o0 + k * 1.3),
          at(s1, o0 + k * 1.3),
          at(s1, o0 + (k + 1) * 1.3),
          at(s0, o0 + (k + 1) * 1.3),
        ]);
        ctx.fill();
      });
    }

    // The bench itself — a slab along the back wall in the team's colour,
    // not just a painted line.
    const benchPoly = [
      at(a0 + 3, o1 - 4.4),
      at(a1 - 3, o1 - 4.4),
      at(a1 - 3, o1 - 1.8),
      at(a0 + 3, o1 - 1.8),
    ];
    ctx.fillStyle = kit.shirt;
    poly(benchPoly);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(1, 0.6 * this.scale);
    poly(benchPoly);
    ctx.stroke();

    // The sitters, drawn before the canopy so it shades them. Fed a fixed
    // point rather than the screen position, so a camera pan doesn't set
    // their legs churning — they only idle.
    const plate = this.toScreen(BASES[0]);
    const seatedHeight = this.spriteHeight() * 0.66;
    for (let i = DUGOUT_RAIL; i < DUGOUT_BENCH; i++) {
      const p = at(DUGOUT_ALONG + (i - DUGOUT_RAIL - 1) * 10, o1 - 3.4);
      const anim = this.animFor(`d:${side}:${i}`, { x: 0, y: 0 }, dt);
      anim.facing = Math.atan2(plate.y - p.y, plate.x - p.x);
      drawPlayer(ctx, p.x, p.y, { height: seatedHeight, colors: kit, anim });
    }

    // Roof canopy over the back of the pit, semi-transparent so the bench
    // ghosts through beneath it, with a pale leading edge.
    ctx.fillStyle = 'rgba(20, 25, 42, 0.55)';
    poly([at(a0 - 2, o1 - 5.2), at(a1 + 2, o1 - 5.2), at(a1 + 2, o1 + 2), at(a0 - 2, o1 + 2)]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(215, 219, 230, 0.55)';
    ctx.lineWidth = Math.max(1, 0.8 * this.scale);
    const e0 = at(a0 - 2, o1 - 5.2);
    const e1 = at(a1 + 2, o1 - 5.2);
    ctx.beginPath();
    ctx.moveTo(e0.x, e0.y);
    ctx.lineTo(e1.x, e1.y);
    ctx.stroke();

    // Outline of the whole structure, and the rail on the field side —
    // broken at the ends where the steps come down.
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(1, 0.8 * this.scale);
    poly([at(a0 - 2, o0), at(a1 + 2, o0), at(a1 + 2, o1 + 2), at(a0 - 2, o1 + 2)]);
    ctx.stroke();
    ctx.strokeStyle = '#d7dbe6';
    ctx.lineWidth = Math.max(1.5, 1.1 * this.scale);
    const r0 = at(a0 + 7, o0);
    const r1 = at(a1 - 7, o0);
    ctx.beginPath();
    ctx.moveTo(r0.x, r0.y);
    ctx.lineTo(r1.x, r1.y);
    ctx.stroke();

    ctx.restore();

    // The rest stand at the rail, all watching the plate. A touch smaller
    // than the nine in play so the dugout reads as background.
    const height = this.spriteHeight() * 0.8;
    const stride = (DUGOUT_LENGTH - 18) / (DUGOUT_RAIL - 1);
    for (let i = 0; i < DUGOUT_RAIL; i++) {
      // A little stagger so they don't stand in a parade line.
      const stagger = ((i * 7 + (side > 0 ? 3 : 0)) % 5) * 0.6;
      const p = at(a0 + 9 + i * stride, o0 + 3.5 + stagger);
      const anim = this.animFor(`d:${side}:${i}`, { x: 0, y: 0 }, dt);
      anim.facing = Math.atan2(plate.y - p.y, plate.x - p.x);
      drawPlayer(ctx, p.x, p.y, { height, colors: kit, anim });
    }

    ctx.restore();
  }

  private drawBases(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#f4f6fa';
    for (let i = 1; i <= 3; i++) {
      const p = this.toScreen(BASES[i]);
      const size = Math.max(5, 4.2 * this.scale);
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }

    // Home plate.
    const home = this.toScreen(BASES[0]);
    const s = Math.max(5, 4 * this.scale);
    ctx.beginPath();
    ctx.moveTo(home.x - s / 2, home.y - s / 2);
    ctx.lineTo(home.x + s / 2, home.y - s / 2);
    ctx.lineTo(home.x + s / 2, home.y + s / 4);
    ctx.lineTo(home.x, home.y + s / 1.4);
    ctx.lineTo(home.x - s / 2, home.y + s / 4);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * With the ball in the player's glove, ring every bag where a force is still
   * on. Getting the ball there first — throw it, or run it in yourself — is
   * the out. Without this the "step on the bag" play was invisible: nothing
   * told the player that the base ten feet away was worth running to.
   */
  private drawForceRings(ctx: CanvasRenderingContext2D): void {
    const bases = this.sim.forcePlayBases;
    if (bases.length === 0) return;

    const pulse = 0.5 + Math.sin(performance.now() / 220) * 0.18;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 209, 102, ${pulse})`;
    ctx.lineWidth = 2.5;
    for (const base of bases) {
      const p = this.toScreen(BASES[base]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(11, 9 * this.scale), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The circle a fly ball is coming down into — the whole point of the mode. */
  private drawLandingMarker(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    if (sim.phase !== 'live' || sim.ball.bounced || sim.ball.z < 6) return;

    const p = this.toScreen(sim.landingPoint);
    const pulse = 0.6 + Math.sin(performance.now() / 140) * 0.25;
    const radius = Math.max(9, 7 * this.scale);

    ctx.save();
    ctx.strokeStyle = `rgba(255, 225, 120, ${pulse})`;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 225, 120, ${pulse})`;
    ctx.fill();
    ctx.restore();
  }

  private spriteHeight(): number {
    // Kept well above true scale — at real proportions a ballplayer is a
    // handful of pixels on a phone and the run cycle is invisible.
    return clamp(14 * this.scale, 26, 48);
  }

  /** Animation state is keyed per entity so run cycles carry across frames. */
  private animFor(key: string, p: Vec2, dt: number): SpriteAnim {
    let anim = this.anims.get(key);
    if (!anim) {
      anim = createAnim(p.x, p.y);
      this.anims.set(key, anim);
    }
    updateAnim(anim, p.x, p.y, dt, this.spriteHeight() * 0.85);
    return anim;
  }

  private drawRunners(ctx: CanvasRenderingContext2D, dt: number): void {
    for (const runner of this.sim.runners) {
      if (runner.out || runner.at >= 4) continue;
      const p = this.toScreen(this.sim.runnerPosition(runner));
      drawPlayer(ctx, p.x, p.y, {
        height: this.spriteHeight(),
        colors: this.opts.battingKit,
        anim: this.animFor(`r:${runner.id}`, p, dt),
        highlight: runner.isUser,
      });
      if (runner.isUser) this.drawIntentArrow(ctx, p, runner);
    }
  }

  private drawFielders(ctx: CanvasRenderingContext2D, dt: number): void {
    for (const fielder of this.sim.fielders) {
      const p = this.toScreen({ x: fielder.x, y: fielder.y });
      drawPlayer(ctx, p.x, p.y, {
        height: this.spriteHeight(),
        colors: this.opts.fieldingKit,
        anim: this.animFor(`f:${fielder.id}`, p, dt),
        highlight: fielder.isUser,
        holdingBall: fielder.hasBall,
      });
    }
  }

  /**
   * Where you're headed and whether it's contested: a line to the bag you're
   * running into, a ring on it, and both turning red when a throw is beating
   * you there. Without this the hold-or-go call is guesswork.
   */
  private drawIntentArrow(ctx: CanvasRenderingContext2D, p: Vec2, runner: RunnerState): void {
    // Stood on a bag: nothing to point at. Between bases it points wherever
    // they're headed — ahead, or back to the one they left.
    if (runner.progress <= 0 && runner.at >= runner.intent) return;
    const next = this.sim.userRunnerNextBase;
    if (next === null) return;

    const contested = this.sim.throwBeatingUserRunner;
    const colour = contested ? '255, 107, 107' : '255, 209, 102';
    const target = this.toScreen(BASES[next]);

    ctx.save();
    ctx.strokeStyle = `rgba(${colour}, 0.85)`;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 4);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Ring on the bag you're running into, pulsing when a throw is coming.
    const pulse = contested
      ? 0.55 + Math.sin(performance.now() / 90) * 0.35
      : 0.5 + Math.sin(performance.now() / 220) * 0.18;
    ctx.strokeStyle = `rgba(${colour}, ${pulse})`;
    ctx.lineWidth = contested ? 3.5 : 2.5;
    ctx.beginPath();
    ctx.arc(target.x, target.y, Math.max(11, 9 * this.scale), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The race, made visible: while a throw is in the air, a ring shrinks onto
   * the target bag — closing exactly when the ball arrives — with a guide
   * line from the ball to the bag. Red when that's the bag the user's runner
   * is heading for, so GO/HOLD/BACK is a read instead of a coin flip.
   */
  private drawThrowTelegraph(ctx: CanvasRenderingContext2D): void {
    const flight = this.sim.throwInFlight;
    if (!flight) return;

    const sim = this.sim;
    const target = this.toScreen(BASES[flight.base]);
    const ball = this.toScreen({ x: sim.ball.x, y: sim.ball.y }, sim.ball.z);
    const contested =
      sim.setup.userSide === 'offense' && sim.userRunnerNextBase === flight.base;
    const colour = contested ? '255, 107, 107' : '255, 209, 102';

    ctx.save();
    // Where the throw is going, off the ball itself.
    ctx.strokeStyle = `rgba(${colour}, 0.45)`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // The countdown: wide when the throw is released, snapping shut on the
    // bag as it lands.
    const bagR = Math.max(11, 9 * this.scale);
    const r = bagR + (1 - flight.progress) * Math.max(26, 22 * this.scale);
    ctx.strokeStyle = `rgba(${colour}, ${0.5 + flight.progress * 0.45})`;
    ctx.lineWidth = 2 + flight.progress * 2;
    ctx.beginPath();
    ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Feed the comet tail. Points are kept in world space so the trail marks
   * where the ball actually flew, panning and zooming with the camera.
   */
  private updateBallTrail(): void {
    const sim = this.sim;
    if (sim.ballCarrier || sim.ball.atRest || this._paused) {
      // Held or settled: let the tail burn down rather than vanish.
      if (this.ballTrail.length > 0) this.ballTrail.shift();
      return;
    }
    const last = this.ballTrail[this.ballTrail.length - 1];
    const p = { x: sim.ball.x, y: sim.ball.y, z: sim.ball.z };
    if (!last || Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > 0.9) {
      this.ballTrail.push(p);
      if (this.ballTrail.length > 9) this.ballTrail.shift();
    }
  }

  private drawBall(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    if (sim.ballCarrier) return;

    const ground = this.toScreen({ x: sim.ball.x, y: sim.ball.y });
    const air = this.toScreen({ x: sim.ball.x, y: sim.ball.y }, sim.ball.z);

    if (sim.ball.z > 1) {
      const shrink = clamp(1 - sim.ball.z / 260, 0.55, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(ground.x, ground.y, 4 * shrink, 2.2 * shrink, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Small fixed-pixel ball, growing a little with height so a fly ball reads
    // as airborne. A canvas-scaled version was tried and read as far too big
    // against the fielders and the diamond.
    const radius = clamp(3.2 + sim.ball.z / 34, 3, 7.5);

    // Comet tail: the last few world positions, fading and shrinking toward
    // the oldest, so the eye finds a moving 4px dot instantly.
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < this.ballTrail.length; i++) {
      const t = this.ballTrail[i];
      const p = this.toScreen({ x: t.x, y: t.y }, t.z);
      const frac = (i + 1) / (this.ballTrail.length + 1);
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

  private drawJoystick(ctx: CanvasRenderingContext2D): void {
    const j = this.joystick;
    const dx = j.x - j.originX;
    const dy = j.y - j.originY;
    const range = Math.hypot(dx, dy);
    const capped = Math.min(range, 52);
    const nx = range > 0 ? (dx / range) * capped : 0;
    const ny = range > 0 ? (dy / range) * capped : 0;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(j.originX, j.originY, 52, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(j.originX + nx, j.originY + ny, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
