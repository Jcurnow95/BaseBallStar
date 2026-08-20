import { Rng, clamp, lerp } from '../core/rng';
import { drawBaseball } from './baseball';
import { createSurface, pointerPos, vibrate } from '../ui/canvas';
import type { Surface } from '../ui/canvas';
import { playSound } from '../ui/audio';

/**
 * The stretch catch. Fires mid-play when the player got *near* the ball but
 * not under it — the glove is out at the edge of their range and the catch has
 * to be earned rather than given.
 *
 * Same idea as the swing: the ball rushes in and you tap it, and how close to
 * its centre you land decides whether you hold on. `Fielding` sets the size of
 * the window, and how far out of position you were sets the speed.
 */

export interface CatchOverlayOptions {
  /** The player's Fielding attribute. */
  fielding: number;
  /** 0 = just outside the routine zone, 1 = at full stretch. */
  difficulty: number;
  wasFly: boolean;
  rng: Rng;
  onComplete(success: boolean): void;
}

type Phase = 'incoming' | 'freeze';

const FREEZE_MS = 780;

export class CatchOverlay {
  private readonly root: HTMLElement;
  private readonly hostEl: HTMLElement;
  private readonly surface: Surface;
  private readonly prompt: HTMLElement;
  private readonly opts: CatchOverlayOptions;

  private phase: Phase = 'incoming';
  /** Milliseconds into the current phase. Frame-driven, so backgrounding pauses it. */
  private elapsed = 0;
  private lastFrame = performance.now();
  /** Frozen: drawn but not advancing, and taps ignored. */
  paused = false;
  private raf = 0;
  private destroyed = false;
  private acted = false;
  private success = false;

  private readonly duration: number;
  private readonly fromAngle: number;
  private tap: { x: number; y: number } | null = null;
  private frozen: { x: number; y: number; r: number; rot: number } | null = null;

  constructor(root: HTMLElement, opts: CatchOverlayOptions) {
    this.root = root;
    this.opts = opts;

    const host = document.createElement('div');
    host.className = 'catch-overlay';
    this.root.appendChild(host);
    this.hostEl = host;

    this.surface = createSurface(host);

    this.prompt = document.createElement('div');
    this.prompt.className = 'catch-prompt';
    this.prompt.textContent = opts.wasFly ? 'REACH FOR IT!' : 'KNOCK IT DOWN!';
    host.appendChild(this.prompt);

    // The prompt says what's happening; this says what to do about it. Left
    // up every time — it's small, and the moment is too quick to learn from
    // once.
    const sub = document.createElement('div');
    sub.className = 'catch-sub';
    sub.textContent = 'tap the ball as it reaches you';
    host.appendChild(sub);

    const d = clamp(opts.difficulty, 0, 1);
    this.duration = lerp(1000, 620, d);
    this.fromAngle = opts.rng.range(0, Math.PI * 2);

    this.surface.canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.surface.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.surface.dispose();
    this.hostEl.remove();
  }

  /** How big a window the glove gives, in pixels. */
  private catchRadius(ballRadius: number): number {
    const skill = clamp(this.opts.fielding, 1, 99) / 100;
    const stretch = 1 - clamp(this.opts.difficulty, 0, 1) * 0.25;
    return ballRadius * (0.7 + skill * 0.85) * stretch;
  }

  private progress(): number {
    return this.elapsed / this.duration;
  }

  /**
   * Size basis for the overlay. Derived from the smaller of the two dimensions
   * so a wide screen doesn't inflate the ball to absurd proportions.
   */
  private get basis(): number {
    return Math.min(this.surface.width, this.surface.height * 0.62);
  }

  /** The ball comes in from off to one side and closes on the glove point. */
  private ballAt(t: number) {
    const W = this.surface.width;
    const H = this.surface.height;
    const basis = this.basis;
    const p = clamp(t, 0, 1.2);
    const eased = Math.pow(Math.min(p, 1), 1.7);

    const target = { x: W * 0.5, y: H * 0.52 };
    const travel = basis * 1.25;
    const originX = target.x + Math.cos(this.fromAngle) * travel;
    const originY = target.y + Math.sin(this.fromAngle) * travel * 0.7;

    const x = lerp(originX, target.x, eased);
    const y = lerp(originY, target.y, eased);
    // Same reasoning as the swing: the catch window is measured in ball radii,
    // so a bigger ball is a bigger fingertip target at the same difficulty.
    const r = lerp(
      Math.max(4, basis * 0.018),
      Math.max(basis * 0.13, 26),
      Math.pow(Math.min(p, 1), 1.6),
    );

    // Spins away from the side it came in from, same visible rate as a pitch.
    const spinDir = Math.cos(this.fromAngle) >= 0 ? -1 : 1;
    const rot = spinDir * p * Math.PI * 2 * 1.4;

    if (p > 1) {
      const over = p - 1;
      return {
        x: x + Math.cos(this.fromAngle) * -travel * over * 0.5,
        y: y + Math.sin(this.fromAngle) * -travel * over * 0.5,
        r: r * (1 + over * 0.4),
        rot,
      };
    }
    return { x, y, r, rot };
  }

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.paused || this.acted || this.phase !== 'incoming') return;

    const p = pointerPos(this.surface.canvas, e);
    const t = this.progress();
    const ball = this.ballAt(t);

    this.acted = true;
    this.tap = p;
    this.frozen = ball;

    const away = Math.hypot(p.x - ball.x, p.y - ball.y);
    // Reaching before the ball is anywhere near you doesn't count.
    this.success = t > 0.5 && away <= this.catchRadius(ball.r);

    vibrate(this.success ? 35 : 14);
    // A miss still gets a sound — reaching and coming up empty should land as
    // a fumble, not as silence.
    playSound(this.success ? 'catchMade' : 'catchMissed');
    this.prompt.textContent = this.success ? 'GOT IT!' : t <= 0.5 ? 'TOO EARLY!' : 'DROPPED!';
    this.prompt.className = `catch-prompt ${this.success ? 'good' : 'bad'}`;
    this.phase = 'freeze';
    this.elapsed = 0;
  };

  private loop = (): void => {
    if (this.destroyed) return;
    const now = performance.now();
    if (!this.paused) this.elapsed += Math.min(now - this.lastFrame, 50);
    this.lastFrame = now;

    if (this.phase === 'incoming' && this.progress() >= 1.2 && !this.acted) {
      this.acted = true;
      this.success = false;
      this.frozen = this.ballAt(1.2);
      this.prompt.textContent = 'IT GETS BY!';
      this.prompt.className = 'catch-prompt bad';
      this.phase = 'freeze';
      this.elapsed = 0;
    } else if (this.phase === 'freeze' && this.elapsed >= FREEZE_MS) {
      this.opts.onComplete(this.success);
      return;
    }

    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    const { ctx } = this.surface;
    const W = this.surface.width;
    const H = this.surface.height;
    if (W <= 0 || H <= 0) return;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(6, 12, 22, 0.62)';
    ctx.fillRect(0, 0, W, H);

    const ball = this.phase === 'freeze' && this.frozen ? this.frozen : this.ballAt(this.progress());

    // A short trail so the eye can lead the ball rather than chase it. No
    // target ring: you tap the ball itself, and a fixed ring in the middle
    // reads as "tap here", which is the wrong instruction.
    if (this.phase === 'incoming') {
      const t = this.progress();
      for (let i = 1; i <= 3; i++) {
        const past = this.ballAt(Math.max(0, t - i * 0.05));
        ctx.fillStyle = `rgba(255,255,255,${0.16 - i * 0.04})`;
        ctx.beginPath();
        ctx.arc(past.x, past.y, past.r * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawBaseball(ctx, ball.x, ball.y, ball.r, ball.rot);

    if (this.phase === 'freeze' && this.frozen) {
      ctx.save();
      ctx.strokeStyle = this.success ? 'rgba(80,230,140,0.9)' : 'rgba(255,120,120,0.9)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(this.frozen.x, this.frozen.y, this.catchRadius(this.frozen.r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      if (this.tap) {
        ctx.save();
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        const s = 11;
        ctx.beginPath();
        ctx.moveTo(this.tap.x - s, this.tap.y - s);
        ctx.lineTo(this.tap.x + s, this.tap.y + s);
        ctx.moveTo(this.tap.x + s, this.tap.y - s);
        ctx.lineTo(this.tap.x - s, this.tap.y + s);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}
