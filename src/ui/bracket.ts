import type { LeagueState } from '../core/league';
import { teamById, teamKit } from '../core/league';
import type { PlayoffSeries } from '../core/playoffs';
import { ROUND_LABEL, seriesOver, winsNeeded } from '../core/playoffs';
import { esc } from './dom';

/**
 * The postseason bracket as a panel body: each series as a two-row card, the
 * leader in bold, the winner ticked, and the final greyed until it exists.
 */
export function bracketHtml(league: LeagueState): string {
  const p = league.playoffs;
  if (!p) return '';

  const semis = p.series.filter((s) => s.round === 'semifinal');
  const final = p.series.find((s) => s.round === 'final');

  const champion = p.championId ? teamById(league, p.championId) : null;
  const trophy = champion
    ? `<div class="champion-line">
         <span class="trophy">🏆</span>
         <span>${esc(champion.name)}${p.championId === league.playerTeamId ? ' — that’s you' : ''}</span>
       </div>`
    : '';

  return `
    <div class="bracket">
      <div class="bracket-round">
        <div class="bracket-title">${ROUND_LABEL.semifinal} · best of 3</div>
        ${semis.map((s) => seriesCard(league, s)).join('')}
      </div>
      <div class="bracket-round">
        <div class="bracket-title">${ROUND_LABEL.final} · best of 5</div>
        ${final ? seriesCard(league, final) : `<div class="series-card pending"><span class="tiny muted">Waiting on the semifinals</span></div>`}
      </div>
    </div>
    ${trophy}`;
}

function seriesCard(league: LeagueState, s: PlayoffSeries): string {
  const need = winsNeeded(s);
  const row = (id: string, seed: number, wins: number, otherWins: number): string => {
    const team = teamById(league, id);
    const kit = teamKit(league, id);
    const me = id === league.playerTeamId;
    const won = s.winnerId === id;
    const lost = seriesOver(s) && !won;
    const leading = !seriesOver(s) && wins > otherWins;
    return `
      <div class="series-row ${me ? 'me' : ''} ${won ? 'won' : ''} ${lost ? 'lost' : ''} ${leading ? 'leading' : ''}">
        <span class="seed">${seed}</span>
        <i class="kit-chip" style="background:${kit.accent}"></i>
        <span class="name">${esc(team.name)}</span>
        <span class="wins">${wins}${won ? ' ✓' : ''}</span>
      </div>`;
  };
  return `
    <div class="series-card ${seriesOver(s) ? 'done' : ''}" title="First to ${need}">
      ${row(s.highId, s.highSeed, s.highWins, s.lowWins)}
      ${row(s.lowId, s.lowSeed, s.lowWins, s.highWins)}
    </div>`;
}
