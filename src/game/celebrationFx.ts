/**
 * Home-run celebration: fireworks over the stands and confetti down the
 * screen, sized by how many runs the homer drove in. A solo shot gets a
 * couple of bursts and a flurry; a grand slam gets a barrage, a gold-heavy
 * palette, a flash off the bat and its own name in lights.
 *
 * Self-contained and purely cosmetic. It mounts its own canvas over whatever
 * stage it's given, runs its own frame loop, and removes itself once the last
 * particle has faded. Mounting on the stage rather than inside the play view
 * is deliberate: the view underneath gets torn down and replaced by the idle
 * card a couple of seconds after the ball clears, and the party should keep
 * going over the top of that rather than vanish with it.
 */

import { createSurface } from '../ui/canvas';
import type { Surface } from '../ui/canvas';

interface Level {
  /** Seconds of fresh rockets and confetti. Whatever is already up finishes on its own. */
  duration: number;
  rocketsPerSec: number;
  /** Sparks per burst. */
  sparks: number;
  /** Confetti pieces over the whole show. */
  confetti: number;
  /** Words under the GONE! banner. Nothing for a solo shot — the banner said it. */
  label: string;
  /** Whole-screen flash on the first frame. */
  flash: boolean;
  palette: readonly string[];
}

// No greens: the field is green, and a green burst over it just disappears.
const PALETTE = ['#ffd166', '#ff6b6b', '#4fd1ff', '#ff8ef0', '#ffffff', '#ffa94d', '#c9b3ff'];
const SLAM_PALETTE = ['#ffd166', '#ffe9a8', '#ffffff', '#ffb347', '#fff2c6', '#ff6b6b'];

/** Indexed by runs scored minus one. Everything grows with the runs. */
const LEVELS: readonly Level[] = [
  { duration: 2.4, rocketsPerSec: 1.4, sparks: 44, confetti: 90, label: '', flash: false, palette: PALETTE },
  { duration: 3.4, rocketsPerSec: 2.1, sparks: 54, confetti: 160, label: '2-RUN SHOT', flash: false, palette: PALETTE },
  { duration: 4.4, rocketsPerSec: 3.0, sparks: 64, confetti: 250, label: '3-RUN SHOT', flash: false, palette: PALETTE },
  { duration: 6.0, rocketsPerSec: 4.4, sparks: 84, confetti: 400, label: 'GRAND SLAM!', flash: true, palette: SLAM_PALETTE },
];

/** Pixels per second squared. Sparks arc; confetti only drifts. */
const SPARK_GRAVITY = 230;
/** Per-second velocity retention for sparks — the burst blooms then hangs. */
const SPARK_DRAG = 0.2;
/** Seconds the label stays up after the last rocket. */
const LABEL_TAIL = 0.8;
/** Seconds the whole show takes to fade once the screen under it has ended. */
const WRAP_FADE = 0.5;

interface Rocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds until it bursts. */
  fuse: number;
  colour: string;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  colour: string;
  size: number;
}

interface Confetto {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  angle: number;
  spin: number;
  /** Side-to-side drift: amplitude and rate. */
  sway: number;
  swayRate: number;
  /** Tumble about the long axis, faked by squashing the height. */
  flipRate: number;
  phase: number;
  colour: string;
}

export class Celebration {
  private readonly surface: Surface;
  private readonly level: Level;
  private readonly runs: number;

  private rockets: Rocket[] = [];
  private sparks: Spark[] = [];
  private confetti: Confetto[] = [];

  private raf = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private rocketDue = 0;
  private confettiSpawned = 0;
  private destroyed = false;
  private _paused = false;
  /** Seconds of fade left once `wrapUp` has been called; negative until then. */
  private fadeLeft = -1;

  /**
   * @param stage Positioned container to draw over. The canvas covers it.
   * @param runs Runs the homer scored, 1–4. Anything past four is a grand slam.
   */
  constructor(stage: HTMLElement, runs: number) {
    this.runs = Math.max(1, Math.min(4, Math.round(runs)));
    this.level = LEVELS[this.runs - 1];

    this.surface = createSurface(stage);
    this.surface.canvas.className = 'celebration-fx';

    // An opening salvo so the first burst lands with the call, not a second
    // after it. One rocket per run, fuses staggered so they pop in sequence.
    for (let i = 0; i < this.runs; i++) this.launch(0.35 + i * 0.18);

    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  set paused(value: boolean) {
    this._paused = value;
  }

  get paused(): boolean {
    return this._paused;
  }

  /**
   * The screen under the party has ended. Stop launching anything new and
   * fade what's up over half a second, then go — rather than raining
   * confetti over the scoreboard for the rest of the show.
   */
  wrapUp(): void {
    if (this.fadeLeft >= 0) return;
    this.fadeLeft = WRAP_FADE;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.surface.dispose();
  }

  /* --------------------------------------------------------------- update */

  private loop = (): void => {
    if (this.destroyed) return;
    const now = performance.now();
    const dt = this._paused ? 0 : Math.min((now - this.lastFrame) / 1000, 1 / 20);
    this.lastFrame = now;

    this.update(dt);
    this.draw();

    if (this.finished()) {
      this.destroy();
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private finished(): boolean {
    if (this.fadeLeft >= 0) return this.fadeLeft <= 0;
    return (
      this.elapsed >= this.level.duration + LABEL_TAIL &&
      this.rockets.length === 0 &&
      this.sparks.length === 0 &&
      this.confetti.length === 0
    );
  }

  private update(dt: number): void {
    if (dt <= 0) return;
    const { width: W, height: H } = this.surface;
    const level = this.level;
    this.elapsed += dt;

    const winding = this.fadeLeft >= 0;
    if (winding) this.fadeLeft = Math.max(0, this.fadeLeft - dt);

    if (!winding && this.elapsed < level.duration) {
      this.rocketDue += level.rocketsPerSec * dt;
      while (this.rocketDue >= 1) {
        this.rocketDue -= 1;
        this.launch(0.45 + Math.random() * 0.4);
      }

      // Confetti drops steadily over the first two thirds of the show, so
      // the screen fills rather than dumping one bucket at the start.
      const target = level.confetti * Math.min(1, this.elapsed / (level.duration * 0.66));
      while (this.confettiSpawned < target) {
        this.confettiSpawned++;
        this.dropConfetto(W);
      }
    }

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.fuse -= dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.vy += SPARK_GRAVITY * dt;
      if (r.fuse <= 0) {
        this.burst(r, H);
        this.rockets.splice(i, 1);
      }
    }

    const keep = Math.pow(SPARK_DRAG, dt);
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.vx *= keep;
      s.vy = s.vy * keep + SPARK_GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }

    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      const t = this.elapsed * c.swayRate + c.phase;
      c.x += (c.vx + Math.cos(t) * c.sway) * dt;
      c.y += c.vy * dt;
      c.angle += c.spin * dt;
      if (c.y > H + 20) this.confetti.splice(i, 1);
    }
  }

  /** A rocket from the bottom edge, timed to burst somewhere in the top half. */
  private launch(fuse: number): void {
    const { width: W, height: H } = this.surface;
    const x = W * (0.12 + Math.random() * 0.76);
    const burstY = H * (0.14 + Math.random() * 0.36);
    // Solve the rise so the fuse runs out right at the chosen height.
    const vy = (burstY - H - 0.5 * SPARK_GRAVITY * fuse * fuse) / fuse;
    this.rockets.push({
      x,
      y: H + 4,
      vx: (Math.random() - 0.5) * 50,
      vy,
      fuse,
      colour: this.pick(),
    });
  }

  private burst(r: Rocket, H: number): void {
    const level = this.level;
    const count = Math.round(level.sparks * (0.8 + Math.random() * 0.4));
    const spread = H * (0.27 + this.runs * 0.03);
    // Every other burst is one colour; the rest mix in white for sparkle.
    const twoTone = Math.random() < 0.5;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = spread * (0.25 + Math.random() * 0.75);
      const maxLife = 1.0 + Math.random() * 0.9;
      this.sparks.push({
        x: r.x,
        y: r.y,
        vx: Math.cos(angle) * speed + r.vx * 0.3,
        vy: Math.sin(angle) * speed,
        life: maxLife,
        maxLife,
        colour: twoTone && i % 3 === 0 ? '#ffffff' : r.colour,
        size: 1.8 + Math.random() * 1.8,
      });
    }
  }

  private dropConfetto(W: number): void {
    const w = 6 + Math.random() * 6;
    this.confetti.push({
      x: Math.random() * W,
      y: -12 - Math.random() * 30,
      vx: (Math.random() - 0.5) * 40,
      vy: 150 + Math.random() * 120,
      w,
      h: w * (0.4 + Math.random() * 0.3),
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 8,
      sway: 25 + Math.random() * 45,
      swayRate: 1.5 + Math.random() * 2,
      flipRate: 3 + Math.random() * 5,
      phase: Math.random() * Math.PI * 2,
      colour: this.pick(),
    });
  }

  private pick(): string {
    const p = this.level.palette;
    return p[Math.floor(Math.random() * p.length)];
  }

  /* ----------------------------------------------------------------- draw */

  private draw(): void {
    const { ctx, width: W, height: H } = this.surface;
    ctx.clearRect(0, 0, W, H);

    // Fading the element beats fading every particle: one opacity, one layer.
    if (this.fadeLeft >= 0) this.surface.canvas.style.opacity = String(this.fadeLeft / WRAP_FADE);

    if (this.level.flash) {
      const a = Math.max(0, 0.6 * (1 - this.elapsed / 0.45));
      if (a > 0) {
        ctx.fillStyle = `rgba(255, 236, 170, ${a})`;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // Confetti in normal blending — it's paper, it should look opaque.
    for (const c of this.confetti) {
      const squash = Math.cos(this.elapsed * c.flipRate + c.phase);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.scale(1, Math.max(0.15, Math.abs(squash)));
      ctx.fillStyle = c.colour;
      ctx.globalAlpha = 0.75 + 0.25 * Math.abs(squash);
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }

    // Light on light adds up, so bursts glow where sparks overlap.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (const r of this.rockets) {
      ctx.strokeStyle = r.colour;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(r.x - r.vx * 0.05, r.y - r.vy * 0.05);
      ctx.lineTo(r.x, r.y);
      ctx.stroke();
    }

    for (const s of this.sparks) {
      const t = s.life / s.maxLife;
      // Flicker as it dies, the way a spark does.
      const flicker = t < 0.4 ? 0.5 + 0.5 * Math.sin(s.life * 40) : 1;
      ctx.globalAlpha = Math.min(1, t * 1.4) * flicker;
      ctx.strokeStyle = s.colour;
      ctx.lineWidth = s.size * (0.6 + 0.4 * t);
      ctx.beginPath();
      ctx.moveTo(s.x - s.vx * 0.035, s.y - s.vy * 0.035);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
    ctx.restore();

    this.drawLabel(W, H);
  }

  private drawLabel(W: number, H: number): void {
    const text = this.level.label;
    if (!text) return;
    const end = this.level.duration + LABEL_TAIL;
    if (this.elapsed >= end) return;

    // Pops in with a bit of overshoot, holds, then fades over the last stretch.
    const pop = Math.min(1, this.elapsed / 0.28);
    const scale = 1 + 0.35 * (1 - pop) * Math.sin(pop * Math.PI);
    const fade = Math.min(1, (end - this.elapsed) / 0.6);

    const ctx = this.surface.ctx;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(W / 2, H * 0.56);
    ctx.scale(scale, scale);
    ctx.font = `900 ${Math.min(30, W * 0.075)}px 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = this.runs >= 4 ? '#ffd166' : '#ffffff';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}
