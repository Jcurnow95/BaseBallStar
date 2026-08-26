/**
 * Career achievements: one-time milestones that pay out attribute points.
 *
 * Nothing about being *met* is stored — every achievement is derived live from
 * career totals, the same way the swing unlocks in `progression.ts` are derived
 * from attributes. Only the *claim* is recorded (`player.achievements`), so the
 * points can't be collected twice.
 */

import type { PlayerProfile } from './types';

export interface AchievementDef {
  id: string;
  name: string;
  blurb: string;
  /** Attribute points paid out when the player claims it. */
  points: number;
  /** The career total being measured, read live off the profile. */
  progress: (player: PlayerProfile) => number;
  /** Where `progress` has to get to. */
  target: number;
}

export interface AchievementGroup {
  title: string;
  achievements: AchievementDef[];
}

/**
 * A tier of career milestones over one stat, e.g. 10 / 30 / 75 home runs.
 * Firsts live in their own group so they aren't drowned out by the grind.
 */
const tier = (
  idBase: string,
  name: (target: number) => string,
  blurb: (target: number) => string,
  progress: AchievementDef['progress'],
  steps: [target: number, points: number][],
): AchievementDef[] =>
  steps.map(([target, points]) => ({
    id: `${idBase}-${target}`,
    name: name(target),
    blurb: blurb(target),
    points,
    progress,
    target,
  }));

export const ACHIEVEMENT_GROUPS: AchievementGroup[] = [
  {
    title: 'Firsts',
    achievements: [
      {
        id: 'first-on-base',
        name: 'Aboard!',
        blurb: 'Reach base for the first time in your career.',
        points: 1,
        progress: (p) => p.career.hits + p.career.walks,
        target: 1,
      },
      {
        id: 'first-hit',
        name: 'Knock One Through',
        blurb: 'Collect your first career hit.',
        points: 1,
        progress: (p) => p.career.hits,
        target: 1,
      },
      {
        id: 'first-double',
        name: 'Stretch It',
        blurb: 'Leg out your first double.',
        points: 1,
        progress: (p) => p.career.doubles,
        target: 1,
      },
      {
        id: 'first-triple',
        name: 'Three-Bagger',
        blurb: 'Hit your first triple — the rarest hit in the book.',
        points: 2,
        progress: (p) => p.career.triples,
        target: 1,
      },
      {
        id: 'first-homer',
        name: 'Gone!',
        blurb: 'Put one over the fence.',
        points: 2,
        progress: (p) => p.career.homeRuns,
        target: 1,
      },
      {
        id: 'first-rbi',
        name: 'Run Producer',
        blurb: 'Drive in your first run.',
        points: 1,
        progress: (p) => p.career.rbi,
        target: 1,
      },
      {
        id: 'first-steal',
        name: 'Got a Jump',
        blurb: 'Swipe your first bag.',
        points: 1,
        progress: (p) => p.career.stolenBases,
        target: 1,
      },
    ],
  },
  {
    title: 'Hitting',
    achievements: [
      ...tier(
        'hits',
        (t) => `${t} Career Hits`,
        (t) => `Rack up ${t} hits across your career.`,
        (p) => p.career.hits,
        [
          [25, 2],
          [100, 3],
          [250, 4],
        ],
      ),
      ...tier(
        'doubles',
        (t) => `${t} Doubles`,
        (t) => `Split ${t} gaps in your career.`,
        (p) => p.career.doubles,
        [
          [10, 2],
          [30, 3],
        ],
      ),
      ...tier(
        'triples',
        (t) => `${t} Triples`,
        (t) => `Turn ${t} balls in the gap into three bases.`,
        (p) => p.career.triples,
        [
          [5, 2],
          [15, 3],
        ],
      ),
      ...tier(
        'walks',
        (t) => `${t} Walks`,
        (t) => `Work ${t} free passes in your career.`,
        (p) => p.career.walks,
        [[25, 2]],
      ),
    ],
  },
  {
    title: 'Power',
    achievements: tier(
      'homers',
      (t) => `${t} Home Runs`,
      (t) => `Clear the wall ${t} times in your career.`,
      (p) => p.career.homeRuns,
      [
        [10, 2],
        [30, 3],
        [75, 4],
      ],
    ),
  },
  {
    title: 'Producing',
    achievements: [
      ...tier(
        'rbi',
        (t) => `${t} Career RBI`,
        (t) => `Drive in ${t} runs across your career.`,
        (p) => p.career.rbi,
        [
          [25, 2],
          [100, 3],
        ],
      ),
      ...tier(
        'runs',
        (t) => `${t} Runs Scored`,
        (t) => `Cross the plate ${t} times in your career.`,
        (p) => p.career.runs,
        [
          [25, 2],
          [100, 3],
        ],
      ),
    ],
  },
  {
    title: 'Speed & Glove',
    achievements: [
      ...tier(
        'steals',
        (t) => `${t} Stolen Bases`,
        (t) => `Steal ${t} bases in your career.`,
        (p) => p.career.stolenBases,
        [
          [10, 2],
          [30, 3],
        ],
      ),
      ...tier(
        'putouts',
        (t) => `${t} Putouts`,
        (t) => `Record ${t} putouts in the field.`,
        (p) => p.fielding.putouts,
        [
          [50, 2],
          [150, 3],
        ],
      ),
    ],
  },
];

export const ACHIEVEMENTS: AchievementDef[] = ACHIEVEMENT_GROUPS.flatMap(
  (group) => group.achievements,
);

export function isAchievementMet(def: AchievementDef, player: PlayerProfile): boolean {
  return def.progress(player) >= def.target;
}

export function isAchievementClaimed(player: PlayerProfile, id: string): boolean {
  return player.achievements.includes(id);
}

/** Met but not yet claimed — what the clubhouse badge counts. */
export function unclaimedAchievements(player: PlayerProfile): AchievementDef[] {
  return ACHIEVEMENTS.filter(
    (def) => isAchievementMet(def, player) && !isAchievementClaimed(player, def.id),
  );
}

/**
 * Pay out an achievement. Returns the points granted, or null when there was
 * nothing to pay — unknown id, not met yet, or already claimed.
 */
export function claimAchievement(player: PlayerProfile, id: string): number | null {
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (!def) return null;
  if (isAchievementClaimed(player, id) || !isAchievementMet(def, player)) return null;
  player.achievements.push(id);
  player.attributePoints += def.points;
  return def.points;
}
