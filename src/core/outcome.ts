import type {
  AtBatOutcome,
  Attributes,
  BattedBall,
  ContactQuality,
  Handedness,
  PlayResult,
} from './types';
import { Rng, clamp } from './rng';

/** Which field the ball is headed to, accounting for handedness. */
export function fieldFor(spray: number, bats: Handedness): 'left' | 'center' | 'right' {
  const s = bats === 'L' ? -spray : spray;
  if (s < -0.33) return 'left';
  if (s > 0.33) return 'right';
  return 'center';
}

export function infielderFor(spray: number, bats: Handedness): string {
  const s = bats === 'L' ? -spray : spray;
  if (s < -0.6) return 'third';
  if (s < -0.15) return 'short';
  if (s < 0.4) return 'second';
  return 'first';
}

const out = (
  result: PlayResult,
  description: string,
  battedBall?: BattedBall,
): AtBatOutcome => ({ result, description, battedBall, terminal: true, basesAdvanced: 0 });

const hit = (
  result: PlayResult,
  description: string,
  bases: number,
  battedBall?: BattedBall,
): AtBatOutcome => ({
  result,
  description,
  battedBall,
  terminal: true,
  basesAdvanced: bases,
});

/**
 * Chance that contact of a given quality is fouled off rather than put in
 * play. Shared by the abstract resolver and the live-play path so plate
 * appearances develop at the same rate either way.
 */
export function foulChanceFor(quality: ContactQuality): number {
  if (quality === 'mishit') return 0.58;
  if (quality === 'weak') return 0.34;
  if (quality === 'flare') return 0.15;
  return 0.05;
}

/**
 * Probability a batted ball leaves the park. Peaks around 29 degrees and needs
 * real exit velocity behind it — the same shape as real batted-ball data.
 */
export function homeRunChance(exitVelocity: number, launchAngle: number): number {
  if (launchAngle < 19 || launchAngle > 42 || exitVelocity < 94) return 0;
  const speed = clamp((exitVelocity - 94) / 18, 0, 1);
  const angle = clamp(1 - Math.abs(launchAngle - 29) / 12, 0, 1);
  return clamp(speed * angle * 0.85, 0, 0.88);
}

/**
 * Turn a batted ball into a play. Exit velocity and launch angle do the work,
 * the way they do in real batted-ball data: hard and ~25 degrees leaves the
 * yard, hard and flat is a line-drive hit, soft anything is an out.
 */
export function resolveBattedBall(
  bb: BattedBall,
  attributes: Attributes,
  bats: Handedness,
  defenseRating: number,
  rng: Rng,
): AtBatOutcome {
  const { exitVelocity: ev, launchAngle: la, spray, quality } = bb;
  const speed = clamp(attributes.speed, 1, 99) / 100;
  // Better defenses convert more balls in play into outs.
  const defense = clamp(defenseRating / 100, 0, 1);
  const field = fieldFor(spray, bats);

  // Balls hit near the foul lines with real carry go foul a fair amount.
  if (Math.abs(spray) > 0.86 && la > 8 && rng.chance(0.45)) {
    return { result: 'foul', description: 'Sliced foul down the line.', terminal: false, basesAdvanced: 0 };
  }

  // Off-barrel contact mostly goes foul. This is what keeps plate appearances
  // alive long enough for counts, walks and strikeouts to mean anything.
  const foulChance = foulChanceFor(quality);
  if (rng.chance(foulChance)) {
    return {
      result: 'foul',
      description: quality === 'mishit' ? 'Fouled straight back.' : 'Fouled off.',
      terminal: false,
      basesAdvanced: 0,
    };
  }

  if (quality === 'mishit') {
    if (la > 45) return out('popout', `Popped up weakly to ${infielderFor(spray, bats)}.`, bb);
    return out('groundout', `Dribbler to ${infielderFor(spray, bats)}. Thrown out.`, bb);
  }

  // ---- The barrel zone --------------------------------------------------
  // Hard contact in the right launch window leaves the yard. Checked before
  // the trajectory buckets so a 25-degree rocket isn't classed as a fly out.
  // Tougher leagues play in front of better outfields and deeper parks.
  const hr = homeRunChance(ev, la) * (1 - defense * 0.25);
  if (hr > 0 && rng.chance(hr)) {
    return hit('homeRun', `Deep to ${field}... that ball is GONE!`, 4, bb);
  }

  // ---- Popups -----------------------------------------------------------
  if (la > 48) {
    return out('popout', `Popped up to ${field} field. Easy out.`, bb);
  }

  // ---- Ground balls -----------------------------------------------------
  if (la < 8) {
    const hardEnough = clamp((ev - 72) / 32, 0, 1);
    const holeChance = clamp(0.2 + hardEnough * 0.34 + speed * 0.22 - defense * 0.3, 0.04, 0.65);
    if (rng.chance(holeChance)) {
      if (speed > 0.72 && ev > 96 && rng.chance(0.18)) {
        return hit('double', `Scorched into the ${field}-field corner. Hustle double!`, 2, bb);
      }
      return hit('single', `Ground ball finds a hole through the ${field} side. Base hit!`, 1, bb);
    }
    if (la < -8 && rng.chance(0.3)) {
      return out('groundout', `Chopped into the dirt, ${infielderFor(spray, bats)} handles it.`, bb);
    }
    return out('groundout', `Ground ball to ${infielderFor(spray, bats)}. Out at first.`, bb);
  }

  // ---- Line drives ------------------------------------------------------
  if (la < 26) {
    const strength = clamp((ev - 76) / 28, 0, 1);
    const hitChance = clamp(0.5 + strength * 0.42 - defense * 0.34, 0.18, 0.9);
    if (rng.chance(hitChance)) {
      if (ev > 96 && rng.chance(0.42)) {
        if (speed > 0.78 && field !== 'center' && rng.chance(0.16)) {
          return hit('triple', `Into the ${field}-field gap and rolling — triple!`, 3, bb);
        }
        return hit('double', `Line drive into the ${field}-field gap. Double!`, 2, bb);
      }
      return hit('single', `Line drive to ${field}. Base hit.`, 1, bb);
    }
    return out('lineout', `Lined right at the ${field} fielder. Caught.`, bb);
  }

  // ---- Fly balls --------------------------------------------------------
  // Anything with home-run juice was already resolved above; what's left is
  // warning-track outs and balls off the wall.
  if (ev > 92) {
    if (rng.chance(clamp(0.3 + (ev - 92) / 30 - defense * 0.12, 0.1, 0.7))) {
      return hit('double', `Off the wall in ${field}! Stand-up double.`, 2, bb);
    }
    return out('flyout', `Deep fly to ${field}, tracked down at the track.`, bb);
  }
  if (ev > 84 && rng.chance(0.22)) {
    return hit('single', `Bloop single drops in front of the ${field} fielder.`, 1, bb);
  }
  return out('flyout', `Routine fly ball to ${field}. Out.`, bb);
}
