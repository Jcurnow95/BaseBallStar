import type { App } from '../app';
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  POSITIONS,
  battingAverage,
  emptyBattingStats,
  onBasePct,
  overallRating,
  slugging,
} from '../core/player';
import {
  PERFECT_ZONE_THRESHOLD,
  hasPerfectZone,
  perfectZoneProgress,
  seasonScore,
  xpForLevel,
} from '../core/progression';
import { clamp } from '../core/rng';
import type { BattingStats, Handedness, Position } from '../core/types';
import { esc, q, qa } from '../ui/dom';
import { showDialog } from '../ui/modal';

const DEV_FLAG_KEY = 'baseball-star:dev';

/**
 * The dev menu writes straight into the save, so it's only reachable on the dev
 * server. A production build (and therefore anything Capacitor ships) hides it
 * unless `baseball-star:dev` is set to `1` in localStorage, which is the escape
 * hatch for testing on a real device.
 */
export function devMenuEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem(DEV_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** Editable batting counters. `hits` is derived, so it isn't in here. */
const STAT_FIELDS: { key: keyof BattingStats; label: string }[] = [
  { key: 'pa', label: 'PA' },
  { key: 'ab', label: 'AB' },
  { key: 'singles', label: '1B' },
  { key: 'doubles', label: '2B' },
  { key: 'triples', label: '3B' },
  { key: 'homeRuns', label: 'HR' },
  { key: 'rbi', label: 'RBI' },
  { key: 'runs', label: 'R' },
  { key: 'walks', label: 'BB' },
  { key: 'strikeouts', label: 'SO' },
  { key: 'stolenBases', label: 'SB' },
];

const ATTRIBUTE_PRESETS: { label: string; value: number }[] = [
  { label: 'Rookie', value: 30 },
  { label: 'Average', value: 50 },
  { label: 'Star', value: 75 },
  { label: 'Maxed', value: 99 },
];

/**
 * Keeps a hand-typed line internally consistent: hits always equal the four
 * hit types, and AB/PA are raised to cover what they have to contain. Without
 * this you can hand the promotion check a season with more hits than at-bats.
 */
function reconcile(line: BattingStats): void {
  for (const field of STAT_FIELDS) {
    line[field.key] = Math.max(0, Math.round(line[field.key]));
  }
  line.hits = line.singles + line.doubles + line.triples + line.homeRuns;
  line.ab = Math.max(line.ab, line.hits + line.strikeouts);
  line.pa = Math.max(line.pa, line.ab + line.walks);
}

export function renderDev(app: App, mount: HTMLElement): void {
  const save = app.requireSave();
  const { player } = save;
  let editing: 'season' | 'career' = 'season';
  const line = (): BattingStats => (editing === 'season' ? player.season : player.career);

  const draw = (): void => {
    mount.innerHTML = `
      <div class="scroll">
        <div class="panel">
          <div class="dev-head">
            <div>
              <strong>Dev Menu</strong>
              <span class="tiny muted">Edits apply to the live save immediately.</span>
            </div>
            <div class="ovr"><b id="dev-ovr">0</b><span>OVR</span></div>
          </div>
          <div class="dev-readout">
            <div><b id="dev-grade">0</b><span>GRADE</span></div>
            <div><b id="dev-zone">0</b><span>C+V</span></div>
            <div><b id="dev-avg">.000</b><span>AVG</span></div>
            <div><b id="dev-ops">.000</b><span>OPS</span></div>
          </div>
        </div>

        <div class="panel">
          <h2>Attributes</h2>
          ${ATTRIBUTE_KEYS.map(
            (key) => `
            <div class="dev-row">
              <span class="name">${ATTRIBUTE_LABELS[key]}</span>
              <input type="range" min="5" max="99" step="1" data-attr="${key}"
                     value="${player.attributes[key]}" aria-label="${ATTRIBUTE_LABELS[key]}" />
              <input type="number" class="dev-spin" min="5" max="99" step="1"
                     inputmode="numeric" data-attr-num="${key}" value="${player.attributes[key]}" />
            </div>`,
          ).join('')}
          <div class="chip-row" style="margin-top:10px">
            ${ATTRIBUTE_PRESETS.map(
              (p) => `<button class="chip" data-preset="${p.value}">${esc(p.label)}</button>`,
            ).join('')}
          </div>
        </div>

        <div class="panel">
          <h2>Condition &amp; progression</h2>
          <div class="dev-row">
            <span class="name">Stamina</span>
            <input type="range" min="0" max="100" step="1" data-cond="stamina"
                   value="${Math.round(player.stamina)}" aria-label="Stamina" />
            <input type="number" class="dev-spin" min="0" max="100" step="1"
                   inputmode="numeric" data-cond-num="stamina" value="${Math.round(player.stamina)}" />
          </div>
          <div class="dev-row">
            <span class="name">Energy</span>
            <input type="range" min="0" max="100" step="1" data-cond="energy"
                   value="${Math.round(player.energy)}" aria-label="Energy" />
            <input type="number" class="dev-spin" min="0" max="100" step="1"
                   inputmode="numeric" data-cond-num="energy" value="${Math.round(player.energy)}" />
          </div>
          <div class="dev-grid" style="margin-top:10px">
            <label class="dev-num"><span>Level</span>
              <input type="number" min="1" max="99" step="1" inputmode="numeric"
                     data-prog="level" value="${player.level}" /></label>
            <label class="dev-num"><span>XP <i class="tiny muted">/ ${xpForLevel(player.level)}</i></span>
              <input type="number" min="0" step="1" inputmode="numeric"
                     data-prog="xp" value="${player.xp}" /></label>
            <label class="dev-num"><span>Points</span>
              <input type="number" min="0" step="1" inputmode="numeric"
                     data-prog="attributePoints" value="${player.attributePoints}" /></label>
            <label class="dev-num"><span>Money</span>
              <input type="number" min="0" step="1" inputmode="numeric"
                     data-prog="money" value="${Math.round(player.money)}" /></label>
          </div>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn ghost tiny" id="refill">Refill STA / EN</button>
            <button class="btn ghost tiny" id="givepts">+25 points</button>
          </div>
          <button class="btn ghost tiny" id="zone" style="margin-top:8px">
            Unlock perfect hit zone (${PERFECT_ZONE_THRESHOLD} C+V)
          </button>
        </div>

        <div class="panel">
          <h2>Identity</h2>
          <input type="text" id="dev-name" value="${esc(player.name)}" maxlength="18"
                 aria-label="Player name" />
          <div class="chip-row" style="margin-top:10px">
            ${POSITIONS.map(
              (pos) =>
                `<button class="chip ${pos === player.position ? 'on' : ''}" data-pos="${pos}">${pos}</button>`,
            ).join('')}
          </div>
          <div class="chip-row" style="margin-top:8px">
            ${(['R', 'L'] as Handedness[])
              .map(
                (hand) =>
                  `<button class="chip ${hand === player.bats ? 'on' : ''}" data-bats="${hand}">Bats ${hand}</button>`,
              )
              .join('')}
          </div>
        </div>

        <div class="panel">
          <h2>Batting line</h2>
          <div class="chip-row">
            <button class="chip ${editing === 'season' ? 'on' : ''}" data-line="season">Season</button>
            <button class="chip ${editing === 'career' ? 'on' : ''}" data-line="career">Career</button>
          </div>
          <div class="dev-grid" style="margin-top:10px">
            ${STAT_FIELDS.map(
              (field) => `
              <label class="dev-num"><span>${field.label}</span>
                <input type="number" min="0" step="1" inputmode="numeric"
                       data-stat="${field.key}" value="${line()[field.key]}" /></label>`,
            ).join('')}
          </div>
          <p class="tiny muted" style="margin:10px 0 0">
            Hits are derived from 1B/2B/3B/HR — currently <b id="dev-hits">0</b>.
            AB and PA are raised if they can't cover the line you typed.
          </p>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn ghost tiny" id="clearline">Clear this line</button>
            <button class="btn ghost tiny" id="clearfield">Clear fielding</button>
          </div>
        </div>

        <div class="panel">
          <h2>Fielding</h2>
          <div class="dev-grid">
            <label class="dev-num"><span>Chances</span>
              <input type="number" min="0" step="1" inputmode="numeric"
                     data-field="chances" value="${player.fielding.chances}" /></label>
            <label class="dev-num"><span>Putouts</span>
              <input type="number" min="0" step="1" inputmode="numeric"
                     data-field="putouts" value="${player.fielding.putouts}" /></label>
            <label class="dev-num"><span>Errors</span>
              <input type="number" min="0" step="1" inputmode="numeric"
                     data-field="errors" value="${player.fielding.errors}" /></label>
          </div>
        </div>
      </div>

      <button class="btn primary" id="back">Back to Clubhouse</button>
    `;

    wire();
    refresh();
  };

  /** Repaints everything derived from the model, without rebuilding the DOM. */
  const refresh = (): void => {
    const current = line();
    q(mount, '#dev-ovr').textContent = String(overallRating(player.attributes));
    q(mount, '#dev-grade').textContent = String(seasonScore(player.season));

    const zone = perfectZoneProgress(player.attributes);
    const zoneEl = q(mount, '#dev-zone');
    zoneEl.textContent = `${zone}`;
    zoneEl.style.color = hasPerfectZone(player.attributes) ? 'var(--gold)' : '';

    q(mount, '#dev-avg').textContent = battingAverage(current);
    const ops =
      parseFloat(onBasePct(current) || '0') + parseFloat(slugging(current) || '0');
    q(mount, '#dev-ops').textContent = ops.toFixed(3).replace(/^0/, '');
    q(mount, '#dev-hits').textContent = String(current.hits);

    for (const key of ATTRIBUTE_KEYS) {
      q<HTMLInputElement>(mount, `[data-attr="${key}"]`).value = String(player.attributes[key]);
      q<HTMLInputElement>(mount, `[data-attr-num="${key}"]`).value = String(player.attributes[key]);
    }
    q<HTMLInputElement>(mount, '[data-cond="stamina"]').value = String(Math.round(player.stamina));
    q<HTMLInputElement>(mount, '[data-cond-num="stamina"]').value = String(Math.round(player.stamina));
    q<HTMLInputElement>(mount, '[data-cond="energy"]').value = String(Math.round(player.energy));
    q<HTMLInputElement>(mount, '[data-cond-num="energy"]').value = String(Math.round(player.energy));

    for (const field of STAT_FIELDS) {
      q<HTMLInputElement>(mount, `[data-stat="${field.key}"]`).value = String(current[field.key]);
    }
  };

  const commit = (): void => {
    app.persist();
    refresh();
  };

  const readNumber = (input: HTMLInputElement, fallback: number): number => {
    const parsed = Number(input.value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const wire = (): void => {
    for (const slider of qa<HTMLInputElement>(mount, '[data-attr]')) {
      const key = slider.dataset.attr as (typeof ATTRIBUTE_KEYS)[number];
      slider.addEventListener('input', () => {
        player.attributes[key] = clamp(Math.round(Number(slider.value)), 5, 99);
        commit();
      });
    }

    for (const input of qa<HTMLInputElement>(mount, '[data-attr-num]')) {
      const key = input.dataset.attrNum as (typeof ATTRIBUTE_KEYS)[number];
      input.addEventListener('change', () => {
        player.attributes[key] = clamp(
          Math.round(readNumber(input, player.attributes[key])),
          5,
          99,
        );
        commit();
      });
    }

    for (const input of qa<HTMLInputElement>(mount, '[data-cond], [data-cond-num]')) {
      const key = (input.dataset.cond ?? input.dataset.condNum) as 'stamina' | 'energy';
      const event = input.dataset.cond ? 'input' : 'change';
      input.addEventListener(event, () => {
        player[key] = clamp(Math.round(readNumber(input, player[key])), 0, 100);
        commit();
      });
    }

    for (const button of qa<HTMLButtonElement>(mount, '[data-preset]')) {
      button.addEventListener('click', () => {
        const value = Number(button.dataset.preset);
        for (const key of ATTRIBUTE_KEYS) player.attributes[key] = value;
        commit();
      });
    }

    for (const input of qa<HTMLInputElement>(mount, '[data-prog]')) {
      const key = input.dataset.prog as 'level' | 'xp' | 'attributePoints' | 'money';
      input.addEventListener('change', () => {
        const min = key === 'level' ? 1 : 0;
        const max = key === 'money' ? 9_999_999 : 9999;
        player[key] = clamp(Math.round(readNumber(input, player[key])), min, max);
        app.persist();
        draw(); // the XP label carries the level's threshold
      });
    }

    q(mount, '#refill').addEventListener('click', () => {
      player.stamina = 100;
      player.energy = 100;
      commit();
    });

    q(mount, '#givepts').addEventListener('click', () => {
      player.attributePoints += 25;
      app.persist();
      draw();
    });

    q(mount, '#zone').addEventListener('click', () => {
      // Split the shortfall across both halves of the skill, the way the
      // unlock is meant to be earned.
      while (!hasPerfectZone(player.attributes)) {
        const key = player.attributes.contact <= player.attributes.vision ? 'contact' : 'vision';
        if (player.attributes[key] >= 99) {
          const other = key === 'contact' ? 'vision' : 'contact';
          if (player.attributes[other] >= 99) break;
          player.attributes[other]++;
        } else {
          player.attributes[key]++;
        }
      }
      commit();
    });

    const nameInput = q<HTMLInputElement>(mount, '#dev-name');
    nameInput.addEventListener('change', () => {
      const trimmed = nameInput.value.trim();
      if (trimmed) player.name = trimmed;
      nameInput.value = player.name;
      app.persist();
    });

    for (const button of qa<HTMLButtonElement>(mount, '[data-pos]')) {
      button.addEventListener('click', () => {
        player.position = button.dataset.pos as Position;
        app.persist();
        draw();
      });
    }

    for (const button of qa<HTMLButtonElement>(mount, '[data-bats]')) {
      button.addEventListener('click', () => {
        player.bats = button.dataset.bats as Handedness;
        app.persist();
        draw();
      });
    }

    for (const button of qa<HTMLButtonElement>(mount, '[data-line]')) {
      button.addEventListener('click', () => {
        editing = button.dataset.line as 'season' | 'career';
        draw();
      });
    }

    for (const input of qa<HTMLInputElement>(mount, '[data-stat]')) {
      const key = input.dataset.stat as keyof BattingStats;
      input.addEventListener('change', () => {
        const current = line();
        current[key] = Math.max(0, Math.round(readNumber(input, current[key])));
        reconcile(current);
        commit();
      });
    }

    for (const input of qa<HTMLInputElement>(mount, '[data-field]')) {
      const key = input.dataset.field as 'chances' | 'putouts' | 'errors';
      input.addEventListener('change', () => {
        player.fielding[key] = Math.max(0, Math.round(readNumber(input, player.fielding[key])));
        input.value = String(player.fielding[key]);
        app.persist();
      });
    }

    q(mount, '#clearline').addEventListener('click', async () => {
      const which = editing;
      if (which === 'career') {
        const ok = await showDialog({
          title: 'Wipe the career line?',
          body: 'Every career counter goes back to zero. There is no undo.',
          confirmLabel: 'Wipe it',
          cancelLabel: 'Keep it',
          danger: true,
        });
        if (!ok) return;
      }
      player[which] = emptyBattingStats();
      app.persist();
      draw();
    });

    q(mount, '#clearfield').addEventListener('click', () => {
      player.fielding = { chances: 0, putouts: 0, errors: 0 };
      app.persist();
      draw();
    });

    q(mount, '#back').addEventListener('click', () => app.go('hub'));
  };

  draw();
}
