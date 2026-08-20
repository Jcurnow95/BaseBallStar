/**
 * The baseball, drawn the same everywhere it appears large enough to matter:
 * leather shaded like a sphere, two facing horseshoe seams, and stitch hashes
 * once the ball is big enough to carry them. Purely cosmetic — nothing about
 * contact or catching reads from what's drawn here.
 */
export function drawBaseball(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  /** Seam rotation in radians — a ball in flight visibly spins. */
  rot: number,
): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = r * 0.6;
  ctx.shadowOffsetY = r * 0.25;

  // Bright toward the upper left, rolling off into shadow at the lower-right
  // rim, so the disc reads as a ball under the lights.
  const shade = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  shade.addColorStop(0, '#ffffff');
  shade.addColorStop(0.55, '#f5f3ed');
  shade.addColorStop(0.85, '#ded9cd');
  shade.addColorStop(1, '#b6afa1');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (r <= 6) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.97, 0, Math.PI * 2);
  ctx.clip();

  ctx.lineCap = 'round';
  const drawSeam = (cx: number, from: number, to: number): void => {
    ctx.strokeStyle = '#c04a3e';
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath();
    ctx.arc(cx, 0, r * 0.95, from, to);
    ctx.stroke();

    // Stitch hashes across the seam, all tilted the same way — the classic
    // cartoon-baseball look. Only once the ball is big enough to carry them.
    if (r > 12) {
      ctx.strokeStyle = '#a83228';
      ctx.lineWidth = Math.max(1, r * 0.035);
      ctx.beginPath();
      const ticks = 9;
      for (let i = 0; i < ticks; i++) {
        const a = from + ((i + 0.5) / ticks) * (to - from);
        const px = cx + Math.cos(a) * r * 0.95;
        const py = Math.sin(a) * r * 0.95;
        const tilt = a + 0.65;
        const len = r * 0.1;
        ctx.moveTo(px - Math.cos(tilt) * len, py - Math.sin(tilt) * len);
        ctx.lineTo(px + Math.cos(tilt) * len, py + Math.sin(tilt) * len);
      }
      ctx.stroke();
    }
  };

  drawSeam(-r * 0.35, -0.9, 0.9);
  drawSeam(r * 0.35, Math.PI - 0.9, Math.PI + 0.9);
  ctx.restore();
}
