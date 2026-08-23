import type { App } from '../app';
import type { AtBatOutcome, BattedBall } from '../core/types';
import { playerWithGear } from '../core/gear';
import { LEVELS, teamKit } from '../core/league';
import { TEAM_KITS, uniformFor } from '../core/uniforms';
import { AtBatView } from '../game/atBatView';
import { CatchOverlay } from '../game/catchOverlay';
import { playSound, startAmbience, stopAmbience } from '../ui/audio';
import { q } from '../ui/dom';

/**
 * The playable training drills. Each takes over the training screen's mount,
 * runs a short skill game with the real career player — current gear, current
 * fatigue — and reports a 0-1 score the screen turns into bonus XP. Nothing
 * here touches career state; the screen applies the training afterwards.
 */

export interface DrillOutcome {
  /** Share of the drill's maximum score, 0-1. */
  ratio: number;
  /** One line for the wrap-up dialog, without trailing punctuation. */
  headline: string;
}

/**
 * Three ways a drill ends:
 * - `onDone(outcome)` — it ran; the screen charges the session and pays out.
 * - `onDone(null)` — backed out before the first rep; charge nothing.
 * - the returned handle — the route changed underneath us; tear down silently.
 */
export type DrillRunner = (
  app: App,
  mount: HTMLElement,
  onDone: (outcome: DrillOutcome | null) => void,
) => () => void;

/* ------------------------------------------------------------------ shell */

interface DrillShell {
  host: HTMLElement;
  setGoal(text: string): void;
  showNote(text: string): void;
  onEnd(fn: () => void): void;
  /** Hand the mount back to the training screen. */
  restore(): void;
}

function buildShell(mount: HTMLElement, title: string, stageClass = ''): DrillShell {
  mount.classList.add('game-screen');
  mount.innerHTML = `
    <header class="tut-bar">
      <button class="btn ghost tiny" id="drillEnd">End Session</button>
      <div class="tut-title"><span class="tiny muted">${title}</span></div>
      <button class="btn ghost tiny" style="visibility:hidden">End Session</button>
    </header>
    <div class="stage ${stageClass}">
      <div id="host"></div>
      <div class="tut-goal" id="goal"></div>
      <div class="tut-note" id="note"></div>
    </div>
  `;
  const goal = q(mount, '#goal');
  const note = q(mount, '#note');
  let noteTimer = 0;
  return {
    host: q(mount, '#host'),
    setGoal(text) {
      goal.textContent = text;
    },
    showNote(text) {
      note.textContent = text;
      note.classList.add('show');
      clearTimeout(noteTimer);
      noteTimer = window.setTimeout(() => note.classList.remove('show'), 2600);
    },
    onEnd(fn) {
      q(mount, '#drillEnd').addEventListener('click', fn);
    },
    restore() {
      clearTimeout(noteTimer);
      mount.classList.remove('game-screen');
      mount.innerHTML = '';
    },
  };
}

/* ----------------------------------------------------------- BP challenge */

const BP_ROUNDS = 5;
const BP_MAX = BP_ROUNDS * 3;
const SWING_POINTS: Partial<Record<BattedBall['quality'], number>> = {
  barrel: 3,
  solid: 2,
  flare: 1,
};

/**
 * A round of BP off the coach: five at-bats, each scored by the quality of
 * the ball you put in play. Contact and stamina matter the same way they do
 * in a game — a tired hitter's sweet spot is smaller in the cage too.
 */
export const runBpChallenge: DrillRunner = (app, mount, onDone) => {
  const save = app.requireSave();
  const batter = playerWithGear(save.player);
  const myKit = uniformFor(teamKit(save.league, save.league.playerTeamId), true);
  const coachKit = TEAM_KITS[1].away;

  const shell = buildShell(mount, 'BATTING PRACTICE');
  let view: AtBatView | null = null;
  let round = 0;
  let points = 0;
  let finished = false;

  const destroyView = (): void => {
    view?.destroy();
    view = null;
  };

  const finish = (outcome: DrillOutcome | null): void => {
    if (finished) return;
    finished = true;
    destroyView();
    stopAmbience();
    shell.restore();
    onDone(outcome);
  };

  const wrapUp = (): void => {
    if (points >= BP_MAX * 0.6) playSound('cheerShort');
    finish({
      ratio: points / BP_MAX,
      headline: `You put up ${points} of ${BP_MAX} points off the coach`,
    });
  };

  const nextRound = (): void => {
    if (finished) return;
    if (round >= BP_ROUNDS) {
      wrapUp();
      return;
    }
    shell.setGoal(`Round ${round + 1} of ${BP_ROUNDS} · ${points} pts`);
    view = new AtBatView(shell.host, {
      player: batter,
      // A coach who fills the zone, at Single-A speed whatever your level:
      // the drill grades your bat, not your ability to survive velocity.
      pitcher: { name: 'Coach Vega', rating: 30 },
      pitcherKit: coachKit,
      batterKit: myKit,
      level: LEVELS[0],
      rng: app.rng,
      onCount: () => {},
      onBallInPlay: (bb) => {
        destroyView();
        scoreSwing(bb);
      },
      onComplete: (o) => {
        destroyView();
        endOfAtBat(o);
      },
    });
  };

  const scoreSwing = (bb: BattedBall): void => {
    points += SWING_POINTS[bb.quality] ?? 0;
    round++;
    shell.showNote(
      bb.quality === 'barrel'
        ? 'BARRELED! +3'
        : bb.quality === 'solid'
          ? 'Squared up · +2'
          : bb.quality === 'flare'
            ? 'Caught a piece · +1'
            : 'Mishit — nothing on it.',
    );
    nextRound();
  };

  const endOfAtBat = (o: AtBatOutcome): void => {
    if (o.result === 'walk') {
      // The coach lost the zone; the round replays rather than counting.
      shell.showNote('Ball four — this is BP, swing the bat.');
    } else {
      round++;
      shell.showNote('Struck out — that round is gone.');
    }
    nextRound();
  };

  shell.onEnd(() => {
    if (round === 0) finish(null);
    else wrapUp();
  });

  startAmbience();
  nextRound();

  return () => {
    if (finished) return;
    finished = true;
    destroyView();
    stopAmbience();
  };
};

/* ----------------------------------------------------------- fungo frenzy */

const FUNGO_REPS = 6;

/**
 * Six stretch catches off the fungo bat, each one hit a little further from
 * you than the last. Your Fielding sets the size of the window, same as it
 * does mid-game.
 */
export const runFungoFrenzy: DrillRunner = (app, mount, onDone) => {
  const save = app.requireSave();
  const fielding = playerWithGear(save.player).attributes.fielding;

  const shell = buildShell(mount, 'FIELDING DRILLS', 'fungo-field');
  let overlay: CatchOverlay | null = null;
  let rep = 0;
  let caught = 0;
  let streak = 0;
  let bestStreak = 0;
  let timer = 0;
  let finished = false;

  const setGoal = (): void =>
    shell.setGoal(
      `Rep ${Math.min(rep + 1, FUNGO_REPS)} of ${FUNGO_REPS} · ${caught} gloved` +
        (streak >= 2 ? ` · ${streak} straight` : ''),
    );

  const finish = (outcome: DrillOutcome | null): void => {
    if (finished) return;
    finished = true;
    overlay?.destroy();
    overlay = null;
    clearTimeout(timer);
    stopAmbience();
    shell.restore();
    onDone(outcome);
  };

  const wrapUp = (): void => {
    if (caught >= FUNGO_REPS - 1) playSound('cheerShort');
    finish({
      ratio: caught / FUNGO_REPS,
      headline:
        `You gloved ${caught} of ${FUNGO_REPS}` +
        (bestStreak >= 3 ? `, ${bestStreak} of them in a row` : ''),
    });
  };

  const nextRep = (): void => {
    if (finished) return;
    if (rep >= FUNGO_REPS) {
      wrapUp();
      return;
    }
    setGoal();
    overlay = new CatchOverlay(shell.host, {
      fielding,
      // Starts routine and ends near full stretch — every rep comes faster.
      difficulty: 0.12 + (rep / (FUNGO_REPS - 1)) * 0.72,
      wasFly: app.rng.chance(0.5),
      rng: app.rng,
      onComplete: (success) => {
        overlay?.destroy();
        overlay = null;
        rep++;
        if (success) {
          caught++;
          streak++;
          bestStreak = Math.max(bestStreak, streak);
        } else {
          streak = 0;
        }
        setGoal();
        timer = window.setTimeout(nextRep, 420);
      },
    });
  };

  shell.onEnd(() => {
    if (rep === 0) finish(null);
    else wrapUp();
  });

  startAmbience();
  nextRep();

  return () => {
    if (finished) return;
    finished = true;
    overlay?.destroy();
    clearTimeout(timer);
    stopAmbience();
  };
};
