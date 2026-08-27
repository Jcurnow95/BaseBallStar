/**
 * Trophy-case harness.
 *
 * Two jobs, the same two `tools/awards.ts` has.
 *
 * First, correctness. The moment achievements are the ones that can silently
 * stop working: a grand slam is only a grand slam because of what was on the
 * bases *before* the swing, and a walk-off is only a walk-off because of what
 * the scoreboard said before it and after it. Both are read from state the sim
 * mutates on the way through, so they're driven here against a real `GameSim`
 * with the situation forced, including the near-misses that must NOT fire: the
 * same home run in the third, and the same home run on the road.
 *
 * Second, reach. An achievement nobody can earn is dead weight on the list, and
 * one everybody earns in week one is noise. The season and career tiers are
 * swept against real, played-out seasons at every level and reported, so the
 * thresholds can be argued with numbers instead of guesses.
 *
 * Run: npx tsx tools/achievements.ts
 */
import {
  ACHIEVEMENTS,
  achievementProgress,
  checkAchievements,
  emptyGameFeats,
} from '../src/core/achievements';
import type { AchievementContext, UnlockedAchievement } from '../src/core/achievements';
import { GameSim } from '../src/core/gameSim';
import { LEVELS, createLeague, playerTeam, teamById } from '../src/core/league';
import type { PlayOutcome } from '../src/core/playSim';
import { ARCHETYPES, addStats, battingAverage, createPlayer, emptyBattingStats } from '../src/core/player';
import { Rng } from '../src/core/rng';
import type { AtBatOutcome, BattingStats, PlayerProfile } from '../src/core/types';
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

/* ------------------------------------------------------- driving a real game */

interface Situation {
  home: boolean;
  inning: number;
  half: 'top' | 'bottom';
  bases: [boolean, boolean, boolean];
  us: number;
  them: number;
}

/**
 * A `GameSim` parked in an exact situation. The fields being set here are the
 * same ones the sim advances itself; forcing them is how a harness gets to the
 * bottom of the ninth without playing eight innings first.
 */
function simAt(situation: Situation, rng: Rng): GameSim {
  const league = createLeague(1, rng);
  const me = playerTeam(league);
  const them = league.teams.find((t) => t.id !== me.id) ?? me;
  const player = createPlayer('Tester', '2B', 'R', ARCHETYPES[0]);
  const sim = new GameSim(player, LEVELS[1], me, teamById(league, them.id), situation.home, rng);

  sim.inning = situation.inning;
  sim.half = situation.half;
  sim.bases = [...situation.bases];
  sim.score.us = situation.us;
  sim.score.them = situation.them;
  return sim;
}

const swing = (result: AtBatOutcome['result'], basesAdvanced: number): AtBatOutcome => ({
  result,
  description: result,
  terminal: true,
  basesAdvanced,
});

/** A live play as `playSim` would hand one back. */
const play = (over: Partial<PlayOutcome>): PlayOutcome => ({
  kind: 'single',
  outs: 0,
  runs: 0,
  batterBase: 1,
  basesAfter: [true, false, false],
  description: 'test play',
  userPutout: false,
  userError: false,
  reachedOnError: false,
  insideThePark: false,
  ...over,
});

const BASES_LOADED: [boolean, boolean, boolean] = [true, true, true];
const EMPTY: [boolean, boolean, boolean] = [false, false, false];

console.log('=== Moments the sim has to see ===\n');
{
  const rng = new Rng(7);

  // The headline pair, in the situation each one is named after.
  const slam = simAt(
    { home: true, inning: 4, half: 'bottom', bases: BASES_LOADED, us: 0, them: 0 },
    rng,
  );
  const slamRuns = slam.submitAtBat(swing('homeRun', 4)).runs;
  check('grand slam fires with the bases loaded', slam.feats.grandSlam);
  check('a grand slam is four runs', slamRuns === 4, `scored ${slamRuns}`);
  check('a slam in the fourth is not a walk-off', !slam.feats.walkOff);

  const walkOff = simAt(
    { home: true, inning: 9, half: 'bottom', bases: EMPTY, us: 3, them: 3 },
    rng,
  );
  walkOff.submitAtBat(swing('homeRun', 4));
  check('walk-off fires in the bottom of the ninth', walkOff.feats.walkOff);
  check('walk-off home run is flagged separately', walkOff.feats.walkOffHomeRun);

  // A single that brings the winning run home is a walk-off, but not a homer.
  const walkOffHit = simAt(
    { home: true, inning: 10, half: 'bottom', bases: [false, false, true], us: 2, them: 2 },
    rng,
  );
  walkOffHit.submitAtBat(swing('single', 1));
  check('a walk-off single counts', walkOffHit.feats.walkOff);
  check('...but not as a walk-off homer', !walkOffHit.feats.walkOffHomeRun);

  // A grand slam that ends it is both at once.
  const ultimate = simAt(
    { home: true, inning: 9, half: 'bottom', bases: BASES_LOADED, us: 1, them: 4 },
    rng,
  );
  ultimate.submitAtBat(swing('homeRun', 4));
  check('an ultimate grand slam is both', ultimate.feats.grandSlam && ultimate.feats.walkOff);

  /* --------------------------------------------------------- the near misses */

  const early = simAt({ home: true, inning: 3, half: 'bottom', bases: EMPTY, us: 3, them: 3 }, rng);
  early.submitAtBat(swing('homeRun', 4));
  check('the same homer in the third is not a walk-off', !early.feats.walkOff);

  const road = simAt({ home: false, inning: 9, half: 'top', bases: EMPTY, us: 3, them: 3 }, rng);
  road.submitAtBat(swing('homeRun', 4));
  check('you cannot walk one off on the road', !road.feats.walkOff);

  // Ahead already: the run is nice, but nothing walked off.
  const padding = simAt(
    { home: true, inning: 9, half: 'bottom', bases: EMPTY, us: 6, them: 2 },
    rng,
  );
  padding.submitAtBat(swing('homeRun', 4));
  check('a homer while already ahead is not a walk-off', !padding.feats.walkOff);

  // Ties it but doesn't win it — a clutch hit, and nothing more.
  const tying = simAt(
    { home: true, inning: 9, half: 'bottom', bases: [false, true, false], us: 2, them: 3 },
    rng,
  );
  tying.submitAtBat(swing('double', 2));
  check('tying it in the ninth is not a walk-off', !tying.feats.walkOff);
  check('...but it is a clutch hit', tying.feats.clutchHit);

  const slamNotHome = simAt(
    { home: true, inning: 6, half: 'bottom', bases: [true, true, false], us: 0, them: 0 },
    rng,
  );
  slamNotHome.submitAtBat(swing('homeRun', 4));
  check('two on is a three-run homer, not a slam', !slamNotHome.feats.grandSlam);

  const earlyRally = simAt(
    { home: true, inning: 2, half: 'bottom', bases: [false, false, true], us: 0, them: 1 },
    rng,
  );
  earlyRally.submitAtBat(swing('single', 1));
  check('the second inning is not clutch', !earlyRally.feats.clutchHit);

  /* ------------------------------------------------------ balls run out live */

  const itp = simAt({ home: true, inning: 5, half: 'bottom', bases: EMPTY, us: 0, them: 0 }, rng);
  itp.submitLivePlay(
    play({ kind: 'homeRun', runs: 1, batterBase: 4, basesAfter: EMPTY, insideThePark: true }),
    'us',
  );
  check('an inside-the-parker is spotted on a live play', itp.feats.insideThePark);

  const overFence = simAt(
    { home: true, inning: 5, half: 'bottom', bases: EMPTY, us: 0, them: 0 },
    rng,
  );
  overFence.submitLivePlay(
    play({ kind: 'homeRun', runs: 1, batterBase: 4, basesAfter: EMPTY, insideThePark: false }),
    'us',
  );
  check('a ball in the seats is not inside the park', !overFence.feats.insideThePark);

  const liveSlam = simAt(
    { home: true, inning: 9, half: 'bottom', bases: BASES_LOADED, us: 0, them: 3 },
    rng,
  );
  liveSlam.submitLivePlay(
    play({ kind: 'homeRun', runs: 4, batterBase: 4, basesAfter: EMPTY }),
    'us',
  );
  check('a live-play slam still fires both', liveSlam.feats.grandSlam && liveSlam.feats.walkOff);
  check('best RBI in a plate appearance is kept', liveSlam.feats.bestRbiPa === 4);

  // The opponent's half must never touch the player's feats.
  const theirs = simAt(
    { home: true, inning: 9, half: 'top', bases: BASES_LOADED, us: 0, them: 0 },
    rng,
  );
  theirs.submitLivePlay(play({ kind: 'homeRun', runs: 4, batterBase: 4, basesAfter: EMPTY }), 'them');
  check('their grand slam is not yours', !theirs.feats.grandSlam);
  check('their runs do not count as your RBI', theirs.feats.bestRbiPa === 0);
}

/* ----------------------------------------------------------- the case itself */

function freshPlayer(): PlayerProfile {
  return createPlayer('Case', 'CF', 'R', ARCHETYPES[0]);
}

function ctx(over: Partial<AchievementContext> = {}): AchievementContext {
  return { player: freshPlayer(), levelId: 0, seasonYear: 1, ...over };
}

console.log('\n=== The case ===\n');
{
  const ids = ACHIEVEMENTS.map((a) => a.id);
  check('every id is unique', new Set(ids).size === ids.length);
  check(
    'every achievement is named and explained',
    ACHIEVEMENTS.every((a) => a.name.trim() && a.blurb.trim() && a.icon.trim()),
  );

  // The one that matters most on day one: a brand-new career owns nothing.
  const empty: UnlockedAchievement[] = [];
  const onCreate = checkAchievements(empty, ctx());
  check(
    'a new career starts with an empty case',
    onCreate.length === 0,
    onCreate.map((a) => a.id).join(', '),
  );

  // ...and a new career in the majors still owns exactly one: being there.
  const debut: UnlockedAchievement[] = [];
  const inTheShow = checkAchievements(debut, ctx({ levelId: 3 }));
  check(
    'starting in the majors earns The Show and nothing else',
    inTheShow.length === 1 && inTheShow[0].id === 'the-show',
    inTheShow.map((a) => a.id).join(', '),
  );

  // Unlocks are once and for all, however many times a screen re-renders.
  const held: UnlockedAchievement[] = [];
  const player = freshPlayer();
  player.career.hits = 1;
  player.season.hits = 1;
  const first = checkAchievements(held, ctx({ player }));
  const again = checkAchievements(held, ctx({ player }));
  check('the first hit unlocks once', first.some((a) => a.id === 'first-hit'));
  check('re-checking awards nothing twice', again.length === 0);
  check('the case holds one record per id', held.length === new Set(held.map((h) => h.id)).size);

  const stamped = held.find((h) => h.id === 'first-hit');
  check('an unlock records the year and level', stamped?.seasonYear === 1 && stamped.levelId === 0);

  /* --------------------------------------------------- box-score achievements */

  const game = (over: Partial<BattingStats>): BattingStats => ({ ...emptyBattingStats(), ...over });

  const cycleCtx = ctx({
    game: {
      stats: game({ pa: 5, ab: 5, hits: 4, singles: 1, doubles: 1, triples: 1, homeRuns: 1, rbi: 4 }),
      feats: emptyGameFeats(),
      putouts: 0,
      errors: 0,
      win: true,
      playoff: false,
    },
  });
  const cycleUnlocks = checkAchievements([], cycleCtx).map((a) => a.id);
  check('the cycle is spotted', cycleUnlocks.includes('cycle'));
  check('a four-hit game comes with it', cycleUnlocks.includes('four-hit-game'));
  check('one homer is not a two-homer game', !cycleUnlocks.includes('multi-homer'));

  // Reaching on an error is an at-bat and not a hit, so the perfect day fails.
  const blemished = ctx({
    game: {
      stats: game({ pa: 4, ab: 4, hits: 3, singles: 3 }),
      feats: emptyGameFeats(),
      putouts: 0,
      errors: 0,
      win: true,
      playoff: false,
    },
  });
  check(
    'three hits in four trips is not a perfect day',
    !checkAchievements([], blemished).some((a) => a.id === 'perfect-day'),
  );

  const walked = ctx({
    game: {
      stats: game({ pa: 4, ab: 3, hits: 3, singles: 3, walks: 1 }),
      feats: emptyGameFeats(),
      putouts: 0,
      errors: 0,
      win: true,
      playoff: false,
    },
  });
  check(
    'three hits and a walk is a perfect day',
    checkAchievements([], walked).some((a) => a.id === 'perfect-day'),
  );

  const clean = ctx({
    game: {
      stats: game({ pa: 3, ab: 3 }),
      feats: emptyGameFeats(),
      putouts: 3,
      errors: 0,
      win: true,
      playoff: false,
    },
  });
  check(
    'three putouts and no errors flashes leather',
    checkAchievements([], clean).some((a) => a.id === 'leather'),
  );

  const muffed = ctx({
    game: {
      stats: game({ pa: 3, ab: 3 }),
      feats: emptyGameFeats(),
      putouts: 3,
      errors: 1,
      win: true,
      playoff: false,
    },
  });
  check(
    'an error takes the leather away',
    !checkAchievements([], muffed).some((a) => a.id === 'leather'),
  );

  const october = ctx({
    game: {
      stats: game({ pa: 4, ab: 4, hits: 1, homeRuns: 1, rbi: 1 }),
      feats: emptyGameFeats(),
      putouts: 0,
      errors: 0,
      win: true,
      playoff: true,
    },
  });
  const octoberIds = checkAchievements([], october).map((a) => a.id);
  check('a playoff homer is October power', octoberIds.includes('october-homer'));

  const regular = ctx({
    game: {
      stats: game({ pa: 4, ab: 4, hits: 1, homeRuns: 1, rbi: 1 }),
      feats: emptyGameFeats(),
      putouts: 0,
      errors: 0,
      win: true,
      playoff: false,
    },
  });
  check(
    'a July homer is not',
    !checkAchievements([], regular).some((a) => a.id === 'october-homer'),
  );

  /* -------------------------------------------------------------- the honors */

  const honored = ctx({
    levelId: 2,
    honors: { champion: true, mvp: true, promoted: true, nextLevelId: 3 },
  });
  const honorIds = checkAchievements([], honored).map((a) => a.id);
  check('a ring is banked', honorIds.includes('ring'));
  check('an MVP is banked', honorIds.includes('mvp'));
  check('the call-up is banked', honorIds.includes('call-up'));
  check('promotion to the majors is The Show', honorIds.includes('the-show'));

  const stuck = ctx({
    levelId: 1,
    honors: { champion: false, mvp: false, promoted: true, nextLevelId: 2 },
  });
  check(
    'a call-up to Triple-A is not The Show',
    !checkAchievements([], stuck).some((a) => a.id === 'the-show'),
  );

  const progress = achievementProgress([{ id: 'ring', seasonYear: 1, levelId: 0 }]);
  check('progress counts against the live list', progress.total === ACHIEVEMENTS.length);
  check('progress counts what is held', progress.earned === 1);
  check(
    'a retired id cannot inflate the count',
    achievementProgress([{ id: 'gone-in-a-later-build', seasonYear: 1, levelId: 0 }]).earned === 0,
  );
}

/* ------------------------------------------------------------------- reach */

/**
 * What a career actually earns, with the seasons *played* rather than modelled.
 *
 * This is the only part of the file that can tell you a threshold is wrong.
 * `SEASON_GAMES` is 24, so a season is about a hundred trips to the plate and
 * roughly twenty-five hits — numbers a thirty-homer target would sail straight
 * past. Every line below comes out of the same swing and batted-ball code the
 * player swings against, at the three standards `tools/humanBat.ts` defines,
 * with the career walking up a level every few years the way a real one does.
 *
 * Read it as: a star should end a long career holding most of the case, and a
 * flailing one should hold almost none of it on the numbers alone.
 */
console.log('\n=== Reach, over a twelve-season career ===\n');
{
  const SEASONS = 12;
  /** Where a career is by season N: three years a level, then the majors. */
  const levelFor = (year: number): number => Math.min(3, Math.floor((year - 1) / 3));

  for (const skill of SKILLS) {
    const rng = new Rng(4242);
    const unlocked: UnlockedAchievement[] = [];
    const career = emptyBattingStats();
    let bestSeason = '';
    let bestHr = -1;

    for (let year = 1; year <= SEASONS; year++) {
      const levelId = levelFor(year);
      const player = playerAt(levelId);
      player.season = playSeason(player, levelId, skill, rng);
      addStats(career, player.season);
      player.career = { ...career };

      if (player.season.homeRuns > bestHr) {
        bestHr = player.season.homeRuns;
        bestSeason =
          `${battingAverage(player.season)} · ${player.season.homeRuns} HR · ` +
          `${player.season.rbi} RBI · ${player.season.hits} H`;
      }

      checkAchievements(unlocked, { player, levelId, seasonYear: year });
    }

    const held = new Set(unlocked.map((u) => u.id));
    const byTier = (['season', 'career'] as const).map((tier) => {
      const rows = ACHIEVEMENTS.filter((a) => a.tier === tier);
      return `${tier} ${rows.filter((a) => held.has(a.id)).length}/${rows.length}`;
    });

    console.log(`  ${skill.name}`);
    console.log(`    best season     ${bestSeason}`);
    console.log(
      `    career          ${career.hits} H · ${career.homeRuns} HR · ${career.rbi} RBI · ${career.walks} BB`,
    );
    console.log(`    earned          ${byTier.join('  ·  ')}`);
    const missed = ACHIEVEMENTS.filter(
      (a) => (a.tier === 'season' || a.tier === 'career') && !held.has(a.id),
    ).map((a) => a.name);
    console.log(`    still out there ${missed.length ? missed.join(', ') : '— nothing'}\n`);

    const seasonTier = ACHIEVEMENTS.filter((a) => a.tier === 'season');
    const careerTier = ACHIEVEMENTS.filter((a) => a.tier === 'career');
    const got = (rows: typeof ACHIEVEMENTS): number => rows.filter((a) => held.has(a.id)).length;

    if (skill.name === 'star') {
      // A dozen years of star play has to clear most of both tiers, or the
      // numbers on the list are aspirations rather than achievements.
      check(
        'a star career clears most of the season tier',
        got(seasonTier) >= seasonTier.length / 2,
        `${got(seasonTier)}/${seasonTier.length}`,
      );
      check(
        'a star career clears most of the career tier',
        got(careerTier) >= careerTier.length / 2,
        `${got(careerTier)}/${careerTier.length}`,
      );
      // ...but not all of it. Something has to be left to chase.
      check(
        'a star career does not empty the case',
        got(seasonTier) + got(careerTier) < seasonTier.length + careerTier.length,
      );
    }

    if (skill.name === 'flailing') {
      check(
        'a flailing career earns almost nothing on the numbers',
        got(seasonTier) + got(careerTier) <= 2,
        `${got(seasonTier) + got(careerTier)} earned`,
      );
    }
  }
}

console.log(failures === 0 ? '\nAll trophy-case checks passed.\n' : `\n${failures} FAILURES\n`);
process.exit(failures === 0 ? 0 : 1);

