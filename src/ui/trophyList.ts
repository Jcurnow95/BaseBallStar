/**
 * How a trophy looks, in the two places it shows up: the panel that
 * announces one the moment it's earned, and the trophy room that lists the
 * whole case. Shared so a tile can never drift between them.
 */
import type { Trophy, UnlockedTrophy } from '../core/trophies';
import { LEVELS } from '../core/league';
import { esc } from './dom';

/** One row in the case, earned or not. */
export function trophyRowHtml(
  trophy: Trophy,
  earned: UnlockedTrophy | undefined,
): string {
  const when = earned
    ? `Season ${earned.seasonYear} · ${esc(LEVELS[earned.levelId]?.short ?? '—')}`
    : 'Locked';
  return `
    <div class="ach-row ${earned ? 'earned' : 'locked'}">
      <span class="ach-icon">${earned ? trophy.icon : '🔒'}</span>
      <div class="ach-what">
        <strong>${esc(trophy.name)}</strong>
        <i>${esc(trophy.blurb)}</i>
      </div>
      <span class="ach-when">${when}</span>
    </div>`;
}

/**
 * The "you just did this" panel. Returns an empty string when nothing was
 * earned, so a caller can drop it straight into a template.
 */
export function unlockedPanelHtml(unlocked: readonly Trophy[]): string {
  if (unlocked.length === 0) return '';
  const plural = unlocked.length === 1 ? '' : 's';
  return `
    <div class="panel ach-new">
      <h2>Trophy case${plural ? ` · ${unlocked.length} new` : ''}</h2>
      ${unlocked
        .map(
          (a) => `
        <div class="ach-row earned ${a.headline ? 'headline' : ''}">
          <span class="ach-icon">${a.icon}</span>
          <div class="ach-what">
            <strong>${esc(a.name)}</strong>
            <i>${esc(a.blurb)}</i>
          </div>
          <span class="ach-when new">NEW</span>
        </div>`,
        )
        .join('')}
    </div>`;
}
