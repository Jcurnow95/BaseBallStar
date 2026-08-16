import type { Vec2 } from './fieldGeometry';
import type { Rng } from './rng';

/**
 * Game-day weather. Wind and rain both act on the batted ball, which is the
 * whole point: a fly ball into a stiff wind dies on the track, the same ball
 * with the wind at its back leaves, and a wet outfield turns rockets in the
 * gap into balls that just stop.
 *
 * Wind is a vector in field space — +y is out toward centre field, +x toward
 * right — in ft/s, and it holds steady for the whole game so the player can
 * read the flag once and plan around it.
 */

export type SkyKind = 'clear' | 'overcast' | 'rain' | 'storm';

export interface Weather {
  sky: SkyKind;
  /** Wind vector in ft/s, field frame. */
  wind: Vec2;
  /** How hard it's raining, 0 (dry) to 1 (downpour). */
  rain: number;
}

/**
 * What the flight model actually consumes. Split from `Weather` so a ball can
 * be flown without a whole forecast attached, and so a test can hand it a
 * plain wind vector.
 */
export interface AirConditions {
  windX: number;
  windY: number;
  /** Multiplier on drag: heavier, wetter air is above 1. */
  density: number;
  /** Multiplier on Magnus lift: a rain-slick ball spins less usefully. */
  liftScale: number;
  /** How wet the turf is, 0..1. Kills the bounce and the roll. */
  wet: number;
}

export const CALM: Weather = { sky: 'clear', wind: { x: 0, y: 0 }, rain: 0 };
export const STILL_AIR: AirConditions = { windX: 0, windY: 0, density: 1, liftScale: 1, wet: 0 };

const MPH = 1.4667;

export function airFor(weather: Weather | undefined): AirConditions {
  if (!weather) return STILL_AIR;
  const rain = clamp01(weather.rain);
  return {
    windX: weather.wind.x,
    windY: weather.wind.y,
    // Fun over realism: rain should visibly cost carry. Humid air is actually
    // a touch thinner, but a soaked ball is heavier and rougher, and the
    // player's read is simply "wet day, balls don't go".
    density: 1 + rain * 0.14,
    liftScale: 1 - rain * 0.2,
    wet: rain,
  };
}

/**
 * Roll a day's weather. Most days are dry; about a quarter have something
 * happening. Wind speeds run 0-25 mph, with storms at the top of that.
 */
export function rollWeather(rng: Rng): Weather {
  const roll = rng.next();
  const sky: SkyKind =
    roll < 0.6 ? 'clear' : roll < 0.78 ? 'overcast' : roll < 0.94 ? 'rain' : 'storm';

  const speedMph =
    sky === 'storm'
      ? rng.range(15, 25)
      : sky === 'rain'
        ? rng.range(4, 16)
        : sky === 'overcast'
          ? rng.range(2, 18)
          : rng.range(0, 14);

  const angle = rng.range(-Math.PI, Math.PI);
  const wind = { x: Math.sin(angle) * speedMph * MPH, y: Math.cos(angle) * speedMph * MPH };
  const rain = sky === 'storm' ? rng.range(0.7, 1) : sky === 'rain' ? rng.range(0.3, 0.7) : 0;

  return { sky, wind, rain };
}

export function windMph(weather: Weather): number {
  return Math.hypot(weather.wind.x, weather.wind.y) / MPH;
}

/**
 * The wind as a fan would call it: "out to right", "in from left", "across
 * toward left". Direction names where it's blowing *toward*.
 */
export function windLabel(weather: Weather): string {
  const mph = Math.round(windMph(weather));
  if (mph < 3) return 'Calm';
  const { x, y } = weather.wind;
  const heading = Math.atan2(x, y); // 0 = out to centre, +/-PI = in from centre
  const abs = Math.abs(heading);
  const side = x < 0 ? 'left' : 'right';
  let where: string;
  if (abs < Math.PI / 8) where = 'out to center';
  else if (abs < (3 * Math.PI) / 8) where = `out to ${side}`;
  else if (abs < (5 * Math.PI) / 8) where = `across to ${side}`;
  else if (abs < (7 * Math.PI) / 8) where = `in from ${side}`;
  else where = 'in from center';
  return `${mph} mph ${where}`;
}

export function skyLabel(weather: Weather): string {
  switch (weather.sky) {
    case 'clear':
      return 'Clear';
    case 'overcast':
      return 'Overcast';
    case 'rain':
      return 'Rain';
    case 'storm':
      return 'Storm';
  }
}

/** One-line forecast for the scoreboard and the clubhouse. */
export function describeWeather(weather: Weather): string {
  const wind = windLabel(weather);
  return wind === 'Calm' ? `${skyLabel(weather)}, calm` : `${skyLabel(weather)}, wind ${wind}`;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
