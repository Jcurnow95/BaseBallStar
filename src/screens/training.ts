import type { App } from '../app';
import {
  ATTRIBUTE_BLURBS,
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  overallRating,
} from '../core/player';
import {
  TRAINING_OPTIONS,
  applyTraining,
  BATTING_EYE_THRESHOLD,
  PERFECT_ZONE_THRESHOLD,
  canUpgrade,
  hasBattingEye,
  hasPerfectZone,
  perfectZoneProgress,
  recoverOvernight,
  trainingBonusXp,
  upgradeAttribute,
  upgradeCost,
  xpForLevel,
} from '../core/progression';
import type { LevelUpReport, TrainingOption } from '../core/progression';
import { advanceDay, isGameDay, isSeasonOver } from '../core/league';
import { esc, meterHtml, q, qa } from '../ui/dom';
import { showDialog } from '../ui/modal';
import { runBpChallenge, runFungoFrenzy } from './trainingGames';
import type { DrillOutcome } from './trainingGames';

export function renderTraining(app: App, mount: HTMLElement): () => void {
  const save = app.requireSave();
  const { player } = save;
  // Spending points and reading your numbers works any day. Only the drills
  // themselves, which burn the day, are limited to off days.
  const offDay = !isGameDay(save.league) && !isSeasonOver(save.league);
  /** Teardown for a drill in progress, when the route changes under it. */
  let activeDrill: (() => void) | null = null;

  const draw = (): void => {
    mount.innerHTML = `
      <div class="scroll">
        <div class="panel">
          <div class="hub-head">
            <div class="badge">${esc(player.position)}</div>
            <div class="who">
              <strong>Development</strong>
              <span>Level ${player.level} · ${player.attributePoints} attribute point${
                player.attributePoints === 1 ? '' : 's'
              } to spend</span>
            </div>
            <div class="ovr"><b>${overallRating(player.attributes)}</b><span>OVR</span></div>
          </div>
          ${meterHtml('Stamina', player.stamina)}
          ${meterHtml('Energy', player.energy, 100, 'xp')}
          ${meterHtml('XP', player.xp, xpForLevel(player.level), 'xp')}
        </div>

        <div class="panel">
          <h2>Batting eye</h2>
          ${
            hasBattingEye(player.attributes)
              ? `<div class="notice" style="margin:0">
                   <b>Unlocked.</b> You read ball from strike: a pitch over the plate glows
                   gold as it arrives, and one off the plate never does.
                 </div>`
              : `<p class="tiny muted" style="margin:0 0 8px">
                   Reach ${BATTING_EYE_THRESHOLD} Vision and the game will show you which
                   pitches are strikes — gold means swing. Until then the zone is your call.
                 </p>
                 ${meterHtml('Vision', player.attributes.vision, BATTING_EYE_THRESHOLD, 'xp')}`
          }
        </div>

        <div class="panel">
          <h2>Perfect hit zone</h2>
          ${
            hasPerfectZone(player.attributes)
              ? `<div class="notice" style="margin:0">
                   <b>Unlocked.</b> The ideal contact point is now marked on the ball as it
                   comes in. It's an aid only — it doesn't change how contact resolves.
                 </div>`
              : `<p class="tiny muted" style="margin:0 0 8px">
                   Reach ${PERFECT_ZONE_THRESHOLD} combined Contact and Vision and the game
                   will show you exactly where on the ball to make contact.
                 </p>
                 ${meterHtml(
                   'Contact + Vision',
                   perfectZoneProgress(player.attributes),
                   PERFECT_ZONE_THRESHOLD,
                   'xp',
                 )}`
          }
        </div>

        <div class="panel">
          <h2>Spend points</h2>
          ${ATTRIBUTE_KEYS.map((key) => {
            const value = player.attributes[key];
            const cost = upgradeCost(value);
            const affordable = canUpgrade(player, key);
            return `
              <div class="attr-row">
                <span class="name">${ATTRIBUTE_LABELS[key]}</span>
                <span class="track"><i style="width:${value}%"></i></span>
                <span class="val">${value}</span>
                <button class="up" data-attr="${key}" ${affordable ? '' : 'disabled'}>+${cost}p</button>
              </div>`;
          }).join('')}
          <p class="tiny muted" style="margin:10px 0 0">
            ${esc(ATTRIBUTE_BLURBS.contact)}
          </p>
        </div>

        ${
          offDay
            ? `<div class="panel">
          <h2>Work the day</h2>
          ${TRAINING_OPTIONS.map((opt) => {
            const off = player.energy < opt.energyCost;
            const playable = !!opt.minigame;
            const stamina =
              opt.staminaDelta === 0
                ? ''
                : opt.staminaDelta > 0
                  ? `<span class="st-up">+${opt.staminaDelta} STA</span><br/>`
                  : `<span class="st-dn">${opt.staminaDelta} STA</span><br/>`;
            const xpLine = playable
              ? `<span class="xp">+${opt.xp}–${opt.xp + trainingBonusXp(opt, 1)} XP</span>`
              : opt.xp > 0
                ? `<span class="xp">+${opt.xp} XP</span>`
                : '';
            return `
              <div class="train-card${playable ? ' playable' : ''}" data-train="${opt.id}" data-off="${off ? 1 : 0}">
                <div class="info">
                  <strong>${esc(opt.name)}</strong>
                  <span>${esc(opt.detail)}</span>
                </div>
                <div class="cost">
                  ${opt.energyCost > 0 ? `<span class="en">-${opt.energyCost} EN</span><br/>` : ''}
                  ${stamina}
                  ${xpLine}
                </div>
                ${
                  playable
                    ? `<div class="drill-btns">
                        <button class="btn primary tiny" data-play="${opt.id}" ${off ? 'disabled' : ''}>▶ Play the Drill</button>
                        <button class="btn ghost tiny" data-quick="${opt.id}" ${off ? 'disabled' : ''}>Quick Train</button>
                      </div>`
                    : ''
                }
              </div>`;
          }).join('')}
        </div>`
            : `<div class="panel">
          <h2>Work the day</h2>
          <p class="tiny muted" style="margin:0">
            There's a game today, so no training session. Drills happen on off days —
            check the calendar in the clubhouse for the next one.
          </p>
        </div>`
        }

        <div class="panel">
          <h2>What the numbers do</h2>
          ${ATTRIBUTE_KEYS.map(
            (key) =>
              `<p class="tiny muted" style="margin:0 0 7px"><b style="color:var(--text)">${ATTRIBUTE_LABELS[key]}</b> — ${esc(
                ATTRIBUTE_BLURBS[key],
              )}</p>`,
          ).join('')}
        </div>
      </div>

      ${offDay ? '<button class="btn primary" id="endday">End Day &amp; Rest Up</button>' : ''}
      <button class="btn ${offDay ? 'ghost' : 'primary'}" id="done" ${
        offDay ? 'style="margin-top:8px"' : ''
      }>Back to Clubhouse</button>
    `;

    for (const button of qa<HTMLButtonElement>(mount, '.up')) {
      button.addEventListener('click', async () => {
        const hadZone = hasPerfectZone(player.attributes);
        const hadEye = hasBattingEye(player.attributes);
        if (!upgradeAttribute(player, button.dataset.attr as (typeof ATTRIBUTE_KEYS)[number])) {
          return;
        }
        app.persist();
        draw();

        if (!hadEye && hasBattingEye(player.attributes)) {
          await showDialog({
            title: 'Batting eye unlocked',
            body:
              'You see the zone now. From the next pitch on, a strike glows gold as it ' +
              'reaches the plate and a ball never does — no gold, no swing.',
            confirmLabel: 'Let me at it',
          });
        }

        if (!hadZone && hasPerfectZone(player.attributes)) {
          await showDialog({
            title: 'Perfect hit zone unlocked',
            body:
              'Your eye and your hands have caught up with each other. From now on the ' +
              'ideal contact point is marked on the ball as it comes in.\n\n' +
              "It's a visual aid only — where you actually tap still decides everything.",
            confirmLabel: 'Let me at it',
          });
        }
      });
    }

    if (offDay) {
      q(mount, '#endday').addEventListener('click', async () => {
        if (player.energy > 45) {
          const ok = await showDialog({
            title: 'Turn in early?',
            body: `You still have ${Math.round(player.energy)}% energy left. Off days don't come around often.`,
            confirmLabel: 'End the day',
            cancelLabel: 'Keep working',
          });
          if (!ok) return;
        }
        advanceDay(save.league, app.rng);
        recoverOvernight(player);
        app.persist();
        app.go('hub');
      });
    }

    const outOfEnergy = (): Promise<boolean> =>
      showDialog({
        title: 'Out of energy',
        body: 'You have nothing left in the tank today. Take a rest day to reset.',
      });

    const maybeLevelDialog = async (report: LevelUpReport): Promise<void> => {
      if (report.levelsGained === 0) return;
      await showDialog({
        title: 'Level up!',
        body: `You're now level ${player.level} and earned ${report.pointsGained} attribute point${
          report.pointsGained === 1 ? '' : 's'
        }.`,
        confirmLabel: 'Spend them',
      });
    };

    const quickTrain = async (option: TrainingOption): Promise<void> => {
      const report = applyTraining(player, option);
      if (!report) {
        await outOfEnergy();
        return;
      }
      app.persist();
      draw();
      await maybeLevelDialog(report);
    };

    const finishDrill = async (option: TrainingOption, outcome: DrillOutcome): Promise<void> => {
      const bonus = trainingBonusXp(option, outcome.ratio);
      const report = applyTraining(player, option, bonus);
      app.persist();
      draw();
      await showDialog({
        title: `${option.name} — session over`,
        body:
          `${outcome.headline}.\n\n` +
          (bonus > 0
            ? `+${option.xp} XP for the session, +${bonus} bonus XP for the work.`
            : `+${option.xp} XP for the session. No bonus this time — the reps still count.`),
        confirmLabel: 'Nice',
      });
      if (report) await maybeLevelDialog(report);
    };

    const playDrill = async (option: TrainingOption): Promise<void> => {
      if (!option.minigame) return;
      if (player.energy < option.energyCost) {
        await outOfEnergy();
        return;
      }
      const run = option.minigame === 'bp' ? runBpChallenge : runFungoFrenzy;
      activeDrill = run(app, mount, (outcome) => {
        activeDrill = null;
        // Backed out before the first rep: the day is untouched.
        if (!outcome) {
          draw();
          return;
        }
        void finishDrill(option, outcome);
      });
    };

    for (const card of qa(mount, '.train-card')) {
      const option = TRAINING_OPTIONS.find((o) => o.id === card.dataset.train);
      if (!option) continue;
      if (option.minigame) {
        // Playable drills choose via their buttons; a card tap does nothing.
        q<HTMLButtonElement>(card, '[data-play]').addEventListener('click', () =>
          playDrill(option),
        );
        q<HTMLButtonElement>(card, '[data-quick]').addEventListener('click', () =>
          quickTrain(option),
        );
      } else {
        card.addEventListener('click', () => quickTrain(option));
      }
    }

    q(mount, '#done').addEventListener('click', () => app.go('hub'));
  };

  draw();

  return () => {
    activeDrill?.();
    activeDrill = null;
  };
}
