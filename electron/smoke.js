/**
 * Throwaway harness: boots the real main process, then interrogates the live
 * window. Imports `./main.js` rather than reimplementing it, so this exercises
 * the shipping protocol handler and window config.
 *
 *   npx electron electron/smoke.js
 */
import { app, BrowserWindow } from 'electron';
import './main.js';

const errors = [];

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 1200));
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`load failed ${code} ${desc}`));

  await new Promise((r) => setTimeout(r, 2500));

  const result = await win.webContents.executeJavaScript(`(async () => {
    const out = { origin: location.origin, href: location.href, title: document.title };

    // Did the game actually render?
    out.appMounted = !!document.querySelector('#app');
    out.buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).slice(0,3);

    // Saves live here; file:// would make this an opaque origin and lose them.
    try {
      localStorage.setItem('__smoke','1');
      out.localStorage = localStorage.getItem('__smoke') === '1';
      localStorage.removeItem('__smoke');
    } catch (e) { out.localStorage = 'THREW: ' + e.message; }

    // The exact call the audio loader makes. Blocked under file://.
    try {
      const res = await fetch(new URL('audio/whiff-1.mp3', document.baseURI).href);
      const buf = await res.arrayBuffer();
      out.audioFetch = { ok: res.ok, status: res.status, bytes: buf.byteLength };
      const ac = new AudioContext();
      const decoded = await ac.decodeAudioData(buf);
      out.audioDecode = { channels: decoded.numberOfChannels, duration: +decoded.duration.toFixed(2) };
    } catch (e) { out.audioFetch = 'THREW: ' + e.message; }

    // The streamed crowd bed, which needs the 'stream' privilege.
    try {
      const el = new Audio(new URL('audio/crowd-ambience-long.mp3', document.baseURI).href);
      await new Promise((res, rej) => {
        el.addEventListener('loadedmetadata', res, { once: true });
        el.addEventListener('error', () => rej(new Error('media error')), { once: true });
        setTimeout(() => rej(new Error('timeout')), 8000);
      });
      out.ambience = { duration: +el.duration.toFixed(1) };
    } catch (e) { out.ambience = 'THREW: ' + e.message; }

    return out;
  })()`);

  console.log('SMOKE_RESULT:' + JSON.stringify({ ...result, rendererErrors: errors }));
  app.exit(0);
});
