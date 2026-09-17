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
  /** Who negotiates for you, if anyone. See `AGENTS`. */
  agent: string | null;
  /** 0-100. How the player feels about life. Moves sleep and how much a game teaches. */
  morale: number;
  /** 0-100. Standing with the teammates. Lifts or drags their play behind you. */
  clubhouse: number;
  /** The person at home, once there is one. */
  partner: Person | null;
  /** How many kids. Each one costs a little and gives back more at home. */
  kids: number;
  /** The friend from back home who never stopped calling. Named on first sight. */
  friend: Person | null;
  /** Messages waiting for an answer. See `LifeRequest`. */
  requests: LifeRequest[];
  /** Calendar day the activity list was last reset on, and what's been done. */
  dayStamp: number;
  doneToday: string[];
  /**
   * Things that happened off the field since the clubhouse last looked, shown
   * once on the hub then cleared — same shape as the league's own news.
   */
  notices: string[];
  /** The last few life events, newest first, for the Life screen's log. */
  log: string[];
}

export interface Person {
  name: string;
  /** 0-100. Fades a point a day on the road; time together puts it back. */
  bond: number;
}

export function createLifestyle(): LifestyleState {
  return {
    home: 'apartment',
    toys: [],
    fame: 0,
    deals: [],
    agent: null,
    morale: 70,
    clubhouse: 50,
    partner: null,
    kids: 0,
    friend: null,
    requests: [],
    dayStamp: -1,
    doneToday: [],
    notices: [],
    log: [],
  };
}

const person = (p: unknown): Person | null =>
  p && typeof (p as Person).name === 'string'
    ? { name: (p as Person).name, bond: clamp(Number((p as Person).bond) || 0, 0, 100) }
    : null;

/** Fill in anything a save predates, so an old career walks in with a flat. */
export function normaliseLifestyle(life: Partial<LifestyleState> | undefined): LifestyleState {
  const fresh = createLifestyle();
  if (!life) return fresh;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 100) : fallback;
  return {
    home: HOMES.some((h) => h.id === life.home) ? (life.home as HomeId) : fresh.home,
    toys: Array.isArray(life.toys) ? life.toys.filter((id) => !!toyById(id)) : [],
    fame: num(life.fame, 0),
    deals: Array.isArray(life.deals) ? life.deals.filter((d) => !!sponsorById(d.id)) : [],
    agent: life.agent && agentById(life.agent) ? life.agent : null,
    morale: num(life.morale, fresh.morale),
    clubhouse: num(life.clubhouse, fresh.clubhouse),
    partner: person(life.partner),
    kids: Math.max(0, Math.round(Number(life.kids) || 0)),
    friend: person(life.friend),
    requests: Array.isArray(life.requests) ? life.requests : [],
    dayStamp: typeof life.dayStamp === 'number' ? life.dayStamp : -1,
    doneToday: Array.isArray(life.doneToday) ? life.doneToday : [],
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

/** What a kid costs a game. Not much; they are worth more at home than they cost. */
const KID_UPKEEP = 15;

/** What the house, everything parked outside it and everyone inside it cost, per game. */
export function upkeepPerGame(life: LifestyleState): number {
  const toys = life.toys.reduce((sum, id) => sum + (toyById(id)?.upkeep ?? 0), 0);
  return homeById(life.home).upkeep + toys + life.kids * KID_UPKEEP;
}

/**
 * Extra energy the overnight roll gives back: the bed, the drive home, and
 * how the player feels about all of it. Can go negative on a bad stretch.
 */
export function overnightEnergyBonus(life: LifestyleState): number {
  const toys = life.toys.reduce((sum, id) => sum + (toyById(id)?.restEnergy ?? 0), 0);
  return homeById(life.home).restEnergy + toys + moraleEnergyBonus(life);
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

/** The fame a signature line asks for; those brands only deal with the top agents. */
const SIGNATURE_FAME = 65;

/**
 * Offers on the table: fame high enough, slot free, and representation where
 * the brand insists on it. `tier` is `agentTier`: the national brands want
 * an agent at all, the signature lines want one who represents All-Stars.
 */
export function availableDeals(life: LifestyleState, tier: number): SponsorDef[] {
  return SPONSORS.filter((s) => {
    if (life.fame < s.minFame || dealForSlot(life, s.slot)) return false;
    if (!s.needsAgent) return true;
    return s.minFame >= SIGNATURE_FAME ? tier >= 2 : tier >= 1;
  });
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

/* ------------------------------------------------------------------ agents */

export interface AgentDef {
  id: string;
  name: string;
  blurb: string;
  /** Share of every cheque: salary, bonus and sponsor money alike. */
  cut: number;
  /** Paid once, on signing. */
  fee: number;
  /** 1 opens the national brands; 2 opens the signature lines too. */
  tier: 1 | 2;
  /** Can rewrite the contract style mid-season. */
  renegotiates: boolean;
  /** What they squeeze out of the club on the guaranteed money. */
  salaryMult: number;
}

export const AGENTS: AgentDef[] = [
  {
    id: 'marty',
    name: 'Marty Kowalski',
    blurb: 'A friend of the family with a fax machine. Answers the phone, mostly.',
    cut: 0.06,
    fee: 400,
    tier: 1,
    renegotiates: false,
    salaryMult: 1,
  },
  {
    id: 'voss',
    name: 'Dana Voss · Voss Sports',
    blurb: 'Represents half the All-Star team. Takes a real cut and earns it.',
    cut: 0.12,
    fee: 5000,
    tier: 2,
    renegotiates: true,
    salaryMult: 1.1,
  },
];

export const agentById = (id: string | null | undefined): AgentDef | null =>
  (id && AGENTS.find((a) => a.id === id)) || null;

export const agentOf = (life: LifestyleState): AgentDef | null => agentById(life.agent);

/** 0 without representation, else the agent's tier. What the sponsors ask about. */
export const agentTier = (life: LifestyleState): number => agentOf(life)?.tier ?? 0;

export function hireAgent(player: PlayerProfile, life: LifestyleState, id: string): boolean {
  const def = agentById(id);
  if (!def || life.agent === id || player.money < def.fee) return false;
  player.money -= def.fee;
  life.agent = id;
  noteLife(life, `${def.name} is your agent now. ${Math.round(def.cut * 100)}% of everything.`, false);
  return true;
}

export function fireAgent(life: LifestyleState): void {
  const def = agentOf(life);
  if (!def) return;
  life.agent = null;
  noteLife(life, `You and ${def.name} parted ways.`, false);
}

/** The agent's share of a night's money, rounded down so a small cheque survives. */
export function agentCut(life: LifestyleState, money: number): number {
  const def = agentOf(life);
  return def ? Math.floor(Math.max(0, money) * def.cut) : 0;
}

/* --------------------------------------------------------------- the people */

/** Morale and the clubhouse: what they do, in numbers. */

/** Overnight energy from how you feel: -10 at rock bottom, +10 walking on air. */
export const moraleEnergyBonus = (life: LifestyleState): number =>
  Math.round((life.morale - 50) / 5);

/** How much a game teaches, 0.9-1.1. A miserable player is not learning much. */
export const moraleXpMult = (life: LifestyleState): number => 0.9 + life.morale / 500;

/** Rating points on every teammate, -4 to +4. They play for you, or they don't. */
export const teammateBoost = (life: LifestyleState): number =>
  Math.round((life.clubhouse - 50) / 12);

export function addMorale(life: LifestyleState, amount: number): void {
  life.morale = clamp(life.morale + amount, 0, 100);
}

export function addClubhouse(life: LifestyleState, amount: number): void {
  life.clubhouse = clamp(life.clubhouse + amount, 0, 100);
}

const bond = (p: Person | null, amount: number): void => {
  if (p) p.bond = clamp(p.bond + amount, 0, 100);
};

/** The friend from home is there from day one; they just need a name. */
export function ensurePeople(life: LifestyleState, name: () => string): void {
  if (!life.friend) life.friend = { name: name(), bond: 60 };
}

/* ---------------------------------------------------------------- requests */

export type RequestKind = 'tickets' | 'dinner';

export interface LifeRequest {
  id: string;
  kind: RequestKind;
  from: string;
  text: string;
  /** Money it costs to say yes. */
  cost: number;
  acceptLabel: string;
  declineLabel: string;
}

let requestSeq = 0;

/** Say yes. Returns what happened, or null if it can't be afforded. */
export function acceptRequest(
  player: PlayerProfile,
  life: LifestyleState,
  id: string,
): string | null {
  const req = life.requests.find((r) => r.id === id);
  if (!req) return null;
  if (player.money < req.cost) return null;
  player.money -= req.cost;
  life.requests = life.requests.filter((r) => r.id !== id);
  let line: string;
  if (req.kind === 'tickets') {
    bond(life.friend, 12);
    addMorale(life, 4);
    line = `${req.from} was in the stands, loud. Worth every dollar.`;
  } else {
    bond(life.partner, 15);
    addMorale(life, 8);
    line = `Dinner with ${req.from}. The season felt a long way off for a night.`;
  }
  noteLife(life, line, false);
  return line;
}

export function declineRequest(life: LifestyleState, id: string): string | null {
  const req = life.requests.find((r) => r.id === id);
  if (!req) return null;
  life.requests = life.requests.filter((r) => r.id !== id);
  let line: string;
  if (req.kind === 'tickets') {
    bond(life.friend, -10);
    line = `${req.from} said it was fine. It was not fine.`;
  } else {
    bond(life.partner, -12);
    addMorale(life, -4);
    line = `${req.from} ate alone.`;
  }
  noteLife(life, line, false);
  return line;
}

/* ------------------------------------------------------------- activities */

export interface ActivityDef {
  id: string;
  name: string;
  detail: string;
  energyCost: number;
  /** Cost in dollars at a given level; a night out in the Majors is not a night out in Single-A. */
  cost: (levelId: number) => number;
  morale: number;
  fame: number;
  clubhouse: number;
  stamina: number;
  partnerBond: number;
  friendBond: number;
  /** Chance of meeting someone, when there's nobody at home. */
  meetPartner: number;
  /** Needs this toy in the garage. */
  needsToy?: string;
}

export const ACTIVITIES: ActivityDef[] = [
  {
    id: 'family',
    name: 'Family Time',
    detail: 'Call home, or go home. The people who knew you before the number on your back.',
    energyCost: 25,
    cost: () => 0,
    morale: 15,
    fame: 0,
    clubhouse: 0,
    stamina: 0,
    partnerBond: 20,
    friendBond: 6,
    meetPartner: 0,
  },
  {
    id: 'nightout',
    name: 'Night Out',
    detail: 'Downtown with the guys. You might meet someone. You might feel it tomorrow.',
    energyCost: 30,
    cost: (level) => 60 * (level + 1),
    morale: 10,
    fame: 1,
    clubhouse: 2,
    stamina: -3,
    partnerBond: -4,
    friendBond: 0,
    meetPartner: 0.35,
  },
  {
    id: 'charity',
    name: 'Charity Event',
    detail: 'A hospital visit, a youth clinic, a photo with the mayor. The name travels.',
    energyCost: 25,
    cost: (level) => 100 * (level + 1),
    morale: 4,
    fame: 3,
    clubhouse: 1,
    stamina: 0,
    partnerBond: 0,
    friendBond: 0,
    meetPartner: 0,
  },
  {
    id: 'teamdinner',
    name: 'Team Dinner',
    detail: 'You pick up the cheque. Nobody forgets who picked up the cheque.',
    energyCost: 20,
    cost: (level) => 40 * (level + 1),
    morale: 5,
    fame: 0,
    clubhouse: 7,
    stamina: 0,
    partnerBond: 0,
    friendBond: 0,
    meetPartner: 0,
  },
  {
    id: 'fishing',
    name: 'Fishing Trip',
    detail: 'A borrowed rod and a quiet bank. Nothing bites, and that is the point.',
    energyCost: 20,
    cost: () => 30,
    morale: 12,
    fame: 0,
    clubhouse: 0,
    stamina: 4,
    partnerBond: 0,
    friendBond: 4,
    meetPartner: 0,
  },
  {
    id: 'boatday',
    name: 'Day on the Water',
    detail: 'Your boat, your people, no signal. The best rest money can buy.',
    energyCost: 20,
    cost: () => 0,
    morale: 20,
    fame: 0,
    clubhouse: 0,
    stamina: 6,
    partnerBond: 10,
    friendBond: 6,
    meetPartner: 0,
    needsToy: 'boat',
  },
];

/** Reset the once-a-day list when the calendar has moved on. */
function stampDay(life: LifestyleState, day: number): void {
  if (life.dayStamp !== day) {
    life.dayStamp = day;
    life.doneToday = [];
  }
}

export function activitiesFor(life: LifestyleState, day: number): ActivityDef[] {
  stampDay(life, day);
  return ACTIVITIES.filter((a) => !a.needsToy || ownsToy(life, a.needsToy));
}

export const activityDone = (life: LifestyleState, id: string): boolean =>
  life.doneToday.includes(id);

export interface ActivityOutcome {
  lines: string[];
}

/**
 * Do the thing. Null when it can't be afforded in energy or money, or has
 * already been done today. `partnerName` is asked for only when someone is
 * actually met, so the caller can keep the name generator to itself.
 */
export function doActivity(
  player: PlayerProfile,
  life: LifestyleState,
  activity: ActivityDef,
  levelId: number,
  day: number,
  roll: () => number,
  partnerName: () => string,
): ActivityOutcome | null {
  stampDay(life, day);
  if (activityDone(life, activity.id)) return null;
  const cost = activity.cost(levelId);
  if (player.energy < activity.energyCost || player.money < cost) return null;

  player.energy = clamp(player.energy - activity.energyCost, 0, 100);
  player.money -= cost;
  player.stamina = clamp(player.stamina + activity.stamina, 0, 100);
  addMorale(life, activity.morale);
  addClubhouse(life, activity.clubhouse);
  const fame = addFame(life, activity.fame);
  bond(life.partner, activity.partnerBond);
  bond(life.friend, activity.friendBond);
  life.doneToday.push(activity.id);

  const lines: string[] = [];
  if (!life.partner && activity.meetPartner > 0 && roll() < activity.meetPartner) {
    life.partner = { name: partnerName(), bond: 45 };
    lines.push(`You met ${life.partner.name}. You swapped numbers.`);
    noteLife(life, `You met ${life.partner.name}.`, false);
  }
  if (fame >= 1) lines.push(`+${Math.round(fame)} fame.`);
  if (activity.clubhouse > 0) lines.push(`The clubhouse noticed.`);
  if (activity.morale > 0) lines.push(`Morale +${activity.morale}.`);
  return { lines };
}

/* --------------------------------------------------------------- the days */

export interface DayTickContext {
  levelId: number;
  /** Whether a game was played today. Road life wears on the people at home. */
  gameDay: boolean;
  won: boolean | null;
  roll: () => number;
}

/**
 * A day passes. Morale drifts back toward even, the people at home get a
 * little further away, the clubhouse remembers who won, and now and then
 * somebody asks for something. Returns nothing; anything worth saying goes
 * on the notice board.
 */
export function lifeDayTick(life: LifestyleState, ctx: DayTickContext): void {
  // Morale drifts toward 60 by a point a day.
  if (life.morale > 60) life.morale -= 1;
  else if (life.morale < 60) life.morale += 1;

  if (ctx.gameDay) {
    if (ctx.won === true) addClubhouse(life, 2);
    else if (ctx.won === false) addClubhouse(life, -1);
    bond(life.partner, -1.5);
    bond(life.friend, -1);
  } else {
    bond(life.friend, -0.5);
  }

  // A partner who never sees you stops waiting.
  if (life.partner && life.partner.bond <= 0) {
    noteLife(life, `${life.partner.name} moved out. You were never home.`);
    life.partner = null;
    addMorale(life, -20);
  } else if (life.partner && life.partner.bond < 30) {
    addMorale(life, -1);
  }

  // One ask at a time; nobody wants a phone full of them.
  if (life.requests.length === 0) {
    if (life.friend && ctx.roll() < 0.08) {
      life.requests.push({
        id: `r${++requestSeq}-${Date.now()}`,
        kind: 'tickets',
        from: life.friend.name,
        text: `${life.friend.name} is in town this weekend and wondering about tickets. Good ones.`,
        cost: 40 * (ctx.levelId + 1),
        acceptLabel: 'Sort the tickets',
        declineLabel: 'Not this time',
      });
      noteLife(life, `${life.friend.name} texted. There's a message waiting off the field.`, true);
    } else if (life.partner && ctx.roll() < 0.06) {
      life.requests.push({
        id: `r${++requestSeq}-${Date.now()}`,
        kind: 'dinner',
        from: life.partner.name,
        text: `${life.partner.name} booked a table. Tonight, after the park.`,
        cost: 30 * (ctx.levelId + 1),
        acceptLabel: 'Be there',
        declineLabel: 'Too tired',
      });
      noteLife(life, `${life.partner.name} texted. There's a message waiting off the field.`, true);
    }
  }
}

/**
 * The winter at home. A partner who's been kept close might make it a family;
 * a kid is a small cost every game and a bigger reason to go home.
 */
export function lifeOffseason(life: LifestyleState, roll: () => number): string[] {
  const lines: string[] = [];
  if (life.partner) {
    bond(life.partner, 15);
    if (life.partner.bond >= 70 && life.kids < 3 && roll() < 0.3) {
      life.kids += 1;
      addMorale(life, 15);
      const line =
        life.kids === 1
          ? `You and ${life.partner.name} had a baby over the winter.`
          : `Another one. That makes ${life.kids} kids at home.`;
      noteLife(life, line);
      lines.push(line);
    }
  }
  if (life.friend) bond(life.friend, 10);
  return lines;
}
