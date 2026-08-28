/**
 * The Baseball World Trophy screen: your group, everybody else's group, the
 * bracket, and what the career has done in past tournaments.
 *
 * A sixteen-team bracket doesn't fit across a phone, so it isn't drawn as one.
 * Each round is a column of cards instead, read top to bottom, with your own
 * country pinned in gold wherever it appears — which is the only thing anyone
 * is actually scanning for.
 */
import type { App } from '../app';
import type { Team } from '../core/league';
import { gamesPlayed, runDiff } from '../core/league';
import { formatDiff } from '../core/seasonStats';
import type { CupMatch, CupRound } from '../core/worldCup';
import {
  GROUP_MATCHDAYS,
  KNOCKOUT_ROUNDS,
  ROUND_LABEL,
  cupTeam,
  groupOf,
  groupStageDone,
  groupTable,
  matchWinner,
  matchesIn,
  nationOfTeam,
  qualifiers,
} from '../core/worldCup';
import { esc, q } from '../ui/dom';

export function renderWorldCup(app: App, mount: HTMLElement): void {
  const save = app.requireSave();
  const cup = save.worldCup;

  if (!cup) {
    mount.innerHTML = `
      <div class="scroll">
        <div class="panel">
          <h2>Baseball World Trophy</h2>
          <p class="tiny muted">No tournament this year. It is played every fourth year.</p>
        </div>
      </div>
      <button class="btn primary" id="back">Back to Clubhouse</button>`;
    q(mount, '#back').addEventListener('click', () => app.go('hub'));
    return;
  }

  const me = cup.nationId;
  const myNation = nationOfTeam(me);
  const myGroup = groupOf(cup, me);
  const through = groupStageDone(cup) ? qualifiers(cup) : [];
  const qualified = new Set(through.map((t) => t.id));

  /* -------------------------------------------------------------- header */

  const verdict = ((): { text: string; cls: string } => {
    switch (cup.playerResult) {
      case 'champion':
        return { text: 'WORLD CHAMPIONS', cls: 'champ' };
      case 'missed':
        return { text: 'NOT SELECTED', cls: 'tie' };
      case 'eliminated':
        return { text: 'OUT', cls: 'loss' };
      default:
        return { text: 'IN THE HUNT', cls: 'win' };
    }
  })();

  const champion = cup.championId ? nationOfTeam(cup.championId) : null;
  const runnerUp = cup.runnerUpId ? nationOfTeam(cup.runnerUpId) : null;

  /* --------------------------------------------------------- your standing */

  const yourPanel = ((): string => {
    if (cup.selection !== 'in') {
      const why =
        cup.selection === 'level'
          ? `${esc(myNation.name)} pick from Triple-A and the majors only.`
          : `${esc(myNation.name)} wanted a ${cup.bar} overall. Your case came to ${cup.yourCase}.`;
      return `
        <div class="panel">
          <h2>${myNation.flag} ${esc(myNation.name)}</h2>
          <div class="notice warn">You did not make the squad. ${why}</div>
          <p class="tiny muted" style="line-height:1.55">
            Getting picked takes ${cup.bar} overall and a place in Triple-A or the
            majors. The next tournament is four years away — that is four
            offseasons to close the gap.
          </p>
        </div>`;
    }

    const line = cup.playerStats;
    const avg = line.ab === 0 ? '.000' : (line.hits / line.ab).toFixed(3).replace(/^0/, '');
    return `
      <div class="panel">
        <h2>${myNation.flag} ${esc(myNation.name)}</h2>
        <div class="statline">
          <div class="key"><b>${avg}</b><span>AVG</span></div>
          <div><b>${line.hits}</b><span>H</span></div>
          <div><b>${line.homeRuns}</b><span>HR</span></div>
          <div><b>${line.rbi}</b><span>RBI</span></div>
        </div>
        <div class="tiny muted" style="margin-top:12px;text-align:center">
          ${line.games} game${line.games === 1 ? '' : 's'} for your country this tournament.
        </div>
      </div>`;
  })();

  /* -------------------------------------------------------- group tables */

  const tableHtml = (groupId: string): string => {
    const rows = groupTable(cup, groupId);
    const done = groupStageDone(cup);
    // Nothing is picked out until a game has actually been played. On an
    // untouched table every side is 0-0-0 and the sort falls through to
    // strength, so highlighting the top row would be marking the bookies'
    // favourite as though it had already gone through.
    const started = rows.some((t) => gamesPlayed(t) > 0);
    return `
      <table class="standings cup-table">
        <tr><th>Group ${esc(groupId)}</th><th>W</th><th>L</th><th>T</th><th>Diff</th></tr>
        ${rows
          .map((t) => {
            const nation = nationOfTeam(t.id);
            const mine = t.id === me;
            // Before the wildcards are known, the group leader is the only sure
            // thing; after, gold means through however you got there.
            const advancing = done
              ? qualified.has(t.id)
              : started && rows.indexOf(t) === 0;
            return `
          <tr class="${mine ? 'me' : ''} ${advancing ? 'clinched' : ''}">
            <td>${nation.flag} ${esc(nation.name)}${mine ? '<span class="you-tag">You</span>' : ''}</td>
            <td>${t.wins}</td><td>${t.losses}</td><td>${t.ties ?? 0}</td>
            <td class="${runDiff(t) > 0 ? 'up' : runDiff(t) < 0 ? 'down' : ''}">${formatDiff(runDiff(t))}</td>
          </tr>`;
          })
          .join('')}
      </table>`;
  };

  const played = myGroup ? gamesPlayed(cupTeam(cup, me)) : 0;

  const myGroupPanel = myGroup
    ? `<div class="panel">
         <h2>Your group</h2>
         ${tableHtml(myGroup.id)}
         <div class="tiny muted" style="margin-top:8px">
           ${
             groupStageDone(cup)
               ? 'x = through to the last sixteen.'
               : `Matchday ${Math.min(played + 1, GROUP_MATCHDAYS)} of ${GROUP_MATCHDAYS} · x leads the group. Group winners go through, plus the eight best records among everyone else.`
           }
         </div>
       </div>`
    : '';

  const otherGroupsPanel = `
    <div class="panel">
      <h2>Around the tournament</h2>
      <div class="cup-groups">
        ${cup.groups
          .filter((g) => g.id !== myGroup?.id)
          .map((g) => tableHtml(g.id))
          .join('')}
      </div>
    </div>`;

  /* -------------------------------------------------------------- bracket */

  const matchCard = (m: CupMatch): string => {
    const winner = m.played ? matchWinner(m) : null;
    const row = (id: string, seed: number | undefined, runs: number | undefined): string => {
      const nation = nationOfTeam(id);
      const won = winner === id;
      return `
        <div class="series-row ${id === me ? 'me' : ''} ${won ? 'won' : ''} ${
          m.played && !won ? 'lost' : ''
        }">
          <span class="seed">${seed ?? ''}</span>
          <span class="name">${nation.flag} ${esc(nation.name)}</span>
          <span class="wins">${runs ?? '–'}${won ? ' ✓' : ''}</span>
        </div>`;
    };
    return `
      <div class="series-card ${m.played ? 'done' : ''}">
        ${row(m.homeId, m.homeSeed, m.homeRuns)}
        ${row(m.awayId, m.awaySeed, m.awayRuns)}
      </div>`;
  };

  const bracketPanel = ((): string => {
    if (!cup.seeds) {
      return `
        <div class="panel">
          <h2>Knockout stage</h2>
          <p class="tiny muted">
            The last sixteen is drawn when the group stage finishes: the eight
            group winners and the eight best records behind them, seeded so the
            two best can only meet in the final.
          </p>
        </div>`;
    }

    const rounds = KNOCKOUT_ROUNDS.map((round: CupRound) => {
      const matches = matchesIn(cup, round);
      if (matches.length === 0) return '';
      return `
        <div class="bracket-round">
          <div class="bracket-title">${ROUND_LABEL[round]}</div>
          ${matches.map(matchCard).join('')}
        </div>`;
    }).join('');

    return `
      <div class="panel">
        <h2>Knockout stage</h2>
        <div class="cup-bracket">${rounds}</div>
        ${
          champion
            ? `<div class="champion-line">
                 <span class="trophy">🥇</span>
                 <span>${champion.flag} ${esc(champion.name)} lift the Trough${
                   cup.championId === me ? ' — that’s you' : ''
                 }${runnerUp ? ` · ${runnerUp.flag} ${esc(runnerUp.name)} runners-up` : ''}</span>
               </div>`
            : ''
        }
      </div>`;
  })();

  /* -------------------------------------------------------------- history */

  const history = save.cupHistory ?? [];
  const historyPanel =
    history.length > 1 || (history.length === 1 && history[0].year !== cup.year)
      ? `<div class="panel">
           <h2>Past tournaments</h2>
           ${[...history]
             .reverse()
             .map((r) => {
               const champ = r.championId ? nationOfTeam(r.championId) : null;
               const yours = nationOfTeam(r.nationId);
               const how =
                 r.playerResult === 'champion'
                   ? 'You won it'
                   : r.playerResult === 'missed'
                     ? 'Not selected'
                     : r.playerResult === 'eliminated'
                       ? `Out in the ${ROUND_LABEL[r.eliminatedIn ?? 'group']}`
                       : 'Played';
               return `
                 <div class="reward">
                   <span>Year ${r.year} · ${champ ? `${champ.flag} ${esc(champ.name)}` : '—'}</span>
                   <b>${yours.flag} ${esc(how)}</b>
                 </div>`;
             })
             .join('')}
         </div>`
      : '';

  mount.innerHTML = `
    <div class="scroll">
      <div class="panel result-hero">
        <div class="verdict ${verdict.cls}">${verdict.text}</div>
        <div class="score">Baseball World Trophy · Year ${cup.year}</div>
        <div class="tiny muted" style="margin-top:6px">
          Thirty-two countries. They call it the Trough.
        </div>
      </div>

      ${yourPanel}
      ${myGroupPanel}
      ${bracketPanel}
      ${otherGroupsPanel}
      ${historyPanel}
    </div>

    <button class="btn primary" id="back">Back to Clubhouse</button>
  `;

  q(mount, '#back').addEventListener('click', () => app.go('hub'));
}

/** A team's group-stage record, for the hub's one-line summary. */
export const cupRecordLine = (t: Team): string =>
  `${t.wins}-${t.losses}${(t.ties ?? 0) > 0 ? `-${t.ties}` : ''}`;
