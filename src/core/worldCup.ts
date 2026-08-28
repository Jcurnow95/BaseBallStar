/**
 * The Baseball World Trophy — "the Trough" to everyone who has ever played
 * for it. Thirty-two countries, every fourth year, starting with the year the
 * career starts.
 *
 * Shape of the thing:
 *
 *   Group stage   8 groups of 4, round robin, three matchdays.
 *   Qualifying    the 8 group winners, plus the 8 best records among
 *                 everyone else — a wildcard round, so a hard group doesn't
 *                 automatically end a run.
 *   Knockout      16 teams, single elimination, one game a round. Seeded
 *                 1v16 / 8v9 / 5v12 / … so the two best records can only
 *                 meet in the final.
 *
 * Three rules shape the code:
 *
 * 1. **The tournament is preseason.** It runs on the front of the league
 *    calendar, before opening day, and never touches the club table. A cup
 *    game is a `ScheduledGame` with `worldCup` set, the same way a postseason
 *    game carries `playoff`, so it plays through the ordinary game screen —
 *    but `regularSeasonGames` filters it out and nothing about the club
 *    season can see it.
 *
 * 2. **Only the player's games are played.** Every other match in the round is
 *    simulated the moment the player's is done, so the group tables and the
 *    bracket are always current when a screen asks. If the player isn't
 *    picked, the whole tournament resolves on the spot and they read about it.
 *
 * 3. **The nations are `Team`s.** A national side is the same shape as a club,
 *    so `simulateGame`, `recordResult`, `winningPct` and `GameSim` all work on
 *    it unchanged. The ids are namespaced (`wc-jpn`) so a nation can never be
 *    confused with a club in the same save.
 */
import type { Ballpark } from './ballpark';
import { BALLPARKS, ballparkById } from './ballpark';
import type {
  LeagueLevel,
  LeagueState,
  RosterPlayer,
  ScheduledGame,
  Team,
} from './league';
import { randomName, recordResult, runDiff, winChance, winningPct } from './league';
import type { Nation } from './nations';
import { NATIONS, nationById } from './nations';
import { ROOKIE_AGE } from './player';
import type { Rng } from './rng';
import { clamp } from './rng';
import type { SaveData } from './save';
import { TEAM_KITS } from './uniforms';
import { rollWeather } from './weather';

/* ------------------------------------------------------------ the format */

/** Years between tournaments. */
export const CUP_INTERVAL = 4;
export const CUP_TEAMS = 32;
export const GROUP_COUNT = 8;
export const GROUP_SIZE = 4;
/** Group winners, plus the same number of wildcards. */
export const KNOCKOUT_TEAMS = 16;
/** Matchdays in a four-team round robin. */
export const GROUP_MATCHDAYS = GROUP_SIZE - 1;

/** Triple-A. Below this the national selectors don't know your name. */
export const CUP_ELIGIBLE_LEVEL = 2;

export const GROUP_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export type CupRound = 'group' | 'r16' | 'quarter' | 'semi' | 'final';

export const ROUND_LABEL: Record<CupRound, string> = {
  group: 'Group Stage',
  r16: 'Round of 16',
  quarter: 'Quarter-Final',
  semi: 'Semi-Final',
  final: 'Final',
};

/** Knockout rounds in the order they're played. */
export const KNOCKOUT_ROUNDS: CupRound[] = ['r16', 'quarter', 'semi', 'final'];

/**
 * A tournament happens in the year the career starts and every fourth year
 * after: 1, 5, 9, 13. Seasons are 1-based, hence the shift.
 */
export const isCupYear = (seasonYear: number): boolean =>
  seasonYear >= 1 && (seasonYear - 1) % CUP_INTERVAL === 0;

/** The next year there'll be one, counting from `seasonYear` inclusive. */
export function nextCupYear(seasonYear: number): number {
  const from = Math.max(1, seasonYear);
  return from + ((CUP_INTERVAL - ((from - 1) % CUP_INTERVAL)) % CUP_INTERVAL);
}

/* --------------------------------------------------------- getting picked */

/**
 * The overall rating a country's selectors want to see. Deliberately steeper
 * than `strength`, and deliberately public — the create screen shows it — so
 * choosing a flag at eighteen is choosing how hard the rest of the career will
 * be. Japan asks 73, India asks 44: the same career walks into one squad and
 * never gets a call from the other.
 */
export const squadBar = (nation: Nation): number => Math.round(30 + nation.strength * 0.45);

/**
 * The case for picking you, on the same 0-99 scale as the bar. Your rating is
 * most of it; playing in the majors is worth a real bump, because a selector
 * who watches you every night knows more than a scouting report out of
 * Triple-A; and an MVP on the shelf speaks for itself.
 */
export function selectionCase(overall: number, levelId: number, mvpCount: number): number {
  return Math.round(overall + (levelId - CUP_ELIGIBLE_LEVEL) * 8 + Math.min(6, mvpCount * 3));
}

export type CupSelection = 'in' | 'level' | 'cut';

/* ----------------------------------------------------------------- state */

export interface CupMatch {
  id: string;
  round: CupRound;
  /** Group letter, on group-stage matches only. */
  groupId?: string;
  /** 1-3, on group-stage matches only. */
  matchday?: number;
  homeId: string;
  awayId: string;
  homeRuns?: number;
  awayRuns?: number;
  played: boolean;
  /** Bracket seeds, on knockout matches. */
  homeSeed?: number;
  awaySeed?: number;
}

export interface CupGroup {
  id: string;
  /** Team ids, in the order they were drawn. */
  teamIds: string[];
}

/** A tournament's worth of at-bats. A trimmed `BattingStats`, kept small. */
export interface TournamentLine {
  games: number;
  ab: number;
  hits: number;
  homeRuns: number;
  rbi: number;
  walks: number;
}

export const emptyTournamentLine = (): TournamentLine => ({
  games: 0,
  ab: 0,
  hits: 0,
  homeRuns: 0,
  rbi: 0,
  walks: 0,
});

export interface WorldCup {
  /** Season year this tournament is being played in. */
  year: number;
  /** The 32 national sides, as clubs. */
  teams: Team[];
  groups: CupGroup[];
  matches: CupMatch[];
  /** Your country's team id, whether or not you were picked. */
  nationId: string;
  selection: CupSelection;
  /** What the selectors wanted, and what you had. For the "you're out" note. */
  bar: number;
  yourCase: number;
  /** Team ids in seed order, once the group stage is done. */
  seeds?: string[];
  championId?: string;
  runnerUpId?: string;
  complete: boolean;
  playerResult: 'alive' | 'missed' | 'eliminated' | 'champion';
  /** The round the run ended in, if it ended. */
  eliminatedIn?: CupRound;
  /** Your line for the tournament, built up game by game. */
  playerStats: TournamentLine;
}

/** What a finished tournament leaves behind once the state is replaced. */
export interface CupRecord {
  year: number;
  championId: string;
  runnerUpId?: string;
  /** Your country, whether or not you played for it. */
  nationId: string;
  playerResult: WorldCup['playerResult'];
  eliminatedIn?: CupRound;
  playerStats?: TournamentLine;
}

/* ------------------------------------------------------- building a field */

const NATION_BATTERS = 8;
const NATION_PITCHERS = 2;

/** The team id a nation plays under. Namespaced so it can't collide with a club. */
export const cupTeamId = (nationId: string): string => `wc-${nationId}`;

/** The nation behind a cup team id. */
export const nationOfTeam = (teamId: string): Nation => nationById(teamId.replace(/^wc-/, ''));

/**
 * What a national side's staff throws. The weakest countries pitch about like
 * Triple-A and the very best a shade above the majors, which keeps the whole
 * tournament inside the range the swing has been tuned against.
 */
export const nationPitching = (strength: number): number => clamp(52 + strength * 0.32, 30, 92);

function nationRoster(nation: Nation, rng: Rng): RosterPlayer[] {
  const roster: RosterPlayer[] = [];
  const pitching = nationPitching(nation.strength);
  for (let i = 0; i < NATION_BATTERS; i++) {
    roster.push({
      name: randomName(rng),
      // A national squad is a country's best working-age players.
      age: rng.int(ROOKIE_AGE + 4, 34),
      rating: Math.round(clamp(nation.strength + rng.gaussian() * 7, 20, 99)),
      role: 'batter',
    });
  }
  for (let i = 0; i < NATION_PITCHERS; i++) {
    roster.push({
      name: randomName(rng),
      age: rng.int(ROOKIE_AGE + 4, 34),
      rating: Math.round(clamp(pitching + rng.gaussian() * 6, 20, 99)),
      role: 'pitcher',
    });
  }
  return roster;
}

function nationTeam(nation: Nation, index: number, rng: Rng): Team {
  return {
    id: cupTeamId(nation.id),
    name: nation.name,
    wins: 0,
    losses: 0,
    ties: 0,
    runsFor: 0,
    runsAgainst: 0,
    // Neutral venues, cycled so the tournament isn't played in one park.
    parkId: BALLPARKS[index % BALLPARKS.length].id,
    kitId: TEAM_KITS[index % TEAM_KITS.length].id,
    strength: nation.strength,
    roster: nationRoster(nation, rng),
  };
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
  }
  return pool;
}

/**
 * The draw. Four pots by strength, one team from each pot into every group, so
 * no group has three of the world's best in it and none is a walkover.
 */
function drawGroups(teams: Team[], rng: Rng): CupGroup[] {
  const seeded = [...teams].sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));
  const groups: CupGroup[] = GROUP_IDS.map((id) => ({ id, teamIds: [] as string[] }));

  for (let pot = 0; pot < GROUP_SIZE; pot++) {
    const slice = shuffled(seeded.slice(pot * GROUP_COUNT, (pot + 1) * GROUP_COUNT), rng);
    slice.forEach((team, g) => groups[g].teamIds.push(team.id));
  }

  return groups;
}

/**
 * A four-team round robin, laid out so every side plays once a matchday and
 * nobody is at home three times.
 */
const ROBIN: { home: number; away: number; matchday: number }[] = [
  { home: 0, away: 1, matchday: 1 },
  { home: 2, away: 3, matchday: 1 },
  { home: 2, away: 0, matchday: 2 },
  { home: 3, away: 1, matchday: 2 },
  { home: 0, away: 3, matchday: 3 },
  { home: 1, away: 2, matchday: 3 },
];

function groupMatches(group: CupGroup): CupMatch[] {
  return ROBIN.map((slot, i) => ({
    id: `g${group.id}-${i}`,
    round: 'group' as CupRound,
    groupId: group.id,
    matchday: slot.matchday,
    homeId: group.teamIds[slot.home],
    awayId: group.teamIds[slot.away],
    played: false,
  }));
}

/* ------------------------------------------------------------- playing it */

/**
 * A score for a game nobody watched. The same shape as the league's simulated
 * games — most go by a run or two — except that a knockout game is rolled
 * until somebody wins, because a single-elimination tie has nowhere to go.
 */
function playMatch(a: Team, b: Team, rng: Rng, mustDecide: boolean): [number, number] {
  if (!mustDecide && rng.chance(0.04)) {
    const level = Math.max(0, Math.round(4 + rng.gaussian() * 2));
    return [level, level];
  }
  const margin = rng.chance(0.34) ? 1 : rng.chance(0.52) ? 2 : rng.int(3, 9);
  const loser = Math.max(0, Math.round(3.4 + rng.gaussian() * 2.2));
  const winner = loser + margin;
  // A little home cooking, the same nudge the club postseason gets.
  return rng.chance(clamp(winChance(a, b) + 0.04, 0.2, 0.8))
    ? [winner, loser]
    : [loser, winner];
}

/** Settle one match and write it down. */
function resolveMatch(cup: WorldCup, match: CupMatch, rng: Rng): void {
  if (match.played) return;
  const home = cupTeam(cup, match.homeId);
  const away = cupTeam(cup, match.awayId);
  const [hr, ar] = playMatch(home, away, rng, match.round !== 'group');
  applyMatchResult(cup, match, hr, ar);
}

/**
 * Write a finished match onto the tournament — the one place a cup result is
 * recorded, whether it was simulated or the player played it. Group results
 * move the group table; knockout results live on the match alone, so a bracket
 * run can never distort the table it qualified out of.
 */
export function applyMatchResult(
  cup: WorldCup,
  match: CupMatch,
  homeRuns: number,
  awayRuns: number,
): void {
  match.homeRuns = homeRuns;
  match.awayRuns = awayRuns;
  match.played = true;
  if (match.round === 'group') {
    recordResult(cupTeam(cup, match.homeId), cupTeam(cup, match.awayId), homeRuns, awayRuns);
  }
}

/**
 * Who won a settled match. A group game can be drawn, so this is null there.
 *
 * A knockout game cannot be: simulated ones are rolled until somebody wins and
 * the player's are played with `mustDecide`, so a level score should never
 * reach here. Should one ever manage it, the better seed goes through rather
 * than the bracket stalling — a round that can't name a winner never builds the
 * next round, and the tournament would sit half-played in the save forever.
 */
export function matchWinner(match: CupMatch): string | null {
  if (!match.played || match.homeRuns == null || match.awayRuns == null) return null;
  if (match.homeRuns === match.awayRuns) {
    return match.round === 'group' ? null : match.homeId;
  }
  return match.homeRuns > match.awayRuns ? match.homeId : match.awayId;
}

/* -------------------------------------------------------------- the tables */

/** How a cup table is ordered: record, then wins, then run difference. */
const byRecord = (a: Team, b: Team): number =>
  winningPct(b) - winningPct(a) ||
  b.wins - a.wins ||
  runDiff(b) - runDiff(a) ||
  (b.strength ?? 0) - (a.strength ?? 0);

export function groupTable(cup: WorldCup, groupId: string): Team[] {
  const group = cup.groups.find((g) => g.id === groupId);
  if (!group) return [];
  return group.teamIds.map((id) => cupTeam(cup, id)).sort(byRecord);
}

/** The group a team was drawn into. */
export function groupOf(cup: WorldCup, teamId: string): CupGroup | null {
  return cup.groups.find((g) => g.teamIds.includes(teamId)) ?? null;
}

export const groupStageDone = (cup: WorldCup): boolean =>
  cup.matches.filter((m) => m.round === 'group').every((m) => m.played);

/**
 * Who goes through: every group winner, then the eight best records among
 * everybody else. Returned in seed order, so the bracket can be built off the
 * index alone.
 */
export function qualifiers(cup: WorldCup): Team[] {
  const winners: Team[] = [];
  const rest: Team[] = [];

  for (const group of cup.groups) {
    const table = groupTable(cup, group.id);
    winners.push(table[0]);
    rest.push(...table.slice(1));
  }

  winners.sort(byRecord);
  rest.sort(byRecord);
  return [...winners, ...rest.slice(0, KNOCKOUT_TEAMS - winners.length)];
}

/**
 * The standard sixteen-team bracket, as seed pairs. Written out rather than
 * derived: this ordering is what guarantees the top two seeds can only meet in
 * the final, and it is far easier to check by eye than to prove.
 */
const R16_SEEDS: [number, number][] = [
  [1, 16],
  [8, 9],
  [5, 12],
  [4, 13],
  [3, 14],
  [6, 11],
  [7, 10],
  [2, 15],
];

/** Seed the knockout stage from the finished group tables. */
export function buildKnockout(cup: WorldCup): void {
  if (cup.seeds) return;
  const through = qualifiers(cup);
  cup.seeds = through.map((t) => t.id);

  cup.matches.push(
    ...R16_SEEDS.map(([high, low], i) => ({
      id: `r16-${i}`,
      round: 'r16' as CupRound,
      homeId: through[high - 1].id,
      awayId: through[low - 1].id,
      homeSeed: high,
      awaySeed: low,
      played: false,
    })),
  );
}

export const matchesIn = (cup: WorldCup, round: CupRound): CupMatch[] =>
  cup.matches.filter((m) => m.round === round);

/**
 * Pair the winners of a finished round into the next one. Winners are taken in
 * bracket order and paired adjacently, which is what keeps the halves of the
 * draw apart until they are meant to meet.
 */
function buildNextRound(cup: WorldCup, round: CupRound): CupRound | null {
  const at = KNOCKOUT_ROUNDS.indexOf(round);
  const next = KNOCKOUT_ROUNDS[at + 1];
  if (!next) return null;
  if (matchesIn(cup, next).length > 0) return next;

  const played = matchesIn(cup, round);
  if (played.length === 0 || !played.every((m) => m.played)) return null;
  const winners = played.map((m) => matchWinner(m)).filter((id): id is string => id != null);
  if (winners.length !== played.length) return null;

  const seedOf = (id: string): number => (cup.seeds?.indexOf(id) ?? -1) + 1;

  for (let i = 0; i < winners.length; i += 2) {
    // The better seed is the nominal home side.
    const pair = [winners[i], winners[i + 1]].sort((a, b) => seedOf(a) - seedOf(b));
    cup.matches.push({
      id: `${next}-${i / 2}`,
      round: next,
      homeId: pair[0],
      awayId: pair[1],
      homeSeed: seedOf(pair[0]),
      awaySeed: seedOf(pair[1]),
      played: false,
    });
  }
  return next;
}

/* ---------------------------------------------------------------- lookups */

export function cupTeam(cup: WorldCup, id: string): Team {
  return cup.teams.find((t) => t.id === id) ?? cup.teams[0];
}

/** The nation the player represents, as a team. */
export const cupPlayerTeam = (cup: WorldCup): Team => cupTeam(cup, cup.nationId);

export function cupMatch(cup: WorldCup, id: string): CupMatch | null {
  return cup.matches.find((m) => m.id === id) ?? null;
}

/** The cup match a scheduled game is, if it is one. */
export function matchForGame(cup: WorldCup, game: ScheduledGame): CupMatch | null {
  return game.worldCup ? cupMatch(cup, game.worldCup.matchId) : null;
}

/** The park a cup game is played in — the nominal home side's neutral venue. */
export function cupPark(cup: WorldCup, game: ScheduledGame): Ballpark {
  const match = matchForGame(cup, game);
  const hostId = match ? match.homeId : cup.nationId;
  return ballparkById(cupTeam(cup, hostId).parkId);
}

/**
 * The level a cup game is played at. Synthesised from the opponent rather than
 * looked up, because a national side isn't on the club ladder: the weakest
 * countries pitch like Triple-A and the strongest a shade above the majors, so
 * one tournament spans the whole range the swing knows.
 */
export function cupLevel(opponent: Team): LeagueLevel {
  const strength = opponent.strength ?? 50;
  return {
    id: 3,
    name: 'World Tournament',
    short: 'WT',
    pitcherRating: nationPitching(strength),
    defenseRating: clamp(50 + strength * 0.34, 30, 92),
    promotionOverall: 999,
    promotionScore: 999,
    // A full house, every night. It is the biggest stage there is.
    crowd: 1,
  };
}

/** The player's next unplayed cup match, if the run is still alive. */
export function playerMatch(cup: WorldCup): CupMatch | null {
  return (
    cup.matches.find(
      (m) => !m.played && (m.homeId === cup.nationId || m.awayId === cup.nationId),
    ) ?? null
  );
}

/** Is this team still in it? */
export function stillAlive(cup: WorldCup, teamId: string): boolean {
  if (cup.complete) return cup.championId === teamId;
  return cup.matches.some((m) => !m.played && (m.homeId === teamId || m.awayId === teamId));
}

/* ------------------------------------------------------------- scheduling */

/**
 * Put a cup game on the front of the calendar. Cup days are *inserted at the
 * current day* rather than pushed onto the end, because the tournament runs
 * before opening day — pushing would land it after the whole club season, which
 * is where the postseason belongs and the world tournament very much does not.
 */
function scheduleCupGame(
  league: LeagueState,
  match: CupMatch,
  nationId: string,
  rng: Rng,
  restFirst: boolean,
): void {
  const game: ScheduledGame = {
    index: league.schedule.length,
    opponentId: match.homeId === nationId ? match.awayId : match.homeId,
    home: match.homeId === nationId,
    played: false,
    weather: rollWeather(rng),
    worldCup: { matchId: match.id, round: match.round },
  };
  league.schedule.push(game);

  const days = restFirst
    ? [{ gameIndex: null }, { gameIndex: game.index }]
    : [{ gameIndex: game.index }];
  league.calendar.splice(league.day, 0, ...days);
}

/** The player's three group games, with a day between them to train on. */
function scheduleGroupStage(league: LeagueState, cup: WorldCup, rng: Rng): void {
  const mine = cup.matches
    .filter(
      (m) => m.round === 'group' && (m.homeId === cup.nationId || m.awayId === cup.nationId),
    )
    .sort((a, b) => (a.matchday ?? 0) - (b.matchday ?? 0));

  // Inserted back to front, so each lands ahead of the one before it.
  for (let i = mine.length - 1; i >= 0; i--) {
    scheduleCupGame(league, mine[i], cup.nationId, rng, i > 0);
  }
}

/* ------------------------------------------------------------ starting one */

export interface CupIntro {
  cup: WorldCup;
  selection: CupSelection;
  /** The clubhouse lines to show on the way in. */
  lines: string[];
}

/**
 * Build this year's tournament and work out whether the player is in it.
 *
 * Called once, at the top of a tournament year — from the create screen for
 * the very first one, and from the season rollover after that. If the player is
 * picked, their group games go on the front of the calendar; if not, the whole
 * thing is played out on the spot so there is a result to read.
 */
export function startWorldCup(save: SaveData, rng: Rng, overall: number): CupIntro {
  const { player, league } = save;
  const nation = nationById(player.country);

  const teams = NATIONS.map((n, i) => nationTeam(n, i, rng));
  const groups = drawGroups(teams, rng);

  const bar = squadBar(nation);
  const mvpCount = save.awards.filter((a) => a.playerFinish === 1).length;
  const yourCase = selectionCase(overall, league.levelId, mvpCount);

  const cup: WorldCup = {
    year: save.seasonYear,
    teams,
    groups,
    matches: groups.flatMap(groupMatches),
    nationId: cupTeamId(nation.id),
    selection: 'in',
    bar,
    yourCase,
    complete: false,
    playerResult: 'alive',
    playerStats: emptyTournamentLine(),
  };

  cup.selection = league.levelId < CUP_ELIGIBLE_LEVEL ? 'level' : yourCase >= bar ? 'in' : 'cut';

  save.worldCup = cup;

  if (cup.selection === 'in') {
    scheduleGroupStage(league, cup, rng);
    return { cup, selection: 'in', lines: introLines(cup, nation) };
  }

  cup.playerResult = 'missed';
  simulateRest(cup, rng);
  finishCup(save, cup, rng);
  return { cup, selection: cup.selection, lines: introLines(cup, nation) };
}

function introLines(cup: WorldCup, nation: Nation): string[] {
  const group = groupOf(cup, cup.nationId);
  const rivals = group
    ? group.teamIds
        .filter((id) => id !== cup.nationId)
        .map((id) => nationOfTeam(id).name)
        .join(', ')
    : '';

  if (cup.selection === 'in') {
    return [
      `You have been called up by ${nation.name} for the Baseball World Trophy.`,
      group ? `Group ${group.id}: ${rivals}.` : '',
      'Three group games. Win the group, or finish among the best of the rest, and you are into the last sixteen.',
    ].filter(Boolean);
  }

  const champ = cup.championId ? nationOfTeam(cup.championId).name : 'Nobody';
  const why =
    cup.selection === 'level'
      ? `${nation.name} only pick from Triple-A and the majors. You are not on the list yet.`
      : `${nation.name} wanted a ${cup.bar} overall. Your case came to ${cup.yourCase}.`;

  return [
    `You did not make the ${nation.name} squad for the Baseball World Trophy.`,
    why,
    `${champ} lifted the Trough.`,
  ];
}

/* --------------------------------------------------------- running it along */

/** Play out every match left, round by round, through to the trophy. */
function simulateRest(cup: WorldCup, rng: Rng): void {
  for (const match of cup.matches) {
    if (match.round === 'group') resolveMatch(cup, match, rng);
  }
  buildKnockout(cup);

  for (const round of KNOCKOUT_ROUNDS) {
    for (const match of matchesIn(cup, round)) resolveMatch(cup, match, rng);
    buildNextRound(cup, round);
  }

  crownChampion(cup);
}

function crownChampion(cup: WorldCup): void {
  const final = matchesIn(cup, 'final')[0];
  const winner = final ? matchWinner(final) : null;
  if (!final || !winner) return;
  cup.championId = winner;
  cup.runnerUpId = winner === final.homeId ? final.awayId : final.homeId;
  cup.complete = true;
  if (winner === cup.nationId) cup.playerResult = 'champion';
}

export interface CupGameOutcome {
  round: CupRound;
  /** Your country. */
  nation: string;
  opponent: string;
  status: 'group' | 'advanced' | 'eliminated' | 'champion';
  /** Where the result leaves you, in a sentence. */
  note: string;
  /** True once the tournament has crowned somebody. */
  cupComplete: boolean;
  championName?: string;
  /** True on a game that put you in, or was, the final. Feeds the trophy case. */
  finalist: boolean;
}

/**
 * Record a cup game the player just played and move the tournament along:
 * settle the rest of the round, seed the next one, and either put the next game
 * on the calendar or play the tournament out without you.
 *
 * Mirrors `recordPlayoffGame` deliberately — the game screen shouldn't have to
 * hold two different mental models of "what happens after the last out".
 */
export function recordCupGame(
  save: SaveData,
  game: ScheduledGame,
  playerRuns: number,
  opponentRuns: number,
  rng: Rng,
): CupGameOutcome | null {
  const cup = save.worldCup;
  if (!cup) return null;
  const match = matchForGame(cup, game);
  if (!match || match.played) return null;

  const me = cup.nationId;
  const iAmHome = match.homeId === me;
  const opponentId = iAmHome ? match.awayId : match.homeId;
  applyMatchResult(
    cup,
    match,
    iAmHome ? playerRuns : opponentRuns,
    iAmHome ? opponentRuns : playerRuns,
  );

  const base = {
    round: match.round,
    nation: nationOfTeam(me).name,
    opponent: nationOfTeam(opponentId).name,
  };

  if (match.round === 'group') {
    // Everybody else in the tournament plays the same day.
    for (const other of cup.matches) {
      if (other.round === 'group' && other.matchday === match.matchday) {
        resolveMatch(cup, other, rng);
      }
    }
    if (!groupStageDone(cup)) {
      return {
        ...base,
        status: 'group',
        note: groupNote(cup),
        cupComplete: false,
        finalist: false,
      };
    }

    // Group stage over: seed the bracket, then see whether you're in it.
    buildKnockout(cup);
    return finishRound(save, cup, base, rng);
  }

  // Knockout. Settle the rest of the round before deciding what comes next.
  for (const other of matchesIn(cup, match.round)) resolveMatch(cup, other, rng);
  buildNextRound(cup, match.round);
  return finishRound(save, cup, base, rng);
}

/** Where the group table leaves you, mid-stage. */
function groupNote(cup: WorldCup): string {
  const group = groupOf(cup, cup.nationId);
  if (!group) return '';
  const table = groupTable(cup, group.id);
  const me = cupTeam(cup, cup.nationId);
  const place = table.findIndex((t) => t.id === cup.nationId) + 1;
  const suffix = place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th';
  const left = GROUP_MATCHDAYS - (me.wins + me.losses + (me.ties ?? 0));
  return (
    `${place}${suffix} in Group ${group.id} at ${me.wins}-${me.losses}` +
    ((me.ties ?? 0) > 0 ? `-${me.ties}` : '') +
    (left > 0 ? ` · ${left} group game${left === 1 ? '' : 's'} to go.` : '.')
  );
}

/**
 * Shared tail for "a round just finished": either you're through and the next
 * game goes on the calendar, or you're out and the rest of the tournament
 * happens without you.
 */
function finishRound(
  save: SaveData,
  cup: WorldCup,
  base: { round: CupRound; nation: string; opponent: string },
  rng: Rng,
): CupGameOutcome {
  const next = playerMatch(cup);

  if (next) {
    scheduleCupGame(save.league, next, cup.nationId, rng, true);
    const against = nationOfTeam(next.homeId === cup.nationId ? next.awayId : next.homeId).name;
    return {
      ...base,
      status: 'advanced',
      note:
        base.round === 'group'
          ? `You are through to the ${ROUND_LABEL.r16}, against ${against}.`
          : `Into the ${ROUND_LABEL[next.round]}, against ${against}.`,
      cupComplete: false,
      finalist: next.round === 'final',
    };
  }

  // No next game: either the trophy is yours, or the run is over.
  const final = matchesIn(cup, 'final')[0];
  const wonFinal = base.round === 'final' && final && matchWinner(final) === cup.nationId;

  if (wonFinal) {
    crownChampion(cup);
    finishCup(save, cup, rng);
    return {
      ...base,
      status: 'champion',
      note: `${base.nation} are world champions. The Trough is yours.`,
      cupComplete: true,
      championName: base.nation,
      finalist: true,
    };
  }

  cup.playerResult = 'eliminated';
  cup.eliminatedIn = base.round;
  simulateRest(cup, rng);
  finishCup(save, cup, rng);
  const champ = cup.championId ? nationOfTeam(cup.championId).name : 'Nobody';
  return {
    ...base,
    status: 'eliminated',
    note:
      base.round === 'group'
        ? `${base.nation} go out in the group stage. ${champ} went on to lift the Trough.`
        : `Out in the ${ROUND_LABEL[base.round]}. ${champ} lifted the Trough.`,
    cupComplete: true,
    championName: champ,
    finalist: base.round === 'final',
  };
}

/**
 * Close the books on a tournament: file it in the career history. The state
 * itself stays in the save until the next one replaces it, so the clubhouse can
 * still show the bracket on the way to opening day.
 */
export function finishCup(save: SaveData, cup: WorldCup, rng: Rng): void {
  if (!cup.complete) simulateRest(cup, rng);
  const history = (save.cupHistory ??= []);
  if (history.some((r) => r.year === cup.year)) return;
  history.push({
    year: cup.year,
    championId: cup.championId ?? '',
    runnerUpId: cup.runnerUpId,
    nationId: cup.nationId,
    playerResult: cup.playerResult,
    eliminatedIn: cup.eliminatedIn,
    playerStats: cup.playerStats.games > 0 ? { ...cup.playerStats } : undefined,
  });
}

/** True while the player still has cup games on the calendar. */
export const cupInProgress = (save: SaveData): boolean =>
  save.worldCup?.selection === 'in' && save.league.schedule.some((g) => g.worldCup && !g.played);
