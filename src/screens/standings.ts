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
import type { StandingsLine } from '../core/seasonStats';
import { formatDiff, formatPct, gamesBack, standingsLine } from '../core/seasonStats';
import { kitFor } from '../core/uniforms';
import { esc, q } from '../ui/dom';

/** One display row, whichever kind of league it came from. */
interface Row extends StandingsLine {
  name: string;
  accent: string;
  kitName: string;
  me: boolean;
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
          ...standingsLine(t),
          name: t.name,
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
        ...standingsLine(t),
        name: t.name,
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
      // The T column earns its place only once somebody in this level has one.
      const anyTies = rows.some((t) => t.ties > 0);
      return `
      <div class="panel">
        <div class="standings-head">
          <h2>${esc(level.name)}</h2>
          ${mine ? '<span class="you-tag">Your level</span>' : `<span class="tiny muted">${esc(level.short)}</span>`}
        </div>
        <div class="table-scroll">
          <table class="standings wide">
            <tr>
              <th>Team</th><th>W</th><th>L</th>${anyTies ? '<th>T</th>' : ''}
              <th>Pct</th><th>GB</th><th>RF</th><th>RA</th><th>Diff</th>
            </tr>
            ${rows
              .map(
                (t, i) => `
              <tr class="${t.me ? 'me' : ''} ${i === cutIndex ? 'cut' : ''}">
                <td><i class="kit-chip" style="background:${t.accent}" title="${esc(t.kitName)}"></i>${esc(t.name)}${
                  t.me ? '<span class="you-tag">You</span>' : ''
                }</td>
                <td>${t.wins}</td><td>${t.losses}</td>${anyTies ? `<td>${t.ties}</td>` : ''}
                <td>${formatPct(t.pct)}</td>
                <td>${leader ? gamesBack(leader, t) : '—'}</td>
                <td>${t.runsFor}</td><td>${t.runsAgainst}</td>
                <td class="${t.diff > 0 ? 'up' : t.diff < 0 ? 'down' : ''}">${formatDiff(t.diff)}</td>
              </tr>`,
              )
              .join('')}
          </table>
        </div>
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
          RF and RA are runs scored and allowed; a game still level after twelve
          innings is called a tie.
        </div>
        <button class="link-btn" id="fixtures">Your Season Log</button>
      </div>
      ${levelsHtml}
    </div>
    <button class="btn primary" id="done">Back to Clubhouse</button>`;

  q(mount, '#fixtures').addEventListener('click', () => app.go('fixtures'));
  q(mount, '#done').addEventListener('click', () => app.go('hub'));
}
