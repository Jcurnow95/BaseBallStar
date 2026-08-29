/**
 * Award season. The year doesn't end with the last out — once the trophy is
 * handed out, every league in the organization votes on an MVP, and your
 * season is on the ballot alongside everybody else's.
 *
 * The problem this file exists to solve: nobody but you has a batting line.
 * `gameSim` tracks the player's own plate appearances and nothing else, so a
 * teammate is a name with a rating attached and an opponent is the same. So at
 * award time every other batter gets a season *synthesized* from their rating,
 * and the ballot scores those lines and your real one side by side.
 *
 * Those lines are rolled once and kept in the save. Re-rolling them on every
 * render would mean the MVP changed every time you opened the page, which is
 * the one thing an award page must never do.
 */
import type { BattingStats, PlayerProfile } from './types';
import type { LeagueState, Team } from './league';
import {
  LEVELS,
  SEASON_GAMES,
  ensureRosters,
  playerTeam,
  randomClubName,
  randomName,
  teamBatters,
} from './league';
import { Rng, clamp } from './rng';

/** One name on the ballot, with the season that put them there. */
export interface MvpCandidate {
  name: string;
  teamName: string;
  /** True for the one candidate whose line is real rather than synthesized. */
  isPlayer: boolean;
  stats: BattingStats;
  /** Internal award points. Only the ordering is meant to be read. */
  score: number;
  /** Share of the first-place vote, as a percentage. */
  votePct: number;
}

export interface MvpAward {
  levelId: number;
  winner: string;
  teamName: string;
  isPlayer: boolean;
  stats: BattingStats;
  votePct: number;
  /**
   * The rest of the ballot, best first, winner included. Only filled in for
   * the league the player was actually in — the other three are known to you
   * the way real ones are: a name and a line in the paper.
   */
  ballot: MvpCandidate[];
}

/** Everything handed out at the end of one season year. */
export interface SeasonAwards {
  seasonYear: number;
  /** One MVP per league, indexed to match `LEVELS`. */
  mvps: MvpAward[];
  /** The league the player was in that year — the ballot they were on. */
  playerLevelId: number;
  /** Where the player finished on their own ballot, 1-based. 0 = unranked. */
  playerFinish: number;
}

/** How many names the ballot shows, and how many split the first-place vote. */
export const BALLOT_SIZE = 5;

/**
 * Plate appearances needed to be on the ballot at all. You play every game, so
 * this never rules you out; it is here so a dev-menu save with a four-at-bat
 * season can't walk off with the trophy.
 */
const MIN_BALLOT_PA = 25;

/** How far apart in award points two players have to be before the vote splits. */
const VOTE_SPREAD = 7;

/** Batters generated to stand in for a league the player isn't in. */
const FOREIGN_FIELD = 44;

/** MVP money, by level. A little better than the ring, and it stacks with it. */
export const mvpBonus = (levelId: number): number => 600 * (levelId + 1);

const winPct = (t: Team): number => (t.wins + t.losses === 0 ? 0.5 : t.wins / (t.wins + t.losses));

/** What a league-average regular does at the plate, by level. */
interface HittingEnvironment {
  /** Batting average. */
  avg: number;
  /** Home runs per at-bat. */
  hrRate: number;
  /** Share of his non-homer hits that go for extra bases. */
  extraBaseShare: number;
}

/**
 * The hitting environment at each level, and the single most important set of
 * numbers in this file: it is what an MVP has to beat.
 *
 * Offense climbs steeply with the level even though the pitching gets better
 * too. That's not an accident of the model, it's the point — a rating of 50
 * means "average *for this league*", and Single-A is full of kids who can't
 * drive a ball yet. `tools/balance.ts` says a Single-A regular slugs .332 and
 * a big leaguer slugs .635, and the field has to sit in the same world as the
 * player, or the trophy is either unwinnable at the bottom or free at the top.
 *
 * Retune these against `tools/awards.ts`, which reports how often a season of
 * each standard actually takes the award.
 */
const ENVIRONMENT: HittingEnvironment[] = [
  { avg: 0.216, hrRate: 0.003, extraBaseShare: 0.12 },
  { avg: 0.236, hrRate: 0.012, extraBaseShare: 0.19 },
  { avg: 0.25, hrRate: 0.021, extraBaseShare: 0.23 },
  { avg: 0.257, hrRate: 0.03, extraBaseShare: 0.26 },
];

/**
 * A season at the plate for a batter the sim never actually pitched to, built
 * from their rating and the league they play in. Rates first, counting stats
 * second, so the line is always internally legal: hits break down into
 * 1B/2B/3B/HR and never exceed at-bats.
 */
export function synthesizeSeason(
  rating: number,
  levelId: number,
  rng: Rng,
  games = SEASON_GAMES,
): BattingStats {
  // -1 = replacement level, 0 = league average, +1 = the best bat in the league.
  const s = clamp((rating - 50) / 50, -1, 1);
  const env = ENVIRONMENT[clamp(levelId, 0, ENVIRONMENT.length - 1)];

  const pa = Math.max(1, Math.round(games * rng.range(3.2, 4.1)));
  const walks = Math.round(pa * clamp(0.072 + s * 0.035 + rng.gaussian() * 0.018, 0.02, 0.2));
  const ab = Math.max(1, pa - walks);
  const strikeouts = Math.round(ab * clamp(0.2 - s * 0.07 + rng.gaussian() * 0.04, 0.03, 0.42));

  const avg = clamp(env.avg + s * 0.045 + rng.gaussian() * 0.022, 0.06, 0.44);
  const hits = clamp(Math.round(ab * avg), 0, Math.max(0, ab - strikeouts));

  // Power scales *with* the environment rather than being added on top: the
  // best bat in Single-A is not a big-league slugger who happens to be there.
  const homeRuns = clamp(
    Math.round(ab * clamp(env.hrRate * (1 + s * 1.7 + rng.gaussian() * 0.55), 0, 0.12)),
    0,
    hits,
  );
  const extra = hits - homeRuns;
  const triples = clamp(Math.round(extra * 0.024 * rng.range(0, 2)), 0, extra);
  const doubles = clamp(
    Math.round(extra * clamp(env.extraBaseShare * (1 + s * 0.35) + rng.gaussian() * 0.045, 0.03, 0.42)),
    0,
    Math.max(0, extra - triples),
  );

  return {
    pa: ab + walks,
    ab,
    hits,
    singles: extra - triples - doubles,
    doubles,
    triples,
    homeRuns,
    rbi: Math.max(homeRuns, Math.round(homeRuns * 1.7 + extra * 0.42 + rng.gaussian() * 2)),
    runs: Math.max(homeRuns, Math.round(homeRuns + extra * 0.44 + walks * 0.3 + rng.gaussian() * 2)),
    walks,
    strikeouts,
    stolenBases: Math.max(0, Math.round(rng.range(0, 5) + s * 3)),
  };
}

/**
 * Award points for a season. OPS carries it, the way any modern ballot does,
 * but home runs and RBI are weighted on top because that is what an MVP vote
 * actually rewards, and playing for a winner is worth a nudge.
 *
 * Everything after the OPS term is deliberately small. RBI and the club's
 * record both started three times heavier, and both produced the same
 * unreadable page: a .241 hitter with 24 RBI beating a .321 hitter with a
 * 1.013 OPS, because runs batted in are mostly a fact about the men hitting in
 * front of you. They belong on the ballot as a thumb, not a scale.
 */
export function mvpScore(stats: BattingStats, teamWinPct: number): number {
  if (stats.pa < MIN_BALLOT_PA) return 0;
  const ab = Math.max(1, stats.ab);
  const obp = (stats.hits + stats.walks) / Math.max(1, stats.ab + stats.walks);
  const tb = stats.singles + stats.doubles * 2 + stats.triples * 3 + stats.homeRuns * 4;
  return (
    (obp + tb / ab) * 100 +
    stats.homeRuns * 1.6 +
    stats.rbi * 0.35 +
    stats.stolenBases * 0.4 +
    (teamWinPct - 0.5) * 16
  );
}

/**
 * Rank a field and split the first-place vote across the top of it. The share
 * falls off exponentially with the gap in award points, so a runaway year is a
 * near-unanimous win and a close one goes down to the wire.
 */
function rankBallot(candidates: MvpCandidate[]): MvpCandidate[] {
  const ranked = [...candidates].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const top = ranked.slice(0, BALLOT_SIZE).filter((c) => c.score > 0);
  if (top.length === 0) return ranked;

  const weights = top.map((c) => Math.exp((c.score - top[0].score) / VOTE_SPREAD));
  const total = weights.reduce((a, b) => a + b, 0);
  top.forEach((c, i) => {
    c.votePct = Math.round((weights[i] / total) * 1000) / 10;
  });
  return ranked;
}

function awardFrom(levelId: number, ranked: MvpCandidate[], keepBallot: boolean): MvpAward {
  const winner = ranked[0];
  return {
    levelId,
    winner: winner.name,
    teamName: winner.teamName,
    isPlayer: winner.isPlayer,
    stats: winner.stats,
    votePct: winner.votePct,
    ballot: keepBallot ? ranked.slice(0, BALLOT_SIZE) : [],
  };
}

/** The ballot for the league the player spent the year in. */
function homeBallot(player: PlayerProfile, league: LeagueState, rng: Rng): MvpCandidate[] {
  ensureRosters(league, rng);
  const candidates: MvpCandidate[] = [];

  for (const team of league.teams) {
    const pct = winPct(team);
    for (const batter of teamBatters(team)) {
      const stats = synthesizeSeason(batter.rating, league.levelId, rng);
      candidates.push({
        name: batter.name,
        teamName: team.name,
        isPlayer: false,
        stats,
        score: mvpScore(stats, pct),
        votePct: 0,
      });
    }
  }

  // Yours is the one line on the ballot that was actually played out.
  const me = playerTeam(league);
  candidates.push({
    name: player.name,
    teamName: me.name,
    isPlayer: true,
    stats: { ...player.season },
    score: mvpScore(player.season, winPct(me)),
    votePct: 0,
  });

  return candidates;
}

/** An MVP for a league you only ever hear about second-hand. */
function foreignAward(levelId: number, rng: Rng): MvpAward {
  const field: MvpCandidate[] = [];

  for (let i = 0; i < FOREIGN_FIELD; i++) {
    // The same talent spread the player's own league is generated with: clubs
    // around 50, hitters scattered around their club.
    const rating = clamp(50 + rng.gaussian() * 16, 10, 99);
    const stats = synthesizeSeason(rating, levelId, rng);
    field.push({
      name: '',
      teamName: '',
      isPlayer: false,
      stats,
      score: mvpScore(stats, clamp(0.5 + rng.gaussian() * 0.12, 0.24, 0.76)),
      votePct: 0,
    });
  }

  // Names go on last: only the ones that make the ballot ever get read.
  const ranked = rankBallot(field);
  for (const c of ranked.slice(0, BALLOT_SIZE)) {
    c.name = randomName(rng);
    c.teamName = randomClubName(rng);
  }
  return awardFrom(levelId, ranked, false);
}

/** Vote the whole system's awards for one season. */
export function runSeasonAwards(
  player: PlayerProfile,
  league: LeagueState,
  seasonYear: number,
  rng: Rng,
): SeasonAwards {
  const ranked = rankBallot(homeBallot(player, league, rng));

  return {
    seasonYear,
    playerLevelId: league.levelId,
    playerFinish: ranked.findIndex((c) => c.isPlayer) + 1,
    mvps: LEVELS.map((level) =>
      level.id === league.levelId
        ? awardFrom(level.id, ranked, true)
        : foreignAward(level.id, rng),
    ),
  };
}

/**
 * This season's awards, voted on first request and kept thereafter. Every
 * screen that wants them calls this, so the ballot a player reads on the award
 * page is the same one the season review pays out on.
 */
export function ensureSeasonAwards(
  history: SeasonAwards[],
  player: PlayerProfile,
  league: LeagueState,
  seasonYear: number,
  rng: Rng,
): SeasonAwards {
  const existing = history.find((a) => a.seasonYear === seasonYear);
  if (existing) return existing;
  const awards = runSeasonAwards(player, league, seasonYear, rng);
  history.push(awards);
  return awards;
}

/** The player's own MVP from a season's awards, if they won one. */
export function playerMvp(awards: SeasonAwards): MvpAward | null {
  return awards.mvps.find((m) => m.isPlayer) ?? null;
}

/** Every season the player was voted MVP, oldest first. */
export function mvpSeasons(
  history: readonly SeasonAwards[],
): { year: number; levelId: number }[] {
  return history
    .filter((a) => a.mvps.some((m) => m.isPlayer))
    .map((a) => ({ year: a.seasonYear, levelId: a.playerLevelId }))
    .sort((a, b) => a.year - b.year);
}
