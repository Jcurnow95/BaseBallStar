import type { App, PostGameSummary } from '../app';
import type { LogTone, SimEvent } from '../core/gameSim';
import { GameSim } from '../core/gameSim';
import type { Count } from '../core/pitching';
import {
  LEVELS,
  advanceDay,
  ensureRosters,
  isRegularSeasonOver,
  isSeasonOver,
  nextGame,
  parkForGame,
  playerTeam,
  simulateOtherTeams,
  teamById,
  teamKit,
  weatherForGame,
} from '../core/league';
import type { PlayoffGameOutcome } from '../core/playoffs';
import { ROUND_LABEL, playerSeries, recordPlayoffGame, seriesLine, startPlayoffs } from '../core/playoffs';
import { describeWeather, windLabel, windMph } from '../core/weather';
import { uniformFor } from '../core/uniforms';
import { effectiveAttributes, gameEarnings, playerWithGear, wearGear } from '../core/gear';
import { addStats } from '../core/player';
import { gameXp, grantXp, recoverOvernight } from '../core/progression';
import { clamp } from '../core/rng';
import type { BattedBall } from '../core/types';
import type { PlayOutcome, UserSide } from '../core/playSim';
import { PlaySim } from '../core/playSim';
import { toPositionId } from '../core/fieldGeometry';
import { AtBatView } from '../game/atBatView';
import { PlayView } from '../game/playView';
import { showCoachTip, tipSeen } from '../game/coachTips';
import { esc, q } from '../ui/dom';
import type { FeedIcon } from '../ui/feedIcons';
import { feedIconFor, feedIconSvg } from '../ui/feedIcons';
import {
  isMuted,
  playSound,
  resumeAmbience,
  startAmbience,
  stopAmbience,
  suspendAmbience,
  toggleMuted,
} from '../ui/audio';

const NORMAL_DELAY = 850;
const FAST_DELAY = 220;

export function renderGame(app: App, mount: HTMLElement): () => void {
  const save = app.requireSave();
  const { player, league } = save;
  const level = LEVELS[league.levelId];
  const upcoming = nextGame(league);

  if (!upcoming) {
    app.go('hub');
    return () => {};
  }

  const scheduled = upcoming;
  // Saves from before named rosters get theirs generated on the way in.
  ensureRosters(league, app.rng);
  const opponent = teamById(league, scheduled.opponentId);
  const myTeam = playerTeam(league);
  const park = parkForGame(league, scheduled);
  const weather = weatherForGame(scheduled, app.rng);

  // Home team wears its home kit, the visitor its road kit.
  const myKit = uniformFor(teamKit(league, myTeam.id), scheduled.home);
  const theirKit = uniformFor(teamKit(league, opponent.id), !scheduled.home);
  // A postseason game plays until somebody wins.
  const sim = new GameSim(player, level, myTeam, opponent, scheduled.home, app.rng, weather, !!scheduled.playoff);

  // "Semifinal · Game 2 · Series 1-0" over the matchup on a playoff night.
  const series = scheduled.playoff ? playerSeries(league) : null;
  const playoffTag = (() => {
    if (!scheduled.playoff || !series) return '';
    const line = seriesLine(league, series);
    const tally =
      line.us + line.them === 0 ? '' : ` · Series ${line.us}-${line.them}`;
    return `${ROUND_LABEL[series.round]} · Game ${scheduled.playoff.gameNo}${tally}`;
  })();

  let delay = NORMAL_DELAY;
  let timer = 0;
  let soundTimer = 0;
  let view: AtBatView | PlayView | null = null;
  let count: Count = { balls: 0, strikes: 0 };
  let disposed = false;

  mount.classList.add('game-screen');
  mount.innerHTML = `
    <header class="scorebar">
      <div class="teams">
        <div><span id="awayName"></span><b id="awayScore">0</b></div>
        <div><span id="homeName"></span><b id="homeScore">0</b></div>
      </div>
      <div class="diamond"><i class="b1"></i><i class="b2"></i><i class="b3"></i></div>
      <div class="situation">
        <b id="inning">Top 1</b>
        <span id="outs">0 out</span>
        <div class="count-pips" id="pips"></div>
      </div>
    </header>

    <div class="stage" id="stage">
      <div class="idle-stage" id="idle">
        <div class="sim-head">
          <div class="sub" id="idleSub">First pitch</div>
          <div class="big" id="idleBig">${esc(scheduled.home ? 'vs' : '@')} ${esc(opponent.name)}<br/>
            ${playoffTag ? `<span class="playoff-tag">${esc(playoffTag)}</span><br/>` : ''}
            <span class="muted tiny">${esc(park.name)} · ${esc(sim.pitcher.name)} on the mound</span><br/>
            <span class="muted tiny">${esc(describeWeather(weather))}</span>
          </div>
        </div>
        <div class="sim-field">
          <div class="sim-diamond">
            <i class="sbase" id="sb2"></i>
            <i class="sbase" id="sb3"></i>
            <i class="sbase" id="sb1"></i>
            <i class="shome"></i>
          </div>
          <div class="sim-outs" id="simOuts"></div>
        </div>
        <div class="sim-matchup" id="simMatchup"></div>
        <div class="sim-linescore" id="simLinescore"></div>
        <div class="sim-skips">
          <button class="skip-btn" id="skipAtBat">MY AT-BAT »</button>
          <button class="skip-btn" id="skipInning">END INNING »</button>
        </div>
      </div>
      <div id="host"></div>
      <button class="speed-toggle" id="speed">FAST ▸</button>
      <button class="sound-toggle" id="sound" aria-label="Toggle sound"></button>
      <button class="pause-toggle" id="pause" aria-label="Pause">❚❚</button>
      <div class="pause-overlay" id="paused">
        <div class="pause-card">
          <div class="pause-title">PAUSED</div>
          <div class="tiny muted" id="pauseSub"></div>
          <button class="btn primary" id="resume">Resume</button>
        </div>
      </div>
    </div>

    <div class="feed" id="feed"></div>
  `;

  const idle = q(mount, '#idle');
  const host = q(mount, '#host');
  const feed = q(mount, '#feed');
  const speedBtn = q<HTMLButtonElement>(mount, '#speed');
  const soundBtn = q<HTMLButtonElement>(mount, '#sound');

  /* ------------------------------------------------------------ rendering */

  /**
   * Update the sim stage headline. Each event punches in rather than swapping
   * silently, and the card flashes with the event's colour — gold for hits,
   * red for outs against us — so a result lands as a moment, not a caption.
   */
  const setIdle = (headline: string, sub: string, tone?: LogTone | 'inning'): void => {
    const big = q(mount, '#idleBig');
    big.innerHTML = esc(headline);
    q(mount, '#idleSub').textContent = sub;
    big.classList.remove('punch');
    void big.offsetWidth;
    big.classList.add('punch');

    idle.classList.remove('flash-gold', 'flash-red', 'flash-good');
    const flash =
      tone === 'hit' || tone === 'big'
        ? 'flash-gold'
        : tone === 'bad'
          ? 'flash-red'
          : tone === 'good'
            ? 'flash-good'
            : null;
    if (flash) {
      void idle.offsetWidth;
      idle.classList.add(flash);
    }
  };

  /** Three-letter linescore tag, from the club's city name. */
  const abbrev = (name: string): string => name.slice(0, 3).toUpperCase();

  /** The player's live average: season so far plus today's game. */
  const liveAvg = (): string => {
    const ab = player.season.ab + sim.gameStats.ab;
    const hits = player.season.hits + sim.gameStats.hits;
    return ab > 0 ? (hits / ab).toFixed(3).replace(/^0/, '') : '.000';
  };

  /**
   * The live field state on the sim stage: diamond, outs, who's due up
   * against whom, and the inning-by-inning linescore.
   */
  let shownBases = [false, false, false];
  const updateSimStage = (): void => {
    // Occupied bases burn gold; a runner newly aboard pops so the eye
    // catches the diamond changing.
    (['#sb1', '#sb2', '#sb3'] as const).forEach((sel, i) => {
      const el = q(mount, sel);
      el.classList.toggle('on', sim.bases[i]);
      if (sim.bases[i] && !shownBases[i]) {
        el.classList.remove('arrive');
        void el.offsetWidth;
        el.classList.add('arrive');
      }
    });
    shownBases = [...sim.bases];

    q(mount, '#simOuts').innerHTML =
      [0, 1, 2].map((i) => `<i class="${i < sim.outs ? 'on' : ''}"></i>`).join('') +
      `<span>${sim.outs} out</span>`;

    const due = sim.dueUp();
    const arm = sim.facingPitcher();
    q(mount, '#simMatchup').innerHTML = `
      <div class="side ${due.isPlayer ? 'you' : ''}">
        <span class="lbl">At bat</span>
        <b>${due.isPlayer ? '★ ' : ''}${esc(due.name)}</b>
        <span class="stat">${due.isPlayer ? liveAvg() : `OVR ${due.rating}`}</span>
      </div>
      <span class="vs">vs</span>
      <div class="side">
        <span class="lbl">Pitching</span>
        <b>${esc(arm.name)}</b>
        <span class="stat">OVR ${Math.round(arm.rating)}</span>
      </div>`;

    // Linescore. Away bats top, so their innings fill first; a half that
    // hasn't started yet stays blank.
    const innings = Math.max(9, sim.inning);
    const started = (home: boolean, i: number): boolean =>
      home ? i + 1 < sim.inning || (i + 1 === sim.inning && sim.half === 'bottom') : i + 1 <= sim.inning;
    const row = (name: string, us: boolean, home: boolean): string => {
      const runs = sim.lineScore[us ? 'us' : 'them'];
      const cells = Array.from({ length: innings }, (_, i) =>
        `<td>${started(home, i) ? (runs[i] ?? 0) : ''}</td>`).join('');
      const hits = sim.teamHits[us ? 'us' : 'them'];
      const errs = sim.teamErrors[us ? 'us' : 'them'];
      return `<tr class="${us ? 'us' : ''}"><th>${esc(abbrev(name))}</th>${cells}
        <td class="tot">${us ? sim.score.us : sim.score.them}</td>
        <td class="tot">${hits}</td><td class="tot">${errs}</td></tr>`;
    };
    const awayIsUs = !sim.playerIsHome;
    q(mount, '#simLinescore').innerHTML = `<table>
      <tr><th></th>${Array.from({ length: innings }, (_, i) => `<td>${i + 1}</td>`).join('')}
        <td class="tot">R</td><td class="tot">H</td><td class="tot">E</td></tr>
      ${row(awayIsUs ? myTeam.name : opponent.name, awayIsUs, false)}
      ${row(awayIsUs ? opponent.name : myTeam.name, !awayIsUs, true)}
    </table>`;
  };

  // The speed toggle only governs the simulated stretches between your
  // moments. Left on screen during an at-bat it read as "the pitch is being
  // sped up", so it goes away whenever you're actually playing.
  // `simulating` flips the layout: the stage shrinks to a headline card and
  // the play-by-play feed takes over the screen, so watching the sim is
  // reading the game rather than squinting at a three-line strip.
  const showIdle = (): void => {
    idle.style.display = '';
    host.style.display = 'none';
    speedBtn.style.display = '';
    mount.classList.add('simulating');
  };

  const showPlay = (): void => {
    idle.style.display = 'none';
    host.style.display = '';
    speedBtn.style.display = 'none';
    mount.classList.remove('simulating');
  };

  const addFeed = (text: string, tone: LogTone | 'inning', icon?: FeedIcon): void => {
    const line = document.createElement('div');
    line.className = tone;
    // Inning breaks always get the diamond; everything else is read off the
    // words unless the caller knows better.
    const glyph = icon ?? (tone === 'inning' ? 'inning' : feedIconFor(text));
    line.innerHTML = `<i class="feed-icon ${glyph}">${feedIconSvg(glyph)}</i><span></span>`;
    line.lastElementChild!.textContent = text;
    feed.appendChild(line);
    while (feed.childElementCount > 40) feed.removeChild(feed.firstChild!);
    feed.scrollTop = feed.scrollHeight;
  };

  const update = (): void => {
    const awayIsUs = !sim.playerIsHome;
    q(mount, '#awayName').textContent = awayIsUs ? myTeam.name : opponent.name;
    q(mount, '#homeName').textContent = awayIsUs ? opponent.name : myTeam.name;
    q(mount, '#awayScore').textContent = String(awayIsUs ? sim.score.us : sim.score.them);
    q(mount, '#homeScore').textContent = String(awayIsUs ? sim.score.them : sim.score.us);

    q(mount, '#inning').textContent = sim.inningLabel;
    q(mount, '#outs').textContent = `${sim.outs} out`;

    for (let i = 0; i < 3; i++) {
      q(mount, `.diamond .b${i + 1}`).classList.toggle('on', sim.bases[i]);
    }

    q(mount, '#pips').innerHTML =
      [0, 1, 2].map((i) => `<i class="${count.balls > i ? 'ball' : ''}"></i>`).join('') +
      [0, 1].map((i) => `<i class="${count.strikes > i ? 'strike' : ''}"></i>`).join('');

    updateSimStage();
  };

  /* ------------------------------------------------------------ scheduling */

  // The single-slot game clock. Remembered as (what, when) rather than just a
  // timer id so a pause can lift it and put it back with the time it had left.
  let pendingFn: (() => void) | null = null;
  let pendingAt = 0;
  let pendingLeft = 0;
  let paused = false;

  const schedule = (fn: () => void, ms = delay): void => {
    if (disposed) return;
    clearTimeout(timer);
    pendingFn = fn;
    pendingAt = performance.now() + ms;
    if (paused) return;
    timer = window.setTimeout(() => {
      pendingFn = null;
      fn();
    }, ms);
  };

  /* --------------------------------------------------------------- pausing */

  const pauseBtn = q<HTMLButtonElement>(mount, '#pause');
  const pauseOverlay = q(mount, '#paused');

  /**
   * Everything that moves stops: the pitch or play in progress, the wait
   * before the next event, and the crowd. Nothing is lost — resume picks up
   * exactly where it left off, with whatever was left on the clock.
   */
  const setPaused = (value: boolean): void => {
    if (disposed || value === paused) return;
    paused = value;
    pauseOverlay.classList.toggle('show', value);
    pauseBtn.style.display = value ? 'none' : '';
    if (view) view.paused = value;

    if (value) {
      clearTimeout(timer);
      // Freeze what's left on the clock; wall time keeps going while paused.
      pendingLeft = Math.max(0, pendingAt - performance.now());
      suspendAmbience();
      q(mount, '#pauseSub').textContent = `${sim.inningLabel} · ${sim.outs} out`;
    } else {
      resumeAmbience();
      if (pendingFn) schedule(pendingFn, pendingLeft);
    }
  };

  const destroyView = (): void => {
    if (view) {
      view.destroy();
      view = null;
    }
    showIdle();
  };

  /* ----------------------------------------------------------- game events */

  /** The "N runs score." feed line that follows a scoring event. */
  const addRunsFeed = (n: number, ours: boolean): void => {
    addFeed(`${n} run${n === 1 ? '' : 's'} score.`, ours ? 'good' : 'bad', 'run');
  };

  const tick = (): void => {
    if (disposed) return;
    const event = sim.step();
    update();

    switch (event.kind) {
      case 'inning':
        addFeed(event.text, 'inning');
        setIdle(event.text, sim.weAreBatting ? 'Your team is up' : 'In the field');
        // Not every break — an organ riff between all eighteen half-innings
        // stops being charming somewhere around the fourth.
        if (app.rng.chance(0.3)) playSound('organ');
        schedule(tick);
        break;
      case 'log':
        addFeed(event.text, event.tone);
        if (event.runs) addRunsFeed(event.runs.count, event.runs.ours);
        setIdle(event.text, sim.inningLabel, event.tone);
        schedule(tick);
        break;
      case 'atBat':
        beginAtBat(event);
        break;
      case 'fielding':
        beginFielding(event);
        break;
      case 'gameOver':
        endGame();
        break;
    }
  };

  /**
   * Fast-forward the sim to the next thing worth watching: your own at-bat
   * (or a ball hit your way), or the end of the current half-inning. The feed
   * still gets every line, so nothing is lost — just the waiting.
   */
  const skipTo = (target: 'atbat' | 'inning'): void => {
    if (disposed || paused || view) return;
    clearTimeout(timer);
    pendingFn = null;

    // Bounded hard: a full game is a few hundred events, so this only trips
    // if something wedges — and then we fall back to the normal clock.
    for (let guard = 0; guard < 500; guard++) {
      const event = sim.step();
      switch (event.kind) {
        case 'inning':
          addFeed(event.text, 'inning');
          if (target === 'inning') {
            update();
            setIdle(event.text, sim.weAreBatting ? 'Your team is up' : 'In the field');
            schedule(tick);
            return;
          }
          break;
        case 'log':
          addFeed(event.text, event.tone);
          if (event.runs) addRunsFeed(event.runs.count, event.runs.ours);
          break;
        case 'atBat':
          update();
          beginAtBat(event);
          return;
        case 'fielding':
          update();
          beginFielding(event);
          return;
        case 'gameOver':
          update();
          endGame();
          return;
      }
    }
    update();
    schedule(tick);
  };

  function beginAtBat(event: Extract<SimEvent, { kind: 'atBat' }>): void {
    showPlay();
    count = { balls: 0, strikes: 0 };
    addFeed(`${player.name} steps in against ${event.pitcher.name}.`, 'neutral', 'batter');

    // The park picks up when you come up with something going on. Runners on
    // gets the charge riff; otherwise an occasional ripple of clapping, so
    // stepping in isn't always silent but isn't always the same either.
    if (sim.bases.some(Boolean)) playSound('rally');
    else if (app.rng.chance(0.25)) playSound('clap');

    view = new AtBatView(host, {
      // Gear plays: the sweet spot and the pitch read both come off it.
      player: playerWithGear(player),
      pitcher: event.pitcher,
      pitcherKit: theirKit,
      batterKit: myKit,
      weather,
      level,
      rng: app.rng,
      onCount: (c) => {
        count = c;
        update();
      },
      onBallInPlay: (battedBall) => {
        destroyView();
        count = { balls: 0, strikes: 0 };
        update();
        beginLivePlay(battedBall, 'offense');
      },
      onComplete: (outcome) => {
        destroyView();
        // A walk gets a ripple of approval; a strikeout gets the silence it
        // deserves, since there's no free-licensed crowd groan in the set.
        if (outcome.result === 'walk') playSound('cheerSoft');
        const applied = sim.submitAtBat(outcome);
        addFeed(`${player.name}: ${applied.text}`, applied.tone);
        if (applied.runs > 0) {
          addFeed(`${applied.runs} run${applied.runs === 1 ? '' : 's'} score.`, 'good', 'run');
        }
        count = { balls: 0, strikes: 0 };
        setIdle(applied.text, sim.inningLabel, applied.tone);
        update();
        schedule(tick, delay + 350);
      },
    });
    // The first time the weather is going to matter, say so — but only once
    // the batting tip has had its turn, so the two don't stack.
    const batTipDone = tipSeen('bat');
    showCoachTip(
      host,
      'bat',
      'Tap the ball as it reaches the plate. A hair under centre is a barrel.',
      7000,
    );
    if (!batTipDone) return;
    if (windMph(weather) >= 10) {
      const out = weather.wind.y > 0;
      showCoachTip(
        host,
        'wind',
        `Wind ${windLabel(weather)}. ${out ? 'Fly balls carry today — get it in the air.' : 'Fly balls die out there — line drives play.'}`,
        7000,
      );
    } else if (weather.rain > 0) {
      showCoachTip(
        host,
        'rain',
        'Wet field. Balls die in the grass and gloves get slippery.',
        7000,
      );
    }
  }

  function beginFielding(event: Extract<SimEvent, { kind: 'fielding' }>): void {
    addFeed(`${event.hitter} hits one your way...`, 'neutral', 'alert');
    beginLivePlay(event.battedBall, 'defense');
  }

  /** Hand a fair ball over to the top-down field, on whichever side we're on. */
  function beginLivePlay(battedBall: BattedBall, side: UserSide): void {
    showPlay();

    const playSim = new PlaySim({
      battedBall,
      bats: player.bats,
      attributes: effectiveAttributes(player),
      userPosition: toPositionId(player.position),
      userSide: side,
      runnersOn: [...sim.bases],
      outs: sim.outs,
      opponentRating: level.defenseRating,
      park,
      weather,
      rng: app.rng,
    });

    view = new PlayView(host, {
      sim: playSim,
      // On offense your team is running and theirs is in the field; on defense
      // it's the other way round.
      fieldingKit: side === 'offense' ? theirKit : myKit,
      battingKit: side === 'offense' ? myKit : theirKit,
      // October packs the place, whatever the level.
      crowd: scheduled.playoff ? Math.min(1, level.crowd + 0.35) : level.crowd,
      // Home fills the first-base dugout: that's us when we're hosting and in
      // the field, or when we're visiting and at bat.
      homeSide: scheduled.home === (side === 'defense') ? 'fielding' : 'batting',
      onComplete: (result: PlayOutcome) => {
        destroyView();
        finishLivePlay(result, side);
      },
    });

    if (side === 'defense') {
      showCoachTip(
        host,
        'field',
        'Drag anywhere to run. Get under the gold ring, then tap a base to throw — or run it to the bag.',
      );
    } else {
      showCoachTip(
        host,
        'run',
        'GO takes the next base, HOLD pulls up, BACK turns you round. Red line: the ball is beating you there.',
      );
    }
  }

  function finishLivePlay(result: PlayOutcome, side: UserSide): void {
    reactTo(result, side);
    const applied = sim.submitLivePlay(result, side === 'offense' ? 'us' : 'them');
    const prefix = side === 'offense' ? `${player.name}: ` : '';
    addFeed(`${prefix}${applied.text}`, applied.tone);

    if (result.runs > 0) {
      addFeed(`${result.runs} run${result.runs === 1 ? '' : 's'} score.`, side === 'offense' ? 'good' : 'bad', 'run');
    }
    if (result.userPutout && side === 'defense') {
      addFeed('Putout credited to you.', 'good', 'catch');
    }
    if (result.userError) {
      addFeed('Charged with an error.', 'bad', 'error');
    }

    setIdle(applied.text, sim.inningLabel, applied.tone);
    update();
    schedule(tick, delay + 300);
  }

  /**
   * The crowd's take on what just happened. Only your side's good news gets a
   * reaction — cheering the opposition's double from your own dugout reads as
   * a bug, and firing something on every routine out would flatten the big
   * moments this is here to sell.
   */
  function reactTo(result: PlayOutcome, side: UserSide): void {
    if (side === 'defense') {
      if (result.userPutout) playSound('cheerShort');
      return;
    }

    if (result.kind === 'homeRun') {
      playSound('homeRun');
      // Let the roar establish before the organ answers it. Deliberately not
      // `schedule` — that's the single-slot game clock, and borrowing it here
      // would cancel the pending tick and stall the inning.
      clearTimeout(soundTimer);
      soundTimer = window.setTimeout(() => playSound('fanfare'), 1400);
      return;
    }
    if (result.kind === 'foul' || result.kind === 'out') return;
    // A hit that drove in runs deserves more than a hit that didn't.
    playSound(result.runs > 0 ? 'cheerBig' : 'cheerShort');
  }

  /* -------------------------------------------------------------- wrap up */

  function endGame(): void {
    destroyView();

    scheduled.played = true;
    scheduled.playerTeamScore = sim.score.us;
    scheduled.opponentScore = sim.score.them;

    // Only the regular season counts on the table. A playoff game lives on
    // its series instead.
    if (!scheduled.playoff) {
      if (sim.score.us > sim.score.them) {
        myTeam.wins++;
        opponent.losses++;
      } else if (sim.score.us < sim.score.them) {
        myTeam.losses++;
        opponent.wins++;
      }
      simulateOtherTeams(league, app.rng, [opponent.id]);
    }

    addStats(player.season, sim.gameStats);
    addStats(player.career, sim.gameStats);
    player.fielding.chances += sim.putouts + sim.errors;
    player.fielding.putouts += sim.putouts;
    player.fielding.errors += sim.errors;

    const xp = gameXp(sim.gameStats, sim.putouts);
    const report = grantXp(player, xp);

    // Payday, then a game's worth of wear on everything in the bag.
    const earnings = gameEarnings(
      league.levelId,
      player.contract,
      sim.gameStats,
      sim.putouts,
      sim.score.us > sim.score.them,
    );
    player.money += earnings.total;
    const wornOut = wearGear(player).map((g) => g.name);

    // A game takes a real bite out of conditioning, then the day rolls over.
    player.stamina = clamp(player.stamina - (6 + Math.round(app.rng.next() * 4)), 0, 100);
    advanceDay(league, app.rng);
    recoverOvernight(player);

    // Move the postseason along: record a series game, or seed the bracket
    // the moment the regular season is done.
    let playoff: PlayoffGameOutcome | null = null;
    if (scheduled.playoff) {
      playoff = recordPlayoffGame(league, scheduled, sim.score.us > sim.score.them, app.rng);
    } else if (isRegularSeasonOver(league)) {
      startPlayoffs(league, app.rng);
    }

    const summary: PostGameSummary = {
      win: sim.score.us > sim.score.them,
      tie: sim.score.us === sim.score.them,
      score: { ...sim.score },
      opponent: opponent.name,
      home: sim.playerIsHome,
      stats: { ...sim.gameStats },
      putouts: sim.putouts,
      errors: sim.errors,
      xp,
      earnings,
      wornOut,
      levelsGained: report.levelsGained,
      pointsGained: report.pointsGained,
      playoff: playoff ?? undefined,
      // Not `nextGame(league) === null` — that's also true on an ordinary off
      // day, which would end the season after the first one.
      seasonComplete: isSeasonOver(league),
    };

    app.lastGame = summary;
    app.persist();
    app.go('postgame');
  }

  /* ---------------------------------------------------------------- input */

  pauseBtn.addEventListener('click', () => setPaused(true));
  q(mount, '#resume').addEventListener('click', () => setPaused(false));
  // Backgrounding the app pauses the game rather than leaving a pitch or a
  // play to run on (or freeze) behind a phone call.
  const onVisibility = (): void => {
    if (document.hidden) setPaused(true);
  };
  document.addEventListener('visibilitychange', onVisibility);

  speedBtn.addEventListener('click', () => {
    delay = delay === NORMAL_DELAY ? FAST_DELAY : NORMAL_DELAY;
    speedBtn.textContent = delay === FAST_DELAY ? 'FAST ▸▸' : 'FAST ▸';
  });

  q(mount, '#skipAtBat').addEventListener('click', () => skipTo('atbat'));
  q(mount, '#skipInning').addEventListener('click', () => skipTo('inning'));

  const syncSoundBtn = (): void => {
    soundBtn.textContent = isMuted() ? '🔇' : '🔊';
    soundBtn.classList.toggle('off', isMuted());
  };

  soundBtn.addEventListener('click', () => {
    toggleMuted();
    syncSoundBtn();
  });

  showIdle();
  update();
  syncSoundBtn();
  if (playoffTag) addFeed(`Postseason baseball: ${playoffTag}.`, 'good');
  addFeed(`${myTeam.name} ${scheduled.home ? 'host' : 'visit'} the ${opponent.name}.`, 'neutral');
  startAmbience();
  schedule(tick, 1100);

  return () => {
    disposed = true;
    clearTimeout(timer);
    clearTimeout(soundTimer);
    stopAmbience();
    document.removeEventListener('visibilitychange', onVisibility);
    if (view) view.destroy();
  };
}
