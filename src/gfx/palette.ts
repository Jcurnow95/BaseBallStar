import type { SkyKind, Weather } from '../core/weather';

/**
 * One colour system for every canvas in the game.
 *
 * The park is a bright day: yellow-green grass cut in a checker, warm clay,
 * green padded walls with a yellow cap, and tiers of dark-green seats. Weather
 * doesn't swap palettes — it relights this one. An overcast day flattens the
 * light, rain soaks the colours and blues them, a storm nearly turns the
 * lights on. Everything drawn reads its colours off a `Lighting` so the at-bat
 * scene, the field and the derby all agree on what the day looks like.
 */

export interface Lighting {
  sky: SkyKind;
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  /** How strongly the sun shows, 0-1. Gone under cloud. */
  sun: number;
  /** Cloud cover, 0-1. */
  cloud: number;
  grass: string;
  grassAlt: string;
  /** Distant grass, hazier and bluer. */
  grassFar: string;
  dirt: string;
  dirtDark: string;
  dirtLight: string;
  track: string;
  chalk: string;
  wall: string;
  wallDark: string;
  wallCap: string;
  seats: string;
  seatsAlt: string;
  concrete: string;
  concreteDark: string;
  outside: string;
  tree: string;
  treeDark: string;
  /** Alpha of cast shadows. Hard in sun, soft under cloud. */
  shadow: number;
  /** 0 dry, 1 soaked. Grass sheen, dirt darkening. */
  wet: number;
  /** A final wash over everything, and how much of it. */
  tint: string;
  tintAlpha: number;
}

/** Bright, clear afternoon — the base everything else is derived from. */
const CLEAR: Lighting = {
  sky: 'clear',
  skyTop: '#2f7fd6',
  skyMid: '#63aee8',
  skyHorizon: '#bfe3f7',
  sun: 1,
  cloud: 0.25,
  grass: '#79c043',
  grassAlt: '#5faa35',
  grassFar: '#8cc45a',
  dirt: '#cfa068',
  dirtDark: '#b3844f',
  dirtLight: '#e0b57e',
  track: '#c2915c',
  chalk: '#fbfbf6',
  wall: '#2a6d3f',
  wallDark: '#1d5230',
  wallCap: '#f4d654',
  seats: '#2c5d3b',
  seatsAlt: '#356c46',
  concrete: '#c7c3b8',
  concreteDark: '#a8a49a',
  outside: '#8fb46a',
  tree: '#3f8a3c',
  treeDark: '#2e6a2c',
  shadow: 0.28,
  wet: 0,
  tint: '#000000',
  tintAlpha: 0,
};

/** Bright, clear day. Every other sky is this one, relit. */
export function lightingFor(weather: Weather | undefined): Lighting {
  const sky = weather?.sky ?? 'clear';
  const rain = weather?.rain ?? 0;
  if (sky === 'clear') return CLEAR;

  if (sky === 'overcast') {
    return {
      ...relight(CLEAR, 0.86, '#6f7f95', 0.14),
      sky,
      skyTop: '#7d8ea3',
      skyMid: '#a6b3c2',
      skyHorizon: '#d6dde5',
      sun: 0,
      cloud: 0.9,
      shadow: 0.14,
      tint: '#4b5872',
      tintAlpha: 0.06,
    };
  }

  if (sky === 'rain') {
    return {
      ...relight(CLEAR, 0.72, '#4a5b7a', 0.26),
      sky,
      skyTop: '#55617a',
      skyMid: '#7b889c',
      skyHorizon: '#a8b2c0',
      sun: 0,
      cloud: 1,
      shadow: 0.1,
      wet: Math.max(0.5, rain),
      tint: '#2e3c5a',
      tintAlpha: 0.14,
    };
  }

  // Storm.
  return {
    ...relight(CLEAR, 0.58, '#2c3752', 0.36),
    sky,
    skyTop: '#2a3142',
    skyMid: '#434c60',
    skyHorizon: '#6a7385',
    sun: 0,
    cloud: 1,
    shadow: 0.08,
    wet: 1,
    tint: '#1a2338',
    tintAlpha: 0.22,
  };
}

/** Darken every surface colour and pull it toward a cast. */
function relight(base: Lighting, brightness: number, cast: string, amount: number): Lighting {
  const out = { ...base };
  const keys: (keyof Lighting)[] = [
    'grass', 'grassAlt', 'grassFar', 'dirt', 'dirtDark', 'dirtLight', 'track',
    'wall', 'wallDark', 'wallCap', 'seats', 'seatsAlt', 'concrete', 'concreteDark',
    'outside', 'tree', 'treeDark',
  ];
  for (const key of keys) {
    (out as unknown as Record<string, string>)[key] = scale(mix(base[key] as string, cast, amount), brightness);
  }
  out.chalk = scale(base.chalk, Math.max(0.8, brightness));
  return out;
}

/* ------------------------------------------------------------- colour maths */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend of two hex colours. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Multiply a hex colour's brightness. */
export function scale(hex: string, k: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * k, g * k, b * k);
}

/** A hex colour with an alpha, as an rgba() string. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Crowd colours: what people wear. Muted and varied — a stand of identical
 * dots reads as a texture, a stand of bright ones pulls the eye off the ball.
 */
export const CROWD_COLOURS = [
  '#e9e4d6', '#c95a4f', '#3d6fb5', '#f0c75e', '#7a8ea8', '#d9d0c1',
  '#2f4b7a', '#b7c8de', '#e08a4a', '#5a5f6b', '#f4efe4', '#8fb3a1',
];

/** The gold every "act here" cue shares — landing ring, timing lock, force rings. */
export const CUE_GOLD = '#ffd166';
export const CUE_RED = '#ff6b6b';
export const CUE_GREEN = '#5ce6a0';
export const SKIN_TONES = ['#f1c9a5', '#d9a37a', '#b97a52', '#8d5a3b', '#6b4029'];

/** Skin for a figure with a stable identity, so one player keeps one face. */
export function skinFor(seed: number): string {
  return SKIN_TONES[hash(seed) % SKIN_TONES.length];
}

/** Cheap integer hash for deterministic scatter (seats, clouds, rain). */
export function hash(i: number): number {
  let h = (i + 1) * 0x9e3779b1;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 0..1 from a hash. */
export function unit(h: number, shift = 0): number {
  return ((h >>> shift) & 0xffff) / 0xffff;
}
