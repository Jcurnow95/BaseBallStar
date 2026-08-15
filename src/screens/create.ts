import type { App } from '../app';
import type { Handedness, Position } from '../core/types';
import type { ContractStyle } from '../core/gear';
import { CONTRACTS, contractById, contractSalary, formatMoney } from '../core/gear';
import { ARCHETYPES, ATTRIBUTE_LABELS, POSITIONS, createPlayer } from '../core/player';
import { createLeague, playerTeam } from '../core/league';
import { newSave } from '../core/save';
import { esc, q, qa } from '../ui/dom';
import { showDialog } from '../ui/modal';

export function renderCreate(app: App, mount: HTMLElement): void {
  let position: Position = 'CF';
  let bats: Handedness = 'R';
  let archetypeId = ARCHETYPES[0].id;
  let contract: ContractStyle = 'standard';

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
        <input id="pname" type="text" maxlength="22" placeholder="e.g. Jesse Curnow" autocomplete="off" />
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
    const name = nameInput.value.trim() || 'Rookie Jones';
    const archetype = ARCHETYPES.find((a) => a.id === archetypeId) ?? ARCHETYPES[0];
    const player = createPlayer(name, position, bats, archetype, contract);
    const league = createLeague(0, app.rng);

    app.save = newSave(player, league);
    app.persist();

    const offer = contractById(contract);
    await showDialog({
      title: 'Contract signed',
      body:
        `${player.name} signs with the ${playerTeam(league).name} — ${offer.name}, ` +
        `${formatMoney(contractSalary(0, contract))} a game plus bonuses.\n\n` +
        `There is ${formatMoney(player.money)} in the bank — the gear store is open before your first game.`,
      confirmLabel: "Let's go",
    });
    app.go('hub');
  });
}
