import type { LeagueState, ScheduledGame, TeamRecord } from './league';
import { playerTeam, regularSeasonGames, runDiff, teamById, winningPct } from './league';

/**
 * The season read as a season, rather than as a running total: every fixture
 * on the card, and the splits a real standings page carries underneath the
 * W-L — home and away, one-run games, extras, shutouts, the current streak.
 *
 * All of it is derived from `league.schedule`, which has stored the score of
 * every game it played all along. Nothing here is saved; a career from before
 * this screen existed opens it and sees its whole season sitting there.
 */

/** How a game turned out for the player's club. */
export type FixtureResult = 'win' | 'loss' | 'tie';

/** A won-lost-tied count, for the whole season or any slice of it. */
export interface Tally {
  wins: number;
  losses: number;
  ties: number;
}

/** One row of the season log — a game played, or one still to come. */
export interface Fixture {
  /** Game number on the card, 1-based. */
  game: number;
  opponent: string;
  home: boolean;
  played: boolean;
  /** Runs scored and allowed. Absent until the game is played. */
  runsFor?: number;
  runsAgainst?: number;
  result?: FixtureResult;
  /** Nine unless it went to extras. Absent on a game played before this was tracked. */
  innings?: number;
  /** The club's record after this game, so the log reads like a season. */
  record?: Tally;
}

/** The whole season in one object. See `seasonSplits`. */
export interface SeasonSplits {
  /** Regular-season games played, ties included. */
  played: number;
  overall: Tally;
  /** Winning percentage, ties set aside — the way baseball counts it. */
  pct: number;
  runsFor: number;
  runsAgainst: number;
  diff: number;
  runsPerGame: number;
  runsAllowedPerGame: number;
  home: Tally;
  away: Tally;
  /** Games decided by a single run — the mark of a season lived on the edge. */
  oneRun: Tally;
  /** Games that went past the ninth. Ties live here too: they are the ones extras couldn't settle. */
  extras: Tally;
  /** Games decided by five or more. */
  blowouts: Tally;
  /** Opponents held scoreless, and times the club was. */
  shutoutsFor: number;
  shutoutsAgainst: number;
  /** The current run of the same result, or null before a game is played. */
  streak: { result: FixtureResult; length: number } | null;
  lastTen: Tally;
  /** Biggest win and heaviest defeat, by margin. */
  bestWin: Fixture | null;
  worstLoss: Fixture | null;
  /**
   * The record the run totals say the club deserved — Bill James' pythagorean
   * expectation, the standard read on whether a season is luck or level. Sums
   * to the same number of decided games as the real record, so the two lines
   * sit side by side.
   */
  pythagorean: { wins: number; losses: number };
}

const emptyTally = (): Tally => ({ wins: 0, losses: 0, ties: 0 });

const credit = (t: Tally, result: FixtureResult): void => {
  if (result === 'win') t.wins++;
  else if (result === 'loss') t.losses++;
  else t.ties++;
};

/** Runs scored less runs allowed, on a played fixture. */
const margin = (f: Fixture): number => (f.runsFor ?? 0) - (f.runsAgainst ?? 0);

/** A game that needed more than the regulation nine. */
export const wentToExtras = (f: Fixture): boolean => (f.innings ?? 9) > 9;

/** A record as it is written: 12-9, or 12-9-1 when there is a tie to show. */
export const formatTally = (t: Tally): string =>
  t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`;

/** A winning percentage as a scoreboard writes it: .625, no leading zero. */
export function formatPct(pct: number): string {
  const rounded = pct.toFixed(3);
  return rounded.startsWith('0') ? rounded.slice(1) : rounded;
}

/** A run differential with its sign kept: +18, -4, or an even 0. */
export const formatDiff = (diff: number): string => (diff > 0 ? `+${diff}` : String(diff));

/** How a fixture turned out, from the player's dugout. */
function resultOf(game: ScheduledGame): FixtureResult {
  const us = game.playerTeamScore ?? 0;
  const them = game.opponentScore ?? 0;
  return us > them ? 'win' : us < them ? 'loss' : 'tie';
}

/**
 * The season card: every regular-season fixture in order, played ones carrying
 * their score and the record they left behind, the rest waiting with just an
 * opponent and a ground.
 */
export function seasonLog(league: LeagueState): Fixture[] {
  const running = emptyTally();

  return regularSeasonGames(league).map((game) => {
    const fixture: Fixture = {
      game: game.index + 1,
      opponent: teamById(league, game.opponentId).name,
      home: game.home,
      played: game.played,
    };
    if (!game.played) return fixture;

    fixture.runsFor = game.playerTeamScore ?? 0;
    fixture.runsAgainst = game.opponentScore ?? 0;
    fixture.result = resultOf(game);
    fixture.innings = game.innings;
    credit(running, fixture.result);
    fixture.record = { ...running };
    return fixture;
  });
}

/** Just the games that have been played, oldest first. */
export const playedFixtures = (log: Fixture[]): Fixture[] => log.filter((f) => f.played);

/**
 * The pythagorean expectation, at the 1.83 exponent James settled on for
 * baseball. Spread over `decided` games so it can be read against a real W-L.
 */
function pythagorean(runsFor: number, runsAgainst: number, decided: number): { wins: number; losses: number } {
  if (decided === 0 || runsFor + runsAgainst === 0) return { wins: 0, losses: 0 };
  const rf = runsFor ** 1.83;
  const expected = Math.round((rf / (rf + runsAgainst ** 1.83)) * decided);
  return { wins: expected, losses: decided - expected };
}

/** The run of results the club is on right now, counted back from the last game. */
function currentStreak(played: Fixture[]): { result: FixtureResult; length: number } | null {
  const last = played[played.length - 1];
  if (!last?.result) return null;
  let length = 0;
  for (let i = played.length - 1; i >= 0 && played[i].result === last.result; i--) length++;
  return { result: last.result, length };
}

/**
 * Everything the season log adds up to. Built from the fixtures rather than
 * from the club's season counters, so every split is guaranteed to agree with
 * the games listed above it.
 */
export function seasonSplits(league: LeagueState): SeasonSplits {
  const played = playedFixtures(seasonLog(league));

  const overall = emptyTally();
  const home = emptyTally();
  const away = emptyTally();
  const oneRun = emptyTally();
  const extras = emptyTally();
  const blowouts = emptyTally();
  const lastTen = emptyTally();

  let runsFor = 0;
  let runsAgainst = 0;
  let shutoutsFor = 0;
  let shutoutsAgainst = 0;
  let bestWin: Fixture | null = null;
  let worstLoss: Fixture | null = null;

  const tenFrom = Math.max(0, played.length - 10);

  played.forEach((f, i) => {
    const result = f.result!;
    const gap = Math.abs(margin(f));

    credit(overall, result);
    credit(f.home ? home : away, result);
    if (gap === 1) credit(oneRun, result);
    if (gap >= 5) credit(blowouts, result);
    if (wentToExtras(f)) credit(extras, result);
    if (i >= tenFrom) credit(lastTen, result);

    runsFor += f.runsFor ?? 0;
    runsAgainst += f.runsAgainst ?? 0;
    if ((f.runsAgainst ?? 0) === 0) shutoutsFor++;
    if ((f.runsFor ?? 0) === 0) shutoutsAgainst++;

    if (result === 'win' && (!bestWin || gap > Math.abs(margin(bestWin)))) bestWin = f;
    if (result === 'loss' && (!worstLoss || gap > Math.abs(margin(worstLoss)))) worstLoss = f;
  });

  const games = played.length;

  return {
    played: games,
    overall,
    pct: winningPct(overall),
    runsFor,
    runsAgainst,
    diff: runsFor - runsAgainst,
    runsPerGame: games === 0 ? 0 : runsFor / games,
    runsAllowedPerGame: games === 0 ? 0 : runsAgainst / games,
    home,
    away,
    oneRun,
    extras,
    blowouts,
    shutoutsFor,
    shutoutsAgainst,
    streak: currentStreak(played),
    lastTen,
    bestWin,
    worstLoss,
    pythagorean: pythagorean(runsFor, runsAgainst, overall.wins + overall.losses),
  };
}

/**
 * A club's line for a standings table. Works on any club at any level: the
 * player's own, an opponent, or a name on a table the player only watches.
 */
export interface StandingsLine {
  wins: number;
  losses: number;
  ties: number;
  pct: number;
  runsFor: number;
  runsAgainst: number;
  diff: number;
}

export function standingsLine(team: TeamRecord): StandingsLine {
  return {
    wins: team.wins,
    losses: team.losses,
    ties: team.ties ?? 0,
    pct: winningPct(team),
    runsFor: team.runsFor ?? 0,
    runsAgainst: team.runsAgainst ?? 0,
    diff: runDiff(team),
  };
}

/**
 * Games behind the leader, in the usual half-game currency. Ties sit outside
 * it, exactly as they sit outside winning percentage.
 */
export function gamesBack(leader: StandingsLine, t: StandingsLine): string {
  const gb = (leader.wins - t.wins + (t.losses - leader.losses)) / 2;
  if (gb <= 0) return '—';
  return gb % 1 === 0 ? String(gb) : gb.toFixed(1);
}

/** The player's club, as a standings line. */
export const playerLine = (league: LeagueState): StandingsLine => standingsLine(playerTeam(league));
