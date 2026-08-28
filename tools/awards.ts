/**
 * Award-season harness.
 *
 * Two jobs. First, correctness: every synthesized batting line has to be
 * internally legal, every league has to hand out exactly one MVP, and the
 * ballot has to be stable once it has been voted.
 *
 * Second — the part that actually matters — balance. The MVP field is made up,
 * so nothing stops it drifting to where the trophy is either unwinnable or
 * automatic. This runs real plate appearances through the hitting model at
 * each level, at three standards of play, and reports how often each one takes
 * the award. The target: a great season wins it more often than not, an
 * ordinary one almost never does, and a bad one never.
 *
 * Run: npx tsx tools/awards.ts
 */
import { BALLOT_SIZE, runSeasonAwards, synthesizeSeason } from '../src/core/awards';
import { LEVELS, SEASON_GAMES, createLeague, playerTeam } from '../src/core/league';
import { battingAverage, emptyBattingStats, ops } from '../src/core/player';
import { Rng, clamp } from '../src/core/rng';
import type { BattingStats } from '../src/core/types';
import { SKILLS, playSeason, playerAt } from './humanBat';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  if (!ok) {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`  ok    ${label}`);
  }
};

/* ------------------------------------------------- a human season, for real */

/*
 * The three standards of play, one plate appearance and one season, all run
 * through the real swing and batted-ball code, live in `tools/humanBat.ts` —
 * `tools/achievements.ts` asks the same question of the same model, and the
 * answer has to come from one place.
 */

/* ------------------------------------------------------------- legal lines */

console.log('\n=== Synthesized lines are legal ===\n');
{
  const rng = new Rng(9001);
  let bad = 0;
  let worst = '';
  for (let i = 0; i < 20000; i++) {
    const levelId = i % LEVELS.length;
    const s = synthesizeSeason(clamp(10 + rng.next() * 89, 10, 99), levelId, rng);
    const legal =
      s.singles + s.doubles + s.triples + s.homeRuns === s.hits &&
      s.hits <= s.ab &&
      s.hits + s.strikeouts <= s.ab &&
      s.pa === s.ab + s.walks &&
      s.rbi >= s.homeRuns &&
      Object.values(s).every((v) => v >= 0 && Number.isInteger(v));
    if (!legal) {
      bad++;
      worst = JSON.stringify(s);
    }
  }
  check('20000 synthesized seasons are all internally legal', bad === 0, `${bad} bad, e.g. ${worst}`);
}

/* --------------------------------------------------- the field, by league */

console.log('\n=== What it takes to win each league ===\n');
console.log('  Best bat in a 48-man league, averaged over 400 seasons.\n');

for (let levelId = 0; levelId < LEVELS.length; levelId++) {
  const rng = new Rng(4242 + levelId);
  let opsTotal = 0;
  let hrTotal = 0;
  let avgTotal = 0;
  const RUNS = 400;

  for (let run = 0; run < RUNS; run++) {
    let best: BattingStats | null = null;
    let bestOps = -1;
    for (let i = 0; i < 48; i++) {
      const rating = clamp(50 + rng.gaussian() * 16, 10, 99);
      const line = synthesizeSeason(rating, levelId, rng);
      const value = Number(ops(line));
      if (value > bestOps) {
        bestOps = value;
        best = line;
      }
    }
    opsTotal += bestOps;
    hrTotal += best!.homeRuns;
    avgTotal += best!.hits / Math.max(1, best!.ab);
  }

  console.log(
    `  ${LEVELS[levelId].name.padEnd(12)} leader: ` +
      `${(avgTotal / RUNS).toFixed(3).replace(/^0/, '')} AVG · ` +
      `${(hrTotal / RUNS).toFixed(1).padStart(4)} HR · ` +
      `${(opsTotal / RUNS).toFixed(3)} OPS`,
  );
}

/* ----------------------------------------------------------- who wins it */

console.log('\n=== MVP win rate by standard of play ===\n');
console.log('  Target: star wins often, ordinary rarely, flailing never.\n');

const winRates: Record<string, number[]> = {};

for (const skill of SKILLS) {
  const row: number[] = [];
  for (let levelId = 0; levelId < LEVELS.length; levelId++) {
    const SEASONS = 120;
    let wins = 0;
    let ballots = 0;
    let opsTotal = 0;

    for (let season = 0; season < SEASONS; season++) {
      const rng = new Rng(1000 + season * 31 + levelId * 7);
      const league = createLeague(levelId, rng);
      // Give the clubs a plausible table to be judged against.
      for (const team of league.teams) {
        team.wins = Math.round(clamp(SEASON_GAMES * (0.5 + rng.gaussian() * 0.14), 4, 20));
        team.losses = SEASON_GAMES - team.wins;
      }

      const player = playerAt(levelId);
      player.season = playSeason(player, levelId, skill, rng);
      opsTotal += Number(ops(player.season));

      const awards = runSeasonAwards(player, league, 1, rng);
      if (awards.mvps[levelId].isPlayer) wins++;
      if (awards.playerFinish > 0 && awards.playerFinish <= BALLOT_SIZE) ballots++;

      if (season === 0) {
        const me = playerTeam(league);
        console.log(
          `  ${skill.name.padEnd(9)} ${LEVELS[levelId].short.padEnd(4)} sample season: ` +
            `${battingAverage(player.season)} · ${player.season.homeRuns} HR · ` +
            `${player.season.rbi} RBI · ${ops(player.season)} OPS ` +
            `(${me.wins}-${me.losses}) → finished ${awards.playerFinish || '—'}`,
        );
      }
    }

    row.push((wins / SEASONS) * 100);
    console.log(
      `  ${skill.name.padEnd(9)} ${LEVELS[levelId].short.padEnd(4)} ` +
        `avg OPS ${(opsTotal / SEASONS).toFixed(3)} · ` +
        `MVP ${((wins / SEASONS) * 100).toFixed(0).padStart(3)}% · ` +
        `top-${BALLOT_SIZE} ${((ballots / SEASONS) * 100).toFixed(0).padStart(3)}%`,
    );
  }
  winRates[skill.name] = row;
  console.log('');
}

check(
  'a star season wins MVP at least a third of the time at every level',
  winRates.star.every((r) => r >= 33),
  winRates.star.map((r) => `${r.toFixed(0)}%`).join(' / '),
);
check(
  'a star season does not walk away with it every year',
  winRates.star.every((r) => r <= 90),
  winRates.star.map((r) => `${r.toFixed(0)}%`).join(' / '),
);
check(
  'an ordinary season rarely wins MVP',
  winRates.ordinary.every((r) => r <= 25),
  winRates.ordinary.map((r) => `${r.toFixed(0)}%`).join(' / '),
);
check(
  'a flailing season never wins MVP',
  winRates.flailing.every((r) => r === 0),
  winRates.flailing.map((r) => `${r.toFixed(0)}%`).join(' / '),
);

/* ------------------------------------------------ the winner looks the part */

console.log('\n=== The MVP is a hitter anybody would pick ===\n');
{
  // The ballot weighs more than OPS, but the winner still has to read like a
  // winner. An early cut had the club record worth three times what it is now,
  // and leagues were being won by .225 hitters on good teams.
  const SEASONS = 300;
  let topThree = 0;
  let worstGap = 0;
  let worstLine = '';

  for (let season = 0; season < SEASONS; season++) {
    const rng = new Rng(600 + season * 13);
    const levelId = season % LEVELS.length;
    const league = createLeague(levelId, rng);
    for (const team of league.teams) {
      team.wins = Math.round(clamp(SEASON_GAMES * (0.5 + rng.gaussian() * 0.16), 3, 21));
      team.losses = SEASON_GAMES - team.wins;
    }
    // Keep the player off the ballot so this measures the field alone.
    const player = playerAt(levelId);
    player.season = emptyBattingStats();

    const awards = runSeasonAwards(player, league, 1, rng);
    const ballot = awards.mvps[levelId].ballot;
    const byOps = [...ballot].sort((a, b) => Number(ops(b.stats)) - Number(ops(a.stats)));
    if (byOps.slice(0, 3).some((c) => c.name === awards.mvps[levelId].winner)) topThree++;

    // An absolute batting-average floor is the wrong bar — Single-A hits .216,
    // so .240 leads that league. What matters is the gap to the best bat on the
    // same ballot: that is the same test in every hitting environment.
    const best = Number(ops(byOps[0].stats));
    const gap = (best - Number(ops(ballot[0].stats))) / best;
    if (gap > worstGap) {
      worstGap = gap;
      worstLine =
        `${LEVELS[levelId].short}: ${battingAverage(ballot[0].stats)}/${ops(ballot[0].stats)} won, ` +
        `${battingAverage(byOps[0].stats)}/${ops(byOps[0].stats)} led the league`;
    }
  }

  check(
    'the MVP is a top-three OPS on his own ballot at least 85% of the time',
    topThree / SEASONS >= 0.85,
    `${((topThree / SEASONS) * 100).toFixed(0)}%`,
  );
  // 12% is about what the club-record term is worth end to end, and that term
  // exists on purpose: a very good hitter on a 21-3 club beating the league's
  // best bat on a 7-17 club is the ballot working, not the ballot broken. What
  // this bar rules out is a *modest* season winning on team record alone.
  check(
    'no MVP is more than 12% off the best OPS on his own ballot',
    worstGap <= 0.12,
    `worst was ${(worstGap * 100).toFixed(1)}% — ${worstLine}`,
  );
}

/* -------------------------------------------------------- shape and repeat */

console.log('\n=== Ballot shape ===\n');
{
  const rng = new Rng(77);
  const league = createLeague(1, rng);
  league.teams.forEach((t, i) => {
    t.wins = 16 - i * 2;
    t.losses = SEASON_GAMES - t.wins;
  });
  const player = playerAt(1);
  player.season = playSeason(player, 1, SKILLS[0], rng);
  const awards = runSeasonAwards(player, league, 3, rng);

  check('one MVP per league', awards.mvps.length === LEVELS.length);
  check(
    'each MVP is filed under its own league',
    awards.mvps.every((m, i) => m.levelId === i),
  );
  check(
    'every MVP has a winner, a club and a line',
    awards.mvps.every((m) => m.winner.length > 0 && m.teamName.length > 0 && m.stats.pa > 0),
  );
  check(
    'only the player league keeps a full ballot',
    awards.mvps.filter((m) => m.ballot.length > 0).length === 1 &&
      awards.mvps[1].ballot.length === BALLOT_SIZE,
  );
  check(
    'the ballot is sorted best-first and the winner tops it',
    awards.mvps[1].ballot[0].name === awards.mvps[1].winner &&
      awards.mvps[1].ballot.every((c, i, a) => i === 0 || a[i - 1].score >= c.score),
  );
  const shares = awards.mvps[1].ballot.reduce((n, c) => n + c.votePct, 0);
  check('first-place votes add up to 100%', Math.abs(shares - 100) < 0.5, `${shares}%`);
  check(
    'vote share falls off down the ballot',
    awards.mvps[1].ballot.every((c, i, a) => i === 0 || a[i - 1].votePct >= c.votePct),
  );
  check(
    'the player appears exactly once on their own ballot',
    awards.mvps[1].ballot.filter((c) => c.isPlayer).length <= 1 &&
      awards.playerFinish >= 1 &&
      awards.playerFinish <= 49,
  );
  check(
    'the player is not on anybody else’s ballot',
    awards.mvps.filter((m) => m.isPlayer).length <= 1,
  );

  console.log('');
  for (const c of awards.mvps[1].ballot) {
    console.log(
      `  ${c.votePct.toFixed(1).padStart(5)}%  ${c.name.padEnd(22)}` +
        `${battingAverage(c.stats)} · ${String(c.stats.homeRuns).padStart(2)} HR · ` +
        `${String(c.stats.rbi).padStart(2)} RBI · ${ops(c.stats)} OPS` +
        (c.isPlayer ? '   <- you' : ''),
    );
  }
}

console.log('\n=== A career of award seasons ===\n');
{
  const rng = new Rng(5150);
  const history: ReturnType<typeof runSeasonAwards>[] = [];
  for (let year = 1; year <= 6; year++) {
    const levelId = Math.min(LEVELS.length - 1, Math.floor((year - 1) / 2));
    const league = createLeague(levelId, rng);
    league.teams.forEach((t, i) => {
      t.wins = 15 - i * 2;
      t.losses = SEASON_GAMES - t.wins;
    });
    const player = playerAt(levelId);
    player.season = playSeason(player, levelId, SKILLS[0], rng);
    history.push(runSeasonAwards(player, league, year, rng));
  }

  check('six years voted', history.length === 6);
  check(
    'every year names four MVPs',
    history.every((a) => a.mvps.length === LEVELS.length),
  );
  check(
    'award years are distinct',
    new Set(history.map((a) => a.seasonYear)).size === history.length,
  );
  const allWinners = history.flatMap((a) => a.mvps.map((m) => m.winner));
  check('no winner is left unnamed', allWinners.every((w) => w.trim().length > 0));

  for (const a of history) {
    console.log(
      `  Season ${a.seasonYear} (${LEVELS[a.playerLevelId].short.padEnd(3)}): ` +
        a.mvps
          .map((m) => `${LEVELS[m.levelId].short} ${m.winner}${m.isPlayer ? ' *' : ''}`)
          .join(' · '),
    );
  }
}

console.log(failures === 0 ? '\nAll award checks passed.\n' : `\n${failures} FAILURES\n`);
process.exit(failures === 0 ? 0 : 1);
