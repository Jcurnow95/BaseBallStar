/**
 * Life off the field: where you live, what you drive, and — as the career
 * grows — who is in your corner and what you leave behind. See
 * `core/lifestyle.ts` for the rules; this screen only spends money and
 * shows what it bought.
 */
import type { App } from '../app';
import { formatMoney } from '../core/gear';
import {
  HOMES,
  TOYS,
  buyHome,
  buyToy,
  gameStaminaGuard,
  homeById,
  homeUpgrades,
  overnightEnergyBonus,
  ownsToy,
  upkeepPerGame,
} from '../core/lifestyle';
import { lifestyleOf } from '../core/save';
import { esc, q, qa } from '../ui/dom';
import { showDialog } from '../ui/modal';

export function renderLife(app: App, mount: HTMLElement): void {
  const save = app.requireSave();
  const { player } = save;
  const life = lifestyleOf(save);

  const draw = (): void => {
    const scrollTop = mount.querySelector('.scroll')?.scrollTop ?? 0;
    const home = homeById(life.home);
    const upkeep = upkeepPerGame(life);
    const rest = overnightEnergyBonus(life);
    const guard = gameStaminaGuard(life);

    // What the whole set-up is doing for you, in one strip.
    const perksHtml = `
      <div class="statline" style="margin-top:12px">
        <div><b>${formatMoney(upkeep)}</b><span>Upkeep / game</span></div>
        <div><b>+${rest}</b><span>Energy / night</span></div>
        <div><b>−${guard}</b><span>Stamina wear</span></div>
        <div><b>${life.toys.length}</b><span>Toys</span></div>
      </div>`;

    const homeHtml = `
      <div class="gear-card on">
        <div class="info">
          <strong>🏠 ${esc(home.name)}</strong>
          <span>${esc(home.blurb)}</span>
          <span class="gear-bonus">${
            home.upkeep > 0 ? `${formatMoney(home.upkeep)} a game` : 'The club pays'
          } · +${home.restEnergy} energy a night${
            home.staminaGuard > 0 ? ` · games wear you ${home.staminaGuard} less` : ''
          }${home.trophyRoom ? ' · trophy room' : ''}</span>
        </div>
      </div>
      ${homeUpgrades(life)
        .map((h) => {
          const affordable = player.money >= h.price;
          return `
          <div class="gear-card">
            <div class="info">
              <strong>${esc(h.name)}</strong>
              <span>${esc(h.blurb)}</span>
              <span class="gear-bonus">${formatMoney(h.upkeep)} a game · +${h.restEnergy} energy a night${
                h.staminaGuard > 0 ? ` · games wear you ${h.staminaGuard} less` : ''
              }${h.trophyRoom ? ' · trophy room' : ''}</span>
            </div>
            <button class="buy" data-home="${h.id}" ${affordable ? '' : 'disabled'}>${formatMoney(h.price)}</button>
          </div>`;
        })
        .join('')}`;

    const toysHtml = TOYS.map((t) => {
      const owned = ownsToy(life, t.id);
      const affordable = player.money >= t.price;
      return `
        <div class="gear-card ${owned ? 'on' : ''}">
          <div class="info">
            <strong>${t.icon} ${esc(t.name)}</strong>
            <span>${esc(t.blurb)}</span>
            <span class="gear-bonus">${esc(t.perk)} · ${formatMoney(t.upkeep)} a game</span>
          </div>
          ${
            owned
              ? '<button class="buy" disabled>Yours</button>'
              : `<button class="buy" data-toy="${t.id}" ${affordable ? '' : 'disabled'}>${formatMoney(t.price)}</button>`
          }
        </div>`;
    }).join('');

    mount.innerHTML = `
      <div class="scroll">
        <div class="panel">
          <div class="hub-head">
            <div class="badge">🏠</div>
            <div class="who">
              <strong>Life Off the Field</strong>
              <span>${esc(player.name)} · ${esc(home.name)}</span>
            </div>
            <div class="ovr money"><b>${formatMoney(player.money)}</b><span>BANK</span></div>
          </div>
          ${perksHtml}
          <p class="tiny muted" style="margin:10px 0 0">
            Upkeep comes out of every game cheque. A better home sends you to the park with more
            energy; the best ones take some of the grind out of the schedule.
          </p>
        </div>

        <div class="panel">
          <h2>Home</h2>
          ${homeHtml}
          <p class="tiny muted" style="margin:10px 0 0">
            You only ever move up. ${HOMES[HOMES.length - 1].id === life.home ? 'And you have.' : 'Buy a house and the trophies come out of the box.'}
          </p>
        </div>

        <div class="panel">
          <h2>Garage &amp; toys</h2>
          ${toysHtml}
        </div>

        <div class="panel">
          <h2>Lately</h2>
          ${
            life.log.length > 0
              ? life.log.map((line) => `<div class="reward"><span>${esc(line)}</span></div>`).join('')
              : '<p class="tiny muted" style="margin:0">Nothing yet. Play some ball, buy some things.</p>'
          }
        </div>
      </div>

      <button class="btn primary" id="done">Back to Clubhouse</button>
    `;
    q(mount, '.scroll').scrollTop = scrollTop;

    for (const button of qa<HTMLButtonElement>(mount, '[data-home]')) {
      button.addEventListener('click', async () => {
        const target = homeById(button.dataset.home as (typeof HOMES)[number]['id']);
        const ok = await showDialog({
          title: `Move into the ${target.name}?`,
          body:
            `${formatMoney(target.price)} now, then ${formatMoney(target.upkeep)} out of every game cheque. ` +
            `You'll wake up with ${target.restEnergy} more energy every night.`,
          confirmLabel: 'Sign the papers',
          cancelLabel: 'Not yet',
        });
        if (!ok) return;
        if (buyHome(player, life, target.id)) {
          app.persist();
          draw();
        }
      });
    }

    for (const button of qa<HTMLButtonElement>(mount, '[data-toy]')) {
      button.addEventListener('click', async () => {
        const id = button.dataset.toy!;
        const toy = TOYS.find((t) => t.id === id);
        if (!toy) return;
        const ok = await showDialog({
          title: `Buy the ${toy.name}?`,
          body: `${formatMoney(toy.price)} now, then ${formatMoney(toy.upkeep)} a game to keep it. ${toy.perk}`,
          confirmLabel: 'Buy it',
          cancelLabel: 'Walk away',
        });
        if (!ok) return;
        if (buyToy(player, life, id)) {
          app.persist();
          draw();
        }
      });
    }

    q(mount, '#done').addEventListener('click', () => app.go('hub'));
  };

  draw();
}
