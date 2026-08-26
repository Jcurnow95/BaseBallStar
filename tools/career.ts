/**
 * Full-career simulation harness.
 *
 * Plays entire careers through the same code path the screens use — GameSim
 * for the game, pitch-by-pitch resolveSwing for the player's plate
 * appearances, and a headless PlaySim (with an autopilot standing in for the
 * thumb) for every ball the player puts in play or has to field. Off days are
 * trained on, gear is bought, attribute points are spent, seasons roll over
 * and promotions are checked exactly the way the screens do it.
 *
 * The human is modelled the same way tools/balance.ts models them: the tap is
 * a point scattered around the ideal contact spot, tighter for a good player.
 *
 * Run: npx tsx tools/career.ts
 * Optional: CAREER_OUT=path/to/data.json to dump per-season rows as JSON.
 */
import { writeFileSync } from 'node:fs';
import { Rng, clamp } from '../src/core/rng';
import { throwPitch } from '../src/core/pitching';
import type { Count } from '../src/core/pitching';
import { IDEAL_UNDER, resolveSwing } from '../src/core/swing';
import { foulChanceFor } from '../src/core/outcome';
import { launchBall, predictLanding } from '../src/core/ballFlight';
import { isFair, toPositionId } from '../src/core/fieldGeometry';
import { airFor } from '../src/core/weather';
import {
  LEVELS,
  advanceDay,
  createLeague,
  isGameDay,
  isRegularSeasonOver,
  isSeasonOver,
  nextGame,
  parkForGame,
  playerTeam,
  rolloverSeason,
  simulateOtherTeams,
  standings,
  teamById,
  weatherForGame,
} from '../src/core/league';
import { recordPlayoffGame, startPlayoffs } from '../src/core/playoffs';
import { GameSim } from '../src/core/gameSim';
import { PlaySim } from '../src/core/playSim';
import type { PlayOutcome } from '../src/core/playSim';
import {
  ARCHETYPES,
  addStats,
  battingAverage,
  createPlayer,
  emptyBattingStats,
  onBasePct,
  overallRating,
  slugging,
} from '../src/core/player';
import {
  TRAINING_OPTIONS,
  applyTraining,
  canUpgrade,
  checkPromotion,
  gameXp,
  grantXp,
  hasPerfectZone,
  recoverOvernight,
  trainingBonusXp,
  upgradeAttribute,
  upgradeCost,
} from '../src/core/progression';
import {
  effectiveAttributes,
  gameEarnings,
  gearForSlot,
  GEAR_SLOTS,
  playerWithGear,
  wearGear,
} from '../src/core/gear';
import type { AtBatOutcome, AttributeKey, BattedBall, PlayerProfile } from '../src/core/types';

/* ----------------------------------------------------------- human model */

interface Skill {
  name: string;
  /** Tap scatter in ball radii. Lower = better hands. */
  sigma: number;
  /** How reliably they read the gold ring and lay off balls. */
  discipline: number;
  /** How well they score the training minigames, 0-1. */
  drill: number;
}

const SKILLS: Skill[] = [
  { name: 'expert', sigma: 0.36, discipline: 0.85, drill: 0.8 },
  { name: 'decent', sigma: 0.52, discipline: 0.62, drill: 0.55 },
  { name: 'button-masher', sigma: 0.95, discipline: 0.12, drill: 0.25 },
];

/* --------------------------------------------------------------- telemetry */

interface FeelCounters {
  pitches: number;
  swings: number;
  whiffs: number;
  fouls: number;
  ballsInPlay: number;
  calledStrikes: number;
  plateAppearances: number;
  fieldingChances: number;
  stretchCatches: number;
  stretchHeld: number;
  playFrames: number[];
  stuckPlays: number;
}

const emptyFeel = (): FeelCounters => ({
  pitches: 0,
  swings: 0,
  whiffs: 0,
  fouls: 0,
  ballsInPlay: 0,
  calledStrikes: 0,
  plateAppearances: 0,
  fieldingChances: 0,
  stretchCatches: 0,
  stretchHeld: 0,
  playFrames: [],
  stuckPlays: 0,
});

interface SeasonRow {
  cohort: string;
  careerSeed: number;
  seasonYear: number;
  levelId: number;
  level: string;
  games: number;
  wins: number;
  losses: number;
  finish: number;
  playoffResult: string;
  // Player line
  pa: number;
  ab: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  rbi: number;
  avg: string;
  obp: string;
  slg: string;
  // Development
  overallStart: number;
  overallEnd: number;
  levelsGained: number;
  xpFromGames: number;
  xpFromTraining: number;
  trainingDays: number;
  trainingSessions: number;
  // Body
  staminaMin: number;
  staminaAvg: number;
  // Money
  moneyStart: number;
  earned: number;
  spentOnGear: number;
  moneyEnd: number;
  // Fielding
  chances: number;
  putouts: number;
  errors: number;
  // Runs
  runsFor: number;
  runsAgainst: number;
  // Promotion
  scoutGrade: number;
  promoted: boolean;
}

const rows: SeasonRow[] = [];

/* ------------------------------------------------------------ the at-bat */

/**
 * One plate appearance, pitch by pitch, the way AtBatView runs it. Returns a
 * terminal outcome (K or BB) to submit directly, or the batted ball to hand
 * to the field.
 */
function playPlateAppearance(
  sim: GameSim,
  player: PlayerProfile,
  skill: Skill,
  air: ReturnType<typeof airFor>,
  rng: Rng,
  feel: FeelCounters,
): { terminal?: AtBatOutcome; battedBall?: BattedBall } {
  const geared = playerWithGear(player);
  const count: Count = { balls: 0, strikes: 0 };
  feel.plateAppearances++;

  for (let pitchNo = 0; pitchNo < 24; pitchNo++) {
    const pitch = throwPitch(sim.pitcher, count, rng);
    feel.pitches++;

    // Swing decision. The timing ring locks gold on strikes as they arrive,
    // so even an average player mostly knows ball from strike — discipline is
    // how reliably they act on it.
    const zoneSwing = 0.62 + (1 - skill.discipline) * 0.2;
    const chase = clamp(0.4 - skill.discipline * 0.3, 0.03, 0.5);
    const shouldSwing =
      count.strikes === 2 && pitch.isStrike
        ? true
        : rng.chance(pitch.isStrike ? zoneSwing : chase);

    if (!shouldSwing) {
      if (pitch.isStrike) {
        count.strikes++;
        feel.calledStrikes++;
        if (count.strikes >= 3) {
          return {
            terminal: {
              result: 'strikeout',
              description: 'Caught looking. Strike three.',
              terminal: true,
              basesAdvanced: 0,
            },
          };
        }
      } else {
        count.balls++;
        if (count.balls >= 4) {
          return {
            terminal: {
              result: 'walk',
              description: 'Ball four. Take your base.',
              terminal: true,
              basesAdvanced: 1,
            },
          };
        }
      }
      continue;
    }

    feel.swings++;

    // Aim at the ideal contact point with human scatter. Shorter flights and
    // bigger break scatter the tap more; Vision buys some back, and the
    // perfect-zone aid (contact+vision >= 120) marks the spot to aim at.
    const velocityPenalty = 820 / pitch.def.duration;
    const movement = 1 + (Math.abs(pitch.def.breakX) + Math.abs(pitch.def.breakY)) * 0.22;
    const visionHelp = 1 - (geared.attributes.vision / 100) * 0.14;
    const aidHelp = hasPerfectZone(geared.attributes) ? 0.9 : 1;
    const sigma = skill.sigma * velocityPenalty * movement * visionHelp * aidHelp;

    const offsetX = rng.gaussian() * sigma;
    const offsetY = IDEAL_UNDER + rng.gaussian() * sigma;
    const timing = 0.98 + rng.gaussian() * sigma * 0.12;

    const swing = resolveSwing(
      { offsetX, offsetY, timing },
      { attributes: geared.attributes, stamina: player.stamina },
      rng,
    );

    if (swing.whiff || !swing.battedBall) {
      feel.whiffs++;
      count.strikes++;
      if (count.strikes >= 3) {
        return {
          terminal: {
            result: 'strikeout',
            description: 'Strike three swinging.',
            terminal: true,
            basesAdvanced: 0,
          },
        };
      }
      continue;
    }

    // Foul checks, exactly as AtBatView applies them before a ball goes to
    // the field: sliced past the line, or chipped straight back.
    const bb = swing.battedBall;
    const landing = predictLanding(
      launchBall(bb.exitVelocity, bb.launchAngle, bb.spray, 1, bb.sideSpin ?? 0, air),
    );
    if (!isFair(landing.point) || rng.chance(foulChanceFor(bb.quality))) {
      feel.fouls++;
      if (count.strikes < 2) count.strikes++;
      continue;
    }

    feel.ballsInPlay++;
    return { battedBall: bb };
  }

  // Marathon PA; call it a strikeout so the game moves on.
  return {
    terminal: { result: 'strikeout', description: 'Strike three.', terminal: true, basesAdvanced: 0 },
  };
}

/* ----------------------------------------------------------- the live play */

const DT = 1 / 60;
const MAX_FRAMES = 60 * 40;

/**
 * Resolve a ball in play on the field with an autopilot thumb: on defense,
 * chase the ball and throw to first; on offense, take the extra base when the
 * throw isn't beating you and scramble back when it is.
 */
function playLivePlay(
  sim: GameSim,
  player: PlayerProfile,
  battedBall: BattedBall,
  side: 'offense' | 'defense',
  park: ReturnType<typeof parkForGame>,
  weather: ReturnType<typeof weatherForGame>,
  level: (typeof LEVELS)[number],
  skill: Skill,
  rng: Rng,
  feel: FeelCounters,
): PlayOutcome {
  const attrs = effectiveAttributes(player);
  const play = new PlaySim({
    battedBall,
    bats: player.bats,
    attributes: attrs,
    userPosition: toPositionId(player.position),
    userSide: side,
    runnersOn: [...sim.bases],
    outs: sim.outs,
    opponentRating: level.defenseRating,
    park,
    weather,
    rng,
  });

  let frames = 0;
  while (play.phase !== 'dead' && frames < MAX_FRAMES) {
    if (play.phase === 'catch' && play.pendingCatch) {
      feel.stretchCatches++;
      // A competent thumb holds most of them; the reach and the player's
      // glove both matter.
      const odds = clamp(
        0.62 + attrs.fielding / 250 + (skill.discipline - 0.5) * 0.2 - play.pendingCatch.difficulty * 0.35,
        0.15,
        0.95,
      );
      const made = rng.chance(odds);
      if (made) feel.stretchHeld++;
      play.resolveCatchAttempt(made);
      continue;
    }

    if (side === 'defense') {
      const fielder = play.userFielder;
      if (fielder) {
        const goal = play.ball.bounced ? { x: play.ball.x, y: play.ball.y } : play.landingPoint;
        const dx = goal.x - fielder.x;
        const dy = goal.y - fielder.y;
        const range = Math.hypot(dx, dy) || 1;
        play.moveUserFielder(dx / range, dy / range, DT);
      }
      if (play.userHasBall) play.throwTo(1);
    } else {
      if (play.throwBeatingUserRunner && !play.userRunnerRetreating) {
        if (play.userBackTarget !== null) play.retreatRunner();
      } else if (
        play.ball.bounced &&
        play.userGoTarget !== null &&
        !play.throwBeatingUserRunner &&
        frames % 20 === 0 &&
        rng.chance(0.5 + skill.discipline * 0.3)
      ) {
        play.advanceRunner();
      }
    }

    play.update(DT);
    frames++;
  }

  feel.playFrames.push(frames);
  if (play.phase !== 'dead' || !play.outcome) {
    feel.stuckPlays++;
    // Should never happen; resolve as a routine out so the game continues.
    return {
      kind: 'out',
      outs: 1,
      runs: 0,
      basesAfter: [...sim.bases],
      description: 'Routine out.',
      userPutout: false,
      userError: false,
      reachedOnError: false,
    } as PlayOutcome;
  }
  return play.outcome;
}

/* ------------------------------------------------------------- strategies */

/** Spend attribute points the way a player chasing the aids and power would. */
function spendPoints(player: PlayerProfile): void {
  const weights: Record<AttributeKey, number> = {
    contact: 0.3,
    power: 0.24,
    vision: 0.2,
    speed: 0.12,
    fielding: 0.1,
    arm: 0.04,
  };
  for (let guard = 0; guard < 200; guard++) {
    // Until the perfect-hit zone unlocks, everything goes into contact+vision.
    const zoneLocked = !hasPerfectZone(player.attributes);
    let best: AttributeKey | null = null;
    let bestScore = -1;
    for (const key of Object.keys(weights) as AttributeKey[]) {
      if (!canUpgrade(player, key)) continue;
      if (zoneLocked && key !== 'contact' && key !== 'vision') continue;
      const score = weights[key] / upgradeCost(player.attributes[key]);
      if (score > bestScore) {
        bestScore = score;
        best = key;
      }
    }
    if (!best) {
      if (!zoneLocked) return;
      // Zone chase exhausted (both at 99?) — fall through to open spending.
      let fallback: AttributeKey | null = null;
      for (const key of Object.keys(weights) as AttributeKey[]) {
        if (canUpgrade(player, key)) fallback = key;
      }
      if (!fallback) return;
      upgradeAttribute(player, fallback);
      continue;
    }
    upgradeAttribute(player, best);
  }
}

/** Keep the bag stocked: fill empty slots with the best gear we can afford. */
function shop(player: PlayerProfile): number {
  let spent = 0;
  const reserve = 150;
  for (const slot of GEAR_SLOTS) {
    if (player.gear[slot]) continue;
    const options = gearForSlot(slot).sort((a, b) => b.price - a.price);
    for (const def of options) {
      if (player.money - def.price >= reserve) {
        player.money -= def.price;
        player.gear[slot] = { id: def.id, gamesLeft: def.games };
        spent += def.price;
        break;
      }
    }
  }
  return spent;
}

/** An off day at the facility, the way the training screen spends one. */
/**
 * How the player spends an off day.
 *
 * This matters more than it looks. A 'balanced' player who rests whenever
 * conditioning dips never sees the fatigue term in `sweetSpotRadius` bite at
 * all — which made an earlier run of this harness report that stamina was a
 * dead system, when what it had actually measured was its own resting policy.
 * 'grind' is the player who takes the XP every time, which is what the drills
 * are visibly there to encourage.
 */
export type TrainPolicy = 'balanced' | 'grind';

function trainDay(
  player: PlayerProfile,
  skill: Skill,
  policy: TrainPolicy = 'balanced',
): { xp: number; sessions: number } {
  const byId = Object.fromEntries(TRAINING_OPTIONS.map((o) => [o.id, o]));
  let xp = 0;
  let sessions = 0;
  for (let guard = 0; guard < 8; guard++) {
    let choice = null;
    if (policy === 'grind') {
      // Always take the experience; never spend a day on the body.
      if (player.energy >= byId.bp.energyCost) choice = byId.bp;
      else if (player.energy >= byId.fielding.energyCost) choice = byId.fielding;
      else if (player.energy >= byId.film.energyCost) choice = byId.film;
    } else if (player.stamina <= 40 && player.energy >= byId.rest.energyCost) choice = byId.rest;
    else if (player.stamina <= 65 && player.energy >= byId.conditioning.energyCost)
      choice = byId.conditioning;
    else if (player.energy >= byId.bp.energyCost && player.stamina > 55) choice = byId.bp;
    else if (player.energy >= byId.film.energyCost) choice = byId.film;
    if (!choice) break;
    const bonus = choice.minigame ? trainingBonusXp(choice, skill.drill) : 0;
    const before = player.xp + 0; // applyTraining grants inside
    const report = applyTraining(player, choice, bonus);
    if (!report) break;
    xp += choice.xp + bonus;
    void before;
    sessions++;
  }
  return { xp, sessions };
}

/* ------------------------------------------------------------- the career */

interface CareerResult {
  cohort: string;
  seed: number;
  seasons: number;
  reachedLevel: number;
  seasonsToAA: number | null;
  seasonsToAAA: number | null;
  seasonsToMLB: number | null;
  titles: number;
}

function playCareer(
  skill: Skill,
  seed: number,
  maxSeasons: number,
  feel: FeelCounters,
  archetypeIndex = 3,
  policy: TrainPolicy = 'balanced',
): CareerResult {
  const rng = new Rng(seed);
  const player = createPlayer('Sim', 'CF', 'R', ARCHETYPES[archetypeIndex]);
  spendPoints(player); // the 3 starting points
  let league = createLeague(0, rng);
  let seasonYear = 1;
  let titles = 0;
  let seasonsToAA: number | null = null;
  let seasonsToAAA: number | null = null;
  let seasonsToMLB: number | null = null;
  let mlbSeasons = 0;

  for (let s = 0; s < maxSeasons; s++) {
    const level = LEVELS[league.levelId];
    const overallStart = overallRating(player.attributes);
    const moneyStart = player.money;
    const levelStart = player.level;
    let earned = 0;
    let spentOnGear = 0;
    let xpFromGames = 0;
    let xpFromTraining = 0;
    let trainingDays = 0;
    let trainingSessions = 0;
    let games = 0;
    let runsFor = 0;
    let runsAgainst = 0;
    let staminaMin = player.stamina;
    let staminaSum = 0;
    let staminaSamples = 0;
    const seasonStatsStart = { ...player.season };
    void seasonStatsStart;

    let guard = 0;
    while (!isSeasonOver(league) && guard++ < 400) {
      const scheduled = nextGame(league);
      if (!scheduled) {
        if (!isGameDay(league)) {
          const t = trainDay(player, skill, policy);
          xpFromTraining += t.xp;
          trainingSessions += t.sessions;
          trainingDays++;
        }
        advanceDay(league, rng);
        recoverOvernight(player);
        spendPoints(player);
        continue;
      }

      // Pre-game: shopping, then play.
      spentOnGear += shop(player);
      const opponent = teamById(league, scheduled.opponentId);
      const myTeam = playerTeam(league);
      const park = parkForGame(league, scheduled);
      const weather = weatherForGame(scheduled, rng);
      const air = airFor(weather);
      const sim = new GameSim(
        player,
        level,
        myTeam,
        opponent,
        scheduled.home,
        rng,
        weather,
        !!scheduled.playoff,
      );

      let eventGuard = 0;
      while (eventGuard++ < 800) {
        const event = sim.step();
        if (event.kind === 'gameOver') break;
        if (event.kind === 'atBat') {
          const pa = playPlateAppearance(sim, player, skill, air, rng, feel);
          if (pa.terminal) {
            sim.submitAtBat(pa.terminal);
          } else if (pa.battedBall) {
            const outcome = playLivePlay(
              sim, player, pa.battedBall, 'offense', park, weather, level, skill, rng, feel,
            );
            sim.submitLivePlay(outcome, 'us');
          }
        } else if (event.kind === 'fielding') {
          feel.fieldingChances++;
          const outcome = playLivePlay(
            sim, player, event.battedBall, 'defense', park, weather, level, skill, rng, feel,
          );
          sim.submitLivePlay(outcome, 'them');
        }
        // 'log' and 'inning' just advance.
      }

      // ---- endGame(), the way screens/game.ts does it.
      scheduled.played = true;
      scheduled.playerTeamScore = sim.score.us;
      scheduled.opponentScore = sim.score.them;
      if (!scheduled.playoff) {
        if (sim.score.us > sim.score.them) {
          myTeam.wins++;
          opponent.losses++;
        } else if (sim.score.us < sim.score.them) {
          myTeam.losses++;
          opponent.wins++;
        }
        simulateOtherTeams(league, rng, [opponent.id]);
      }
      addStats(player.season, sim.gameStats);
      addStats(player.career, sim.gameStats);
      player.fielding.chances += sim.putouts + sim.errors;
      player.fielding.putouts += sim.putouts;
      player.fielding.errors += sim.errors;

      const xp = gameXp(sim.gameStats, sim.putouts);
      grantXp(player, xp);
      xpFromGames += xp;

      const pay = gameEarnings(
        league.levelId,
        player.contract,
        sim.gameStats,
        sim.putouts,
        sim.score.us > sim.score.them,
      );
      player.money += pay.total;
      earned += pay.total;
      wearGear(player);

      player.stamina = clamp(player.stamina - (6 + Math.round(rng.next() * 4)), 0, 100);
      advanceDay(league, rng);
      recoverOvernight(player);

      if (scheduled.playoff) {
        recordPlayoffGame(league, scheduled, sim.score.us > sim.score.them, rng);
      } else if (isRegularSeasonOver(league)) {
        startPlayoffs(league, rng);
      }

      games++;
      runsFor += sim.score.us;
      runsAgainst += sim.score.them;
      staminaMin = Math.min(staminaMin, player.stamina);
      staminaSum += player.stamina;
      staminaSamples++;
      spendPoints(player);
    }

    // ---- season end, the way screens/seasonEnd.ts does it.
    const check = checkPromotion(player, league.levelId);
    const myTeam = playerTeam(league);
    const finish = standings(league).findIndex((t) => t.id === league.playerTeamId) + 1;
    const champion = league.playoffs?.playerResult === 'champion';
    if (champion) titles++;

    rows.push({
      cohort: skill.name,
      careerSeed: seed,
      seasonYear,
      levelId: league.levelId,
      level: level.short,
      games,
      wins: myTeam.wins,
      losses: myTeam.losses,
      finish,
      playoffResult: league.playoffs?.playerResult ?? 'none',
      pa: player.season.pa,
      ab: player.season.ab,
      hits: player.season.hits,
      doubles: player.season.doubles,
      triples: player.season.triples,
      homeRuns: player.season.homeRuns,
      walks: player.season.walks,
      strikeouts: player.season.strikeouts,
      rbi: player.season.rbi,
      avg: battingAverage(player.season),
      obp: onBasePct(player.season),
      slg: slugging(player.season),
      overallStart,
      overallEnd: overallRating(player.attributes),
      levelsGained: player.level - levelStart,
      xpFromGames,
      xpFromTraining,
      trainingDays,
      trainingSessions,
      staminaMin,
      staminaAvg: staminaSamples ? Math.round(staminaSum / staminaSamples) : player.stamina,
      moneyStart,
      earned,
      spentOnGear,
      moneyEnd: player.money,
      chances: player.fielding.chances,
      putouts: player.fielding.putouts,
      errors: player.fielding.errors,
      runsFor,
      runsAgainst,
      scoutGrade: check.score,
      promoted: check.promoted,
    });

    // Roll over.
    seasonYear++;
    if (check.promoted) {
      league = createLeague(check.nextLevelId, rng);
      if (league.levelId === 1 && seasonsToAA === null) seasonsToAA = seasonYear - 1;
      if (league.levelId === 2 && seasonsToAAA === null) seasonsToAAA = seasonYear - 1;
      if (league.levelId === 3 && seasonsToMLB === null) seasonsToMLB = seasonYear - 1;
    } else {
      rolloverSeason(league, rng);
    }
    player.season = emptyBattingStats();
    player.fielding = { chances: 0, putouts: 0, errors: 0 };
    player.stamina = 100;
    player.energy = 100;
    player.attributePoints += 2 + (check.promoted ? 2 : 0) + (champion ? 1 : 0);
    if (champion) player.money += 400 * (league.levelId + 1);
    spendPoints(player);

    if (league.levelId === 3) {
      mlbSeasons++;
      if (mlbSeasons >= 3) break;
    }
  }

  return {
    cohort: skill.name,
    seed,
    seasons: seasonYear - 1,
    reachedLevel: league.levelId,
    seasonsToAA,
    seasonsToAAA,
    seasonsToMLB,
    titles,
  };
}

/* ------------------------------------------------------------------ main */

const CAREERS_PER_COHORT = 8;
const MAX_SEASONS = 10;

console.log('\n=== Career simulation ===');
console.log(
  `${CAREERS_PER_COHORT} careers per cohort, up to ${MAX_SEASONS} seasons each, five-tool CF.\n`,
);

const careerResults: CareerResult[] = [];
const feelByCohort: Record<string, FeelCounters> = {};

for (const skill of SKILLS) {
  const feel = emptyFeel();
  feelByCohort[skill.name] = feel;
  for (let i = 0; i < CAREERS_PER_COHORT; i++) {
    careerResults.push(playCareer(skill, 1000 + i * 17, MAX_SEASONS, feel));
  }
}

/* Summaries ---------------------------------------------------------------- */

const fmt = (n: number, d = 1): string => n.toFixed(d);
const pct = (a: number, b: number): string => (b > 0 ? ((a / b) * 100).toFixed(1) : '0.0');

console.log('--- Career arcs ---');
for (const skill of SKILLS) {
  const mine = careerResults.filter((c) => c.cohort === skill.name);
  const reached = (lvl: number): number => mine.filter((c) => c.reachedLevel >= lvl).length;
  const avgTo = (key: 'seasonsToAA' | 'seasonsToAAA' | 'seasonsToMLB'): string => {
    const vals = mine.map((c) => c[key]).filter((v): v is number => v !== null);
    return vals.length ? fmt(vals.reduce((a, b) => a + b, 0) / vals.length) : '—';
  };
  console.log(
    `${skill.name.padEnd(14)} reach AA ${reached(1)}/${mine.length}` +
      ` AAA ${reached(2)}/${mine.length}  MLB ${reached(3)}/${mine.length}` +
      `  avg seasons to AA ${avgTo('seasonsToAA')}  AAA ${avgTo('seasonsToAAA')}  MLB ${avgTo('seasonsToMLB')}` +
      `  titles ${mine.reduce((a, c) => a + c.titles, 0)}`,
  );
}

console.log('\n--- Per level, per cohort (season averages) ---');
console.log(
  'cohort/level'.padEnd(22) +
    'seasons  AVG/OBP/SLG        K%    BB%   HR   2B  grade  W-L      finish  R/G   RA/G  playoffs   lvl-ups  $/season  stamMin',
);
for (const skill of SKILLS) {
  for (const level of LEVELS) {
    const mine = rows.filter((r) => r.cohort === skill.name && r.levelId === level.id);
    if (mine.length === 0) continue;
    const sum = (f: (r: SeasonRow) => number): number => mine.reduce((a, r) => a + f(r), 0);
    const totals = emptyBattingStats();
    for (const r of mine) {
      totals.pa += r.pa;
      totals.ab += r.ab;
      totals.hits += r.hits;
      totals.doubles += r.doubles;
      totals.triples += r.triples;
      totals.homeRuns += r.homeRuns;
      totals.walks += r.walks;
      totals.strikeouts += r.strikeouts;
      totals.singles += r.hits - r.doubles - r.triples - r.homeRuns;
    }
    const made = mine.filter((r) => r.playoffResult !== 'missed' && r.playoffResult !== 'none').length;
    const champs = mine.filter((r) => r.playoffResult === 'champion').length;
    const promoted = mine.filter((r) => r.promoted).length;
    console.log(
      `${(skill.name + ' ' + level.short).padEnd(22)}` +
        `${String(mine.length).padEnd(9)}` +
        `${battingAverage(totals)}/${onBasePct(totals)}/${slugging(totals)}` +
        `  ${pct(totals.strikeouts, totals.pa).padStart(5)}` +
        ` ${pct(totals.walks, totals.pa).padStart(5)}` +
        `  ${fmt(sum((r) => r.homeRuns) / mine.length).padStart(4)}` +
        ` ${fmt(sum((r) => r.doubles) / mine.length).padStart(4)}` +
        `  ${fmt(sum((r) => r.scoutGrade) / mine.length, 0).padStart(4)}` +
        `  ${fmt(sum((r) => r.wins) / mine.length, 0)}-${fmt(sum((r) => r.losses) / mine.length, 0)}`.padEnd(9) +
        `  ${fmt(sum((r) => r.finish) / mine.length).padStart(5)}` +
        `  ${fmt(sum((r) => r.runsFor) / sum((r) => r.games)).padStart(4)}` +
        ` ${fmt(sum((r) => r.runsAgainst) / sum((r) => r.games)).padStart(5)}` +
        `  ${made}/${mine.length} (${champs} rings)` +
        `  ${fmt(sum((r) => r.levelsGained) / mine.length).padStart(5)}` +
        `  $${fmt(sum((r) => r.earned) / mine.length, 0).padStart(6)}` +
        `  ${fmt(sum((r) => r.staminaMin) / mine.length, 0).padStart(5)}` +
        `  ${promoted}/${mine.length} promoted`,
    );
  }
}

console.log('\n--- Feel (all seasons pooled) ---');
for (const skill of SKILLS) {
  const f = feelByCohort[skill.name];
  const avgFrames = f.playFrames.length
    ? f.playFrames.reduce((a, b) => a + b, 0) / f.playFrames.length / 60
    : 0;
  console.log(
    `${skill.name.padEnd(14)} pitches/PA ${fmt(f.pitches / Math.max(1, f.plateAppearances))}` +
      `  whiff/swing ${pct(f.whiffs, f.swings)}%` +
      `  fouls/swing ${pct(f.fouls, f.swings)}%` +
      `  BIP/PA ${pct(f.ballsInPlay, f.plateAppearances)}%` +
      `  called-K share ${pct(f.calledStrikes, f.pitches)}%` +
      `  field chances ${f.fieldingChances}` +
      `  stretch held ${pct(f.stretchHeld, f.stretchCatches)}%` +
      `  play len ${fmt(avgFrames)}s` +
      `${f.stuckPlays ? `  STUCK ${f.stuckPlays}` : ''}`,
  );
}

const out = process.env.CAREER_OUT;
if (out) {
  writeFileSync(out, JSON.stringify({ rows, careers: careerResults }, null, 1));
  console.log(`\nWrote ${rows.length} season rows to ${out}`);
}
console.log('');
