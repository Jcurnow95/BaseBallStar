import type { Rng } from './rng';
import { clamp } from './rng';
import type { SaveData } from './save';
import {
  LEVELS,
  gamesPlayed,
  generateLeagueNames,
  regularSeasonGames,
  seasonGames,
  simulateGame,
  winningPct,
} from './league';
import { TEAM_KITS } from './uniforms';

/**
 * A club at a level the player isn't at. Just enough to keep a standings
 * table honest: no roster, no park, no schedule — those only exist where you
 * actually play.
 */
export interface FarmTeam {
  name: string;
  kitId: string;
  /** 20-80, same scale as `Team.strength`; drives simulated results. */
  strength: number;
  wins: number;
  losses: number;
  /** Games called level. Optional so saves from before ties were counted still load. */
  ties?: number;
  /** Runs scored. Optional so saves from before runs were counted still load. */
  runsFor?: number;
  /** Runs allowed. Optional so saves from before runs were counted still load. */
  runsAgainst?: number;
}

/** One level's standings, for the levels the player is only watching. */
export interface LevelTable {
  levelId: number;
  teams: FarmTeam[];
}

/**
 * How far a table has got: the fewest games any club has played. Clubs are
 * kept within a game of each other (see `playNext`), so this is the table's
 * count once the day's pairings are complete.
 */
const tableGames = (table: LevelTable): number =>
  table.teams.reduce((min, t) => Math.min(min, gamesPlayed(t)), Number.MAX_SAFE_INTEGER) || 0;

function createLevelTable(levelId: number, rng: Rng, taken: Set<string>): LevelTable {
  const kits = [...TEAM_KITS];
  const teams = generateLeagueNames(rng, taken, LEVELS[levelId].teams).map((name) => {
    taken.add(name);
    const kit = kits.splice(rng.int(0, kits.length - 1), 1)[0] ?? TEAM_KITS[0];
    return {
      name,
      kitId: kit.id,
      // Same spread as a real league: contenders and cellar-dwellers.
      strength: clamp(50 + rng.gaussian() * 14, 20, 80),
      wins: 0,
      losses: 0,
      ties: 0,
      runsFor: 0,
      runsAgainst: 0,
    };
  });
  return { levelId, teams };
}

/**
 * One more game: the two clubs with the fewest played, ties broken at
 * random, so a table with an odd number of clubs still ends the year with
 * everybody on the same count. Better clubs win more.
 */
function playNext(table: LevelTable, rng: Rng): void {
  if (table.teams.length < 2) return;
  const order = [...table.teams]
    .map((t) => ({ t, key: gamesPlayed(t) + rng.next() * 0.5 }))
    .sort((a, b) => a.key - b.key);
  simulateGame(order[0].t, order[1].t, rng);
}

/**
 * Bring the other levels' tables in line with the player's season. Lazy and
 * idempotent, so calling it on the way into the standings screen is enough:
 * missing tables are created (a pre-feature save, or the level the player
 * just left), the table for the player's own level is dropped (the real
 * league covers it), a table that's ahead of the player's league can only
 * mean a season rollover so it resets, and every table behind the player's
 * point in the season catches up one simulated day at a time.
 */
export function syncOtherLevels(save: SaveData, rng: Rng): void {
  const league = save.league;
  // Seasons are different lengths up the ladder, so "the same point" is the
  // same fraction of the year, not the same number of games.
  const played = regularSeasonGames(league).filter((g) => g.played).length;
  const mine = Math.max(1, seasonGames(league));
  const targetFor = (levelId: number): number =>
    Math.round((played / mine) * LEVELS[levelId].games);

  const tables = (save.otherLevels ?? []).filter((t) => t.levelId !== league.levelId);
  const taken = new Set<string>(league.teams.map((t) => t.name));
  for (const table of tables) for (const team of table.teams) taken.add(team.name);

  for (const level of LEVELS) {
    if (level.id === league.levelId) continue;
    if (!tables.some((t) => t.levelId === level.id)) {
      tables.push(createLevelTable(level.id, rng, taken));
    }
  }
  tables.sort((a, b) => a.levelId - b.levelId);

  for (const table of tables) {
    const target = targetFor(table.levelId);
    if (tableGames(table) > target) {
      for (const team of table.teams) {
        team.wins = 0;
        team.losses = 0;
        team.ties = 0;
        team.runsFor = 0;
        team.runsAgainst = 0;
      }
    }
    while (tableGames(table) < target) playNext(table, rng);
  }

  save.otherLevels = tables;
}

/** The table sorted for display: winning percentage, wins, then club strength. */
export function tableStandings(table: LevelTable): FarmTeam[] {
  return [...table.teams].sort(
    (a, b) => winningPct(b) - winningPct(a) || b.wins - a.wins || b.strength - a.strength,
  );
}
