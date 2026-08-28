/**
 * Walks whole seasons through the same calls the game screen makes, then
 * checks that the season log adds up.
 *
 * This exists because a tie used to fall off the table entirely: a game called
 * level after twelve innings incremented neither the win column nor the loss
 * column, so a club that tied three games looked like it had three games in
 * hand on everybody. The conservation checks below are the ones that would
 * have caught it — every game has to leave a mark on two clubs, and the runs
 * one club scored have to be the runs another club allowed.
 *
 * Run: npx tsx tools/seasonStats.ts
 */
import {
  SEASON_GAMES,
  advanceDay,
  createLeague,
  gamesPlayed,
  isRegularSeasonOver,
  nextGame,
  recordResult,
  regularSeasonGames,
  simulateOtherTeams,
  teamById,
  winningPct,
} from '../src/core/league';
import type { LeagueState } from '../src/core/league';
import { syncOtherLevels } from '../src/core/otherLeagues';
import type { Fixture, Tally } from '../src/core/seasonStats';
import {
  formatDiff,
  formatPct,
  formatTally,
  seasonLog,
  seasonSplits,
  standingsLine,
} from '../src/core/seasonStats';
import { Rng } from '../src/core/rng';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const tallyTotal = (t: Tally): number => t.wins + t.losses + t.ties;

/**
 * Play a season the way `endGame` does: a real score on every game, a tie
 * every so often, and the rest of the league advanced alongside it.
 */
function playSeason(league: LeagueState, rng: Rng): void {
  while (!isRegularSeasonOver(league)) {
    const game = nextGame(league);
    if (game) {
      const opponent = teamById(league, game.opponentId);
      // Ties on purpose, and often enough that every seed sees some.
      const tie = rng.chance(0.12);
      const us = rng.int(0, 9);
      const them = tie ? us : us + (rng.chance(0.5) ? rng.int(1, 5) : -rng.int(1, 5));

      game.played = true;
      game.playerTeamScore = Math.max(0, us);
      game.opponentScore = Math.max(0, them);
      game.innings = rng.chance(0.15) ? rng.int(10, 12) : 9;
      recordResult(
        teamById(league, league.playerTeamId),
        opponent,
        game.playerTeamScore,
        game.opponentScore,
      );
      simulateOtherTeams(league, rng, [opponent.id]);
    }
    advanceDay(league);
  }
}

console.log('\n=== A season, walked through the screens\' own calls ===\n');

for (const seed of [1, 7, 13, 29, 101]) {
  const rng = new Rng(seed);
  const league = createLeague(2, rng);
  playSeason(league, rng);

  const teams = league.teams;
  const log = seasonLog(league);
  const splits = seasonSplits(league);
  const me = teamById(league, league.playerTeamId);

  check(
    `seed ${seed}: every club played all ${SEASON_GAMES} games`,
    teams.every((t) => gamesPlayed(t) === SEASON_GAMES),
    teams.map((t) => `${t.name} ${gamesPlayed(t)}`).join(', '),
  );

  // The check that a dropped tie fails: a game has to land on two clubs.
  const decisions = teams.reduce((n, t) => n + t.wins + t.losses + (t.ties ?? 0), 0);
  check(
    `seed ${seed}: results are conserved across the league`,
    decisions === SEASON_GAMES * teams.length,
    `${decisions} results for ${(SEASON_GAMES * teams.length) / 2} games`,
  );

  const wins = teams.reduce((n, t) => n + t.wins, 0);
  const losses = teams.reduce((n, t) => n + t.losses, 0);
  const ties = teams.reduce((n, t) => n + (t.ties ?? 0), 0);
  check(`seed ${seed}: wins and losses balance`, wins === losses, `${wins}W ${losses}L`);
  check(`seed ${seed}: ties land on both clubs`, ties % 2 === 0, `${ties} ties`);

  const scored = teams.reduce((n, t) => n + (t.runsFor ?? 0), 0);
  const allowed = teams.reduce((n, t) => n + (t.runsAgainst ?? 0), 0);
  check(
    `seed ${seed}: runs scored are runs allowed`,
    scored === allowed && scored > 0,
    `${scored} for, ${allowed} against`,
  );

  check(`seed ${seed}: the log lists every fixture`, log.length === SEASON_GAMES);
  check(`seed ${seed}: every fixture was played`, log.every((f) => f.played));

  // The log is built from the schedule, the table from the counters. They are
  // two separate paths to the same season and they have to agree.
  check(
    `seed ${seed}: the log agrees with the table`,
    splits.overall.wins === me.wins &&
      splits.overall.losses === me.losses &&
      splits.overall.ties === (me.ties ?? 0) &&
      splits.runsFor === (me.runsFor ?? 0) &&
      splits.runsAgainst === (me.runsAgainst ?? 0),
    `log ${formatTally(splits.overall)} ${splits.runsFor}/${splits.runsAgainst} vs table ${
      me.wins
    }-${me.losses}-${me.ties ?? 0} ${me.runsFor}/${me.runsAgainst}`,
  );

  check(
    `seed ${seed}: home and away split the season`,
    tallyTotal(splits.home) + tallyTotal(splits.away) === splits.played,
  );

  check(
    `seed ${seed}: the last ten is at most ten`,
    tallyTotal(splits.lastTen) === Math.min(10, splits.played),
  );

  check(
    `seed ${seed}: the expected record covers the decided games`,
    splits.pythagorean.wins + splits.pythagorean.losses === splits.overall.wins + splits.overall.losses,
  );

  check(
    `seed ${seed}: the running record ends where the season does`,
    formatTally(log[log.length - 1].record!) === formatTally(splits.overall),
  );

  check(
    `seed ${seed}: percentage sets ties aside`,
    Math.abs(winningPct(me) - me.wins / (me.wins + me.losses)) < 1e-9,
  );

  // The other levels have to balance the same way, or the ladder's tables
  // would tell a different story from the one the player is living.
  const save = { league, otherLevels: [] } as never as Parameters<typeof syncOtherLevels>[0];
  syncOtherLevels(save, rng);
  const farm = (save.otherLevels ?? []).flatMap((t) => t.teams);
  check(
    `seed ${seed}: the other levels balance too`,
    farm.reduce((n, t) => n + (t.runsFor ?? 0), 0) ===
      farm.reduce((n, t) => n + (t.runsAgainst ?? 0), 0),
  );
  check(
    `seed ${seed}: every farm club played the same number of games`,
    (save.otherLevels ?? []).every((table) =>
      table.teams.every((t) => gamesPlayed(t) === gamesPlayed(table.teams[0])),
    ),
  );

  const line = standingsLine(me);
  console.log(
    `        ${me.name}: ${formatTally(splits.overall)} ${formatPct(line.pct)}, ` +
      `${splits.runsFor} RF / ${splits.runsAgainst} RA (${formatDiff(splits.diff)}), ` +
      `home ${formatTally(splits.home)}, away ${formatTally(splits.away)}, ` +
      `1-run ${formatTally(splits.oneRun)}, extras ${formatTally(splits.extras)}, ` +
      `SO ${splits.shutoutsFor}-${splits.shutoutsAgainst}, ` +
      `exp ${splits.pythagorean.wins}-${splits.pythagorean.losses}, ` +
      `streak ${splits.streak ? splits.streak.result[0].toUpperCase() + splits.streak.length : '—'}\n`,
  );
}

console.log('=== A season with known splits ===\n');

/**
 * A hand-built season, so every split can be checked against a number worked
 * out by hand rather than against the code that produced it.
 */
{
  const league = createLeague(0, new Rng(5));
  const results: Array<[us: number, them: number, home: boolean, innings: number]> = [
    [5, 4, true, 9], //  W, one-run, home
    [0, 3, true, 9], //  L, shut out
    [8, 0, false, 9], // W, shutout thrown, away, blowout
    [4, 4, false, 12], // T, extras, away
    [2, 3, true, 11], // L, one-run, extras, home
    [7, 1, true, 9], //  W, blowout, home
    [1, 2, false, 9], // L, one-run, away
    [6, 6, true, 12], // T, extras, home
  ];

  const games = regularSeasonGames(league);
  results.forEach(([us, them, home, innings], i) => {
    const g = games[i];
    g.played = true;
    g.home = home;
    g.playerTeamScore = us;
    g.opponentScore = them;
    g.innings = innings;
  });

  const splits = seasonSplits(league);
  const log = seasonLog(league);

  check('record is 3-3-2', formatTally(splits.overall) === '3-3-2');
  check('percentage sets the two ties aside (.500)', formatPct(splits.pct) === '.500');
  check('33 runs scored', splits.runsFor === 33, String(splits.runsFor));
  check('23 runs allowed', splits.runsAgainst === 23, String(splits.runsAgainst));
  check('differential is +10', formatDiff(splits.diff) === '+10', formatDiff(splits.diff));
  check('4.1 runs a game', splits.runsPerGame.toFixed(1) === '4.1', splits.runsPerGame.toFixed(1));
  check('home is 2-2-1', formatTally(splits.home) === '2-2-1', formatTally(splits.home));
  check('away is 1-1-1', formatTally(splits.away) === '1-1-1', formatTally(splits.away));
  check('three one-run games, 1-2', formatTally(splits.oneRun) === '1-2', formatTally(splits.oneRun));
  check('three extra-inning games, 0-1-2', formatTally(splits.extras) === '0-1-2', formatTally(splits.extras));
  check('two blowouts, both wins', formatTally(splits.blowouts) === '2-0', formatTally(splits.blowouts));
  check('one shutout thrown', splits.shutoutsFor === 1, String(splits.shutoutsFor));
  check('one shutout suffered', splits.shutoutsAgainst === 1, String(splits.shutoutsAgainst));
  check('on a one-game tie streak', splits.streak?.result === 'tie' && splits.streak.length === 1);
  check('last ten holds all eight', tallyTotal(splits.lastTen) === 8);
  check('biggest win was the 8-0', (splits.bestWin as Fixture | null)?.runsFor === 8);
  check('heaviest defeat was the 0-3', (splits.worstLoss as Fixture | null)?.runsAgainst === 3);
  check(
    'the running record reads 1-0 after one and 3-3-2 after eight',
    formatTally(log[0].record!) === '1-0' && formatTally(log[7].record!) === '3-3-2',
  );
  check(
    'the games still to come are listed unplayed',
    log.slice(8).every((f) => !f.played && !f.result && !f.record),
  );

  // 33^1.83 / (33^1.83 + 23^1.83) = .657 over six decided games -> 4-2.
  check(
    'expected record is 4-2',
    splits.pythagorean.wins === 4 && splits.pythagorean.losses === 2,
    `${splits.pythagorean.wins}-${splits.pythagorean.losses}`,
  );
}

console.log('\n=== An empty season ===\n');

{
  const league = createLeague(1, new Rng(9));
  const splits = seasonSplits(league);
  check('opening day reads 0-0', formatTally(splits.overall) === '0-0');
  check('no streak before a game is played', splits.streak === null);
  check('no expected record either', splits.pythagorean.wins === 0 && splits.pythagorean.losses === 0);
  check('runs per game does not divide by zero', splits.runsPerGame === 0);
  check('the whole card is still listed', seasonLog(league).length === SEASON_GAMES);
}

console.log(
  failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
