import type { PlayOutcome, PlaySim, RunnerState } from '../core/playSim';
import type { BaseId, PositionId, Vec2 } from '../core/fieldGeometry';
import { ALL_POSITIONS, BASES, BASE_LABELS } from '../core/fieldGeometry';
import { wallHeightAt } from '../core/ballpark';
import { clamp } from '../core/rng';
import { createSurface, pointerPos, vibrate } from '../ui/canvas';
import type { Surface } from '../ui/canvas';
import type { Uniform } from '../core/uniforms';
import { Camera, RISE, TILT } from '../gfx/camera';
import { ParkRenderer } from '../gfx/park';
import type { Lighting } from '../gfx/palette';
import { CUE_GOLD, CUE_RED, lightingFor, skinFor } from '../gfx/palette';
import type { FigureAnim } from '../gfx/figure';
import { createAnim, drawFieldFigure, updateAnim } from '../gfx/figure';
import { drawBallTail, drawFieldBall } from '../gfx/ball';
import { drawCueRing, drawGuideLine, drawJoystick } from '../gfx/hud';
import { drawLightning, drawRain, drawTint, drawWindFlag } from '../gfx/weather';
import { CatchOverlay } from './catchOverlay';

/**
 * The live play, from a high seat behind the plate: a tilted view of the
 * diamond that tracks the ball and whoever the player is controlling, zooming
 * out when they spread apart so both stay on screen.
 *
 * On defense you drag anywhere to steer your fielder, then tap a base to throw
 * — or run the ball to the bag yourself.
 * On offense you decide whether to take the extra base.
 */

export type PlayerColors = Uniform;

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
  /**
   * The ball just cleared the fence, with `runs` coming home. Fires once, the
   * frame it happens — a couple of seconds before `onComplete` — so the
   * celebration lands with the moment rather than with the scorekeeping.
   */
  onHomeRun?(runs: number): void;
  onComplete(outcome: PlayOutcome): void;
}

const MIN_SCALE = 1.5;
const MAX_SCALE = 3.2;
/** Seconds the glove takes to bring a caught ball back in to the body. */
const CATCH_FX_SECONDS = 0.45;
/** A fielder this close to a ball in the air (feet) reaches for it. */
const REACH_RANGE = 14;

interface Joystick {
  active: boolean;
  originX: number;
  originY: number;
  x: number;
  y: number;
  pointerId: number;
}

/** Anything standing on the field, so it can be drawn back to front. */
interface Actor {
  screen: Vec2;
  draw(): void;
}

export class PlayView {
  private readonly root: HTMLElement;
  private readonly surface: Surface;
  private readonly sim: PlaySim;
  private readonly opts: PlayViewOptions;
  private readonly banner: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly status: HTMLElement;
  private readonly park: ParkRenderer;
  private readonly light: Lighting;
  private readonly cam = new Camera();

  private raf = 0;
  private destroyed = false;
  private lastFrame = 0;
  private lastEvent = '';
  private completed = false;
  private homeRunCalled = false;
  private catchOverlay: CatchOverlay | null = null;
  private _paused = false;
  /** Last rendered control set, so the DOM is only rebuilt when it changes. */
  private controlSignature = '';
  private statusText = '';
  /** Seconds the scene has been animating; frozen while paused. */
  private clock = 0;
  /** Animation state per fielder/runner, so run cycles persist across frames. */
  private anims = new Map<string, FigureAnim>();
  /** Recent ball positions in world space — the comet tail. */
  private ballTrail: { x: number; y: number; z: number }[] = [];
  /** Who had the ball last frame, to spot the moment a catch is made. */
  private prevCarrier: PositionId | null = null;
  /** Where the ball was last seen in the air, so the catch can be drawn from there. */
  private lastAir: { x: number; y: number; z: number } | null = null;
  /** The glove closing on a ball just caught: who, where it was taken, when. */
  private catchFx: { id: PositionId; from: { x: number; y: number; z: number }; start: number } | null = null;

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
    this.park = new ParkRenderer(this.sim.park);
    this.light = lightingFor(this.sim.weather);

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

    this.syncCamera();
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

    if (!this.homeRunCalled && this.clearedTheFence()) {
      this.homeRunCalled = true;
      // Every runner on the play scores on a ball over the fence, batter included.
      this.opts.onHomeRun?.(sim.runners.length);
    }

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

    this.syncCamera();
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
   * The batted ball has gone over the wall. Read off the sim when it says so;
   * otherwise judged here from the ball against the park, the same way the
   * derby rules it.
   */
  private clearedTheFence(): boolean {
    const sim = this.sim as PlaySim & { overTheFence?: boolean };
    if (typeof sim.overTheFence === 'boolean') return sim.overTheFence;
    const ball = sim.ball;
    return !sim.ballCarrier && this.park.isBeyondWall(ball) && ball.z > wallHeightAt(sim.park, ball);
  }

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

  private syncCamera(): void {
    this.cam.width = this.surface.width;
    this.cam.height = this.surface.height;
  }

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
    const mid = this.midpoint(this.focusPoints());
    this.cam.x = mid.x;
    this.cam.y = mid.y;
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
    const cam = this.cam;
    const points = this.focusPoints();
    const target = this.midpoint(points);

    let spanX = 0;
    let spanY = 0;
    for (const p of points) {
      spanX = Math.max(spanX, Math.abs(p.x - target.x) * 2);
      spanY = Math.max(spanY, Math.abs(p.y - target.y) * 2);
    }

    const W = cam.width;
    const H = cam.height;
    const fit = Math.min(W / Math.max(spanX + 90, 1), H / Math.max((spanY + 120) * TILT, 1));
    const desiredScale = clamp(fit, MIN_SCALE, MAX_SCALE);

    // When the view can't zoom out far enough to hold every focus point
    // (small screens), lean the camera toward the ball: it is the thing the
    // player must see, and the other points can fall off the edge instead.
    const ball = points[0];
    const overflow = Math.max(
      (spanX + 90) / (W / desiredScale),
      ((spanY + 120) * TILT) / (H / desiredScale),
      1,
    );
    const ballBias = clamp((overflow - 1) * 2, 0, 1);
    target.x += (ball.x - target.x) * ballBias;
    target.y += (ball.y - target.y) * ballBias;

    // Ease toward the target so the camera never snaps.
    const follow = 1 - Math.exp(-dt * 6);
    cam.x += (target.x - cam.x) * follow;
    cam.y += (target.y - cam.y) * follow;
    cam.scale += (desiredScale - cam.scale) * (1 - Math.exp(-dt * 3.5));

    // Keep the camera roughly over the field.
    cam.x = clamp(cam.x, -300, 300);
    cam.y = clamp(cam.y, -30, 380);

    this.keepBallOnScreen();
  }

  /** Hard guarantee: the ball (including its drawn height) never leaves the inner screen. */
  private keepBallOnScreen(): void {
    const sim = this.sim;
    const cam = this.cam;
    const W = cam.width;
    const H = cam.height;
    const marginX = Math.max(40, W * 0.18);
    const marginY = Math.max(40, H * 0.18);
    const air = this.ballScreen(sim.ball.x, sim.ball.y, sim.ball.z);
    const ground = cam.project({ x: sim.ball.x, y: sim.ball.y });

    if (air.x < marginX) cam.x -= (marginX - air.x) / cam.scale;
    else if (air.x > W - marginX) cam.x += (air.x - (W - marginX)) / cam.scale;

    const top = Math.min(air.y, ground.y);
    const bottom = Math.max(air.y, ground.y);
    if (top < marginY) cam.y += (marginY - top) / (cam.scale * TILT);
    else if (bottom > H - marginY) cam.y -= (bottom - (H - marginY)) / (cam.scale * TILT);
  }

  /* ----------------------------------------------------------------- render */

  private draw(dt: number): void {
    const { ctx } = this.surface;
    const cam = this.cam;
    const W = cam.width;
    const H = cam.height;
    if (W <= 0 || H <= 0) return;
    this.clock += dt;

    const sim = this.sim;
    const park = this.park;
    const light = this.light;
    const ballBeyondWall = !sim.ballCarrier && park.isBeyondWall(sim.ball);
    this.trackCatch();

    park.drawGround(ctx, cam, light);
    park.drawStands(ctx, cam, light, this.opts.crowd);
    // A ball that has left the yard lands behind the wall, so it goes under it.
    this.updateBallTrail();
    if (ballBeyondWall) this.drawBall(ctx);
    park.drawWall(ctx, cam, light);
    park.drawTowers(ctx, cam, light);

    this.drawDugouts(ctx, dt);
    this.drawGroundCues(ctx);

    // Everyone on the field, back to front.
    const actors = this.collectActors(dt);
    actors.sort((a, b) => a.screen.y - b.screen.y);
    for (const actor of actors) actor.draw();

    if (!ballBeyondWall) this.drawBall(ctx);
    this.drawThrowTelegraph(ctx);
    if (this.joystick.active) {
      drawJoystick(ctx, this.joystick.originX, this.joystick.originY, this.joystick.x, this.joystick.y, 52);
    }

    drawRain(ctx, W, H, sim.weather, this.clock);
    drawTint(ctx, W, H, light);
    drawLightning(ctx, W, H, sim.weather, this.clock);
    // Under the pause button, clear of the coach tip once it's gone.
    drawWindFlag(ctx, 10, 52, sim.weather);
  }

  private spriteHeight(): number {
    // Kept well above true scale — at real proportions a ballplayer is a
    // handful of pixels on a phone and the run cycle is invisible.
    return clamp(15 * this.cam.scale, 28, 52);
  }

  /**
   * Where the ball is drawn. The figures stand about three times life size,
   * so a ball drawn at its true height arrives at their ankles when it's
   * really at the glove. Near the ground the ball's height is stretched by
   * the same factor as the figures; high up the stretch levels off to a
   * fixed offset, so a fly ball still flies the same arc and the camera
   * isn't chasing it off the top of the screen.
   */
  private ballScreen(x: number, y: number, z: number): Vec2 {
    const lifeSize = 6 * this.cam.scale * RISE;
    const exaggeration = this.spriteHeight() / lifeSize;
    const gloveBand = 8;
    const stretched = z + (exaggeration - 1) * gloveBand * (1 - Math.exp(-z / gloveBand));
    return this.cam.project({ x, y }, stretched);
  }

  /** Animation state is keyed per entity so run cycles carry across frames. */
  private animFor(key: string, p: Vec2, dt: number): FigureAnim {
    let anim = this.anims.get(key);
    if (!anim) {
      anim = createAnim(p.x, p.y);
      this.anims.set(key, anim);
    }
    updateAnim(anim, p.x, p.y, dt, this.spriteHeight() * 0.85);
    return anim;
  }

  /**
   * Notice the frame a fielder takes the ball, and remember where it was in
   * the air just before, so the glove can be drawn closing on that spot and
   * bringing the ball in rather than the ball simply vanishing.
   */
  private trackCatch(): void {
    const sim = this.sim;
    const carrier = sim.ballCarrier;
    if (carrier && carrier !== this.prevCarrier) {
      this.catchFx = {
        id: carrier,
        from: this.lastAir ?? { x: sim.ball.x, y: sim.ball.y, z: sim.ball.z },
        start: this.clock,
      };
    }
    this.prevCarrier = carrier;
    if (!carrier) this.lastAir = { x: sim.ball.x, y: sim.ball.y, z: sim.ball.z };
  }

  /** The one fielder near enough to a ball in the air to be reaching for it. */
  private reachingFielder(): PositionId | null {
    const sim = this.sim;
    const ball = sim.ball;
    if (sim.ballCarrier || ball.atRest || ball.z > 12 || sim.phase === 'dead') return null;
    let best: PositionId | null = null;
    let bestDist = REACH_RANGE;
    for (const f of sim.fielders) {
      const d = Math.hypot(f.x - ball.x, f.y - ball.y);
      if (d < bestDist) {
        bestDist = d;
        best = f.id;
      }
    }
    return best;
  }

  private collectActors(dt: number): Actor[] {
    const { ctx } = this.surface;
    const sim = this.sim;
    const cam = this.cam;
    const height = this.spriteHeight();
    const actors: Actor[] = [];
    const reacher = this.reachingFielder();
    const airBall = this.ballScreen(sim.ball.x, sim.ball.y, sim.ball.z);
    const fx = this.catchFx && this.clock - this.catchFx.start < CATCH_FX_SECONDS ? this.catchFx : null;

    for (const runner of sim.runners) {
      if (runner.out || runner.at >= 4) continue;
      const p = cam.project(sim.runnerPosition(runner));
      const anim = this.animFor(`r:${runner.id}`, p, dt);
      actors.push({
        screen: p,
        draw: () => {
          drawFieldFigure(ctx, p.x, p.y, {
            height,
            kit: this.opts.battingKit,
            anim,
            skin: skinFor(runner.id.length * 31 + runner.startBase),
            helmet: true,
            highlight: runner.isUser,
            shadow: this.light.shadow,
          });
          if (runner.isUser) this.drawIntentArrow(ctx, p, runner);
        },
      });
    }

    for (const fielder of sim.fielders) {
      const p = cam.project({ x: fielder.x, y: fielder.y });
      const anim = this.animFor(`f:${fielder.id}`, p, dt);
      const index = ALL_POSITIONS.indexOf(fielder.id);

      // The glove: closing on a ball just taken and drawing it in, stretched
      // toward one about to arrive, or the ball up by the ear ready to throw.
      let reach: Vec2 | undefined;
      let ballInGlove = false;
      let holdingBall = false;
      if (fx && fx.id === fielder.id) {
        const t = (this.clock - fx.start) / CATCH_FX_SECONDS;
        const ease = t * t * (3 - 2 * t);
        const from = this.ballScreen(fx.from.x, fx.from.y, fx.from.z);
        reach = { x: from.x + (p.x - from.x) * ease, y: from.y + (p.y - height * 0.46 - from.y) * ease };
        ballInGlove = true;
      } else if (fielder.hasBall) {
        holdingBall = true;
      } else if (reacher === fielder.id) {
        reach = airBall;
      }

      actors.push({
        screen: p,
        draw: () =>
          drawFieldFigure(ctx, p.x, p.y, {
            height,
            kit: this.opts.fieldingKit,
            anim,
            skin: skinFor(index + 11),
            glove: true,
            number: String(index + 1),
            highlight: fielder.isUser,
            holdingBall,
            reach,
            ballInGlove,
            shadow: this.light.shadow,
          }),
      });
    }
    return actors;
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

  private drawDugout(ctx: CanvasRenderingContext2D, dt: number, side: 1 | -1, kit: PlayerColors): void {
    const cam = this.cam;
    const spots = this.park.drawDugoutPit(ctx, cam, this.light, side, kit.shirt);
    if (!spots) return;

    const plate = cam.project(BASES[0]);
    const height = this.spriteHeight();
    // Fed a fixed point rather than the screen position, so a camera pan
    // doesn't set their legs churning — they only idle.
    const idle = (key: string, p: Vec2): FigureAnim => {
      const anim = this.animFor(key, { x: 0, y: 0 }, dt);
      anim.facing = Math.atan2(plate.y - p.y, plate.x - p.x);
      return anim;
    };
    spots.bench.forEach((w, i) => {
      const p = cam.project(w, 1.5);
      drawFieldFigure(ctx, p.x, p.y, {
        height: height * 0.62,
        kit,
        anim: idle(`d:${side}:b${i}`, p),
        skin: skinFor(i + 40 + side * 7),
        shadow: 0.15,
      });
    });
    this.park.drawDugoutRoof(ctx, cam, this.light, side);
    spots.rail.forEach((w, i) => {
      const p = cam.project(w);
      drawFieldFigure(ctx, p.x, p.y, {
        height: height * 0.78,
        kit,
        anim: idle(`d:${side}:r${i}`, p),
        skin: skinFor(i + 50 + side * 7),
        shadow: this.light.shadow,
      });
    });
  }

  /** Rings on the ground: where a fly ball lands, and bags with a play on. */
  private drawGroundCues(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    const cam = this.cam;

    // The circle a fly ball is coming down into — the whole point of the mode.
    if (sim.phase === 'live' && !sim.ball.bounced && sim.ball.z >= 6) {
      const p = cam.project(sim.landingPoint);
      const pulse = 0.65 + Math.sin(this.clock * 7) * 0.25;
      drawCueRing(ctx, p.x, p.y, Math.max(9, 7 * cam.scale), { pulse, dashed: true, squash: TILT, dot: true });
    }

    // With the ball in the player's glove, ring every bag where a play is on.
    const bases = sim.forcePlayBases;
    if (bases.length > 0) {
      const pulse = 0.55 + Math.sin(this.clock * 4.5) * 0.2;
      for (const base of bases) {
        const p = cam.project(BASES[base]);
        drawCueRing(ctx, p.x, p.y, Math.max(11, 9 * cam.scale), { pulse, squash: TILT });
      }
    }
  }

  /**
   * Where you're headed and whether it's contested: a line to the bag you're
   * running into, a ring on it, and both turning red when a throw is beating
   * you there.
   */
  private drawIntentArrow(ctx: CanvasRenderingContext2D, p: Vec2, runner: RunnerState): void {
    if (runner.progress <= 0 && runner.at >= runner.intent) return;
    const next = this.sim.userRunnerNextBase;
    if (next === null) return;

    const contested = this.sim.throwBeatingUserRunner;
    const colour = contested ? CUE_RED : CUE_GOLD;
    const target = this.cam.project(BASES[next]);
    drawGuideLine(ctx, { x: p.x, y: p.y - 4 }, target, colour, 0.85, 2.5);
    const pulse = contested ? 0.55 + Math.sin(this.clock * 11) * 0.35 : 0.5 + Math.sin(this.clock * 4.5) * 0.18;
    drawCueRing(ctx, target.x, target.y, Math.max(11, 9 * this.cam.scale), {
      colour,
      pulse,
      squash: TILT,
      width: contested ? 3.5 : 2.5,
    });
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
    const cam = this.cam;
    const target = cam.project(BASES[flight.base]);
    const ball = this.ballScreen(sim.ball.x, sim.ball.y, sim.ball.z);
    const contested = sim.setup.userSide === 'offense' && sim.userRunnerNextBase === flight.base;
    const colour = contested ? CUE_RED : CUE_GOLD;

    drawGuideLine(ctx, ball, target, colour, 0.45, 1.5);
    const bagR = Math.max(11, 9 * cam.scale);
    const r = bagR + (1 - flight.progress) * Math.max(26, 22 * cam.scale);
    drawCueRing(ctx, target.x, target.y, r, {
      colour,
      pulse: 0.5 + flight.progress * 0.45,
      squash: TILT,
      width: 2 + flight.progress * 2,
    });
  }

  /** Feed the comet tail. Points are kept in world space so the trail marks where the ball flew. */
  private updateBallTrail(): void {
    const sim = this.sim;
    if (sim.ballCarrier || sim.ball.atRest || this._paused) {
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
    const cam = this.cam;
    const ground = cam.project({ x: sim.ball.x, y: sim.ball.y });
    const air = this.ballScreen(sim.ball.x, sim.ball.y, sim.ball.z);
    const radius = Math.min(7.5, Math.max(3, 3 + sim.ball.z / 40));
    drawBallTail(ctx, this.ballTrail.map((t) => this.ballScreen(t.x, t.y, t.z)).concat([air]), radius);
    drawFieldBall(ctx, air, ground, sim.ball.z, cam.scale, this.light.shadow);
  }
}
