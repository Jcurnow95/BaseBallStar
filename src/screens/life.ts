/**
 * Life off the field: where you live, what you drive, how famous you are and
 * who pays for it — and, as the career grows, who is in your corner and
 * what you leave behind. See `core/lifestyle.ts` for the rules; this screen
 * only spends money and shows what it bought.
 */
import type { App } from '../app';
import { SLOT_LABELS, formatMoney, gearById } from '../core/gear';
import type { GearSlot } from '../core/gear';
import {
  HOMES,
  SPONSORS,
  TOYS,
  availableDeals,
  buyHome,
  buyToy,
  dealPayPerGame,
  fameBonusMult,
  fameCrowdBoost,
  fameLabel,
  gameStaminaGuard,
  homeById,
  homeUpgrades,
  overnightEnergyBonus,
  ownsToy,
  signDeal,
  sponsorById,
  upkeepPerGame,
} from '../core/lifestyle';
import { lifestyleOf } from '../core/save';
import { esc, meterHtml, q, qa } from '../ui/dom';
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
    const dealPay = dealPayPerGame(life);

    // What the whole set-up is doing for you, in one strip.
    const perksHtml = `
      <div class="statline" style="margin-top:12px">
        <div><b>${formatMoney(dealPay)}</b><span>Deals / game</span></div>
        <div><b>${formatMoney(upkeep)}</b><span>Upkeep / game</span></div>
        <div><b>+${rest}</b><span>Energy / night</span></div>
        <div><b>−${guard}</b><span>Stamina wear</span></div>
      </div>`;

    // ---- Fame: the meter and what it is buying right now.
    const crowdPct = Math.round(fameCrowdBoost(life.fame) * 100);
    const bonusPct = Math.round((fameBonusMult(life.fame) - 1) * 100);
    const fameHtml = `
      ${meterHtml(`Fame · ${fameLabel(life.fame)}`, life.fame, 100, 'fame', 'big')}
      <div class="statline" style="margin-top:12px">
        <div><b>+${crowdPct}%</b><span>Stands filled</span></div>
        <div><b>+${bonusPct}%</b><span>Bonus money</span></div>
        <div><b>${SPONSORS.filter((s) => life.fame >= s.minFame).length}</b><span>Brands calling</span></div>
        <div><b>${life.deals.length}</b><span>Deals live</span></div>
      </div>
      <p class="tiny muted" style="margin:10px 0 0">
        Home runs, walk-offs, October and the world stage make a name. Honours at the end of a year
        add to it; a winter takes a tenth of it back. The bigger brands only call an agent.
      </p>`;

    // ---- Endorsements: what's running, and what's on the table.
    const activeHtml = life.deals
      .map((deal) => {
        const def = sponsorById(deal.id);
        if (!def) return '';
        const item = gearById(def.gearId);
        return `
          <div class="kit-row">
            <span class="slot">${SLOT_LABELS[def.slot]}</span>
            <span class="what">
              <strong>${esc(def.brand)}</strong>
              <i class="tiny">${formatMoney(def.payPerGame)} a game · supplies the ${esc(item?.name ?? 'kit')}</i>
            </span>
            <span class="left ${deal.gamesLeft <= 2 ? 'low' : ''}">${deal.gamesLeft}<i>games</i></span>
          </div>`;
      })
      .join('');
    const offers = availableDeals(life, false);
    const offersHtml = offers
      .map((s) => {
        const item = gearById(s.gearId);
        return `
          <div class="gear-card">
            <div class="info">
              <strong>${esc(s.brand)} · ${SLOT_LABELS[s.slot]}</strong>
              <span>${esc(s.blurb)}</span>
              <span class="gear-bonus">${formatMoney(s.payPerGame)} a game for ${s.games} games · free ${esc(item?.name ?? 'kit')}</span>
            </div>
            <button class="buy" data-deal="${s.id}">Sign</button>
          </div>`;
      })
      .join('');
    // What's still out of reach, so the meter has something to point at.
    const nextBrand = SPONSORS.filter((s) => life.fame < s.minFame).sort(
      (a, b) => a.minFame - b.minFame,
    )[0];

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
              <span>${esc(player.name)} · ${esc(home.name)} · ${esc(fameLabel(life.fame))}</span>
            </div>
            <div class="ovr money"><b>${formatMoney(player.money)}</b><span>BANK</span></div>
          </div>
          ${perksHtml}
          <p class="tiny muted" style="margin:10px 0 0">
            Deals pay and upkeep bills out of every game cheque. A better home sends you to the park
            with more energy; the best ones take some of the grind out of the schedule.
          </p>
        </div>

        <div class="panel">
          <h2>Fame</h2>
          ${fameHtml}
        </div>

        <div class="panel">
          <h2>Endorsements</h2>
          ${activeHtml || '<p class="tiny muted" style="margin:0 0 8px">No deals running.</p>'}
          ${offersHtml ? `<div style="margin-top:10px">${offersHtml}</div>` : ''}
          <p class="tiny muted" style="margin:10px 0 0">
            ${
              offers.length > 0
                ? 'A sponsor hands you their kit free, replaces it when it wears out, and pays a cheque every game. Their slot is theirs for the length of the deal.'
                : nextBrand
                  ? `Nobody is calling right now. ${esc(nextBrand.brand)} starts paying attention at ${nextBrand.minFame} fame${nextBrand.needsAgent ? ', through an agent' : ''}.`
                  : 'Every brand in the game has your number.'
            }
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

    for (const button of qa<HTMLButtonElement>(mount, '[data-deal]')) {
      button.addEventListener('click', async () => {
        const def = sponsorById(button.dataset.deal!);
        const item = def ? gearById(def.gearId) : undefined;
        if (!def || !item) return;
        const current = player.gear[def.slot as GearSlot];
        const currentDef = current ? gearById(current.id) : undefined;
        const ok = await showDialog({
          title: `Sign with ${def.brand}?`,
          body:
            `${formatMoney(def.payPerGame)} a game for ${def.games} games, and they supply the ${item.name} ` +
            `for as long as it runs. Nothing else goes in your ${SLOT_LABELS[def.slot].toLowerCase()} slot until then.` +
            (current && currentDef && current.gamesLeft > 0
              ? `\n\nYour ${currentDef.name} still has ${current.gamesLeft} game${current.gamesLeft === 1 ? '' : 's'} left. It goes in the bin.`
              : ''),
          confirmLabel: 'Sign',
          cancelLabel: 'Pass',
        });
        if (!ok) return;
        if (!signDeal(life, def.id)) return;
        player.gear[def.slot as GearSlot] = { id: item.id, gamesLeft: item.games };
        app.persist();
        draw();
      });
    }

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
