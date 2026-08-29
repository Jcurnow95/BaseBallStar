/**
 * Awards night. The last thing that happens in a season year, before the front
 * office sits you down for the review: every league in the system announces
 * its MVP, and yours is the ballot you were actually on.
 */
import type { App } from '../app';
import type { MvpAward, MvpCandidate } from '../core/awards';
import { ensureSeasonAwards, mvpBonus, mvpSeasons, playerMvp } from '../core/awards';
import { LEVELS } from '../core/league';
import { formatMoney } from '../core/gear';
import { battingAverage, ops } from '../core/player';
import { esc, q } from '../ui/dom';

const ordinal = (n: number): string =>
  `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** The four numbers an MVP argument is actually made of. */
const statlineHtml = (award: MvpAward | MvpCandidate): string => `
  <div class="statline">
    <div class="key"><b>${battingAverage(award.stats)}</b><span>AVG</span></div>
    <div><b>${award.stats.homeRuns}</b><span>HR</span></div>
    <div><b>${award.stats.rbi}</b><span>RBI</span></div>
    <div class="key"><b>${ops(award.stats)}</b><span>OPS</span></div>
  </div>`;

export function renderAwards(app: App, mount: HTMLElement): void {
  const save = app.requireSave();
  const { player, league } = save;

  // Voted the first time this page is opened and kept from then on, so the
  // review screen pays out on exactly the ballot the player just read.
  const awards = ensureSeasonAwards(save.awards, player, league, save.seasonYear, app.rng);
  app.persist();

  const mine = awards.mvps[awards.playerLevelId];
  const won = playerMvp(awards) !== null;
  const others = awards.mvps.filter((m) => m.levelId !== awards.playerLevelId);
  const trophies = mvpSeasons(save.awards);

  // Where you landed, in the words a broadcast would use.
  const finishLine = ((): string => {
    if (won) {
      const runnerUp = mine.ballot[1];
      if (mine.votePct >= 85) return `A runaway — ${mine.votePct}% of the first-place vote.`;
      if (mine.votePct >= 55) return `You took it with ${mine.votePct}% of the first-place vote.`;
      // Escaped once, by the caller — every branch here returns plain text.
      return `You edged ${runnerUp?.name ?? 'the field'}, ${mine.votePct}% to ${
        runnerUp?.votePct ?? 0
      }%.`;
    }
    if (awards.playerFinish === 0) {
      return `You didn't appear on a ballot this year. ${mine.winner} did.`;
    }
    if (awards.playerFinish <= 5) {
      return `You finished ${ordinal(awards.playerFinish)} in the voting.`;
    }
    return `You finished ${ordinal(awards.playerFinish)}, off the ballot. ${mine.winner} took it.`;
  })();

  mount.innerHTML = `
    <div class="scroll">
      <div class="panel result-hero">
        <div class="verdict ${won ? 'champ' : 'tie'}">${won ? 'MVP' : 'AWARDS NIGHT'}</div>
        <div class="score">Season ${save.seasonYear} · ${esc(LEVELS[awards.playerLevelId].name)}</div>
      </div>

      <div class="panel">
        <h2>${esc(LEVELS[mine.levelId].name)} Most Valuable Player</h2>
        <div class="mvp-card ${won ? 'me' : ''}">
          <div class="mvp-trophy">🏆</div>
          <div class="mvp-who">
            <strong>${esc(mine.winner)}</strong>
            <span>${esc(mine.teamName)}</span>
          </div>
          <div class="ovr">
            <b>${mine.votePct}%</b>
            <span>of vote</span>
          </div>
        </div>
        ${statlineHtml(mine)}
        <p class="tiny" style="margin:12px 0 0; line-height:1.55">${esc(finishLine)}</p>
        ${
          won
            ? `<div class="reward" style="margin-top:10px"><span>MVP bonus</span><b>${formatMoney(
                mvpBonus(mine.levelId),
              )}</b></div>
               <div class="reward"><span>Offseason work</span><b>+1 attribute point</b></div>`
            : ''
        }
      </div>

      <div class="panel">
        <h2>The ballot</h2>
        <table class="standings ballot">
          <tr><th>#</th><th>Player</th><th>Vote</th><th>AVG</th><th>HR</th><th>RBI</th></tr>
          ${mine.ballot
            .map(
              (c, i) => `
            <tr class="${c.isPlayer ? 'me' : ''}">
              <td>${i + 1}</td>
              <td>${esc(c.name)}${c.isPlayer ? '<span class="you-tag">You</span>' : ''}
                <i class="tiny muted">${esc(c.teamName)}</i></td>
              <td>${c.votePct}%</td>
              <td>${battingAverage(c.stats)}</td>
              <td>${c.stats.homeRuns}</td>
              <td>${c.stats.rbi}</td>
            </tr>`,
            )
            .join('')}
        </table>
        <div class="tiny muted" style="margin-top:8px">
          Top ${mine.ballot.length} of every bat in the ${esc(LEVELS[mine.levelId].name)}.
          Voters weigh OPS first, then the power numbers, then whether the club won.
        </div>
      </div>

      <div class="panel">
        <h2>Around the organization</h2>
        ${others
          .map(
            (m) => `
          <div class="award-row">
            <span class="lvl">${esc(LEVELS[m.levelId].short)}</span>
            <div class="what">
              <strong>${esc(m.winner)}</strong>
              <i>${esc(m.teamName)} · ${battingAverage(m.stats)} · ${m.stats.homeRuns} HR · ${
                m.stats.rbi
              } RBI</i>
            </div>
            <span class="share">${m.votePct}%</span>
          </div>`,
          )
          .join('')}
        <div class="tiny muted" style="margin-top:10px">
          Every league votes its own MVP. Climb, and these are the names you'll be on a
          ballot with.
        </div>
      </div>

      <div class="panel">
        <h2>Trophy case</h2>
        ${
          trophies.length > 0
            ? trophies
                .map(
                  (t) => `
              <div class="reward">
                <span>🏆 Season ${t.year} · ${esc(LEVELS[t.levelId].name)}</span>
                <b>MVP</b>
              </div>`,
                )
                .join('')
            : `<p class="tiny muted" style="margin:0; line-height:1.55">
                 Empty. Win a league MVP and it lives here for the rest of your career.
               </p>`
        }
      </div>
    </div>

    <button class="btn primary" id="next">Season Review</button>
  `;

  q(mount, '#next').addEventListener('click', () => app.go('seasonEnd'));
}
