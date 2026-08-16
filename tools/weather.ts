/**
 * How much the weather moves a batted ball. Same balls, different days.
 * Run: npx tsx tools/weather.ts
 */
import { launchBall, predictLanding, predictRest } from '../src/core/ballFlight';
import type { Weather } from '../src/core/weather';
import { CALM, airFor, describeWeather } from '../src/core/weather';

const MPH = 1.4667;
const wind = (mph: number, dirDeg: number): { x: number; y: number } => ({
  x: Math.sin((dirDeg * Math.PI) / 180) * mph * MPH,
  y: Math.cos((dirDeg * Math.PI) / 180) * mph * MPH,
});

const DAYS: Weather[] = [
  CALM,
  { sky: 'clear', wind: wind(10, 0), rain: 0 },
  { sky: 'clear', wind: wind(20, 0), rain: 0 },
  { sky: 'clear', wind: wind(10, 180), rain: 0 },
  { sky: 'clear', wind: wind(20, 180), rain: 0 },
  { sky: 'clear', wind: wind(15, 90), rain: 0 },
  { sky: 'rain', wind: wind(0, 0), rain: 0.5 },
  { sky: 'storm', wind: wind(25, 180), rain: 1 },
  { sky: 'storm', wind: wind(25, 0), rain: 1 },
];

const BALLS = [
  { label: 'HR fly 100/28', ev: 100, la: 28, spray: 0 },
  { label: 'Deep fly 92/32', ev: 92, la: 32, spray: 0 },
  { label: 'Liner 98/12', ev: 98, la: 12, spray: 0 },
  { label: 'Grounder 92/2', ev: 92, la: 2, spray: 0.3 },
];

console.log('\n=== Weather effect on carry (ft), rest distance for the grounder ===\n');
console.log('day'.padEnd(34) + BALLS.map((b) => b.label.padStart(16)).join(''));
for (const day of DAYS) {
  const air = airFor(day);
  const cells = BALLS.map((b) => {
    const ball = launchBall(b.ev, b.la, b.spray, 1, 0, air);
    if (b.la < 8) {
      const rest = predictRest(ball);
      return `${Math.hypot(rest.x, rest.y).toFixed(0)}ft`.padStart(16);
    }
    const land = predictLanding(ball);
    const drift = land.point.x;
    return `${land.distance.toFixed(0)}ft x${drift >= 0 ? '+' : ''}${drift.toFixed(0)}`.padStart(16);
  });
  console.log(describeWeather(day).padEnd(34) + cells.join(''));
}
console.log();
