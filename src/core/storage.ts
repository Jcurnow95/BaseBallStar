/**
 * Where the game keeps anything that has to outlive the session — careers and
 * settings.
 *
 * In a browser and on phones that's `localStorage`. In the desktop build it
 * isn't: the page is served from a custom `app://` origin, and Chromium won't
 * reliably persist localStorage for one. Values get written to disk and then
 * read back empty on the next launch, which would wipe a career every time the
 * game was closed. The Electron shell exposes a file-backed store instead, and
 * this picks whichever is actually available.
 *
 * Both paths are synchronous and both swallow failures, so callers can treat
 * storage as best-effort the way `localStorage` already behaves in private
 * browsing modes.
 */

interface DesktopStore {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): boolean;
}

declare global {
  interface Window {
    desktopStore?: DesktopStore;
  }
}

const desktop = (): DesktopStore | undefined =>
  typeof window === 'undefined' ? undefined : window.desktopStore;

export function readKey(key: string): string | null {
  const store = desktop();
  if (store) {
    try {
      return store.get(key);
    } catch {
      return null;
    }
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeKey(key: string, value: string): void {
  const store = desktop();
  if (store) {
    try {
      store.set(key, value);
    } catch {
      /* disk full or locked; the game plays on regardless */
    }
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable in private modes */
  }
}

export function removeKey(key: string): void {
  const store = desktop();
  if (store) {
    try {
      store.remove(key);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
