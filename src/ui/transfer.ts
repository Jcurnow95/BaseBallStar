import { Capacitor } from '@capacitor/core';
import type { SaveData } from '../core/save';
import { serialiseSave } from '../core/save';

/**
 * Moving a career between devices, as a plain JSON file.
 *
 * Export can't be one mechanism everywhere: a WebView on a phone has no
 * concept of "downloading" a blob, so native platforms go through the system
 * share sheet (AirDrop, Files, mail-it-to-yourself), while browsers and the
 * desktop build get an ordinary file download. Import is a file picker, which
 * every platform does have.
 */

export type ExportResult = 'downloaded' | 'shared' | 'cancelled' | 'failed';

export async function exportSaveFile(save: SaveData): Promise<ExportResult> {
  const json = serialiseSave(save);
  const filename = `baseball-star-${slug(save.player.name)}.json`;

  if (Capacitor.isNativePlatform()) {
    const file = new File([json], filename, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Baseball Star save' });
        return 'shared';
      } catch (err) {
        // Backing out of the share sheet is a choice, not a failure.
        return (err as DOMException)?.name === 'AbortError' ? 'cancelled' : 'failed';
      }
    }
    return 'failed';
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The click only starts the download; revoking immediately can cut it off.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

const slug = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'player';

/**
 * Ask the player for a save file and hand back its text. Resolves null when
 * the picker is dismissed — though engines without a `cancel` event just
 * leave the promise hanging, which is harmless here.
 */
export function pickSaveFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
