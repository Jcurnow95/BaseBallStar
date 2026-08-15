import type { Position } from './types';

/**
 * Field coordinates, in feet, with home plate at the origin.
 *
 *   +y runs from home plate out to straightaway center field
 *   +x runs toward the right-field line, -x toward left
 *   z  is height off the ground
 *
 * The foul lines sit at 45 degrees either side of +y, so a ball is fair
 * exactly when |x| <= y.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export const BASE_DISTANCE = 90;
/** Each leg of the diamond projected onto an axis: 90 / sqrt(2). */
export const BASE_LEG = BASE_DISTANCE / Math.SQRT2;

/** 0 = home, 1 = first, 2 = second, 3 = third. 4 is used to mean "scored". */
export type BaseId = 0 | 1 | 2 | 3;

export const BASES: readonly Vec2[] = [
  { x: 0, y: 0 },
  { x: BASE_LEG, y: BASE_LEG },
  { x: 0, y: BASE_LEG * 2 },
  { x: -BASE_LEG, y: BASE_LEG },
];

export const MOUND: Vec2 = { x: 0, y: 60.5 };

export type PositionId = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF';

export const ALL_POSITIONS: readonly PositionId[] = [
  'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF',
];

/** Where each fielder stands before the pitch. */
export const FIELDER_HOME: Record<PositionId, Vec2> = {
  P: { x: 0, y: 60.5 },
  C: { x: 0, y: -6 },
  '1B': { x: 68, y: 80 },
  '2B': { x: 40, y: 132 },
  SS: { x: -40, y: 132 },
  '3B': { x: -68, y: 80 },
  LF: { x: -150, y: 250 },
  CF: { x: 0, y: 300 },
  RF: { x: 150, y: 250 },
};

/** The player's chosen position maps straight through; the demo has no DH. */
export function toPositionId(position: Position): PositionId {
  return position as PositionId;
}

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export const magnitude = (v: Vec2): number => Math.hypot(v.x, v.y);

/** Fair territory is the 90-degree wedge between the foul lines. */
export function isFair(p: Vec2): boolean {
  return p.y > 0 && Math.abs(p.x) <= p.y;
}

/** Which fielder covers a base on a throw. */
export function coveringPosition(base: BaseId, fielderWithBall: PositionId | null): PositionId {
  switch (base) {
    case 0:
      return 'C';
    case 1:
      return fielderWithBall === '1B' ? '2B' : '1B';
    case 2:
      // Middle infielders share the bag; whoever isn't chasing the ball takes it.
      return fielderWithBall === 'SS' ? '2B' : 'SS';
    case 3:
      return '3B';
  }
}

export const BASE_NAMES = ['Home', 'First', 'Second', 'Third'] as const;

/** Baserunning targets, indexed 0-4 where 4 means crossing the plate. */
export const BASE_LABELS = ['HOME', 'FIRST', 'SECOND', 'THIRD', 'HOME'] as const;

/** Position along the basepath between two bases. */
export function basePathPoint(from: BaseId, to: number, progress: number): Vec2 {
  const a = BASES[from];
  const b = BASES[to % 4];
  return { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress };
}

/** Rough outfield/infield split, used for baserunning decisions. */
export function isOutfield(p: Vec2): boolean {
  return magnitude(p) > 165;
}
