/**
 * The postseason. When the regular season ends the top six clubs go into a
 * three-round bracket. Seeds 1 and 2 sit out a best-of-three wildcard round
 * (3 v 6, 4 v 5); the semifinals are reseeded, so the top seed gets the
 * lowest survivor, and go best-of-five; the championship series is best of
 * seven. Your games are played for real, laid onto the calendar one at a
 * time as each series demands them. Every series you aren't in plays one
 * game a day as the calendar turns (see `advancePlayoffs`), so a bye is a
 * few workout days while the wildcard round sorts itself out, not a
 * bracket that has already decided itself.
 *
 * Playoff results never touch the regular-season table. Wins and losses in a
 * series live on the series.
 */
import type { LeagueState, ScheduledGame, Team } from './league';
import { playoffSeedOrder, teamById, winChance } from './league';
import type { Rng } from './rng';
import { rollWeather } from './weather';

/** How many clubs make it. */
export const PLAYOFF_TEAMS = 6;
/** How many of them skip the first round. */
export const BYE_SEEDS = 2;

export type PlayoffRound = 'wildcard' | 'semifinal' | 'final';

export const ROUND_ORDER: PlayoffRound[] = ['wildcard', 'semifinal', 'final'];

export const ROUND_LABEL: Record<PlayoffRound, string> = {
  wildcard: 'Wildcard Round',
  semifinal: 'Semifinal',
  final: 'Championship Series',
};

export const ROUND_BEST_OF: Record<PlayoffRound, 3 | 5 | 7> = {
  wildcard: 3,
  semifinal: 5,
  final: 7,
};

export interface PlayoffSeries {
  id: string;
  round: PlayoffRound;
  /** Higher seed. Hosts game one, and the decider. */
  highId: string;
  lowId: string;
  highSeed: number;
  lowSeed: number;
  bestOf: 3 | 5 | 7;
  highWins: number;
  lowWins: number;
  winnerId?: string;
}

export interface Playoffs {
  /** Team ids, best record first. */
  seeds: string[];
  series: PlayoffSeries[];
  /** True once the trophy has been handed out. */
  complete: boolean;
  championId?: string;
  /** How your postseason went, filled in as it happens. */
  playerResult: 'alive' | 'missed' | 'eliminated' | 'champion';
  /** The round you went out in, if you did. */
  eliminatedIn?: PlayoffRound;
}

export const winsNeeded = (series: PlayoffSeries): number => Math.ceil(series.bestOf / 2);

export const seriesOver = (series: PlayoffSeries): boolean => series.winnerId != null;

const involves = (series: PlayoffSeries, id: string): boolean =>
  series.highId === id || series.lowId === id;

/** Whether a club skipped the wildcard round. */
export const hasBye = (p: Playoffs, id: string): boolean => {
  const at = p.seeds.indexOf(id);
  return at >= 0 && at < BYE_SEEDS;
};

/** The series the player's club is in this round, if any. */
export function playerSeries(league: LeagueState): PlayoffSeries | null {
  const p = league.playoffs;
  if (!p) return null;
  const me = league.playerTeamId;
  return [...p.series].reverse().find((s) => involves(s, me)) ?? null;
}

/** Games in a series that were already played, from the player's schedule. */
export function seriesGamesPlayed(series: PlayoffSeries): number {
  return series.highWins + series.lowWins;
}

/** Who the higher seed hosts, game by game: 1-1-1, 2-2-1 and 2-2-1-1-1. */
const HOST_PATTERN: Record<3 | 5 | 7, boolean[]> = {
  3: [true, false, true],
  5: [true, true, false, false, true],
  7: [true, true, false, false, true, false, true],
};

/** Who hosts game `n` (1-based). The higher seed always has the decider. */
export function hostForGame(series: PlayoffSeries, gameNo: number): string {
  const highHosts = HOST_PATTERN[series.bestOf][gameNo - 1] ?? true;
  return highHosts ? series.highId : series.lowId;
}

/** Score line from the player's point of view, e.g. "2–1". */
export function seriesLine(league: LeagueState, series: PlayoffSeries): { us: number; them: number } {
  const meHigh = series.highId === league.playerTeamId;
  return meHigh
    ? { us: series.highWins, them: series.lowWins }
    : { us: series.lowWins, them: series.highWins };
}

/** The opponent in a series from the player's point of view. */
export function seriesOpponent(league: LeagueState, series: PlayoffSeries): Team {
  return teamById(league, series.highId === league.playerTeamId ? series.lowId : series.highId);
}

/**
 * Seed the bracket. Called once, right after the last regular-season game.
 * A club in the wildcard round gets a day off and then game one; a club
 * with a bye gets the day off and then waits on the wildcards, a game a
 * day. A club that missed out watches the whole thing play out on the spot.
 */
export function startPlayoffs(league: LeagueState, rng: Rng): Playoffs {
  if (league.playoffs) return league.playoffs;

  const seeds = playoffSeedOrder(league).slice(0, PLAYOFF_TEAMS).map((t) => t.id);
  const playoffs: Playoffs = {
    seeds,
    series: [],
    complete: false,
    playerResult: seeds.includes(league.playerTeamId) ? 'alive' : 'missed',
  };
  // 3 v 6 and 4 v 5; the top two watch.
  playoffs.series.push(
    makeSeries(playoffs, 'wc-a', 'wildcard', seeds[BYE_SEEDS], seeds[PLAYOFF_TEAMS - 1]),
    makeSeries(playoffs, 'wc-b', 'wildcard', seeds[BYE_SEEDS + 1], seeds[PLAYOFF_TEAMS - 2]),
  );
  league.playoffs = playoffs;
  league.regularDays = league.regularDays ?? league.calendar.length;

  if (playoffs.playerResult === 'missed') {
    simulateRemaining(league, rng);
    return playoffs;
  }

  // A day off to catch your breath, then game one — or, on a bye, then the
  // wait while the wildcards play.
  league.calendar.push({ gameIndex: null });
  if (playerSeries(league)) scheduleNextGame(league, rng);
  return playoffs;
}

function makeSeries(p: Playoffs, id: string, round: PlayoffRound, a: string, b: string): PlayoffSeries {
  const seedOf = (teamId: string): number => p.seeds.indexOf(teamId) + 1;
  // The better seed is always the high side, whoever was handed in first.
  const [highId, lowId] = seedOf(a) <= seedOf(b) ? [a, b] : [b, a];
  return {
    id,
    round,
    highId,
    lowId,
    highSeed: seedOf(highId),
    lowSeed: seedOf(lowId),
    bestOf: ROUND_BEST_OF[round],
    highWins: 0,
    lowWins: 0,
  };
}

/** Put the player's next series game on the schedule and the calendar. */
function scheduleNextGame(league: LeagueState, rng: Rng): void {
  const series = playerSeries(league);
  if (!series || seriesOver(series)) return;
  const gameNo = seriesGamesPlayed(series) + 1;
  const hostId = hostForGame(series, gameNo);
  const game: ScheduledGame = {
    index: league.schedule.length,
    opponentId: seriesOpponent(league, series).id,
    home: hostId === league.playerTeamId,
    played: false,
    weather: rollWeather(rng),
    playoff: { seriesId: series.id, gameNo },
  };
  league.schedule.push(game);
  league.calendar.push({ gameIndex: game.index });
}

/** One team's win in a series; settles it when someone reaches the mark. */
function creditWin(series: PlayoffSeries, winnerId: string): void {
  if (winnerId === series.highId) series.highWins++;
  else series.lowWins++;
  const need = winsNeeded(series);
  if (series.highWins >= need) series.winnerId = series.highId;
  else if (series.lowWins >= need) series.winnerId = series.lowId;
}

/** One game of a series nobody is watching. A little home cooking for the host. */
function simulateGame(league: LeagueState, series: PlayoffSeries, rng: Rng): void {
  if (seriesOver(series)) return;
  const high = teamById(league, series.highId);
  const low = teamById(league, series.lowId);
  const highHosts = hostForGame(series, seriesGamesPlayed(series) + 1) === series.highId;
  const p = winChance(high, low) + (highHosts ? 0.04 : -0.04);
  creditWin(series, rng.chance(p) ? series.highId : series.lowId);
}

/** Play out a series with nobody watching. */
function simulateSeries(league: LeagueState, series: PlayoffSeries, rng: Rng): void {
  let guard = 0;
  while (!seriesOver(series) && guard++ < 20) simulateGame(league, series, rng);
}

/**
 * Build whatever round the finished ones allow: the semifinals once both
 * wildcards are settled, reseeded so the top seed meets the lowest
 * survivor; the final once both semifinals are. Returns true when a new
 * series was made. Idempotent — a round is only ever built once.
 */
function ensureRounds(p: Playoffs): boolean {
  const seedOf = (id: string): number => p.seeds.indexOf(id) + 1;
  const bySeed = (ids: string[]): string[] => [...ids].sort((x, y) => seedOf(x) - seedOf(y));
  const inRound = (round: PlayoffRound): PlayoffSeries[] => p.series.filter((s) => s.round === round);

  const wildcards = inRound('wildcard');
  if (inRound('semifinal').length === 0) {
    if (!wildcards.every(seriesOver)) return false;
    const survivors = bySeed([
      ...p.seeds.slice(0, BYE_SEEDS),
      ...wildcards.map((s) => s.winnerId as string),
    ]);
    p.series.push(
      makeSeries(p, 'semi-a', 'semifinal', survivors[0], survivors[3]),
      makeSeries(p, 'semi-b', 'semifinal', survivors[1], survivors[2]),
    );
    return true;
  }

  const semis = inRound('semifinal');
  if (inRound('final').length === 0) {
    if (!semis.every(seriesOver)) return false;
    const [a, b] = bySeed(semis.map((s) => s.winnerId as string));
    p.series.push(makeSeries(p, 'final', 'final', a, b));
    return true;
  }
  return false;
}

/** Hand out the trophy once the final is settled. */
function settle(league: LeagueState): void {
  const p = league.playoffs;
  if (!p) return;
  const final = p.series.find((s) => s.round === 'final');
  if (final && seriesOver(final)) {
    p.complete = true;
    p.championId = final.winnerId;
    if (p.championId === league.playerTeamId) p.playerResult = 'champion';
  }
}

/**
 * If the player's last series is won and the next round has just formed,
 * give them a day off and put game one on the calendar.
 */
function lineUpPlayer(league: LeagueState, rng: Rng): void {
  const series = playerSeries(league);
  if (!series || seriesOver(series)) return;
  // Already on the calendar? Then nothing to do.
  const scheduled = league.schedule.some(
    (g) => !g.played && g.playoff?.seriesId === series.id,
  );
  if (scheduled) return;
  league.calendar.push({ gameIndex: null });
  scheduleNextGame(league, rng);
}

/**
 * A day passes in the postseason. Every series the player isn't in plays a
 * game, and when a round is settled the next one is built and the player's
 * game goes on the calendar. Called from `advanceDay`, so a bye seed's
 * workout days and a wildcard club's own game days both move the bracket.
 */
export function advancePlayoffs(league: LeagueState, rng: Rng): void {
  const p = league.playoffs;
  if (!p || p.complete || p.playerResult !== 'alive') return;
  const me = league.playerTeamId;
  for (const s of p.series) {
    if (!seriesOver(s) && !involves(s, me)) simulateGame(league, s, rng);
  }
  // Our own series is on the calendar game by game; only a finished one
  // (or none at all, on a bye) means there's a round to move on to.
  const mine = playerSeries(league);
  if (mine && !seriesOver(mine)) return;
  ensureRounds(p);
  lineUpPlayer(league, rng);
}

/** Simulate every series the player isn't in, through to the trophy. */
function simulateRemaining(league: LeagueState, rng: Rng): void {
  const p = league.playoffs;
  if (!p) return;
  const me = league.playerTeamId;
  let guard = 0;
  while (!p.complete && guard++ < 8) {
    for (const s of p.series) {
      if (!seriesOver(s) && !involves(s, me)) simulateSeries(league, s, rng);
    }
    if (!ensureRounds(p)) settle(league);
  }
}

export interface PlayoffGameOutcome {
  round: PlayoffRound;
  /** Series tally after this game, from the player's side. */
  us: number;
  them: number;
  bestOf: number;
  seriesOver: boolean;
  /** What the result means for the run. */
  status: 'alive' | 'advanced' | 'eliminated' | 'champion';
  opponent: string;
}

/**
 * Record the result of a playoff game the player just played, and move the
 * bracket along: schedule the next game of the series, or settle the round
 * and line up the next one if it's ready, or hand out the trophy.
 */
export function recordPlayoffGame(
  league: LeagueState,
  game: ScheduledGame,
  playerWon: boolean,
  rng: Rng,
): PlayoffGameOutcome | null {
  const p = league.playoffs;
  if (!p || !game.playoff) return null;
  const series = p.series.find((s) => s.id === game.playoff?.seriesId);
  if (!series) return null;
  const me = league.playerTeamId;
  const opponent = seriesOpponent(league, series);

  creditWin(series, playerWon ? me : opponent.id);
  const line = seriesLine(league, series);
  const base = { round: series.round, ...line, bestOf: series.bestOf, opponent: opponent.name };

  if (!seriesOver(series)) {
    scheduleNextGame(league, rng);
    return { ...base, seriesOver: false, status: 'alive' };
  }

  if (series.winnerId !== me) {
    p.playerResult = 'eliminated';
    p.eliminatedIn = series.round;
    simulateRemaining(league, rng);
    return { ...base, seriesOver: true, status: 'eliminated' };
  }

  if (series.round === 'final') {
    settle(league);
    return { ...base, seriesOver: true, status: 'champion' };
  }

  // Through. If the other series in the round is done the next one starts
  // after a day off; if not, the calendar carries it a game a day.
  ensureRounds(p);
  lineUpPlayer(league, rng);
  return { ...base, seriesOver: true, status: 'advanced' };
}
