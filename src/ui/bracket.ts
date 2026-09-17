import type { LeagueState } from '../core/league';
import { teamById, teamKit } from '../core/league';
import type { PlayoffRound, PlayoffSeries } from '../core/playoffs';
import { BYE_SEEDS, ROUND_BEST_OF, ROUND_LABEL, ROUND_ORDER, seriesOver, winsNeeded } from '../core/playoffs';
import { esc } from './dom';

/**
 * The postseason bracket as a panel body: one block per round, each series
 * as a two-row card, the leader in bold, the winner ticked. The top seeds
 * sit in the wildcard block as byes, and a round that hasn't formed yet is
 * greyed with a note on what it's waiting for.
 */
export function bracketHtml(league: LeagueState): string {
  const p = league.playoffs;
  if (!p) return '';

  const champion = p.championId ? teamById(league, p.championId) : null;
  const trophy = champion
    ? `<div class="champion-line">
         <span class="trophy">🏆</span>
         <span>${esc(champion.name)}${p.championId === league.playerTeamId ? ' — that’s you' : ''}</span>
       </div>`
    : '';

  const waitingOn: Record<PlayoffRound, string> = {
    wildcard: '',
    semifinal: 'Waiting on the wildcard round',
    final: 'Waiting on the semifinals',
  };

  const rounds = ROUND_ORDER.map((round) => {
    const series = p.series.filter((s) => s.round === round);
    const byes =
      round === 'wildcard'
        ? p.seeds.slice(0, BYE_SEEDS).map((id, i) => byeCard(league, id, i + 1)).join('')
        : '';
    const body =
      series.length > 0
        ? series.map((s) => seriesCard(league, s)).join('')
        : `<div class="series-card pending"><span class="tiny muted">${waitingOn[round]}</span></div>`;
    return `
      <div class="bracket-round">
        <div class="bracket-title">${ROUND_LABEL[round]} · best of ${ROUND_BEST_OF[round]}</div>
        ${byes}${body}
      </div>`;
  }).join('');

  return `<div class="bracket">${rounds}</div>${trophy}`;
}

function byeCard(league: LeagueState, id: string, seed: number): string {
  const team = teamById(league, id);
  const kit = teamKit(league, id);
  const me = id === league.playerTeamId;
  return `
    <div class="series-card bye" title="Straight through to the semifinal">
      <div class="series-row ${me ? 'me' : ''}">
        <span class="seed">${seed}</span>
        <i class="kit-chip" style="background:${kit.accent}"></i>
        <span class="name">${esc(team.name)}</span>
        <span class="wins tiny muted">BYE</span>
      </div>
    </div>`;
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
