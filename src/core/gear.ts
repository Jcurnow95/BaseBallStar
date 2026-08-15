import type { Attributes, BattingStats, PlayerProfile } from './types';
import { clamp } from './rng';

/**
 * Gear and money.
 *
 * You are paid per game — a guaranteed cheque from the contract you signed,
 * plus a bonus for what you actually did — and you spend it on equipment that
 * lifts your attributes for a limited number of games. Better gear costs more,
 * hits harder, and lasts longer, so the choice is between kitting out one slot
 * properly and spreading a thin layer over all four.
 *
 * Gear is deliberately temporary. A permanent stat buy would just be a slower
 * version of the attribute-point economy; wear is what keeps the money loop
 * running all season.
 */

export type GearSlot = 'bat' | 'battingGloves' | 'glove' | 'cleats';

export const GEAR_SLOTS: GearSlot[] = ['bat', 'battingGloves', 'glove', 'cleats'];

export const SLOT_LABELS: Record<GearSlot, string> = {
  bat: 'Bat',
  battingGloves: 'Batting Gloves',
  glove: 'Fielding Glove',
  cleats: 'Cleats',
};

export interface GearDefinition {
  id: string;
  slot: GearSlot;
  name: string;
  blurb: string;
  /** Cost in dollars. */
  price: number;
  /** Games of wear before it is used up. */
  games: number;
  bonuses: Partial<Attributes>;
}

/** A piece of gear the player owns, with the wear left on it. */
export interface OwnedGear {
  id: string;
  gamesLeft: number;
}

export type GearLocker = Partial<Record<GearSlot, OwnedGear>>;

export const GEAR_CATALOGUE: GearDefinition[] = [
  // ---- Bats: power, and a little contact once they are properly milled.
  {
    id: 'bat-ash',
    slot: 'bat',
    name: 'Ash Club',
    blurb: 'Team issue. Heavy, honest, splinters on the handle.',
    price: 350,
    games: 6,
    bonuses: { power: 3 },
  },
  {
    id: 'bat-maple',
    slot: 'bat',
    name: 'Maple Pro Model',
    blurb: 'Hard maple, balanced knob. You feel the barrel find the ball.',
    price: 1100,
    games: 12,
    bonuses: { power: 6, contact: 2 },
  },
  {
    id: 'bat-signature',
    slot: 'bat',
    name: 'Signature Barrel',
    blurb: 'Cut to your hands. The good ones leave in a hurry.',
    price: 2900,
    games: 20,
    bonuses: { power: 10, contact: 4 },
  },

  // ---- Batting gloves: contact, then the eye that goes with it.
  {
    id: 'grip-tacky',
    slot: 'battingGloves',
    name: 'Tacky Grips',
    blurb: 'Cheap leather, but the bat stops moving in your hands.',
    price: 300,
    games: 6,
    bonuses: { contact: 3 },
  },
  {
    id: 'grip-pro',
    slot: 'battingGloves',
    name: 'Pro Grips',
    blurb: 'Thin palm, no bunching. You can feel the seams.',
    price: 950,
    games: 12,
    bonuses: { contact: 6, vision: 2 },
  },
  {
    id: 'grip-custom',
    slot: 'battingGloves',
    name: 'Custom Stitch Grips',
    blurb: 'Moulded to your grip. The ball looks a size bigger.',
    price: 2600,
    games: 20,
    bonuses: { contact: 9, vision: 4 },
  },

  // ---- Fielding gloves: glove window, then the arm behind it.
  {
    id: 'mitt-breakin',
    slot: 'glove',
    name: 'Break-In Mitt',
    blurb: 'Stiff out of the box, but it closes when you tell it to.',
    price: 320,
    games: 6,
    bonuses: { fielding: 3 },
  },
  {
    id: 'mitt-pro',
    slot: 'glove',
    name: 'Pro Web Mitt',
    blurb: 'Deep pocket, quick transfer. Balls stop finding the grass.',
    price: 1000,
    games: 12,
    bonuses: { fielding: 6, arm: 3 },
  },
  {
    id: 'mitt-gamer',
    slot: 'glove',
    name: 'Gamer Mitt',
    blurb: 'Broken in over years. It catches things you did not reach for.',
    price: 2700,
    games: 20,
    bonuses: { fielding: 10, arm: 5 },
  },

  // ---- Cleats: speed, and footing in the outfield at the top end.
  {
    id: 'cleat-turf',
    slot: 'cleats',
    name: 'Turf Trainers',
    blurb: 'Not really spikes. Better than what you turned up in.',
    price: 280,
    games: 6,
    bonuses: { speed: 3 },
  },
  {
    id: 'cleat-pro',
    slot: 'cleats',
    name: 'Pro Spikes',
    blurb: 'Metal, low cut. Ninety feet gets noticeably shorter.',
    price: 900,
    games: 12,
    bonuses: { speed: 6 },
  },
  {
    id: 'cleat-carbon',
    slot: 'cleats',
    name: 'Carbon Spikes',
    blurb: 'Feather light. You get to balls you had written off.',
    price: 2500,
    games: 20,
    bonuses: { speed: 10, fielding: 2 },
  },
];

export const gearById = (id: string): GearDefinition | undefined =>
  GEAR_CATALOGUE.find((g) => g.id === id);

export const gearForSlot = (slot: GearSlot): GearDefinition[] =>
  GEAR_CATALOGUE.filter((g) => g.slot === slot);

/* ------------------------------------------------------------------ effects */

/** Everything the player's equipped gear is adding right now. */
export function gearBonuses(locker: GearLocker): Partial<Attributes> {
  const total: Partial<Attributes> = {};
  for (const slot of GEAR_SLOTS) {
    const owned = locker[slot];
    if (!owned || owned.gamesLeft <= 0) continue;
    const def = gearById(owned.id);
    if (!def) continue;
    for (const [key, value] of Object.entries(def.bonuses) as [keyof Attributes, number][]) {
      total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}

/**
 * Attributes as the game should actually play them: base plus gear.
 *
 * Everything on the field runs off this — the sweet spot, the glove window,
 * how fast you cover ninety feet. The promotion check deliberately does not:
 * the front office is rating the player, not their bat.
 */
export function effectiveAttributes(player: PlayerProfile): Attributes {
  const bonuses = gearBonuses(player.gear ?? {});
  const out = { ...player.attributes };
  for (const [key, value] of Object.entries(bonuses) as [keyof Attributes, number][]) {
    out[key] = clamp(out[key] + value, 1, 99);
  }
  return out;
}

/** A player profile with gear folded in, for handing to the gameplay views. */
export function playerWithGear(player: PlayerProfile): PlayerProfile {
  return { ...player, attributes: effectiveAttributes(player) };
}

/**
 * Wear a game off everything equipped. Returns whatever fell apart, so the
 * post-game screen can tell the player they need to go shopping.
 */
export function wearGear(player: PlayerProfile): GearDefinition[] {
  const locker = player.gear ?? (player.gear = {});
  const wornOut: GearDefinition[] = [];
  for (const slot of GEAR_SLOTS) {
    const owned = locker[slot];
    if (!owned) continue;
    owned.gamesLeft -= 1;
    if (owned.gamesLeft <= 0) {
      const def = gearById(owned.id);
      if (def) wornOut.push(def);
      delete locker[slot];
    }
  }
  return wornOut;
}

/* ---------------------------------------------------------------- contracts */

export type ContractStyle = 'standard' | 'guaranteed' | 'incentive';

export interface ContractOffer {
  id: ContractStyle;
  name: string;
  blurb: string;
  /** Multiplier on the level's base per-game salary. */
  salaryMult: number;
  /** Multiplier on performance money. */
  bonusMult: number;
}

export const CONTRACTS: ContractOffer[] = [
  {
    id: 'standard',
    name: 'Standard Deal',
    blurb: 'What everyone else signs. Fair money, fair bonuses.',
    salaryMult: 1,
    bonusMult: 1,
  },
  {
    id: 'guaranteed',
    name: 'Guaranteed Money',
    blurb: 'Bigger cheque every game, whatever you do. Bonuses are thin.',
    salaryMult: 1.6,
    bonusMult: 0.45,
  },
  {
    id: 'incentive',
    name: 'Incentive Laden',
    blurb: 'Barely a wage. Get paid properly only if you produce.',
    salaryMult: 0.4,
    bonusMult: 2.1,
  },
];

export const contractById = (id: ContractStyle | undefined): ContractOffer =>
  CONTRACTS.find((c) => c.id === id) ?? CONTRACTS[0];

/** Base per-game salary at each level, before the contract's multiplier. */
const LEVEL_SALARY = [150, 380, 850, 2000];
/** Performance money scales with the level too — a Majors homer is worth more. */
const LEVEL_BONUS_SCALE = [1, 1.6, 2.6, 4.5];

export interface Earnings {
  salary: number;
  bonus: number;
  total: number;
}

/**
 * What a game paid. The bonus is deliberately weighted toward the things the
 * player actually controls at the plate and in the field, so an incentive deal
 * is a real bet on yourself rather than on the team.
 */
export function gameEarnings(
  levelId: number,
  contract: ContractStyle | undefined,
  game: BattingStats,
  putouts: number,
  win: boolean,
): Earnings {
  const offer = contractById(contract);
  const level = clamp(levelId, 0, LEVEL_SALARY.length - 1);
  const salary = Math.round(LEVEL_SALARY[level] * offer.salaryMult);

  const raw =
    game.singles * 25 +
    game.doubles * 45 +
    game.triples * 70 +
    game.homeRuns * 150 +
    game.walks * 15 +
    game.rbi * 30 +
    game.stolenBases * 20 +
    putouts * 15 +
    (win ? 50 : 0);

  const bonus = Math.round(raw * LEVEL_BONUS_SCALE[level] * offer.bonusMult);
  return { salary, bonus, total: salary + bonus };
}

/** Per-game salary shown on the contract, for the hub and the store. */
export function contractSalary(levelId: number, contract: ContractStyle | undefined): number {
  const level = clamp(levelId, 0, LEVEL_SALARY.length - 1);
  return Math.round(LEVEL_SALARY[level] * contractById(contract).salaryMult);
}

export function formatMoney(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}
