import { Rng } from './core/rng';
import type { SaveData } from './core/save';
import { clearSave, loadSave, writeSave } from './core/save';
import type { BattingStats } from './core/types';
import type { Earnings } from './core/gear';
import type { GameScore } from './core/gameSim';
import type { PlayoffGameOutcome } from './core/playoffs';

export type Route =
  | 'title'
  | 'create'
  | 'hub'
  | 'training'
  | 'game'
  | 'postgame'
  | 'seasonEnd'
  | 'standings'
  | 'store'
  | 'achievements'
  | 'howto'
  | 'tutorial'
  | 'dev';

export interface PostGameSummary {
  win: boolean;
  tie: boolean;
  score: GameScore;
  opponent: string;
  home: boolean;
  stats: BattingStats;
  putouts: number;
  errors: number;
  xp: number;
  /** What the game paid, split into guaranteed money and performance bonus. */
  earnings: Earnings;
  /** Gear that fell apart after this game, by name. */
  wornOut: string[];
  levelsGained: number;
  pointsGained: number;
  /** Career achievements this game pushed over the line, by name. */
  newAchievements: string[];
  /** Where the series stands after this game, when it was a playoff game. */
  playoff?: PlayoffGameOutcome;
  seasonComplete: boolean;
}

export type ScreenRenderer = (app: App, mount: HTMLElement) => (() => void) | void;

export class App {
  readonly root: HTMLElement;
  save: SaveData | null = null;
  /** Which of the three career slots `save` and `persist()` point at. */
  slot = 0;
  rng = new Rng();
  lastGame: PostGameSummary | null = null;

  private screens = new Map<Route, ScreenRenderer>();
  private cleanup: (() => void) | null = null;
  private current: Route = 'title';

  constructor(root: HTMLElement) {
    this.root = root;
  }

  register(route: Route, renderer: ScreenRenderer): void {
    this.screens.set(route, renderer);
  }

  start(): void {
    // Always the title screen: it's the character select, and which of the
    // three careers to pick up is the player's call, not a guess.
    this.go('title');
  }

  /** Point the app at one of the three career slots. */
  selectSlot(slot: number): void {
    this.slot = slot;
    this.save = loadSave(slot);
    this.lastGame = null;
  }

  go(route: Route): void {
    const renderer = this.screens.get(route);
    if (!renderer) throw new Error(`No screen registered for "${route}"`);

    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }

    this.current = route;
    this.root.innerHTML = '';
    const mount = document.createElement('div');
    mount.className = 'screen';
    this.root.appendChild(mount);

    this.cleanup = renderer(this, mount) ?? null;
  }

  get route(): Route {
    return this.current;
  }

  /**
   * Where Android's hardware back button goes from the current screen.
   *
   * Returns 'exit' only from the title screen, the one place where leaving is
   * what the player meant; the clubhouse backs out to character select. A game
   * in progress swallows it outright: there's no way to resume a half-finished
   * game, so letting a stray back press throw one away would be a worse bug
   * than the button appearing to do nothing.
   */
  back(): 'exit' | 'handled' {
    switch (this.current) {
      case 'title':
        return 'exit';
      case 'hub':
        this.go('title');
        return 'handled';
      case 'game':
        return 'handled';
      default:
        this.go(this.save ? 'hub' : 'title');
        return 'handled';
    }
  }

  /** Non-null save, for screens that can only run mid-career. */
  requireSave(): SaveData {
    if (!this.save) throw new Error('No active career');
    return this.save;
  }

  persist(): void {
    if (this.save) writeSave(this.slot, this.save);
  }

  resetCareer(): void {
    clearSave(this.slot);
    this.save = null;
    this.lastGame = null;
    this.go('title');
  }
}
