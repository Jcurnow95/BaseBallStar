import { Rng, clamp } from './rng';
import { ROOKIE_AGE } from './player';
import type { Ballpark } from './ballpark';
import { BALLPARKS, ballparkById } from './ballpark';
import type { TeamKit } from './uniforms';
import { TEAM_KITS, kitFor } from './uniforms';
import type { Weather } from './weather';
import { rollWeather } from './weather';
import type { Playoffs } from './playoffs';

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

const FIRST_NAMES = [
  'Dane', 'Marco', 'Eli', 'Cole', 'Rafa', 'Tomas', 'Jax', 'Owen', 'Kai', 'Bryce',
  'Luis', 'Dario', 'Wes', 'Trey', 'Mateo', 'Hiro', 'Anders', 'Cruz', 'Silas', 'Deion',
  'Rowan', 'Felix', 'Jonas', 'Miles', 'Trent', 'Ezra', 'Nico', 'Grady', 'Sho', 'Beau',
];
const LAST_NAMES = [
  'Varga', 'Whitlock', 'Ferreira', 'Nakamura', 'Delgado', 'Boone', 'Okafor', 'Lindqvist', 'Moreau', 'Castellanos',
  'Herrera', 'Kowalski', 'Tanaka', 'Aldridge', 'Beckham', 'Osei', 'Marchetti', 'Duval', 'Halloran', 'Reyes',
  'Sandoval', 'Kirkland', 'Vann', 'Petrov', 'Aoki', 'Mbeki', 'Strand', 'Quintero', 'Ashworth', 'Calloway',
];

/**
 * A named squad member on any club in the league. These are the people the
 * play-by-play talks about: they live in the save, so the same names bat
 * around you all season, develop over winters, and eventually retire.
 */
export interface RosterPlayer {
  name: string;
  age: number;
  /** 0-100 skill. A light thumb on their simulated at-bats, and the number to watch grow. */
  rating: number;
  role: 'batter' | 'pitcher';
}

/* --------------------------------------------------------- growing old */

/** Nobody plays past this. Reach it and the winter is your last. */
export const FORCED_RETIREMENT_AGE = 38;

/** From here on, every winter is one a player might not come back from. */
export const RETIREMENT_WATCH_AGE = 33;

/**
 * Old enough that the clubhouse should say so. Purely a display test — the
 * roll that actually ends a career is `retiresThisWinter`.
 */
export const nearingRetirement = (p: RosterPlayer): boolean =>
  p.age >= RETIREMENT_WATCH_AGE;

/**
 * Does this player hang them up over the winter? The odds climb steeply from
 * 33 (14%) to 37 (70%) and become certain at 38 — and a veteran the league has
 * already passed by goes early, because a 36-year-old carrying a 25 rating is
 * a roster spot a kid should have.
 */
export function retiresThisWinter(p: RosterPlayer, rng: Rng): boolean {
  if (p.age >= FORCED_RETIREMENT_AGE) return true;
  if (p.age < RETIREMENT_WATCH_AGE) return false;
  if (p.rating < 28) return true;
  return rng.chance((p.age - (RETIREMENT_WATCH_AGE - 1)) * 0.14);
}

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
  /** The club's named players. Optional so pre-roster saves still load. */
  roster?: RosterPlayer[];
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
  /**
   * The forecast for the day, rolled with the schedule so the clubhouse can
   * warn you about it. Optional so saves from before weather still load; a
   * missing one is rolled the first time it's asked for.
   */
  weather?: Weather;
  /** Set on postseason games: which series this is game `gameNo` of. */
  playoff?: { seriesId: string; gameNo: number };
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
  /**
   * How many calendar days the regular season ran before playoff days were
   * added on the end. Optional so pre-playoff saves still load: absent, the
   * whole calendar is regular season.
   */
  regularDays?: number;
  /** The postseason, once the regular season is done. See `core/playoffs.ts`. */
  playoffs?: Playoffs;
  /** Clubhouse news waiting to be shown on the hub, then cleared. */
  news?: string[];
}

const BATTERS_PER_TEAM = 8;
const PITCHERS_PER_TEAM = 2;

export function randomName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

function newRosterPlayer(
  rng: Rng,
  role: 'batter' | 'pitcher',
  ratingCentre: number,
  rookie = false,
): RosterPlayer {
  return {
    name: randomName(rng),
    // Kids come up around the age you signed at; an established squad is
    // spread across the working years of a career.
    age: rookie ? rng.int(ROOKIE_AGE, ROOKIE_AGE + 4) : rng.int(21, 34),
    rating: Math.round(clamp(ratingCentre + rng.gaussian() * 8, 10, 99)),
    role,
  };
}

/** What a fresh arrival on this club should rate around, by role. */
function ratingCentreFor(league: LeagueState, team: Team, role: 'batter' | 'pitcher'): number {
  return role === 'pitcher' ? LEVELS[league.levelId].pitcherRating : (team.strength ?? 50);
}

function generateRoster(rng: Rng, strength: number, pitcherRating: number): RosterPlayer[] {
  const roster: RosterPlayer[] = [];
  for (let i = 0; i < BATTERS_PER_TEAM; i++) roster.push(newRosterPlayer(rng, 'batter', strength));
  for (let i = 0; i < PITCHERS_PER_TEAM; i++) roster.push(newRosterPlayer(rng, 'pitcher', pitcherRating));
  return roster;
}

export const teamBatters = (team: Team): RosterPlayer[] =>
  (team.roster ?? []).filter((p) => p.role === 'batter');

export const teamPitchers = (team: Team): RosterPlayer[] =>
  (team.roster ?? []).filter((p) => p.role === 'pitcher');

/** Give any roster-less club (a pre-roster save) its players. Idempotent. */
export function ensureRosters(league: LeagueState, rng: Rng): void {
  const level = LEVELS[league.levelId];
  for (const team of league.teams) {
    if (!team.roster || team.roster.length === 0) {
      team.roster = generateRoster(rng, team.strength ?? 50, level.pitcherRating);
    }
  }
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
    // Spread the league out: a couple of good clubs, a couple of bad ones.
    const strength = clamp(50 + rng.gaussian() * 14, 20, 80);
    teams.push({
      id: `t${i}`,
      name: `${city} ${nick}`,
      wins: 0,
      losses: 0,
      parkId: park.id,
      kitId: kit.id,
      strength,
      roster: generateRoster(rng, strength, LEVELS[levelId].pitcherRating),
    });
  }

  const playerTeamId = teams[0].id;

  return {
    levelId,
    playerTeamId,
    teams,
    schedule: buildSchedule(teams, playerTeamId, rng),
    calendar: buildCalendar(rng),
    day: 0,
  };
}

function buildSchedule(teams: Team[], playerTeamId: string, rng: Rng): ScheduledGame[] {
  const opponents = teams.filter((t) => t.id !== playerTeamId);
  const schedule: ScheduledGame[] = [];

  for (let i = 0; i < SEASON_GAMES; i++) {
    schedule.push({
      index: i,
      opponentId: opponents[i % opponents.length].id,
      home: Math.floor(i / opponents.length) % 2 === 0,
      played: false,
      weather: rollWeather(rng),
    });
  }

  return schedule;
}

/**
 * Carry the league into a new season at the same level: same clubs, records
 * wiped, a fresh schedule — and an offseason in every clubhouse. Players age a
 * year, the young ones come on, the old ones fade, and the oldest hang them
 * up and are replaced by kids. Returns the news from the player's own
 * clubhouse, for the season-opening report.
 */
export function rolloverSeason(league: LeagueState, rng: Rng): string[] {
  const news: string[] = [];
  const retiredElsewhere: RosterPlayer[] = [];
  ensureRosters(league, rng);

  for (const team of league.teams) {
    team.wins = 0;
    team.losses = 0;
    const roster = team.roster!;
    const mine = team.id === league.playerTeamId;

    for (let i = 0; i < roster.length; i++) {
      const p = roster[i];
      p.age++;

      if (retiresThisWinter(p, rng)) {
        const rookie = newRosterPlayer(rng, p.role, ratingCentreFor(league, team, p.role) - 4, true);
        roster[i] = rookie;
        if (mine) news.push(`${p.name} retired at ${p.age}. ${rookie.name}, ${rookie.age}, takes the spot.`);
        // A name good enough to have been worth knowing is worth a line even
        // when it belonged to somebody else's clubhouse.
        else if (p.rating >= 70) retiredElsewhere.push(p);
        continue;
      }

      // Young players trend up over a winter, veterans trend down.
      const drift = Math.round((p.age < 27 ? 2.5 : p.age < 31 ? 0 : -2.5) + rng.gaussian() * 2.5);
      p.rating = Math.round(clamp(p.rating + drift, 10, 99));
      if (mine && drift >= 4) news.push(`${p.name} put in a big winter — up to a ${p.rating} rating.`);
      if (mine && drift <= -4) {
        news.push(
          p.age >= 31
            ? `${p.name} is slowing down at ${p.age} — down to a ${p.rating} rating.`
            : `${p.name} had a rough winter — down to a ${p.rating} rating.`,
        );
      }
    }

    // The league table should follow the talent.
    const batters = teamBatters(team);
    team.strength = clamp(batters.reduce((s, p) => s + p.rating, 0) / Math.max(1, batters.length), 20, 80);
  }

  if (retiredElsewhere.length > 0) {
    const best = retiredElsewhere.sort((a, b) => b.rating - a.rating)[0];
    const others = retiredElsewhere.length - 1;
    news.push(
      `Around the league: ${best.name} retired at ${best.age}` +
        (others > 0 ? `, one of ${retiredElsewhere.length} names to go this winter.` : '.'),
    );
  }

  league.schedule = buildSchedule(league.teams, league.playerTeamId, rng);
  league.calendar = buildCalendar(rng);
  league.day = 0;
  // Last year's postseason is history; the new year seeds its own.
  league.playoffs = undefined;
  league.regularDays = undefined;
  return news;
}

/**
 * A small chance each day that the front office shuffles the clubhouse: one
 * teammate out, a call-up in. This is the only way names change mid-season.
 * Returns the news line, or null on the (usual) quiet day.
 */
export function maybeRosterMove(league: LeagueState, rng: Rng): string | null {
  if (!rng.chance(0.05)) return null;
  const team = playerTeam(league);
  const roster = team.roster;
  if (!roster || roster.length === 0) return null;

  const index = rng.int(0, roster.length - 1);
  const departing = roster[index];
  const arriving = newRosterPlayer(rng, departing.role, ratingCentreFor(league, team, departing.role) - 4, true);
  roster[index] = arriving;

  const how = rng.pick(['was traded away', 'was sent down', 'was released']);
  return `Roster move: ${departing.name} ${how}. ${arriving.name} joins the clubhouse.`;
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

/** The regular-season games, leaving out any postseason games tacked on. */
export const regularSeasonGames = (league: LeagueState): ScheduledGame[] =>
  league.schedule.filter((g) => !g.playoff);

/**
 * The regular season is done when the calendar runs out, or when every
 * scheduled game has been played and only off days remain.
 *
 * Note what this is NOT: "there is no game today". An off day in the middle of
 * the season has no game either, and treating that as the end of the year ends
 * seasons after a couple of games.
 */
export const isRegularSeasonOver = (league: LeagueState): boolean =>
  league.day >= (league.regularDays ?? league.calendar.length) ||
  regularSeasonGames(league).every((g) => g.played);

/**
 * The whole year is done: the regular season is over and the postseason has
 * crowned a champion. Between the two — a playoff still being played, or not
 * yet seeded — the year is still on.
 */
export const isSeasonOver = (league: LeagueState): boolean =>
  isRegularSeasonOver(league) && league.playoffs?.complete === true;

export function daysRemaining(league: LeagueState): number {
  return Math.max(0, league.calendar.length - league.day);
}

/**
 * Move to tomorrow — the day the front office might make a move on. Callers
 * that don't care about roster churn (tools, playoff bookkeeping) may omit
 * the rng and no move is rolled.
 */
export function advanceDay(league: LeagueState, rng?: Rng): void {
  league.day = Math.min(league.calendar.length, league.day + 1);
  if (!rng) return;
  const move = maybeRosterMove(league, rng);
  if (move) (league.news ??= []).push(move);
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

/**
 * The weather a scheduled game is played in. Older saves have no forecast on
 * the schedule, so one is rolled and pinned the first time it's needed —
 * pinned, so the clubhouse and the game agree on the day.
 */
export function weatherForGame(game: ScheduledGame, rng: Rng): Weather {
  if (!game.weather) game.weather = rollWeather(rng);
  return game.weather;
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

/**
 * Six fresh club names for a league the player isn't in. Cities and nicknames
 * are unique within the six, and no full name repeats one in `taken` — so two
 * levels of the ladder never both field a Riverside Rapids.
 */
export function generateLeagueNames(rng: Rng, taken: ReadonlySet<string>): string[] {
  const cities = [...CITY_NAMES];
  const nicks = [...TEAM_NICKS];
  const names: string[] = [];

  for (let i = 0; i < 6; i++) {
    const city = cities.splice(rng.int(0, cities.length - 1), 1)[0];
    let pickAt = rng.int(0, nicks.length - 1);
    for (let tries = 0; tries < nicks.length; tries++) {
      const at = (pickAt + tries) % nicks.length;
      if (!taken.has(`${city} ${nicks[at]}`)) {
        pickAt = at;
        break;
      }
    }
    names.push(`${city} ${nicks.splice(pickAt, 1)[0]}`);
  }

  return names;
}

/** Chance `a` beats `b`, damped so even the worst club wins its share. */
export function winChance(a: { strength?: number }, b: { strength?: number }): number {
  const edge = ((a.strength ?? 50) - (b.strength ?? 50)) / 100;
  return clamp(0.5 + edge * 0.62, 0.24, 0.76);
}

const winPct = (t: Team): number => (t.wins + t.losses === 0 ? 0 : t.wins / (t.wins + t.losses));

export function standings(league: LeagueState): Team[] {
  return [...league.teams].sort((a, b) => winPct(b) - winPct(a));
}

/**
 * The table with ties broken, for seeding the bracket: winning percentage,
 * then wins, then the stronger club. Deterministic, so a save reloaded
 * mid-playoffs seeds the same way it did the first time.
 */
export function playoffSeedOrder(league: LeagueState): Team[] {
  return [...league.teams].sort(
    (a, b) =>
      winPct(b) - winPct(a) || b.wins - a.wins || (b.strength ?? 50) - (a.strength ?? 50),
  );
}
