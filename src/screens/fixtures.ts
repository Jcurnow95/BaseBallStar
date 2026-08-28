import type { App } from '../app';
import { LEVELS, SEASON_GAMES, playerTeam, teamKit } from '../core/league';
import type { Fixture, SeasonSplits, Tally } from '../core/seasonStats';
import {
  formatDiff,
  formatPct,
  formatTally,
  seasonLog,
  seasonSplits,
  wentToExtras,
} from '../core/seasonStats';
import { esc, q } from '../ui/dom';

/**
 * The season card. Every fixture the club has played and every one still to
 * come, with the splits underneath that a real standings page carries: home
 * and away, one-run games, extras, shutouts, the streak, and what the run
 * totals say the record should have been.
 */

const RESULT_LABEL: Record<string, string> = { win: 'W', loss: 'L', tie: 'T' };

/** A tally, or a dash when nothing has fallen into that bucket yet. */
const tallyText = (t: Tally): string =>
  t.wins + t.losses + t.ties === 0 ? '—' : formatTally(t);

/** The score as a line reads it, with the inning count on a game that went long. */
function scoreText(f: Fixture): string {
  const score = `${f.runsFor}-${f.runsAgainst}`;
  return wentToExtras(f) ? `${score} <span class="tiny muted">/${f.innings}</span>` : score;
}

/** One game, or one still on the card. */
function fixtureRow(f: Fixture): string {
  const matchup = `${f.home ? 'vs' : '@'} ${esc(f.opponent)}`;
  if (!f.played) {
    return `
      <tr class="ahead">
        <td>${f.game}</td>
        <td>${matchup}</td>
        <td colspan="3" class="tiny muted">To play</td>
      </tr>`;
  }
  const result = f.result!;
  return `
    <tr>
      <td>${f.game}</td>
      <td>${matchup}</td>
      <td><span class="res ${result}">${RESULT_LABEL[result]}</span></td>
      <td>${scoreText(f)}</td>
      <td class="tiny muted">${formatTally(f.record!)}</td>
    </tr>`;
}

/** A split, written the way a broadcast graphic writes it. */
const splitRow = (label: string, value: string, note = ''): string => `
  <div class="reward">
    <span>${esc(label)}${note ? ` <span class="tiny muted">${esc(note)}</span>` : ''}</span>
    <b>${value}</b>
  </div>`;

/** The biggest win and the heaviest defeat, when there have been any. */
function marginRows(splits: SeasonSplits): string {
  const line = (f: Fixture): string =>
    `${f.runsFor}-${f.runsAgainst} ${f.home ? 'vs' : '@'} ${esc(f.opponent)}`;
  return (
    (splits.bestWin ? splitRow('Biggest win', line(splits.bestWin)) : '') +
    (splits.worstLoss ? splitRow('Heaviest defeat', line(splits.worstLoss)) : '')
  );
}

export function renderFixtures(app: App, mount: HTMLElement): void {
  const save = app.requireSave();
  const league = save.league;
  const team = playerTeam(league);
  const kit = teamKit(league, team.id);
  const level = LEVELS[league.levelId];

  const log = seasonLog(league);
  const splits = seasonSplits(league);

  const streak = splits.streak
    ? `${RESULT_LABEL[splits.streak.result]}${splits.streak.length}`
    : '—';

  // The pythagorean line only says something once there are runs behind it.
  const pythagorean =
    splits.played === 0
      ? '—'
      : `${splits.pythagorean.wins}-${splits.pythagorean.losses}`;
  const luck = splits.overall.wins - splits.pythagorean.wins;
  const luckNote =
    splits.played < 5
      ? ''
      : luck > 1
        ? `${luck} ahead of it`
        : luck < -1
          ? `${-luck} behind it`
          : 'right on it';

  mount.innerHTML = `
    <div class="scroll">
      <div class="panel">
        <div class="standings-head">
          <h2><i class="kit-chip" style="background:${kit.accent}"></i>${esc(team.name)}</h2>
          <span class="tiny muted">${esc(level.name)} · Year ${save.seasonYear}</span>
        </div>
        <div class="statline" style="margin-top:12px">
          <div class="key"><b>${formatTally(splits.overall)}</b><span>Record</span></div>
          <div><b>${formatPct(splits.pct)}</b><span>Pct</span></div>
          <div><b>${formatDiff(splits.diff)}</b><span>Diff</span></div>
          <div><b>${streak}</b><span>Streak</span></div>
        </div>
        <div class="tiny muted" style="margin-top:10px">
          ${splits.played} of ${SEASON_GAMES} games played.
          ${splits.overall.ties > 0
            ? `${splits.overall.ties === 1 ? 'One game' : `${splits.overall.ties} games`} called level after twelve innings.`
            : ''}
        </div>
      </div>

      <div class="panel">
        <h2>Runs</h2>
        <div class="statline">
          <div><b>${splits.runsFor}</b><span>For</span></div>
          <div><b>${splits.runsAgainst}</b><span>Against</span></div>
          <div><b>${splits.runsPerGame.toFixed(1)}</b><span>R/G</span></div>
          <div><b>${splits.runsAllowedPerGame.toFixed(1)}</b><span>RA/G</span></div>
        </div>
      </div>

      <div class="panel">
        <h2>Splits</h2>
        ${splitRow('Home', tallyText(splits.home))}
        ${splitRow('Away', tallyText(splits.away))}
        ${splitRow('Last 10', tallyText(splits.lastTen))}
        ${splitRow('One-run games', tallyText(splits.oneRun))}
        ${splitRow('Extra innings', tallyText(splits.extras))}
        ${splitRow('Decided by 5+', tallyText(splits.blowouts))}
        ${splitRow('Shutouts', `${splits.shutoutsFor} — ${splits.shutoutsAgainst}`, 'thrown — suffered')}
        ${splitRow('Expected record', pythagorean, luckNote)}
        ${marginRows(splits)}
        <div class="tiny muted" style="margin-top:10px">
          Expected record is what the runs scored and allowed say the club deserved.
        </div>
      </div>

      <div class="panel">
        <h2>Fixtures</h2>
        <table class="standings fixtures">
          <tr><th>#</th><th>Opponent</th><th>R</th><th>Score</th><th>Record</th></tr>
          ${log.map(fixtureRow).join('')}
        </table>
      </div>
    </div>
    <button class="btn primary" id="done">Back to Clubhouse</button>`;

  q(mount, '#done').addEventListener('click', () => app.go('hub'));
}
