import { readKey, writeKey } from '../core/storage';
import { esc } from '../ui/dom';

/**
 * One-line coaching, the first time each kind of moment comes up: how to
 * swing, how to run a ball down, what GO and HOLD do. Shown over the play
 * surface and gone on the first touch or after a few seconds. Each tip shows
 * once per install, not once per career — a second career doesn't need it.
 */

export type TipId = 'bat' | 'field' | 'run';

const KEY = 'baseball-star:tips-seen';

function seenTips(): Set<string> {
  try {
    const raw = readKey(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function markTipSeen(id: TipId): void {
  const seen = seenTips();
  seen.add(id);
  writeKey(KEY, JSON.stringify([...seen]));
}

/** Forget every tip, so they all show again. For the dev menu and the how-to. */
export function resetTips(): void {
  writeKey(KEY, '[]');
}

/**
 * Put a tip up over `host` if it hasn't been shown before. `host` is the
 * element the play view lives in; the tip is appended after the view so the
 * view's own teardown takes it away too.
 */
export function showCoachTip(host: HTMLElement, id: TipId, text: string, ms = 6000): void {
  if (seenTips().has(id)) return;
  markTipSeen(id);

  const el = document.createElement('div');
  el.className = 'coach-tip';
  el.innerHTML = `<span class="who">Coach</span>${esc(text)}`;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  let gone = false;
  const dismiss = (): void => {
    if (gone) return;
    gone = true;
    host.removeEventListener('pointerdown', dismiss, true);
    el.classList.remove('show');
    window.setTimeout(() => el.remove(), 260);
  };
  // Capture phase, so the play view's own handler still gets the touch.
  host.addEventListener('pointerdown', dismiss, { capture: true });
  window.setTimeout(dismiss, ms);
}
