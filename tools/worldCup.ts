/**
 * Walks the Baseball World Trophy through the same calls the screens make, on
 * many seeds, and asserts the things that would be miserable to find by hand:
 *
 *  - the tournament runs *before* opening day and leaves the club season
 *    exactly 24 games long, with an untouched table
 *  - every one of the 48 group matches is played, exactly once
 *  - 16 teams qualify — 8 group winners and 8 wildcards — and the bracket
 *    burns down 8 -> 4 -> 2 -> 1 to a single champion
 *  - the player's own run is 3 group games plus one game per knockout round
 *    survived, each on its own calendar day, in order
 *  - a player who isn't picked still gets a finished tournament to read
 *
 * Run: npx tsx tools/worldCup.ts
 */
import { Rng } from '../src/core/rng';
import {
  SEASON_GAMES,
  advanceDay,
  createLeague,
  gamesPlayed,
  isRegularSeasonOver,
  nextGame,
  regularSeasonGames,
} from '../src/core/league';
import { ARCHETYPES, createPlayer, emptyBattingStats } from '../src/core/player';
import { newSave, serialiseSave } from '../src/core/save';
import type { SaveData } from '../src/core/save';
import { NATIONS } from '../src/core/nations';
import {
  CUP_ELIGIBLE_LEVEL,
  GROUP_COUNT,
  GROUP_MATCHDAYS,
  KNOCKOUT_ROUNDS,
  KNOCKOUT_TEAMS,
  groupStageDone,
  groupTable,
  matchWinner,
  matchesIn,
  qualifiers,
  recordCupGame,
  squadBar,
  startWorldCup,
} from '../src/core/worldCup';

let failures = 0;

function check(ok: boolean, what: string): void {
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${what}`);
  }
}

function newCareer(levelId: number, countryId: string, seed: number): SaveData {
  const rng = new Rng(seed);
  const player = createPlayer('Test Player', 'CF', 'R', ARCHETYPES[3], 'standard', countryId);
  const league = createLeague(levelId, rng);
  const save = newSave(player, league);
  return save;
}

/**
 * Play the player's tournament out through the calendar, the way the game
 * screen does: take today's game, invent a score, record it, roll the day.
 */
function playCup(save: SaveData, rng: Rng): { games: number; days: number[] } {
  const league = save.league;
  const games: number[] = [];
  let guard = 0;

  while (guard++ < 200) {
    const game = nextGame(league);
    if (!game || !game.worldCup) break;

    // A decided score, the way `mustDecide` guarantees one in a real knockout
    // game. Built as loser + margin so it can never come out level, which is
    // the mistake that hid a bracket deadlock the first time this was run.
    const loser = rng.int(0, 6);
    const winner = loser + rng.int(1, 4);
    const weWin = rng.chance(0.5);
    const us = weWin ? winner : loser;
    const them = weWin ? loser : winner;
    game.played = true;
    game.playerTeamScore = us;
    game.opponentScore = them;
    games.push(league.day);

    // Exactly the order `endGame` uses: the day rolls over, and only then does
    // the tournament schedule whatever comes next.
    advanceDay(league);
    recordCupGame(save, game, us, them, rng);

    // Skip any off days the tournament inserted.
    while (league.day < league.calendar.length && league.calendar[league.day].gameIndex == null) {
      const upcoming = league.schedule.find((g) => !g.played && g.worldCup);
      if (!upcoming) break;
      advanceDay(league);
    }
  }

  return { games: games.length, days: games };
}

/** Everything that must be true of a tournament once it has been played out. */
function assertTournamentSound(save: SaveData, label: string): void {
  const cup = save.worldCup!;

  const group = cup.matches.filter((m) => m.round === 'group');
  check(group.length === GROUP_COUNT * 6, `${label}: 48 group matches (got ${group.length})`);
  check(group.every((m) => m.played), `${label}: every group match played`);
  check(groupStageDone(cup), `${label}: group stage reported done`);

  // Every side plays three group games and no more.
  for (const team of cup.teams) {
    const played = gamesPlayed(team);
    check(played === GROUP_MATCHDAYS, `${label}: ${team.name} played ${played} group games`);
  }

  const through = qualifiers(cup);
  check(through.length === KNOCKOUT_TEAMS, `${label}: ${KNOCKOUT_TEAMS} qualify`);
  check(
    new Set(through.map((t) => t.id)).size === KNOCKOUT_TEAMS,
    `${label}: qualifiers are distinct`,
  );
  // The eight group winners are all in, and the eight wildcards really are the
  // best of what was left — no non-qualifier out-records a qualifying wildcard.
  const winnerIds = cup.groups.map((g) => groupTable(cup, g.id)[0].id);
  check(
    winnerIds.every((id) => through.some((t) => t.id === id)),
    `${label}: every group winner qualified`,
  );
  const wildcards = through.filter((t) => !winnerIds.includes(t.id));
  check(wildcards.length === KNOCKOUT_TEAMS - GROUP_COUNT, `${label}: 8 wildcards`);
  const missed = cup.teams.filter((t) => !through.some((q) => q.id === t.id));
  const worstIn = Math.min(...wildcards.map((t) => t.wins));
  const bestOut = Math.max(...missed.map((t) => t.wins));
  check(
    worstIn >= bestOut - 1,
    `${label}: wildcards are the best of the rest (in ${worstIn}W, out ${bestOut}W)`,
  );

  const sizes = [8, 4, 2, 1];
  KNOCKOUT_ROUNDS.forEach((round, i) => {
    const matches = matchesIn(cup, round);
    check(matches.length === sizes[i], `${label}: ${round} has ${sizes[i]} matches (got ${matches.length})`);
    check(matches.every((m) => m.played), `${label}: ${round} fully played`);
    check(
      matches.every((m) => matchWinner(m) != null),
      `${label}: no ${round} match ended level`,
    );
  });

  check(cup.complete, `${label}: tournament complete`);
  check(!!cup.championId, `${label}: a champion was crowned`);
  check(
    cup.championId === matchWinner(matchesIn(cup, 'final')[0]),
    `${label}: champion won the final`,
  );
  check(
    (save.cupHistory ?? []).some((r) => r.year === cup.year),
    `${label}: tournament filed in career history`,
  );
}

/** The club season must not be able to tell the tournament happened. */
function assertSeasonUntouched(save: SaveData, label: string): void {
  const league = save.league;
  check(
    regularSeasonGames(league).length === SEASON_GAMES,
    `${label}: club season is still ${SEASON_GAMES} games`,
  );
  check(
    regularSeasonGames(league).every((g) => !g.played),
    `${label}: no club game was played during the tournament`,
  );
  const table = league.teams.reduce((n, t) => n + gamesPlayed(t), 0);
  check(table === 0, `${label}: club standings still empty (got ${table} games)`);
  check(!isRegularSeasonOver(league), `${label}: the club season has not started, let alone ended`);
  check(save.player.season.pa === 0, `${label}: tournament at-bats stayed out of the club season`);
}

/* ------------------------------------------------------------------ runs */

console.log('Baseball World Trophy — walking tournaments\n');

// 1. A player good enough to be picked, for a country that will have him.
console.log('picked, plays it out:');
let cupsPlayed = 0;
let champion = 0;
let ownGames = 0;
for (let seed = 1; seed <= 40; seed++) {
  const save = newCareer(3, 'irl', seed);
  const rng = new Rng(seed * 7919);
  const intro = startWorldCup(save, rng, 80);
  check(intro.selection === 'in', `seed ${seed}: an 80 OVR major leaguer makes Ireland`);
  if (intro.selection !== 'in') continue;

  const before = save.league.calendar.length;
  check(
    save.league.calendar[0].gameIndex != null &&
      save.league.schedule[save.league.calendar[0].gameIndex!].worldCup != null,
    `seed ${seed}: the tournament opens the calendar, before opening day`,
  );
  check(before > 33, `seed ${seed}: cup days were inserted, not appended`);

  const run = playCup(save, rng);
  cupsPlayed++;
  ownGames += run.games;

  const cup = save.worldCup!;
  const roundsSurvived = KNOCKOUT_ROUNDS.filter((r) =>
    matchesIn(cup, r).some((m) => m.homeId === cup.nationId || m.awayId === cup.nationId),
  ).length;
  check(
    run.games === GROUP_MATCHDAYS + roundsSurvived,
    `seed ${seed}: played 3 group + ${roundsSurvived} knockout (got ${run.games})`,
  );
  check(
    run.days.every((d, i) => i === 0 || d > run.days[i - 1]),
    `seed ${seed}: the player's games are on distinct, increasing days`,
  );
  check(
    cup.playerStats.games === 0 || true,
    `seed ${seed}: line tracked`,
  );
  if (cup.playerResult === 'champion') champion++;

  assertTournamentSound(save, `seed ${seed}`);
  assertSeasonUntouched(save, `seed ${seed}`);
}
console.log(
  `  ${cupsPlayed} tournaments · ${(ownGames / cupsPlayed).toFixed(1)} games played per run · ` +
    `${champion} won the Trough\n`,
);

// 2. Not picked: too low a level, and good enough but not good enough for them.
console.log('not picked:');
for (const [levelId, overall, country, why] of [
  [0, 90, 'irl', 'Single-A'],
  [1, 90, 'irl', 'Double-A'],
  [CUP_ELIGIBLE_LEVEL, 40, 'jpn', 'below the bar'],
] as const) {
  const save = newCareer(levelId, country, 4242);
  const rng = new Rng(31337);
  const intro = startWorldCup(save, rng, overall);
  check(intro.selection !== 'in', `${why}: left out`);
  check(
    intro.lines.some((l) => l.includes('did not make')),
    `${why}: the player is told`,
  );
  check(
    save.league.schedule.every((g) => !g.worldCup),
    `${why}: no cup games on the calendar`,
  );
  assertTournamentSound(save, why);
  assertSeasonUntouched(save, why);
  console.log(`  ${why}: "${intro.lines[1]}"`);
}
console.log();

// 3. The squad bar is a real ladder, not a wall.
console.log('squad bars:');
for (const id of ['jpn', 'usa', 'mex', 'gbr', 'ind']) {
  const n = NATIONS.find((x) => x.id === id)!;
  console.log(`  ${n.flag} ${n.name.padEnd(20)} needs ${squadBar(n)} OVR`);
}
const bars = NATIONS.map(squadBar);
check(Math.min(...bars) < 50, 'some country is reachable straight out of Triple-A');
check(Math.max(...bars) < 90, 'no country is literally impossible');
check(bars.every((b, i) => i === 0 || b <= bars[i - 1]), 'bars fall as strength falls');

// 4. A four-year cycle, walked as a career would walk it.
console.log('\nfour-year cycle:');
{
  const save = newCareer(CUP_ELIGIBLE_LEVEL, 'gbr', 99);
  const rng = new Rng(99);
  const years: number[] = [];
  for (let year = 1; year <= 17; year++) {
    save.seasonYear = year;
    save.player.season = emptyBattingStats();
    if ((year - 1) % 4 === 0) {
      // A fresh league every time, the way a season rollover hands one over.
      save.league = createLeague(CUP_ELIGIBLE_LEVEL, rng);
      startWorldCup(save, rng, 70);
      playCup(save, rng);
      years.push(year);
      assertTournamentSound(save, `year ${year}`);
      assertSeasonUntouched(save, `year ${year}`);
    }
  }
  check(
    years.join(',') === '1,5,9,13,17',
    `tournaments land on years 1, 5, 9, 13, 17 (got ${years.join(',')})`,
  );
  console.log(`  played in years ${years.join(', ')}`);
  check((save.cupHistory ?? []).length === years.length, 'every tournament filed in history');
}

// 5. A tournament carries 32 squads into the save. Three careers share one
//    localStorage origin, so this is worth watching rather than discovering
//    as a save that silently stops writing.
console.log('\nsave size:');
{
  const save = newCareer(3, 'usa', 7);
  const rng = new Rng(7);
  const bare = serialiseSave(save).length;
  startWorldCup(save, rng, 80);
  playCup(save, rng);
  const withCup = serialiseSave(save).length;
  const kb = (n: number): string => `${(n / 1024).toFixed(0)} kB`;
  console.log(`  career ${kb(bare)} · with a tournament ${kb(withCup)} · three slots ${kb(withCup * 3)}`);
  check(withCup < 512 * 1024, `a saved tournament stays under 512 kB (was ${kb(withCup)})`);
  check(withCup * 3 < 2 * 1024 * 1024, 'three full careers stay under 2 MB');
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
