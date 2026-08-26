import type { Pitch, PitchDefinition, PitchType } from './types';
import { Rng, clamp } from './rng';

/**
 * Pitch arsenal. `duration` is the visual flight time — the whole difficulty
 * curve hangs off it, since a shorter flight gives the player less time to
 * read location and start the tap.
 */
export const PITCHES: Record<PitchType, PitchDefinition> = {
  fastball: {
    type: 'fastball',
    label: '4-Seam',
    duration: 860,
    breakX: 0.05,
    breakY: -0.08,
    breakSharpness: 2.2,
  },
  sinker: {
    type: 'sinker',
    label: 'Sinker',
    duration: 900,
    breakX: 0.34,
    breakY: 0.42,
    breakSharpness: 2.6,
  },
  slider: {
    type: 'slider',
    label: 'Slider',
    duration: 985,
    breakX: -0.72,
    breakY: 0.3,
    breakSharpness: 3.4,
  },
  curveball: {
    type: 'curveball',
    label: 'Curveball',
    duration: 1130,
    breakX: -0.25,
    breakY: 0.95,
    breakSharpness: 3.8,
  },
  changeup: {
    type: 'changeup',
    label: 'Changeup',
    duration: 1075,
    breakX: 0.3,
    breakY: 0.5,
    breakSharpness: 3.0,
  },
};

const ALL_TYPES = Object.keys(PITCHES) as PitchType[];

/**
 * Radar-gun base speeds, mph, at a rating of zero. Purely cosmetic — the
 * difficulty curve lives in `duration` — but the number on the history dot
 * should read like the pitch it labels.
 */
const BASE_MPH: Record<PitchType, number> = {
  fastball: 88,
  sinker: 87,
  slider: 81,
  changeup: 78,
  curveball: 72,
};

export interface PitcherAI {
  /** 0-100. Drives velocity, command, and how often they nibble. */
  rating: number;
  name: string;
}

export interface Count {
  balls: number;
  strikes: number;
}

/**
 * Where the ball appears to be headed at release, before break. The renderer
 * draws the flight from here, so a slider that starts on the black and sweeps
 * off the plate genuinely looks hittable until it isn't.
 */
function releasePoint(plateX: number, plateY: number, def: PitchDefinition) {
  return {
    releaseX: plateX - def.breakX,
    releaseY: plateY - def.breakY,
  };
}

export function throwPitch(
  pitcher: PitcherAI,
  count: Count,
  rng: Rng,
  opts?: { groove?: boolean },
): Pitch {
  const skill = pitcher.rating / 100;
  const groove = opts?.groove ?? false;

  // Better pitchers throw more secondary stuff; low-level arms live on the fastball.
  const secondaryChance = 0.28 + skill * 0.34;
  const type: PitchType =
    !groove && rng.chance(secondaryChance)
      ? rng.pick(ALL_TYPES.filter((t) => t !== 'fastball'))
      : 'fastball';
  const def = PITCHES[type];

  // Ahead in the count, expand the zone and try to get the hitter to chase.
  // Behind, they have to come back over the plate.
  const ahead = count.strikes - count.balls;
  const chaseChance = clamp(0.22 + ahead * 0.13 + skill * 0.14, 0.04, 0.62);
  const wantsChase = !groove && rng.chance(chaseChance) && count.strikes < 3;

  // Command: high-rated pitchers miss their spot less. The gap between a
  // Single-A arm and a big-league one is mostly here — a bad pitcher should be
  // genuinely wild, so a patient hitter can walk his way on early in a career
  // and the climb is about facing arms that stop giving you anything.
  const commandError = 0.3 + (1 - skill) * 0.52;

  let plateX: number;
  let plateY: number;

  if (groove) {
    // Derby grooving: a fastball over the heart of the plate, every time. The
    // scatter keeps taps from becoming muscle memory but never leaves the
    // middle third, so every pitch is one you can hit out.
    plateX = rng.range(-0.4, 0.4);
    plateY = rng.range(-0.35, 0.35);
  } else if (wantsChase) {
    // Aim just off a corner.
    const side = rng.chance(0.5) ? -1 : 1;
    if (rng.chance(0.55)) {
      plateX = side * rng.range(1.1, 1.6);
      plateY = rng.range(-0.9, 0.9);
    } else {
      plateX = rng.range(-0.9, 0.9);
      plateY = (rng.chance(0.6) ? 1 : -1) * rng.range(1.1, 1.6);
    }
  } else {
    // Aim at an edge of the zone rather than the middle, then miss by command.
    const aimX = rng.pick([-0.66, -0.66, 0, 0.66, 0.66]);
    const aimY = rng.pick([-0.62, -0.62, 0, 0.62, 0.62]);
    plateX = aimX + rng.gaussian() * commandError;
    plateY = aimY + rng.gaussian() * commandError;
  }

  plateX = clamp(plateX, -1.85, 1.85);
  plateY = clamp(plateY, -1.85, 1.85);

  // Velocity and movement both scale with pitcher rating. This is the main
  // difficulty curve of the whole game: a Majors arm gives the hitter roughly
  // 200ms less to place the tap, and breaks noticeably harder doing it.
  const duration = def.duration - skill * 300 + rng.range(-25, 25);
  const movement = 0.7 + skill * 0.85;

  const tuned: PitchDefinition = {
    ...def,
    duration,
    breakX: def.breakX * movement,
    breakY: def.breakY * movement,
  };
  const { releaseX, releaseY } = releasePoint(plateX, plateY, tuned);

  return {
    def: tuned,
    releaseX,
    releaseY,
    plateX,
    plateY,
    isStrike: Math.abs(plateX) <= 1 && Math.abs(plateY) <= 1,
    mph: Math.round(BASE_MPH[type] + skill * 9 + rng.range(-1.5, 1.5)),
  };
}

/**
 * What the hitter can read out of the hand. High vision reveals the real pitch
 * early; low vision guesses, and sometimes guesses wrong — which is the whole
 * point of the Vision attribute.
 */
export function readPitch(pitch: Pitch, vision: number, rng: Rng): string {
  const accuracy = clamp(vision / 100, 0, 1);
  if (rng.chance(0.25 + accuracy * 0.7)) return pitch.def.label;
  if (rng.chance(0.5)) return PITCHES[rng.pick(ALL_TYPES)].label;
  return '???';
}
