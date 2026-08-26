import type { PlayerProfile } from './types';
import type { LeagueState } from './league';
import type { LevelTable } from './otherLeagues';
import { readKey, removeKey, writeKey } from './storage';

const STORAGE_KEY = 'baseball-star:save:v1';
// Bumped when the season gained a day-by-day calendar and teams gained home
// ballparks. Older saves have no calendar to run on, so they're discarded.
const SAVE_VERSION = 2;

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

export function loadSave(): SaveData | null {
  try {
    const raw = readKey(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveData;
    if (parsed.version !== SAVE_VERSION) return null;
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
  if (!Array.isArray(player.achievements)) player.achievements = [];
}

export function writeSave(data: Omit<SaveData, 'version'>): void {
  // Failures are swallowed inside the storage layer; storage can be
  // unavailable in private modes and the demo still plays fine.
  writeKey(STORAGE_KEY, JSON.stringify({ ...data, version: SAVE_VERSION }));
}

export function clearSave(): void {
  removeKey(STORAGE_KEY);
}

export function newSave(player: PlayerProfile, league: LeagueState): SaveData {
  return { version: SAVE_VERSION, player, league, seasonYear: 1 };
}
