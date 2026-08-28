/**
 * A human being's season at the plate, simulated headlessly.
 *
 * Shared because more than one harness needs the same thing: a season line
 * produced by the *real* swing and batted-ball code rather than by a model of
 * it. Anything that asks 'is this reachable?' has to ask it of the code the
 * player actually plays against, or the answer is about the model instead.
 *
 * The player's tap is drawn as a point scattered around the ideal contact
 * spot — tight for a sharp player, loose for a sloppy one — and everything
 * downstream of that is production code.
 *
 * `tools/balance.ts` keeps its own variant of this: it reports zone and whiff
 * diagnostics per pitch, which this one deliberately throws away.
 */
import { LEVELS, SEASON_GAMES } from '../src/core/league';
import { throwPitch } from '../src/core/pitching';
import { IDEAL_UNDER, resolveSwing } from '../src/core/swing';
import { resolveBattedBall } from '../src/core/outcome';
import { ARCHETYPES, createPlayer, emptyBattingStats } from '../src/core/player';
import { Rng, clamp } from '../src/core/rng';
import type { BattingStats, PlayerProfile } from '../src/core/types';


/** Aim scatter in ball radii, the same three standards `tools/balance.ts` uses. */
export const SKILLS = [
  { name: 'star', sigma: 0.36, discipline: 0.85 },
  { name: 'ordinary', sigma: 0.52, discipline: 0.62 },
  { name: 'flailing', sigma: 0.95, discipline: 0.12 },
];

export type Skill = (typeof SKILLS)[number];

/** One plate appearance, run through the real swing and batted-ball code. */
export function simulatePA(player: PlayerProfile, levelId: number, skill: Skill, rng: Rng): BattingStats {
  const level = LEVELS[levelId];
  const pitcher = { name: 'CPU', rating: level.pitcherRating };
  const line = emptyBattingStats();
  line.pa = 1;

  let balls = 0;
  let strikes = 0;

  for (let pitchNo = 0; pitchNo < 20; pitchNo++) {
    const pitch = throwPitch(pitcher, { balls, strikes }, rng);
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

    const velocityPenalty = 820 / pitch.def.duration;
    const movement = 1 + (Math.abs(pitch.def.breakX) + Math.abs(pitch.def.breakY)) * 0.22;
    const visionHelp = 1 - (player.attributes.vision / 100) * 0.14;
    const sigma = skill.sigma * velocityPenalty * movement * visionHelp;

    const swing = resolveSwing(
      {
        offsetX: rng.gaussian() * sigma,
        offsetY: IDEAL_UNDER + rng.gaussian() * sigma,
        timing: 0.98 + rng.gaussian() * sigma * 0.12,
      },
      { attributes: player.attributes, stamina: player.stamina },
      rng,
    );

    if (swing.whiff || !swing.battedBall) {
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
    if (outcome.result === 'single') (line.hits++, line.singles++);
    else if (outcome.result === 'double') (line.hits++, line.doubles++);
    else if (outcome.result === 'triple') (line.hits++, line.triples++);
    else if (outcome.result === 'homeRun') (line.hits++, line.homeRuns++);
    return line;
  }

  line.ab++;
  return line;
}

export const add = (target: BattingStats, delta: BattingStats): void => {
  for (const key of Object.keys(delta) as (keyof BattingStats)[]) target[key] += delta[key];
};

/** A whole season at the plate, batting second over the full schedule. */
export function playSeason(player: PlayerProfile, levelId: number, skill: Skill, rng: Rng): BattingStats {
  const totals = emptyBattingStats();
  // Batting second in a nine-man order is a shade over four trips a night.
  const plateAppearances = Math.round(SEASON_GAMES * rng.range(3.8, 4.3));
  for (let i = 0; i < plateAppearances; i++) add(totals, simulatePA(player, levelId, skill, rng));

  // Runs and RBI aren't modelled by the abstract resolver, so estimate them
  // the way the ballot will see them: mostly a function of the extra bases.
  const extra = totals.hits - totals.homeRuns;
  totals.rbi = Math.round(totals.homeRuns * 1.7 + extra * 0.42);
  totals.runs = Math.round(totals.homeRuns + extra * 0.44 + totals.walks * 0.3);
  return totals;
}

/** The attributes a player realistically carries at each level. */
export const LEVEL_ATTRIBUTES = [38, 55, 70, 82];

export function playerAt(levelId: number): PlayerProfile {
  const player = createPlayer('You', 'CF', 'R', ARCHETYPES[3]);
  const target = LEVEL_ATTRIBUTES[levelId];
  for (const key of Object.keys(player.attributes) as (keyof typeof player.attributes)[]) {
    player.attributes[key] = target;
  }
  return player;
}