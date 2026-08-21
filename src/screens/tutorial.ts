import type { App, Route } from '../app';
import type { AtBatOutcome, BattedBall, PlayerProfile } from '../core/types';
import type { PlayOutcome } from '../core/playSim';
import { PlaySim } from '../core/playSim';
import type { PositionId } from '../core/fieldGeometry';
import type { Rng } from '../core/rng';
import { ARCHETYPES, createPlayer } from '../core/player';
import { playerWithGear } from '../core/gear';
import { LEVELS } from '../core/league';
import { TEAM_KITS } from '../core/uniforms';
import { AtBatView } from '../game/atBatView';
import { PlayView } from '../game/playView';
import { markHowtoSeen } from './howto';
import { playSound, startAmbience, stopAmbience } from '../ui/audio';
import { q } from '../ui/dom';

/**
 * The playable tutorial: six short drills that teach every mechanic by making
 * you do it, using the real at-bat and field views. Three swings in the cage
 * (contact, the barrel, the eye), then three live plays (baserunning, the fly
 * ball, the grounder-and-throw). Each drill is an instruction card, then the
 * drill itself, looping until the goal is met — no career state is touched.
 */

/** Where Exit and the final Done button go. */
let returnTo: Route = 'hub';

export function openTutorial(app: App, then: Route): void {
  returnTo = then;
  app.go('tutorial');
}

type DrillId = 'contact' | 'barrel' | 'eye' | 'run' | 'fly' | 'throw';

interface Drill {
  id: DrillId;
  title: string;
  /** Instruction card body, shown before the drill starts. */
  body: string;
  goal: string;
  art: string;
  /** What the success overlay says. */
  praise: string;
}

const DRILLS: Drill[] = [
  {
    id: 'contact',
    title: 'Step in the cage',
    body:
      'The ball leaves the pitcher’s hand small and grows as it comes. <b>Tap it as it reaches the plate</b> — ' +
      'the ring closes on the ball and it <b class="gold">flashes gold</b> right when it’s there. ' +
      'The whole ball is a target, so anywhere on it puts the bat on the ball. ' +
      'Miss it entirely and that’s a swinging strike.',
    goal: 'Put 2 balls in play',
    praise: 'That’s the swing. Everything else at the plate builds on that tap.',
    art: `
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <rect x="0" y="0" width="120" height="84" rx="8" fill="#12203c"/>
        <rect x="0" y="9" width="120" height="9" fill="#141c30"/>
        <g fill="#8d9bb8"><rect x="8" y="11" width="1.6" height="1.6"/><rect x="21" y="14" width="1.6" height="1.6"/><rect x="34" y="11.5" width="1.6" height="1.6" fill="#b0796a"/><rect x="49" y="14.5" width="1.6" height="1.6"/><rect x="70" y="11" width="1.6" height="1.6" fill="#7a8bb0"/><rect x="84" y="14" width="1.6" height="1.6"/><rect x="97" y="11.5" width="1.6" height="1.6" fill="#c2b090"/><rect x="108" y="14.5" width="1.6" height="1.6"/></g>
        <rect x="0" y="18" width="120" height="3" fill="#0f3d2e"/>
        <rect x="0" y="21" width="120" height="63" fill="#1f6b3f"/>
        <path d="M-12 84 Q60 46 132 84 Z" fill="#8a5a35"/>
        <ellipse cx="60" cy="31" rx="13" ry="3.5" fill="#96633a"/>
        <path d="M58 29 v-4 M62 29 v-4" stroke="#363b44" stroke-width="1.6" stroke-linecap="round"/>
        <rect x="57" y="21.5" width="6" height="4.5" rx="2" fill="#25396b"/>
        <circle cx="60" cy="19.5" r="2.3" fill="#c98d63"/>
        <path d="M57.7 19.5 a2.3 2.3 0 0 1 4.6 0" fill="#111a2e"/>
        <rect x="39" y="42" width="42" height="28" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.55)" stroke-dasharray="4 3" stroke-width="1.4"/>
        <path d="M53 42 v28 M67 42 v28 M39 51.3 h42 M39 60.6 h42" stroke="rgba(255,255,255,0.16)" stroke-width="0.8"/>
        <defs>
          <radialGradient id="tut-bb1" cx="0.5" cy="0.5" r="0.5" fx="0.325" fy="0.3">
            <stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f5f3ed"/>
            <stop offset="0.85" stop-color="#ded9cd"/><stop offset="1" stop-color="#b6afa1"/>
          </radialGradient>
        </defs>
        <circle cx="57" cy="30" r="1.6" fill="rgba(255,255,255,0.3)"/>
        <circle cx="58" cy="38" r="3.2" fill="rgba(255,255,255,0.5)"/>
        <circle cx="60" cy="56" r="9" fill="url(#tut-bb1)"/>
        <g fill="none" stroke="#c04a3e" stroke-width="0.9" stroke-linecap="round">
          <path d="M62.16 49.3 A 8.55 8.55 0 0 1 62.16 62.7"/>
          <path d="M57.84 62.7 A 8.55 8.55 0 0 1 57.84 49.3"/>
        </g>
        <text x="60" y="80" text-anchor="middle" font-size="7" font-weight="800" fill="#5ce6a0" letter-spacing="1">TAP IT AS IT ARRIVES</text>
      </svg>`,
  },
  {
    id: 'barrel',
    title: 'Find the barrel',
    body:
      'Where on the ball you land decides everything. A hair <b class="good">under centre</b> is the sweet spot — ' +
      'that’s the barrel, and that’s your power. Over centre chops it into the dirt; way under skies it. ' +
      'After every swing the game freezes and marks where your tap landed, so read it and adjust.',
    goal: 'Barrel one up',
    praise: 'BARRELED! That feeling is the whole game. Contact widens that sweet spot; Power turns it into home runs.',
    art: `
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <rect x="0" y="0" width="120" height="84" rx="8" fill="#0f1a30"/>
        <defs>
          <radialGradient id="tut-bb2" cx="0.5" cy="0.5" r="0.5" fx="0.325" fy="0.3">
            <stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f5f3ed"/>
            <stop offset="0.85" stop-color="#ded9cd"/><stop offset="1" stop-color="#b6afa1"/>
          </radialGradient>
        </defs>
        <circle cx="60" cy="36" r="24" fill="url(#tut-bb2)"/>
        <g fill="none" stroke="#c04a3e" stroke-width="1.2" stroke-linecap="round">
          <path d="M65.77 18.14 A 22.8 22.8 0 0 1 65.77 53.86"/>
          <path d="M54.23 53.86 A 22.8 22.8 0 0 1 54.23 18.14"/>
        </g>
        <g stroke="#a83228" stroke-width="0.84" stroke-linecap="round">
          <path d="M66.35 21.14 L71.13 20.8 M70.64 27.28 L75.24 28.66 M72.49 34.55 L76.31 37.45 M71.66 42 L74.22 46.06 M68.26 48.68 L69.22 53.38"/>
          <path d="M53.65 50.86 L48.87 51.2 M49.36 44.72 L44.76 43.34 M47.51 37.45 L43.69 34.55 M48.34 30 L45.78 25.94 M51.74 23.32 L50.78 18.62"/>
        </g>
        <path d="M52 36 h16" stroke="rgba(0,0,0,0.18)" stroke-width="1" stroke-dasharray="2 2"/>
        <circle cx="60" cy="43.7" r="9.5" fill="none" stroke="#5ce6a0" stroke-width="2" stroke-dasharray="3.5 2.5"/>
        <path d="M55.5 43.7 h9 M60 39.2 v9" stroke="#5ce6a0" stroke-width="1.4"/>
        <path d="M56.5 40.2 l7 7 M63.5 40.2 l-7 7" stroke="#ffd166" stroke-width="2.6" stroke-linecap="round"/>
        <text x="97" y="34" text-anchor="middle" font-size="6" font-weight="800" fill="rgba(255,255,255,0.5)">CENTRE</text>
        <path d="M84 36 h-12" stroke="rgba(255,255,255,0.35)" stroke-width="1" stroke-dasharray="2 2"/>
        <text x="99" y="46" text-anchor="middle" font-size="6" font-weight="800" fill="#ffd166">YOUR TAP</text>
        <path d="M88 44 h-20" stroke="rgba(255,209,102,0.6)" stroke-width="1" stroke-dasharray="2 2"/>
        <text x="60" y="76" text-anchor="middle" font-size="7" font-weight="800" fill="#5ce6a0" letter-spacing="1">A HAIR UNDER CENTRE</text>
      </svg>`,
  },
  {
    id: 'eye',
    title: 'Work the count',
    body:
      'Not every pitch deserves a swing. The dashed box is the strike zone — if the ball is landing ' +
      '<b class="info">outside it, let it go</b>. A pitch off the plate never flashes gold: the ring just fades out — ' +
      '<b class="info">no gold, no swing</b>. Four balls is a walk and a free base. ' +
      'The pitch name appears out of the hand (that’s your Vision at work), and the count lives beside the zone.',
    goal: 'Draw a walk',
    praise: 'Ball four — take your base. Walks are free offense, and laying off junk is what gets you good pitches to hit.',
    art: `
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <rect x="0" y="0" width="120" height="84" rx="8" fill="#12203c"/>
        <rect x="0" y="9" width="120" height="9" fill="#141c30"/>
        <rect x="0" y="18" width="120" height="3" fill="#0f3d2e"/>
        <rect x="0" y="21" width="120" height="63" fill="#1f6b3f"/>
        <path d="M-12 84 Q60 46 132 84 Z" fill="#8a5a35"/>
        <ellipse cx="60" cy="31" rx="13" ry="3.5" fill="#96633a"/>
        <rect x="57" y="21.5" width="6" height="4.5" rx="2" fill="#25396b"/>
        <circle cx="60" cy="19.5" r="2.3" fill="#c98d63"/>
        <path d="M57.7 19.5 a2.3 2.3 0 0 1 4.6 0" fill="#111a2e"/>
        <rect x="36" y="42" width="40" height="28" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.55)" stroke-dasharray="4 3" stroke-width="1.4"/>
        <text x="14" y="47" font-size="6.5" font-weight="800" fill="rgba(255,255,255,0.85)">B</text>
        <g><circle cx="21" cy="45" r="2" fill="#35c26a"/><circle cx="26.5" cy="45" r="2" fill="#35c26a"/><circle cx="32" cy="45" r="2" fill="none" stroke="rgba(255,255,255,0.4)"/></g>
        <text x="14" y="56" font-size="6.5" font-weight="800" fill="rgba(255,255,255,0.85)">S</text>
        <g><circle cx="21" cy="54" r="2" fill="#ff6b6b"/><circle cx="26.5" cy="54" r="2" fill="none" stroke="rgba(255,255,255,0.4)"/></g>
        <defs>
          <radialGradient id="tut-bb3" cx="0.5" cy="0.5" r="0.5" fx="0.325" fy="0.3">
            <stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f5f3ed"/>
            <stop offset="0.85" stop-color="#ded9cd"/><stop offset="1" stop-color="#b6afa1"/>
          </radialGradient>
        </defs>
        <circle cx="90" cy="34" r="1.6" fill="rgba(255,255,255,0.3)"/>
        <circle cx="91" cy="42" r="3.4" fill="rgba(255,255,255,0.5)"/>
        <circle cx="93" cy="58" r="8.5" fill="url(#tut-bb3)"/>
        <g fill="none" stroke="#c04a3e" stroke-width="0.85" stroke-linecap="round">
          <path d="M95.04 51.68 A 8.08 8.08 0 0 1 95.04 64.32"/>
          <path d="M90.96 64.32 A 8.08 8.08 0 0 1 90.96 51.68"/>
        </g>
        <text x="60" y="80" text-anchor="middle" font-size="7" font-weight="800" fill="#5aa9ff" letter-spacing="1">OFF THE PLATE? LET IT GO</text>
      </svg>`,
  },
  {
    id: 'run',
    title: 'Run the bases',
    body:
      'We’ve ripped one into the gap for you — now run it out. Your man takes what’s clearly there on his own. ' +
      '<b class="good">GO</b> sends him for the next base, <b class="gold">HOLD</b> pulls him up, ' +
      '<b class="info">BACK</b> turns him round. The dashed line shows the bag you’re headed for — ' +
      'when it turns <b class="bad">red</b>, the ball is beating you there.',
    goal: 'Get on base — try to stretch it into a double',
    praise: 'Safe! Extra bases are stolen in the gap between a fielder reaching the ball and the throw arriving. Speed widens it.',
    art: `
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <rect x="0" y="0" width="120" height="84" rx="8" fill="#26924b"/>
        <rect x="0" y="0" width="30" height="84" fill="#1f7a3f"/>
        <rect x="60" y="0" width="30" height="84" fill="#1f7a3f"/>
        <path d="M60 62 L88 38 L60 14 L32 38 Z" fill="none" stroke="#b07a45" stroke-width="6" stroke-linejoin="round"/>
        <rect x="84.5" y="34.5" width="7" height="7" fill="#f4f6fa"/>
        <rect x="56.5" y="10.5" width="7" height="7" fill="#f4f6fa"/>
        <rect x="28.5" y="34.5" width="7" height="7" fill="#f4f6fa"/>
        <path d="M60 62 l3.5 3 h-7 Z" fill="#f4f6fa"/>
        <defs>
          <radialGradient id="tut-bb4" cx="0.5" cy="0.5" r="0.5" fx="0.325" fy="0.3">
            <stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f5f3ed"/>
            <stop offset="1" stop-color="#b6afa1"/>
          </radialGradient>
        </defs>
        <circle cx="14" cy="12" r="2.6" fill="url(#tut-bb4)"/>
        <path d="M20 16 L44 30" stroke="rgba(255,255,255,0.55)" stroke-width="1.2" stroke-dasharray="2.5 2"/>
        <path d="M88 38 L60 14" stroke="#ffd166" stroke-width="2" stroke-dasharray="4 3"/>
        <circle cx="60" cy="14" r="8" fill="none" stroke="#ffd166" stroke-width="2"/>
        <circle cx="84" cy="43" r="4.2" fill="#5aa9ff" stroke="#fff" stroke-width="1.4"/>
        <rect x="6" y="68" width="32" height="12" rx="4" fill="rgba(255,209,102,0.92)"/>
        <text x="22" y="76.5" text-anchor="middle" font-size="7" font-weight="800" fill="#2a1d00">HOLD</text>
        <rect x="44" y="68" width="32" height="12" rx="4" fill="rgba(90,169,255,0.92)"/>
        <text x="60" y="76.5" text-anchor="middle" font-size="7" font-weight="800" fill="#08192e">BACK</text>
        <rect x="82" y="68" width="32" height="12" rx="4" fill="rgba(53,194,106,0.95)"/>
        <text x="98" y="76.5" text-anchor="middle" font-size="7" font-weight="800" fill="#05210f">GO</text>
      </svg>`,
  },
  {
    id: 'fly',
    title: 'Track it down',
    body:
      'You’re in centre field and one is coming your way. <b>Drag anywhere on the screen to run</b> — ' +
      'it’s a joystick wherever your thumb lands. The <b class="gold">gold ring</b> marks where the ball is coming down: ' +
      'get under it and the catch is yours. Reach it only at the edge of your range and the game asks you to ' +
      '<b class="gold">tap the ball as it arrives</b> — the stretch catch.',
    goal: 'Catch the fly ball',
    praise: 'Out! Your Fielding rating is how big your glove is out there. Putouts pay XP and cash, so want the ball.',
    art: `
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <rect x="0" y="0" width="120" height="84" rx="8" fill="#26924b"/>
        <rect x="0" y="0" width="120" height="22" fill="#1f7a3f"/>
        <rect x="0" y="44" width="120" height="22" fill="#1f7a3f"/>
        <circle cx="80" cy="38" r="11" fill="none" stroke="#ffe178" stroke-width="2" stroke-dasharray="4 3"/>
        <circle cx="80" cy="38" r="1.8" fill="#ffe178"/>
        <defs>
          <radialGradient id="tut-bb5" cx="0.5" cy="0.5" r="0.5" fx="0.325" fy="0.3">
            <stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f5f3ed"/>
            <stop offset="1" stop-color="#b6afa1"/>
          </radialGradient>
        </defs>
        <ellipse cx="74" cy="30" rx="3.4" ry="1.6" fill="rgba(0,0,0,0.3)"/>
        <circle cx="73" cy="16" r="4" fill="url(#tut-bb5)"/>
        <circle cx="42" cy="48" r="4.5" fill="#5aa9ff" stroke="#fff" stroke-width="1.5"/>
        <path d="M48 46.5 L72 40.5" stroke="rgba(255,255,255,0.75)" stroke-width="1.5" stroke-dasharray="2.5 2"/>
        <path d="M72 40.5 l-4 -1 M72 40.5 l-2.4 3.4" stroke="rgba(255,255,255,0.75)" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="24" cy="62" r="13" fill="rgba(10,16,28,0.25)" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
        <circle cx="30" cy="57" r="5.5" fill="rgba(255,255,255,0.6)"/>
        <text x="24" y="81" text-anchor="middle" font-size="5.5" font-weight="800" fill="rgba(255,255,255,0.75)">YOUR THUMB</text>
        <text x="80" y="60" text-anchor="middle" font-size="5.5" font-weight="800" fill="#ffe178">LANDING RING</text>
        <text x="60" y="10" text-anchor="middle" font-size="7" font-weight="800" fill="#fff" letter-spacing="1">DRAG ANYWHERE TO RUN</text>
      </svg>`,
  },
  {
    id: 'throw',
    title: 'Turn the out',
    body:
      'You’re at shortstop with a runner tearing up the line. Drag to the grounder and glove it — ' +
      'then four buttons come up. <b>Tap 1ST</b> to throw, and beat the runner to the bag. ' +
      'Sit on the ball too long and he’s safe. Close to a ringed base? You can <b>run it there yourself</b> — no throw needed. ' +
      'Your Arm rating is how hard you throw.',
    goal: 'Throw the runner out at first',
    praise: 'Got him! That’s every tool in the game — you’re ready for a real season.',
    art: `
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <rect x="0" y="0" width="120" height="84" rx="8" fill="#26924b"/>
        <rect x="0" y="0" width="40" height="84" fill="#1f7a3f"/>
        <rect x="80" y="0" width="40" height="84" fill="#1f7a3f"/>
        <path d="M60 60 L88 36 L60 12 L32 36 Z" fill="none" stroke="#b07a45" stroke-width="6" stroke-linejoin="round"/>
        <rect x="84.5" y="32.5" width="7" height="7" fill="#f4f6fa"/>
        <rect x="56.5" y="8.5" width="7" height="7" fill="#f4f6fa"/>
        <rect x="28.5" y="32.5" width="7" height="7" fill="#f4f6fa"/>
        <path d="M60 60 l3.5 3 h-7 Z" fill="#f4f6fa"/>
        <defs>
          <radialGradient id="tut-bb6" cx="0.5" cy="0.5" r="0.5" fx="0.325" fy="0.3">
            <stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f5f3ed"/>
            <stop offset="1" stop-color="#b6afa1"/>
          </radialGradient>
        </defs>
        <circle cx="45" cy="27" r="4.5" fill="#5aa9ff" stroke="#fff" stroke-width="1.5"/>
        <circle cx="49.5" cy="24.5" r="1.8" fill="url(#tut-bb6)"/>
        <path d="M50 25 Q70 12 87 33" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 2"/>
        <circle cx="76" cy="49" r="4.2" fill="#ff9d9d" stroke="#fff" stroke-width="1.2"/>
        <path d="M69 55 L81 45" stroke="rgba(255,157,157,0.5)" stroke-width="1.2" stroke-dasharray="2 2"/>
        <g font-size="6.5" font-weight="800" fill="#fff">
          <rect x="4" y="66" width="26" height="12" rx="4" fill="rgba(10,18,32,0.8)"/><text x="17" y="74.5" text-anchor="middle">HOME</text>
          <rect x="33" y="66" width="26" height="12" rx="4" fill="rgba(10,18,32,0.8)"/><text x="46" y="74.5" text-anchor="middle">3RD</text>
          <rect x="62" y="66" width="26" height="12" rx="4" fill="rgba(10,18,32,0.8)"/><text x="75" y="74.5" text-anchor="middle">2ND</text>
          <rect x="91" y="66" width="26" height="12" rx="4" fill="rgba(255,209,102,0.95)"/><text x="104" y="74.5" text-anchor="middle" fill="#2a1d00">1ST</text>
        </g>
      </svg>`,
  },
];

/* ------------------------------------------------------------ drill balls */

/**
 * A liner into the left-centre gap. Tuned against the flight model: at this
 * angle and spray no outfielder at practice-squad speed can reach the landing
 * point on the fly, and the ball settles past 250 ft, which is where the sim
 * lets a batter think about second. Lower or steeper and the drill breaks —
 * checked over hundreds of rolls, not guessed.
 */
const gapDouble = (rng: Rng): BattedBall => ({
  quality: 'solid',
  exitVelocity: 100 + rng.range(-2, 2),
  launchAngle: 11 + rng.range(-1.5, 1.5),
  spray: -0.26 + rng.range(-0.04, 0.04),
  sideSpin: 0,
});

/**
 * A high fly that lands 20-55 ft to one side of centre field's spot: always a
 * real run to the ring, never so far the catch is out of reach. The spray
 * floor matters — dead-centre versions dropped straight into the glove with
 * nothing to learn.
 */
const teachingFly = (rng: Rng): BattedBall => ({
  quality: 'solid',
  exitVelocity: 92 + rng.range(-3, 3),
  launchAngle: 41 + rng.range(-2, 2),
  spray: (rng.chance(0.5) ? 1 : -1) * rng.range(0.08, 0.16),
  sideSpin: 0,
});

/**
 * A hard one-hopper through the shortstop hole. The low line matters: softer
 * or steeper contact dies by the mound where the CPU corners are closer and
 * would take the play away from the user entirely.
 */
const teachingGrounder = (rng: Rng): BattedBall => ({
  quality: 'weak',
  exitVelocity: 96 + rng.range(-2, 2),
  launchAngle: 2 + rng.range(-1, 1),
  spray: -0.28 + rng.range(-0.03, 0.03),
  sideSpin: 0,
});

/** Which fielding spot each live drill plays from, whatever your position. */
const DRILL_POSITION: Partial<Record<DrillId, PositionId>> = {
  fly: 'CF',
  throw: 'SS',
};

/**
 * The player who takes the drills: your career player if there is one, a
 * generic prospect if not — with every attribute floored so the tutorial is
 * about learning the motions, not fighting a rookie's ratings.
 */
function practiceProfile(app: App): PlayerProfile {
  const base = app.save
    ? playerWithGear(app.save.player)
    : createPlayer('Prospect', 'CF', 'R', ARCHETYPES[3]);
  const attributes = { ...base.attributes };
  for (const key of Object.keys(attributes) as (keyof typeof attributes)[]) {
    attributes[key] = Math.max(attributes[key], 45);
  }
  return { ...base, attributes, stamina: 100 };
}

export function renderTutorial(app: App, mount: HTMLElement): () => void {
  const practice = practiceProfile(app);
  const myKit = TEAM_KITS[0].home;
  const theirKit = TEAM_KITS[1].away;

  let step = 0;
  let progress = 0;
  let view: AtBatView | PlayView | null = null;
  let disposed = false;
  let noteTimer = 0;

  mount.classList.add('game-screen');
  mount.innerHTML = `
    <header class="tut-bar">
      <button class="btn ghost tiny" id="exit">Exit</button>
      <div class="tut-title">
        <span class="tiny muted">TUTORIAL</span>
        <div class="howto-dots" id="dots"></div>
      </div>
      <button class="btn ghost tiny" id="skip">Skip »</button>
    </header>
    <div class="stage">
      <div id="host"></div>
      <div class="tut-goal" id="goal"></div>
      <div class="tut-note" id="note"></div>
      <div class="tut-overlay" id="overlay"></div>
    </div>
  `;

  const host = q(mount, '#host');
  const goal = q(mount, '#goal');
  const note = q(mount, '#note');
  const overlay = q(mount, '#overlay');
  const skipBtn = q<HTMLButtonElement>(mount, '#skip');

  const syncDots = (): void => {
    q(mount, '#dots').innerHTML = DRILLS.map(
      (_, i) => `<i class="${i === step ? 'on' : ''}"></i>`,
    ).join('');
  };

  const destroyView = (): void => {
    if (view) {
      view.destroy();
      view = null;
    }
  };

  /** Transient coaching line under the goal pill, gone after a few seconds. */
  const showNote = (text: string): void => {
    note.textContent = text;
    note.classList.add('show');
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => note.classList.remove('show'), 3200);
  };

  const setGoal = (text: string): void => {
    goal.textContent = text;
    goal.style.display = text ? '' : 'none';
  };

  interface OverlayCard {
    art?: string;
    kicker: string;
    title: string;
    body: string;
    goal?: string;
    cta: string;
    onCta: () => void;
    alt?: string;
    onAlt?: () => void;
  }

  const showOverlay = (c: OverlayCard): void => {
    setGoal('');
    note.classList.remove('show');
    skipBtn.style.display = 'none';
    overlay.innerHTML = `
      <div class="panel howto-card">
        ${c.art ? `<div class="howto-art">${c.art}</div>` : ''}
        <span class="tiny muted">${c.kicker}</span>
        <h2>${c.title}</h2>
        <p>${c.body}</p>
        ${c.goal ? `<div class="tut-goal-line">GOAL — ${c.goal}</div>` : ''}
      </div>
      <div class="btn-row">
        ${c.alt ? '<button class="btn ghost" id="ovAlt"></button>' : ''}
        <button class="btn primary" id="ovCta"></button>
      </div>
    `;
    const cta = q<HTMLButtonElement>(overlay, '#ovCta');
    cta.textContent = c.cta;
    cta.addEventListener('click', c.onCta);
    if (c.alt && c.onAlt) {
      const alt = q<HTMLButtonElement>(overlay, '#ovAlt');
      alt.textContent = c.alt;
      alt.addEventListener('click', c.onAlt);
    }
    overlay.classList.add('show');
  };

  const hideOverlay = (): void => {
    overlay.classList.remove('show');
    overlay.innerHTML = '';
    skipBtn.style.display = '';
  };

  /* ------------------------------------------------------------ sequencing */

  const finish = (): void => {
    // Playing the tutorial counts as having read the how-to.
    markHowtoSeen();
    app.go(returnTo);
  };

  const showFinale = (): void => {
    destroyView();
    playSound('fanfare');
    showOverlay({
      kicker: 'TUTORIAL COMPLETE',
      title: 'That’s the whole game',
      body:
        'Tap the ball at the plate, a hair under centre. Take the junk. Run what’s there. ' +
        'Want every ball hit your way. The rest — training, gear, call-ups — you’ll pick up in the clubhouse. ' +
        'Go make The Show.',
      cta: app.save ? 'Back to the Clubhouse' : 'Done',
      onCta: finish,
    });
  };

  const nextStep = (): void => {
    step++;
    if (step >= DRILLS.length) {
      showFinale();
      return;
    }
    showIntro();
  };

  const showIntro = (): void => {
    destroyView();
    syncDots();
    const d = DRILLS[step];
    showOverlay({
      art: d.art,
      kicker: `DRILL ${step + 1} OF ${DRILLS.length}`,
      title: d.title,
      body: d.body,
      goal: d.goal,
      cta: 'Start Drill',
      onCta: () => {
        hideOverlay();
        startDrill();
      },
    });
  };

  const passDrill = (flavor?: string): void => {
    destroyView();
    playSound('cheerShort');
    const d = DRILLS[step];
    const last = step === DRILLS.length - 1;
    showOverlay({
      kicker: 'DRILL COMPLETE',
      title: 'Nailed it',
      body: flavor ?? d.praise,
      cta: last ? 'Finish' : 'Next Drill',
      onCta: nextStep,
    });
  };

  const failDrill = (why: string): void => {
    destroyView();
    showOverlay({
      kicker: `DRILL ${step + 1} OF ${DRILLS.length}`,
      title: 'Not this time',
      body: why,
      cta: 'Try Again',
      onCta: () => {
        hideOverlay();
        startDrill();
      },
      alt: 'Skip Drill',
      onAlt: nextStep,
    });
  };

  /* ---------------------------------------------------------------- drills */

  const startDrill = (): void => {
    if (disposed) return;
    progress = 0;
    const d = DRILLS[step];
    if (d.id === 'run' || d.id === 'fly' || d.id === 'throw') startPlayDrill();
    else startBatDrill();
  };

  const batGoalText = (): string => {
    switch (DRILLS[step].id) {
      case 'contact':
        return `Put it in play · ${progress} of 2`;
      case 'barrel':
        return 'Barrel one — tap a hair under centre';
      default:
        return 'Draw a walk — take everything off the plate';
    }
  };

  function startBatDrill(): void {
    const d = DRILLS[step];
    setGoal(batGoalText());

    view = new AtBatView(host, {
      player: practice,
      // The eye drill faces a wild arm so there's junk to lay off; the swing
      // drills get one who fills the zone at batting-practice speed.
      pitcher: { name: 'Coach Vega', rating: d.id === 'eye' ? 8 : 30 },
      pitcherKit: theirKit,
      batterKit: myKit,
      level: LEVELS[0],
      rng: app.rng,
      onCount: (c) => {
        if (d.id === 'eye') setGoal(`Draw a walk · ${c.balls} of 4 balls`);
      },
      onBallInPlay: (bb) => {
        destroyView();
        onBatBall(bb);
      },
      onComplete: (o) => {
        destroyView();
        onBatEnd(o);
      },
    });
  }

  function onBatBall(bb: BattedBall): void {
    const d = DRILLS[step];
    if (d.id === 'contact') {
      progress++;
      if (progress >= 2) {
        passDrill();
        return;
      }
      showNote('In play — one more.');
    } else if (d.id === 'barrel') {
      if (bb.quality === 'barrel') {
        passDrill();
        return;
      }
      showNote(
        bb.quality === 'solid'
          ? 'Solid — a whisker more under centre for the barrel.'
          : bb.launchAngle < 5
            ? 'Chopped down — you caught it above centre. Aim lower on the ball.'
            : 'Contact, but thin. Centre your tap just under the middle.',
      );
    } else {
      showNote('You can hit those — but this drill wants a walk. Lay off.');
    }
    startBatDrill();
  }

  function onBatEnd(o: AtBatOutcome): void {
    const d = DRILLS[step];
    if (o.result === 'walk') {
      if (d.id === 'eye') {
        passDrill();
        return;
      }
      showNote('Ball four — nice eye, but this drill wants swings.');
    } else if (d.id === 'eye') {
      showNote('Struck out — only strikes can ring you up. Take the ones off the plate.');
    } else {
      showNote('Struck out — no harm in the cage. Fresh count.');
    }
    startBatDrill();
  }

  function startPlayDrill(): void {
    const d = DRILLS[step];
    const side = d.id === 'run' ? 'offense' : 'defense';
    setGoal(
      d.id === 'run'
        ? 'Take what’s there — GO for two'
        : d.id === 'fly'
          ? 'Get under the gold ring'
          : 'Glove it, then tap 1ST',
    );

    const sim = new PlaySim({
      battedBall:
        d.id === 'run' ? gapDouble(app.rng) : d.id === 'fly' ? teachingFly(app.rng) : teachingGrounder(app.rng),
      bats: practice.bats,
      attributes: practice.attributes,
      userPosition: DRILL_POSITION[d.id] ?? 'CF',
      userSide: side,
      runnersOn: [false, false, false],
      outs: 0,
      // Practice-squad opposition: slow enough to learn against.
      opponentRating: 25,
      rng: app.rng,
    });

    view = new PlayView(host, {
      sim,
      fieldingKit: side === 'offense' ? theirKit : myKit,
      battingKit: side === 'offense' ? myKit : theirKit,
      crowd: 0.1,
      homeSide: 'fielding',
      onComplete: (out) => {
        destroyView();
        judgePlay(out);
      },
    });
  }

  function judgePlay(out: PlayOutcome): void {
    switch (DRILLS[step].id) {
      case 'run':
        if (out.kind === 'out') {
          failDrill(
            'Thrown out. GO is for when the ball is still rattling around away from your bag — when the line turns red, the race is lost. HOLD, or BACK to the bag you own.',
          );
        } else if (out.batterBase >= 2) {
          passDrill();
        } else {
          passDrill(
            'Safe at first — that works. But that ball rolled deep: next time hit GO while the outfielder is still chasing it and second is yours.',
          );
        }
        return;
      case 'fly':
        if (out.userPutout) passDrill();
        else {
          failDrill(
            'It dropped. Drag to run the moment the ball is up, and plant yourself inside the gold ring before it lands — camp there and the catch is automatic.',
          );
        }
        return;
      default:
        if (out.outs > 0) passDrill();
        else {
          failDrill(
            out.userError
              ? 'It got away. Once it’s in the glove, tap 1ST straight away — holding the ball lets the runner beat the throw.'
              : 'He beat it out. Attack the ball — drag hard to it, glove it, and fire to 1ST the moment it sticks.',
          );
        }
    }
  }

  /* ---------------------------------------------------------------- wiring */

  q(mount, '#exit').addEventListener('click', () => {
    destroyView();
    app.go(returnTo);
  });

  // Skips whatever is live: mid-drill it abandons the attempt, between drills
  // it's hidden and the overlay's own buttons take over.
  skipBtn.addEventListener('click', () => {
    destroyView();
    nextStep();
  });

  syncDots();
  startAmbience();
  showOverlay({
    kicker: 'WELCOME TO THE CAGES',
    title: 'Learn it by doing it',
    body:
      'Six short drills cover everything: hitting, plate discipline, baserunning, and fielding. ' +
      'Nothing here touches your career — swing free. You can skip any drill, or leave any time.',
    cta: 'First Drill',
    onCta: () => {
      hideOverlay();
      showIntro();
    },
  });

  return () => {
    disposed = true;
    clearTimeout(noteTimer);
    stopAmbience();
    destroyView();
    mount.classList.remove('game-screen');
  };
}
