import type { PlayerProfile } from './types';
import type { LeagueState } from './league';
import type { SeasonAwards } from './awards';
import type { UnlockedAchievement } from './achievements';
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
  /** Award season, one entry per year voted. See `core/awards.ts`. */
  awards: SeasonAwards[];
  /** The trophy case, oldest first. See `core/achievements.ts`. */
  achievements: UnlockedAchievement[];
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
 * Fill in anything a save predates. Money, gear, contracts and the award
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
  if (!Array.isArray(save.awards)) save.awards = [];
  // A save from before the trophy case starts it empty rather than back-filled:
  // a slam that was hit two seasons ago left no record to find.
  if (!Array.isArray(save.achievements)) save.achievements = [];
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
  return { version: SAVE_VERSION, player, league, seasonYear: 1, awards: [], achievements: [] };
}
