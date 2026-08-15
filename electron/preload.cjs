// CommonJS on purpose: sandboxed preload scripts are not loaded through Node's
// ESM loader, so this cannot be a .js module alongside "type": "module".
const { contextBridge, ipcRenderer } = require('electron');

/**
 * A tiny synchronous key/value store backed by a real file in the app's
 * user-data folder.
 *
 * The game saves careers through a synchronous API, and Chromium will not
 * reliably persist localStorage for a custom `app://` origin between runs —
 * values are written to disk but come back empty on the next launch, which
 * would quietly wipe a career on every quit. `sendSync` keeps the existing
 * synchronous shape while putting the data somewhere it actually survives.
 */
contextBridge.exposeInMainWorld('desktopStore', {
  get: (key) => ipcRenderer.sendSync('store:get', key),
  set: (key, value) => ipcRenderer.sendSync('store:set', key, value),
  remove: (key) => ipcRenderer.sendSync('store:remove', key),
});
