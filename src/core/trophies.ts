/**
 * The trophy case. An MVP is the one thing a season votes on, but a career is
 * mostly made of afternoons nobody votes on at all — the ball you hit with the
 * bases loaded, the one that ended a game in the bottom of the ninth, the
 * hundredth hit that arrived on a Tuesday. This file names those and keeps
 * them.
 *
 * Two rules shape everything here:
 *
 * 1. A trophy is checked once and kept forever. Nothing in this file
 *    re-evaluates a locked trophy against old stats — a season that was
 *    already banked can never retroactively earn or lose one. That's why the
 *    unlock record carries the year and level it happened at: it's history,
 *    not a derived view of the current save.
 *
 * 2. Every test reads a snapshot the caller assembles, never the sim. The
 *    moments that need base state and the clock (a slam, a walk-off) are
 *    spotted by `gameSim` while the game is live and handed over as flags;
 *    everything else falls out of the season and career lines that already
 *    exist. Nothing here knows what a `GameSim` is.
 *
 * Thresholds are tuned for a 24-game season, not a 162-game one. `SEASON_GAMES`
 * is short on purpose, so a season is roughly a hundred plate appearances: five
 * home runs is a real power year here and forty would be unreachable. If the
 * schedule ever lengthens, the season tier below is the part that has to move.
 */
import type { BattingStats, PlayerProfile } from './types';

/** Where a trophy sits in the case, which is also how it's grouped. */
export type TrophyTier = 'moment' | 'season' | 'career' | 'honor';

export interface Trophy {
  id: string;
  name: string;
  /** Shown on the tile. One emoji, so it renders the same everywhere. */
  icon: string;
  /** What it takes, in the words the trophy room shows before you have it. */
  blurb: string;
  tier: TrophyTier;
  /**
   * True for one that can only ever fire once in a career and is worth calling
   * out loudly when it does. Purely presentational.
   */
  headline?: boolean;
  test: (ctx: TrophyContext) => boolean;
}

/** One earned trophy, stamped with when and where. */
export interface UnlockedTrophy {
  id: string;
  seasonYear: number;
  levelId: number;
}

/**
 * The single-game moments that can't be read off a box score, because they're
 * facts about the base state and the scoreboard clock at the moment of the
 * swing. `GameSim` fills these in as the game runs.
 */
export interface GameFeats {
  /** Left the yard with all three bases occupied. */
  grandSlam: boolean;
  /** Drove in the run that ended the game, batting last. */
  walkOff: boolean;
  /** ...and did it with the ball in the seats. */
  walkOffHomeRun: boolean;
  /** Circled the bases without the ball leaving the park. */
  insideThePark: boolean;
  /** Most runs driven in on a single swing. */
  bestRbiPa: number;
  /** Tied the game or took the lead from the seventh inning on. */
  clutchHit: boolean;
}

export function emptyGameFeats(): GameFeats {
  return {
    grandSlam: false,
    walkOff: false,
    walkOffHomeRun: false,
    insideThePark: false,
    bestRbiPa: 0,
    clutchHit: false,
  };
}

/** The game just finished, as the trophy tests want to read it. */
export interface GameCheck {
  /** The player's line for that game alone. */
  stats: BattingStats;
  feats: GameFeats;
  putouts: number;
  errors: number;
  win: boolean;
  /** True when the game was a postseason game. */
  playoff: boolean;
}

/** What a season ended in, checked on awards night rather than after a game. */
export interface HonorCheck {
  champion: boolean;
  mvp: boolean;
  /** True when the front office is sending you up a level. */
  promoted: boolean;
  /** The level being promoted *to*, so "reached the majors" can fire early. */
  nextLevelId: number;
}

/**
 * Everything a test may look at. `player` is the live profile, so `season` and
 * `career` already include the game in `game` — the callers fold the box score
 * in before checking, which is what makes "your 100th career hit" fire on the
 * game it actually happened in.
 */
export interface TrophyContext {
  player: PlayerProfile;
  levelId: number;
  seasonYear: number;
  game?: GameCheck;
  honors?: HonorCheck;
}

/** The top level of the organization — see `LEVELS` in `core/league.ts`. */
const MAJORS_LEVEL_ID = 3;

/**
 * At-bats a season needs before a rate stat is allowed to win anything. A
 * 24-game season is about 85 at-bats, so this is most of a year: enough that
 * a .400 average means a .400 season and not one hot week in April.
 */
const RATE_MIN_AB = 60;

/** Shorthand for the tests, which are otherwise a wall of optional chaining. */
const g = (ctx: TrophyContext): GameCheck | undefined => ctx.game;

/** Season average as a number, since `battingAverage` returns the printed form. */
const seasonAvg = (s: BattingStats): number => (s.ab === 0 ? 0 : s.hits / s.ab);

/**
 * The case itself, in the order it's displayed. Ordering inside a tier is
 * roughly by how hard it is, so the early rows of the trophy room are the ones
 * a new career is actually chasing.
 */
export const TROPHIES: Trophy[] = [
  /* ------------------------------------------------------------- moments */
  {
    id: 'first-hit',
    name: 'First Hit',
    icon: '🥎',
    blurb: 'Get your first career base hit.',
    tier: 'moment',
    headline: true,
    test: (c) => c.player.career.hits >= 1,
  },
  {
    id: 'first-homer',
    name: 'First Home Run',
    icon: '⚾',
    blurb: 'Hit your first career home run.',
    tier: 'moment',
    headline: true,
    test: (c) => c.player.career.homeRuns >= 1,
  },
  {
    id: 'grand-slam',
    name: 'Grand Slam',
    icon: '💥',
    blurb: 'Homer with the bases loaded.',
    tier: 'moment',
    headline: true,
    test: (c) => g(c)?.feats.grandSlam === true,
  },
  {
    id: 'walk-off',
    name: 'Walk-Off',
    icon: '🎉',
    blurb: 'Drive in the winning run in the bottom of the ninth or later.',
    tier: 'moment',
    headline: true,
    test: (c) => g(c)?.feats.walkOff === true,
  },
  {
    id: 'walk-off-homer',
    name: 'Walk-Off Homer',
    icon: '🎆',
    blurb: 'End a game with a home run in your last at-bat.',
    tier: 'moment',
    headline: true,
    test: (c) => g(c)?.feats.walkOffHomeRun === true,
  },
  {
    id: 'inside-the-park',
    name: 'Inside the Park',
    icon: '🏃',
    blurb: 'Score on your own batted ball without it leaving the yard.',
    tier: 'moment',
    headline: true,
    test: (c) => g(c)?.feats.insideThePark === true,
  },
  {
    id: 'clutch',
    name: 'Ice Water',
    icon: '🧊',
    blurb: 'Tie the game or take the lead from the seventh inning on.',
    tier: 'moment',
    test: (c) => g(c)?.feats.clutchHit === true,
  },
  {
    id: 'multi-homer',
    name: 'Two-Homer Game',
    icon: '✌️',
    blurb: 'Hit two home runs in one game.',
    tier: 'moment',
    test: (c) => (g(c)?.stats.homeRuns ?? 0) >= 2,
  },
  {
    id: 'three-homer',
    name: 'Three-Homer Game',
    icon: '🔥',
    blurb: 'Hit three home runs in one game.',
    tier: 'moment',
    headline: true,
    test: (c) => (g(c)?.stats.homeRuns ?? 0) >= 3,
  },
  {
    id: 'cycle',
    name: 'The Cycle',
    icon: '🔄',
    blurb: 'Single, double, triple and home run — all in one game.',
    tier: 'moment',
    headline: true,
    test: (c) => {
      const s = g(c)?.stats;
      return (
        !!s && s.singles >= 1 && s.doubles >= 1 && s.triples >= 1 && s.homeRuns >= 1
      );
    },
  },
  {
    id: 'four-hit-game',
    name: 'Four-Hit Game',
    icon: '🎯',
    blurb: 'Collect four hits in one game.',
    tier: 'moment',
    test: (c) => (g(c)?.stats.hits ?? 0) >= 4,
  },
  {
    id: 'perfect-day',
    name: 'Perfect Day',
    icon: '💯',
    blurb: 'Reach base in every plate appearance, at least four of them.',
    tier: 'moment',
    test: (c) => {
      const s = g(c)?.stats;
      // Reaching on an error is an at-bat and not a hit, so this asks for the
      // clean version: a hit or a walk every time up.
      return !!s && s.pa >= 4 && s.hits + s.walks === s.pa;
    },
  },
  {
    id: 'five-rbi',
    name: 'Five-RBI Game',
    icon: '🧨',
    blurb: 'Drive in five runs in one game.',
    tier: 'moment',
    test: (c) => (g(c)?.stats.rbi ?? 0) >= 5,
  },
  {
    id: 'leather',
    name: 'Flashing Leather',
    icon: '🧤',
    blurb: 'Record three putouts in a game without an error.',
    tier: 'moment',
    test: (c) => {
      const gc = g(c);
      return !!gc && gc.putouts >= 3 && gc.errors === 0;
    },
  },
  {
    id: 'october-homer',
    name: 'October Power',
    icon: '🍂',
    blurb: 'Hit a home run in a playoff game.',
    tier: 'moment',
    test: (c) => {
      const gc = g(c);
      return !!gc && gc.playoff && gc.stats.homeRuns >= 1;
    },
  },

  /* -------------------------------------------------------------- season */
  {
    id: 'season-hr-3',
    name: 'Power Surge',
    icon: '💪',
    blurb: 'Hit 3 home runs in a season.',
    tier: 'season',
    test: (c) => c.player.season.homeRuns >= 3,
  },
  {
    id: 'season-hr-6',
    name: 'Bopper',
    icon: '🚀',
    blurb: 'Hit 6 home runs in a season.',
    tier: 'season',
    test: (c) => c.player.season.homeRuns >= 6,
  },
  {
    id: 'season-hr-10',
    name: 'Home Run King',
    icon: '👑',
    blurb: 'Hit 10 home runs in a season.',
    tier: 'season',
    headline: true,
    test: (c) => c.player.season.homeRuns >= 10,
  },
  {
    id: 'season-rbi-20',
    name: 'Run Producer',
    icon: '🏭',
    blurb: 'Drive in 20 runs in a season.',
    tier: 'season',
    test: (c) => c.player.season.rbi >= 20,
  },
  {
    id: 'season-avg-350',
    name: 'Batting Title Form',
    icon: '📈',
    blurb: `Hit .350 or better over a season (min ${RATE_MIN_AB} AB).`,
    tier: 'season',
    test: (c) => c.player.season.ab >= RATE_MIN_AB && seasonAvg(c.player.season) >= 0.35,
  },
  {
    id: 'season-avg-400',
    name: 'The Four Hundred Club',
    icon: '🎖️',
    blurb: `Hit .400 or better over a season (min ${RATE_MIN_AB} AB).`,
    tier: 'season',
    headline: true,
    test: (c) => c.player.season.ab >= RATE_MIN_AB && seasonAvg(c.player.season) >= 0.4,
  },
  {
    id: 'season-hits-30',
    name: 'Hit Machine',
    icon: '🔨',
    blurb: 'Collect 30 hits in a season.',
    tier: 'season',
    test: (c) => c.player.season.hits >= 30,
  },
  {
    id: 'season-eye',
    name: 'Good Eye',
    icon: '👁️',
    blurb: 'Draw 12 walks in a season.',
    tier: 'season',
    test: (c) => c.player.season.walks >= 12,
  },

  /* -------------------------------------------------------------- career */
  {
    id: 'career-hits-100',
    name: '100 Hits',
    icon: '💼',
    blurb: 'Reach 100 career hits.',
    tier: 'career',
    test: (c) => c.player.career.hits >= 100,
  },
  {
    id: 'career-hits-250',
    name: '250 Hits',
    icon: '📚',
    blurb: 'Reach 250 career hits.',
    tier: 'career',
    test: (c) => c.player.career.hits >= 250,
  },
  {
    id: 'career-hits-500',
    name: '500 Hits',
    icon: '🏛️',
    blurb: 'Reach 500 career hits.',
    tier: 'career',
    headline: true,
    test: (c) => c.player.career.hits >= 500,
  },
  {
    id: 'career-hr-10',
    name: '10 Home Runs',
    icon: '🎇',
    blurb: 'Reach 10 career home runs.',
    tier: 'career',
    test: (c) => c.player.career.homeRuns >= 10,
  },
  {
    id: 'career-hr-25',
    name: '25 Home Runs',
    icon: '🌟',
    blurb: 'Reach 25 career home runs.',
    tier: 'career',
    test: (c) => c.player.career.homeRuns >= 25,
  },
  {
    id: 'career-hr-50',
    name: '50 Home Runs',
    icon: '💫',
    blurb: 'Reach 50 career home runs.',
    tier: 'career',
    headline: true,
    test: (c) => c.player.career.homeRuns >= 50,
  },
  {
    id: 'career-rbi-150',
    name: '150 RBI',
    icon: '🧮',
    blurb: 'Drive in 150 runs across your career.',
    tier: 'career',
    test: (c) => c.player.career.rbi >= 150,
  },

  /* --------------------------------------------------------------- honors */
  {
    id: 'ring',
    name: 'Ring',
    icon: '💍',
    blurb: 'Win a league championship.',
    tier: 'honor',
    headline: true,
    test: (c) => c.honors?.champion === true,
  },
  {
    id: 'mvp',
    name: 'Most Valuable Player',
    icon: '🏆',
    blurb: 'Win a league MVP award.',
    tier: 'honor',
    headline: true,
    test: (c) => c.honors?.mvp === true,
  },
  {
    id: 'call-up',
    name: 'The Call',
    icon: '📞',
    blurb: 'Earn a promotion out of the level you started in.',
    tier: 'honor',
    headline: true,
    test: (c) => c.honors?.promoted === true,
  },
  {
    id: 'the-show',
    name: 'The Show',
    icon: '🌆',
    blurb: 'Reach the Majors.',
    tier: 'honor',
    headline: true,
    // Either already there, or being sent there tonight.
    test: (c) =>
      c.levelId >= MAJORS_LEVEL_ID ||
      (c.honors?.promoted === true && c.honors.nextLevelId >= MAJORS_LEVEL_ID),
  },
];

const BY_ID = new Map(TROPHIES.map((a) => [a.id, a]));

export function trophyById(id: string): Trophy | undefined {
  return BY_ID.get(id);
}

/** Human labels for the tier headings, in display order. */
export const TIER_LABEL: Record<TrophyTier, string> = {
  moment: 'Moments',
  season: 'Season',
  career: 'Career',
  honor: 'Honors',
};

export const TIER_ORDER: TrophyTier[] = ['moment', 'season', 'career', 'honor'];

/**
 * Test everything still locked and bank whatever just came true. Mutates
 * `unlocked` — the caller's save is the record — and returns only the ones
 * that fired on this call, which is what the postgame screen announces.
 *
 * Safe to call as often as you like: a trophy already in the list is
 * never re-tested, so a screen that renders twice can't double-award.
 */
export function checkTrophies(
  unlocked: UnlockedTrophy[],
  ctx: TrophyContext,
): Trophy[] {
  const have = new Set(unlocked.map((u) => u.id));
  const fresh: Trophy[] = [];

  for (const trophy of TROPHIES) {
    if (have.has(trophy.id)) continue;
    if (!trophy.test(ctx)) continue;
    unlocked.push({
      id: trophy.id,
      seasonYear: ctx.seasonYear,
      levelId: ctx.levelId,
    });
    fresh.push(trophy);
  }

  return fresh;
}

/** How full the case is, for the hub badge and the trophy room header. */
export function trophyProgress(unlocked: readonly UnlockedTrophy[]): {
  earned: number;
  total: number;
} {
  // Count against the live definitions, so an id dropped in a later build
  // can't push the count past the total.
  const earned = unlocked.filter((u) => BY_ID.has(u.id)).length;
  return { earned, total: TROPHIES.length };
}
