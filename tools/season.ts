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
  isSeasonOver,
  nextGame,
  parkForGame,
  simulateOtherTeams,
  teamById,
} from '../src/core/league';
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
      // Stand in for playing it.
      game.played = true;
      const opponent = teamById(league, game.opponentId);
      parkForGame(league, game); // must resolve a park for every game
      if (rng.chance(0.5)) opponent.losses++;
      else opponent.wins++;
      simulateOtherTeams(league, rng, [opponent.id]);
      gamesPlayed++;
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
    console.log(
      `  ok    ${label}: ${gamesPlayed}/${SEASON_GAMES} games, ${offDays} off days, ` +
        `${league.calendar.length}-day calendar`,
    );
  }
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
  check('season with every game played IS over', isSeasonOver(league));
}

console.log(failures === 0 ? '\nAll season checks passed.\n' : `\n${failures} FAILURES\n`);
process.exit(failures === 0 ? 0 : 1);
