/**
 * Why does the player's club lose?
 *
 * Isolates the three things that make the player's half of the game different
 * from the simulated one:
 *   1. the player's own plate appearances replace a simulated teammate's,
 *   2. balls hit at the player's position go to the live field instead of
 *      being resolved abstractly,
 *   3. balls the player puts in play go to the live field too.
 *
 * Run: npx tsx tools/halves.ts
 */
import { Rng, clamp } from '../src/core/rng';
import { LEVELS, createLeague, playerTeam, teamById } from '../src/core/league';
import { GameSim } from '../src/core/gameSim';
import { PlaySim } from '../src/core/playSim';
import type { PlayOutcome } from '../src/core/playSim';
import { throwPitch } from '../src/core/pitching';
import type { Count } from '../src/core/pitching';
import { IDEAL_UNDER, resolveSwing } from '../src/core/swing';
import { foulChanceFor } from '../src/core/outcome';
import { launchBall, predictLanding } from '../src/core/ballFlight';
import { isFair, toPositionId } from '../src/core/fieldGeometry';
import { CALM, airFor } from '../src/core/weather';
import { ARCHETYPES, createPlayer } from '../src/core/player';
import type { AtBatOutcome, BattedBall, PlayerProfile } from '../src/core/types';

const DT = 1 / 60;
const air = airFor(CALM);

/** How a fielding/offense event is handled in a given experiment arm. */
type Mode = 'live' | 'autoOut' | 'abstract';

/**
 * Mirror of GameSim's private `ballInPlayFalls`, so an arm can resolve the
 * player's position exactly the way every other position is resolved. Keep in
 * step with the constants in core/gameSim.ts.
 */
function abstractFalls(defenseRating: number, quality: string, rng: Rng): boolean {
  const defense = clamp(defenseRating, 10, 99) / 100;
  const contact =
    quality === 'barrel' ? 1.7 : quality === 'solid' ? 1.25 : quality === 'flare' ? 0.9 : 0.55;
  return rng.chance(clamp(0.2 * contact * (1.25 - defense * 0.5), 0.03, 0.6));
}

function pa(
  sim: GameSim,
  player: PlayerProfile,
  sigma: number,
  discipline: number,
  rng: Rng,
): { terminal?: AtBatOutcome; battedBall?: BattedBall } {
  const count: Count = { balls: 0, strikes: 0 };
  for (let i = 0; i < 24; i++) {
    const pitch = throwPitch(sim.pitcher, count, rng);
    const zoneSwing = 0.62 + (1 - discipline) * 0.2;
    const chase = clamp(0.4 - discipline * 0.3, 0.03, 0.5);
    const swingIt =
      count.strikes === 2 && pitch.isStrike ? true : rng.chance(pitch.isStrike ? zoneSwing : chase);
    if (!swingIt) {
      if (pitch.isStrike) {
        if (++count.strikes >= 3)
          return { terminal: { result: 'strikeout', description: 'K', terminal: true, basesAdvanced: 0 } };
      } else if (++count.balls >= 4) {
        return { terminal: { result: 'walk', description: 'BB', terminal: true, basesAdvanced: 1 } };
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
      if (++count.strikes >= 3)
        return { terminal: { result: 'strikeout', description: 'K', terminal: true, basesAdvanced: 0 } };
      continue;
    }
    const bb = swing.battedBall;
    const landing = predictLanding(
      launchBall(bb.exitVelocity, bb.launchAngle, bb.spray, 1, bb.sideSpin ?? 0, air),
    );
    if (!isFair(landing.point) || rng.chance(foulChanceFor(bb.quality))) {
      if (count.strikes < 2) count.strikes++;
      continue;
    }
    return { battedBall: bb };
  }
  return { terminal: { result: 'strikeout', description: 'K', terminal: true, basesAdvanced: 0 } };
}

function livePlay(
  sim: GameSim,
  player: PlayerProfile,
  bb: BattedBall,
  side: 'offense' | 'defense',
  level: (typeof LEVELS)[number],
  rng: Rng,
  track?: { hits: number; outs: number; errors: number; n: number },
): PlayOutcome {
  const play = new PlaySim({
    battedBall: bb,
    bats: player.bats,
    attributes: player.attributes,
    userPosition: toPositionId(player.position),
    userSide: side,
    runnersOn: [...sim.bases],
    outs: sim.outs,
    opponentRating: level.defenseRating,
    rng,
  });
  let frames = 0;
  while (play.phase !== 'dead' && frames < 60 * 40) {
    if (play.phase === 'catch' && play.pendingCatch) {
      play.resolveCatchAttempt(
        rng.chance(clamp(0.68 + player.attributes.fielding / 250 - play.pendingCatch.difficulty * 0.35, 0.2, 0.95)),
      );
      continue;
    }
    if (side === 'defense') {
      const f = play.userFielder;
      if (f) {
        const goal = play.ball.bounced ? { x: play.ball.x, y: play.ball.y } : play.landingPoint;
        const dx = goal.x - f.x;
        const dy = goal.y - f.y;
        const r = Math.hypot(dx, dy) || 1;
        play.moveUserFielder(dx / r, dy / r, DT);
      }
      if (play.userHasBall) play.throwTo(1);
    } else if (play.throwBeatingUserRunner && !play.userRunnerRetreating) {
      if (play.userBackTarget !== null) play.retreatRunner();
    } else if (play.ball.bounced && play.userGoTarget !== null && frames % 20 === 0) {
      play.advanceRunner();
    }
    play.update(DT);
    frames++;
  }
  const outcome =
    play.outcome ??
    ({
      kind: 'out',
      outs: 1,
      runs: 0,
      basesAfter: [...sim.bases],
      description: 'out',
      userPutout: false,
      userError: false,
      reachedOnError: false,
    } as PlayOutcome);
  if (track) {
    track.n++;
    if (outcome.kind === 'out') track.outs++;
    else track.hits++;
    if (outcome.userError || outcome.reachedOnError) track.errors++;
  }
  return outcome;
}

interface Arm {
  label: string;
  /** How the player's own batted balls resolve. */
  offense: Mode;
  /** How balls hit at the player's position resolve. */
  defense: Mode;
  /** Replace the player's PA with a simulated teammate's? */
  skipPlayerPa: boolean;
}

function runArm(arm: Arm, levelId: number, games: number, sigma: number, discipline: number): void {
  const rng = new Rng(90210);
  const level = LEVELS[levelId];
  const player = createPlayer('Sim', 'CF', 'R', ARCHETYPES[3]);
  for (const k of Object.keys(player.attributes) as (keyof typeof player.attributes)[]) {
    player.attributes[k] = [38, 55, 70, 82][levelId];
  }
  const league = createLeague(levelId, rng);
  let w = 0;
  let l = 0;
  let tie = 0;
  let rf = 0;
  let ra = 0;
  const defTrack = { hits: 0, outs: 0, errors: 0, n: 0 };
  const offTrack = { hits: 0, outs: 0, errors: 0, n: 0 };

  for (let g = 0; g < games; g++) {
    const opponent = teamById(league, league.teams[1 + (g % 5)].id);
    const sim = new GameSim(player, level, playerTeam(league), opponent, g % 2 === 0, rng);
    let guard = 0;
    while (guard++ < 900) {
      const event = sim.step();
      if (event.kind === 'gameOver') break;
      if (event.kind === 'atBat') {
        if (arm.skipPlayerPa) {
          // Resolve the player's slot as if a league-average teammate had it.
          const roll = rng.next();
          if (roll < 0.22) {
            sim.submitAtBat({ result: 'strikeout', description: 'K', terminal: true, basesAdvanced: 0 });
          } else if (roll < 0.3) {
            sim.submitAtBat({ result: 'walk', description: 'BB', terminal: true, basesAdvanced: 1 });
          } else if (roll < 0.5) {
            const bases = rng.chance(0.76) ? 1 : rng.chance(0.78) ? 2 : 4;
            const kind = bases === 1 ? 'single' : bases === 2 ? 'double' : 'homeRun';
            sim.submitAtBat({ result: kind, description: kind, terminal: true, basesAdvanced: bases } as AtBatOutcome);
          } else {
            sim.submitAtBat({ result: 'groundout', description: 'out', terminal: true, basesAdvanced: 0 });
          }
          continue;
        }
        const res = pa(sim, player, sigma, discipline, rng);
        if (res.terminal) sim.submitAtBat(res.terminal);
        else if (res.battedBall) {
          if (arm.offense === 'live') {
            sim.submitLivePlay(livePlay(sim, player, res.battedBall, 'offense', level, rng, offTrack), 'us');
          } else {
            // Abstract: the same automatic out a teammate's ball in play gets.
            sim.submitAtBat({ result: 'groundout', description: 'out', terminal: true, basesAdvanced: 0 });
          }
        }
      } else if (event.kind === 'fielding') {
        if (arm.defense === 'live') {
          sim.submitLivePlay(livePlay(sim, player, event.battedBall, 'defense', level, rng, defTrack), 'them');
        } else if (arm.defense === 'abstract') {
          // Exactly what a ball hit at any OTHER position gets.
          const fell = abstractFalls(level.defenseRating, event.battedBall.quality, rng);
          defTrack.n++;
          if (fell) {
            defTrack.hits++;
            const bases = rng.chance(0.85) ? 1 : 2;
            const before = [...sim.bases];
            let runs = 0;
            const next = [false, false, false];
            for (let b = 2; b >= 0; b--) {
              if (!before[b]) continue;
              if (b + bases >= 3) runs++;
              else next[b + bases] = true;
            }
            next[bases - 1] = true;
            sim.submitLivePlay(
              {
                kind: bases === 1 ? 'single' : 'double',
                outs: 0,
                runs,
                basesAfter: next,
                description: 'base hit',
                userPutout: false,
                userError: false,
                reachedOnError: false,
              } as PlayOutcome,
              'them',
            );
          } else {
            defTrack.outs++;
            sim.submitLivePlay(
              {
                kind: 'out',
                outs: 1,
                runs: 0,
                basesAfter: [...sim.bases],
                description: 'out',
                userPutout: true,
                userError: false,
                reachedOnError: false,
              } as PlayOutcome,
              'them',
            );
          }
        } else {
          // What every ball NOT hit at the player used to get: a certain out.
          sim.submitLivePlay(
            {
              kind: 'out',
              outs: 1,
              runs: 0,
              basesAfter: [...sim.bases],
              description: 'out',
              userPutout: true,
              userError: false,
              reachedOnError: false,
            } as PlayOutcome,
            'them',
          );
          defTrack.n++;
          defTrack.outs++;
        }
      }
    }
    if (sim.score.us > sim.score.them) w++;
    else if (sim.score.us < sim.score.them) l++;
    else tie++;
    rf += sim.score.us;
    ra += sim.score.them;
  }

  const pct = (w / Math.max(1, w + l)).toFixed(3).replace(/^0/, '');
  console.log(
    `${arm.label.padEnd(44)} ${w}-${l}${tie ? `-${tie}` : ''}  ${pct}` +
      `  RF/g ${(rf / games).toFixed(2)}  RA/g ${(ra / games).toFixed(2)}` +
      `  | user fielding: ${defTrack.n} chances, ${((defTrack.outs / Math.max(1, defTrack.n)) * 100).toFixed(0)}% outs` +
      (offTrack.n ? `  | user BIP: ${offTrack.n}, ${((offTrack.hits / offTrack.n) * 100).toFixed(0)}% hits` : ''),
  );
}

const GAMES = 240;
console.log(`\n=== Why the club loses (${GAMES} games per arm, Double-A, "decent" hands) ===\n`);

runArm(
  { label: 'A. as shipped (live offense + live defense)', offense: 'live', defense: 'live', skipPlayerPa: false },
  1, GAMES, 0.52, 0.62,
);
runArm(
  { label: 'B. live offense, defense auto-out', offense: 'live', defense: 'autoOut', skipPlayerPa: false },
  1, GAMES, 0.52, 0.62,
);
runArm(
  { label: 'C. offense auto-out, live defense', offense: 'autoOut', defense: 'live', skipPlayerPa: false },
  1, GAMES, 0.52, 0.62,
);
runArm(
  { label: 'D. no player at all (pure sim vs sim)', offense: 'autoOut', defense: 'autoOut', skipPlayerPa: true },
  1, GAMES, 0.52, 0.62,
);

console.log(`\n=== Live glove vs the same ball resolved abstractly, per level ===\n`);
for (let lv = 0; lv < LEVELS.length; lv++) {
  runArm(
    { label: `  ${LEVELS[lv].name}: player fields it live`, offense: 'live', defense: 'live', skipPlayerPa: false },
    lv, GAMES, 0.52, 0.62,
  );
  runArm(
    { label: `  ${LEVELS[lv].name}: same ball, abstract`, offense: 'live', defense: 'abstract', skipPlayerPa: false },
    lv, GAMES, 0.52, 0.62,
  );
}

console.log(`\n=== Pure sim-vs-sim at every level (the baseline the league plays at) ===\n`);
for (let lv = 0; lv < LEVELS.length; lv++) {
  runArm(
    { label: `  ${LEVELS[lv].name} sim only`, offense: 'autoOut', defense: 'autoOut', skipPlayerPa: true },
    lv, GAMES, 0.52, 0.62,
  );
}
console.log('');
