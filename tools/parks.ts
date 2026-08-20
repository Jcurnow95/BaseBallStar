/**
 * Checks two things:
 *   1. that the ballparks actually play differently, and
 *   2. that a season's calendar runs start to finish with games and off days
 *      landing where they should.
 * Run: npx tsx tools/parks.ts
 */
import { BALLPARKS } from '../src/core/ballpark';
import { PlaySim } from '../src/core/playSim';
import type { BattedBall, ContactQuality } from '../src/core/types';
import { ARCHETYPES, createPlayer } from '../src/core/player';
import { Rng, clamp } from '../src/core/rng';
import { SEASON_GAMES, advanceDay, createLeague, isSeasonOver, nextGame } from '../src/core/league';

const DT = 1 / 60;

function battedBall(rng: Rng): BattedBall {
  const roll = rng.next();
  const quality: ContactQuality =
    roll < 0.16 ? 'barrel' : roll < 0.4 ? 'solid' : roll < 0.72 ? 'flare' : 'weak';
  const bonus = quality === 'barrel' ? 22 : quality === 'solid' ? 13 : quality === 'flare' ? 4 : -6;
  return {
    quality,
    exitVelocity: clamp(84 + bonus + rng.gaussian() * 6, 45, 118),
    launchAngle: clamp(rng.gaussian() * 15 + 20, -20, 62),
    spray: clamp(rng.gaussian() * 0.42, -0.73, 0.73),
  };
}

console.log('\n=== How the parks play (1500 balls in play each) ===\n');
console.log('park                 dims (LF/LC/CF/RC/RF)        HR%   2B%   wall balls   avg wall ht');

const player = createPlayer('Test', 'CF', 'R', ARCHETYPES[3]);
for (const key of Object.keys(player.attributes) as (keyof typeof player.attributes)[]) {
  player.attributes[key] = 62;
}

for (const park of BALLPARKS) {
  const rng = new Rng(31337);
  let homeRuns = 0;
  let doubles = 0;
  let offWall = 0;
  const plays = 1500;

  for (let i = 0; i < plays; i++) {
    const sim = new PlaySim({
      battedBall: battedBall(rng),
      bats: 'R',
      attributes: player.attributes,
      userPosition: 'CF',
      userSide: 'offense',
      runnersOn: [false, false, false],
      outs: 0,
      opponentRating: 55,
      park,
      rng,
    });
    let frames = 0;
    let sawWall = false;
    while (sim.phase !== 'dead' && frames < 60 * 25) {
      sim.update(DT);
      frames++;
      if (sim.event === 'Off the wall!') sawWall = true;
    }
    if (sawWall) offWall++;
    if (sim.outcome?.kind === 'homeRun') homeRuns++;
    if (sim.outcome?.kind === 'double') doubles++;
  }

  const dims = [park.fence[0], park.fence[2], park.fence[4], park.fence[6], park.fence[8]]
    .map((d) => String(Math.round(d)))
    .join('/');
  const avgWall = park.wallHeight.reduce((a, b) => a + b, 0) / park.wallHeight.length;

  console.log(
    `${park.name.padEnd(20)} ${dims.padEnd(28)}` +
      ` ${((homeRuns / plays) * 100).toFixed(1).padStart(4)}%` +
      ` ${((doubles / plays) * 100).toFixed(1).padStart(4)}%` +
      ` ${((offWall / plays) * 100).toFixed(1).padStart(9)}%` +
      ` ${avgWall.toFixed(0).padStart(11)} ft`,
  );
}

console.log('\n=== Season calendar ===\n');
const parksRng = new Rng(99);
const league = createLeague(0, parksRng);
let gameDays = 0;
let offDays = 0;
let guard = 0;
const shape: string[] = [];

while (!isSeasonOver(league) && guard++ < 500) {
  const game = nextGame(league);
  if (game) {
    game.played = true;
    gameDays++;
    shape.push('G');
  } else {
    offDays++;
    shape.push('.');
  }
  advanceDay(league, parksRng);
}

console.log(`  calendar length   ${league.calendar.length} days`);
console.log(`  game days         ${gameDays} (schedule has ${SEASON_GAMES})`);
console.log(`  off days          ${offDays}`);
console.log(`  unplayed games    ${league.schedule.filter((g) => !g.played).length}`);
console.log(`  shape             ${shape.join('')}`);

const parkCounts = new Map<string, number>();
for (const team of league.teams) parkCounts.set(team.parkId, (parkCounts.get(team.parkId) ?? 0) + 1);
console.log(`  distinct parks    ${parkCounts.size} across ${league.teams.length} teams\n`);
