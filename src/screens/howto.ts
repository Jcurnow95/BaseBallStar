import type { App, Route } from '../app';
import { readKey, writeKey } from '../core/storage';
import { q } from '../ui/dom';

/**
 * How to play, one card per thing you actually do: hit, run, field, stretch
 * for a catch, throw. Opens on its own before your first game and lives on
 * the clubhouse screen after that.
 */

const SEEN_KEY = 'baseball-star:howto-seen';

export function howtoSeen(): boolean {
  return readKey(SEEN_KEY) === '1';
}

/** Playing the tutorial teaches everything the cards do, so it counts too. */
export function markHowtoSeen(): void {
  writeKey(SEEN_KEY, '1');
}

/** Where "Play Ball" / "Done" on the last card goes. */
let returnTo: Route = 'hub';

/** Open the how-to, then carry on to `then` when the player is through it. */
export function openHowto(app: App, then: Route): void {
  returnTo = then;
  app.go('howto');
}

interface Card {
  title: string;
  body: string;
  art: string;
}

const CARDS: Card[] = [
  {
    title: 'Hitting',
    body:
      'The ball leaves the pitcher’s hand small and grows as it comes. <b>Tap it as it reaches the plate</b> — ' +
      'when the ring closes on it and the ball <b class="gold">glows gold</b>, that’s your moment. ' +
      'Land a hair <b class="good">under centre</b> for a barrel — that’s your power. Over centre chops it into the dirt. ' +
      'Off the plate? Read the dashed zone and let it go — take the walk. ' +
      'Once your Vision hits 65 the game reads it for you: the gold never comes on a ball and the ring fades away — <b class="info">no gold, no swing</b>.',
    art: `
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <rect x="0" y="0" width="120" height="84" rx="8" fill="#0f1a30"/>
        <rect x="26" y="14" width="68" height="46" fill="none" stroke="rgba(255,255,255,0.28)" stroke-dasharray="4 3" stroke-width="1.5"/>
        <defs>
          <radialGradient id="howto-bb1" cx="0.5" cy="0.5" r="0.5" fx="0.325" fy="0.3">
            <stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f5f3ed"/>
            <stop offset="0.85" stop-color="#ded9cd"/><stop offset="1" stop-color="#b6afa1"/>
          </radialGradient>
        </defs>
        <circle cx="60" cy="40" r="20" fill="url(#howto-bb1)"/>
        <g fill="none" stroke="#c04a3e" stroke-width="1" stroke-linecap="round">
          <path d="M64.81 25.12 A 19 19 0 0 1 64.81 54.88"/>
          <path d="M55.19 54.88 A 19 19 0 0 1 55.19 25.12"/>
        </g>
        <g stroke="#a83228" stroke-width="0.7" stroke-linecap="round">
          <path d="M65.28 27.61 L69.28 27.33 M68.86 32.74 L72.7 33.88 M70.41 38.79 L73.59 41.21 M69.72 45 L71.84 48.38 M66.88 50.57 L67.68 54.49"/>
          <path d="M54.72 52.39 L50.72 52.67 M51.14 47.26 L47.3 46.12 M49.59 41.21 L46.41 38.79 M50.28 35 L48.16 31.62 M53.12 29.43 L52.32 25.51"/>
        </g>
        <circle cx="60" cy="47" r="7.5" fill="none" stroke="#5ce6a0" stroke-width="2" stroke-dasharray="3 2"/>
        <path d="M56 47 h8 M60 43 v8" stroke="#5ce6a0" stroke-width="1.5"/>
        <text x="60" y="76" text-anchor="middle" font-size="7" font-weight="800" fill="#5ce6a0" letter-spacing="1">TAP UNDER CENTRE</text>
      </svg>`,
  },
  {
    title: 'Running the bases',
    body:
      'After contact your man runs on his own — he takes what’s clearly there and stops when it isn’t. ' +
      '<b class="good">GO</b> sends him for the next base; <b class="gold">HOLD</b> pulls him up; ' +
      '<b class="info">BACK</b> turns him round for the bag he left. ' +
      'The dashed line shows the bag you’re headed for. It turns <b class="bad">red</b> when the ball is beating you there — ' +
      'going back is a race too. ' +
      'On base with a teammate up, a <b class="gold">STEAL</b> button flashes up with your odds — ' +
      'Speed sets them, tired legs shave them, and every sprint burns energy and stamina. Pick your moment.',
    art: `
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <rect x="0" y="0" width="120" height="84" rx="8" fill="#1f7a3f"/>
        <path d="M60 70 L92 42 L60 14 L28 42 Z" fill="none" stroke="#b07a45" stroke-width="7" stroke-linejoin="round"/>
        <rect x="88" y="38" width="8" height="8" fill="#f4f6fa"/>
        <rect x="56" y="10" width="8" height="8" fill="#f4f6fa"/>
        <rect x="24" y="38" width="8" height="8" fill="#f4f6fa"/>
        <path d="M60 66 L92 42" stroke="#ffd166" stroke-width="2" stroke-dasharray="4 3"/>
        <circle cx="92" cy="42" r="8" fill="none" stroke="#ffd166" stroke-width="2"/>
        <circle cx="72" cy="57" r="4.5" fill="#5aa9ff" stroke="#fff" stroke-width="1.5"/>
        <rect x="6" y="66" width="30" height="12" rx="4" fill="rgba(255,209,102,0.9)"/>
        <text x="21" y="74.5" text-anchor="middle" font-size="7" font-weight="800" fill="#2a1d00">HOLD</text>
        <rect x="84" y="66" width="30" height="12" rx="4" fill="rgba(53,194,106,0.9)"/>
        <text x="99" y="74.5" text-anchor="middle" font-size="7" font-weight="800" fill="#05210f">GO</text>
      </svg>`,
  },
  {
    title: 'Fielding',
    body:
      'When a ball is hit your way, the field opens up. <b>Drag anywhere</b> on the screen to run — it’s a joystick, wherever you put your thumb. ' +
      'On a fly ball a <b class="gold">gold ring</b> marks where it’s coming down: get under it and the catch is yours. ' +
      'Your Fielding rating is how big your glove is.',
    art: `
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <rect x="0" y="0" width="120" height="84" rx="8" fill="#26924b"/>
        <rect x="0" y="0" width="120" height="26" fill="#1f7a3f"/>
        <rect x="0" y="52" width="120" height="26" fill="#1f7a3f"/>
        <circle cx="78" cy="40" r="10" fill="none" stroke="#ffe178" stroke-width="2" stroke-dasharray="4 3"/>
        <circle cx="78" cy="40" r="1.8" fill="#ffe178"/>
        <ellipse cx="72" cy="30" rx="3" ry="1.5" fill="rgba(0,0,0,0.3)"/>
        <defs>
          <radialGradient id="howto-bb3" cx="0.5" cy="0.5" r="0.5" fx="0.325" fy="0.3">
            <stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f5f3ed"/>
            <stop offset="1" stop-color="#b6afa1"/>
          </radialGradient>
        </defs>
        <circle cx="72" cy="20" r="3.5" fill="url(#howto-bb3)"/>
        <circle cx="46" cy="44" r="4.5" fill="#5aa9ff" stroke="#fff" stroke-width="1.5"/>
        <path d="M52 44 L68 41" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-dasharray="2 2"/>
        <circle cx="26" cy="60" r="12" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.5"/>
        <circle cx="32" cy="56" r="5" fill="rgba(255,255,255,0.5)"/>
        <text x="60" y="78" text-anchor="middle" font-size="7" font-weight="800" fill="#fff" letter-spacing="1">DRAG TO RUN</text>
      </svg>`,
  },
  {
    title: 'The stretch catch',
    body:
      'Reach the ball at the edge of your range and it’s on you: the ball rushes in and you have to <b>tap it as it reaches you</b> — ' +
      '<b class="gold">REACH FOR IT</b> on a fly, <b class="gold">KNOCK IT DOWN</b> on a grounder. ' +
      'Miss and it gets by. Camp under the ring instead and there’s nothing to earn.',
    art: `
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <rect x="0" y="0" width="120" height="84" rx="8" fill="#0b1220"/>
        <text x="60" y="16" text-anchor="middle" font-size="9" font-weight="900" fill="#ffd166" letter-spacing="1.5">REACH FOR IT!</text>
        <circle cx="30" cy="30" r="3" fill="rgba(255,255,255,0.15)"/>
        <circle cx="41" cy="37" r="5" fill="rgba(255,255,255,0.22)"/>
        <circle cx="52" cy="44" r="8" fill="rgba(255,255,255,0.3)"/>
        <defs>
          <radialGradient id="howto-bb4" cx="0.5" cy="0.5" r="0.5" fx="0.325" fy="0.3">
            <stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f5f3ed"/>
            <stop offset="0.85" stop-color="#ded9cd"/><stop offset="1" stop-color="#b6afa1"/>
          </radialGradient>
        </defs>
        <circle cx="66" cy="52" r="15" fill="url(#howto-bb4)"/>
        <g fill="none" stroke="#c04a3e" stroke-width="0.9" stroke-linecap="round">
          <path d="M69.61 40.84 A 14.25 14.25 0 0 1 69.61 63.16"/>
          <path d="M62.39 63.16 A 14.25 14.25 0 0 1 62.39 40.84"/>
        </g>
        <g stroke="#a83228" stroke-width="0.6" stroke-linecap="round">
          <path d="M69.96 42.7 L72.96 42.5 M72.65 46.55 L75.53 47.41 M73.81 51.09 L76.19 52.91 M73.29 55.75 L74.89 58.29 M71.16 59.93 L71.76 62.87"/>
          <path d="M62.04 61.3 L59.04 61.5 M59.35 57.45 L56.47 56.59 M58.19 52.91 L55.81 51.09 M58.71 48.25 L57.11 45.71 M60.84 44.07 L60.24 41.13"/>
        </g>
        <circle cx="66" cy="52" r="20" fill="none" stroke="rgba(80,230,140,0.9)" stroke-width="2" stroke-dasharray="4 3"/>
        <path d="M60 46 l12 12 M72 46 l-12 12" stroke="#ffd166" stroke-width="3" stroke-linecap="round"/>
      </svg>`,
  },
  {
    title: 'Throwing',
    body:
      'Once the ball is in your glove, four buttons come up: <b>HOME · 3RD · 2ND · 1ST</b>. Tap the base you want. ' +
      'Beat the runner there and he’s out. Nobody covering, or you sat on it too long? The throw gets away and everyone moves up. ' +
      'Close to the bag? Just <b>run it there</b> — step on a ringed base before the runner and he’s out, no throw needed. ' +
      'Your Arm rating is how hard you throw.',
    art: `
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <rect x="0" y="0" width="120" height="84" rx="8" fill="#1f7a3f"/>
        <path d="M60 60 L88 36 L60 12 L32 36 Z" fill="none" stroke="#b07a45" stroke-width="6" stroke-linejoin="round"/>
        <circle cx="76" cy="20" r="4.5" fill="#5aa9ff" stroke="#fff" stroke-width="1.5"/>
        <path d="M76 20 Q66 4 34 34" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 2"/>
        <circle cx="34" cy="34" r="2.5" fill="#fff"/>
        <circle cx="46" cy="47" r="4" fill="#ff9d9d" stroke="#fff" stroke-width="1.2"/>
        <g font-size="6.5" font-weight="800" fill="#fff">
          <rect x="4" y="66" width="26" height="12" rx="4" fill="rgba(10,18,32,0.8)"/><text x="17" y="74.5" text-anchor="middle">HOME</text>
          <rect x="33" y="66" width="26" height="12" rx="4" fill="rgba(255,209,102,0.95)"/><text x="46" y="74.5" text-anchor="middle" fill="#2a1d00">3RD</text>
          <rect x="62" y="66" width="26" height="12" rx="4" fill="rgba(10,18,32,0.8)"/><text x="75" y="74.5" text-anchor="middle">2ND</text>
          <rect x="91" y="66" width="26" height="12" rx="4" fill="rgba(10,18,32,0.8)"/><text x="104" y="74.5" text-anchor="middle">1ST</text>
        </g>
      </svg>`,
  },
];

export function renderHowto(app: App, mount: HTMLElement): void {
  let index = 0;
  const then = returnTo;
  returnTo = 'hub';

  mount.innerHTML = `
    <div class="scroll howto">
      <div class="howto-head">
        <span class="tiny muted">HOW TO PLAY</span>
        <div class="howto-dots" id="dots"></div>
      </div>
      <div class="panel howto-card" id="card"></div>
    </div>
    <div class="btn-row howto-nav">
      <button class="btn ghost" id="back">Back</button>
      <button class="btn primary" id="next">Next</button>
    </div>
  `;

  const card = q(mount, '#card');
  const dots = q(mount, '#dots');
  const back = q<HTMLButtonElement>(mount, '#back');
  const next = q<HTMLButtonElement>(mount, '#next');

  const finish = (): void => {
    markHowtoSeen();
    app.go(then);
  };

  const render = (): void => {
    const c = CARDS[index];
    const last = index === CARDS.length - 1;
    card.innerHTML = `
      <div class="howto-art">${c.art}</div>
      <h2>${c.title}</h2>
      <p>${c.body}</p>`;
    dots.innerHTML = CARDS.map((_, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('');
    back.textContent = index === 0 ? 'Skip' : 'Back';
    next.textContent = last ? (then === 'game' ? 'Play Ball' : 'Done') : 'Next';
  };

  back.addEventListener('click', () => {
    if (index === 0) finish();
    else {
      index--;
      render();
    }
  });
  next.addEventListener('click', () => {
    if (index === CARDS.length - 1) finish();
    else {
      index++;
      render();
    }
  });

  render();
}
