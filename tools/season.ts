/**
 * Walks an entire season through the same calls the screens make, and asserts
 * the season ends exactly once, at the end.
 *
 * This exists because of a real bug: "is the season over?" was being answered
 * with "is there a game today?", which is also true on every ordinary off day.
 * Seasons ended after two or three games.
 *
 * Run: npx tsx tools/season.ts
 */
import {
  SEASON_GAMES,
  advanceDay,
  createLeague,
  isGameDay,
  isRegularSeasonOver,
  isSeasonOver,
  nextGame,
  parkForGame,
  playoffSeedOrder,
  regularSeasonGames,
  simulateOtherTeams,
  teamById,
} from '../src/core/league';
import {
  PLAYOFF_TEAMS,
  playerSeries,
  recordPlayoffGame,
  seriesOver,
  startPlayoffs,
} from '../src/core/playoffs';
import { Rng } from '../src/core/rng';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  if (!ok) {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`  ok    ${label}`);
  }
};

console.log('\n=== Season walkthrough ===\n');

for (const seed of [1, 7, 99, 2024, 555]) {
  const rng = new Rng(seed);
  const league = createLeague(0, rng);

  let gamesPlayed = 0;
  let playoffGames = 0;
  let offDays = 0;
  let earlyEnd = -1;
  let guard = 0;

  while (guard++ < 500) {
    // What the post-game screen and the hub both ask.
    const over = isSeasonOver(league);
    if (over) {
      if (gamesPlayed < SEASON_GAMES) earlyEnd = gamesPlayed;
      break;
    }

    const game = nextGame(league);
    if (game) {
      // Stand in for playing it, the way endGame() in the game screen does.
      game.played = true;
      const opponent = teamById(league, game.opponentId);
      parkForGame(league, game); // must resolve a park for every game
      const won = rng.chance(0.5);
      if (game.playoff) {
        playoffGames++;
      } else {
        if (won) {
          teamById(league, league.playerTeamId).wins++;
          opponent.losses++;
        } else {
          teamById(league, league.playerTeamId).losses++;
          opponent.wins++;
        }
        simulateOtherTeams(league, rng, [opponent.id]);
        gamesPlayed++;
      }
      advanceDay(league);
      if (game.playoff) recordPlayoffGame(league, game, won, rng);
      else if (isRegularSeasonOver(league)) startPlayoffs(league, rng);
      continue;
    } else {
      check(
        `seed ${seed}: off day is not a game day`,
        !isGameDay(league),
        'nextGame was null on a game day',
      );
      offDays++;
    }

    advanceDay(league);
  }

  const label = `seed ${seed}`;
  if (earlyEnd >= 0) {
    failures++;
    console.log(`  FAIL  ${label}: season ended after only ${earlyEnd} of ${SEASON_GAMES} games`);
  } else {
    const p = league.playoffs;
    console.log(
      `  ok    ${label}: ${gamesPlayed}/${SEASON_GAMES} games, ${offDays} off days, ` +
        `${league.calendar.length}-day calendar, ${playoffGames} playoff games, ` +
        `result ${p?.playerResult}`,
    );
  }

  // The bracket itself.
  const p = league.playoffs;
  check(`${label}: playoffs were seeded`, !!p);
  if (!p) continue;
  check(`${label}: playoffs finished with a champion`, p.complete && !!p.championId);
  check(`${label}: ${PLAYOFF_TEAMS} seeds`, p.seeds.length === PLAYOFF_TEAMS);
  check(
    `${label}: seeds are the top of the table`,
    p.seeds.join() === playoffSeedOrder(league).slice(0, PLAYOFF_TEAMS).map((t) => t.id).join(),
  );
  check(`${label}: three series played`, p.series.length === 3 && p.series.every(seriesOver));
  check(
    `${label}: series winners reached the mark and nobody overshot`,
    p.series.every((s) => {
      const need = Math.ceil(s.bestOf / 2);
      const w = s.winnerId === s.highId ? s.highWins : s.lowWins;
      const l = s.winnerId === s.highId ? s.lowWins : s.highWins;
      return w === need && l < need;
    }),
  );
  const final = p.series.find((s) => s.round === 'final');
  const semiWinners = p.series.filter((s) => s.round === 'semifinal').map((s) => s.winnerId);
  check(
    `${label}: final is between the semifinal winners`,
    !!final && semiWinners.includes(final.highId) && semiWinners.includes(final.lowId),
  );
  check(`${label}: champion won the final`, final?.winnerId === p.championId);
  const inBracket = p.seeds.includes(league.playerTeamId);
  check(
    `${label}: player result matches the bracket`,
    inBracket ? p.playerResult !== 'missed' : p.playerResult === 'missed',
  );
  const mySeries = playerSeries(league);
  check(
    `${label}: playoff games played match the player's series`,
    inBracket
      ? playoffGames ===
          p.series
            .filter((s) => s.highId === league.playerTeamId || s.lowId === league.playerTeamId)
            .reduce((n, s) => n + s.highWins + s.lowWins, 0)
      : playoffGames === 0 && mySeries === null,
  );
  check(
    `${label}: regular-season table untouched by the postseason`,
    regularSeasonGames(league).length === SEASON_GAMES &&
      league.teams.every((t) => t.wins + t.losses === SEASON_GAMES),
  );
  check(
    `${label}: every playoff game sits on exactly one calendar day`,
    league.schedule
      .filter((g) => g.playoff)
      .every((g) => league.calendar.filter((d) => d.gameIndex === g.index).length === 1),
  );
}

console.log('\n=== Playoffs: forced outcomes ===\n');
{
  // Force the player in as the 1 seed and sweep to the title.
  const rng = new Rng(3);
  const league = createLeague(0, rng);
  league.schedule.forEach((g) => (g.played = true));
  league.day = league.calendar.length;
  league.teams.forEach((t, i) => {
    t.wins = 20 - i * 3;
    t.losses = SEASON_GAMES - t.wins;
  });
  startPlayoffs(league, rng);
  const p = league.playoffs!;
  check('top seed is the player', p.seeds[0] === league.playerTeamId);
  check('day after the last game is a workout day', nextGame(league) === null && !isGameDay(league));
  check('the year is not over while the playoffs run', !isSeasonOver(league));
  let played = 0;
  let guard = 0;
  while (!isSeasonOver(league) && guard++ < 20) {
    const g = nextGame(league);
    if (!g) {
      advanceDay(league);
      continue;
    }
    check(`playoff game ${played + 1} is a playoff game`, !!g.playoff);
    g.played = true;
    advanceDay(league);
    recordPlayoffGame(league, g, true, rng);
    played++;
  }
  check('sweep takes five games', played === 5, `${played} played`);
  check('player is champion', p.playerResult === 'champion' && p.championId === league.playerTeamId);
  check('season is over after the trophy', isSeasonOver(league));
  const semi = p.series[0];
  check('1 seed hosted games 1 and 3 of the semi', semi.highId === league.playerTeamId);
  const myGames = league.schedule.filter((g) => g.playoff);
  check(
    'home/away pattern: semi H-A, final H-H-A',
    myGames.map((g) => (g.home ? 'H' : 'A')).join('') === 'HAHHA',
    myGames.map((g) => (g.home ? 'H' : 'A')).join(''),
  );

  // Now lose the semi in three.
  const rng2 = new Rng(4);
  const l2 = createLeague(0, rng2);
  l2.schedule.forEach((g) => (g.played = true));
  l2.day = l2.calendar.length;
  l2.teams.forEach((t, i) => {
    t.wins = 20 - i * 3;
    t.losses = SEASON_GAMES - t.wins;
  });
  startPlayoffs(l2, rng2);
  const results = [true, false, false];
  for (const won of results) {
    while (!nextGame(l2)) advanceDay(l2);
    const g = nextGame(l2)!;
    g.played = true;
    advanceDay(l2);
    recordPlayoffGame(l2, g, won, rng2);
  }
  check('losing the semi 1-2 eliminates you', l2.playoffs!.playerResult === 'eliminated');
  check('elimination finishes the bracket', isSeasonOver(l2) && !!l2.playoffs!.championId);
  check('no further games are scheduled', nextGame(l2) === null && l2.day >= l2.calendar.length);

  // And a club that missed out entirely.
  const rng3 = new Rng(5);
  const l3 = createLeague(0, rng3);
  l3.schedule.forEach((g) => (g.played = true));
  l3.day = l3.calendar.length;
  l3.teams.forEach((t, i) => {
    t.wins = 4 + i * 3;
    t.losses = SEASON_GAMES - t.wins;
  });
  startPlayoffs(l3, rng3);
  check('worst club misses the playoffs', l3.playoffs!.playerResult === 'missed');
  check('missing out ends the year on the spot', isSeasonOver(l3));
  check('missing out adds no calendar days', l3.calendar.length === (l3.regularDays ?? -1));
}

console.log('\n=== Off days exist and are usable ===\n');
{
  const league = createLeague(0, new Rng(42));
  const offCount = league.calendar.filter((d) => d.gameIndex === null).length;
  check('season has off days to train on', offCount >= 5, `${offCount} off days`);
  check(
    'no game day reports "no game"',
    league.calendar.every((d, i) => {
      if (d.gameIndex == null) return true;
      const saved = league.day;
      league.day = i;
      const ok = nextGame(league) !== null;
      league.day = saved;
      return ok;
    }),
  );
  check(
    'every scheduled game appears on exactly one day',
    league.schedule.every(
      (g) => league.calendar.filter((d) => d.gameIndex === g.index).length === 1,
    ),
  );
}

console.log('\n=== The trap that caused the bug ===\n');
{
  const league = createLeague(0, new Rng(7));
  // Park the season on a mid-season off day with games still to play.
  const midOffDay = league.calendar.findIndex((d, i) => d.gameIndex === null && i > 2);
  league.day = midOffDay;
  for (let i = 0; i < midOffDay; i++) {
    const g = league.calendar[i].gameIndex;
    if (g != null) league.schedule[g].played = true;
  }

  check('mid-season off day has no game today', nextGame(league) === null);
  check(
    'mid-season off day is NOT the end of the season',
    !isSeasonOver(league),
    'an off day must never be mistaken for the season ending',
  );
  check('games still remain to be played', league.schedule.some((g) => !g.played));

  // And the real end still reads as the end.
  league.schedule.forEach((g) => (g.played = true));
  check('regular season with every game played IS over', isRegularSeasonOver(league));
  check(
    'but the year is not over until the playoffs are',
    !isSeasonOver(league),
    'the postseason has not been played yet',
  );
  startPlayoffs(league, new Rng(8));
  check(
    'once the bracket is settled the year is over',
    league.playoffs?.playerResult === 'missed' ? isSeasonOver(league) : !isSeasonOver(league),
  );
}

console.log(failures === 0 ? '\nAll season checks passed.\n' : `\n${failures} FAILURES\n`);
process.exit(failures === 0 ? 0 : 1);
