/**
 * Shared domain types. Kept DOM-free so the whole `core/` folder can be
 * ported to Rust/WASM later without touching the rendering layer.
 */

import type { ContractStyle, GearLocker } from './gear';

export type AttributeKey =
  | 'power'
  | 'contact'
  | 'vision'
  | 'speed'
  | 'fielding'
  | 'arm';

export type Attributes = Record<AttributeKey, number>;

export type Handedness = 'R' | 'L';

export type Position = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF';

export interface BattingStats {
  pa: number;
  ab: number;
  hits: number;
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  rbi: number;
  runs: number;
  walks: number;
  strikeouts: number;
  stolenBases: number;
}

export interface FieldingStats {
  chances: number;
  putouts: number;
  errors: number;
}

export interface PlayerProfile {
  name: string;
  position: Position;
  bats: Handedness;
  archetype: string;
  /** Base attributes, before equipment. See `core/gear.ts`. */
  attributes: Attributes;
  /** Dollars in the bank, spent in the gear store. */
  money: number;
  /** The deal being paid out, which sets salary against performance bonuses. */
  contract: ContractStyle;
  /** Equipped gear, at most one item per slot. */
  gear: GearLocker;
  /** Long-term conditioning. Drains across a season, restored by rest. */
  stamina: number;
  /** Per-day resource spent on training. */
  energy: number;
  level: number;
  xp: number;
  attributePoints: number;
  season: BattingStats;
  career: BattingStats;
  fielding: FieldingStats;
}

/* ---------------------------------------------------------------- pitching */

export type PitchType = 'fastball' | 'sinker' | 'slider' | 'curveball' | 'changeup';

export interface PitchDefinition {
  type: PitchType;
  label: string;
  /** Milliseconds from release to crossing the plate. */
  duration: number;
  /** Late horizontal break, in strike-zone half-widths. */
  breakX: number;
  /** Late vertical break, in strike-zone half-heights. Positive drops. */
  breakY: number;
  /** How sharply the break arrives (higher = later, more deceptive). */
  breakSharpness: number;
}

/**
 * A thrown pitch. Locations are in strike-zone units where (0,0) is dead
 * center of the zone and +/-1 is the edge, so a pitch is a strike when both
 * |x| <= 1 and |y| <= 1.
 */
export interface Pitch {
  def: PitchDefinition;
  /** Where the ball starts, visually, out of the pitcher's hand. */
  releaseX: number;
  releaseY: number;
  /** Final location at the plate, after break. */
  plateX: number;
  plateY: number;
  isStrike: boolean;
  /** Radar-gun speed, mph. Cosmetic — flight time is `def.duration`. */
  mph: number;
}

/* ----------------------------------------------------------------- contact */

export type ContactQuality =
  | 'barrel'
  | 'solid'
  | 'flare'
  | 'weak'
  | 'mishit'
  | 'whiff';

export interface SwingInput {
  /** Horizontal tap offset from ball center, in ball radii. */
  offsetX: number;
  /** Vertical tap offset from ball center, in ball radii. Positive = under. */
  offsetY: number;
  /** Fraction of the pitch flight elapsed when the tap landed. 1.0 = at plate. */
  timing: number;
}

export interface BattedBall {
  quality: ContactQuality;
  /** Exit velocity, mph. */
  exitVelocity: number;
  /** Launch angle, degrees. */
  launchAngle: number;
  /** -1 = extreme pull, 0 = center, +1 = extreme opposite field. */
  spray: number;
  /**
   * Sidespin, -1..1, signed like `spray`: negative bends the ball toward left
   * field, positive toward right. Comes from catching the ball off its centre.
   * Absent on simulated (non-player) batted balls, which fly straight.
   */
  sideSpin?: number;
}

export type PlayResult =
  | 'strike'
  | 'ball'
  | 'foul'
  | 'strikeout'
  | 'walk'
  | 'single'
  | 'double'
  | 'triple'
  | 'homeRun'
  | 'groundout'
  | 'flyout'
  | 'lineout'
  | 'popout';

export interface AtBatOutcome {
  result: PlayResult;
  /** Play-by-play line shown to the player. */
  description: string;
  battedBall?: BattedBall;
  /** Ends the plate appearance. */
  terminal: boolean;
  basesAdvanced: number;
}
