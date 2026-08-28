import type { PlayerProfile } from './types';
import type { LeagueState } from './league';
import type { SeasonAwards } from './awards';
import type { UnlockedTrophy } from './trophies';
import type { LevelTable } from './otherLeagues';
import { ROOKIE_AGE } from './player';
import { readKey, removeKey, writeKey } from './storage';

const STORAGE_KEY = 'baseball-star:save:v1';
// Bumped when the season gained a day-by-day calendar and teams gained home
// ballparks. Older saves have no calendar to run on, so they're discarded.
const SAVE_VERSION = 2;

/** Three careers live side by side, picked from the title screen. */
export const SLOT_COUNT = 3;

// Slot 0 keeps the original single-save key, so a career from before slots
// existed shows up as the first character without any migration step.
const slotKey = (slot: number): string =>
  slot === 0 ? STORAGE_KEY : `${STORAGE_KEY}:slot${slot}`;

export interface SaveData {
  version: number;
  player: PlayerProfile;
  league: LeagueState;
  seasonYear: number;
  /** Award season, one entry per year voted. See `core/awards.ts`. */
  awards: SeasonAwards[];
  /** The trophy case, oldest first. See `core/trophies.ts`. */
  trophies: UnlockedTrophy[];
  /**
   * Standings for the levels the player isn't at, kept in step with the
   * player's season by `syncOtherLevels`. Optional so pre-feature saves still
   * load; a missing one is built the first time the standings screen asks.
   */
  otherLevels?: LevelTable[];
}

export function loadSave(slot: number): SaveData | null {
  const raw = readKey(slotKey(slot));
  return raw ? parseSave(raw) : null;
}

/**
 * Parse and validate a serialised save — from storage or from a file another
 * device exported. Anything that isn't a save this version can run returns
 * null rather than throwing.
 */
export function parseSave(raw: string): SaveData | null {
  try {
    const parsed = JSON.parse(raw) as SaveData;
    if (parsed.version !== SAVE_VERSION) return null;
    if (!parsed.player || !parsed.league) return null;
    normalise(parsed);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Fill in anything a save predates. Money, gear, contracts, ages and the award
 * season all arrived after version 2 shipped, and bumping the version over
 * additive fields would throw away a career for no reason. A save from before
 * awards starts with an empty trophy case rather than back-dated trophies:
 * the seasons that would have to be voted on are gone.
 */
function normalise(save: SaveData): void {
  const player = save.player;
  if (typeof player.money !== 'number') player.money = 500;
  if (!player.contract) player.contract = 'standard';
  if (!player.gear) player.gear = {};
  if (!Array.isArray(player.achievements)) player.achievements = [];
  if (!Array.isArray(save.awards)) save.awards = [];
  // A save from before the trophy case starts it empty rather than back-filled:
  // a slam that was hit two seasons ago left no record to find.
  if (!Array.isArray(save.trophies)) save.trophies = [];
  // A career from before ages existed gets the one it would have had: signed
  // at eighteen, a birthday for every season already played.
  if (typeof player.age !== 'number') {
    player.age = ROOKIE_AGE + Math.max(0, (save.seasonYear ?? 1) - 1);
  }
}

export function writeSave(slot: number, data: Omit<SaveData, 'version'>): void {
  // Failures are swallowed inside the storage layer; storage can be
  // unavailable in private modes and the demo still plays fine.
  writeKey(slotKey(slot), serialiseSave(data));
}

/** The exact bytes a save occupies — what export writes and import reads. */
export function serialiseSave(data: Omit<SaveData, 'version'>): string {
  return JSON.stringify({ ...data, version: SAVE_VERSION });
}

export function clearSave(slot: number): void {
  removeKey(slotKey(slot));
}

export function newSave(player: PlayerProfile, league: LeagueState): SaveData {
  return { version: SAVE_VERSION, player, league, seasonYear: 1, awards: [], trophies: [] };
}
