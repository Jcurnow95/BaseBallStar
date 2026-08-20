import type { App } from '../app';
import {
  LEVELS,
  SEASON_GAMES,
  ensureRosters,
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
  }

  // Saves from before named rosters get theirs generated on the way in, and
  // any front-office news is shown once, then cleared.
  ensureRosters(league, app.rng);
  const news = league.news ?? [];
  league.news = undefined;
  app.persist();

  const upcoming = nextGame(league);
  const seasonDone = isSeasonOver(league);
  const gamesPlayed = regularSeasonGames(league).filter((g) => g.played).length;
  const playoffs = league.playoffs;
  const series = playerSeries(league);
  const ovr = overallRating(player.attributes);
  const homePark = ballparkById(team.parkId);

  // What kind of day a calendar slot is, for the week strip and season strip.
  const dayKind = (index: number): 'game' | 'off' | 'playoff' | 'end' => {
    const day = league.calendar[index];
    if (!day) return 'end';
    if (day.gameIndex == null) return 'off';
    return league.schedule[day.gameIndex]?.playoff ? 'playoff' : 'game';
  };

  // The week ahead in plain words, then the whole season as a dot strip for
  // the shape of it, with every color the strip uses named in the key.
  const weekHtml = Array.from({ length: 7 }, (_, i) => {
    const index = league.day + i;
    const kind = dayKind(index);
    const label = kind === 'end' ? '—' : kind === 'off' ? 'Off' : kind === 'playoff' ? 'P.O.' : 'Game';
    return `
      <div class="week-day ${kind}${i === 0 ? ' now' : ''}">
        <b>${i === 0 ? 'Today' : `Day ${index + 1}`}</b>
        <span>${label}</span>
      </div>`;
  }).join('');

  const calendarHtml = `
    <div class="cal-title tiny muted">Next 7 days</div>
    <div class="week-strip">${weekHtml}</div>
    <div class="cal-title tiny muted">Full season</div>
    <div class="calendar">
      ${league.calendar
        .map((_, index) => {
          const state =
            index < league.day ? 'past' : index === league.day ? 'now' : 'ahead';
          const kind = dayKind(index) === 'playoff' ? 'game playoff' : dayKind(index);
          return `<i class="cal-day ${kind} ${state}" title="Day ${index + 1}"></i>`;
        })
        .join('')}
    </div>
    <div class="cal-key tiny muted">
      <span><i class="cal-day game now"></i> today</span>
      <span><i class="cal-day game ahead"></i> game</span>
      <span><i class="cal-day off ahead"></i> off day</span>
      ${playoffs && playoffs.playerResult !== 'missed' ? '<span><i class="cal-day game playoff ahead"></i> playoff</span>' : ''}
      <span><i class="cal-day game past"></i> done</span>
      <span>Day ${Math.min(league.day + 1, league.calendar.length)} of ${league.calendar.length}</span>
    </div>`;

  // Development is reachable every day — you should never be locked out of
  // spending points or reading your own numbers because of the schedule.
  const ptsBadge =
    player.attributePoints > 0 ? `<span class="btn-badge">${player.attributePoints} pts</span>` : '';
  const devButton = `
    <button class="btn ghost" id="train" style="margin-top:8px">
      Player &amp; Development${ptsBadge}
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
      Gear Store · ${formatMoney(player.money)}${fraying > 0 ? `<span class="btn-badge warn">${fraying} wearing out</span>` : ''}
    </button>
    <button class="link-btn" id="howto">How to Play</button>`;

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
        Train Today${ptsBadge}
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
            <div class="id-chips">
              <span class="id-chip">${esc(level.name)}</span>
              <span class="id-chip">${esc(team.name)}</span>
              <span class="id-chip">Bats ${player.bats}</span>
              <span class="id-chip">Lv ${player.level}</span>
              <span class="id-chip">Home · ${esc(homePark.name)}</span>
            </div>
          </div>
          <div class="ovr">
            <b>${ovr}${gearOvr > 0 ? `<i class="gear-up">+${gearOvr}</i>` : ''}</b>
            <span>OVR</span>
          </div>
        </div>
        ${meterHtml('Stamina', player.stamina, 100, '', 'big')}
        ${meterHtml('Energy', player.energy, 100, 'xp')}
        ${meterHtml('XP to next level', player.xp, xpForLevel(player.level), 'xp', 'slim')}
      </div>

      ${
        news.length
          ? `<div class="panel">
               <div class="notice warn">${news.map((line) => esc(line)).join('<br/>')}</div>
             </div>`
          : ''
      }
      <div class="panel">
        ${matchupHtml}
      </div>

      <div class="panel">
        <h2>Season at the plate</h2>
        <div class="statline">
          <div class="key"><b>${battingAverage(player.season)}</b><span>AVG</span></div>
          <div><b>${player.season.homeRuns}</b><span>HR</span></div>
          <div><b>${player.season.rbi}</b><span>RBI</span></div>
          <div><b>${player.season.stolenBases}</b><span>SB</span></div>
        </div>
        <div class="statline" style="margin-top:12px">
          <div class="key"><b>${onBasePct(player.season)}</b><span>OBP</span></div>
          <div class="key"><b>${slugging(player.season)}</b><span>SLG</span></div>
          <div><b>${player.season.walks}</b><span>BB</span></div>
          <div><b>${player.season.strikeouts}</b><span>SO</span></div>
        </div>
        <div class="scout-strip">
          <div class="scout-grade">
            <b>${seasonScore(player.season)}</b>
            <span>Scout grade</span>
          </div>
          <div class="scout-req">
            ${
              league.levelId >= LEVELS.length - 1
                ? "You're in The Show. There's nowhere left to be called up to — stay here."
                : `Call-up needs a <b>${level.promotionScore}</b> grade and <b>${level.promotionOverall}</b> OVR (you're at ${ovr}). Getting on base and slugging is what moves the grade.`
            }
          </div>
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
              <i class="cap-tick" style="left:60%"></i>
              <i class="cap-tick" style="left:80%"></i>
            </span>
            <span class="val">${total}${gain > 0 ? `<i class="gear-up">+${gain}</i>` : ''}</span>
          </div>`;
        }).join('')}
        <div class="tiny muted" style="margin-top:10px">
          ${ATTRIBUTE_KEYS.some((key) => (bonuses[key] ?? 0) > 0) ? 'Bright segment = gear bonus · ' : ''}Ticks at 60 and 80 mark where upgrades start costing more points.
        </div>
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
              <td><i class="kit-chip" style="background:${kit.accent}" title="${esc(kit.name)}"></i>${esc(t.name)}${
                t.id === league.playerTeamId ? '<span class="you-tag">You</span>' : ''
              }</td>
              <td>${t.wins}</td><td>${t.losses}</td>
            </tr>`;
            })
            .join('')}
        </table>
        <div class="tiny muted" style="margin-top:8px">
          Squares are club colours${playoffs ? '' : ` · Top ${PLAYOFF_TEAMS} make the playoffs · x = clinched`}
        </div>
      </div>

      <div class="panel">
        <h2>Clubhouse</h2>
        <table class="standings">
          <tr><th>Player</th><th>Age</th><th>Rating</th></tr>
          ${(team.roster ?? [])
            .map(
              (p) => `
            <tr>
              <td>${esc(p.name)}${p.role === 'pitcher' ? ' <span class="tiny muted">P</span>' : ''}</td>
              <td>${p.age}</td><td>${p.rating}</td>
            </tr>`,
            )
            .join('')}
        </table>
        <div class="tiny muted" style="margin-top:10px; text-align:center">
          Your teammates, for as long as the front office keeps them together.
        </div>
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
