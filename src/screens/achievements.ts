import type { App } from '../app';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_GROUPS,
  claimAchievement,
  isAchievementClaimed,
  isAchievementMet,
  unclaimedAchievements,
} from '../core/achievements';
import type { AchievementDef } from '../core/achievements';
import type { PlayerProfile } from '../core/types';
import { esc, meterHtml, q, qa } from '../ui/dom';

const cardHtml = (def: AchievementDef, player: PlayerProfile): string => {
  const claimed = isAchievementClaimed(player, def.id);
  const met = isAchievementMet(def, player);
  const progress = Math.min(def.progress(player), def.target);

  const status = claimed
    ? 'Claimed'
    : met
      ? 'Done — claim your points'
      : def.target === 1
        ? 'Not yet'
        : `${progress} / ${def.target}`;

  return `
    <div class="gear-card ${claimed ? 'on' : ''}">
      <div class="info">
        <strong>${esc(def.name)}</strong>
        <span>${esc(def.blurb)}</span>
        <span class="gear-bonus">${status}</span>
      </div>
      <button class="buy" data-claim="${def.id}" ${claimed || !met ? 'disabled' : ''}>
        ${claimed ? 'Claimed ✓' : `+${def.points} pt${def.points === 1 ? '' : 's'}`}
      </button>
    </div>`;
};

export function renderAchievements(app: App, mount: HTMLElement): void {
  const save = app.requireSave();
  const { player } = save;

  const draw = (): void => {
    const done = ACHIEVEMENTS.filter((def) => isAchievementMet(def, player)).length;
    const toClaim = unclaimedAchievements(player).length;

    const groupsHtml = ACHIEVEMENT_GROUPS.map(
      (group) => `
      <div class="panel">
        <h2>${esc(group.title)}</h2>
        ${group.achievements.map((def) => cardHtml(def, player)).join('')}
      </div>`,
    ).join('');

    mount.innerHTML = `
      <div class="scroll">
        <div class="panel">
          <div class="hub-head">
            <div class="badge">★</div>
            <div class="who">
              <strong>Achievements</strong>
              <span>Career milestones pay out attribute points</span>
              <span class="tiny muted">${
                toClaim > 0
                  ? `${toClaim} ready to claim`
                  : 'Points go straight to Player &amp; Development'
              }</span>
            </div>
            <div class="ovr"><b>${player.attributePoints}</b><span>PTS</span></div>
          </div>
          ${meterHtml('Unlocked', done, ACHIEVEMENTS.length, 'xp', 'slim')}
        </div>

        ${groupsHtml}
      </div>

      <button class="btn primary" id="done">Back to Clubhouse</button>
    `;

    for (const button of qa<HTMLButtonElement>(mount, '.buy')) {
      button.addEventListener('click', () => {
        if (claimAchievement(player, button.dataset.claim!) === null) return;
        app.persist();
        draw();
      });
    }

    q(mount, '#done').addEventListener('click', () => app.go('hub'));
  };

  draw();
}
