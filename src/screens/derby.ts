import type { App, Route } from '../app';
import type { BattedBall, PlayerProfile } from '../core/types';
import { ARCHETYPES, createPlayer } from '../core/player';
import { playerWithGear } from '../core/gear';
import { BATTING_EYE_THRESHOLD, PERFECT_ZONE_THRESHOLD } from '../core/progression';
import { LEVELS, teamKit } from '../core/league';
import { TEAM_KITS, uniformFor } from '../core/uniforms';
import { AtBatView } from '../game/atBatView';
import { DerbyFlightView } from '../game/derbyFlight';
import { BALLPARKS } from '../core/ballpark';
import { CALM, airFor } from '../core/weather';
import { readKey, writeKey } from '../core/storage';
import { playSound, startAmbience, stopAmbience } from '../ui/audio';
import { q } from '../ui/dom';

/**
 * Home Run Derby: the free mode. Every pitch is a grooved fastball over the
 * heart of the plate, and the only thing that counts is whether the ball
 * leaves the yard. Three ways to play: 10 balls, 20 balls, or a streak that
 * ends on the third miss. No career state is touched — it works with or
 * without a save, and the derby's own best scores live under their own key.
 *
 * The venue is always The Bandbox, the smallest park in the game. A derby in
 * a fair park is a derby where good swings die at the track; here a barreled
 * ball is a home run, which is the entire point of the evening.
 */

/** Where Exit goes when you leave the derby. */
let returnTo: Route = 'title';

export function openDerby(app: App, then: Route): void {
  returnTo = then;
  app.go('derby');
}

type DerbyMode = 'balls10' | 'balls20' | 'streak';

const MODES: Record<DerbyMode, { label: string; balls?: number; misses?: number }> = {
  balls10: { label: '10 Balls', balls: 10 },
  balls20: { label: '20 Balls', balls: 20 },
  streak: { label: 'Streak', misses: 3 },
};

const PARK = BALLPARKS.find((p) => p.id === 'bandbox') ?? BALLPARKS[0];

/* ---------------------------------------------------------------- bests */

interface DerbyBests {
  balls10: number;
  balls20: number;
  streak: number;
  /** Longest home run ever hit in the derby, in feet. */
  longest: number;
}

const BEST_KEY = 'baseball-star:derby:best';

function loadBests(): DerbyBests {
  try {
    const raw = readKey(BEST_KEY);
    if (raw) return { balls10: 0, balls20: 0, streak: 0, longest: 0, ...JSON.parse(raw) };
  } catch {
    /* corrupt or absent — fresh slate */
  }
  return { balls10: 0, balls20: 0, streak: 0, longest: 0 };
}

function saveBests(bests: DerbyBests): void {
  writeKey(BEST_KEY, JSON.stringify(bests));
}

/* --------------------------------------------------------------- player */

/**
 * Who swings: your career player with gear if there is one, a generic slugger
 * if not. Power is floored where a barrel actually clears The Bandbox — a
 * derby you physically can't win isn't a mode, it's a prank — and everything
 * else is floored the way the tutorial floors it. A career slugger still out-
 * homers the floor, so the mode gets better as your player does.
 */
function derbyProfile(app: App): PlayerProfile {
  const base = app.save
    ? playerWithGear(app.save.player)
    : createPlayer('Slugger', 'CF', 'R', ARCHETYPES[3]);
  const attributes = { ...base.attributes };
  for (const key of Object.keys(attributes) as (keyof typeof attributes)[]) {
    attributes[key] = Math.max(attributes[key], 45);
  }
  attributes.power = Math.max(attributes.power, 65);
  // Both aiming aids are on for everyone: the gold timing lock, and the
  // sweet-spot marker on the ball. A derby is batting practice with a
  // scoreboard — the game is putting the tap on the mark, not finding it.
  attributes.vision = Math.max(attributes.vision, BATTING_EYE_THRESHOLD);
  attributes.contact = Math.max(attributes.contact, PERFECT_ZONE_THRESHOLD - attributes.vision);
  return { ...base, attributes, stamina: 100 };
}

/* --------------------------------------------------------------- screen */

export function renderDerby(app: App, mount: HTMLElement): () => void {
  let disposed = false;
  let teardownRun: (() => void) | null = null;

  const stopRun = (): void => {
    teardownRun?.();
    teardownRun = null;
  };

  interface RunSummary {
    mode: DerbyMode;
    homers: number;
    swings: number;
    longest: number;
    newBest: boolean;
  }

  /* ---- mode select ---- */

  const menu = (summary?: RunSummary): void => {
    stopRun();
    if (disposed) return;
    const bests = loadBests();
    const bestTag = (n: number): string => (n > 0 ? ` · Best ${n}` : '');

    const resultPanel = summary
      ? `
      <div class="panel">
        <h2>${summary.newBest ? 'New best!' : 'Round over'}</h2>
        <p class="tiny muted" style="margin:0">
          <b style="color:var(--text)">${summary.homers} home run${summary.homers === 1 ? '' : 's'}</b>
          on ${summary.swings} ball${summary.swings === 1 ? '' : 's'} in ${MODES[summary.mode].label}${
          summary.longest > 0 ? ` — longest ${summary.longest} ft` : ''
        }.
        </p>
      </div>`
      : '';

    mount.innerHTML = `
      <div class="scroll">
        <div class="brand">
          <h1>HOME RUN<span>DERBY</span></h1>
          <p>Under the lights at ${PARK.name}. ${PARK.blurb}</p>
        </div>
        ${resultPanel}
        <div class="panel">
          <h2>Every pitch is a meatball</h2>
          <p class="tiny muted" style="margin:0">
            Grooved fastballs, middle-middle, all night. Tap a hair
            <b style="color:var(--accent)">under center</b> and yank it out.
            Anything that stays in the yard is a miss — so is striking out.
            Taking a pitch costs nothing but pride.
          </p>
          ${bests.longest > 0 ? `<p class="tiny muted" style="margin:8px 0 0">Longest ever: <b style="color:var(--text)">${bests.longest} ft</b></p>` : ''}
        </div>
        <div class="panel">
          <h2>Pick your round</h2>
          <button class="btn primary" id="balls10" style="margin-top:4px">10 Balls${bestTag(bests.balls10)}</button>
          <button class="btn primary" id="balls20" style="margin-top:8px">20 Balls${bestTag(bests.balls20)}</button>
          <button class="btn primary" id="streak" style="margin-top:8px">Streak — 3 misses and done${bestTag(bests.streak)}</button>
        </div>
      </div>
      <button class="btn ghost" id="back">Back</button>
    `;

    for (const mode of Object.keys(MODES) as DerbyMode[]) {
      q(mount, `#${mode}`).addEventListener('click', () => play(mode));
    }
    q(mount, '#back').addEventListener('click', () => app.go(returnTo));
  };

  /* ---- a round ---- */

  const play = (mode: DerbyMode): void => {
    const rules = MODES[mode];
    const batter = derbyProfile(app);
    const myKit = app.save
      ? uniformFor(teamKit(app.save.league, app.save.league.playerTeamId), true)
      : TEAM_KITS[0].home;
    const pitcherKit = TEAM_KITS[1].away;
    const air = airFor(CALM);

    mount.classList.add('game-screen');
    mount.innerHTML = `
      <header class="tut-bar">
        <button class="btn ghost tiny" id="derbyEnd">Exit</button>
        <div class="tut-title"><span class="tiny muted">HOME RUN DERBY · ${MODES[mode].label.toUpperCase()}</span></div>
        <button class="btn ghost tiny" style="visibility:hidden">Exit</button>
      </header>
      <div class="stage">
        <div id="host"></div>
        <div class="tut-goal" id="goal"></div>
        <div class="tut-note" id="note"></div>
      </div>
    `;
    const host = q(mount, '#host');
    const goal = q(mount, '#goal');
    const note = q(mount, '#note');

    let view: AtBatView | null = null;
    let flight: DerbyFlightView | null = null;
    let noteTimer = 0;
    let soundTimer = 0;
    let finished = false;
    let swings = 0;
    let homers = 0;
    let misses = 0;
    let longest = 0;

    const showNote = (text: string): void => {
      note.textContent = text;
      note.classList.add('show');
      clearTimeout(noteTimer);
      noteTimer = window.setTimeout(() => note.classList.remove('show'), 2600);
    };

    const setGoal = (): void => {
      goal.textContent = rules.balls
        ? `Ball ${Math.min(swings + 1, rules.balls)} of ${rules.balls} · ${homers} HR`
        : `${homers} HR · ${misses} of ${rules.misses} misses`;
    };

    const destroyView = (): void => {
      view?.destroy();
      view = null;
      flight?.destroy();
      flight = null;
    };

    teardownRun = (): void => {
      finished = true;
      destroyView();
      clearTimeout(noteTimer);
      clearTimeout(soundTimer);
      stopAmbience();
      mount.classList.remove('game-screen');
    };

    const wrapUp = (): void => {
      if (finished) return;
      const bests = loadBests();
      const newBest = homers > bests[mode];
      bests[mode] = Math.max(bests[mode], homers);
      bests.longest = Math.max(bests.longest, longest);
      saveBests(bests);
      if (homers > 0) playSound(newBest ? 'cheerBig' : 'cheerShort');
      stopRun();
      menu({ mode, homers, swings, longest, newBest });
    };

    const roundOver = (): boolean =>
      rules.balls ? swings >= rules.balls : misses >= (rules.misses ?? 3);

    const nextBall = (): void => {
      if (finished) return;
      if (roundOver()) {
        wrapUp();
        return;
      }
      setGoal();
      view = new AtBatView(host, {
        player: batter,
        // A BP arm who grooves everything — see the `groove` flag. Single-A
        // velocity: the derby grades your barrel, not your reaction time.
        pitcher: { name: 'Derby Coach', rating: 30 },
        pitcherKit,
        batterKit: myKit,
        level: LEVELS[0],
        rng: app.rng,
        groove: true,
        onCount: () => {},
        onBallInPlay: (bb) => {
          destroyView();
          scoreBall(bb);
        },
        onComplete: () => {
          // Only a strikeout can end a grooved at-bat — every pitch is a
          // strike, so ball four never comes. It burns a ball like a miss.
          destroyView();
          swings++;
          misses++;
          showNote('Struck out. That one is gone — the ball, sadly, is not.');
          nextBall();
        },
      });
    };

    // The swing hands off to the flight view: the same physics the field sim
    // runs, drawn as it happens, and the on-screen ruling is the ruling.
    const scoreBall = (bb: BattedBall): void => {
      swings++;
      flight = new DerbyFlightView(host, {
        battedBall: bb,
        park: PARK,
        air,
        onHomeRun: () => {
          playSound('homeRun');
          clearTimeout(soundTimer);
          soundTimer = window.setTimeout(() => playSound('fanfare'), 1400);
        },
        onDone: ({ homeRun, distance }) => {
          flight?.destroy();
          flight = null;
          if (finished) return;
          if (homeRun) {
            homers++;
            longest = Math.max(longest, distance);
            showNote(`GONE! ${distance} ft.`);
          } else {
            misses++;
            showNote(
              distance >= 300
                ? `Died at the track — ${distance} ft. So close.`
                : `In play, ${distance} ft. Doesn't count tonight.`,
            );
          }
          nextBall();
        },
      });
    };

    q(mount, '#derbyEnd').addEventListener('click', () => {
      if (swings === 0) {
        stopRun();
        menu();
        return;
      }
      wrapUp();
    });

    startAmbience();
    nextBall();
  };

  menu();

  return () => {
    disposed = true;
    stopRun();
  };
}
