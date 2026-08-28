import type { App } from '../app';
import {
  LEVELS,
  SEASON_GAMES,
  playoffSeedOrder,
  regularSeasonGames,
  teamKit,
} from '../core/league';
import { syncOtherLevels, tableStandings } from '../core/otherLeagues';
import { PLAYOFF_TEAMS } from '../core/playoffs';
import { kitFor } from '../core/uniforms';
import { esc, q } from '../ui/dom';

/** One display row, whichever kind of league it came from. */
interface Row {
  name: string;
  wins: number;
  losses: number;
  accent: string;
  kitName: string;
  me: boolean;
}

/** Games behind the leader, in the usual half-game currency. */
function gamesBack(leader: Row, t: Row): string {
  const gb = (leader.wins - t.wins + (t.losses - leader.losses)) / 2;
  if (gb <= 0) return '—';
  return gb % 1 === 0 ? String(gb) : gb.toFixed(1);
}

export function renderStandings(app: App, mount: HTMLElement): void {
  const save = app.requireSave();
  const league = save.league;

  // The rest of the ladder plays on your schedule: catch every other level up
  // to your games-played count before showing anything.
  syncOtherLevels(save, app.rng);
  app.persist();

  const rowsFor = (levelId: number): Row[] => {
    if (levelId === league.levelId) {
      return playoffSeedOrder(league).map((t) => {
        const kit = teamKit(league, t.id);
        return {
          name: t.name,
          wins: t.wins,
          losses: t.losses,
          accent: kit.accent,
          kitName: kit.name,
          me: t.id === league.playerTeamId,
        };
      });
    }
    const table = (save.otherLevels ?? []).find((t) => t.levelId === levelId);
    if (!table) return [];
    return tableStandings(table).map((t, i) => {
      const kit = kitFor(t.kitId, i);
      return {
        name: t.name,
        wins: t.wins,
        losses: t.losses,
        accent: kit.accent,
        kitName: kit.name,
        me: false,
      };
    });
  };

  const played = regularSeasonGames(league).filter((g) => g.played).length;
  const seasonLine =
    played >= SEASON_GAMES
      ? 'Regular season complete at every level.'
      : `${played} of ${SEASON_GAMES} games played at every level.`;

  // Top of the ladder first: the place you're playing to get to.
  const levelsHtml = [...LEVELS]
    .reverse()
    .map((level) => {
      const rows = rowsFor(level.id);
      const leader = rows[0];
      const mine = level.id === league.levelId;
      const cutIndex = mine && !league.playoffs ? PLAYOFF_TEAMS - 1 : -1;
      return `
      <div class="panel">
        <div class="standings-head">
          <h2>${esc(level.name)}</h2>
          ${mine ? '<span class="you-tag">Your level</span>' : `<span class="tiny muted">${esc(level.short)}</span>`}
        </div>
        <table class="standings">
          <tr><th>Team</th><th>W</th><th>L</th><th>GB</th></tr>
          ${rows
            .map(
              (t, i) => `
            <tr class="${t.me ? 'me' : ''} ${i === cutIndex ? 'cut' : ''}">
              <td><i class="kit-chip" style="background:${t.accent}" title="${esc(t.kitName)}"></i>${esc(t.name)}${
                t.me ? '<span class="you-tag">You</span>' : ''
              }</td>
              <td>${t.wins}</td><td>${t.losses}</td>
              <td>${leader ? gamesBack(leader, t) : '—'}</td>
            </tr>`,
            )
            .join('')}
        </table>
        ${
          cutIndex >= 0
            ? `<div class="tiny muted" style="margin-top:8px">Top ${PLAYOFF_TEAMS} make the playoffs.</div>`
            : ''
        }
      </div>`;
    })
    .join('');

  mount.innerHTML = `
    <div class="scroll">
      <div class="panel">
        <h2>Around the leagues</h2>
        <div class="tiny muted">
          Every level of the ladder, top to bottom. ${seasonLine}
        </div>
      </div>
      ${levelsHtml}
    </div>
    <button class="btn primary" id="done">Back to Clubhouse</button>`;

  q(mount, '#done').addEventListener('click', () => app.go('hub'));
}
