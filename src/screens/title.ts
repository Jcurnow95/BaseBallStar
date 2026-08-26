import type { App } from '../app';
import { LEVELS, playerTeam } from '../core/league';
import { overallRating } from '../core/player';
import type { SaveData } from '../core/save';
import { SLOT_COUNT, clearSave, loadSave, parseSave, writeSave } from '../core/save';
import { esc, q, qa } from '../ui/dom';
import { showDialog } from '../ui/modal';
import { exportSaveFile, pickSaveFile } from '../ui/transfer';
import { openHowto } from './howto';
import { openTutorial } from './tutorial';

export function renderTitle(app: App, mount: HTMLElement): void {
  const slots: (SaveData | null)[] = Array.from({ length: SLOT_COUNT }, (_, i) => loadSave(i));

  const slotCard = (save: SaveData | null, slot: number): string => {
    if (!save) {
      return `
        <div class="slot-card empty" data-slot="${slot}">
          <div class="hub-head">
            <div class="badge open">${slot + 1}</div>
            <div class="who">
              <strong>Open roster spot</strong>
              <span>Start a new career, or import one from another device.</span>
            </div>
          </div>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn primary tiny" data-act="new" data-slot="${slot}">New Player</button>
            <button class="btn ghost tiny" data-act="import" data-slot="${slot}">Import Save</button>
          </div>
        </div>`;
    }

    const { player, league } = save;
    const level = LEVELS[league.levelId];
    const team = playerTeam(league);
    return `
      <div class="slot-card" data-slot="${slot}">
        <div class="hub-head">
          <div class="badge">${esc(player.position)}</div>
          <div class="who">
            <strong>${esc(player.name)}</strong>
            <div class="id-chips">
              <span class="id-chip">${esc(level.name)}</span>
              <span class="id-chip">${esc(team.name)}</span>
              <span class="id-chip">Lv ${player.level}</span>
              <span class="id-chip">Season ${save.seasonYear}</span>
            </div>
          </div>
          <div class="ovr">
            <b>${overallRating(player.attributes)}</b>
            <span>OVR</span>
          </div>
        </div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn primary tiny" data-act="play" data-slot="${slot}">Play</button>
          <button class="btn ghost tiny" data-act="export" data-slot="${slot}">Export</button>
          <button class="btn ghost tiny" data-act="delete" data-slot="${slot}">Delete</button>
        </div>
      </div>`;
  };

  mount.innerHTML = `
    <div class="scroll">
      <div class="brand">
        <h1>BASEBALL<span>STAR</span></h1>
        <p>Build a player. Ride the buses. Make The Show.</p>
      </div>

      <div class="panel">
        <h2>Your players</h2>
        ${slots.map(slotCard).join('')}
        <p class="tiny muted" style="margin:10px 0 0">
          Exported saves are plain files — move one to any device and import it there
          to pick the career up where it left off.
        </p>
      </div>

      <div class="panel">
        <h2>How it plays</h2>
        <p class="tiny muted" style="margin:0 0 8px">
          You play only your own moments — every plate appearance and every ball hit your way.
          The rest of the game simulates around you.
        </p>
        <p class="tiny muted" style="margin:0 0 8px">
          <b style="color:var(--text)">At the plate:</b> the ball leaves the hand small and breaks late.
          Tap it. Tapping slightly <b style="color:var(--accent)">under center</b> is a barrel — that's your
          home run. Above center tops it into the dirt. Let bad pitches go and take the walk.
        </p>
        <p class="tiny muted" style="margin:0">
          <b style="color:var(--text)">In the field:</b> get your glove on the ball before it lands.
        </p>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn ghost tiny" id="tutorial">Play the Tutorial</button>
          <button class="btn ghost tiny" id="howto">How to Play</button>
        </div>
      </div>

      <div class="panel">
        <h2>Attributes matter</h2>
        <p class="tiny muted" style="margin:0">
          Contact widens your margin for error on the ball. Power turns good contact into extra bases.
          Vision reads the pitch out of the hand. Speed steals bases — when the legs are fresh.
          Stamina keeps the sweet spot from shrinking over a long season — train it or pay for it
          in September.
        </p>
      </div>
    </div>
  `;

  const exportSlot = async (save: SaveData): Promise<void> => {
    const result = await exportSaveFile(save);
    if (result === 'downloaded') {
      await showDialog({
        title: 'Save exported',
        body:
          `${save.player.name}'s career was downloaded as a file.\n\n` +
          'Move it to your new device and use Import Save on an open roster spot there.',
      });
    } else if (result === 'failed') {
      await showDialog({
        title: 'Export failed',
        body: 'The save file could not be written on this device.',
      });
    }
    // 'shared' and 'cancelled' were the player driving the share sheet —
    // nothing left to say.
  };

  const importIntoSlot = async (slot: number): Promise<void> => {
    const raw = await pickSaveFile();
    if (raw == null) return;
    const save = parseSave(raw);
    if (!save) {
      await showDialog({
        title: 'Not a save file',
        body: 'That file is not a Baseball Star save this version of the game can read.',
      });
      return;
    }
    writeSave(slot, save);
    app.go('title');
    await showDialog({
      title: 'Career imported',
      body: `${save.player.name} is back — ${LEVELS[save.league.levelId].name}, season ${save.seasonYear}.`,
    });
  };

  const deleteSlot = async (save: SaveData, slot: number): Promise<void> => {
    const ok = await showDialog({
      title: `Delete ${save.player.name}?`,
      body: 'This career save will be erased for good. Export it first if you want a copy.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      danger: true,
    });
    if (!ok) return;
    clearSave(slot);
    app.go('title');
  };

  for (const button of qa(mount, '.slot-card [data-act]')) {
    button.addEventListener('click', () => {
      const slot = Number(button.dataset.slot);
      const save = slots[slot];
      switch (button.dataset.act) {
        case 'play':
          app.selectSlot(slot);
          app.go('hub');
          break;
        case 'new':
          app.selectSlot(slot);
          app.go('create');
          break;
        case 'export':
          if (save) void exportSlot(save);
          break;
        case 'import':
          void importIntoSlot(slot);
          break;
        case 'delete':
          if (save) void deleteSlot(save, slot);
          break;
      }
    });
  }

  q(mount, '#howto').addEventListener('click', () => openHowto(app, 'title'));
  q(mount, '#tutorial').addEventListener('click', () => openTutorial(app, 'title'));
}
