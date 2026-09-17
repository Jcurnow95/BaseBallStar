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
  /**
   * Things that happened off the field since the clubhouse last looked, shown
   * once on the hub then cleared — same shape as the league's own news.
   */
  notices: string[];
  /** The last few life events, newest first, for the Life screen's log. */
  log: string[];
}

export function createLifestyle(): LifestyleState {
  return { home: 'apartment', toys: [], notices: [], log: [] };
}

/** Fill in anything a save predates, so an old career walks in with a flat. */
export function normaliseLifestyle(life: Partial<LifestyleState> | undefined): LifestyleState {
  const fresh = createLifestyle();
  if (!life) return fresh;
  return {
    home: HOMES.some((h) => h.id === life.home) ? (life.home as HomeId) : fresh.home,
    toys: Array.isArray(life.toys) ? life.toys.filter((id) => !!toyById(id)) : [],
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
