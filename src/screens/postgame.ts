import type { App } from '../app';
import { battingAverage } from '../core/player';
import { contractById, formatMoney } from '../core/gear';
import { ROUND_LABEL } from '../core/playoffs';
import { ROUND_LABEL as CUP_ROUND_LABEL } from '../core/worldCup';
import { unlockedPanelHtml } from '../ui/trophyList';
import { MEDIA_ANSWERS, addClubhouse, answerMedia, fameLabel } from '../core/lifestyle';
import type { MediaAnswer } from '../core/lifestyle';
import { lifestyleOf } from '../core/save';
import { esc, q, qa } from '../ui/dom';

export function renderPostGame(app: App, mount: HTMLElement): void {
  const summary = app.lastGame;
  if (!summary) {
    app.go('hub');
    return;
  }

  const save = app.requireSave();
  const { stats } = summary;
  const playoff = summary.playoff;
  const cup = summary.cup;
  const champion = playoff?.status === 'champion' || cup?.status === 'champion';
  const verdict = champion
    ? cup
      ? 'WORLD CHAMPIONS'
      : 'CHAMPIONS'
    : summary.tie
      ? 'TIE'
      : summary.win
        ? 'WIN'
        : 'LOSS';
  const verdictClass = champion ? 'champ' : summary.tie ? 'tie' : summary.win ? 'win' : 'loss';

  // Where the tournament stands. `note` is written where the bracket lives, so
  // this screen never has to reason about groups or seeding.
  const cupHtml = cup
    ? `<div class="notice ${
        cup.status === 'eliminated' ? 'warn' : cup.status === 'champion' ? 'moment' : ''
      }" style="margin-bottom:12px">
         <b>Baseball World Trophy · ${esc(CUP_ROUND_LABEL[cup.round])}</b> · ${esc(cup.note)}
       </div>`
    : '';

  // A tournament game has no season line to quote — it is played before
  // opening day and deliberately kept out of `season` — so the development
  // panel quotes the tournament instead.
  const cupLine = save.worldCup?.playerStats;
  const tournamentAvg =
    !cupLine || cupLine.ab === 0
      ? '.000'
      : (cupLine.hits / cupLine.ab).toFixed(3).replace(/^0/, '');

  // Where the series stands, and what it means.
  const seriesHtml = ((): string => {
    if (!playoff) return '';
    const round = ROUND_LABEL[playoff.round];
    const tally = `${playoff.us}-${playoff.them}`;
    let note: string;
    let cls = '';
    switch (playoff.status) {
      case 'champion':
        note = `You win the ${round} ${tally}. The trophy is yours.`;
        break;
      case 'advanced':
        note = `You take the ${round} ${tally} and move on to the ${ROUND_LABEL.final}.`;
        break;
      case 'eliminated':
        note = `The ${esc(playoff.opponent)} take the ${round} ${tally}. Your season is over.`;
        cls = 'warn';
        break;
      default: {
        const need = Math.ceil(playoff.bestOf / 2);
        if (playoff.us > playoff.them) {
          note = `You lead the ${round} ${tally}.${playoff.us === need - 1 ? " One more and it's yours." : ''}`;
        } else if (playoff.us < playoff.them) {
          note = `You trail the ${round} ${tally}.${playoff.them === need - 1 ? ' Win or go home.' : ''}`;
        } else {
          note = `The ${round} is level at ${tally}.`;
        }
      }
    }
    return `<div class="notice ${cls}" style="margin-bottom:12px"><b>${round}</b> · ${note}</div>`;
  })();

  // The moments worth saying out loud, whether or not they were new. An
  // trophy fires once in a career; a walk-off is a walk-off every time.
  const moments = [
    summary.feats.walkOffHomeRun
      ? 'Walk-off home run. You ended it with one swing.'
      : summary.feats.walkOff
        ? 'Walk-off. The winning run came home on your at-bat.'
        : '',
    summary.feats.grandSlam ? 'Grand slam — all four came around.' : '',
    summary.feats.insideThePark ? 'Inside-the-park home run. You ran it out.' : '',
    !summary.feats.walkOff && summary.feats.clutchHit
      ? 'You brought them back late.'
      : '',
  ].filter(Boolean);

  const line = [
    `${stats.hits}-for-${stats.ab}`,
    stats.homeRuns > 0 ? `${stats.homeRuns} HR` : '',
    stats.rbi > 0 ? `${stats.rbi} RBI` : '',
    stats.walks > 0 ? `${stats.walks} BB` : '',
    stats.stolenBases > 0 ? `${stats.stolenBases} SB` : '',
    stats.runs > 0 ? `${stats.runs} R` : '',
    stats.strikeouts > 0 ? `${stats.strikeouts} K` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  mount.innerHTML = `
    <div class="scroll">
      <div class="panel result-hero">
        <div class="verdict ${verdictClass}">${verdict}</div>
        <div class="score">${summary.score.us} — ${summary.score.them} ${
          summary.home ? 'vs' : '@'
        } ${esc(summary.opponent)}</div>
      </div>

      ${seriesHtml}
      ${cupHtml}

      ${
        moments.length > 0
          ? `<div class="notice moment">${moments.map((m) => esc(m)).join('<br/>')}</div>`
          : ''
      }

      ${unlockedPanelHtml(summary.unlocked)}

      ${
        summary.life.media
          ? `<div class="panel" id="press">
               <h2>In the tunnel</h2>
               <p class="tiny" style="margin:0 0 10px; line-height:1.55">
                 A reporter catches you on the way out. <i>"${esc(summary.life.media.question)}"</i>
               </p>
               <div class="press-btns">
                 ${(Object.keys(MEDIA_ANSWERS) as MediaAnswer[])
                   .map(
                     (key) =>
                       `<button class="btn ghost tiny" data-answer="${key}">${esc(MEDIA_ANSWERS[key].label)}</button>`,
                   )
                   .join('')}
               </div>
             </div>`
          : ''
      }

      <div class="panel">
        <h2>Your line</h2>
        <div class="statline">
          <div><b>${stats.ab}</b><span>AB</span></div>
          <div><b>${stats.hits}</b><span>H</span></div>
          <div><b>${stats.homeRuns}</b><span>HR</span></div>
          <div><b>${stats.rbi}</b><span>RBI</span></div>
        </div>
        <div class="tiny muted" style="margin-top:12px;text-align:center">${esc(line)}</div>
        ${
          summary.putouts + summary.errors > 0
            ? `<div class="tiny muted" style="margin-top:6px;text-align:center">
                 In the field: ${summary.putouts} putout${summary.putouts === 1 ? '' : 's'},
                 ${summary.errors} error${summary.errors === 1 ? '' : 's'}
               </div>`
            : ''
        }
      </div>

      <div class="panel">
        <h2>Payday</h2>
        <div class="reward"><span>${esc(contractById(save.player.contract).name)}</span><b>${formatMoney(summary.earnings.salary)}</b></div>
        <div class="reward"><span>Performance bonus</span><b>${formatMoney(summary.earnings.bonus)}</b></div>
        ${
          summary.life.endorsements > 0
            ? `<div class="reward"><span>Endorsements</span><b>${formatMoney(summary.life.endorsements)}</b></div>`
            : ''
        }
        ${
          summary.life.agentCut > 0
            ? `<div class="reward"><span>Agent's cut</span><b class="down">−${formatMoney(summary.life.agentCut)}</b></div>`
            : ''
        }
        ${
          summary.life.upkeep > 0
            ? `<div class="reward"><span>Home &amp; upkeep</span><b class="down">−${formatMoney(summary.life.upkeep)}</b></div>`
            : ''
        }
        <div class="reward total"><span>In the bank</span><b>${formatMoney(save.player.money)}</b></div>
      </div>

      ${
        summary.life.notes.length > 0
          ? `<div class="notice">${summary.life.notes.map((n) => esc(n)).join('<br/>')}</div>`
          : ''
      }
      ${
        summary.wornOut.length > 0
          ? `<div class="notice warn">
               ${esc(summary.wornOut.join(' and '))} ${summary.wornOut.length === 1 ? 'has' : 'have'}
               worn out. Replace ${summary.wornOut.length === 1 ? 'it' : 'them'} in the gear store.
             </div>`
          : ''
      }

      <div class="panel">
        <h2>Development</h2>
        <div class="reward"><span>Experience earned</span><b>+${summary.xp} XP</b></div>
        ${
          summary.levelsGained > 0
            ? `<div class="reward"><span>Level up ×${summary.levelsGained}</span><b>+${summary.pointsGained} pts</b></div>`
            : ''
        }
        <div class="reward">
          <span>${cup ? 'Tournament average' : 'Season average'}</span>
          <b>${cup ? tournamentAvg : battingAverage(save.player.season)}</b>
        </div>
        <div class="reward"><span>Stamina</span><b>${Math.round(save.player.stamina)}%</b></div>
        <div class="reward">
          <span>Fame · ${esc(fameLabel(summary.life.fame))}</span>
          <b id="fameLine">${Math.round(summary.life.fame)}${
            summary.life.fameGain >= 0.5 ? ` <i class="gear-up">+${Math.round(summary.life.fameGain)}</i>` : ''
          }</b>
        </div>
      </div>

      ${
        summary.newAchievements.length > 0
          ? `<div class="notice">
               Achievement${summary.newAchievements.length === 1 ? '' : 's'} unlocked:
               <b>${summary.newAchievements.map((name) => esc(name)).join('</b>, <b>')}</b>.
               Claim your points from the Achievements menu in the clubhouse.
             </div>`
          : ''
      }
      ${
        summary.levelsGained > 0
          ? `<div class="notice">You leveled up. Spend your points in Training &amp; Development before the next game.</div>`
          : ''
      }
      ${
        save.player.stamina < 35
          ? `<div class="notice warn">You're running on empty. A low stamina bar shrinks your sweet spot on the ball — get a rest day or some conditioning in.</div>`
          : ''
      }
    </div>

    <button class="btn primary" id="next">${
      summary.seasonComplete ? 'Awards Night' : 'Back to Clubhouse'
    }</button>
  `;

  q(mount, '#next').addEventListener('click', () => {
    // The year ends with the awards, then the front office review.
    app.go(summary.seasonComplete ? 'awards' : 'hub');
  });

  // The quote is given once. The panel turns into what you said and what it
  // did, and the moment is cleared so a reload doesn't ask again.
  for (const button of qa<HTMLButtonElement>(mount, '[data-answer]')) {
    button.addEventListener('click', () => {
      const moment = summary.life.media;
      if (!moment) return;
      const answer = button.dataset.answer as MediaAnswer;
      const life = lifestyleOf(save);
      const result = answerMedia(life, answer, moment.win);
      addClubhouse(life, result.clubhouse);
      summary.life.media = null;
      summary.life.fame = life.fame;
      app.persist();
      const fameNote =
        result.fame > 0 ? `+${result.fame} fame.` : result.fame < 0 ? `${result.fame} fame.` : '';
      q(mount, '#press').innerHTML = `
        <h2>In the tunnel</h2>
        <p class="tiny" style="margin:0 0 6px; line-height:1.55"><i>"${esc(MEDIA_ANSWERS[answer].quote)}"</i></p>
        <p class="tiny muted" style="margin:0">${esc(result.line)} ${esc(fameNote)}</p>`;
      q(mount, '#fameLine').textContent = String(Math.round(life.fame));
    });
  }
}
