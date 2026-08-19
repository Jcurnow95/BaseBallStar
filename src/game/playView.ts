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
 * On defense you drag anywhere to steer your fielder and tap a base to throw.
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
 * Dugouts sit in foul territory, parallel to the lines. Measured in feet:
 * how far down the line the bench is centred, how far off the line it sits,
 * and its footprint. Eight players stand at the rail in each — the rest of the
 * side that isn't on the field or the bases.
 */
const DUGOUT_ALONG = 74;
const DUGOUT_OFFSET = 34;
const DUGOUT_LENGTH = 62;
const DUGOUT_DEPTH = 13;
const DUGOUT_BENCH = 8;

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
  /** Outfield seats in world space, built once — the bowl never moves. */
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
      text = 'TAP A BASE TO THROW';
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

    // Ease toward the target so the camera never snaps.
    const follow = 1 - Math.exp(-dt * 6);
    this.camera.x += (target.x - this.camera.x) * follow;
    this.camera.y += (target.y - this.camera.y) * follow;
    this.scale += (desiredScale - this.scale) * (1 - Math.exp(-dt * 3.5));

    // Keep the camera roughly over the field.
    this.camera.x = clamp(this.camera.x, -300, 300);
    this.camera.y = clamp(this.camera.y, -30, 380);
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
    this.drawDugouts(ctx, dt);
    this.drawLandingMarker(ctx);
    this.drawRunners(ctx, dt);
    this.drawFielders(ctx, dt);
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

    // Mown bands run across the field in world space, so they scroll with the
    // camera the way the stripes do in a real park.
    const band = 26;
    const startBand = Math.floor((this.camera.y - H / 2 / this.scale) / band) - 1;
    const endBand = Math.ceil((this.camera.y + H / 2 / this.scale) / band) + 1;
    ctx.fillStyle = GRASS_LIGHT;
    for (let i = startBand; i <= endBand; i++) {
      if (i % 2 !== 0) continue;
      const top = this.toScreen({ x: 0, y: (i + 1) * band }).y;
      const bottom = this.toScreen({ x: 0, y: i * band }).y;
      ctx.fillRect(0, top, W, bottom - top);
    }
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
   * The crowd in the outfield stand.
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
   * Lay the bowl out once. Seat order is hashed rather than sequential, so
   * taking the first N of them for a given crowd size scatters people through
   * the whole stand instead of packing them in from one foul pole round.
   */
  private buildSeats(): (Vec2 & { colour: string })[] {
    const park = this.sim.park;
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

    ctx.save();

    // Dirt apron in front, so the bench doesn't sit straight on the grass.
    ctx.fillStyle = DIRT;
    poly([at(a0 - 3, o0 - 5), at(a1 + 3, o0 - 5), at(a1 + 3, o0 + 1), at(a0 - 3, o0 + 1)]);
    ctx.fill();

    // The sunken floor, then the roof shading the back half.
    ctx.fillStyle = '#4a5468';
    poly(corners);
    ctx.fill();
    ctx.fillStyle = '#2b3243';
    poly([
      at(a0, o0 + DUGOUT_DEPTH * 0.55),
      at(a1, o0 + DUGOUT_DEPTH * 0.55),
      at(a1, o1),
      at(a0, o1),
    ]);
    ctx.fill();

    // Bench along the back wall, in the team's colour.
    ctx.strokeStyle = kit.shirt;
    ctx.lineWidth = Math.max(2, 2.2 * this.scale);
    ctx.lineCap = 'butt';
    const b0 = at(a0 + 2, o1 - 2.5);
    const b1 = at(a1 - 2, o1 - 2.5);
    ctx.beginPath();
    ctx.moveTo(b0.x, b0.y);
    ctx.lineTo(b1.x, b1.y);
    ctx.stroke();

    // Outline of the pit, and the rail on the field side.
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(1, 0.8 * this.scale);
    poly(corners);
    ctx.stroke();
    ctx.strokeStyle = '#d7dbe6';
    ctx.lineWidth = Math.max(1.5, 1.1 * this.scale);
    const r0 = at(a0, o0);
    const r1 = at(a1, o0);
    ctx.beginPath();
    ctx.moveTo(r0.x, r0.y);
    ctx.lineTo(r1.x, r1.y);
    ctx.stroke();

    ctx.restore();

    // The bench, spread along the rail, all watching the plate. A touch
    // smaller than the nine in play so the dugout reads as background.
    const height = this.spriteHeight() * 0.8;
    const stride = (DUGOUT_LENGTH - 10) / (DUGOUT_BENCH - 1);
    const plate = this.toScreen(BASES[0]);
    for (let i = 0; i < DUGOUT_BENCH; i++) {
      // A little stagger so they don't stand in a parade line.
      const stagger = ((i * 7 + (side > 0 ? 3 : 0)) % 5) * 0.6;
      const p = at(a0 + 5 + i * stride, o0 + 3.5 + stagger);
      // Fed a fixed point rather than the screen position, so a camera pan
      // doesn't set their legs churning — they only idle.
      const anim = this.animFor(`d:${side}:${i}`, { x: 0, y: 0 }, dt);
      anim.facing = Math.atan2(plate.y - p.y, plate.x - p.x);
      drawPlayer(ctx, p.x, p.y, { height, colors: kit, anim });
    }
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
