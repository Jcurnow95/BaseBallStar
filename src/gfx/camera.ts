import type { Vec2 } from '../core/fieldGeometry';

/**
 * The field camera: a tilted three-quarter view of the diamond.
 *
 * World space is feet with home plate at the origin and +y toward centre
 * field. On screen, +x is right and +y is up the screen, foreshortened by
 * `TILT` so the ground reads as a plane seen from a high seat behind the
 * plate rather than a map. Height (`z`) rises straight up the screen, which
 * is what lets a fly ball, a wall and a grandstand all have height.
 */

/** Vertical foreshortening of the ground plane. 1 would be a flat map. */
export const TILT = 0.7;
/** Screen rise per foot of height, per unit of scale. */
export const RISE = 0.85;

export class Camera {
  x = 0;
  y = 100;
  /** Screen pixels per foot, along x. */
  scale = 2.2;
  width = 1;
  height = 1;

  project(p: Vec2, z = 0): Vec2 {
    return {
      x: this.width / 2 + (p.x - this.x) * this.scale,
      y: this.height / 2 - (p.y - this.y) * this.scale * TILT - z * this.scale * RISE,
    };
  }

  /** Screen point back to the ground plane. */
  unproject(sx: number, sy: number): Vec2 {
    return {
      x: this.x + (sx - this.width / 2) / this.scale,
      y: this.y - (sy - this.height / 2) / (this.scale * TILT),
    };
  }

  /**
   * Compose the world transform onto the context, so paths can be traced in
   * feet and come out tilted and scaled. Pair with `leaveWorld`. Don't draw
   * text or figures in here — they come out squashed and upside down.
   */
  enterWorld(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.scale, -this.scale * TILT);
    ctx.translate(-this.x, -this.y);
  }

  leaveWorld(ctx: CanvasRenderingContext2D): void {
    ctx.restore();
  }

  /** World-space rectangle currently on screen, padded by `margin` feet. */
  bounds(margin = 0): { minX: number; maxX: number; minY: number; maxY: number } {
    const halfW = this.width / 2 / this.scale + margin;
    const halfH = this.height / 2 / (this.scale * TILT) + margin;
    return {
      minX: this.x - halfW,
      maxX: this.x + halfW,
      minY: this.y - halfH,
      maxY: this.y + halfH,
    };
  }

  /** Whether a screen point is anywhere near the canvas. */
  onScreen(p: Vec2, pad = 40): boolean {
    return p.x > -pad && p.x < this.width + pad && p.y > -pad && p.y < this.height + pad;
  }
}
