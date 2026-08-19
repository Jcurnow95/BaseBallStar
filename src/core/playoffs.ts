/**
 * The postseason. When the regular season ends the top four clubs go into a
 * two-round bracket: two best-of-three semifinals (1 v 4, 2 v 3) and a
 * best-of-five championship series. Your games are played for real, laid onto
 * the calendar one at a time as each series demands them; every other series
 * is simulated off the clubs' strengths.
 *
 * Playoff results never touch the regular-season table. Wins and losses in a
 * series live on the series.
 */
import type { LeagueState, ScheduledGame, Team } from './league';
import { playoffSeedOrder, teamById, winChance } from './league';
import type { Rng } from './rng';
import { rollWeather } from './weather';

/** How many clubs make it. */
export const PLAYOFF_TEAMS = 4;

export type PlayoffRound = 'semifinal' | 'final';

export const ROUND_LABEL: Record<PlayoffRound, string> = {
  semifinal: 'Semifinal',
  final: 'Championship Series',
};

export interface PlayoffSeries {
  id: string;
  round: PlayoffRound;
  /** Higher seed. Hosts game one, and the decider. */
  highId: string;
  lowId: string;
  highSeed: number;
  lowSeed: number;
  bestOf: 3 | 5;
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

/** The series the player's club is in this round, if any. */
export function playerSeries(league: LeagueState): PlayoffSeries | null {
  const p = league.playoffs;
  if (!p) return null;
  const me = league.playerTeamId;
  return (
    [...p.series]
      .reverse()
      .find((s) => s.highId === me || s.lowId === me) ?? null
  );
}

/** Games in a series that were already played, from the player's schedule. */
export function seriesGamesPlayed(series: PlayoffSeries): number {
  return series.highWins + series.lowWins;
}

/**
 * Who hosts game `n` (1-based). Best-of-three goes high, low, high; best-of-
 * five goes 2-2-1 with the higher seed at home for the decider.
 */
export function hostForGame(series: PlayoffSeries, gameNo: number): string {
  const highHosts =
    series.bestOf === 3 ? [true, false, true][gameNo - 1] : [true, true, false, false, true][gameNo - 1];
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
 * Seed the bracket. Called once, right after the last regular-season game. If
 * the player's club is in, the first game goes on the calendar after a workout
 * day; if not, the whole postseason plays out on the spot.
 */
export function startPlayoffs(league: LeagueState, rng: Rng): Playoffs {
  if (league.playoffs) return league.playoffs;

  const seeds = playoffSeedOrder(league).slice(0, PLAYOFF_TEAMS).map((t) => t.id);
  const playoffs: Playoffs = {
    seeds,
    series: [
      makeSeries('semi-a', 'semifinal', seeds, 1, 4, 3),
      makeSeries('semi-b', 'semifinal', seeds, 2, 3, 3),
    ],
    complete: false,
    playerResult: seeds.includes(league.playerTeamId) ? 'alive' : 'missed',
  };
  league.playoffs = playoffs;
  league.regularDays = league.regularDays ?? league.calendar.length;

  if (playoffs.playerResult === 'missed') {
    simulateRemaining(league, rng);
  } else {
    // A day off to catch your breath, then game one.
    league.calendar.push({ gameIndex: null });
    scheduleNextGame(league, rng);
  }
  return playoffs;
}

function makeSeries(
  id: string,
  round: PlayoffRound,
  seeds: string[],
  highSeed: number,
  lowSeed: number,
  bestOf: 3 | 5,
): PlayoffSeries {
  return {
    id,
    round,
    highId: seeds[highSeed - 1],
    lowId: seeds[lowSeed - 1],
    highSeed,
    lowSeed,
    bestOf,
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

/** Play out a series with nobody watching. */
function simulateSeries(league: LeagueState, series: PlayoffSeries, rng: Rng): void {
  const high = teamById(league, series.highId);
  const low = teamById(league, series.lowId);
  let guard = 0;
  while (!seriesOver(series) && guard++ < 20) {
    // A little home cooking: the host gets a nudge.
    const highHosts = hostForGame(series, seriesGamesPlayed(series) + 1) === series.highId;
    const p = winChance(high, low) + (highHosts ? 0.04 : -0.04);
    creditWin(series, rng.chance(p) ? series.highId : series.lowId);
  }
}

/** Once both semifinals are settled, the final exists. */
function ensureFinal(league: LeagueState): PlayoffSeries | null {
  const p = league.playoffs;
  if (!p) return null;
  const existing = p.series.find((s) => s.round === 'final');
  if (existing) return existing;
  const semis = p.series.filter((s) => s.round === 'semifinal');
  if (!semis.every(seriesOver)) return null;
  const winners = semis.map((s) => s.winnerId as string);
  const seedOf = (id: string): number => p.seeds.indexOf(id) + 1;
  const [a, b] = [...winners].sort((x, y) => seedOf(x) - seedOf(y));
  const final: PlayoffSeries = {
    id: 'final',
    round: 'final',
    highId: a,
    lowId: b,
    highSeed: seedOf(a),
    lowSeed: seedOf(b),
    bestOf: 5,
    highWins: 0,
    lowWins: 0,
  };
  p.series.push(final);
  return final;
}

/** Simulate every series the player isn't in, through to the trophy. */
function simulateRemaining(league: LeagueState, rng: Rng): void {
  const p = league.playoffs;
  if (!p) return;
  const me = league.playerTeamId;
  for (const s of p.series) {
    if (!seriesOver(s) && s.highId !== me && s.lowId !== me) simulateSeries(league, s, rng);
  }
  const final = ensureFinal(league);
  if (final && !seriesOver(final) && final.highId !== me && final.lowId !== me) {
    simulateSeries(league, final, rng);
  }
  if (final && seriesOver(final)) {
    p.complete = true;
    p.championId = final.winnerId;
    if (p.championId === me) p.playerResult = 'champion';
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
 * bracket along: schedule the next game of the series, or settle the round and
 * line up the next one, or hand out the trophy.
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
    p.complete = true;
    p.championId = me;
    p.playerResult = 'champion';
    return { ...base, seriesOver: true, status: 'champion' };
  }

  // Through to the final. Settle the other semi, then a day off, then game one.
  for (const s of p.series) {
    if (s.round === 'semifinal' && !seriesOver(s)) simulateSeries(league, s, rng);
  }
  ensureFinal(league);
  league.calendar.push({ gameIndex: null });
  scheduleNextGame(league, rng);
  return { ...base, seriesOver: true, status: 'advanced' };
}
