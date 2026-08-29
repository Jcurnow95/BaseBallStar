import type { App } from '../app';
import type { Handedness, Position } from '../core/types';
import type { ContractStyle } from '../core/gear';
import { CONTRACTS, contractById, contractSalary, formatMoney } from '../core/gear';
import {
  ARCHETYPES,
  ATTRIBUTE_LABELS,
  POSITIONS,
  ROOKIE_AGE,
  createPlayer,
  overallRating,
} from '../core/player';
import { createLeague, playerTeam } from '../core/league';
import { DEFAULT_NATION_ID, NATIONS, nationById } from '../core/nations';
import { CUP_ELIGIBLE_LEVEL, squadBar, startWorldCup } from '../core/worldCup';
import { LEVELS } from '../core/league';
import { newSave } from '../core/save';
import { esc, q, qa } from '../ui/dom';
import { showDialog } from '../ui/modal';

export function renderCreate(app: App, mount: HTMLElement): void {
  let position: Position = 'CF';
  let bats: Handedness = 'R';
  let archetypeId = ARCHETYPES[0].id;
  let contract: ContractStyle = 'standard';
  let country = DEFAULT_NATION_ID;

  const bonusText = (bonuses: Partial<Record<string, number>>): string =>
    Object.entries(bonuses)
      .map(([k, v]) => `${v! > 0 ? '+' : ''}${v} ${ATTRIBUTE_LABELS[k as keyof typeof ATTRIBUTE_LABELS]}`)
      .join('  ·  ');

  mount.innerHTML = `
    <div class="scroll">
      <div class="brand" style="padding-top:6px">
        <h1 style="font-size:26px">CREATE YOUR <span>PLAYER</span></h1>
      </div>

      <div class="panel">
        <label class="field-label" for="pname">Name</label>
        <input id="pname" type="text" maxlength="22" placeholder="e.g. Jeff Smith" autocomplete="off" />
        <div class="tiny muted" style="margin-top:8px">
          You are ${ROOKIE_AGE} and signing your first professional contract.
          Every season you finish, you get a year older.
        </div>
      </div>

      <div class="panel">
        <span class="field-label">Position</span>
        <div class="chip-row" id="positions">
          ${POSITIONS.map(
            (p) => `<div class="chip${p === position ? ' on' : ''}" data-pos="${p}">${p}</div>`,
          ).join('')}
        </div>
      </div>

      <div class="panel">
        <span class="field-label">Bats</span>
        <div class="chip-row" id="bats">
          <div class="chip on" data-bats="R">Right</div>
          <div class="chip" data-bats="L">Left</div>
        </div>
      </div>

      <div class="panel">
        <span class="field-label">Home country</span>
        <div class="nation-grid" id="nations">
          ${NATIONS.map(
            (n) => `
            <div class="nation-chip${n.id === country ? ' on' : ''}" data-nation="${n.id}"
                 title="${esc(n.name)} · squad bar ${squadBar(n)} OVR">
              <b>${n.flag}</b><span>${esc(n.code)}</span>
            </div>`,
          ).join('')}
        </div>
        <div class="nation-detail" id="nationDetail"></div>
      </div>

      <div class="panel">
        <span class="field-label">Contract</span>
        <div class="arch" id="contracts">
          ${CONTRACTS.map(
            (c) => `
            <div class="arch-card${c.id === contract ? ' on' : ''}" data-contract="${c.id}">
              <strong>${esc(c.name)}</strong>
              <span>${esc(c.blurb)}</span>
              <div class="arch-bonus">${formatMoney(contractSalary(0, c.id))} a game · bonuses ×${c.bonusMult}</div>
            </div>`,
          ).join('')}
        </div>
      </div>

      <div class="panel">
        <span class="field-label">Player type</span>
        <div class="arch" id="archetypes">
          ${ARCHETYPES.map(
            (a) => `
            <div class="arch-card${a.id === archetypeId ? ' on' : ''}" data-arch="${a.id}">
              <strong>${esc(a.name)}</strong>
              <span>${esc(a.blurb)}</span>
              <div class="arch-bonus">${esc(bonusText(a.bonuses))}</div>
            </div>`,
          ).join('')}
        </div>
      </div>
    </div>

    <div class="btn-row">
      <button class="btn ghost" id="back" style="flex:0 0 34%">Back</button>
      <button class="btn primary" id="start">Sign Contract</button>
    </div>
  `;

  const nameInput = q<HTMLInputElement>(mount, '#pname');

  for (const chip of qa(mount, '#positions .chip')) {
    chip.addEventListener('click', () => {
      position = chip.dataset.pos as Position;
      qa(mount, '#positions .chip').forEach((c) => c.classList.toggle('on', c === chip));
    });
  }

  for (const chip of qa(mount, '#bats .chip')) {
    chip.addEventListener('click', () => {
      bats = chip.dataset.bats as Handedness;
      qa(mount, '#bats .chip').forEach((c) => c.classList.toggle('on', c === chip));
    });
  }

  // The country line spells out the trade the player is making, because it is
  // the one choice on this screen they can never revisit: a deep baseball
  // country is a better team to win the Trough with and a harder squad to get
  // into at all.
  const nationDetail = q(mount, '#nationDetail');
  const paintNation = (): void => {
    const n = nationById(country);
    const bar = squadBar(n);
    const hardness =
      bar >= 68 ? 'One of the hardest squads in the world to break into.'
      : bar >= 58 ? 'A strong baseball country. You will have to earn the call.'
      : bar >= 48 ? 'A solid side with room for a good player.'
      : 'A small baseball country. Get to Triple-A and the shirt is yours.';
    nationDetail.innerHTML = `
      <strong>${n.flag} ${esc(n.name)}</strong>
      <div class="reward"><span>Squad bar</span><b>${bar} OVR</b></div>
      <div class="reward"><span>Also needs</span><b>${esc(LEVELS[CUP_ELIGIBLE_LEVEL].name)} or better</b></div>
      <p class="tiny muted">${esc(hardness)} The Baseball World Trophy is played every four years, starting this one.</p>`;
  };
  paintNation();

  for (const chip of qa(mount, '#nations .nation-chip')) {
    chip.addEventListener('click', () => {
      country = chip.dataset.nation!;
      qa(mount, '#nations .nation-chip').forEach((c) => c.classList.toggle('on', c === chip));
      paintNation();
    });
  }

  for (const card of qa(mount, '#archetypes .arch-card')) {
    card.addEventListener('click', () => {
      archetypeId = card.dataset.arch!;
      qa(mount, '#archetypes .arch-card').forEach((c) => c.classList.toggle('on', c === card));
    });
  }

  for (const card of qa(mount, '#contracts .arch-card')) {
    card.addEventListener('click', () => {
      contract = card.dataset.contract as ContractStyle;
      qa(mount, '#contracts .arch-card').forEach((c) => c.classList.toggle('on', c === card));
    });
  }

  q(mount, '#back').addEventListener('click', () => app.go('title'));

  q(mount, '#start').addEventListener('click', async () => {
    const name = nameInput.value.trim() || 'Jeff Smith';
    const archetype = ARCHETYPES.find((a) => a.id === archetypeId) ?? ARCHETYPES[0];
    const player = createPlayer(name, position, bats, archetype, contract, country);
    const league = createLeague(0, app.rng);

    app.save = newSave(player, league);

    // Year one is a tournament year. An eighteen-year-old in Single-A is never
    // in it, but the world plays for the Trough whether or not you're there,
    // and the career should start knowing that.
    const intro = startWorldCup(app.save, app.rng, overallRating(player.attributes));
    app.persist();

    const offer = contractById(contract);
    await showDialog({
      title: 'Contract signed',
      body:
        `${player.name}, ${player.age}, signs with the ${playerTeam(league).name} — ${offer.name}, ` +
        `${formatMoney(contractSalary(0, contract))} a game plus bonuses.\n\n` +
        `There is ${formatMoney(player.money)} in the bank — the gear store is open before your first game.`,
      confirmLabel: "Let's go",
    });
    await showDialog({
      title: `Baseball World Trophy · Year ${app.save.seasonYear}`,
      body: intro.lines.join('\n\n'),
      confirmLabel: 'On with the season',
    });
    app.go('hub');
  });
}
