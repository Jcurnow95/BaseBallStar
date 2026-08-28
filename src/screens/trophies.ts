/**
 * The trophy room. Every trophy in the game, in one place, with the ones
 * you haven't got still listed and still readable — a locked row that hides
 * what it wants is a row nobody chases.
 *
 * MVP trophies live here too. They're voted in `core/awards.ts` rather than
 * tested in `core/trophies.ts`, because there can be one every year and a
 * trophy fires once; but a player looking for their honours shouldn't
 * have to know that, so the case shows both.
 */
import type { App } from '../app';
import {
  TROPHIES,
  TIER_LABEL,
  TIER_ORDER,
  totalTrophyPoints,
  trophyProgress,
} from '../core/trophies';
import { mvpSeasons } from '../core/awards';
import { LEVELS } from '../core/league';
import { trophyRowHtml } from '../ui/trophyList';
import { esc, q } from '../ui/dom';

export function renderTrophies(app: App, mount: HTMLElement): void {
  const save = app.requireSave();
  const earned = new Map(save.trophies.map((u) => [u.id, u]));
  const { earned: count, total } = trophyProgress(save.trophies);
  const mvps = mvpSeasons(save.awards);
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  // What the case has already paid, and what the rest of it is still holding.
  const paid = totalTrophyPoints(TROPHIES.filter((t) => earned.has(t.id)));
  const outstanding = totalTrophyPoints(TROPHIES) - paid;

  const tiers = TIER_ORDER.map((tier) => {
    const rows = TROPHIES.filter((a) => a.tier === tier);
    const got = rows.filter((a) => earned.has(a.id)).length;
    return `
      <div class="panel">
        <h2>${esc(TIER_LABEL[tier])} <i class="tiny muted">${got}/${rows.length}</i></h2>
        ${rows.map((a) => trophyRowHtml(a, earned.get(a.id))).join('')}
      </div>`;
  }).join('');

  mount.innerHTML = `
    <div class="scroll">
      <div class="panel result-hero">
        <div class="verdict ${count === total ? 'champ' : 'tie'}">TROPHY CASE</div>
        <div class="score">${count} of ${total} earned · ${pct}%</div>
        <div class="tiny muted" style="margin-top:6px">
          ${paid} attribute point${paid === 1 ? '' : 's'} paid out${
            outstanding > 0 ? ` · ${outstanding} still out there` : ''
          }
        </div>
      </div>

      <div class="panel">
        <h2>Most Valuable Player</h2>
        ${
          mvps.length > 0
            ? mvps
                .map(
                  (t) => `
              <div class="reward">
                <span>🏆 Season ${t.year} · ${esc(LEVELS[t.levelId].name)}</span>
                <b>MVP</b>
              </div>`,
                )
                .join('')
            : `<p class="tiny muted" style="margin:0; line-height:1.55">
                 No MVP awards yet. Win one and every year you take it is listed here.
               </p>`
        }
      </div>

      ${tiers}
    </div>

    <button class="btn primary" id="back">Back to Clubhouse</button>
  `;

  q(mount, '#back').addEventListener('click', () => app.go('hub'));
}
