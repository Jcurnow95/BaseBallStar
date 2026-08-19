/**
 * Runs live plays headlessly to check they always resolve, and that a passive
 * player gets punished rather than the play hanging.
 * Run: npx tsx tools/play.ts
 */
import { PlaySim } from '../src/core/playSim';
import type { PlayOutcome, UserSide } from '../src/core/playSim';
import type { BattedBall, ContactQuality } from '../src/core/types';
import { ARCHETYPES, createPlayer } from '../src/core/player';
import { Rng, clamp } from '../src/core/rng';
import type { PositionId } from '../src/core/fieldGeometry';

const DT = 1 / 60;
const MAX_FRAMES = 60 * 40;

function randomBattedBall(rng: Rng): BattedBall {
  const roll = rng.next();
  const quality: ContactQuality =
    roll < 0.12 ? 'barrel' : roll < 0.34 ? 'solid' : roll < 0.66 ? 'flare' : 'weak';
  const bonus = quality === 'barrel' ? 20 : quality === 'solid' ? 12 : quality === 'flare' ? 4 : -6;
  return {
    quality,
    exitVelocity: clamp(80 + bonus + rng.gaussian() * 6, 45, 118),
    launchAngle: clamp(rng.gaussian() * 18 + 14, -20, 62),
    spray: clamp(rng.gaussian() * 0.4, -0.73, 0.73),
  };
}

interface Report {
  counts: Record<string, number>;
  methods: Record<string, number>;
  frames: number[];
  stuck: number;
  timeouts: number;
  runs: number;
  outs: number;
  stretchCatches: number;
  stretchMade: number;
  errors: number;
  /** Plays where two live runners stood within a few strides of each other. */
  crowded: number;
  /** Plays that ended with two runners credited with the same base. */
  doubledUp: number;
  /** Times the autopilot pressed BACK. */
  backs: number;
  /** Outs recorded on runners other than the batter. */
  runnerOuts: number;
}

function runCohort(
  label: string,
  side: UserSide,
  position: PositionId,
  chase: boolean,
  runnersOn: boolean[],
  plays: number,
): void {
  const rng = new Rng(4242);
  let diagnosed = 0;
  const player = createPlayer('Test', position as never, 'R', ARCHETYPES[3]);
  const report: Report = {
    counts: {},
    methods: {},
    frames: [],
    stuck: 0,
    timeouts: 0,
    runs: 0,
    outs: 0,
    stretchCatches: 0,
    stretchMade: 0,
    errors: 0,
    crowded: 0,
    doubledUp: 0,
    backs: 0,
    runnerOuts: 0,
  };

  for (let i = 0; i < plays; i++) {
    const sim = new PlaySim({
      battedBall: randomBattedBall(rng),
      bats: 'R',
      attributes: player.attributes,
      userPosition: position,
      userSide: side,
      runnersOn: [...runnersOn],
      outs: 0,
      opponentRating: 50,
      rng,
    });

    let frames = 0;
    let snapshot = '';
    let crowded = false;
    let crowdedFrames = 0;
    while (sim.phase !== 'dead' && frames < MAX_FRAMES) {
      // Stand in for the player's stretch-catch minigame. A competent player
      // holds on to most of them, and less often the further they reached.
      if (sim.phase === 'catch' && sim.pendingCatch) {
        report.stretchCatches++;
        const odds = 0.85 - sim.pendingCatch.difficulty * 0.35;
        const made = rng.chance(odds);
        if (made) report.stretchMade++;
        sim.resolveCatchAttempt(made);
        continue;
      }

      if (chase && side === 'defense') {
        // Naive autopilot: run at the ball's landing spot, then throw to first.
        const fielder = sim.userFielder;
        if (fielder) {
          const goal = sim.ball.bounced
            ? { x: sim.ball.x, y: sim.ball.y }
            : sim.landingPoint;
          const dx = goal.x - fielder.x;
          const dy = goal.y - fielder.y;
          const range = Math.hypot(dx, dy) || 1;
          sim.moveUserFielder(dx / range, dy / range, DT);
        }
        if (sim.userHasBall) sim.throwTo(1);
      }
      if (chase && side === 'offense') {
        // Reckless autopilot: press GO the moment the ball is down and keep
        // pressing, then scramble BACK as soon as a throw is beating you.
        if (sim.throwBeatingUserRunner && !sim.userRunnerRetreating) {
          if (sim.userBackTarget !== null) {
            sim.retreatRunner();
            report.backs++;
          }
        } else if (sim.ball.bounced && sim.userGoTarget !== null && frames % 20 === 0) {
          sim.advanceRunner();
        }
      }
      sim.update(DT);
      frames++;

      // Two runners within a few strides of each other for more than a
      // moment are standing on top of each other on screen.
      const live = sim.runners.filter((r) => !r.out && r.at < 4);
      for (let k = 1; k < live.length; k++) {
        const gap = live[k - 1].at + live[k - 1].progress - (live[k].at + live[k].progress);
        if (gap < 0.12 && ++crowdedFrames > 30) crowded = true;
      }

      // Snapshot mid-play so a stall can be seen while it is happening.
      if (frames === 8 * 60) {
        snapshot =
          `phase=${sim.phase} carrier=${sim.ballCarrier ?? '-'} atRest=${sim.ball.atRest}` +
          ` ball=(${sim.ball.x.toFixed(0)},${sim.ball.y.toFixed(0)},z${sim.ball.z.toFixed(1)})` +
          ` running=${sim.runners.some((r) => !r.out && r.at < 4 && !r.done)}` +
          ` | ${sim.runners.map((r) => `${r.id}:at${r.at}${r.done ? 'D' : '-'}`).join(' ')}` +
          ` | ${sim.fielders
            .filter((f) => f.role === 'chase')
            .map((f) => `${f.id}@(${f.x.toFixed(0)},${f.y.toFixed(0)})`)
            .join(' ')}`;
      }
    }

    if (frames / 60 > 14 && diagnosed < 3) {
      diagnosed++;
      const runners = sim.runners
        .map(
          (r) =>
            `${r.id}[at${r.at} p${r.progress.toFixed(2)} intent${r.intent}` +
            `${r.out ? ' OUT' : ''}${r.done ? ' done' : ''}]`,
        )
        .join(' ');
      const chasers = sim.fielders
        .filter((f) => f.role !== 'idle')
        .map((f) => `${f.id}:${f.role}`)
        .join(' ');
      console.log(
        `   [timeout] at 8s: ${snapshot}\n` +
          `             final: ${runners}\n             roles: ${chasers}`,
      );
    }

    if (sim.phase !== 'dead' || !sim.outcome) {
      report.stuck++;
      continue;
    }
    const outcome: PlayOutcome = sim.outcome;
    report.counts[outcome.kind] = (report.counts[outcome.kind] ?? 0) + 1;
    report.methods[sim.outMethod] = (report.methods[sim.outMethod] ?? 0) + 1;
    report.frames.push(frames);
    report.runs += outcome.runs;
    report.outs += outcome.outs;
    if (outcome.reachedOnError) report.errors++;
    report.runnerOuts += outcome.outs - (sim.outMethod === 'none' ? 0 : 1);
    if (crowded) report.crowded++;
    const bases = sim.runners.filter((r) => !r.out && r.at >= 1 && r.at <= 3).map((r) => r.at);
    if (new Set(bases).size !== bases.length) report.doubledUp++;
    if (frames / 60 > 14) report.timeouts++;
  }

  const avgSeconds = report.frames.length
    ? report.frames.reduce((a, b) => a + b, 0) / report.frames.length / 60
    : 0;
  const maxSeconds = report.frames.length ? Math.max(...report.frames) / 60 : 0;

  const kinds = Object.entries(report.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${((v / plays) * 100).toFixed(0)}%`)
    .join('  ');

  const methods = Object.entries(report.methods)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${((v / plays) * 100).toFixed(0)}%`)
    .join('  ');

  console.log(
    `${label.padEnd(38)} ${kinds}\n` +
      `${''.padEnd(38)} batter retired by: ${methods}\n` +
      `${''.padEnd(38)} stretch catches ${((report.stretchCatches / plays) * 100).toFixed(0)}%` +
      ` (held ${report.stretchCatches ? ((report.stretchMade / report.stretchCatches) * 100).toFixed(0) : '-'}%)` +
      `  errors ${((report.errors / plays) * 100).toFixed(1)}%` +
      `  crowded ${((report.crowded / plays) * 100).toFixed(0)}%` +
      `  doubled-up ${report.doubledUp}` +
      `  runner outs ${report.runnerOuts}` +
      (report.backs ? `  backs ${report.backs}` : '') +
      `\n` +
      `${''.padEnd(38)} avg ${avgSeconds.toFixed(1)}s  max ${maxSeconds.toFixed(1)}s` +
      `  timeouts ${report.timeouts}` +
      `  runs/play ${(report.runs / plays).toFixed(2)}` +
      `  ${report.stuck > 0 ? `STUCK ${report.stuck}` : 'no hangs'}\n`,
  );
}

const PLAYS = 300;
console.log(`\n=== Live play resolution (${PLAYS} plays each) ===\n`);

runCohort('offense, bases empty', 'offense', 'CF', false, [false, false, false], PLAYS);
runCohort('offense, runner on first', 'offense', 'CF', false, [true, false, false], PLAYS);
runCohort('offense, bases loaded', 'offense', 'CF', false, [true, true, true], PLAYS);
runCohort('offense, bases empty, reckless GO/BACK', 'offense', 'CF', true, [false, false, false], PLAYS);
runCohort('offense, runner on first, reckless GO/BACK', 'offense', 'CF', true, [true, false, false], PLAYS);
runCohort('defense CF, player chases ball', 'defense', 'CF', true, [false, false, false], PLAYS);
runCohort('defense CF, player stands still', 'defense', 'CF', false, [false, false, false], PLAYS);
runCohort('defense SS, player chases ball', 'defense', 'SS', true, [false, false, false], PLAYS);
runCohort('defense 1B, player stands still', 'defense', '1B', false, [true, false, false], PLAYS);
