/**
 * Team uniforms. Each club owns a colour identity and wears two versions of
 * it: a bold home kit and a darker, more muted road kit. Two teams on the same
 * field always read as two teams.
 */

export interface Uniform {
  shirt: string;
  pants: string;
  cap: string;
}

export interface TeamKit {
  id: string;
  /** Colour name, shown in the standings chip tooltip. */
  name: string;
  /** The club colour, used for chips and accents in the UI. */
  accent: string;
  home: Uniform;
  away: Uniform;
}

export const TEAM_KITS: TeamKit[] = [
  {
    id: 'crimson',
    name: 'Crimson',
    accent: '#d6473b',
    home: { shirt: '#e8564a', pants: '#f0f2f6', cap: '#5e1512' },
    away: { shirt: '#8c231c', pants: '#3a3f47', cap: '#4a100d' },
  },
  {
    id: 'navy',
    name: 'Navy',
    accent: '#3c63b5',
    home: { shirt: '#4270c9', pants: '#eef1f6', cap: '#16233f' },
    away: { shirt: '#25396b', pants: '#363b44', cap: '#111a2e' },
  },
  {
    id: 'forest',
    name: 'Forest',
    accent: '#2f8a55',
    home: { shirt: '#37a163', pants: '#eef4ee', cap: '#14371f' },
    away: { shirt: '#1e5636', pants: '#343a38', cap: '#0f2b1a' },
  },
  {
    id: 'gold',
    name: 'Gold',
    accent: '#d8a326',
    home: { shirt: '#e8b53a', pants: '#f4f2ea', cap: '#5c4008' },
    away: { shirt: '#9c7413', pants: '#3d3a33', cap: '#4a330a' },
  },
  {
    id: 'violet',
    name: 'Violet',
    accent: '#7b4bb5',
    home: { shirt: '#8a58c9', pants: '#f1eef7', cap: '#3a1f5e' },
    away: { shirt: '#4e2d78', pants: '#3a3540', cap: '#2a1545' },
  },
  {
    id: 'teal',
    name: 'Teal',
    accent: '#1d9191',
    home: { shirt: '#24a8a5', pants: '#ecf4f4', cap: '#0d3f3e' },
    away: { shirt: '#155e5d', pants: '#333b3b', cap: '#0a3130' },
  },
  {
    id: 'orange',
    name: 'Orange',
    accent: '#e07423',
    home: { shirt: '#f0842d', pants: '#f6f1ea', cap: '#6e330a' },
    away: { shirt: '#a05316', pants: '#3d3831', cap: '#59290a' },
  },
  {
    id: 'slate',
    name: 'Slate',
    accent: '#61748c',
    home: { shirt: '#7286a0', pants: '#eef1f5', cap: '#262e39' },
    away: { shirt: '#3f4b5c', pants: '#33383f', cap: '#1b212a' },
  },
  {
    id: 'maroon',
    name: 'Maroon',
    accent: '#8c2b40',
    home: { shirt: '#a33450', pants: '#f4eef0', cap: '#350e16' },
    away: { shirt: '#5e1c2c', pants: '#3a3438', cap: '#2b0b13' },
  },
  {
    id: 'sky',
    name: 'Sky',
    accent: '#3f9ad9',
    home: { shirt: '#4fb0ec', pants: '#eef4fa', cap: '#1a4666' },
    away: { shirt: '#2a6d9c', pants: '#343a41', cap: '#123449' },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    accent: '#4a505c',
    home: { shirt: '#5b6472', pants: '#f0f1f4', cap: '#0f1114' },
    away: { shirt: '#2f343d', pants: '#31343a', cap: '#0b0d10' },
  },
  {
    id: 'rose',
    name: 'Rose',
    accent: '#cf5a7a',
    home: { shirt: '#e06b8a', pants: '#f7eef1', cap: '#6b2739' },
    away: { shirt: '#8f3c53', pants: '#3b3438', cap: '#511d2b' },
  },
];

export const DEFAULT_KIT = TEAM_KITS[0];

/**
 * Resolve a team's kit. Falls back to a stable choice by index so saves made
 * before uniforms existed still show distinct teams rather than crashing.
 */
export function kitFor(kitId: string | undefined, index: number): TeamKit {
  if (kitId) {
    const found = TEAM_KITS.find((k) => k.id === kitId);
    if (found) return found;
  }
  return TEAM_KITS[index % TEAM_KITS.length];
}

export const uniformFor = (kit: TeamKit, isHome: boolean): Uniform =>
  isHome ? kit.home : kit.away;
