import type {
  AttributeKey,
  Attributes,
  BattingStats,
  Handedness,
  PlayerProfile,
  Position,
} from './types';
import type { ContractStyle } from './gear';
import { clamp } from './rng';

export const ATTRIBUTE_KEYS: AttributeKey[] = [
  'power',
  'contact',
  'vision',
  'speed',
  'fielding',
  'arm',
];

export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  power: 'Power',
  contact: 'Contact',
  vision: 'Vision',
  speed: 'Speed',
  fielding: 'Fielding',
  arm: 'Arm',
};

export const ATTRIBUTE_BLURBS: Record<AttributeKey, string> = {
  power: 'Exit velocity ceiling. Turns good contact into extra bases.',
  contact: 'Widens the sweet spot on the ball. The most forgiving stat.',
  vision: 'Reads pitch type out of the hand and holds the strike-zone view longer. At 65, tells you ball from strike.',
  speed: 'Beats out grounders, stretches gaps, steals bases.',
  fielding: 'Widens your glove window on catch events.',
  arm: 'Throw strength on fielding plays. Keeps runners honest.',
};

export interface Archetype {
  id: string;
  name: string;
  blurb: string;
  bonuses: Partial<Attributes>;
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'slugger',
    name: 'Slugger',
    blurb: 'Big swing, big misses. Live by the barrel.',
    bonuses: { power: 14, contact: -6, speed: -4 },
  },
  {
    id: 'contact',
    name: 'Pure Hitter',
    blurb: 'Hard to strike out. Sprays line drives everywhere.',
    bonuses: { contact: 12, vision: 6, power: -8 },
  },
  {
    id: 'speedster',
    name: 'Speedster',
    blurb: 'Legs out infield hits and wreaks havoc on the bases.',
    bonuses: { speed: 15, fielding: 5, power: -9 },
  },
  {
    id: 'twoway',
    name: 'Five-Tool Prospect',
    blurb: 'No weakness, no standout. Highest ceiling if you develop it.',
    bonuses: { power: 3, contact: 3, vision: 3, speed: 3, fielding: 3, arm: 3 },
  },
];

export const POSITIONS: Position[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

export const POSITION_LABELS: Record<Position, string> = {
  C: 'Catcher',
  '1B': 'First Base',
  '2B': 'Second Base',
  '3B': 'Third Base',
  SS: 'Shortstop',
  LF: 'Left Field',
  CF: 'Center Field',
  RF: 'Right Field',
};

export const emptyBattingStats = (): BattingStats => ({
  pa: 0,
  ab: 0,
  hits: 0,
  singles: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  rbi: 0,
  runs: 0,
  walks: 0,
  strikeouts: 0,
  stolenBases: 0,
});

const BASE_ATTRIBUTES: Attributes = {
  power: 34,
  contact: 36,
  vision: 33,
  speed: 35,
  fielding: 34,
  arm: 33,
};

export function createPlayer(
  name: string,
  position: Position,
  bats: Handedness,
  archetype: Archetype,
  contract: ContractStyle = 'standard',
): PlayerProfile {
  const attributes = { ...BASE_ATTRIBUTES };
  for (const key of ATTRIBUTE_KEYS) {
    attributes[key] = clamp(attributes[key] + (archetype.bonuses[key] ?? 0), 5, 99);
  }

  return {
    name,
    position,
    bats,
    archetype: archetype.name,
    attributes,
    // A signing cheque, so the store is worth a look before the first game.
    money: 500,
    contract,
    gear: {},
    stamina: 100,
    energy: 100,
    level: 1,
    xp: 0,
    attributePoints: 3,
    season: emptyBattingStats(),
    career: emptyBattingStats(),
    fielding: { chances: 0, putouts: 0, errors: 0 },
  };
}

/** Overall rating, the number scouts quote at you. */
export function overallRating(attributes: Attributes): number {
  const weighted =
    attributes.power * 0.24 +
    attributes.contact * 0.26 +
    attributes.vision * 0.18 +
    attributes.speed * 0.14 +
    attributes.fielding * 0.12 +
    attributes.arm * 0.06;
  return Math.round(weighted);
}

export function battingAverage(s: BattingStats): string {
  if (s.ab === 0) return '.000';
  return (s.hits / s.ab).toFixed(3).replace(/^0/, '');
}

export function onBasePct(s: BattingStats): string {
  const denom = s.ab + s.walks;
  if (denom === 0) return '.000';
  return ((s.hits + s.walks) / denom).toFixed(3).replace(/^0/, '');
}

export function slugging(s: BattingStats): string {
  if (s.ab === 0) return '.000';
  const tb = s.singles + s.doubles * 2 + s.triples * 3 + s.homeRuns * 4;
  return (tb / s.ab).toFixed(3).replace(/^0/, '');
}

export function addStats(target: BattingStats, delta: Partial<BattingStats>): void {
  for (const key of Object.keys(delta) as (keyof BattingStats)[]) {
    target[key] += delta[key] ?? 0;
  }
}
