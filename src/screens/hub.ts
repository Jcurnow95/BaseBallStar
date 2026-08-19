import type { App } from '../app';
import {
  LEVELS,
  SEASON_GAMES,
  isRegularSeasonOver,
  isSeasonOver,
  nextGame,
  parkForGame,
  playerTeam,
  regularSeasonGames,
  standings,
  teamById,
  teamKit,
  weatherForGame,
} from '../core/league';
import {
  PLAYOFF_TEAMS,
  ROUND_LABEL,
  playerSeries,
  seriesLine,
  seriesOpponent,
  startPlayoffs,
} from '../core/playoffs';
import { bracketHtml } from '../ui/bracket';
import { ballparkById } from '../core/ballpark';
import { describeWeather } from '../core/weather';
import {
  GEAR_SLOTS,
  effectiveAttributes,
  formatMoney,
  gearBonuses,
} from '../core/gear';
import {
  ATTRIBUTE_LABELS,
  ATTRIBUTE_KEYS,
  battingAverage,
  onBasePct,
  overallRating,
  slugging,
} from '../core/player';
import { seasonScore, xpForLevel } from '../core/progression';
import { esc, meterHtml, q } from '../ui/dom';
import { showDialog } from '../ui/modal';
import { devMenuEnabled } from './dev';
import { howtoSeen, openHowto } from './howto';

export function renderHub(app: App, mount: HTMLElement): void {
  /**
   * Has this club locked up a playoff spot? Every club plays a game on every
   * one of your game days, so everyone has the same number left. Clinched when
   * fewer than `PLAYOFF_TEAMS` others could still catch its win total.
   */
  const clinched = (t: { id: string; wins: number; losses: number }): boolean => {
    const league = app.requireSave().league;
    if (league.playoffs) return false;
    const remaining = Math.max(0, SEASON_GAMES - (t.wins + t.losses));
    const threats = league.teams.filter(
      (o) => o.id !== t.id && o.wins + Math.max(0, SEASON_GAMES - (o.wins + o.losses)) >= t.wins,
    ).length;
    return remaining < SEASON_GAMES && threats < PLAYOFF_TEAMS;
  };

  const save = app.requireSave();
  const { player, league } = save;
  const level = LEVELS[league.levelId];
  const team = playerTeam(league);

  // A save that finished its regular season before there was a postseason
  // gets its bracket seeded on the way in.
  if (isRegularSeasonOver(league) && !league.playoffs) {
    startPlayoffs(league, app.rng);
    app.persist();
  }

  const upcoming = nextGame(league);
  const seasonDone = isSeasonOver(league);
  const gamesPlayed = regularSeasonGames(league).filter((g) => g.played).length;
  const playoffs = league.playoffs;
  const series = playerSeries(league);
  const ovr = overallRating(player.attributes);
  const homePark = ballparkById(team.parkId);

  // A strip of the days ahead, so you can see when the next off day lands.
  const calendarHtml = `
    <div class="calendar">
      ${league.calendar
        .map((day, index) => {
          const state =
            index < league.day ? 'past' : index === league.day ? 'now' : 'ahead';
          const kind =
            day.gameIndex == null
              ? 'off'
              : league.schedule[day.gameIndex]?.playoff
                ? 'game playoff'
                : 'game';
          return `<i class="cal-day ${kind} ${state}" title="Day ${index + 1}"></i>`;
        })
        .join('')}
    </div>
    <div class="cal-key tiny muted">
      <span><i class="cal-day game ahead"></i> game</span>
      <span><i class="cal-day off ahead"></i> off day</span>
      ${playoffs && playoffs.playerResult !== 'missed' ? '<span><i class="cal-day game playoff ahead"></i> playoff</span>' : ''}
      <span>Day ${Math.min(league.day + 1, league.calendar.length)} of ${league.calendar.length}</span>
    </div>`;

  // Development is reachable every day — you should never be locked out of
  // spending points or reading your own numbers because of the schedule.
  const devButton = `
    <button class="btn ghost" id="train" style="margin-top:8px">
      Player &amp; Development${player.attributePoints > 0 ? ` · ${player.attributePoints} pts` : ''}
    </button>`;

  // Gear is a live resource, so the clubhouse says what is in the bank and
  // shouts when something is about to fall apart.
  const bonuses = gearBonuses(player.gear);
  const gearOvr = overallRating({ ...player.attributes, ...effectiveAttributes(player) }) - ovr;
  const fraying = GEAR_SLOTS.map((s) => player.gear[s]).filter(
    (g): g is NonNullable<typeof g> => !!g && g.gamesLeft <= 2,
  ).length;
  const storeButton = `
    <button class="btn ghost" id="store" style="margin-top:8px">
      Gear Store · ${formatMoney(player.money)}${fraying > 0 ? ` · ${fraying} wearing out` : ''}
    </button>
    <button class="btn ghost tiny" id="howto" style="margin-top:8px">How to Play</button>`;

  // What the postseason meant for you, once it's settled.
  const wrapUp = ((): string => {
    if (!playoffs) return 'The regular season is over.';
    const champ = playoffs.championId ? teamById(league, playoffs.championId).name : 'Nobody';
    switch (playoffs.playerResult) {
      case 'champion':
        return `Champions! The ${esc(team.name)} took the ${esc(level.name)} title.`;
      case 'eliminated':
        return `Your run ended in the ${ROUND_LABEL[playoffs.eliminatedIn ?? 'semifinal']}. The ${esc(champ)} took the title.`;
      case 'missed':
        return `You missed the playoffs. The ${esc(champ)} took the title.`;
      default:
        return 'The season is over.';
    }
  })();

  let matchupHtml: string;
  if (seasonDone) {
    matchupHtml = `
      <div class="notice ${playoffs?.playerResult === 'champion' ? '' : 'warn'}" style="margin-bottom:12px">
        ${wrapUp} Time to find out what the organization thinks of you.
      </div>
      <button class="btn primary" id="finish">Season Review</button>
      ${devButton}
      ${storeButton}`;
  } else if (upcoming) {
    const park = parkForGame(league, upcoming);
    // A pre-weather save gets its forecast rolled here; pin it so the game
    // plays in the weather the clubhouse promised.
    const hadForecast = !!upcoming.weather;
    const weather = weatherForGame(upcoming, app.rng);
    if (!hadForecast) app.persist();
    const line = series ? seriesLine(league, series) : null;
    const gameLabel =
      upcoming.playoff && series
        ? `${ROUND_LABEL[series.round]} · Game ${upcoming.playoff.gameNo} of ${series.bestOf}`
        : `Game ${gamesPlayed + 1} of ${SEASON_GAMES}`;
    matchupHtml = `
      <div class="matchup">
        <div>
          <span class="vs" ${upcoming.playoff ? 'style="color:var(--gold)"' : ''}>${gameLabel}</span>
          <strong>${upcoming.home ? 'vs' : '@'} ${esc(teamById(league, upcoming.opponentId).name)}</strong>
          <span class="tiny muted">${esc(park.name)} · ${esc(describeWeather(weather))}</span>
        </div>
        <div class="ovr">
          <b>${line ? `${line.us}-${line.them}` : `${team.wins}-${team.losses}`}</b>
          <span>${line ? 'Series' : 'Record'}</span>
        </div>
      </div>
      ${calendarHtml}
      <button class="btn primary" id="play" style="margin-top:12px">Play Ball</button>
      ${devButton}
      ${storeButton}`;
  } else {
    const nextUp =
      series && playoffs?.playerResult === 'alive'
        ? `${ROUND_LABEL[series.round]} game ${series.highWins + series.lowWins + 1} vs the ${esc(seriesOpponent(league, series).name)} tomorrow.`
        : 'Get to work, or get some rest.';
    matchupHtml = `
      <div class="matchup">
        <div>
          <span class="vs">${series ? 'Playoff Workout Day' : 'Off Day'}</span>
          <strong>No game today</strong>
          <span class="tiny muted">${nextUp}</span>
        </div>
        <div class="ovr">
          <b>${team.wins}-${team.losses}</b>
          <span>Record</span>
        </div>
      </div>
      ${calendarHtml}
      <button class="btn primary" id="train" style="margin-top:12px">
        Train Today${player.attributePoints > 0 ? ` · ${player.attributePoints} pts` : ''}
      </button>
      ${storeButton}`;
  }

  const devEnabled = devMenuEnabled();

  mount.innerHTML = `
    <div class="scroll">
      ${
        devEnabled
          ? `<div class="dev-bar">
               <span>DEV BUILD</span>
               <button id="devmenu">Player stats</button>
             </div>`
          : ''
      }
      <div class="panel">
        <div class="hub-head">
          <div class="badge">${esc(player.position)}</div>
          <div class="who">
            <strong>${esc(player.name)}</strong>
            <span>${esc(level.name)} · ${esc(team.name)} · Bats ${player.bats} · Lv ${player.level}</span>
            <span class="tiny muted">Home: ${esc(homePark.name)}</span>
          </div>
          <div class="ovr">
            <b>${ovr}${gearOvr > 0 ? `<i class="gear-up">+${gearOvr}</i>` : ''}</b>
            <span>OVR</span>
          </div>
        </div>
        ${meterHtml('Stamina', player.stamina)}
        ${meterHtml('Energy', player.energy, 100, 'xp')}
        ${meterHtml('XP to next level', player.xp, xpForLevel(player.level), 'xp')}
      </div>

      <div class="panel">
        ${matchupHtml}
      </div>

      <div class="panel">
        <h2>Season at the plate</h2>
        <div class="statline">
          <div><b>${battingAverage(player.season)}</b><span>AVG</span></div>
          <div><b>${player.season.homeRuns}</b><span>HR</span></div>
          <div><b>${player.season.rbi}</b><span>RBI</span></div>
          <div><b>${player.season.stolenBases}</b><span>SB</span></div>
        </div>
        <div class="statline" style="margin-top:12px">
          <div><b>${onBasePct(player.season)}</b><span>OBP</span></div>
          <div><b>${slugging(player.season)}</b><span>SLG</span></div>
          <div><b>${player.season.walks}</b><span>BB</span></div>
          <div><b>${player.season.strikeouts}</b><span>SO</span></div>
        </div>
        <div class="tiny muted" style="margin-top:12px; text-align:center">
          Scout grade <b style="color:var(--gold)">${seasonScore(player.season)}</b> ·
          call-up needs ${level.promotionOverall} OVR and a ${level.promotionScore} grade
        </div>
      </div>

      <div class="panel">
        <h2>Attributes</h2>
        ${ATTRIBUTE_KEYS.map((key) => {
          const gain = bonuses[key] ?? 0;
          const total = Math.min(99, player.attributes[key] + gain);
          return `
          <div class="attr-row">
            <span class="name">${ATTRIBUTE_LABELS[key]}</span>
            <span class="track">
              <i style="width:${player.attributes[key]}%"></i>
              ${gain > 0 ? `<i class="gear" style="left:${player.attributes[key]}%;width:${total - player.attributes[key]}%"></i>` : ''}
            </span>
            <span class="val">${total}${gain > 0 ? `<i class="gear-up">+${gain}</i>` : ''}</span>
          </div>`;
        }).join('')}
      </div>

      ${
        playoffs
          ? `<div class="panel">
               <h2>${esc(level.name)} playoffs</h2>
               ${bracketHtml(league)}
             </div>`
          : ''
      }

      <div class="panel">
        <h2>${esc(level.name)} standings</h2>
        <table class="standings">
          <tr><th>Team</th><th>W</th><th>L</th></tr>
          ${standings(league)
            .map((t, i) => {
              const kit = teamKit(league, t.id);
              const cut = i === PLAYOFF_TEAMS - 1 && !playoffs;
              return `
            <tr class="${t.id === league.playerTeamId ? 'me' : ''} ${cut ? 'cut' : ''} ${clinched(t) ? 'clinched' : ''}">
              <td><i class="kit-chip" style="background:${kit.accent}" title="${esc(kit.name)}"></i>${esc(t.name)}</td>
              <td>${t.wins}</td><td>${t.losses}</td>
            </tr>`;
            })
            .join('')}
        </table>
        ${
          playoffs
            ? ''
            : `<div class="tiny muted" style="margin-top:8px">Top ${PLAYOFF_TEAMS} make the playoffs · x = clinched</div>`
        }
      </div>

      <div class="panel">
        <h2>Career</h2>
        <div class="statline">
          <div><b>${battingAverage(player.career)}</b><span>AVG</span></div>
          <div><b>${player.career.hits}</b><span>H</span></div>
          <div><b>${player.career.homeRuns}</b><span>HR</span></div>
          <div><b>${player.career.rbi}</b><span>RBI</span></div>
        </div>
        <button class="btn ghost tiny" id="reset" style="margin-top:14px">Retire &amp; start over</button>
      </div>
    </div>
  `;

  if (seasonDone) q(mount, '#finish').addEventListener('click', () => app.go('seasonEnd'));
  else if (upcoming) {
    // First game ever goes by way of the how-to; after that, straight in.
    q(mount, '#play').addEventListener('click', () =>
      howtoSeen() ? app.go('game') : openHowto(app, 'game'),
    );
  }

  q(mount, '#train').addEventListener('click', () => app.go('training'));
  q(mount, '#store').addEventListener('click', () => app.go('store'));
  q(mount, '#howto').addEventListener('click', () => openHowto(app, 'hub'));

  if (devEnabled) q(mount, '#devmenu').addEventListener('click', () => app.go('dev'));

  q(mount, '#reset').addEventListener('click', async () => {
    const ok = await showDialog({
      title: `Retire ${player.name}?`,
      body: 'Your career save will be erased for good.',
      confirmLabel: 'Retire',
      cancelLabel: 'Keep Playing',
      danger: true,
    });
    if (ok) app.resetCareer();
  });
}
