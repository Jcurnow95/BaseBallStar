import type { App } from '../app';
import { LEVELS, createLeague, playerTeam, standings } from '../core/league';
import {
  battingAverage,
  emptyBattingStats,
  onBasePct,
  overallRating,
  slugging,
} from '../core/player';
import { checkPromotion } from '../core/progression';
import { esc, q } from '../ui/dom';
import { showDialog } from '../ui/modal';

export function renderSeasonEnd(app: App, mount: HTMLElement): void {
  const save = app.requireSave();
  const { player, league } = save;
  const level = LEVELS[league.levelId];
  const team = playerTeam(league);
  const check = checkPromotion(player, league.levelId);
  const finish = standings(league).findIndex((t) => t.id === league.playerTeamId) + 1;
  const suffix = finish === 1 ? 'st' : finish === 2 ? 'nd' : finish === 3 ? 'rd' : 'th';

  mount.innerHTML = `
    <div class="scroll">
      <div class="panel result-hero">
        <div class="verdict ${check.promoted ? 'win' : 'tie'}">
          ${check.promoted ? 'CALLED UP' : 'SEASON OVER'}
        </div>
        <div class="score">Season ${save.seasonYear} · ${esc(level.name)}</div>
      </div>

      <div class="panel">
        <h2>Final line</h2>
        <div class="statline">
          <div><b>${battingAverage(player.season)}</b><span>AVG</span></div>
          <div><b>${onBasePct(player.season)}</b><span>OBP</span></div>
          <div><b>${slugging(player.season)}</b><span>SLG</span></div>
          <div><b>${player.season.homeRuns}</b><span>HR</span></div>
        </div>
        <div class="statline" style="margin-top:12px">
          <div><b>${player.season.hits}</b><span>H</span></div>
          <div><b>${player.season.rbi}</b><span>RBI</span></div>
          <div><b>${player.season.walks}</b><span>BB</span></div>
          <div><b>${player.season.strikeouts}</b><span>SO</span></div>
        </div>
      </div>

      <div class="panel">
        <h2>Front office report</h2>
        <div class="reward"><span>Scout grade</span><b>${check.score}</b></div>
        <div class="reward"><span>Overall rating</span><b>${check.overall}</b></div>
        <div class="reward"><span>Team finish</span><b>${finish}${suffix} · ${team.wins}-${team.losses}</b></div>
        <p class="tiny" style="margin:12px 0 0; line-height:1.55">${esc(check.reason)}</p>
      </div>

      <div class="panel">
        <h2>Career totals</h2>
        <div class="statline">
          <div><b>${battingAverage(player.career)}</b><span>AVG</span></div>
          <div><b>${player.career.hits}</b><span>H</span></div>
          <div><b>${player.career.homeRuns}</b><span>HR</span></div>
          <div><b>${player.career.rbi}</b><span>RBI</span></div>
        </div>
      </div>
    </div>

    <button class="btn primary" id="next">
      ${check.promoted ? `Report to ${esc(LEVELS[check.nextLevelId].name)}` : 'Start Next Season'}
    </button>
  `;

  q(mount, '#next').addEventListener('click', async () => {
    // Roll the career forward: new league, fresh season stats, restored body.
    save.seasonYear++;
    save.league = createLeague(check.nextLevelId, app.rng);
    player.season = emptyBattingStats();
    player.stamina = 100;
    player.energy = 100;
    // An offseason of work is worth a couple of free points.
    player.attributePoints += 2 + (check.promoted ? 2 : 0);

    app.lastGame = null;
    app.persist();

    await showDialog({
      title: `Season ${save.seasonYear} — ${LEVELS[save.league.levelId].name}`,
      body:
        `You report to the ${playerTeam(save.league).name}.\n` +
        `Overall ${overallRating(player.attributes)} · ${player.attributePoints} attribute points to spend.`,
      confirmLabel: 'Report to camp',
    });
    app.go('hub');
  });
}
