import type { AtBatOutcome, Pitch, PlayerProfile } from '../core/types';
import type { Count, PitcherAI } from '../core/pitching';
import { readPitch, throwPitch } from '../core/pitching';
import type { BattedBall } from '../core/types';
import { IDEAL_UNDER, resolveSwing, sweetSpotRadius } from '../core/swing';
import { foulChanceFor } from '../core/outcome';
import { hasPerfectZone } from '../core/progression';
import { launchBall, predictLanding } from '../core/ballFlight';
import { isFair } from '../core/fieldGeometry';
import type { Uniform } from '../core/uniforms';
import { Rng, clamp, lerp } from '../core/rng';
import type { LeagueLevel } from '../core/league';
import { createSurface, pointerPos, vibrate } from '../ui/canvas';
import type { Surface } from '../ui/canvas';
import { playSound } from '../ui/audio';

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

interface BallState {
  x: number;
  y: number;
  r: number;
}

export class AtBatView {
  private readonly root: HTMLElement;
  private readonly surface: Surface;
  private readonly banner: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly opts: AtBatOptions;

  private phase: Phase = 'windup';
  private phaseStart = 0;
  private raf = 0;
  private destroyed = false;

  private count: Count = { balls: 0, strikes: 0 };
  private pitch!: Pitch;
  private pitchLabel = '';
  private swung = false;
  private trail: BallState[] = [];

  private tapPoint: { x: number; y: number } | null = null;
  private frozenBall: BallState | null = null;
  private afterFreeze: (() => void) | null = null;
  private hiddenAt = 0;
  private readonly perfectZoneUnlocked: boolean;

  constructor(root: HTMLElement, opts: AtBatOptions) {
    this.root = root;
    this.opts = opts;
    this.root.classList.add('atbat');
    this.root.innerHTML = '';
    this.perfectZoneUnlocked = hasPerfectZone(opts.player.attributes);

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
    this.phaseStart = performance.now();
  }

  private freezeThen(text: string, tone: string, action: () => void): void {
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
   * Flight timing runs off the wall clock, but rAF stops when the app is
   * backgrounded. Without this, taking a phone call mid-pitch would come back
   * as a called strike the player never saw. Re-deliver instead.
   */
  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.hiddenAt = performance.now();
      return;
    }
    if (!this.hiddenAt) return;
    const away = performance.now() - this.hiddenAt;
    this.hiddenAt = 0;

    if (this.phase === 'flight' && !this.swung) {
      this.trail = [];
      this.setPhase('windup');
    } else {
      this.phaseStart += away;
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.phase === 'freeze' || this.swung) return;

    // Ball positions live in stage space, so the tap has to be moved into it
    // before the two can be compared.
    const tap = pointerPos(this.surface.canvas, e);
    const { x, y } = this.toStage(tap.x, tap.y);

    if (this.phase === 'windup') {
      // Jumped before the pitch was even thrown.
      this.swung = true;
      vibrate(15);
      playSound('whiff');
      this.registerStrike('Way early — swing and a miss.');
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
    const landing = predictLanding(launchBall(bb.exitVelocity, bb.launchAngle, bb.spray));
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
    const elapsed = performance.now() - this.phaseStart;
    return elapsed / this.pitch.def.duration;
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
      zoneY: H * 0.585,
      zoneHW: W * 0.185,
      zoneHH: H * 0.1,
      mound: { x: W / 2, y: H * 0.315 },
      minR: Math.max(2.2, W * 0.011),
      maxR: W * 0.105,
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
    const grow = Math.pow(capped, 2.5);
    // Break arrives late, which is what makes a slider a slider.
    const breakIn = Math.pow(capped, this.pitch.def.breakSharpness);

    const apparent = this.zonePos(this.pitch.releaseX, this.pitch.releaseY);
    const actual = this.zonePos(this.pitch.plateX, this.pitch.plateY);
    const targetX = lerp(apparent.x, actual.x, breakIn);
    const targetY = lerp(apparent.y, actual.y, breakIn);

    let x = lerp(L.mound.x, targetX, travel);
    let y = lerp(L.mound.y, targetY, travel);
    let r = lerp(L.minR, L.maxR, grow);

    if (p > 1) {
      const over = p - 1;
      y += over * L.H * 0.55;
      x += (x - L.cx) * over * 0.35;
      r *= 1 + over * 0.7;
    }

    return { x, y, r };
  }

  /* --------------------------------------------------------------- render */

  private loop = (): void => {
    if (this.destroyed) return;
    const now = performance.now();

    if (this.phase === 'windup' && now - this.phaseStart >= WINDUP_MS) {
      this.setPhase('flight');
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
    } else if (this.phase === 'freeze' && now - this.phaseStart >= FREEZE_MS) {
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
    this.drawPlate(ctx, L);

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
  }

  private drawField(ctx: CanvasRenderingContext2D, L: ReturnType<AtBatView['layout']>): void {
    // Canvas edges expressed in stage coordinates. The horizon and the dirt
    // apex stay anchored to the stage; only the fills reach past it.
    const left = -L.ox;
    const top = -L.oy;
    const right = L.canvasW - L.ox;
    const bottom = L.canvasH - L.oy;
    const fullW = L.canvasW;

    const sky = ctx.createLinearGradient(0, top, 0, L.horizon);
    sky.addColorStop(0, '#0a1024');
    sky.addColorStop(1, '#1d2c4d');
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
    ctx.quadraticCurveTo(L.cx, L.H * 0.52, right + fullW * 0.2, bottom);
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
    // Mound.
    ctx.fillStyle = '#8a5a35';
    ctx.beginPath();
    ctx.ellipse(L.mound.x, L.mound.y + L.H * 0.02, L.W * 0.11, L.H * 0.022, 0, 0, Math.PI * 2);
    ctx.fill();

    const windup =
      this.phase === 'windup' ? clamp((performance.now() - this.phaseStart) / WINDUP_MS, 0, 1) : 1;
    const afterRelease = this.phase !== 'windup';
    // How far through the follow-through we are, once the ball is gone.
    const follow = afterRelease ? clamp((performance.now() - this.phaseStart) / 420, 0, 1) : 0;

    const kit = this.opts.pitcherKit;
    const bodyH = L.H * 0.062;
    const bodyW = L.W * 0.042;
    const legLen = bodyH * 0.62;
    const armLen = bodyH * 0.58;
    const shoulderY = -bodyH;
    const hipY = -bodyH * 0.42;

    // Gather (0-0.35), stride (0.35-0.78), whip through release (0.78-1).
    const gather = clamp(windup / 0.35, 0, 1);
    const stride = clamp((windup - 0.35) / 0.43, 0, 1);
    const whip = clamp((windup - 0.78) / 0.22, 0, 1);

    const lift = Math.sin(gather * Math.PI) * (1 - stride);
    const crouch = Math.sin(windup * Math.PI) * bodyH * 0.1;

    ctx.save();
    ctx.translate(L.mound.x, L.mound.y - crouch);
    ctx.lineCap = 'round';

    // ---- Legs. Back leg plants, front leg lifts then strides toward us.
    ctx.strokeStyle = kit.pants;
    ctx.lineWidth = Math.max(2.5, bodyW * 0.34);

    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(-bodyW * 0.5, hipY + legLen);
    ctx.stroke();

    const frontKneeX = bodyW * (0.25 + stride * 0.75);
    const frontFootY = hipY + legLen * (1 - lift * 0.55) + follow * legLen * 0.12;
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
    const visibility = clamp(0.18 + this.opts.player.attributes.vision / 220, 0.18, 0.62);
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${visibility})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(L.cx - L.zoneHW, L.zoneY - L.zoneHH, L.zoneHW * 2, L.zoneHH * 2);

    ctx.setLineDash([]);
    ctx.strokeStyle = `rgba(255,255,255,${visibility * 0.4})`;
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const x = L.cx - L.zoneHW + (L.zoneHW * 2 * i) / 3;
      ctx.beginPath();
      ctx.moveTo(x, L.zoneY - L.zoneHH);
      ctx.lineTo(x, L.zoneY + L.zoneHH);
      ctx.stroke();
      const y = L.zoneY - L.zoneHH + (L.zoneHH * 2 * i) / 3;
      ctx.beginPath();
      ctx.moveTo(L.cx - L.zoneHW, y);
      ctx.lineTo(L.cx + L.zoneHW, y);
      ctx.stroke();
    }
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
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = ball.r * 0.6;
    ctx.shadowOffsetY = ball.r * 0.25;

    ctx.fillStyle = '#fdfdfb';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Seams, so spin and size read clearly as it comes in.
    if (ball.r > 6) {
      ctx.strokeStyle = '#c8352f';
      ctx.lineWidth = Math.max(1, ball.r * 0.1);
      ctx.beginPath();
      ctx.arc(ball.x - ball.r * 0.35, ball.y, ball.r * 0.95, -0.9, 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ball.x + ball.r * 0.35, ball.y, ball.r * 0.95, Math.PI - 0.9, Math.PI + 0.9);
      ctx.stroke();
    }
  }

  /**
   * The perfect hit zone, unlocked at 120 combined Contact and Vision. Marks
   * the ideal contact point on the ball as it comes in — purely an aid, it
   * changes nothing about how contact resolves.
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
   * Post-swing teaching frame: shows exactly where the tap landed relative to
   * the ball and to the ideal contact point. This is how the player learns the
   * mechanic instead of guessing at it.
   */
  private drawFreeze(ctx: CanvasRenderingContext2D): void {
    const ball = this.frozenBall;
    if (!ball) return;

    this.drawBall(ctx, ball);

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
