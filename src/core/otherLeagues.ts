import type { Rng } from './rng';
import { clamp } from './rng';
import type { SaveData } from './save';
import {
  LEVELS,
  gamesPlayed,
  generateLeagueNames,
  regularSeasonGames,
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

/** Everybody in a table plays every round, so any club's count is the table's. */
const roundsPlayed = (table: LevelTable): number =>
  table.teams[0] ? gamesPlayed(table.teams[0]) : 0;

function createLevelTable(levelId: number, rng: Rng, taken: Set<string>): LevelTable {
  const kits = [...TEAM_KITS];
  const teams = generateLeagueNames(rng, taken).map((name) => {
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

/** One day of results: random pairings, better clubs win more. */
function playRound(table: LevelTable, rng: Rng): void {
  const pool = [...table.teams];
  while (pool.length >= 2) {
    const a = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    const b = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    simulateGame(a, b, rng);
  }
}

/**
 * Bring the other levels' tables in line with the player's season. Lazy and
 * idempotent, so calling it on the way into the standings screen is enough:
 * missing tables are created (a pre-feature save, or the level the player
 * just left), the table for the player's own level is dropped (the real
 * league covers it), a table that's ahead of the player's league can only
 * mean a season rollover so it resets, and every table behind the player's
 * games-played count catches up one simulated day at a time.
 */
export function syncOtherLevels(save: SaveData, rng: Rng): void {
  const league = save.league;
  const target = regularSeasonGames(league).filter((g) => g.played).length;

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
    if (roundsPlayed(table) > target) {
      for (const team of table.teams) {
        team.wins = 0;
        team.losses = 0;
        team.ties = 0;
        team.runsFor = 0;
        team.runsAgainst = 0;
      }
    }
    while (roundsPlayed(table) < target) playRound(table, rng);
  }

  save.otherLevels = tables;
}

/** The table sorted for display: winning percentage, wins, then club strength. */
export function tableStandings(table: LevelTable): FarmTeam[] {
  return [...table.teams].sort(
    (a, b) => winningPct(b) - winningPct(a) || b.wins - a.wins || b.strength - a.strength,
  );
}
