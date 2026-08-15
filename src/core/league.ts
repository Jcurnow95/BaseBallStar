import { Rng, clamp } from './rng';
import type { Ballpark } from './ballpark';
import { BALLPARKS, ballparkById } from './ballpark';
import type { TeamKit } from './uniforms';
import { TEAM_KITS, kitFor } from './uniforms';

/**
 * Demo season length. A real season would be 140+ games at each level; 24
 * keeps a full rise-through-the-system playthrough to a sitting or two.
 */
export const SEASON_GAMES = 24;

export interface LeagueLevel {
  id: number;
  name: string;
  short: string;
  /** Average pitcher rating faced at this level. */
  pitcherRating: number;
  /** Average team defense behind those pitchers. */
  defenseRating: number;
  /** Overall rating you need to earn a call-up out of this level. */
  promotionOverall: number;
  /** Season OPS-ish performance score needed alongside the rating. */
  promotionScore: number;
  /**
   * How full the stands are, 0-1. Purely visual, but it is the quickest read
   * on where you are: Single-A plays in front of friends and family, the
   * Majors plays in front of forty thousand.
   */
  crowd: number;
}

export const LEVELS: LeagueLevel[] = [
  {
    id: 0,
    name: 'Single-A',
    short: 'A',
    pitcherRating: 34,
    defenseRating: 38,
    promotionOverall: 43,
    promotionScore: 62,
    crowd: 0.14,
  },
  {
    id: 1,
    name: 'Double-A',
    short: 'AA',
    pitcherRating: 52,
    defenseRating: 54,
    promotionOverall: 47,
    promotionScore: 66,
    crowd: 0.36,
  },
  {
    id: 2,
    name: 'Triple-A',
    short: 'AAA',
    pitcherRating: 68,
    defenseRating: 68,
    promotionOverall: 50,
    promotionScore: 70,
    crowd: 0.62,
  },
  {
    id: 3,
    name: 'The Majors',
    short: 'MLB',
    pitcherRating: 84,
    defenseRating: 82,
    promotionOverall: 999,
    promotionScore: 999,
    crowd: 0.95,
  },
];

const CITY_NAMES = [
  'Riverside', 'Kingsport', 'Cedar Falls', 'Ashland', 'Glenwood', 'Fairview',
  'Brookhaven', 'Stonebridge', 'Millvale', 'Northgate', 'Harborview', 'Lakemont',
];

const TEAM_NICKS = [
  'Rapids', 'Ironmen', 'Sentinels', 'Coyotes', 'Mudcats', 'Thunder',
  'Rail Kings', 'Pelicans', 'Bandits', 'Voyagers', 'Hammers', 'Comets',
];

const PITCHER_FIRST = ['Dane', 'Marco', 'Eli', 'Cole', 'Rafa', 'Tomas', 'Jax', 'Owen', 'Kai', 'Bryce'];
const PITCHER_LAST = ['Varga', 'Whitlock', 'Ferreira', 'Nakamura', 'Delgado', 'Boone', 'Okafor', 'Lindqvist', 'Moreau', 'Castellanos'];

export interface Team {
  id: string;
  name: string;
  wins: number;
  losses: number;
  /** Id of the ballpark this team plays its home games in. */
  parkId: string;
  /** Id of the team's colour identity. Optional so pre-uniform saves still load. */
  kitId?: string;
  /**
   * How good the club is, 0-100. Drives results against other clubs so the
   * table separates into contenders and cellar-dwellers instead of every team
   * finishing within a game of .500. Optional so older saves still load.
   */
  strength?: number;
}

/** One dated day of the season: either a game, or an off day to train on. */
export interface CalendarDay {
  /** Index into `schedule`, or null on an off day. */
  gameIndex: number | null;
}

export interface ScheduledGame {
  index: number;
  opponentId: string;
  home: boolean;
  played: boolean;
  playerTeamScore?: number;
  opponentScore?: number;
}

export interface LeagueState {
  levelId: number;
  playerTeamId: string;
  teams: Team[];
  schedule: ScheduledGame[];
  /** The season laid out day by day. */
  calendar: CalendarDay[];
  /** Index of today in `calendar`. */
  day: number;
}

export function pitcherName(rng: Rng): string {
  return `${rng.pick(PITCHER_FIRST)} ${rng.pick(PITCHER_LAST)}`;
}

export function createLeague(levelId: number, rng: Rng): LeagueState {
  const cities = [...CITY_NAMES];
  const nicks = [...TEAM_NICKS];
  const parks = [...BALLPARKS];
  const kits = [...TEAM_KITS];
  const teams: Team[] = [];

  for (let i = 0; i < 6; i++) {
    const city = cities.splice(rng.int(0, cities.length - 1), 1)[0];
    const nick = nicks.splice(rng.int(0, nicks.length - 1), 1)[0];
    const park = parks.splice(rng.int(0, parks.length - 1), 1)[0] ?? BALLPARKS[0];
    const kit = kits.splice(rng.int(0, kits.length - 1), 1)[0] ?? TEAM_KITS[i];
    teams.push({
      id: `t${i}`,
      name: `${city} ${nick}`,
      wins: 0,
      losses: 0,
      parkId: park.id,
      kitId: kit.id,
      // Spread the league out: a couple of good clubs, a couple of bad ones.
      strength: clamp(50 + rng.gaussian() * 14, 20, 80),
    });
  }

  const playerTeamId = teams[0].id;
  const opponents = teams.filter((t) => t.id !== playerTeamId);
  const schedule: ScheduledGame[] = [];

  for (let i = 0; i < SEASON_GAMES; i++) {
    schedule.push({
      index: i,
      opponentId: opponents[i % opponents.length].id,
      home: Math.floor(i / opponents.length) % 2 === 0,
      played: false,
    });
  }

  return { levelId, playerTeamId, teams, schedule, calendar: buildCalendar(rng), day: 0 };
}

/**
 * Lay the season out day by day: short homestands and road trips of two to
 * four games, with an off day between them to train on.
 */
function buildCalendar(rng: Rng): CalendarDay[] {
  const days: CalendarDay[] = [];
  let gameIndex = 0;

  while (gameIndex < SEASON_GAMES) {
    const stretch = Math.min(rng.int(2, 4), SEASON_GAMES - gameIndex);
    for (let i = 0; i < stretch; i++) days.push({ gameIndex: gameIndex++ });
    if (gameIndex < SEASON_GAMES) {
      days.push({ gameIndex: null });
      // Now and then the schedule gives you two days off in a row.
      if (rng.chance(0.28)) days.push({ gameIndex: null });
    }
  }

  return days;
}

export const today = (league: LeagueState): CalendarDay | null =>
  league.calendar[league.day] ?? null;

export const isGameDay = (league: LeagueState): boolean => today(league)?.gameIndex != null;

/**
 * The season is done when the calendar runs out, or when every scheduled game
 * has been played and only off days remain.
 *
 * Note what this is NOT: "there is no game today". An off day in the middle of
 * the season has no game either, and treating that as the end of the year ends
 * seasons after a couple of games.
 */
export const isSeasonOver = (league: LeagueState): boolean =>
  league.day >= league.calendar.length || league.schedule.every((g) => g.played);

export function daysRemaining(league: LeagueState): number {
  return Math.max(0, league.calendar.length - league.day);
}

/** Move to tomorrow. */
export function advanceDay(league: LeagueState): void {
  league.day = Math.min(league.calendar.length, league.day + 1);
}

/** A team's colour identity, resolved safely for older saves. */
export function teamKit(league: LeagueState, teamId: string): TeamKit {
  const index = Math.max(0, league.teams.findIndex((t) => t.id === teamId));
  return kitFor(league.teams[index]?.kitId, index);
}

/** The park a scheduled game is played in. */
export function parkForGame(league: LeagueState, game: ScheduledGame): Ballpark {
  const hostId = game.home ? league.playerTeamId : game.opponentId;
  return ballparkById(teamById(league, hostId).parkId);
}

export function teamById(league: LeagueState, id: string): Team {
  return league.teams.find((t) => t.id === id) ?? league.teams[0];
}

export function playerTeam(league: LeagueState): Team {
  return teamById(league, league.playerTeamId);
}

/** The game scheduled for today, if today is a game day. */
export function nextGame(league: LeagueState): ScheduledGame | null {
  const day = today(league);
  if (!day || day.gameIndex == null) return null;
  const game = league.schedule[day.gameIndex];
  return game && !game.played ? game : null;
}

/**
 * Advance the rest of the league on days the player also played. Teams already
 * credited with a result (the player's own opponent) are excluded.
 */
export function simulateOtherTeams(
  league: LeagueState,
  rng: Rng,
  excludeIds: readonly string[] = [],
): void {
  const others = league.teams.filter(
    (t) => t.id !== league.playerTeamId && !excludeIds.includes(t.id),
  );
  for (let i = 0; i < others.length; i += 2) {
    const a = others[i];
    const b = others[i + 1];
    if (!b) break;
    // Better clubs win more. A straight coin flip left every team within a
    // game of .500, so the standings said nothing about anybody.
    if (rng.chance(winChance(a, b))) {
      a.wins++;
      b.losses++;
    } else {
      b.wins++;
      a.losses++;
    }
  }
}

/** Chance `a` beats `b`, damped so even the worst club wins its share. */
function winChance(a: Team, b: Team): number {
  const edge = ((a.strength ?? 50) - (b.strength ?? 50)) / 100;
  return clamp(0.5 + edge * 0.62, 0.24, 0.76);
}

export function standings(league: LeagueState): Team[] {
  return [...league.teams].sort((a, b) => {
    const pctA = a.wins + a.losses === 0 ? 0 : a.wins / (a.wins + a.losses);
    const pctB = b.wins + b.losses === 0 ? 0 : b.wins / (b.wins + b.losses);
    return pctB - pctA;
  });
}
