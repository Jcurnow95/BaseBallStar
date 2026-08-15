import type { AttributeKey, Attributes, BattingStats, PlayerProfile } from './types';
import { LEVELS } from './league';
import { clamp } from './rng';
import { overallRating } from './player';

export const xpForLevel = (level: number): number => 120 + (level - 1) * 65;

export interface LevelUpReport {
  levelsGained: number;
  pointsGained: number;
}

export function grantXp(player: PlayerProfile, amount: number): LevelUpReport {
  player.xp += Math.max(0, Math.round(amount));
  let levelsGained = 0;
  let pointsGained = 0;

  while (player.xp >= xpForLevel(player.level)) {
    player.xp -= xpForLevel(player.level);
    player.level++;
    levelsGained++;
    // Every level gives 3 points, with a bonus every 5th. At 2 a season of
    // work moved your overall by about four points, which is not a career arc.
    const points = 3 + (player.level % 5 === 0 ? 2 : 0);
    player.attributePoints += points;
    pointsGained += points;
  }

  return { levelsGained, pointsGained };
}

/**
 * Attribute points needed for the next +1. Later points cost more, but the
 * old curve doubled at 50 — right where a second-season player was — so
 * development stalled exactly when the league was getting harder.
 */
export function upgradeCost(current: number): number {
  if (current < 60) return 1;
  if (current < 80) return 2;
  return 3;
}

export function canUpgrade(player: PlayerProfile, key: AttributeKey): boolean {
  const current = player.attributes[key];
  return current < 99 && player.attributePoints >= upgradeCost(current);
}

export function upgradeAttribute(player: PlayerProfile, key: AttributeKey): boolean {
  if (!canUpgrade(player, key)) return false;
  player.attributePoints -= upgradeCost(player.attributes[key]);
  player.attributes[key] = clamp(player.attributes[key] + 1, 5, 99);
  return true;
}

/* ------------------------------------------------------ perfect hit zone */

/**
 * Combined Contact + Vision needed before the ideal contact point is drawn on
 * the incoming ball. Contact is the size of the window and Vision is how well
 * you pick the ball up, so needing both is what the aid represents: you can
 * only aim at what you can actually see and cover.
 */
export const PERFECT_ZONE_THRESHOLD = 120;

export const perfectZoneProgress = (attributes: Attributes): number =>
  clamp(attributes.contact, 1, 99) + clamp(attributes.vision, 1, 99);

export const hasPerfectZone = (attributes: Attributes): boolean =>
  perfectZoneProgress(attributes) >= PERFECT_ZONE_THRESHOLD;

/* -------------------------------------------------------------- training */

export interface TrainingOption {
  id: string;
  name: string;
  detail: string;
  energyCost: number;
  staminaDelta: number;
  xp: number;
}

export const TRAINING_OPTIONS: TrainingOption[] = [
  {
    id: 'bp',
    name: 'Batting Practice',
    detail: 'Hack away in the cage. Best XP, wears you down.',
    energyCost: 35,
    staminaDelta: -7,
    xp: 55,
  },
  {
    id: 'film',
    name: 'Film Study',
    detail: 'Break down the next arm you face. Easy on the body.',
    energyCost: 20,
    staminaDelta: -2,
    xp: 34,
  },
  {
    id: 'fielding',
    name: 'Fielding Drills',
    detail: 'Ground balls until your hands hurt.',
    energyCost: 30,
    staminaDelta: -5,
    xp: 42,
  },
  {
    id: 'conditioning',
    name: 'Conditioning',
    detail: 'Build the tank back up. Pays off in late innings.',
    energyCost: 40,
    staminaDelta: 18,
    xp: 22,
  },
  {
    id: 'rest',
    name: 'Rest Day',
    detail: 'Nothing but recovery. Eats most of the day, but rebuilds the tank fastest.',
    energyCost: 60,
    staminaDelta: 30,
    xp: 0,
  },
];

/**
 * Energy only ever goes down during a day; the overnight roll is the one thing
 * that puts it back. Rest used to cost nothing and set energy back to 100,
 * which meant `bp, bp, film, rest` looped forever on a single off day for
 * unbounded XP and levels.
 */
export function applyTraining(player: PlayerProfile, option: TrainingOption): LevelUpReport | null {
  if (player.energy < option.energyCost) return null;
  player.energy = clamp(player.energy - option.energyCost, 0, 100);
  player.stamina = clamp(player.stamina + option.staminaDelta, 0, 100);
  return grantXp(player, option.xp);
}

/**
 * Called when a day ends. A night's sleep used to give back 4 stamina against
 * the 6-10 a game takes, so conditioning was the only thing holding the season
 * up and a player drifted down to the 40s by August and stayed there. Sleeping
 * now roughly covers an ordinary game, and the schedule is the thing that
 * grinds you down rather than arithmetic.
 */
export function recoverOvernight(player: PlayerProfile): void {
  player.energy = clamp(player.energy + 55, 0, 100);
  player.stamina = clamp(player.stamina + 9, 0, 100);
}

/* ------------------------------------------------------------- promotion */

/**
 * 0-100 rating of a season at the plate. Roughly OPS-driven, with a floor for
 * small samples so one hot game doesn't read as a call-up-worthy season.
 */
export function seasonScore(stats: BattingStats): number {
  if (stats.pa < 10) return 0;
  const avg = stats.ab > 0 ? stats.hits / stats.ab : 0;
  const obp = stats.ab + stats.walks > 0 ? (stats.hits + stats.walks) / (stats.ab + stats.walks) : 0;
  const tb = stats.singles + stats.doubles * 2 + stats.triples * 3 + stats.homeRuns * 4;
  const slg = stats.ab > 0 ? tb / stats.ab : 0;
  const ops = obp + slg;

  // .700 OPS ~ 52, .820 ~ 68, .900 ~ 78, 1.000 ~ 91. The old curve started
  // from .400 at a flatter slope, which graded a genuinely good year in the
  // 50s and made the call-up bar unreachable at every level.
  const base = clamp((ops - 0.3) * 130, 0, 100);
  const contactBonus = clamp((avg - 0.24) * 60, -10, 12);
  const kPenalty = clamp((stats.strikeouts / stats.pa - 0.28) * -45, -12, 6);
  return Math.round(clamp(base + contactBonus + kPenalty, 0, 100));
}

export interface PromotionCheck {
  promoted: boolean;
  nextLevelId: number;
  score: number;
  overall: number;
  reason: string;
}

export function checkPromotion(player: PlayerProfile, levelId: number): PromotionCheck {
  const level = LEVELS[levelId];
  const score = seasonScore(player.season);
  const overall = overallRating(player.attributes);
  const atTop = levelId >= LEVELS.length - 1;

  if (atTop) {
    return {
      promoted: false,
      nextLevelId: levelId,
      score,
      overall,
      reason: 'You are already in The Show. Now stay there.',
    };
  }

  const overallOk = overall >= level.promotionOverall;
  const scoreOk = score >= level.promotionScore;

  if (overallOk && scoreOk) {
    return {
      promoted: true,
      nextLevelId: levelId + 1,
      score,
      overall,
      reason: `The organization has seen enough. You're headed to ${LEVELS[levelId + 1].name}.`,
    };
  }

  const missing: string[] = [];
  if (!overallOk) missing.push(`an overall of ${level.promotionOverall} (you're at ${overall})`);
  if (!scoreOk) missing.push(`a season grade of ${level.promotionScore} (you posted ${score})`);

  return {
    promoted: false,
    nextLevelId: levelId,
    score,
    overall,
    reason: `You're back for another year at ${level.name}. Front office wants ${missing.join(' and ')}.`,
  };
}

/** XP earned from a single game, based on what the player actually did. */
export function gameXp(game: BattingStats, fieldingPutouts: number): number {
  return (
    game.singles * 12 +
    game.doubles * 20 +
    game.triples * 28 +
    game.homeRuns * 40 +
    game.walks * 8 +
    game.rbi * 6 +
    game.stolenBases * 8 +
    fieldingPutouts * 7 +
    18 // showing up
  );
}
