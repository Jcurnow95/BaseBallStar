/**
 * Game audio.
 *
 * Two mechanisms, because the two jobs want different things:
 *
 * - **Effects** go through Web Audio. They need to fire the instant a tap
 *   lands, and several can overlap (a whiff while the crowd is still cheering),
 *   which an `<audio>` element handles badly.
 * - **The crowd bed** is a plain streaming `<audio>` element. It's a seven
 *   minute file; decoding that into a Web Audio buffer would cost ~70 MB of
 *   PCM for something we only ever play at low volume in the background.
 *
 * Every clip here is a raw library recording — most are multi-take files with
 * several seconds of room tone or a dozen different hits in them. Rather than
 * ship trimmed copies, each clip declares the exact window worth playing and
 * `start(when, offset, duration)` does the trimming at playback. The offsets
 * and gains below were measured off the decoded waveforms, not guessed: see
 * `public/audio/README.md`.
 */

import { readKey, writeKey } from '../core/storage';

interface Clip {
  /** Base name in public/audio. An array means pick one at random per play. */
  file: string | readonly string[];
  /** Seconds into the file where the usable sound starts. */
  offset: number;
  /** Seconds to play from `offset`. */
  duration: number;
  /**
   * Playback gain. Derived from the measured peak inside the window above —
   * the source files sit anywhere from -0.19 to -0.96 full scale, so without
   * this the mix is wildly uneven. Values over 1 are boosting quiet clips.
   */
  gain: number;
  /** Random playback-rate wobble, so repeats don't sound copy-pasted. */
  vary?: number;
}

export type SoundName =
  | 'whiff'
  | 'contactBarrel'
  | 'contactSolid'
  | 'contactWeak'
  | 'foul'
  | 'mitt'
  | 'catchMade'
  | 'catchMissed'
  | 'homeRun'
  | 'rally'
  | 'fanfare'
  | 'cheerBig'
  | 'cheerShort'
  | 'cheerSoft'
  | 'clap'
  | 'organ';

const CLIPS: Record<SoundName, Clip> = {
  // Five takes of the same swing, picked at random and pitched slightly apart.
  // Strikeouts are the most-repeated sound in the game by a distance.
  whiff: {
    file: ['whiff-1', 'whiff-2', 'whiff-3', 'whiff-4', 'whiff-5'],
    offset: 0.04,
    duration: 0.2,
    gain: 0.45,
    vary: 0.08,
  },
  // The fourth hit in the file — the only one with real ring on it.
  contactBarrel: { file: 'bat-hit-ping', offset: 1.26, duration: 0.75, gain: 1.45, vary: 0.04 },
  contactSolid: { file: 'bat-tap', offset: 3.15, duration: 0.35, gain: 0.85, vary: 0.05 },
  contactWeak: { file: 'bat-bonk', offset: 0.52, duration: 0.45, gain: 1.0, vary: 0.06 },
  // A shorter, deader tick from the head of the same file as the barrel.
  foul: { file: 'bat-hit-ping', offset: 0.35, duration: 0.3, gain: 1.9, vary: 0.07 },
  // Every taken pitch thumps into the catcher's glove.
  mitt: { file: 'catch-basketball', offset: 19.62, duration: 0.28, gain: 0.75, vary: 0.06 },
  catchMade: { file: 'catch-leather-thud', offset: 13.06, duration: 0.3, gain: 0.9, vary: 0.05 },
  catchMissed: { file: 'catch-palming-football', offset: 0.35, duration: 0.35, gain: 2.4 },
  // Starts *after* the crack at ~1.0s, so this is pure crowd eruption. The bat
  // already made its noise back at contact; replaying it here would double up.
  homeRun: { file: 'homerun', offset: 1.8, duration: 5.5, gain: 0.75 },
  rally: { file: 'sting-charge-short', offset: 0.13, duration: 2.6, gain: 0.9 },
  fanfare: { file: 'sting-charge-long', offset: 0.1, duration: 3.8, gain: 0.8 },
  // The cheer recordings all open with a slow two-second swell. A crowd that
  // takes two seconds to react reads as broken, so these start near the peak.
  cheerBig: { file: 'cheer-strong', offset: 6.0, duration: 5.0, gain: 0.6 },
  cheerShort: { file: 'cheer-strong-short', offset: 5.0, duration: 4.5, gain: 0.6 },
  cheerSoft: { file: 'cheer-soft', offset: 8.0, duration: 4.0, gain: 0.65 },
  clap: { file: 'clap-rhythmic', offset: 0.04, duration: 3.6, gain: 1.3 },
  organ: { file: 'organ', offset: 0.04, duration: 12.2, gain: 1.1 },
};

/** Warmed in this order after the first tap: gameplay first, flourishes last. */
const WARM_ORDER: SoundName[] = [
  'whiff',
  'mitt',
  'contactBarrel',
  'contactSolid',
  'contactWeak',
  'foul',
  'catchMade',
  'catchMissed',
  'cheerShort',
  'homeRun',
  'cheerBig',
  'cheerSoft',
  'rally',
  'fanfare',
  'clap',
  'organ',
];

const AMBIENCE_FILE = 'crowd-ambience-long';

const STORAGE_KEY = 'baseball-star:audio:v1';
const MASTER_GAIN = 0.9;
const AMBIENCE_VOLUME = 0.32;
const AMBIENCE_FADE_MS = 900;

/**
 * Resolved against the document rather than hardcoded to `/audio/...`. The
 * Vite build uses a relative base, and Capacitor serves the bundle from its
 * own origin — an absolute path breaks under at least one of those.
 */
const audioUrl = (name: string): string => new URL(`audio/${name}.mp3`, document.baseURI).href;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let muted = loadMuted();

const buffers = new Map<string, AudioBuffer>();
const loading = new Set<string>();

let ambience: HTMLAudioElement | null = null;
let ambienceWanted = false;
let ambienceFade = 0;

function loadMuted(): boolean {
  return readKey(STORAGE_KEY) === 'muted';
}

function saveMuted(value: boolean): void {
  writeKey(STORAGE_KEY, value ? 'muted' : 'on');
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  saveMuted(value);
  if (muted) {
    fadeAmbienceOut();
  } else if (ambienceWanted) {
    startAmbience();
  }
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

/**
 * Browsers refuse to start audio until the user has interacted with the page,
 * so the context can only be built from inside a real gesture. Safe to call on
 * every tap — everything after the first is a cheap no-op.
 */
export function unlockAudio(): void {
  if (unlocked) {
    // A backgrounded tab can suspend the context out from under us.
    if (ctx?.state === 'suspended') void ctx.resume();
    return;
  }

  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;

  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
    unlocked = true;
    void ctx.resume();
    void warm();
  } catch {
    ctx = null;
    master = null;
  }
}

/** Decode everything in the background so the first of each sound isn't silent. */
async function warm(): Promise<void> {
  for (const name of WARM_ORDER) {
    const clip = CLIPS[name];
    const files = typeof clip.file === 'string' ? [clip.file] : clip.file;
    for (const file of files) await load(file);
  }
}

async function load(file: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(file);
  if (cached) return cached;
  if (!ctx || loading.has(file)) return null;

  loading.add(file);
  try {
    const res = await fetch(audioUrl(file));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    buffers.set(file, buffer);
    return buffer;
  } catch {
    // A missing or corrupt file shouldn't take the game down. It just stays
    // silent, and the next call will try again.
    return null;
  } finally {
    loading.delete(file);
  }
}

export function playSound(name: SoundName): void {
  if (muted || !ctx || !master) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const clip = CLIPS[name];
  const file =
    typeof clip.file === 'string'
      ? clip.file
      : clip.file[Math.floor(Math.random() * clip.file.length)];

  const buffer = buffers.get(file);
  if (!buffer) {
    // Not decoded yet. Start it for next time, but don't play late — a whiff
    // that arrives 300ms after the swing is worse than no whiff at all.
    void load(file);
    return;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  if (clip.vary) source.playbackRate.value = 1 + (Math.random() * 2 - 1) * clip.vary;

  const gain = ctx.createGain();
  gain.gain.value = clip.gain;

  // A short tail on anything long enough to be cut off mid-sound, so trimmed
  // windows don't end on a click.
  const playFor = Math.min(clip.duration, buffer.duration - clip.offset);
  if (playFor > 0.6) {
    const end = ctx.currentTime + playFor / source.playbackRate.value;
    gain.gain.setValueAtTime(clip.gain, end - 0.35);
    gain.gain.linearRampToValueAtTime(0.0001, end);
  }

  source.connect(gain);
  gain.connect(master);
  source.start(0, clip.offset, playFor);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
}

/* -------------------------------------------------------------- ambience */

export function startAmbience(): void {
  ambienceWanted = true;
  if (muted) return;

  if (!ambience) {
    ambience = new Audio(audioUrl(AMBIENCE_FILE));
    ambience.loop = true;
    ambience.preload = 'auto';
    ambience.volume = 0;
  }

  // Autoplay can still be refused if this lands before any gesture; the next
  // call (there's one per game) will get it.
  void ambience.play().catch(() => {});
  fadeAmbience(AMBIENCE_VOLUME);
}

export function stopAmbience(): void {
  ambienceWanted = false;
  fadeAmbienceOut();
}

/**
 * Backgrounding the app. Cuts the sound immediately — a fade can't run once
 * the process is frozen — but deliberately keeps `ambienceWanted`, so coming
 * back to a game in progress brings the crowd back with it.
 */
export function suspendAmbience(): void {
  window.clearInterval(ambienceFade);
  if (!ambience) return;
  ambience.pause();
  ambience.volume = 0;
}

export function resumeAmbience(): void {
  if (ambienceWanted) startAmbience();
}

function fadeAmbienceOut(): void {
  if (!ambience) return;
  const el = ambience;
  fadeAmbience(0, () => el.pause());
}

/** `<audio>` has no gain ramp, so step the volume by hand. */
function fadeAmbience(target: number, done?: () => void): void {
  const el = ambience;
  if (!el) return;

  window.clearInterval(ambienceFade);
  const from = el.volume;
  const started = performance.now();

  ambienceFade = window.setInterval(() => {
    const t = Math.min((performance.now() - started) / AMBIENCE_FADE_MS, 1);
    el.volume = Math.max(0, Math.min(1, from + (target - from) * t));
    if (t >= 1) {
      window.clearInterval(ambienceFade);
      done?.();
    }
  }, 40);
}
