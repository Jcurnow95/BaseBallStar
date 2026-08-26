import type { App } from '../app';
import { battingAverage } from '../core/player';
import { contractById, formatMoney } from '../core/gear';
import { ROUND_LABEL } from '../core/playoffs';
import { esc, q } from '../ui/dom';

export function renderPostGame(app: App, mount: HTMLElement): void {
  const summary = app.lastGame;
  if (!summary) {
    app.go('hub');
    return;
  }

  const save = app.requireSave();
  const { stats } = summary;
  const playoff = summary.playoff;
  const champion = playoff?.status === 'champion';
  const verdict = champion ? 'CHAMPIONS' : summary.tie ? 'TIE' : summary.win ? 'WIN' : 'LOSS';
  const verdictClass = champion ? 'champ' : summary.tie ? 'tie' : summary.win ? 'win' : 'loss';

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
        <div class="reward total"><span>In the bank</span><b>${formatMoney(save.player.money)}</b></div>
      </div>

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
        <div class="reward"><span>Season average</span><b>${battingAverage(save.player.season)}</b></div>
        <div class="reward"><span>Stamina</span><b>${Math.round(save.player.stamina)}%</b></div>
      </div>

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
      summary.seasonComplete ? 'Season Review' : 'Back to Clubhouse'
    }</button>
  `;

  q(mount, '#next').addEventListener('click', () => {
    app.go(summary.seasonComplete ? 'seasonEnd' : 'hub');
  });
}
