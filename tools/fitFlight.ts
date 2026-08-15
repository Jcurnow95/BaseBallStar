/**
 * Fits the aerodynamic constants in `core/ballFlight.ts` to real batted-ball
 * carry, so the flight model is measured against something rather than guessed.
 * Run: npx tsx tools/fitFlight.ts
 *
 * The constants that come out are a *fit*, not textbook values — an Euler
 * integrator with a single lift term is a coarse stand-in for real
 * aerodynamics, so it needs slightly heavier air than physics tables give.
 */
import { FLIGHT, launchBall, predictLanding } from '../src/core/ballFlight';

interface Target {
  ev: number;
  la: number;
  distance: number;
  /** Barrels decide home runs, so they carry more weight in the fit. */
  weight: number;
}

const TARGETS: Target[] = [
  // Launch-angle curve at a fixed exit velocity.
  { ev: 95, la: 10, distance: 210, weight: 1 },
  { ev: 95, la: 15, distance: 265, weight: 1 },
  { ev: 95, la: 20, distance: 310, weight: 1 },
  { ev: 95, la: 25, distance: 330, weight: 2 },
  { ev: 95, la: 30, distance: 333, weight: 2 },
  { ev: 95, la: 35, distance: 322, weight: 1 },
  { ev: 95, la: 40, distance: 300, weight: 1 },
  { ev: 95, la: 45, distance: 270, weight: 1 },
  { ev: 95, la: 50, distance: 235, weight: 1 },
  { ev: 95, la: 55, distance: 200, weight: 1 },
  // Exit-velocity ladder at roughly optimal launch angle. These decide whether
  // a barrel actually clears a 330-400 ft fence, so they matter most.
  { ev: 105, la: 28, distance: 435, weight: 3 },
  { ev: 103, la: 28, distance: 415, weight: 3 },
  { ev: 100, la: 27, distance: 390, weight: 3 },
  { ev: 95, la: 28, distance: 333, weight: 2 },
  { ev: 90, la: 30, distance: 305, weight: 2 },
  { ev: 85, la: 35, distance: 265, weight: 1 },
  { ev: 80, la: 30, distance: 235, weight: 1 },
  { ev: 75, la: 40, distance: 195, weight: 1 },
  { ev: 105, la: 20, distance: 375, weight: 1 },
];

const TOTAL_WEIGHT = TARGETS.reduce((sum, t) => sum + t.weight, 0);

function error(): number {
  let total = 0;
  for (const t of TARGETS) {
    const model = predictLanding(launchBall(t.ev, t.la, 0)).distance;
    total += t.weight * (model - t.distance) ** 2;
  }
  return Math.sqrt(total / TOTAL_WEIGHT);
}

interface Params {
  drag: number;
  lift: number;
  spinFalloffStart: number;
  spinFalloffRate: number;
  evSpin: number;
}

function search(ranges: Record<keyof Params, number[]>): { params: Params; error: number } {
  let best: { params: Params; error: number } = {
    params: { ...FLIGHT },
    error: Infinity,
  };

  for (const drag of ranges.drag) {
    for (const lift of ranges.lift) {
      for (const spinFalloffStart of ranges.spinFalloffStart) {
        for (const spinFalloffRate of ranges.spinFalloffRate) {
          for (const evSpin of ranges.evSpin) {
            Object.assign(FLIGHT, { drag, lift, spinFalloffStart, spinFalloffRate, evSpin });
            const e = error();
            if (e < best.error) {
              best = {
                params: { drag, lift, spinFalloffStart, spinFalloffRate, evSpin },
                error: e,
              };
            }
          }
        }
      }
    }
  }
  return best;
}

const span = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
};

console.log('\nCoarse search...');
const coarse = search({
  drag: span(0.0016, 0.0038, 0.0002),
  lift: span(0.03, 0.26, 0.02),
  spinFalloffStart: span(6, 34, 4),
  spinFalloffRate: span(0.005, 0.07, 0.01),
  evSpin: span(0, 0.08, 0.01),
});
console.log(`  best RMSE ${coarse.error.toFixed(1)} ft`);

console.log('Refining...');
const c = coarse.params;
const fine = search({
  drag: span(Math.max(0.001, c.drag - 0.0002), c.drag + 0.0002, 0.00005),
  lift: span(Math.max(0.01, c.lift - 0.02), c.lift + 0.02, 0.005),
  spinFalloffStart: span(Math.max(2, c.spinFalloffStart - 4), c.spinFalloffStart + 4, 1),
  spinFalloffRate: span(Math.max(0, c.spinFalloffRate - 0.01), c.spinFalloffRate + 0.01, 0.0025),
  evSpin: span(Math.max(0, c.evSpin - 0.01), c.evSpin + 0.01, 0.0025),
});

const best = fine.error < coarse.error ? fine : coarse;
Object.assign(FLIGHT, best.params);

console.log('\n=== Best fit ===\n');
console.log(`  drag              ${best.params.drag.toFixed(5)}`);
console.log(`  lift              ${best.params.lift.toFixed(4)}`);
console.log(`  spinFalloffStart  ${best.params.spinFalloffStart}`);
console.log(`  spinFalloffRate   ${best.params.spinFalloffRate.toFixed(4)}`);
console.log(`  evSpin            ${best.params.evSpin.toFixed(4)}`);
console.log(`  weighted RMSE     ${best.error.toFixed(1)} ft\n`);

console.log('   EV   LA   model   real   diff');
for (const t of TARGETS) {
  const model = predictLanding(launchBall(t.ev, t.la, 0)).distance;
  const diff = model - t.distance;
  console.log(
    `  ${String(t.ev).padStart(3)}  ${String(t.la).padStart(3)}   ${model.toFixed(0).padStart(4)}` +
      `   ${String(t.distance).padStart(4)}   ${(diff > 0 ? '+' : '') + diff.toFixed(0)}`,
  );
}
console.log('');
