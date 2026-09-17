/**
 * Life off the field: where you live, what you drive, how famous you are and
 * who pays for it, who is in your corner — and, as the career grows, what
 * you leave behind. See `core/lifestyle.ts` for the rules; this screen only
 * spends money and shows what it bought.
 */
import type { App } from '../app';
import { CONTRACTS, SLOT_LABELS, contractSalary, formatMoney, gearById } from '../core/gear';
import type { ContractStyle, GearSlot } from '../core/gear';
import {
  AGENTS,
  HOMES,
  SPONSORS,
  TOYS,
  acceptRequest,
  agentOf,
  agentTier,
  availableDeals,
  buyHome,
  buyToy,
  dealPayPerGame,
  declineRequest,
  fameBonusMult,
  fameCrowdBoost,
  fameLabel,
  fireAgent,
  fundProject,
  gameStaminaGuard,
  hasProject,
  hasTrophyRoom,
  hireAgent,
  homeById,
  homeUpgrades,
  moraleEnergyBonus,
  nationStrengthBonus,
  overnightEnergyBonus,
  ownsToy,
  PROJECTS,
  projectById,
  signDeal,
  sponsorById,
  teammateBoost,
  toyById,
  upkeepPerGame,
} from '../core/lifestyle';
import { lifestyleOf } from '../core/save';
import { TROPHIES } from '../core/trophies';
import { mvpSeasons } from '../core/awards';
import { LEVELS } from '../core/league';
import { nationById } from '../core/nations';
import { esc, meterHtml, q, qa } from '../ui/dom';
import { showDialog, wireHints } from '../ui/modal';
import { HINTS } from '../ui/hints';

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

export function renderLife(app: App, mount: HTMLElement): void {
  const save = app.requireSave();
  const { player, league } = save;
  const life = lifestyleOf(save);

  const draw = (): void => {
    const scrollTop = mount.querySelector('.scroll')?.scrollTop ?? 0;
    const home = homeById(life.home);
    const upkeep = upkeepPerGame(life);
    const rest = overnightEnergyBonus(life);
    const guard = gameStaminaGuard(life);
    const dealPay = dealPayPerGame(life);
    const agent = agentOf(life);

    // What the whole set-up is doing for you, in one strip.
    const perksHtml = `
      <div class="statline" style="margin-top:12px">
        <div><b>${formatMoney(dealPay)}</b><span>Deals / game</span></div>
        <div><b>${formatMoney(upkeep)}</b><span>Upkeep / game</span></div>
        <div><b>${signed(rest)}</b><span>Energy / night</span></div>
        <div><b>−${guard}</b><span>Stamina wear</span></div>
      </div>`;

    // ---- Messages: whoever is waiting on an answer.
    const messagesHtml = life.requests
      .map(
        (r) => `
        <div class="gear-card">
          <div class="info">
            <strong>${esc(r.from)}</strong>
            <span>${esc(r.text)}</span>
            ${r.cost > 0 ? `<span class="gear-bonus">${formatMoney(r.cost)}</span>` : ''}
          </div>
          <div class="drill-btns">
            <button class="btn primary tiny" data-accept="${r.id}" ${player.money < r.cost ? 'disabled' : ''}>${esc(r.acceptLabel)}</button>
            <button class="btn ghost tiny" data-decline="${r.id}">${esc(r.declineLabel)}</button>
          </div>
        </div>`,
      )
      .join('');

    // ---- Fame: the meter and what it is buying right now.
    const crowdPct = Math.round(fameCrowdBoost(life.fame) * 100);
    const bonusPct = Math.round((fameBonusMult(life.fame) - 1) * 100);
    const fameHtml = `
      ${meterHtml(`Fame · ${fameLabel(life.fame)}`, life.fame, 100, 'fame', 'big', HINTS.fame)}
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
    const offers = availableDeals(life, agentTier(life));
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
    const nextBrand = SPONSORS.filter(
      (s) => !availableDeals(life, 2).includes(s) && !offers.includes(s),
    ).sort((a, b) => a.minFame - b.minFame)[0];
    const brandNote =
      offers.length > 0
        ? 'A sponsor hands you their kit free, replaces it when it wears out, and pays a cheque every game. Their slot is theirs for the length of the deal.'
        : nextBrand
          ? life.fame >= nextBrand.minFame
            ? `${esc(nextBrand.brand)} will talk, but only to an agent${nextBrand.minFame >= 65 ? ' who represents All-Stars' : ''}.`
            : `Nobody is calling right now. ${esc(nextBrand.brand)} starts paying attention at ${nextBrand.minFame} fame${nextBrand.needsAgent ? ', through an agent' : ''}.`
          : 'Every brand in the game has your number.';

    // ---- People: the agent, the clubhouse, and home.
    const agentHtml = agent
      ? `
        <div class="gear-card on">
          <div class="info">
            <strong>🤝 ${esc(agent.name)}</strong>
            <span>${esc(agent.blurb)}</span>
            <span class="gear-bonus">${Math.round(agent.cut * 100)}% of every cheque · ${
              agent.tier === 2 ? 'signature brands' : 'national brands'
            }${agent.renegotiates ? ' · rewrites your contract any time' : ''}${
              agent.salaryMult > 1 ? ` · +${Math.round((agent.salaryMult - 1) * 100)}% guaranteed money` : ''
            }</span>
          </div>
          <button class="buy" id="fireAgent">Part ways</button>
        </div>
        ${
          agent.renegotiates
            ? `<p class="tiny muted" style="margin:10px 0 6px">Contract, from the next game:</p>
               <div class="chip-row">
                 ${CONTRACTS.map(
                   (c) =>
                     `<button class="chip ${c.id === player.contract ? 'on' : ''}" data-contract="${c.id}" title="${esc(c.blurb)}">${esc(c.name)}<br/><span class="tiny">${formatMoney(Math.round(contractSalary(league.levelId, c.id) * agent.salaryMult))} · ×${c.bonusMult}</span></button>`,
                 ).join('')}
               </div>`
            : ''
        }`
      : AGENTS.map(
          (a) => `
        <div class="gear-card">
          <div class="info">
            <strong>${esc(a.name)}</strong>
            <span>${esc(a.blurb)}</span>
            <span class="gear-bonus">${Math.round(a.cut * 100)}% of every cheque · opens the ${
              a.tier === 2 ? 'signature brands' : 'national brands'
            }${a.renegotiates ? ' · rewrites your contract any time' : ''}${
              a.salaryMult > 1 ? ` · +${Math.round((a.salaryMult - 1) * 100)}% guaranteed money` : ''
            }</span>
          </div>
          <button class="buy" data-agent="${a.id}" ${player.money < a.fee ? 'disabled' : ''}>${formatMoney(a.fee)}</button>
        </div>`,
        ).join('');

    const boost = teammateBoost(life);
    const peopleHtml = `
      ${meterHtml('Morale', life.morale, 100, life.morale < 35 ? 'low' : life.morale < 55 ? 'warn' : '', '', HINTS.morale)}
      <p class="tiny muted" style="margin:4px 0 0">
        ${signed(moraleEnergyBonus(life))} energy a night · games teach ${Math.round((0.9 + life.morale / 500) * 100)}% of what they could.
      </p>
      ${meterHtml('Clubhouse standing', life.clubhouse, 100, life.clubhouse < 35 ? 'low' : life.clubhouse < 55 ? 'warn' : '', '', HINTS.clubhouse)}
      <p class="tiny muted" style="margin:4px 0 12px">
        Teammates play ${boost === 0 ? 'at their rating' : `${signed(boost)} on their rating`} behind you. Wins, training and a dinner lift it; losses and a big mouth cost it.
      </p>
      ${
        life.partner
          ? `${meterHtml(`${life.partner.name} · at home`, life.partner.bond, 100, life.partner.bond < 30 ? 'low' : life.partner.bond < 55 ? 'warn' : '', '', HINTS.bond)}
             <p class="tiny muted" style="margin:4px 0 0">
               ${life.kids > 0 ? `${life.kids} kid${life.kids === 1 ? '' : 's'} at home · ` : ''}Every game on the road costs a little. Family time on an off day puts it back${life.kids === 0 ? '; keep it high through a winter and it might become a family' : ''}.
             </p>`
          : `<p class="tiny muted" style="margin:0">Nobody at home yet. A night out on an off day is where people meet people.</p>`
      }
      ${
        life.friend
          ? `${meterHtml(`${life.friend.name} · from back home`, life.friend.bond, 100, life.friend.bond < 30 ? 'low' : life.friend.bond < 55 ? 'warn' : '', '', HINTS.bond)}
             <p class="tiny muted" style="margin:4px 0 0">The friend who knew you before the number. Asks for tickets now and then. Say yes.</p>`
          : ''
      }`;

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

    // ---- Legacy: what's been built back home, and what it's doing.
    const nation = nationById(player.country);
    const homeBoost = nationStrengthBonus(life);
    const legacyHtml = `
      <p class="tiny muted" style="margin:0 0 10px">
        ${nation.flag} ${esc(nation.name)} plays the World Trophy at ${nation.strength}${
          homeBoost > 0 ? ` <b style="color:var(--accent)">+${homeBoost}</b>` : ''
        } strength. What you build here lifts the side the next time it's played;
        the bar to be picked stays where it is.
      </p>
      ${PROJECTS.map((p) => {
        const built = hasProject(life, p.id);
        const affordable = player.money >= p.price;
        return `
        <div class="gear-card ${built ? 'on' : ''}">
          <div class="info">
            <strong>${p.icon} ${esc(p.name)}</strong>
            <span>${esc(p.blurb)}</span>
            <span class="gear-bonus">+${p.nationBoost} nation strength · +${p.fame} fame</span>
          </div>
          ${
            built
              ? '<button class="buy" disabled>Built</button>'
              : `<button class="buy" data-project="${p.id}" ${affordable ? '' : 'disabled'}>${formatMoney(p.price)}</button>`
          }
        </div>`;
      }).join('')}`;

    // ---- The trophy room: everything the career has to show, in one place,
    // once there's a house with a room to show it in.
    const earned = save.trophies;
    const mvps = mvpSeasons(save.awards);
    const cups = (save.cupHistory ?? []).filter(
      (c) => c.playerResult === 'champion' || c.playerResult === 'eliminated',
    );
    const roomHtml = hasTrophyRoom(life)
      ? `
        <div class="statline">
          <div><b>${earned.length}</b><span>Trophies</span></div>
          <div><b>${mvps.length}</b><span>MVPs</span></div>
          <div><b>${cups.filter((c) => c.playerResult === 'champion').length}</b><span>World titles</span></div>
          <div><b>${life.projects.length}</b><span>Built at home</span></div>
        </div>
        <div class="room-shelf">
          ${earned
            .map((u) => {
              const t = TROPHIES.find((x) => x.id === u.id);
              return t
                ? `<span class="room-item" title="${esc(t.name)} · Season ${u.seasonYear} · ${esc(LEVELS[u.levelId]?.short ?? '')}">${t.icon}</span>`
                : '';
            })
            .join('')}
          ${mvps.map((m) => `<span class="room-item" title="MVP · Season ${m.year} · ${esc(LEVELS[m.levelId].name)}">🏆</span>`).join('')}
          ${cups
            .map(
              (c) =>
                `<span class="room-item" title="World Trophy ${c.year} · ${c.playerResult === 'champion' ? 'Champions' : 'Played'}">${c.playerResult === 'champion' ? '🥇' : '🎖️'}</span>`,
            )
            .join('')}
          ${life.toys.map((id) => toyById(id)).filter((t): t is NonNullable<typeof t> => !!t).map((t) => `<span class="room-item" title="${esc(t.name)}">${t.icon}</span>`).join('')}
          ${life.projects.map((id) => projectById(id)).filter((p): p is NonNullable<typeof p> => !!p).map((p) => `<span class="room-item" title="${esc(p.name)}">${p.icon}</span>`).join('')}
          ${earned.length + mvps.length + cups.length + life.toys.length + life.projects.length === 0 ? '<span class="tiny muted">Empty shelves. For now.</span>' : ''}
        </div>
        <p class="tiny muted" style="margin:10px 0 0">Hold a tile for what it is. The full case is in the clubhouse.</p>`
      : `<p class="tiny muted" style="margin:0">
           ${earned.length + mvps.length} piece${earned.length + mvps.length === 1 ? '' : 's'} of hardware in a box under the bed. Buy a house and there's a room for it.
         </p>`;

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

        ${
          life.requests.length > 0
            ? `<div class="panel">
                 <h2>Messages</h2>
                 ${messagesHtml}
               </div>`
            : ''
        }

        <div class="panel">
          <h2>Fame</h2>
          ${fameHtml}
        </div>

        <div class="panel">
          <h2>Endorsements</h2>
          ${activeHtml || '<p class="tiny muted" style="margin:0 0 8px">No deals running.</p>'}
          ${offersHtml ? `<div style="margin-top:10px">${offersHtml}</div>` : ''}
          <p class="tiny muted" style="margin:10px 0 0">${brandNote}</p>
        </div>

        <div class="panel">
          <h2>Your people</h2>
          ${peopleHtml}
        </div>

        <div class="panel">
          <h2>Agent</h2>
          ${agentHtml}
          ${
            agent
              ? ''
              : '<p class="tiny muted" style="margin:10px 0 0">An agent takes a cut of everything and, in return, gets the brands to pick up the phone.</p>'
          }
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
          <h2>Trophy room</h2>
          ${roomHtml}
        </div>

        <div class="panel">
          <h2>Back home</h2>
          ${legacyHtml}
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
    wireHints(mount);

    for (const button of qa<HTMLButtonElement>(mount, '[data-accept]')) {
      button.addEventListener('click', async () => {
        const line = acceptRequest(player, life, button.dataset.accept!);
        if (!line) return;
        app.persist();
        draw();
        await showDialog({ title: 'Done', body: line, confirmLabel: 'Good' });
      });
    }
    for (const button of qa<HTMLButtonElement>(mount, '[data-decline]')) {
      button.addEventListener('click', async () => {
        const line = declineRequest(life, button.dataset.decline!);
        if (!line) return;
        app.persist();
        draw();
        await showDialog({ title: 'Passed', body: line, confirmLabel: 'Okay' });
      });
    }

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

    for (const button of qa<HTMLButtonElement>(mount, '[data-agent]')) {
      button.addEventListener('click', async () => {
        const def = AGENTS.find((a) => a.id === button.dataset.agent);
        if (!def) return;
        const ok = await showDialog({
          title: `Sign with ${def.name}?`,
          body: `${formatMoney(def.fee)} to sign, then ${Math.round(def.cut * 100)}% of every cheque — salary, bonuses and sponsors alike. ${def.blurb}`,
          confirmLabel: 'Sign',
          cancelLabel: 'Not now',
        });
        if (!ok) return;
        if (hireAgent(player, life, def.id)) {
          app.persist();
          draw();
        }
      });
    }
    const fire = mount.querySelector<HTMLButtonElement>('#fireAgent');
    if (fire && agent) {
      fire.addEventListener('click', async () => {
        const ok = await showDialog({
          title: `Part ways with ${agent.name}?`,
          body: 'The cut stops. So do the calls from the brands they opened up. Deals already signed run their course.',
          confirmLabel: 'Part ways',
          cancelLabel: 'Keep them',
          danger: true,
        });
        if (!ok) return;
        fireAgent(life);
        app.persist();
        draw();
      });
    }
    for (const chip of qa<HTMLButtonElement>(mount, '[data-contract]')) {
      chip.addEventListener('click', async () => {
        const id = chip.dataset.contract as ContractStyle;
        if (id === player.contract) return;
        const offer = CONTRACTS.find((c) => c.id === id);
        if (!offer) return;
        const ok = await showDialog({
          title: `Move to the ${offer.name}?`,
          body: `${offer.blurb} Takes effect from your next game.`,
          confirmLabel: 'Rewrite it',
          cancelLabel: 'Leave it',
        });
        if (!ok) return;
        player.contract = id;
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

    for (const button of qa<HTMLButtonElement>(mount, '[data-project]')) {
      button.addEventListener('click', async () => {
        const def = projectById(button.dataset.project!);
        if (!def) return;
        const ok = await showDialog({
          title: `Build the ${def.name}?`,
          body: `${formatMoney(def.price)}, sent home. ${nation.name} plays ${def.nationBoost} stronger at the next World Trophy, and the name travels: +${def.fame} fame.`,
          confirmLabel: 'Build it',
          cancelLabel: 'Not yet',
        });
        if (!ok) return;
        if (fundProject(player, life, def.id)) {
          app.persist();
          draw();
        }
      });
    }

    q(mount, '#done').addEventListener('click', () => app.go('hub'));
  };

  draw();
}
