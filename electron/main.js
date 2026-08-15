import { app, BrowserWindow, Menu, ipcMain, protocol, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

/**
 * Desktop shell for the game.
 *
 * The one non-obvious decision here is that the page is served over a custom
 * `app://` scheme rather than loaded from disk with `file://`. Two things in
 * this game break under `file://`:
 *
 * - `ui/audio.ts` loads every clip with `fetch()` before decoding it, and
 *   Chromium blocks `fetch` on `file://` outright. The whole soundtrack would
 *   be silent.
 * - `core/save.ts` keeps careers in `localStorage`, which `file://` treats as
 *   an opaque origin. Saves would not survive a restart.
 *
 * Registering a proper scheme fixes both, because the page then has a real,
 * stable, secure origin.
 */

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

/**
 * Serve a file from dist/, honouring Range requests.
 *
 * The range handling is not optional padding. Handing an <audio> element a
 * body with no Content-Length and no range support leaves it unable to work
 * out the track's duration, which reports as NaN and stops `loop` working —
 * so the seven-minute crowd bed would play once and fall silent. Media
 * elements ask for ranges; this answers them.
 */
async function serveFile(target, rangeHeader) {
  let stat;
  try {
    stat = await fs.promises.stat(target);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });

  const type = MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
  const match = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

  if (match) {
    const hasStart = match[1] !== '';
    let start = hasStart ? Number(match[1]) : 0;
    let end = match[2] === '' ? stat.size - 1 : Number(match[2]);

    // "bytes=-500" means the final 500 bytes, not a range beginning at zero.
    if (!hasStart) {
      start = Math.max(0, stat.size - Number(match[2] || 0));
      end = stat.size - 1;
    }
    end = Math.min(end, stat.size - 1);

    if (start > end || start >= stat.size) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${stat.size}` },
      });
    }

    return new Response(Readable.toWeb(fs.createReadStream(target, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  return new Response(Readable.toWeb(fs.createReadStream(target)), {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
    },
  });
}

// Must happen before `app.whenReady()`. `supportFetchAPI` is what makes the
// audio loader work; `stream` is what lets the seven-minute crowd bed play
// through an <audio> element instead of buffering the whole file first.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/**
 * Career saves and settings, as a JSON file in the user-data folder.
 *
 * Not localStorage: Chromium writes it to disk for an `app://` origin but
 * comes back empty on the next launch, so a career would vanish on quit. This
 * also means saves live outside the app folder, and survive reinstalling or
 * moving the portable exe.
 */
const STORE_FILE = () => path.join(app.getPath('userData'), 'store.json');

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE(), 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(data) {
  const file = STORE_FILE();
  const temp = `${file}.tmp`;
  // Write-then-rename, so a crash mid-write can't leave a truncated save.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(data), 'utf8');
  fs.renameSync(temp, file);
}

function registerStoreHandlers() {
  ipcMain.on('store:get', (event, key) => {
    const value = readStore()[key];
    event.returnValue = typeof value === 'string' ? value : null;
  });

  ipcMain.on('store:set', (event, key, value) => {
    try {
      const data = readStore();
      data[key] = String(value);
      writeStore(data);
      event.returnValue = true;
    } catch {
      event.returnValue = false;
    }
  });

  ipcMain.on('store:remove', (event, key) => {
    try {
      const data = readStore();
      delete data[key];
      writeStore(data);
      event.returnValue = true;
    } catch {
      event.returnValue = false;
    }
  });
}

function createWindow() {
  // The game is a portrait phone layout that caps itself at 520px wide, so a
  // tall narrow window is the shape that actually fits it. Height is clamped
  // to the work area so it doesn't open taller than the screen on a laptop.
  const { height: availableHeight } = screen.getPrimaryDisplay().workAreaSize;
  const height = Math.min(900, availableHeight - 60);

  const win = new BrowserWindow({
    width: 500,
    height,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#05080f',
    // Wait for the first paint, so launching doesn't flash an empty frame.
    show: false,
    title: 'Baseball Star',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
    },
  });

  win.once('ready-to-show', () => win.show());
  void win.loadURL('app://local/index.html');

  // The game never links out. Anything trying to navigate or open a window is
  // handed to the real browser rather than replacing the game in its own frame.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== 'app://local') {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  return win;
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const decoded = decodeURIComponent(pathname);

    // Resolve inside dist/ and confirm it stayed there, so a crafted path
    // can't read files from elsewhere on the machine.
    const target = path.join(DIST, path.normalize(decoded));
    if (target !== DIST && !target.startsWith(DIST + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    return serveFile(target, request.headers.get('Range'));
  });

  registerStoreHandlers();

  // No File/Edit/View menu — this is a game, not a document editor.
  Menu.setApplicationMenu(null);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
