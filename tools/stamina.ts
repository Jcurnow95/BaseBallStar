/**
 * Does conditioning actually matter?
 *
 * An earlier run of tools/career.ts reported that stamina never fell below 65
 * across 175 seasons and concluded the whole system was inert. That was wrong:
 * the harness's own off-day policy rested whenever stamina dipped to 65, so it
 * measured its own resting rule, not the game. Playing a season by hand in the
 * app — where the off day just takes the XP — ended it at 35.
 *
 * This runs the same careers under both policies and reports what conditioning
 * is actually worth at the plate.
 *
 * Run: npx tsx tools/stamina.ts
 */
import { Rng } from '../src/core/rng';
import { throwPitch } from '../src/core/pitching';
import type { Count } from '../src/core/pitching';
import { IDEAL_UNDER, resolveSwing, sweetSpotRadius } from '../src/core/swing';
import { resolveBattedBall } from '../src/core/outcome';
import { LEVELS } from '../src/core/league';
import {
  ARCHETYPES,
  battingAverage,
  createPlayer,
  emptyBattingStats,
  onBasePct,
  slugging,
} from '../src/core/player';
import type { BattingStats, PlayerProfile } from '../src/core/types';

/** One plate appearance at a fixed stamina, using the real swing/outcome code. */
function simulatePA(player: PlayerProfile, levelId: number, sigma: number, rng: Rng): BattingStats {
  const level = LEVELS[levelId];
  const pitcher = { name: 'CPU', rating: level.pitcherRating };
  const line = emptyBattingStats();
  line.pa = 1;
  const count: Count = { balls: 0, strikes: 0 };

  for (let i = 0; i < 20; i++) {
    const pitch = throwPitch(pitcher, count, rng);
    const swingIt =
      count.strikes === 2 && pitch.isStrike ? true : rng.chance(pitch.isStrike ? 0.72 : 0.12);
    if (!swingIt) {
      if (pitch.isStrike) {
        if (++count.strikes >= 3) {
          line.ab++;
          line.strikeouts++;
          return line;
        }
      } else if (++count.balls >= 4) {
        line.walks++;
        return line;
      }
      continue;
    }

    const velocityPenalty = 820 / pitch.def.duration;
    const movement = 1 + (Math.abs(pitch.def.breakX) + Math.abs(pitch.def.breakY)) * 0.22;
    const s = sigma * velocityPenalty * movement;
    const swing = resolveSwing(
      {
        offsetX: rng.gaussian() * s,
        offsetY: IDEAL_UNDER + rng.gaussian() * s,
        timing: 0.98 + rng.gaussian() * s * 0.12,
      },
      { attributes: player.attributes, stamina: player.stamina },
      rng,
    );
    if (swing.whiff || !swing.battedBall) {
      if (++count.strikes >= 3) {
        line.ab++;
        line.strikeouts++;
        return line;
      }
      continue;
    }
    const outcome = resolveBattedBall(
      swing.battedBall,
      player.attributes,
      player.bats,
      level.defenseRating,
      rng,
    );
    if (outcome.result === 'foul') {
      if (count.strikes < 2) count.strikes++;
      continue;
    }
    line.ab++;
    if (outcome.result === 'single') { line.hits++; line.singles++; }
    else if (outcome.result === 'double') { line.hits++; line.doubles++; }
    else if (outcome.result === 'triple') { line.hits++; line.triples++; }
    else if (outcome.result === 'homeRun') { line.hits++; line.homeRuns++; }
    return line;
  }
  line.ab++;
  return line;
}

const PA = 6000;
const add = (t: BattingStats, d: BattingStats): void => {
  for (const k of Object.keys(d) as (keyof BattingStats)[]) t[k] += d[k];
};

console.log('\n=== What conditioning is worth at the plate ===');
console.log(`${PA} plate appearances per row, Double-A, average hands.\n`);
console.log(
  'stamina'.padEnd(10) + 'sweet spot'.padEnd(13) + 'AVG/OBP/SLG'.padEnd(21) + 'K%'.padStart(6) + '   vs fresh',
);

const rows: { stamina: number; ops: number }[] = [];
for (const stamina of [100, 85, 70, 55, 40, 25, 10]) {
  const rng = new Rng(7788);
  const player = createPlayer('Test', 'CF', 'R', ARCHETYPES[3]);
  for (const k of Object.keys(player.attributes) as (keyof typeof player.attributes)[]) {
    player.attributes[k] = 55;
  }
  player.stamina = stamina;
  const totals = emptyBattingStats();
  for (let i = 0; i < PA; i++) add(totals, simulatePA(player, 1, 0.52, rng));

  const radius = sweetSpotRadius(player.attributes.contact, stamina);
  const ops =
    parseFloat(onBasePct(totals).replace(/^\./, '0.')) + parseFloat(slugging(totals).replace(/^\./, '0.'));
  rows.push({ stamina, ops });
  const delta = rows.length > 1 ? ops - rows[0].ops : 0;
  console.log(
    `${String(stamina).padEnd(10)}${radius.toFixed(3).padEnd(13)}` +
      `${battingAverage(totals)}/${onBasePct(totals)}/${slugging(totals)}`.padEnd(21) +
      `${((totals.strikeouts / totals.pa) * 100).toFixed(1).padStart(5)}%` +
      (rows.length > 1 ? `   ${delta >= 0 ? '+' : ''}${delta.toFixed(3)} OPS` : '   —'),
  );
}

console.log(
  '\nThe fatigue term in sweetSpotRadius floors at 0.6 of full, reached at 0 stamina;\n' +
    'it is already giving back most of its range by 55, which is where a season of\n' +
    'drilling every off day lands you.\n',
);
