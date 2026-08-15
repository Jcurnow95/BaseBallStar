/**
 * Sanity-check batted-ball carry against real Statcast-style numbers.
 * Run: npx tsx tools/flight.ts
 */
import { launchBall, predictLanding, predictRest } from '../src/core/ballFlight';
import { DEFAULT_PARK, fenceAt } from '../src/core/ballpark';

const fenceDistanceAt = (p: { x: number; y: number }): number => fenceAt(DEFAULT_PARK, p);

const CASES: { ev: number; la: number; label: string; expect: string }[] = [
  { ev: 103, la: 28, label: 'Crushed no-doubter', expect: '~420 ft' },
  { ev: 98, la: 29, label: 'Solid home run', expect: '~380 ft' },
  { ev: 95, la: 25, label: 'Wall-scraper', expect: '~350 ft' },
  { ev: 90, la: 30, label: 'Warning track fly', expect: '~310 ft' },
  { ev: 85, la: 35, label: 'Routine fly', expect: '~260 ft' },
  { ev: 95, la: 12, label: 'Line drive', expect: '~230 ft carry' },
  { ev: 78, la: 45, label: 'Lazy popup', expect: '~150 ft' },
  { ev: 92, la: -3, label: 'Hard grounder', expect: 'skips through' },
  { ev: 70, la: 5, label: 'Weak grounder', expect: 'dies in infield' },
];

console.log('\n=== Batted ball carry ===\n');
console.log('case                    EV   LA    carry   hang   apex   fence   expected');

for (const c of CASES) {
  const ball = launchBall(c.ev, c.la, 0);
  const landing = predictLanding(ball);
  const rest = predictRest(launchBall(c.ev, c.la, 0));
  const restDist = Math.hypot(rest.x, rest.y);
  const fence = fenceDistanceAt(landing.point);

  console.log(
    `${c.label.padEnd(22)} ${String(c.ev).padStart(3)}  ${String(c.la).padStart(3)}` +
      `  ${landing.distance.toFixed(0).padStart(4)}ft` +
      `  ${landing.hangTime.toFixed(1).padStart(4)}s` +
      `  ${landing.apex.toFixed(0).padStart(4)}ft` +
      `  ${fence.toFixed(0).padStart(4)}ft` +
      `   ${c.expect}` +
      (c.la < 8 ? `  (rolls to ${restDist.toFixed(0)}ft)` : ''),
  );
}

// Real carry at 95 mph exit velocity, by launch angle. Distance peaks near 27
// degrees and falls away steeply either side; matching this shape matters more
// than any single number.
const REAL_AT_95: Record<number, number> = {
  10: 200, 15: 255, 20: 305, 25: 330, 30: 335, 35: 320, 40: 290, 45: 250, 50: 205, 55: 160,
};

console.log('\n=== Launch angle sweep at 95 EV (target curve) ===\n');
console.log('  LA   model   real   diff');
for (const la of Object.keys(REAL_AT_95).map(Number)) {
  const model = predictLanding(launchBall(95, la, 0)).distance;
  const real = REAL_AT_95[la];
  const diff = model - real;
  console.log(
    `  ${String(la).padStart(2)}   ${model.toFixed(0).padStart(4)}   ${String(real).padStart(4)}` +
      `   ${(diff > 0 ? '+' : '') + diff.toFixed(0)}`,
  );
}

console.log('\n=== Spray angle check (95 EV, 25 LA) ===\n');
for (const spray of [-1, -0.6, -0.2, 0, 0.2, 0.6, 1]) {
  const landing = predictLanding(launchBall(95, 25, spray));
  const fair = Math.abs(landing.point.x) <= landing.point.y;
  console.log(
    `spray ${String(spray).padStart(5)}  ->  x ${landing.point.x.toFixed(0).padStart(5)}` +
      `  y ${landing.point.y.toFixed(0).padStart(4)}  ${fair ? 'fair' : 'FOUL'}` +
      `  fence ${fenceDistanceAt(landing.point).toFixed(0)}ft`,
  );
}
console.log('');
