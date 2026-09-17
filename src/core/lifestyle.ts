/**
 * Life off the field.
 *
 * Everything the career owns and is known for that isn't a swing: where the
 * player lives, what's parked outside, how famous they are, who is in their
 * corner, and what they leave behind. The rule for every piece of it is that
 * it must give an existing number a second use — money that only bought gear
 * now buys a house that restores more energy overnight; fame that was only a
 * feeling now fills the stands and pays for a bat deal — rather than bolting
 * a new economy onto the side of the game.
 *
 * Nothing here touches the swing or the field directly. The hooks are small
 * and named: `overnightEnergyBonus`, `gameStaminaGuard`, `upkeepPerGame`.
 */

import type { PlayerProfile } from './types';
import { clamp } from './rng';

/* ------------------------------------------------------------------- state */

export type HomeId = 'apartment' | 'townhouse' | 'house' | 'estate';

export interface LifestyleState {
  /** Where the player lives. See `HOMES`. */
  home: HomeId;
  /** Ids of the vehicles and toys owned. See `TOYS`. */
  toys: string[];
  /** 0-100. How many people know the name. See `fameFromGame`. */
  fame: number;
  /** Sponsor deals being paid out. See `SPONSORS`. */
  deals: OwnedDeal[];
  /**
   * Things that happened off the field since the clubhouse last looked, shown
   * once on the hub then cleared — same shape as the league's own news.
   */
  notices: string[];
  /** The last few life events, newest first, for the Life screen's log. */
  log: string[];
}

export function createLifestyle(): LifestyleState {
  return { home: 'apartment', toys: [], fame: 0, deals: [], notices: [], log: [] };
}

/** Fill in anything a save predates, so an old career walks in with a flat. */
export function normaliseLifestyle(life: Partial<LifestyleState> | undefined): LifestyleState {
  const fresh = createLifestyle();
  if (!life) return fresh;
  return {
    home: HOMES.some((h) => h.id === life.home) ? (life.home as HomeId) : fresh.home,
    toys: Array.isArray(life.toys) ? life.toys.filter((id) => !!toyById(id)) : [],
    fame: typeof life.fame === 'number' ? clamp(life.fame, 0, 100) : 0,
    deals: Array.isArray(life.deals) ? life.deals.filter((d) => !!sponsorById(d.id)) : [],
    notices: Array.isArray(life.notices) ? life.notices : [],
    log: Array.isArray(life.log) ? life.log : [],
  };
}

const LOG_LENGTH = 10;

/** Record something for the Life screen, and flag it for the hub. */
export function noteLife(life: LifestyleState, text: string, notify = true): void {
  life.log.unshift(text);
  if (life.log.length > LOG_LENGTH) life.log.length = LOG_LENGTH;
  if (notify) life.notices.push(text);
}

/* -------------------------------------------------------------------- home */

export interface HomeDef {
  id: HomeId;
  name: string;
  blurb: string;
  /** Purchase price. The starting flat is free. */
  price: number;
  /** What it costs to keep, charged every game. */
  upkeep: number;
  /** Extra energy back every night, on top of the ordinary sleep. */
  restEnergy: number;
  /** Stamina a game does *not* take out of you: a proper bed, a proper kitchen. */
  staminaGuard: number;
  /** Room to put the trophies where people can see them. */
  trophyRoom: boolean;
}

/**
 * Four rungs, priced so each becomes reachable about a level after the last:
 * a townhouse on Double-A money, a house out of Triple-A, an estate once the
 * Majors cheques are coming in. Upkeep is real — a Single-A rookie who buys
 * the townhouse on a hot week will feel it — but never ruinous.
 */
export const HOMES: HomeDef[] = [
  {
    id: 'apartment',
    name: 'Team Apartment',
    blurb: 'A room over a laundromat the club pays for. The trophies live in a box under the bed.',
    price: 0,
    upkeep: 0,
    restEnergy: 0,
    staminaGuard: 0,
    trophyRoom: false,
  },
  {
    id: 'townhouse',
    name: 'Townhouse',
    blurb: 'Your own front door and a bed that fits. You wake up with more in the tank.',
    price: 6000,
    upkeep: 40,
    restEnergy: 6,
    staminaGuard: 0,
    trophyRoom: false,
  },
  {
    id: 'house',
    name: 'House in the Hills',
    blurb: 'A kitchen, a gym in the garage, and a room with shelves for the hardware.',
    price: 25000,
    upkeep: 120,
    restEnergy: 12,
    staminaGuard: 1,
    trophyRoom: true,
  },
  {
    id: 'estate',
    name: 'The Estate',
    blurb: 'Gates, a pool, a chef, a batting cage out back. The season barely touches you here.',
    price: 90000,
    upkeep: 400,
    restEnergy: 20,
    staminaGuard: 2,
    trophyRoom: true,
  },
];

export const homeById = (id: HomeId | undefined): HomeDef =>
  HOMES.find((h) => h.id === id) ?? HOMES[0];

/** The rungs above the current home, in order — you only ever move up. */
export function homeUpgrades(life: LifestyleState): HomeDef[] {
  const at = HOMES.findIndex((h) => h.id === life.home);
  return HOMES.slice(at + 1);
}

/** Move house. Returns false when it isn't an upgrade or can't be afforded. */
export function buyHome(player: PlayerProfile, life: LifestyleState, id: HomeId): boolean {
  const target = homeById(id);
  const current = homeById(life.home);
  if (target.price <= current.price || player.money < target.price) return false;
  player.money -= target.price;
  life.home = id;
  noteLife(life, `You moved into the ${target.name}.`, false);
  return true;
}

/* -------------------------------------------------------------------- toys */

export interface ToyDef {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  price: number;
  /** Charged every game, like the house. */
  upkeep: number;
  /** What it does for you, in plain words, for the card. */
  perk: string;
  /** Extra energy every night — a fast car gets you home from the park sooner. */
  restEnergy: number;
  /** Stamina a game doesn't take — a jet means no red-eye after a road game. */
  staminaGuard: number;
}

export const TOYS: ToyDef[] = [
  {
    id: 'bike',
    name: 'Motorbike',
    icon: '🏍️',
    blurb: 'Loud, quick, and the first thing you bought with baseball money.',
    price: 1800,
    upkeep: 10,
    perk: 'Home from the park a little sooner.',
    restEnergy: 1,
    staminaGuard: 0,
  },
  {
    id: 'car',
    name: 'Sports Car',
    icon: '🏎️',
    blurb: 'Low, red, and parked where the whole clubhouse can see it.',
    price: 9000,
    upkeep: 45,
    perk: 'Home from the park sooner. People notice.',
    restEnergy: 3,
    staminaGuard: 0,
  },
  {
    id: 'boat',
    name: 'Boat',
    icon: '🛥️',
    blurb: 'Thirty feet of somewhere the phone does not ring.',
    price: 30000,
    upkeep: 150,
    perk: 'Unlocks a day on the water on off days.',
    restEnergy: 0,
    staminaGuard: 0,
  },
  {
    id: 'jet',
    name: 'Private Jet',
    icon: '🛩️',
    blurb: 'No red-eyes, no middle seats, no waiting on the team bus.',
    price: 250000,
    upkeep: 900,
    perk: 'Road trips stop wearing you down.',
    restEnergy: 4,
    staminaGuard: 2,
  },
];

export const toyById = (id: string): ToyDef | undefined => TOYS.find((t) => t.id === id);

export const ownsToy = (life: LifestyleState, id: string): boolean => life.toys.includes(id);

export function buyToy(player: PlayerProfile, life: LifestyleState, id: string): boolean {
  const toy = toyById(id);
  if (!toy || ownsToy(life, id) || player.money < toy.price) return false;
  player.money -= toy.price;
  life.toys.push(id);
  noteLife(life, `You bought a ${toy.name}.`, false);
  return true;
}

/* ------------------------------------------------------------------- hooks */

/** What the house and everything parked outside it cost, per game. */
export function upkeepPerGame(life: LifestyleState): number {
  const toys = life.toys.reduce((sum, id) => sum + (toyById(id)?.upkeep ?? 0), 0);
  return homeById(life.home).upkeep + toys;
}

/** Extra energy the overnight roll gives back, from the bed and the drive home. */
export function overnightEnergyBonus(life: LifestyleState): number {
  const toys = life.toys.reduce((sum, id) => sum + (toyById(id)?.restEnergy ?? 0), 0);
  return homeById(life.home).restEnergy + toys;
}

/** Stamina a game doesn't get to take, capped so a game always costs something. */
export function gameStaminaGuard(life: LifestyleState): number {
  const toys = life.toys.reduce((sum, id) => sum + (toyById(id)?.staminaGuard ?? 0), 0);
  return clamp(homeById(life.home).staminaGuard + toys, 0, 4);
}

/* -------------------------------------------------------------------- fame */

/**
 * Fame is 0-100 and earned the way a reputation is: home runs, walk-offs,
 * October, the world stage, and the honours at the end of a year. It fills
 * the stands, fattens the performance bonus, and decides which sponsors
 * return your calls. It fades over a winter, so a name has to keep earning
 * itself.
 */
export function fameLabel(fame: number): string {
  if (fame >= 80) return 'Icon';
  if (fame >= 60) return 'Star';
  if (fame >= 35) return 'Fan Favorite';
  if (fame >= 15) return 'Local Name';
  return 'Unknown';
}

export interface FameGameInput {
  hits: number;
  homeRuns: number;
  rbi: number;
  stolenBases: number;
  walkOff: boolean;
  grandSlam: boolean;
  insideThePark: boolean;
  win: boolean;
  playoff: boolean;
  worldCup: boolean;
  /** 0 = Single-A … 3 = the Majors. Nobody is famous for a Single-A homer. */
  levelId: number;
}

/** How much of the league is watching at each rung. */
const FAME_LEVEL_SCALE = [0.3, 0.5, 0.75, 1];

/** Fame a game is worth, before it's added. Fractions are fine; fame is a float. */
export function fameFromGame(g: FameGameInput): number {
  const scale = FAME_LEVEL_SCALE[clamp(g.levelId, 0, FAME_LEVEL_SCALE.length - 1)];
  const raw =
    g.homeRuns * 1.2 +
    g.hits * 0.15 +
    g.rbi * 0.2 +
    g.stolenBases * 0.2 +
    (g.walkOff ? 2.5 : 0) +
    (g.grandSlam ? 2 : 0) +
    (g.insideThePark ? 1.5 : 0) +
    (g.win ? 0.2 : 0) +
    (g.playoff ? 1 : 0) +
    (g.worldCup ? 1.5 : 0);
  return raw * scale;
}

/** Add (or take) fame, clamped. Returns what actually changed. */
export function addFame(life: LifestyleState, amount: number): number {
  const before = life.fame;
  life.fame = clamp(life.fame + amount, 0, 100);
  return life.fame - before;
}

/** What the honours at the end of a year are worth. */
export function fameForHonors(h: {
  mvp: boolean;
  champion: boolean;
  promotedToMajors: boolean;
}): number {
  return (h.mvp ? 10 : 0) + (h.champion ? 6 : 0) + (h.promotedToMajors ? 5 : 0);
}

/** A winter passes and the name fades a little. */
export function fadeFame(life: LifestyleState): void {
  life.fame = clamp(life.fame * 0.9, 0, 100);
}

/** How much fuller the stands are because of who's playing, 0-0.25. */
export const fameCrowdBoost = (fame: number): number => (clamp(fame, 0, 100) / 100) * 0.25;

/** Multiplier on performance money: a name sells jerseys, and the club knows it. */
export const fameBonusMult = (fame: number): number => 1 + clamp(fame, 0, 100) / 200;

/* ------------------------------------------------------------ endorsements */

export interface SponsorDef {
  id: string;
  brand: string;
  blurb: string;
  /** The gear slot the deal covers: they supply it, and only theirs goes in it. */
  slot: 'bat' | 'battingGloves' | 'glove' | 'cleats';
  /** The catalogue item they hand you, free, for as long as the deal runs. */
  gearId: string;
  /** Fame the brand wants to see before they call. */
  minFame: number;
  /** Paid every game, on top of the club's money. */
  payPerGame: number;
  /** Games the deal runs. */
  games: number;
  /** The bigger brands only talk to representation. */
  needsAgent: boolean;
}

export interface OwnedDeal {
  id: string;
  gamesLeft: number;
}

/**
 * Three tiers per slot, lined up with the gear catalogue: the local shop
 * hands you the team-issue stuff, the national brand the pro model, and the
 * big name the signature line. Money is set so a deal is worth roughly what
 * the gear it replaces would cost over its life, plus a little: a sponsor is
 * free kit and a raise, at the price of being locked to their shelf.
 */
export const SPONSORS: SponsorDef[] = [
  // ---- Local: fame 10, no agent needed.
  {
    id: 'ashline',
    brand: 'Ashline Lumber',
    blurb: 'The lumber yard on Route 9. They cut bats on Saturdays.',
    slot: 'bat',
    gearId: 'bat-ash',
    minFame: 10,
    payPerGame: 60,
    games: 12,
    needsAgent: false,
  },
  {
    id: 'gripz',
    brand: 'Gripz',
    blurb: 'Batting gloves out of a garage. The owner comes to every home game.',
    slot: 'battingGloves',
    gearId: 'grip-tacky',
    minFame: 10,
    payPerGame: 50,
    games: 12,
    needsAgent: false,
  },
  {
    id: 'leatherhead',
    brand: 'Leatherhead Gloves',
    blurb: 'Family tannery, third generation. Stiff, but honest.',
    slot: 'glove',
    gearId: 'mitt-breakin',
    minFame: 12,
    payPerGame: 55,
    games: 12,
    needsAgent: false,
  },
  {
    id: 'stride',
    brand: 'Stride Athletic',
    blurb: 'The sporting goods store at the mall wants your face in the window.',
    slot: 'cleats',
    gearId: 'cleat-turf',
    minFame: 12,
    payPerGame: 50,
    games: 12,
    needsAgent: false,
  },
  // ---- National: fame 35, agent.
  {
    id: 'maplecraft',
    brand: 'Maplecraft',
    blurb: 'Pro-model maple, your name burned into the barrel.',
    slot: 'bat',
    gearId: 'bat-maple',
    minFame: 35,
    payPerGame: 220,
    games: 20,
    needsAgent: true,
  },
  {
    id: 'gripz-pro',
    brand: 'Gripz Pro',
    blurb: 'The garage brand went national. Thin palm, big billboard.',
    slot: 'battingGloves',
    gearId: 'grip-pro',
    minFame: 35,
    payPerGame: 200,
    games: 20,
    needsAgent: true,
  },
  {
    id: 'leatherhead-pro',
    brand: 'Leatherhead Pro Web',
    blurb: 'The tannery top line, and a commercial shot in the outfield.',
    slot: 'glove',
    gearId: 'mitt-pro',
    minFame: 35,
    payPerGame: 210,
    games: 20,
    needsAgent: true,
  },
  {
    id: 'stride-pro',
    brand: 'Stride Pro',
    blurb: 'Metal spikes and a poster in every store in the state.',
    slot: 'cleats',
    gearId: 'cleat-pro',
    minFame: 35,
    payPerGame: 200,
    games: 20,
    needsAgent: true,
  },
  // ---- Signature: fame 65, agent.
  {
    id: 'signature-bat',
    brand: 'Signature Series',
    blurb: 'Your own line. Kids swing a bat with your name on it.',
    slot: 'bat',
    gearId: 'bat-signature',
    minFame: 65,
    payPerGame: 700,
    games: 24,
    needsAgent: true,
  },
  {
    id: 'signature-grips',
    brand: 'Custom Stitch Co.',
    blurb: 'Moulded to your hands, sold to everyone else.',
    slot: 'battingGloves',
    gearId: 'grip-custom',
    minFame: 65,
    payPerGame: 650,
    games: 24,
    needsAgent: true,
  },
  {
    id: 'signature-mitt',
    brand: 'Gamer Leather',
    blurb: 'They broke it in for you. Somebody is paid to do that now.',
    slot: 'glove',
    gearId: 'mitt-gamer',
    minFame: 65,
    payPerGame: 680,
    games: 24,
    needsAgent: true,
  },
  {
    id: 'signature-cleats',
    brand: 'Carbon Stride',
    blurb: 'Carbon plate, your logo on the heel, a TV spot.',
    slot: 'cleats',
    gearId: 'cleat-carbon',
    minFame: 65,
    payPerGame: 640,
    games: 24,
    needsAgent: true,
  },
];

export const sponsorById = (id: string): SponsorDef | undefined =>
  SPONSORS.find((s) => s.id === id);

/** The deal covering a slot, if one is running. */
export function dealForSlot(life: LifestyleState, slot: SponsorDef['slot']): SponsorDef | null {
  for (const deal of life.deals) {
    const def = sponsorById(deal.id);
    if (def?.slot === slot && deal.gamesLeft > 0) return def;
  }
  return null;
}

/** Offers on the table: fame high enough, slot free, and an agent where one is needed. */
export function availableDeals(life: LifestyleState, hasAgent: boolean): SponsorDef[] {
  return SPONSORS.filter(
    (s) => life.fame >= s.minFame && (!s.needsAgent || hasAgent) && !dealForSlot(life, s.slot),
  );
}

/** Sign. The caller hands over the gear; this only books the deal. */
export function signDeal(life: LifestyleState, id: string): SponsorDef | null {
  const def = sponsorById(id);
  if (!def || dealForSlot(life, def.slot)) return null;
  life.deals.push({ id, gamesLeft: def.games });
  noteLife(life, `You signed with ${def.brand}: ${def.games} games, free kit and a cheque.`, false);
  return def;
}

/** What every running deal pays a game, added up. */
export function dealPayPerGame(life: LifestyleState): number {
  return life.deals.reduce((sum, d) => sum + (sponsorById(d.id)?.payPerGame ?? 0), 0);
}

/**
 * A game passes on every deal. Pays out, then returns the brands that just
 * walked away so the recap can say so. The gear they supplied stays until it
 * wears out; only the cheques stop.
 */
export function tickDeals(life: LifestyleState): { paid: number; ended: SponsorDef[] } {
  const paid = dealPayPerGame(life);
  const ended: SponsorDef[] = [];
  for (const deal of life.deals) {
    deal.gamesLeft -= 1;
    if (deal.gamesLeft <= 0) {
      const def = sponsorById(deal.id);
      if (def) ended.push(def);
    }
  }
  life.deals = life.deals.filter((d) => d.gamesLeft > 0);
  return { paid, ended };
}

/* ------------------------------------------------------------------- media */

export type MediaAnswer = 'humble' | 'cocky' | 'dodge';

export interface MediaMoment {
  /** What the reporter asked. */
  question: string;
  /** Whether the game was won: a big mouth after a loss reads differently. */
  win: boolean;
}

const MEDIA_QUESTIONS_BIG = [
  'That swing tonight. Did you know it was gone off the bat?',
  'The whole park was on its feet. What was going through your head?',
  'You keep coming up big in the big moments. Where does that come from?',
];
const MEDIA_QUESTIONS_WIN = [
  'Good night for the club. What clicked?',
  'The lineup looked comfortable out there. Your take?',
];
const MEDIA_QUESTIONS_LOSS = [
  'Tough one tonight. What went wrong?',
  'Some fans are asking if this club has what it takes. What do you tell them?',
];

/**
 * Whether a reporter is waiting after the game, and what they open with. A
 * homer or a game-ending swing always draws the scrum; a routine night draws
 * one now and then, because the beat writer still needs a quote.
 */
export function mediaMomentFor(
  g: { homeRuns: number; walkOff: boolean; grandSlam: boolean; win: boolean; playoff: boolean },
  roll: () => number,
): MediaMoment | null {
  const big = g.homeRuns > 0 || g.walkOff || g.grandSlam;
  if (!big && !g.playoff && roll() > 0.18) return null;
  const pool = big ? MEDIA_QUESTIONS_BIG : g.win ? MEDIA_QUESTIONS_WIN : MEDIA_QUESTIONS_LOSS;
  const question = pool[Math.floor(roll() * pool.length)];
  return { question, win: g.win };
}

export interface MediaResult {
  fame: number;
  /** Clubhouse standing to move, for the people layer to apply. */
  clubhouse: number;
  line: string;
}

export const MEDIA_ANSWERS: Record<MediaAnswer, { label: string; quote: string }> = {
  humble: {
    label: 'Credit the team',
    quote: 'The guys in front of me did the work. I just tried not to mess it up.',
  },
  cocky: {
    label: 'Own it',
    quote: 'I have been telling people all year. Maybe now they will listen.',
  },
  dodge: {
    label: 'Say nothing much',
    quote: 'One game at a time. See you tomorrow.',
  },
};

/** The fallout from a quote. Loud after a loss costs; humble always plays. */
export function answerMedia(life: LifestyleState, answer: MediaAnswer, win: boolean): MediaResult {
  let result: MediaResult;
  switch (answer) {
    case 'humble':
      result = { fame: 1, clubhouse: 3, line: 'The clubhouse liked that one.' };
      break;
    case 'cocky':
      result = win
        ? {
            fame: 3,
            clubhouse: -3,
            line: 'It made the highlight package. A couple of teammates rolled their eyes.',
          }
        : {
            fame: -1,
            clubhouse: -5,
            line: 'The quote ran under the final score. It did not read well.',
          };
      break;
    default:
      result = { fame: 0, clubhouse: 0, line: 'Nobody remembers the quote. That was the idea.' };
  }
  result.fame = addFame(life, result.fame);
  return result;
}
