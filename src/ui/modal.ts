import { esc } from './dom';

/**
 * In-app dialog. Native alert()/confirm() block the JS thread and render as
 * system chrome inside a WebView, which breaks the illusion on device.
 */
export interface DialogOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  /** Omit for a single-button acknowledgement. */
  cancelLabel?: string;
  danger?: boolean;
}

export function showDialog(options: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${esc(options.title)}</h3>
        <p>${esc(options.body).replace(/\n/g, '<br/>')}</p>
        <div class="btn-row">
          ${options.cancelLabel ? `<button class="btn ghost" data-act="cancel">${esc(options.cancelLabel)}</button>` : ''}
          <button class="btn ${options.danger ? '' : 'primary'}" data-act="ok">${esc(
            options.confirmLabel ?? 'OK',
          )}</button>
        </div>
      </div>`;

    const close = (result: boolean): void => {
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 160);
      resolve(result);
    };

    backdrop.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const act = target.dataset.act;
      if (act === 'ok') close(true);
      else if (act === 'cancel' || target === backdrop) close(false);
    });

    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('show'));
  });
}
