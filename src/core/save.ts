import type { PlayerProfile } from './types';
import type { LeagueState } from './league';
import type { LevelTable } from './otherLeagues';
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
 * Fill in anything a save predates. Money, gear and contracts arrived after
 * version 2 shipped, and bumping the version over additive fields would throw
 * away a career for no reason.
 */
function normalise(save: SaveData): void {
  const player = save.player;
  if (typeof player.money !== 'number') player.money = 500;
  if (!player.contract) player.contract = 'standard';
  if (!player.gear) player.gear = {};
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
  return { version: SAVE_VERSION, player, league, seasonYear: 1 };
}
