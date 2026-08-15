import type { Vec2 } from './fieldGeometry';

/**
 * Ballparks. Real fields are not symmetrical arcs — they have short porches,
 * deep gaps, odd corners and walls of wildly different heights, and that shapes
 * how a park plays more than anything else.
 *
 * `fence` and `wallHeight` are sampled evenly from the left-field line (-45
 * degrees) round to the right-field line (+45), and interpolated between.
 */

export interface Ballpark {
  id: string;
  name: string;
  blurb: string;
  /** Distance to the wall, in feet, at each sample angle. */
  fence: number[];
  /** Wall height, in feet, at each sample angle. */
  wallHeight: number[];
}

const flatWall = (height: number, count = 9): number[] => new Array(count).fill(height);

export const BALLPARKS: Ballpark[] = [
  {
    id: 'riverside',
    name: 'Riverside Commons',
    blurb: 'Honest and symmetrical. Nothing cheap, nothing unfair.',
    //     LF line                 center                RF line
    fence: [330, 358, 382, 396, 400, 396, 382, 358, 330],
    wallHeight: flatWall(9),
  },
  {
    id: 'bandbox',
    name: 'The Bandbox',
    blurb: 'Tiny, and the walls are low. Fly balls leave in a hurry.',
    fence: [308, 330, 350, 362, 366, 362, 350, 330, 308],
    wallHeight: flatWall(7),
  },
  {
    id: 'cavern',
    name: 'Cavern Field',
    blurb: 'Enormous, with high walls. Where home runs go to die.',
    fence: [352, 384, 408, 420, 428, 420, 408, 384, 352],
    wallHeight: flatWall(14),
  },
  {
    id: 'notch',
    name: 'The Notch',
    blurb: 'A 302-foot porch in right, and a canyon in left-center.',
    fence: [340, 378, 406, 412, 404, 380, 344, 312, 302],
    wallHeight: [10, 10, 10, 10, 9, 8, 8, 8, 8],
  },
  {
    id: 'ironworks',
    name: 'Ironworks Park',
    blurb: 'A 36-foot wall in left turns home runs into loud singles.',
    fence: [312, 332, 368, 392, 398, 392, 372, 344, 326],
    wallHeight: [36, 34, 22, 10, 9, 9, 8, 8, 8],
  },
  {
    id: 'prairie',
    name: 'Prairie Yard',
    blurb: 'Short down the lines, but the gaps run forever.',
    fence: [318, 372, 410, 402, 392, 402, 410, 372, 318],
    wallHeight: flatWall(11),
  },
];

export const DEFAULT_PARK = BALLPARKS[0];

export function ballparkById(id: string): Ballpark {
  return BALLPARKS.find((p) => p.id === id) ?? DEFAULT_PARK;
}

/** Interpolate a per-angle sample array at the bearing of a point. */
function sampleAt(values: number[], p: Vec2): number {
  const angle = Math.atan2(p.x, Math.max(p.y, 0.001));
  // -45deg -> 0, +45deg -> 1
  const t = Math.min(1, Math.max(0, angle / (Math.PI / 2) + 0.5));
  const scaled = t * (values.length - 1);
  const low = Math.floor(scaled);
  const high = Math.min(values.length - 1, low + 1);
  const frac = scaled - low;
  return values[low] + (values[high] - values[low]) * frac;
}

export function fenceAt(park: Ballpark, p: Vec2): number {
  return sampleAt(park.fence, p);
}

export function wallHeightAt(park: Ballpark, p: Vec2): number {
  return sampleAt(park.wallHeight, p);
}

/** Deepest point in the park, for framing the field view. */
export function deepestPoint(park: Ballpark): number {
  return Math.max(...park.fence);
}
