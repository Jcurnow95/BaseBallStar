import './style.css';
import { App } from './app';
import { unlockAudio } from './ui/audio';
import { initNative } from './ui/native';
import { renderTitle } from './screens/title';
import { renderCreate } from './screens/create';
import { renderHub } from './screens/hub';
import { renderTraining } from './screens/training';
import { renderGame } from './screens/game';
import { renderPostGame } from './screens/postgame';
import { renderSeasonEnd } from './screens/seasonEnd';
import { renderStandings } from './screens/standings';
import { renderStore } from './screens/store';
import { renderHowto } from './screens/howto';
import { renderTutorial } from './screens/tutorial';
import { renderDerby } from './screens/derby';
import { devMenuEnabled, renderDev } from './screens/dev';

const root = document.getElementById('app');
if (!root) throw new Error('#app mount point missing');

const app = new App(root);
app.register('title', renderTitle);
app.register('create', renderCreate);
app.register('hub', renderHub);
app.register('training', renderTraining);
app.register('game', renderGame);
app.register('postgame', renderPostGame);
app.register('seasonEnd', renderSeasonEnd);
app.register('standings', renderStandings);
app.register('store', renderStore);
app.register('howto', renderHowto);
app.register('tutorial', renderTutorial);
app.register('derby', renderDerby);
if (devMenuEnabled()) app.register('dev', renderDev);
app.start();

// No-op in the browser; wires up back button, status bar and splash on device.
initNative(app);

// Audio can't start until the user has touched the page. Capture phase, so it
// runs before anything calls preventDefault on the way down.
document.addEventListener('pointerdown', unlockAudio, { capture: true });

// Phones fire a resize when the address bar hides; keep the layout honest.
window.addEventListener('resize', () => {
  document.documentElement.style.setProperty('--vh', `${window.innerHeight}px`);
});

// Block the browser's pinch-zoom / double-tap-zoom so taps stay precise.
document.addEventListener(
  'gesturestart',
  (e) => {
    e.preventDefault();
  },
  { passive: false },
);
