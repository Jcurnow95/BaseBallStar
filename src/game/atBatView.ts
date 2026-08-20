import type { AtBatOutcome, Pitch, PitchType, PlayerProfile } from '../core/types';
import type { Count, PitcherAI } from '../core/pitching';
import { readPitch, throwPitch } from '../core/pitching';
import type { BattedBall } from '../core/types';
import { IDEAL_UNDER, resolveSwing, sweetSpotRadius } from '../core/swing';
import { foulChanceFor } from '../core/outcome';
import { hasPerfectZone } from '../core/progression';
import { launchBall, predictLanding } from '../core/ballFlight';
import { drawBaseball } from './baseball';
import { isFair } from '../core/fieldGeometry';
import type { Uniform } from '../core/uniforms';
import { Rng, clamp, lerp } from '../core/rng';
import type { LeagueLevel } from '../core/league';
import { createSurface, pointerPos, vibrate } from '../ui/canvas';
import type { Surface } from '../ui/canvas';
import { playSound } from '../ui/audio';
import type { AirConditions, Weather } from '../core/weather';
import { CALM, airFor } from '../core/weather';
import { drawGloom, drawRain, drawRainSplashes, drawWindFlag } from './weatherFx';

/**
 * The at-bat minigame.
 *
 * Catcher POV. The ball leaves the pitcher's hand small and far, grows as it
 * comes, and breaks late toward its real location. Tap it. Where inside the
 * ball you land decides the whole result — see `core/swing.ts`.
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
  onCount(count: Count): void;
  /** A fair ball was put in play — the play itself resolves on the field. */
  onBallInPlay(battedBall: BattedBall): void;
  /** Strikeout or walk; nothing for the defense to do. */
  onComplete(outcome: AtBatOutcome): void;
}

type Phase = 'windup' | 'flight' | 'freeze';

const WINDUP_MS = 900;
const FREEZE_MS = 1250;
/**
 * Width / height of the play area. Matches the canvas shape on a portrait
 * phone, and letterboxes rather than distorts on anything wider.
 */
const STAGE_ASPECT = 0.6;
/**
 * The mound's crest as a fraction of stage height. Below the horizon (0.36) so
 * it sits on the grass, and above the strike zone's top edge (0.475) with room
 * for the hump's ground shadow.
 */
const MOUND_Y = 0.415;
/**
 * Pitcher figure scale, as fractions of stage height and width. Shared by the
 * drawing and by `layout()`, which derives the release point from the same
 * shoulder the arm whips over. Sized so the pitcher looms — the camera is
 * meant to feel tight, not like watching from the upper deck.
 */
const PITCHER_H = 0.088;
const PITCHER_W = 0.058;
/** Flight continues past the plate so late swings still have something to hit. */
const OVERRUN = 1.22;

/**
 * Crowd pixels. Muted and slightly varied — a stand of identical dots reads as
 * a texture, and a stand of bright ones pulls the eye off the ball.
 */
export const CROWD_COLOURS = [
  '#8d9bb8', '#6f7d99', '#a8b3c9', '#5d6a85', '#9aa7c0',
  '#b0796a', '#7a8bb0', '#c2b090', '#6b7f96', '#94a0ba',
];

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
   * This used to be read off the wall clock. The frame loop stops whenever the
   * app is minimised or backgrounded, but the wall clock doesn't, so coming
   * back to the game found the pitch long past the plate and rang up a called
   * strike the player never saw — and left the pitcher frozen mid-delivery
   * until something woke the loop up. Advancing the clock only by frames means
   * time simply doesn't pass while you're away.
   */
  private phaseElapsed = 0;
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
  private readonly weather: Weather;
  private readonly air: AirConditions;
  /** Seconds the weather has been animating; only advances while unpaused. */
  private weatherClock = 0;

  constructor(root: HTMLElement, opts: AtBatOptions) {
    this.root = root;
    this.opts = opts;
    this.root.classList.add('atbat');
    this.root.innerHTML = '';
    this.perfectZoneUnlocked = hasPerfectZone(opts.player.attributes);
    this.weather = opts.weather ?? CALM;
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
    this.pitch = throwPitch(this.opts.pitcher, this.count, this.opts.rng);
    this.pitchLabel = readPitch(this.pitch, this.opts.player.attributes.vision, this.opts.rng);
    this.swung = false;
    this.tapPoint = null;
    this.frozenBall = null;
    this.trail = [];
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
      // Before the pitch is even thrown. This used to be scored as a swing
      // and a miss, which mostly punished people prodding the screen to see
      // if the game was still alive — a real early swing (the first frame of
      // the flight) already whiffs on its own. Just say so.
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
   * centred.
   *
   * Everything here is in *stage* coordinates, with `ox`/`oy` giving the
   * stage's offset within the canvas. Deriving horizontal features from canvas
   * width and vertical ones from canvas height independently — which is what
   * this used to do — stretches the field, the strike zone and the ball on any
   * screen that isn't phone-shaped.
   */
  private layout() {
    const canvasW = this.surface.width;
    const canvasH = this.surface.height;

    let W = canvasW;
    let H = W / STAGE_ASPECT;
    if (H > canvasH) {
      H = canvasH;
      W = H * STAGE_ASPECT;
    }

    return {
      ox: (canvasW - W) / 2,
      oy: (canvasH - H) / 2,
      canvasW,
      canvasH,
      W,
      H,
      cx: W / 2,
      horizon: H * 0.36,
      // The zone fills the bottom third: big, and close to where a thumb
      // already rests. Its top edge runs nearly to the mound's skirt, so the
      // stretch of empty grass the old camera showed is gone.
      zoneY: H * 0.6,
      zoneHW: W * 0.24,
      zoneHH: H * 0.125,
      // Where the pitcher stands: the crest of the mound, on the grass below
      // the horizon so the figure reads as planted on the field rather than
      // hovering in front of the outfield wall.
      mound: { x: W / 2, y: H * MOUND_Y },
      // Where the ball leaves the throwing hand — up by the shoulder, on the
      // arm side — so the pitch comes out of the release rather than the feet.
      release: {
        x: W / 2 - W * PITCHER_W * 0.2 - H * PITCHER_H * 0.57,
        y: H * MOUND_Y - H * PITCHER_H * 1.06,
      },
      minR: Math.max(3, W * 0.015),
      // Sized for a fingertip, not for realism. Tap offsets are measured in ball
      // radii (see `core/swing.ts`), so a bigger ball is a bigger target in
      // pixels at exactly the same difficulty. The floor keeps it thumb-sized on
      // a short or narrow stage, where a purely proportional ball goes tiny.
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
    // swing window rather than only at the instant it reaches the plate. The
    // flight itself is unchanged — this is size, not speed.
    //
    // Flattened again for the read rather than the swing: at 2 the ball was
    // still under 30px across for the first 40% of the flight, which is the
    // window the pitch has to be identified in (the readout appears at 0.22).
    // The size at the plate is set by `maxR` and is untouched by this.
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
      this.weatherClock += step / 1000;
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

    // Work in stage space, so every layout number below stays stage-relative.
    // The backdrop bleeds past the stage to cover the whole canvas, so a wider
    // screen shows more sky and grass rather than black bars.
    ctx.save();
    ctx.translate(L.ox, L.oy);

    this.drawField(ctx, L);
    this.drawPitcher(ctx, L);
    this.drawZone(ctx, L);
    this.drawCountHud(ctx, L);
    this.drawPlate(ctx, L);
    this.drawBatter(ctx, L);

    if (this.phase === 'flight') {
      const t = this.flightProgress();
      const ball = this.ballAt(t);
      this.trail.push(ball);
      if (this.trail.length > 9) this.trail.shift();
      this.drawTrail(ctx);
      this.drawBall(ctx, ball);
      this.drawPerfectZone(ctx, ball);
    } else if (this.phase === 'freeze') {
      this.drawFreeze(ctx);
    }

    ctx.restore();

    // Weather sits over the whole canvas, not just the stage.
    drawGloom(ctx, L.canvasW, L.canvasH, this.weather);
    drawRain(ctx, L.canvasW, L.canvasH, this.weather, this.weatherClock);
    // Splashes only where the rain actually lands: the dirt at the bottom.
    drawRainSplashes(
      ctx,
      L.canvasW,
      L.canvasH,
      this.weather,
      this.weatherClock,
      L.oy + L.H * 0.58,
    );
    // Under the pause button, clear of the readout across the top.
    drawWindFlag(ctx, 10, 52, this.weather);
  }

  private drawField(ctx: CanvasRenderingContext2D, L: ReturnType<AtBatView['layout']>): void {
    // Canvas edges expressed in stage coordinates. The horizon and the dirt
    // apex stay anchored to the stage; only the fills reach past it.
    const left = -L.ox;
    const top = -L.oy;
    const right = L.canvasW - L.ox;
    const bottom = L.canvasH - L.oy;
    const fullW = L.canvasW;

    // Clear nights are deep blue; cloud flattens the sky to slate.
    const sky = ctx.createLinearGradient(0, top, 0, L.horizon);
    if (this.weather.sky === 'clear') {
      sky.addColorStop(0, '#0a1024');
      sky.addColorStop(1, '#1d2c4d');
    } else if (this.weather.sky === 'overcast') {
      sky.addColorStop(0, '#12161f');
      sky.addColorStop(1, '#2b3341');
    } else if (this.weather.sky === 'storm') {
      // Near-black, so a storm night reads as a storm before the first drop
      // registers.
      sky.addColorStop(0, '#06080d');
      sky.addColorStop(1, '#1a202c');
    } else {
      sky.addColorStop(0, '#0d1017');
      sky.addColorStop(1, '#232a36');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(left, top, fullW, L.horizon - top);

    this.drawCrowd(ctx, left, fullW, L);

    // Outfield wall.
    ctx.fillStyle = '#0f3d2e';
    ctx.fillRect(left, L.horizon - 8, fullW, 10);

    // Grass.
    const grass = ctx.createLinearGradient(0, L.horizon, 0, bottom);
    grass.addColorStop(0, '#1f6b3f');
    grass.addColorStop(1, '#2c8a52');
    ctx.fillStyle = grass;
    ctx.fillRect(left, L.horizon, fullW, bottom - L.horizon);

    // Mowing stripes.
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    const stripe = fullW / 8;
    for (let i = 0; i < 8; i += 2) {
      ctx.fillRect(left + i * stripe, L.horizon, stripe, bottom - L.horizon);
    }

    // Infield dirt sweeping up to the batter's box.
    ctx.fillStyle = '#8a5a35';
    ctx.beginPath();
    ctx.moveTo(left - fullW * 0.2, bottom);
    ctx.quadraticCurveTo(L.cx, L.H * 0.5, right + fullW * 0.2, bottom);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * The stand behind the outfield wall, and however many people turned up.
   *
   * The seat grid is drawn first and the crowd is scattered over it, so a
   * Single-A game reads as rows of empty plastic with a few hundred people in
   * it and the Majors reads as a wall of colour. Positions come from an index
   * hash rather than rng, so nobody teleports between frames.
   */
  private drawCrowd(
    ctx: CanvasRenderingContext2D,
    left: number,
    fullW: number,
    L: ReturnType<AtBatView['layout']>,
  ): void {
    const top = L.horizon * 0.5;
    const height = L.horizon * 0.5;

    // Concrete, then seat rows.
    ctx.fillStyle = '#141c30';
    ctx.fillRect(left, top, fullW, height);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    const rows = 7;
    for (let r = 0; r < rows; r++) {
      ctx.fillRect(left, top + (height / rows) * r, fullW, 1);
    }

    const fill = clamp(this.opts.level.crowd, 0, 1);
    const seats = Math.round((fullW / 5) * rows);
    const taken = Math.round(seats * fill);
    const size = Math.max(2, L.W * 0.008);

    for (let i = 0; i < taken; i++) {
      // Deterministic scatter: spread seats across the whole stand rather than
      // filling it left to right, so a half-full park looks patchy not sliced.
      const h = (i * 2654435761) >>> 0;
      const row = h % rows;
      const col = (h >>> 8) % Math.ceil(fullW / 5);
      const x = left + col * 5 + ((h >>> 3) % 3);
      const y = top + (height / rows) * row + 2 + ((h >>> 5) % 2);
      ctx.fillStyle = CROWD_COLOURS[h % CROWD_COLOURS.length];
      ctx.fillRect(x, y, size, size);
    }
  }

  /**
   * The pitcher, drawn as a figure with legs and a real delivery: gather, leg
   * kick, stride, then the throwing arm comes over the top and releases as the
   * ball leaves. The glove hand stays in front so the throwing arm never reads
   * as a bat.
   */
  private drawPitcher(ctx: CanvasRenderingContext2D, L: ReturnType<AtBatView['layout']>): void {
    const windup = this.phase === 'windup' ? clamp(this.phaseElapsed / WINDUP_MS, 0, 1) : 1;
    const afterRelease = this.phase !== 'windup';
    // How far through the follow-through we are, once the ball is gone.
    const follow = afterRelease ? clamp(this.phaseElapsed / 420, 0, 1) : 0;

    const kit = this.opts.pitcherKit;
    const bodyH = L.H * PITCHER_H;
    const bodyW = L.W * PITCHER_W;
    const legLen = bodyH * 0.62;
    const armLen = bodyH * 0.58;
    // Where the planted back foot meets the dirt: the crest of the mound. The
    // feet stay here through the delivery; the crouch drops the body onto them.
    const footY = -bodyH * 0.42 + legLen;

    // Gather (0-0.35), stride (0.35-0.78), whip through release (0.78-1).
    const gather = clamp(windup / 0.35, 0, 1);
    const stride = clamp((windup - 0.35) / 0.43, 0, 1);
    const whip = clamp((windup - 0.78) / 0.22, 0, 1);

    const lift = Math.sin(gather * Math.PI) * (1 - stride);
    const crouch = Math.sin(windup * Math.PI) * bodyH * 0.1;
    const shoulderY = -bodyH + crouch;
    const hipY = -bodyH * 0.42 + crouch;

    // ---- Mound: a raised hump of dirt sitting on the grass, with the pitcher's
    // feet on its crest. Drawn in mound space (not shifted by the crouch) so the
    // ground stays put while the figure bobs through the delivery.
    ctx.save();
    ctx.translate(L.mound.x, L.mound.y);
    {
      const rx = L.W * 0.175;
      const hump = L.H * 0.034;
      const baseY = footY + hump * 0.75;

      // Ground shadow the hump throws onto the grass, low and toward us.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(0, baseY + hump * 0.35, rx * 1.02, hump * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();

      // Flat dirt circle the hump rises out of.
      ctx.fillStyle = '#7d4f2c';
      ctx.beginPath();
      ctx.ellipse(0, baseY, rx, hump * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();

      // The hump itself: lit from above, darkening toward the near edge.
      const dome = ctx.createLinearGradient(0, footY - hump * 0.3, 0, baseY);
      dome.addColorStop(0, '#b47a48');
      dome.addColorStop(0.55, '#96633a');
      dome.addColorStop(1, '#7d4f2c');
      ctx.fillStyle = dome;
      ctx.beginPath();
      ctx.moveTo(-rx * 0.82, baseY);
      ctx.quadraticCurveTo(-rx * 0.5, footY - hump * 0.3, 0, footY - hump * 0.3);
      ctx.quadraticCurveTo(rx * 0.5, footY - hump * 0.3, rx * 0.82, baseY);
      ctx.closePath();
      ctx.fill();

      // Front lip of the hump, so it reads as rounded rather than a flat wedge.
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      ctx.ellipse(0, baseY - hump * 0.05, rx * 0.82, hump * 0.42, 0, 0, Math.PI);
      ctx.fill();

      // Pitching rubber on the crest, just behind the feet.
      ctx.fillStyle = '#e9e6dd';
      ctx.fillRect(-bodyW * 0.75, footY - hump * 0.18, bodyW * 1.5, Math.max(1.5, hump * 0.14));

      // The pitcher's own shadow, pooled at the feet on the crest.
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(bodyW * 0.1, footY + hump * 0.08, bodyW * 1.05, hump * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(L.mound.x, L.mound.y);
    ctx.lineCap = 'round';

    // ---- Legs. Back leg plants, front leg lifts then strides toward us.
    ctx.strokeStyle = kit.pants;
    ctx.lineWidth = Math.max(2.5, bodyW * 0.34);

    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(-bodyW * 0.5, footY);
    ctx.stroke();

    const frontKneeX = bodyW * (0.25 + stride * 0.75);
    const frontFootY = footY - legLen * lift * 0.55 + follow * legLen * 0.12;
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(frontKneeX, frontFootY);
    ctx.stroke();

    // ---- Torso, curved to match the round-capped limbs.
    ctx.fillStyle = kit.shirt;
    ctx.beginPath();
    ctx.moveTo(-bodyW * 0.46, shoulderY + bodyH * 0.03);
    ctx.quadraticCurveTo(0, shoulderY - bodyH * 0.09, bodyW * 0.46, shoulderY + bodyH * 0.03);
    ctx.quadraticCurveTo(bodyW * 0.3, (shoulderY + hipY) / 2, bodyW * 0.32, hipY);
    ctx.quadraticCurveTo(0, hipY + bodyH * 0.07, -bodyW * 0.32, hipY);
    ctx.quadraticCurveTo(-bodyW * 0.3, (shoulderY + hipY) / 2, -bodyW * 0.46, shoulderY + bodyH * 0.03);
    ctx.closePath();
    ctx.fill();

    // ---- Glove arm, out front through the whole delivery.
    ctx.strokeStyle = kit.shirt;
    ctx.lineWidth = Math.max(2, bodyW * 0.26);
    const gloveX = bodyW * (0.5 + stride * 0.5) - follow * bodyW * 0.7;
    const gloveY = shoulderY + bodyH * 0.16 + follow * bodyH * 0.2;
    ctx.beginPath();
    ctx.moveTo(bodyW * 0.2, shoulderY + bodyH * 0.06);
    ctx.lineTo(gloveX, gloveY);
    ctx.stroke();
    ctx.fillStyle = '#6b4a2a';
    ctx.beginPath();
    ctx.arc(gloveX, gloveY, bodyW * 0.26, 0, Math.PI * 2);
    ctx.fill();

    // ---- Throwing arm: back and up during the stride, over the top to release,
    // then across the body on the follow-through.
    let armAngle: number;
    if (!afterRelease) {
      const back = lerp(-1.05, -2.5, stride); // down at the side -> up behind the head
      armAngle = lerp(back, -0.15, whip); // whip over the top to release
    } else {
      armAngle = lerp(-0.15, 0.95, follow); // across the body
    }

    ctx.strokeStyle = kit.shirt;
    ctx.lineWidth = Math.max(2, bodyW * 0.24);
    const handX = -bodyW * 0.2 + Math.cos(armAngle) * -armLen;
    const handY = shoulderY + bodyH * 0.04 + Math.sin(armAngle) * armLen * 0.85;
    ctx.beginPath();
    ctx.moveTo(-bodyW * 0.2, shoulderY + bodyH * 0.06);
    ctx.lineTo(handX, handY);
    ctx.stroke();

    // Ball in hand right up until release.
    if (!afterRelease && whip < 0.85) {
      ctx.fillStyle = '#fdfdfb';
      ctx.beginPath();
      ctx.arc(handX, handY, Math.max(1.5, bodyW * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- Head and cap.
    const headR = bodyW * 0.34;
    const headY = shoulderY - headR * 0.9;
    ctx.fillStyle = '#c98d63';
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = kit.cap;
    ctx.beginPath();
    ctx.arc(0, headY, headR, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-headR, headY - headR * 0.16, headR * 2, headR * 0.3);

    ctx.restore();
  }

  private drawZone(ctx: CanvasRenderingContext2D, L: ReturnType<AtBatView['layout']>): void {
    // Vision keeps the strike-zone guide visible; low vision fades it out.
    // The whole guide brightens the moment the ball is live, when it's needed.
    const live = this.phase === 'flight' ? 1.5 : 1;
    const visibility = Math.min(
      0.9,
      clamp(0.22 + this.opts.player.attributes.vision / 220, 0.22, 0.66) * live,
    );
    const x0 = L.cx - L.zoneHW;
    const y0 = L.zoneY - L.zoneHH;
    const zw = L.zoneHW * 2;
    const zh = L.zoneHH * 2;

    ctx.save();
    // A faint pane of glass, so the zone reads against dark grass instead of
    // being four hairlines lost in it.
    ctx.fillStyle = `rgba(255,255,255,${this.phase === 'flight' ? 0.08 : 0.055})`;
    ctx.fillRect(x0, y0, zw, zh);

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

    // Solid corner brackets, heavier than the dashed frame, so the zone keeps
    // its shape even where the dashes happen to fall on the gaps.
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
   * The count, living where the eyes already are — beside the zone — plus one
   * dot per pitch already thrown this at-bat, coloured by what it was with the
   * radar reading alongside. Drawn on the opposite side from the batter.
   */
  private drawCountHud(ctx: CanvasRenderingContext2D, L: ReturnType<AtBatView['layout']>): void {
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

    // B / S pip rows, same colours as the header so the language is one.
    const rows: Array<[string, number, number, string]> = [
      ['B', this.count.balls, 3, '#35c26a'],
      ['S', this.count.strikes, 2, '#ff6b6b'],
    ];
    let y = L.zoneY - L.zoneHH + pipR + 2;
    const letterW = Math.max(10, L.W * 0.032);
    for (const [letter, have, total, colour] of rows) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(letter, x0, y + 0.5);
      for (let i = 0; i < total; i++) {
        const px = x0 + align * (letterW + i * step + pipR);
        ctx.beginPath();
        ctx.arc(px, y, pipR, 0, Math.PI * 2);
        if (i < have) {
          ctx.fillStyle = colour;
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      y += step + 3;
    }

    // Pitch history, newest at the bottom, capped so a foul-ball marathon
    // doesn't crawl down into the plate.
    const shown = this.history.slice(-6);
    y += 4;
    ctx.font = `bold ${Math.max(9, L.W * 0.026)}px system-ui, sans-serif`;
    for (const p of shown) {
      ctx.fillStyle = PITCH_DOT_COLOURS[p.type];
      ctx.beginPath();
      ctx.arc(x0 + align * pipR, y, pipR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(String(p.mph), x0 + align * (pipR * 2 + 5), y + 0.5);
      y += step + 1;
    }
    ctx.restore();
  }

  /**
   * The batter — you — in the box beside the plate, drawn with the same
   * round-capped limbs as the pitcher so the two read as the same game. Three
   * real poses sell the moment: an easy stance, a coil as the pitcher strides,
   * and the bat whipping through when the tap lands.
   */
  private drawBatter(ctx: CanvasRenderingContext2D, L: ReturnType<AtBatView['layout']>): void {
    const side = this.batterSide();
    const h = L.H * 0.2;
    const x = L.cx + side * L.W * 0.36;
    const y = L.H * 0.905;
    const kit = this.opts.batterKit;

    // Pose: 0 = relaxed stance, 1 = fully loaded. The coil tracks the
    // pitcher's stride; the swing only plays when a tap actually landed —
    // a taken pitch just relaxes back into the stance.
    let load: number;
    let swingP = 0;
    if (this.phase === 'freeze') {
      if (this.tapPoint) {
        load = 1;
        swingP = clamp(this.phaseElapsed / 170, 0, 1);
      } else {
        load = 0;
      }
    } else if (this.phase === 'flight') {
      load = 1;
    } else {
      load = clamp((this.phaseElapsed / WINDUP_MS - 0.3) / 0.55, 0, 1);
    }
    const bob = Math.sin(this.weatherClock * 2.6) * (1 - load) * h * 0.012;
    // Ease the barrel through the hitting zone rather than sweeping linearly.
    const swing = 1 - (1 - swingP) * (1 - swingP);

    ctx.save();
    ctx.translate(x, y);
    // Local +x points at the plate, whichever box the batter is in.
    ctx.scale(-side, 1);
    ctx.lineCap = 'round';

    // Ground shadow first, so the figure is planted rather than pasted on.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(h * 0.02, h * 0.012, h * 0.32, h * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();

    // Weight drifts back as the batter loads, then drives forward with the bat.
    const shift = -load * (1 - swing) * h * 0.06 + swing * h * 0.1;
    const hipX = shift;
    const hipY = -h * 0.42 + bob;
    const shX = shift * 1.35;
    const shY = -h * 0.68 + bob + load * (1 - swing) * h * 0.015;

    // ---- Legs. Front foot lifts a touch in the load, plants for the swing.
    ctx.strokeStyle = kit.pants;
    ctx.lineWidth = Math.max(3, h * 0.115);
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(-h * 0.17, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(h * 0.17, -load * (1 - swing) * h * 0.05);
    ctx.stroke();

    // ---- Torso, curved like the pitcher's.
    const shHalf = h * 0.165;
    const hipHalf = h * 0.125;
    ctx.fillStyle = kit.shirt;
    ctx.beginPath();
    ctx.moveTo(shX - shHalf, shY + h * 0.015);
    ctx.quadraticCurveTo(shX, shY - h * 0.04, shX + shHalf, shY + h * 0.015);
    ctx.quadraticCurveTo(shX + shHalf * 0.75, (shY + hipY) / 2, hipX + hipHalf, hipY);
    ctx.quadraticCurveTo(hipX, hipY + h * 0.03, hipX - hipHalf, hipY);
    ctx.quadraticCurveTo(shX - shHalf * 0.75, (shY + hipY) / 2, shX - shHalf, shY + h * 0.015);
    ctx.closePath();
    ctx.fill();

    // ---- Hands and bat. Up by the back shoulder in the stance, wrapped
    // deeper in the load, then whipped level through the zone.
    const loadBack = load * (1 - swing);
    const handX = shX - h * (0.09 + loadBack * 0.06) + swing * h * 0.24;
    const handY = shY + h * (0.06 - loadBack * 0.03) + swing * h * 0.14;
    const batAngle = lerp(-1.9 - load * 0.45, 0.9, swing);
    const batLen = h * 0.48;
    const tipX = handX + Math.cos(batAngle) * batLen;
    const tipY = handY + Math.sin(batAngle) * batLen;

    // Arms from both shoulders to the hands.
    ctx.strokeStyle = kit.shirt;
    ctx.lineWidth = Math.max(2.5, h * 0.075);
    ctx.beginPath();
    ctx.moveTo(shX - h * 0.07, shY + h * 0.05);
    ctx.lineTo(handX, handY);
    ctx.moveTo(shX + h * 0.07, shY + h * 0.03);
    ctx.lineTo(handX, handY);
    ctx.stroke();

    // Bat: darker handle, brighter barrel, so the taper reads at a glance.
    ctx.strokeStyle = '#8a6a45';
    ctx.lineWidth = Math.max(2, h * 0.04);
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(lerp(handX, tipX, 0.35), lerp(handY, tipY, 0.35));
    ctx.stroke();
    ctx.strokeStyle = '#d9a468';
    ctx.lineWidth = Math.max(3, h * 0.06);
    ctx.beginPath();
    ctx.moveTo(lerp(handX, tipX, 0.3), lerp(handY, tipY, 0.3));
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Batting gloves on the hands.
    ctx.fillStyle = kit.cap;
    ctx.beginPath();
    ctx.arc(handX, handY, h * 0.045, 0, Math.PI * 2);
    ctx.fill();

    // ---- Head and helmet, eyes on the pitcher.
    const headR = h * 0.095;
    const headX = shX + h * 0.02;
    const headY = shY - headR * 1.15;
    ctx.fillStyle = '#c98d63';
    ctx.beginPath();
    ctx.arc(headX, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = kit.cap;
    ctx.beginPath();
    ctx.arc(headX, headY, headR * 1.06, Math.PI * 0.95, Math.PI * 2.1);
    ctx.fill();
    // Ear flap on the pitcher side.
    ctx.beginPath();
    ctx.ellipse(headX + headR * 0.55, headY + headR * 0.25, headR * 0.42, headR * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawPlate(ctx: CanvasRenderingContext2D, L: ReturnType<AtBatView['layout']>): void {
    const py = L.H * 0.86;
    const hw = L.W * 0.13;
    ctx.fillStyle = '#f2f4f8';
    ctx.beginPath();
    ctx.moveTo(L.cx - hw, py);
    ctx.lineTo(L.cx + hw, py);
    ctx.lineTo(L.cx + hw * 0.8, py + L.H * 0.022);
    ctx.lineTo(L.cx, py + L.H * 0.04);
    ctx.lineTo(L.cx - hw * 0.8, py + L.H * 0.022);
    ctx.closePath();
    ctx.fill();
  }

  private drawTrail(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.trail.length; i++) {
      const b = this.trail[i];
      const alpha = (i / this.trail.length) * 0.22;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBall(ctx: CanvasRenderingContext2D, ball: BallState): void {
    drawBaseball(ctx, ball.x, ball.y, ball.r, ball.rot);
  }

  /**
   * The perfect hit zone, unlocked at 120 combined Contact and Vision. Marks
   * the sweet spot on the ball as it comes in — the barrel zone that gives the
   * home-run chance. The whole ball is hittable; this is just where the damage
   * is. Purely an aid, it changes nothing about how contact resolves.
   */
  private drawPerfectZone(ctx: CanvasRenderingContext2D, ball: BallState): void {
    if (!this.perfectZoneUnlocked) return;
    // Only once the ball is close enough for the marker to mean anything.
    if (ball.r < this.layout().maxR * 0.42) return;

    const centerY = ball.y + IDEAL_UNDER * ball.r;
    const radius = sweetSpotRadius(
      this.opts.player.attributes.contact,
      this.opts.player.stamina,
    ) * ball.r;

    // Fade in as the ball arrives so it doesn't distract early in the flight.
    const presence = clamp((ball.r / this.layout().maxR - 0.42) / 0.4, 0, 1);

    ctx.save();
    ctx.globalAlpha = 0.55 + presence * 0.35;
    ctx.strokeStyle = '#5ce6a0';
    ctx.lineWidth = Math.max(1.5, ball.r * 0.07);
    ctx.beginPath();
    ctx.arc(ball.x, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshair on the exact spot.
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
   * unlocked (see `hasPerfectZone`), you only see your own mark and have to
   * find the spot yourself.
   */
  private drawFreeze(ctx: CanvasRenderingContext2D): void {
    const ball = this.frozenBall;
    if (!ball) return;

    this.drawBall(ctx, ball);

    if (this.perfectZoneUnlocked) {
      const sweet = sweetSpotRadius(
        this.opts.player.attributes.contact,
        this.opts.player.stamina,
      );
      const idealY = ball.y + IDEAL_UNDER * ball.r;

      ctx.save();
      ctx.strokeStyle = 'rgba(80, 230, 140, 0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(ball.x, idealY, sweet * ball.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (this.tapPoint) {
      ctx.save();
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      const s = Math.max(8, ball.r * 0.32);
      ctx.beginPath();
      ctx.moveTo(this.tapPoint.x - s, this.tapPoint.y - s);
      ctx.lineTo(this.tapPoint.x + s, this.tapPoint.y + s);
      ctx.moveTo(this.tapPoint.x + s, this.tapPoint.y - s);
      ctx.lineTo(this.tapPoint.x - s, this.tapPoint.y + s);
      ctx.stroke();
      ctx.restore();
    }
  }
}
