import type { App } from '../app';
import type { GearDefinition, GearSlot } from '../core/gear';
import {
  GEAR_SLOTS,
  SLOT_LABELS,
  contractById,
  contractSalary,
  formatMoney,
  gearById,
  gearForSlot,
} from '../core/gear';
import { ATTRIBUTE_LABELS } from '../core/player';
import { LEVELS } from '../core/league';
import type { Attributes } from '../core/types';
import { esc, q, qa } from '../ui/dom';
import { showDialog } from '../ui/modal';

const bonusText = (bonuses: Partial<Attributes>): string =>
  (Object.entries(bonuses) as [keyof Attributes, number][])
    .map(([key, value]) => `+${value} ${ATTRIBUTE_LABELS[key]}`)
    .join(' · ');

export function renderStore(app: App, mount: HTMLElement): void {
  const save = app.requireSave();
  const { player, league } = save;
  const offer = contractById(player.contract);

  const draw = (): void => {
    const equippedHtml = GEAR_SLOTS.map((slot) => {
      const owned = player.gear[slot];
      const def = owned ? gearById(owned.id) : undefined;
      if (!owned || !def) {
        return `
          <div class="kit-row empty">
            <span class="slot">${SLOT_LABELS[slot]}</span>
            <span class="what muted">Nothing equipped</span>
          </div>`;
      }
      const pct = Math.max(0, Math.min(100, (owned.gamesLeft / def.games) * 100));
      const low = owned.gamesLeft <= 2;
      return `
        <div class="kit-row">
          <span class="slot">${SLOT_LABELS[slot]}</span>
          <span class="what">
            <strong>${esc(def.name)}</strong>
            <i class="tiny">${esc(bonusText(def.bonuses))}</i>
            <span class="wear"><i style="width:${pct}%" class="${low ? 'low' : ''}"></i></span>
          </span>
          <span class="left ${low ? 'low' : ''}">${owned.gamesLeft}<i>games</i></span>
        </div>`;
    }).join('');

    const shelfHtml = GEAR_SLOTS.map(
      (slot) => `
      <div class="panel">
        <h2>${SLOT_LABELS[slot]}</h2>
        ${gearForSlot(slot)
          .map((def) => {
            const equipped = player.gear[slot]?.id === def.id;
            const affordable = player.money >= def.price;
            return `
            <div class="gear-card ${equipped ? 'on' : ''}" data-gear="${def.id}">
              <div class="info">
                <strong>${esc(def.name)}</strong>
                <span>${esc(def.blurb)}</span>
                <span class="gear-bonus">${esc(bonusText(def.bonuses))} · lasts ${def.games} games</span>
              </div>
              <button class="buy" data-buy="${def.id}" ${equipped || !affordable ? 'disabled' : ''}>
                ${equipped ? 'Worn' : formatMoney(def.price)}
              </button>
            </div>`;
          })
          .join('')}
      </div>`,
    ).join('');

    mount.innerHTML = `
      <div class="scroll">
        <div class="panel">
          <div class="hub-head">
            <div class="badge">$</div>
            <div class="who">
              <strong>Gear Store</strong>
              <span>${esc(offer.name)} · ${formatMoney(contractSalary(league.levelId, player.contract))} a game</span>
              <span class="tiny muted">${esc(LEVELS[league.levelId].name)} · bonuses ×${offer.bonusMult}</span>
            </div>
            <div class="ovr money"><b>${formatMoney(player.money)}</b><span>BANK</span></div>
          </div>
        </div>

        <div class="panel">
          <h2>In your bag</h2>
          ${equippedHtml}
          <p class="tiny muted" style="margin:10px 0 0">
            Gear wears out a game at a time and lifts your attributes while it lasts.
            It does not count toward the overall rating the front office grades you on.
          </p>
        </div>

        ${shelfHtml}
      </div>

      <button class="btn primary" id="done">Back to Clubhouse</button>
    `;

    for (const button of qa<HTMLButtonElement>(mount, '.buy')) {
      button.addEventListener('click', async () => {
        const def = gearById(button.dataset.buy!);
        if (!def) return;
        if (player.money < def.price) return;

        // Replacing something with life left in it throws that life away.
        const current = player.gear[def.slot as GearSlot];
        if (current && current.gamesLeft > 0) {
          const old = gearById(current.id);
          const ok = await showDialog({
            title: `Replace your ${SLOT_LABELS[def.slot].toLowerCase()}?`,
            body:
              `${old ? old.name : 'What you have'} still has ${current.gamesLeft} game` +
              `${current.gamesLeft === 1 ? '' : 's'} left in it. Buying the ${def.name} throws it out.`,
            confirmLabel: 'Buy anyway',
            cancelLabel: 'Keep it',
          });
          if (!ok) return;
        }

        player.money -= def.price;
        player.gear[def.slot as GearSlot] = { id: def.id, gamesLeft: def.games };
        app.persist();
        draw();
      });
    }

    q(mount, '#done').addEventListener('click', () => app.go('hub'));
  };

  draw();
}

export type { GearDefinition };
