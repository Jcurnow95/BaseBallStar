import type { App } from '../app';
import { q } from '../ui/dom';
import { showDialog } from '../ui/modal';
import { openHowto } from './howto';
import { openTutorial } from './tutorial';

export function renderTitle(app: App, mount: HTMLElement): void {
  const hasSave = !!app.save;

  mount.innerHTML = `
    <div class="scroll">
      <div class="brand">
        <h1>BASEBALL<span>STAR</span></h1>
        <p>Build a player. Ride the buses. Make The Show.</p>
      </div>

      <div class="panel">
        <h2>How it plays</h2>
        <p class="tiny muted" style="margin:0 0 8px">
          You play only your own moments — every plate appearance and every ball hit your way.
          The rest of the game simulates around you.
        </p>
        <p class="tiny muted" style="margin:0 0 8px">
          <b style="color:var(--text)">At the plate:</b> the ball leaves the hand small and breaks late.
          Tap it. Tapping slightly <b style="color:var(--accent)">under center</b> is a barrel — that's your
          home run. Above center tops it into the dirt. Let bad pitches go and take the walk.
        </p>
        <p class="tiny muted" style="margin:0">
          <b style="color:var(--text)">In the field:</b> get your glove on the ball before it lands.
        </p>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn ghost tiny" id="tutorial">Play the Tutorial</button>
          <button class="btn ghost tiny" id="howto">How to Play</button>
        </div>
      </div>

      <div class="panel">
        <h2>Attributes matter</h2>
        <p class="tiny muted" style="margin:0">
          Contact widens your margin for error on the ball. Power turns good contact into extra bases.
          Vision reads the pitch out of the hand. Stamina keeps the sweet spot from shrinking over a
          long season — train it or pay for it in September.
        </p>
      </div>
    </div>

    <button class="btn primary" id="new">${hasSave ? 'New Career' : 'Start Your Career'}</button>
    ${hasSave ? '<button class="btn ghost" id="continue">Continue Career</button>' : ''}
  `;

  q(mount, '#new').addEventListener('click', async () => {
    if (app.save) {
      const ok = await showDialog({
        title: 'Start over?',
        body: 'Creating a new player erases your current career save. This cannot be undone.',
        confirmLabel: 'Erase & Create',
        cancelLabel: 'Keep Career',
        danger: true,
      });
      if (!ok) return;
    }
    app.go('create');
  });

  if (hasSave) {
    q(mount, '#continue').addEventListener('click', () => app.go('hub'));
  }

  q(mount, '#howto').addEventListener('click', () => openHowto(app, 'title'));
  q(mount, '#tutorial').addEventListener('click', () => openTutorial(app, 'title'));
}
