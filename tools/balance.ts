/**
 * Balance harness for the hitting model.
 *
 * Simulates plate appearances headlessly by modelling the player's tap as a
 * point drawn around the ideal contact spot — tighter for a skilled human,
 * looser for a sloppy one — then runs the real swing/outcome code on it.
 *
 * Run: npx tsx tools/balance.ts
 */
import { Rng, clamp } from '../src/core/rng';
import { throwPitch } from '../src/core/pitching';
import { IDEAL_UNDER, resolveSwing } from '../src/core/swing';
import { resolveBattedBall } from '../src/core/outcome';
import { LEVELS } from '../src/core/league';
import {
  ARCHETYPES,
  battingAverage,
  createPlayer,
  emptyBattingStats,
  onBasePct,
  overallRating,
  slugging,
} from '../src/core/player';
import type { BattingStats, PlayerProfile } from '../src/core/types';

/** How well the human aims, in ball radii of scatter. Lower = better player. */
type Skill = { name: string; sigma: number; /** chance they correctly lay off a ball */ discipline: number };

/**
 * Scatter is in ball radii. Tapping a ball that is moving roughly its own
 * radius every 40ms near the plate means even a sharp player lands a third of
 * a radius off; these are calibrated to that reality, not to a mouse click.
 */
const SKILLS: Skill[] = [
  { name: 'expert', sigma: 0.36, discipline: 0.85 },
  { name: 'decent', sigma: 0.52, discipline: 0.62 },
  { name: 'button-masher', sigma: 0.95, discipline: 0.12 },
];

/** Diagnostics collected across a cohort. */
const diag = { pitches: 0, strikesThrown: 0, swings: 0, whiffs: 0 };

function simulatePA(player: PlayerProfile, levelId: number, skill: Skill, rng: Rng): BattingStats {
  const level = LEVELS[levelId];
  const pitcher = { name: 'CPU', rating: level.pitcherRating };
  const line = emptyBattingStats();
  line.pa = 1;

  let balls = 0;
  let strikes = 0;

  for (let pitchNo = 0; pitchNo < 20; pitchNo++) {
    const pitch = throwPitch(pitcher, { balls, strikes }, rng);
    diag.pitches++;
    if (pitch.isStrike) diag.strikesThrown++;

    // Swing decision, modelled on real swing rates: hitters offer at roughly
    // two thirds of strikes and chase a minority of balls, and protect the
    // plate with two strikes.
    const zoneSwing = 0.6 + (1 - skill.discipline) * 0.22;
    const chase = clamp(0.4 - skill.discipline * 0.3, 0.03, 0.5);
    const shouldSwing =
      strikes === 2 && pitch.isStrike ? true : rng.chance(pitch.isStrike ? zoneSwing : chase);

    if (!shouldSwing) {
      if (pitch.isStrike) {
        strikes++;
        if (strikes >= 3) {
          line.ab++;
          line.strikeouts++;
          return line;
        }
      } else {
        balls++;
        if (balls >= 4) {
          line.walks++;
          return line;
        }
      }
      continue;
    }

    diag.swings++;
    // Aim at the ideal contact point, with scatter for human imprecision.
    // Harder throwers give you less time to place the tap; Vision buys some
    // of that back by revealing the pitch earlier.
    // Derived from the pitch actually thrown, so tuning pitch physics shows up
    // here automatically instead of needing the harness retuned by hand.
    const velocityPenalty = 820 / pitch.def.duration;
    const movement = 1 + (Math.abs(pitch.def.breakX) + Math.abs(pitch.def.breakY)) * 0.22;
    const visionHelp = 1 - (player.attributes.vision / 100) * 0.14;
    const sigma = skill.sigma * velocityPenalty * movement * visionHelp;

    const offsetX = rng.gaussian() * sigma;
    const offsetY = IDEAL_UNDER + rng.gaussian() * sigma;
    const timing = 0.98 + rng.gaussian() * sigma * 0.12;

    const swing = resolveSwing(
      { offsetX, offsetY, timing },
      { attributes: player.attributes, stamina: player.stamina },
      rng,
    );

    if (swing.whiff || !swing.battedBall) {
      diag.whiffs++;
      strikes++;
      if (strikes >= 3) {
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
      if (strikes < 2) strikes++;
      continue;
    }

    line.ab++;
    switch (outcome.result) {
      case 'single':
        line.hits++;
        line.singles++;
        break;
      case 'double':
        line.hits++;
        line.doubles++;
        break;
      case 'triple':
        line.hits++;
        line.triples++;
        break;
      case 'homeRun':
        line.hits++;
        line.homeRuns++;
        break;
      default:
        break;
    }
    return line;
  }

  line.ab++;
  return line;
}

function add(target: BattingStats, delta: BattingStats): void {
  for (const key of Object.keys(delta) as (keyof BattingStats)[]) target[key] += delta[key];
}

function runCohort(label: string, player: PlayerProfile, levelId: number, skill: Skill, n: number): void {
  const rng = new Rng(20260808);
  const totals = emptyBattingStats();
  diag.pitches = diag.strikesThrown = diag.swings = diag.whiffs = 0;
  for (let i = 0; i < n; i++) add(totals, simulatePA(player, levelId, skill, rng));

  const kRate = ((totals.strikeouts / totals.pa) * 100).toFixed(1);
  const bbRate = ((totals.walks / totals.pa) * 100).toFixed(1);
  const hrPer600 = ((totals.homeRuns / totals.pa) * 600).toFixed(0);
  const zoneRate = ((diag.strikesThrown / diag.pitches) * 100).toFixed(0);
  const whiffRate = ((diag.whiffs / Math.max(1, diag.swings)) * 100).toFixed(0);

  console.log(
    `${label.padEnd(30)} ${battingAverage(totals)}/${onBasePct(totals)}/${slugging(totals)}` +
      `  K ${kRate.padStart(4)}%  BB ${bbRate.padStart(4)}%  HR/600 ${hrPer600.padStart(3)}` +
      `  |  zone ${zoneRate}%  whiff/swing ${whiffRate.padStart(2)}%`,
  );
}

const PA_PER_COHORT = 4000;

console.log('\n=== Hitting model balance ===');
console.log(`${PA_PER_COHORT} plate appearances per cohort. Real MLB baseline: ~.245/.315/.410, K 22%, BB 8.5%, HR/600 ~25\n`);

for (const skill of SKILLS) {
  console.log(`-- player skill: ${skill.name} (aim scatter ${skill.sigma}) --`);
  for (let levelId = 0; levelId < LEVELS.length; levelId++) {
    const level = LEVELS[levelId];
    // Give the player attributes appropriate to the level they're facing.
    const player = createPlayer('Test', 'CF', 'R', ARCHETYPES[3]);
    const target = [38, 55, 70, 82][levelId];
    for (const key of Object.keys(player.attributes) as (keyof typeof player.attributes)[]) {
      player.attributes[key] = clamp(target, 5, 99);
    }
    runCohort(`  ${level.name} (OVR ${overallRating(player.attributes)})`, player, levelId, skill, PA_PER_COHORT);
  }
  console.log('');
}

// Stamina check: same player, fresh vs gassed.
console.log('-- stamina impact (Double-A, decent player) --');
for (const stamina of [100, 60, 25]) {
  const player = createPlayer('Test', 'CF', 'R', ARCHETYPES[3]);
  for (const key of Object.keys(player.attributes) as (keyof typeof player.attributes)[]) {
    player.attributes[key] = 55;
  }
  player.stamina = stamina;
  runCohort(`  stamina ${stamina}`, player, 1, SKILLS[1], PA_PER_COHORT);
}

// Archetype check at Single-A.
console.log('\n-- archetypes (Single-A, decent player, all attrs +0) --');
for (const archetype of ARCHETYPES) {
  const player = createPlayer('Test', 'CF', 'R', archetype);
  runCohort(`  ${archetype.name}`, player, 0, SKILLS[1], PA_PER_COHORT);
}
console.log('');
