import type { App } from '../app';
import { LEVELS, createLeague, playerTeam, rolloverSeason, standings, teamById } from '../core/league';
import { ROUND_LABEL } from '../core/playoffs';
import { ensureSeasonAwards, mvpBonus, playerMvp } from '../core/awards';
import { bracketHtml } from '../ui/bracket';
import { formatMoney } from '../core/gear';
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

  // The postseason, in a line. A title is worth a ring bonus, paid once here.
  const playoffs = league.playoffs;
  const champion = playoffs?.playerResult === 'champion';
  const RING_BONUS = 400 * (league.levelId + 1);

  // Awards night has usually already run, but this screen is also where an old
  // save that was parked at the end of a year comes back in, so vote them here
  // if nobody has. Idempotent either way — the ballot is kept in the save.
  const awards = ensureSeasonAwards(save.awards, player, league, save.seasonYear, app.rng);
  // Pin them now rather than on the way out: a player who reads the review and
  // closes the app should come back to the same ballot, not a fresh vote.
  app.persist();
  const mvp = playerMvp(awards);
  const MVP_BONUS = mvpBonus(league.levelId);
  const leagueMvp = awards.mvps[awards.playerLevelId];
  const postseasonLine = ((): string => {
    if (!playoffs) return 'No postseason was played.';
    const champ = playoffs.championId ? teamById(league, playoffs.championId).name : '—';
    switch (playoffs.playerResult) {
      case 'champion':
        return `${level.name} champions.`;
      case 'eliminated':
        return `Out in the ${ROUND_LABEL[playoffs.eliminatedIn ?? 'semifinal']} · champions: ${champ}`;
      case 'missed':
        return `Missed the playoffs · champions: ${champ}`;
      default:
        return `Champions: ${champ}`;
    }
  })();

  mount.innerHTML = `
    <div class="scroll">
      <div class="panel result-hero">
        <div class="verdict ${check.promoted ? 'win' : champion || mvp ? 'champ' : 'tie'}">
          ${check.promoted ? 'CALLED UP' : champion ? 'CHAMPIONS' : mvp ? 'LEAGUE MVP' : 'SEASON OVER'}
        </div>
        <div class="score">Season ${save.seasonYear} · ${esc(level.name)}</div>
      </div>

      ${
        playoffs
          ? `<div class="panel">
               <h2>Postseason</h2>
               <p class="tiny" style="margin:0 0 10px; line-height:1.55">${esc(postseasonLine)}</p>
               ${bracketHtml(league)}
               ${
                 champion
                   ? `<div class="reward" style="margin-top:10px"><span>Ring bonus</span><b>${formatMoney(RING_BONUS)}</b></div>`
                   : ''
               }
             </div>`
          : ''
      }

      <div class="panel">
        <h2>Awards</h2>
        <div class="reward">
          <span>${esc(level.name)} MVP</span>
          <b>${esc(leagueMvp.winner)}${mvp ? ' 🏆' : ''}</b>
        </div>
        <div class="reward">
          <span>Your finish in the voting</span>
          <b>${awards.playerFinish > 0 ? `${awards.playerFinish}${awards.playerFinish === 1 ? 'st' : awards.playerFinish === 2 ? 'nd' : awards.playerFinish === 3 ? 'rd' : 'th'}` : 'Unranked'}</b>
        </div>
        ${
          mvp
            ? `<div class="reward"><span>MVP bonus</span><b>${formatMoney(MVP_BONUS)}</b></div>`
            : ''
        }
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
        <div class="reward"><span>Postseason</span><b>${esc(postseasonLine)}</b></div>
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
    // Roll the career forward: fresh season stats, restored body — and either
    // a call-up to a whole new league, or another year in this one, where the
    // clubs you know come back with a winter of change in their clubhouses.
    save.seasonYear++;
    let clubhouseNews: string[] = [];
    if (check.promoted) {
      save.league = createLeague(check.nextLevelId, app.rng);
    } else {
      clubhouseNews = rolloverSeason(save.league, app.rng);
    }
    player.season = emptyBattingStats();
    player.stamina = 100;
    player.energy = 100;
    // An offseason of work is worth a couple of free points; a ring, a bit
    // more; an MVP trophy, more again — it's the one thing you can win on your
    // own numbers rather than the club's.
    player.attributePoints += 2 + (check.promoted ? 2 : 0) + (champion ? 1 : 0) + (mvp ? 1 : 0);
    if (champion) player.money += RING_BONUS;
    if (mvp) player.money += MVP_BONUS;

    app.lastGame = null;
    app.persist();

    const newsText = clubhouseNews.length
      ? `\n\nClubhouse news:\n${clubhouseNews.map((line) => `· ${line}`).join('\n')}`
      : '';
    await showDialog({
      title: `Season ${save.seasonYear} — ${LEVELS[save.league.levelId].name}`,
      body:
        `You report to the ${playerTeam(save.league).name}.\n` +
        `Overall ${overallRating(player.attributes)} · ${player.attributePoints} attribute points to spend.` +
        (mvp ? `\nYou arrive as the reigning ${LEVELS[mvp.levelId].name} MVP.` : '') +
        newsText,
      confirmLabel: 'Report to camp',
    });
    app.go('hub');
  });
}
