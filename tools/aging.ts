/**
 * Walks a career and its league through twenty winters and checks that people
 * get older the way they should: the player ages one year a season from 18,
 * and the clubs around him keep turning over instead of fielding the same
 * thirty-somethings forever.
 *
 * The failure this guards against is a league that never renews — every roster
 * ageing in place until the whole division is 40 and nobody is any good.
 *
 * Run: npx tsx tools/aging.ts
 */
import { ARCHETYPES, ROOKIE_AGE, careerPhase, createPlayer } from '../src/core/player';
import {
  FORCED_RETIREMENT_AGE,
  RETIREMENT_WATCH_AGE,
  createLeague,
  playerTeam,
  retiresThisWinter,
  rolloverSeason,
} from '../src/core/league';
import { offseasonAgePoints } from '../src/core/progression';
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

const SEASONS = 20;
const rng = new Rng(20260826);
const player = createPlayer('Test', 'CF', 'R', ARCHETYPES[3]);
const league = createLeague(0, rng);

check('a career starts at 18', player.age === ROOKIE_AGE, `age ${player.age}`);

let oldestSeen = 0;
let retirements = 0;
const namesAtStart = new Set(playerTeam(league).roster!.map((p) => p.name));

for (let season = 1; season <= SEASONS; season++) {
  const before = new Set(playerTeam(league).roster!.map((p) => p.name));
  const news = rolloverSeason(league, rng);
  player.age++;

  for (const team of league.teams) {
    for (const p of team.roster!) {
      oldestSeen = Math.max(oldestSeen, p.age);
      if (p.age > FORCED_RETIREMENT_AGE) {
        check(`nobody plays past ${FORCED_RETIREMENT_AGE}`, false, `${p.name} is ${p.age}`);
      }
    }
  }

  retirements += playerTeam(league)
    .roster!.filter((p) => !before.has(p.name)).length;

  if (season <= 3 || season === SEASONS) {
    const ages = playerTeam(league).roster!.map((p) => p.age);
    console.log(
      `  season ${String(season).padStart(2)}: you are ${player.age} (${careerPhase(player.age)}), ` +
        `+${offseasonAgePoints(player.age)} age pts · clubhouse ages ` +
        `${Math.min(...ages)}-${Math.max(...ages)} · ${news.length} news line(s)`,
    );
  }
}

check(
  `${SEASONS} seasons put the player at ${ROOKIE_AGE + SEASONS}`,
  player.age === ROOKIE_AGE + SEASONS,
  `age ${player.age}`,
);
check(
  `nobody in the league is older than ${FORCED_RETIREMENT_AGE}`,
  oldestSeen <= FORCED_RETIREMENT_AGE,
  `oldest ${oldestSeen}`,
);
check(
  'the clubhouse turned over',
  retirements >= SEASONS / 2,
  `${retirements} arrivals in ${SEASONS} winters`,
);
check(
  'the opening-day squad is gone by the end',
  playerTeam(league).roster!.every((p) => !namesAtStart.has(p.name)),
  playerTeam(league)
    .roster!.filter((p) => namesAtStart.has(p.name))
    .map((p) => `${p.name} (${p.age})`)
    .join(', '),
);

// The retirement roll itself, at the edges.
const young = { name: 'Kid', age: RETIREMENT_WATCH_AGE - 1, rating: 60, role: 'batter' as const };
const ancient = { name: 'Gramps', age: FORCED_RETIREMENT_AGE, rating: 90, role: 'batter' as const };
check('a 32-year-old never retires', !retiresThisWinter(young, rng));
check(`a ${FORCED_RETIREMENT_AGE}-year-old always does`, retiresThisWinter(ancient, rng));

check(
  'young players get free offseason points, older ones do not',
  offseasonAgePoints(19) > offseasonAgePoints(24) && offseasonAgePoints(30) === 0,
  `19:${offseasonAgePoints(19)} 24:${offseasonAgePoints(24)} 30:${offseasonAgePoints(30)}`,
);

console.log(failures === 0 ? '\nAging: all checks passed.' : `\nAging: ${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
