import type { AtBatOutcome, Pitch, PitchType, PlayerProfile } from '../core/types';
import type { Count, PitcherAI } from '../core/pitching';
import { readPitch, throwPitch } from '../core/pitching';
import type { BattedBall } from '../core/types';
import { IDEAL_UNDER, resolveSwing, sweetSpotRadius } from '../core/swing';
import { foulChanceFor } from '../core/outcome';
import { hasBattingEye, hasPerfectZone } from '../core/progression';
import { launchBall, predictLanding } from '../core/ballFlight';
import { isFair } from '../core/fieldGeometry';
import type { Uniform } from '../core/uniforms';
import { Rng, clamp, lerp } from '../core/rng';
import type { LeagueLevel } from '../core/league';
import { createSurface, pointerPos, vibrate } from '../ui/canvas';
import type { Surface } from '../ui/canvas';
import { playSound } from '../ui/audio';
import type { AirConditions, Weather } from '../core/weather';
import { CALM, airFor } from '../core/weather';
import type { Lighting } from '../gfx/palette';
import { CUE_GOLD, CUE_GREEN, alpha, lightingFor } from '../gfx/palette';
import { drawBaseball } from '../gfx/ball';
import { PITCH_RELEASE_POINT, drawBatter, drawPitcher } from '../gfx/figure';
import type { SceneLayout } from '../gfx/scene';
import { stadiumForLevel } from '../gfx/park';
import {
  STAGE_ASPECT,
  batterAnchor,
  drawFarPark,
  drawGround,
  drawHaze,
  drawSky,
  pitcherAnchor,
  sceneLayout,
} from '../gfx/scene';
import { drawLightning, drawRain, drawRainSplashes, drawTint, drawWindFlag } from '../gfx/weather';
import { drawTapMark } from '../gfx/hud';

/**
 * The at-bat minigame.
 *
 * Catcher POV. The ball leaves the pitcher's hand small and far, grows as it
 * comes, and breaks late toward its real location. Tap it. Where inside the
 * ball you land decides the whole result — see `core/swing.ts`.
 *
 * A timing ring converges on the ball through the flight. On a strike it
 * locks gold — with a gold glow behind the ball — while it's over the plate,
 * marking the best moment to tap. On a ball off the plate it dissolves as it
 * arrives and no glow ever comes: gold means swing, no gold means lay off.
 * See the PRIME_* constants.
 */

export interface AtBatOptions {
  player: PlayerProfile;
  pitcher: PitcherAI;
  level: LeagueLevel;
  rng: Rng;
  /** Uniform the opposing pitcher is wearing. */
  pitcherKit: Uniform;
  /** Uniform the batter (the player) is wearing. */
  batterKit: Uniform;
  /** The day's weather. Drawn, and used to judge whether contact stays fair. */
  weather?: Weather;
  /**
   * How full the stands are, 0-1, when it isn't just the level's own number:
   * October and a famous name both fill seats. Left out, the level decides.
   */
  crowd?: number;
  /**
   * How much stadium is out past the wall, as the rung of the ladder
   * (0 = Single-A, 3 = the Majors). Left out, the old seven-row bowl.
   */
  stadium?: number;
  /** Home Run Derby grooving: every pitch a fastball over the heart. */
  groove?: boolean;
  onCount(count: Count): void;
  /** A fair ball was put in play — the play itself resolves on the field. */
  onBallInPlay(battedBall: BattedBall): void;
  /** Strikeout or walk; nothing for the defense to do. */
  onComplete(outcome: AtBatOutcome): void;
}

type Phase = 'windup' | 'flight' | 'freeze';

const WINDUP_MS = 900;
const FREEZE_MS = 1250;
/** Flight continues past the plate so late swings still have something to hit. */
const OVERRUN = 1.22;
/**
 * The prime tap window, in flight progress. `PRIME_AT` is the ball dead over
 * the plate — full-size, and the timing the spray model treats as square (see
 * `core/swing.ts`). The window opens as the ball arrives and closes once it's
 * dropping past the zone: inside it a strike glows gold and the timing ring
 * locks on, which is the whole "swing NOW" signal. A ball gets neither —
 * the ring washes out instead, so a pitch worth taking never wears the
 * swing colour. Display only — nothing about how a swing resolves reads
 * these.
 */
const PRIME_AT = 0.98;
const PRIME_START = 0.88;
const PRIME_END = 1.12;

/** History-dot colour per pitch type: hot colours for velocity, cool for spin. */
const PITCH_DOT_COLOURS: Record<PitchType, string> = {
  fastball: '#ff6b6b',
  sinker: '#ff9a3d',
  slider: '#5da9ff',
  curveball: '#b07fff',
  changeup: '#3ad6c2',
};

interface BallState {
  x: number;
  y: number;
  r: number;
  /** Seam rotation in radians — the ball visibly spins as it comes in. */
  rot: number;
}

interface Layout {
  ox: number;
  oy: number;
  canvasW: number;
  canvasH: number;
  W: number;
  H: number;
  cx: number;
  scene: SceneLayout;
  zoneY: number;
  zoneHW: number;
  zoneHH: number;
  /** Where the ball leaves the pitcher's hand. */
  release: { x: number; y: number };
  minR: number;
  maxR: number;
}

export class AtBatView {
  private readonly root: HTMLElement;
  private readonly surface: Surface;
  private readonly banner: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly opts: AtBatOptions;

  private phase: Phase = 'windup';
  /**
   * Milliseconds into the current phase, advanced by the frame loop.
   *
   * The frame loop stops whenever the app is minimised or backgrounded, but
   * the wall clock doesn't, so reading this off the clock found the pitch
   * long past the plate on return. Advancing only by frames means time
   * simply doesn't pass while you're away.
   */
  private phaseElapsed = 0;
  /** Milliseconds since the ball left the hand; drives the follow-through. */
  private sinceRelease = 0;
  private lastFrame = 0;
  private raf = 0;
  private destroyed = false;
  /** Frozen: the loop keeps drawing but no time passes and taps are ignored. */
  paused = false;

  private count: Count = { balls: 0, strikes: 0 };
  private pitch!: Pitch;
  private pitchLabel = '';
  private swung = false;
  private trail: BallState[] = [];
  /**
   * Every pitch of this plate appearance, oldest first — the history dots by
   * the zone. Recorded only once a pitch resolves, so the dot never gives away
   * what the ball still in the air really is.
   */
  private history: { type: PitchType; mph: number }[] = [];

  private tapPoint: { x: number; y: number } | null = null;
  private frozenBall: BallState | null = null;
  private afterFreeze: (() => void) | null = null;
  private readonly perfectZoneUnlocked: boolean;
  /** Vision high enough that the ring and glow tell strike from ball. */
  private readonly battingEye: boolean;
  private readonly weather: Weather;
  private readonly light: Lighting;
  private readonly air: AirConditions;
  /** Seconds the scene has been animating; only advances while unpaused. */
  private clock = 0;

  constructor(root: HTMLElement, opts: AtBatOptions) {
    this.root = root;
    this.opts = opts;
    this.root.classList.add('atbat');
    this.root.innerHTML = '';
    this.perfectZoneUnlocked = hasPerfectZone(opts.player.attributes);
    this.battingEye = hasBattingEye(opts.player.attributes);
    this.weather = opts.weather ?? CALM;
    this.light = lightingFor(this.weather);
    this.air = airFor(this.weather);

    this.surface = createSurface(this.root);

    this.readout = document.createElement('div');
    this.readout.className = 'atbat-read';
    this.root.appendChild(this.readout);

    this.banner = document.createElement('div');
    this.banner.className = 'atbat-banner';
    this.root.appendChild(this.banner);

    this.surface.canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.opts.onCount(this.count);
    this.nextPitch();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.surface.canvas.removeEventListener('pointerdown', this.onPointerDown);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.surface.dispose();
    this.root.classList.remove('atbat');
    this.root.innerHTML = '';
  }

  /* ------------------------------------------------------------ sequencing */

  private nextPitch(): void {
    this.pitch = throwPitch(this.opts.pitcher, this.count, this.opts.rng, {
      groove: this.opts.groove,
    });
    this.pitchLabel = readPitch(this.pitch, this.opts.player.attributes.vision, this.opts.rng);
    this.swung = false;
    this.tapPoint = null;
    this.frozenBall = null;
    this.trail = [];
    this.sinceRelease = 0;
    this.setPhase('windup');
    this.banner.className = 'atbat-banner';
    this.banner.textContent = '';
    this.readout.textContent = '';
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseElapsed = 0;
  }

  private freezeThen(text: string, tone: string, action: () => void): void {
    // Every pitch resolution passes through here exactly once, which makes it
    // the one place the pitch can join the history.
    this.history.push({ type: this.pitch.def.type, mph: this.pitch.mph });
    this.banner.textContent = text;
    this.banner.className = `atbat-banner show ${tone}`;
    this.afterFreeze = action;
    this.setPhase('freeze');
  }

  private registerStrike(text: string, tone = 'bad'): void {
    this.count.strikes++;
    this.opts.onCount(this.count);
    if (this.count.strikes >= 3) {
      this.freezeThen(text, tone, () =>
        this.complete({
          result: 'strikeout',
          description: text.includes('Called') ? 'Caught looking. Strike three.' : 'Strike three swinging.',
          terminal: true,
          basesAdvanced: 0,
        }),
      );
      return;
    }
    this.freezeThen(text, tone, () => this.nextPitch());
  }

  private registerBall(): void {
    this.count.balls++;
    this.opts.onCount(this.count);
    if (this.count.balls >= 4) {
      this.freezeThen('BALL FOUR', 'good', () =>
        this.complete({
          result: 'walk',
          description: 'Good eye — ball four. Take your base.',
          terminal: true,
          basesAdvanced: 1,
        }),
      );
      return;
    }
    this.freezeThen('Ball', 'neutral', () => this.nextPitch());
  }

  private registerFoul(text: string): void {
    if (this.count.strikes < 2) {
      this.count.strikes++;
      this.opts.onCount(this.count);
    }
    this.freezeThen(text, 'neutral', () => this.nextPitch());
  }

  private complete(outcome: AtBatOutcome): void {
    if (this.destroyed) return;
    this.opts.onComplete(outcome);
  }

  /* ----------------------------------------------------------------- input */

  /**
   * The phase clock only advances with frames, so being backgrounded costs no
   * game time. But a pitch you were half-way through reading is gone — coming
   * back to a ball already on top of you isn't a fair swing. Re-deliver it.
   */
  private onVisibilityChange = (): void => {
    if (document.hidden) return;
    this.lastFrame = performance.now();
    if (this.phase === 'flight' && !this.swung) {
      this.trail = [];
      this.sinceRelease = 0;
      this.setPhase('windup');
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.paused) return;
    if (this.phase === 'freeze' || this.swung) return;

    // Ball positions live in stage space, so the tap has to be moved into it
    // before the two can be compared.
    const tap = pointerPos(this.surface.canvas, e);
    const { x, y } = this.toStage(tap.x, tap.y);

    if (this.phase === 'windup') {
      // Before the pitch is even thrown: prodding the screen isn't a swing.
      this.readout.textContent = 'WAIT FOR THE PITCH…';
      return;
    }

    this.swing(x, y);
  };

  private swing(x: number, y: number): void {
    this.swung = true;
    const t = this.flightProgress();
    const ball = this.ballAt(t);

    this.tapPoint = { x, y };
    this.frozenBall = ball;

    const result = resolveSwing(
      {
        offsetX: (x - ball.x) / ball.r,
        offsetY: (y - ball.y) / ball.r,
        timing: t,
      },
      { attributes: this.opts.player.attributes, stamina: this.opts.player.stamina },
      this.opts.rng,
    );

    if (result.whiff || !result.battedBall) {
      vibrate(15);
      playSound('whiff');
      // The ball carries on into the glove behind you. Guarded, so leaving the
      // screen inside that gap doesn't drop a stray thump on the next one.
      window.setTimeout(() => {
        if (!this.destroyed) playSound('mitt');
      }, 110);
      this.registerStrike(t < 0.7 ? 'Early. Swing and a miss.' : 'Swing and a miss.');
      return;
    }

    const bb = result.battedBall;
    this.readout.textContent = `${Math.round(bb.exitVelocity)} mph · ${Math.round(bb.launchAngle)}°`;

    // Two ways to foul one off: hit it outside the lines, or catch it badly
    // enough that it goes back to the screen. The second keeps counts
    // developing at the rate the plate-appearance balance was tuned for.
    const landing = predictLanding(
      launchBall(bb.exitVelocity, bb.launchAngle, bb.spray, 1, bb.sideSpin ?? 0, this.air),
    );
    const sprayedFoul = !isFair(landing.point);
    const chippedFoul = this.opts.rng.chance(foulChanceFor(bb.quality));

    if (sprayedFoul || chippedFoul) {
      vibrate(20);
      playSound('foul');
      this.registerFoul(sprayedFoul ? 'Sliced foul.' : 'Fouled off.');
      return;
    }

    playSound(
      bb.quality === 'barrel'
        ? 'contactBarrel'
        : bb.quality === 'solid'
          ? 'contactSolid'
          : 'contactWeak',
    );

    const headline =
      bb.quality === 'barrel'
        ? 'BARRELED!'
        : bb.quality === 'solid'
          ? 'Solid contact'
          : 'In play';

    vibrate(bb.quality === 'barrel' ? 45 : 20);
    // Everything fair now goes to the field, where the play actually happens.
    this.freezeThen(headline, 'good', () => this.opts.onBallInPlay(bb));
  }

  /* ------------------------------------------------------------ simulation */

  private flightProgress(): number {
    return this.phaseElapsed / this.pitch.def.duration;
  }

  /**
   * The play area, as a fixed-aspect portrait box fitted inside the canvas and
   * centred. Everything here is in *stage* coordinates, with `ox`/`oy` giving
   * the stage's offset within the canvas, so the strike zone and the ball
   * keep their shape on any screen.
   */
  private layout(): Layout {
    const canvasW = this.surface.width;
    const canvasH = this.surface.height;

    let W = canvasW;
    let H = W / STAGE_ASPECT;
    if (H > canvasH) {
      H = canvasH;
      W = H * STAGE_ASPECT;
    }

    const scene = sceneLayout(W, H);
    const pitcher = pitcherAnchor(scene);

    return {
      ox: (canvasW - W) / 2,
      oy: (canvasH - H) / 2,
      canvasW,
      canvasH,
      W,
      H,
      cx: W / 2,
      scene,
      // The zone fills the bottom third: big, and close to where a thumb
      // already rests.
      zoneY: H * 0.6,
      zoneHW: W * 0.24,
      zoneHH: H * 0.125,
      // The ball leaves the throwing hand at the moment the figure releases.
      release: {
        x: pitcher.x + PITCH_RELEASE_POINT[0] * pitcher.h,
        y: pitcher.y - PITCH_RELEASE_POINT[1] * pitcher.h,
      },
      minR: Math.max(3, W * 0.015),
      // Sized for a fingertip, not for realism. Tap offsets are measured in ball
      // radii (see `core/swing.ts`), so a bigger ball is a bigger target in
      // pixels at exactly the same difficulty.
      maxR: Math.max(W * 0.16, 34),
    };
  }

  /** Canvas point -> stage point. */
  private toStage(x: number, y: number): { x: number; y: number } {
    const L = this.layout();
    return { x: x - L.ox, y: y - L.oy };
  }

  private zonePos(zx: number, zy: number) {
    const L = this.layout();
    return { x: L.cx + zx * L.zoneHW, y: L.zoneY + zy * L.zoneHH };
  }

  /** Ball position and radius at flight progress `t` (1.0 = crossing the plate). */
  private ballAt(t: number): BallState {
    const L = this.layout();
    const p = clamp(t, 0, OVERRUN);
    const capped = Math.min(p, 1);

    // Perspective: slow apparent movement early, rushing at the end.
    const travel = Math.pow(capped, 2.15);
    // Flatter than `travel`, so the ball is already a fat target through the
    // swing window rather than only at the instant it reaches the plate.
    const grow = Math.pow(capped, 1.6);
    // Break arrives late, which is what makes a slider a slider.
    const breakIn = Math.pow(capped, this.pitch.def.breakSharpness);

    const apparent = this.zonePos(this.pitch.releaseX, this.pitch.releaseY);
    const actual = this.zonePos(this.pitch.plateX, this.pitch.plateY);
    const targetX = lerp(apparent.x, actual.x, breakIn);
    const targetY = lerp(apparent.y, actual.y, breakIn);

    let x = lerp(L.release.x, targetX, travel);
    let y = lerp(L.release.y, targetY, travel);
    let r = lerp(L.minR, L.maxR, grow);

    if (p > 1) {
      const over = p - 1;
      y += over * L.H * 0.55;
      x += (x - L.cx) * over * 0.35;
      r *= 1 + over * 0.7;
    }

    // A couple of visible turns over the flight, spinning toward the break
    // side. Far fewer than real backspin — full speed would just strobe.
    const spinDir = this.pitch.plateX - this.pitch.releaseX >= 0 ? 1 : -1;
    const rot = spinDir * p * Math.PI * 2 * 1.4;

    return { x, y, r, rot };
  }

  /* --------------------------------------------------------------- render */

  private loop = (): void => {
    if (this.destroyed) return;
    const now = performance.now();
    // Capped, so a hitch or a spell in the background is a pause, not a jump.
    if (!this.paused) {
      const step = Math.min(now - this.lastFrame, 50);
      this.phaseElapsed += step;
      this.clock += step / 1000;
      if (this.phase !== 'windup') this.sinceRelease += step;
    }
    this.lastFrame = now;

    if (this.phase === 'windup' && this.phaseElapsed >= WINDUP_MS) {
      this.setPhase('flight');
      this.readout.textContent = '';
    } else if (this.phase === 'flight') {
      const t = this.flightProgress();
      // The pitch reveals itself out of the hand — how reliably depends on Vision.
      if (!this.swung && t > 0.22 && this.readout.textContent !== this.pitchLabel) {
        this.readout.textContent = this.pitchLabel;
      }
      if (!this.swung && t >= OVERRUN) {
        // Took the pitch — the umpire decides.
        this.swung = true;
        playSound('mitt');
        if (this.pitch.isStrike) this.registerStrike('Called strike.', 'bad');
        else this.registerBall();
      }
    } else if (this.phase === 'freeze' && this.phaseElapsed >= FREEZE_MS) {
      const action = this.afterFreeze;
      this.afterFreeze = null;
      if (action) action();
    }

    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    const { ctx } = this.surface;
    const L = this.layout();
    if (L.W <= 0 || L.H <= 0) return;

    // Work in stage space. The backdrop bleeds past the stage to cover the
    // whole canvas, so a wider screen shows more park rather than bars.
    ctx.save();
    ctx.translate(L.ox, L.oy);
    const bleed = { left: -L.ox, top: -L.oy, right: L.canvasW - L.ox, bottom: L.canvasH - L.oy };

    drawSky(ctx, L.scene, bleed, this.light, this.weather, this.clock);
    drawFarPark(
      ctx,
      L.scene,
      bleed,
      this.light,
      clamp(this.opts.crowd ?? this.opts.level.crowd, 0, 1),
      this.opts.stadium == null ? undefined : stadiumForLevel(this.opts.stadium),
    );
    drawGround(ctx, L.scene, bleed, this.light);
    drawHaze(ctx, L.scene, bleed, this.light);

    this.drawPitcher(ctx, L);
    this.drawZone(ctx, L);
    this.drawCountHud(ctx, L);
    this.drawBatter(ctx, L);

    if (this.phase === 'flight') {
      const t = this.flightProgress();
      const ball = this.ballAt(t);
      this.trail.push(ball);
      if (this.trail.length > 6) this.trail.shift();
      this.drawPrimeGlow(ctx, ball, t);
      this.drawBall(ctx, ball);
      this.drawTimingRing(ctx, ball, t, L);
      this.drawPerfectZone(ctx, ball, L);
    } else if (this.phase === 'freeze') {
      this.drawFreeze(ctx);
    }

    ctx.restore();

    // Weather sits over the whole canvas, not just the stage.
    drawRain(ctx, L.canvasW, L.canvasH, this.weather, this.clock);
    drawRainSplashes(ctx, L.canvasW, L.canvasH, this.weather, this.clock, L.oy + L.H * 0.58);
    drawTint(ctx, L.canvasW, L.canvasH, this.light);
    drawLightning(ctx, L.canvasW, L.canvasH, this.weather, this.clock);
    // Under the pause button, clear of the readout across the top.
    drawWindFlag(ctx, 10, 52, this.weather);
  }

  /** The pitcher on the mound: gather, leg kick, stride, release, follow-through. */
  private drawPitcher(ctx: CanvasRenderingContext2D, L: Layout): void {
    const windup = this.phase === 'windup' ? clamp(this.phaseElapsed / WINDUP_MS, 0, 1) : 1;
    const follow = this.phase === 'windup' ? 0 : clamp(this.sinceRelease / 520, 0, 1);
    const a = pitcherAnchor(L.scene);
    // A small idle breath before the delivery starts.
    const breath = windup <= 0 ? Math.sin(this.clock * 2.4) * a.h * 0.006 : 0;
    drawPitcher(ctx, a.x, a.y + breath, a.h, this.opts.pitcherKit, { windup, follow });
  }

  /**
   * The strike zone: a pane of glass with a nine-box grid and corner
   * brackets. Vision keeps it visible; low vision fades it. It brightens the
   * moment the ball is live.
   */
  private drawZone(ctx: CanvasRenderingContext2D, L: Layout): void {
    const live = this.phase === 'flight' ? 1.5 : 1;
    const visibility = Math.min(
      0.92,
      clamp(0.22 + this.opts.player.attributes.vision / 220, 0.22, 0.66) * live,
    );
    const x0 = L.cx - L.zoneHW;
    const y0 = L.zoneY - L.zoneHH;
    const zw = L.zoneHW * 2;
    const zh = L.zoneHH * 2;

    ctx.save();
    ctx.fillStyle = `rgba(255,255,255,${this.phase === 'flight' ? 0.1 : 0.06})`;
    ctx.fillRect(x0, y0, zw, zh);
    // A soft dark edge, so the pane reads over bright grass as well as clay.
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 4;
    ctx.strokeRect(x0, y0, zw, zh);

    ctx.strokeStyle = `rgba(255,255,255,${visibility})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(x0, y0, zw, zh);

    ctx.setLineDash([]);
    ctx.strokeStyle = `rgba(255,255,255,${visibility * 0.4})`;
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const x = x0 + (zw * i) / 3;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + zh);
      ctx.stroke();
      const y = y0 + (zh * i) / 3;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + zw, y);
      ctx.stroke();
    }

    const arm = Math.min(zw, zh) * 0.22;
    ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, visibility * 1.5)})`;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    for (const [cx2, cy2, sx, sy] of [
      [x0, y0, 1, 1],
      [x0 + zw, y0, -1, 1],
      [x0, y0 + zh, 1, -1],
      [x0 + zw, y0 + zh, -1, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(cx2 + sx * arm, cy2);
      ctx.lineTo(cx2, cy2);
      ctx.lineTo(cx2, cy2 + sy * arm);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Screen side of the plate the batter occupies: -1 left, +1 right. A
   * right-handed hitter stands to the catcher's left. */
  private batterSide(): -1 | 1 {
    return this.opts.player.bats === 'L' ? 1 : -1;
  }

  /**
   * The count beside the zone, plus one dot per pitch already thrown this
   * at-bat, coloured by what it was with the radar reading alongside. Drawn
   * on the opposite side from the batter.
   */
  private drawCountHud(ctx: CanvasRenderingContext2D, L: Layout): void {
    const side = -this.batterSide();
    const pad = L.W * 0.03;
    const x0 = side > 0 ? L.cx + L.zoneHW + pad : L.cx - L.zoneHW - pad;
    const align: -1 | 1 = side > 0 ? 1 : -1;
    const pipR = Math.max(3, L.W * 0.012);
    const step = pipR * 2 + 4;

    ctx.save();
    ctx.font = `bold ${Math.max(10, L.W * 0.032)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = align > 0 ? 'left' : 'right';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;

    const rows: Array<[string, number, number, string]> = [
      ['B', this.count.balls, 3, '#35c26a'],
      ['S', this.count.strikes, 2, '#ff6b6b'],
    ];
    let y = L.zoneY - L.zoneHH + pipR + 2;
    const letterW = Math.max(10, L.W * 0.032);
    for (const [letter, have, total, colour] of rows) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(letter, x0, y + 0.5);
      for (let i = 0; i < total; i++) {
        const px = x0 + align * (letterW + i * step + pipR);
        ctx.beginPath();
        ctx.arc(px, y, pipR, 0, Math.PI * 2);
        if (i < have) {
          ctx.fillStyle = colour;
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.45)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
      y += step + 3;
    }

    const shown = this.history.slice(-6);
    y += 4;
    ctx.font = `bold ${Math.max(9, L.W * 0.026)}px system-ui, sans-serif`;
    for (const p of shown) {
      ctx.fillStyle = PITCH_DOT_COLOURS[p.type];
      ctx.beginPath();
      ctx.arc(x0 + align * pipR, y, pipR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(String(p.mph), x0 + align * (pipR * 2 + 5), y + 0.5);
      y += step + 1;
    }
    ctx.restore();
  }

  /**
   * The batter — you — in the box. An easy stance, a coil as the pitcher
   * strides, and the bat whipping through when the tap lands. A taken pitch
   * just relaxes back into the stance.
   */
  private drawBatter(ctx: CanvasRenderingContext2D, L: Layout): void {
    const side = this.batterSide();
    const a = batterAnchor(L.scene, side);

    let load: number;
    let swing = 0;
    if (this.phase === 'freeze') {
      if (this.tapPoint) {
        load = 1;
        swing = clamp(this.phaseElapsed / 210, 0, 1);
      } else {
        load = 0;
      }
    } else if (this.phase === 'flight') {
      load = 1;
    } else {
      load = clamp((this.phaseElapsed / WINDUP_MS - 0.3) / 0.55, 0, 1);
    }

    drawBatter(
      ctx,
      a.x,
      a.y,
      a.h,
      this.opts.batterKit,
      { load, swing, sway: this.clock * 2.6 },
      side < 0 ? 1 : -1,
    );
  }

  private drawBall(ctx: CanvasRenderingContext2D, ball: BallState): void {
    const prev = this.trail.length > 1 ? this.trail[this.trail.length - 2] : ball;
    drawBaseball(ctx, ball.x, ball.y, ball.r, {
      rot: ball.rot,
      vx: ball.x - prev.x,
      vy: ball.y - prev.y,
    });
  }

  /** 0 outside the prime tap window, 1 through its heart, eased at both edges. */
  private primePresence(t: number): number {
    return Math.min(
      clamp((t - PRIME_START) / 0.05, 0, 1),
      clamp((PRIME_END - t) / 0.07, 0, 1),
    );
  }

  /**
   * Gold halo behind the ball while it's over the plate — the "swing now"
   * signal. Strikes only, and only with the batting eye (see
   * `hasBattingEye`): until Vision is there, the zone is yours to judge.
   */
  private drawPrimeGlow(ctx: CanvasRenderingContext2D, ball: BallState, t: number): void {
    if (!this.battingEye || !this.pitch.isStrike) return;
    const p = this.primePresence(t);
    if (p <= 0) return;
    const pulse = 1 + Math.sin(this.phaseElapsed / 46) * 0.05;
    const R = ball.r * 1.9 * pulse;
    const glow = ctx.createRadialGradient(ball.x, ball.y, ball.r * 0.55, ball.x, ball.y, R);
    glow.addColorStop(0, alpha(CUE_GOLD, 0.5 * p));
    glow.addColorStop(1, alpha(CUE_GOLD, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, R, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Timing ring: converges on the ball through the flight and, on a strike,
   * locks onto its rim, gold, exactly while the ball is over the plate —
   * "tap when the ring meets the ball". On a ball the ring never locks: it
   * washes out just before the plate. Without the batting eye the ring still
   * converges and locks — white, on every pitch — so the timing is there to
   * learn, but it says nothing about whether the pitch is worth swinging at.
   */
  private drawTimingRing(ctx: CanvasRenderingContext2D, ball: BallState, t: number, L: Layout): void {
    if (t >= PRIME_END) return;
    const fadeIn = clamp((t - 0.3) / 0.18, 0, 1);
    if (fadeIn <= 0) return;

    const conv = clamp(t / PRIME_AT, 0, 1);
    const gap = Math.pow(1 - conv, 1.35) * L.W * 0.34;
    const r = ball.r * 1.16 + gap;
    const reads = this.battingEye ? this.pitch.isStrike : true;
    const locked = reads ? this.primePresence(t) : 0;
    const wash = reads ? 1 : 1 - clamp((t - PRIME_START) / 0.07, 0, 1);
    if (wash <= 0) return;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 3;
    if (locked > 0 && this.battingEye) {
      ctx.strokeStyle = alpha(CUE_GOLD, 0.5 + locked * 0.45);
      ctx.lineWidth = Math.max(2, ball.r * 0.09);
    } else if (locked > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${0.45 + locked * 0.4})`;
      ctx.lineWidth = Math.max(2, ball.r * 0.09);
    } else {
      ctx.strokeStyle = `rgba(255,255,255,${0.38 * fadeIn * wash})`;
      ctx.lineWidth = Math.max(1.5, ball.r * 0.07);
    }
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // Four ticks, so the ring reads as a sight rather than a halo.
    if (locked <= 0) {
      const tick = Math.max(3, ball.r * 0.16);
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const ang = k * (Math.PI / 2) + Math.PI / 4;
        ctx.moveTo(ball.x + Math.cos(ang) * (r - tick), ball.y + Math.sin(ang) * (r - tick));
        ctx.lineTo(ball.x + Math.cos(ang) * (r + tick), ball.y + Math.sin(ang) * (r + tick));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * The perfect hit zone, unlocked at 120 combined Contact and Vision. Marks
   * the sweet spot on the ball as it comes in. Purely an aid.
   */
  private drawPerfectZone(ctx: CanvasRenderingContext2D, ball: BallState, L: Layout): void {
    if (!this.perfectZoneUnlocked) return;
    if (ball.r < L.maxR * 0.42) return;

    const centerY = ball.y + IDEAL_UNDER * ball.r;
    const radius = sweetSpotRadius(this.opts.player.attributes.contact, this.opts.player.stamina) * ball.r;
    const presence = clamp((ball.r / L.maxR - 0.42) / 0.4, 0, 1);

    ctx.save();
    ctx.globalAlpha = 0.55 + presence * 0.35;
    ctx.strokeStyle = CUE_GREEN;
    ctx.lineWidth = Math.max(1.5, ball.r * 0.07);
    ctx.beginPath();
    ctx.arc(ball.x, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
    const tick = radius * 0.42;
    ctx.lineWidth = Math.max(1, ball.r * 0.05);
    ctx.beginPath();
    ctx.moveTo(ball.x - tick, centerY);
    ctx.lineTo(ball.x + tick, centerY);
    ctx.moveTo(ball.x, centerY - tick);
    ctx.lineTo(ball.x, centerY + tick);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Post-swing teaching frame: shows where the tap landed on the ball. The
   * green sweet-spot ring is part of the perfect-zone aid — until that's
   * unlocked you only see your own mark.
   */
  private drawFreeze(ctx: CanvasRenderingContext2D): void {
    const ball = this.frozenBall;
    if (!ball) return;

    drawBaseball(ctx, ball.x, ball.y, ball.r, { rot: ball.rot });

    if (this.perfectZoneUnlocked) {
      const sweet = sweetSpotRadius(this.opts.player.attributes.contact, this.opts.player.stamina);
      const idealY = ball.y + IDEAL_UNDER * ball.r;
      ctx.save();
      ctx.strokeStyle = alpha(CUE_GREEN, 0.85);
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(ball.x, idealY, sweet * ball.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (this.tapPoint) {
      drawTapMark(ctx, this.tapPoint.x, this.tapPoint.y, Math.max(8, ball.r * 0.32));
    }
  }
}
