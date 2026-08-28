/**
 * The thirty-two countries that contest the Baseball World Trophy.
 *
 * A nation is only three numbers deep, because that's all the tournament ever
 * asks of it: how good the side is, how hard it is to get into, and what to
 * call it. `strength` feeds the same simulation the club league uses, so a
 * national side and a Double-A club are compared on one scale and nothing
 * downstream needs to know the difference.
 *
 * `depth` is the interesting one. It is what a player has to out-rate to be
 * picked, and it is deliberately *not* the same number as `strength`: a deep
 * baseball country is both a better team to play for and a harder squad to
 * crack, which is the whole trade the player makes when they choose a flag at
 * eighteen. See `squadBar` in `core/worldCup.ts`.
 */

export interface Nation {
  /** Stable id, also the save key. Never renamed — a career remembers it. */
  id: string;
  name: string;
  /** Two or three letters, for scoreboards and group tables. */
  code: string;
  /** Flag, for everywhere a name is too long. */
  flag: string;
  /** 20-95, same scale as `Team.strength`. Drives simulated results. */
  strength: number;
}

/**
 * Listed strongest first, which is also the order the create screen shows
 * them in: the choice reads as a ladder from "you will never be picked" down
 * to "you are the star of this team the day you turn pro".
 */
export const NATIONS: Nation[] = [
  { id: 'jpn', name: 'Japan', code: 'JPN', flag: '🇯🇵', strength: 95 },
  { id: 'usa', name: 'United States', code: 'USA', flag: '🇺🇸', strength: 92 },
  { id: 'dom', name: 'Dominican Republic', code: 'DOM', flag: '🇩🇴', strength: 90 },
  { id: 'ven', name: 'Venezuela', code: 'VEN', flag: '🇻🇪', strength: 86 },
  { id: 'kor', name: 'South Korea', code: 'KOR', flag: '🇰🇷', strength: 84 },
  { id: 'pur', name: 'Puerto Rico', code: 'PUR', flag: '🇵🇷', strength: 82 },
  { id: 'cub', name: 'Cuba', code: 'CUB', flag: '🇨🇺', strength: 81 },
  { id: 'mex', name: 'Mexico', code: 'MEX', flag: '🇲🇽', strength: 80 },
  { id: 'tpe', name: 'Chinese Taipei', code: 'TPE', flag: '🇹🇼', strength: 74 },
  { id: 'ned', name: 'Netherlands', code: 'NED', flag: '🇳🇱', strength: 72 },
  { id: 'can', name: 'Canada', code: 'CAN', flag: '🇨🇦', strength: 70 },
  { id: 'col', name: 'Colombia', code: 'COL', flag: '🇨🇴', strength: 66 },
  { id: 'pan', name: 'Panama', code: 'PAN', flag: '🇵🇦', strength: 65 },
  { id: 'aus', name: 'Australia', code: 'AUS', flag: '🇦🇺', strength: 63 },
  { id: 'ita', name: 'Italy', code: 'ITA', flag: '🇮🇹', strength: 62 },
  { id: 'isr', name: 'Israel', code: 'ISR', flag: '🇮🇱', strength: 60 },
  { id: 'nca', name: 'Nicaragua', code: 'NCA', flag: '🇳🇮', strength: 58 },
  { id: 'cur', name: 'Curaçao', code: 'CUR', flag: '🇨🇼', strength: 57 },
  { id: 'bra', name: 'Brazil', code: 'BRA', flag: '🇧🇷', strength: 55 },
  { id: 'esp', name: 'Spain', code: 'ESP', flag: '🇪🇸', strength: 53 },
  { id: 'cze', name: 'Czechia', code: 'CZE', flag: '🇨🇿', strength: 51 },
  { id: 'gbr', name: 'Great Britain', code: 'GBR', flag: '🇬🇧', strength: 50 },
  { id: 'chn', name: 'China', code: 'CHN', flag: '🇨🇳', strength: 48 },
  { id: 'ger', name: 'Germany', code: 'GER', flag: '🇩🇪', strength: 46 },
  { id: 'arg', name: 'Argentina', code: 'ARG', flag: '🇦🇷', strength: 44 },
  { id: 'fra', name: 'France', code: 'FRA', flag: '🇫🇷', strength: 43 },
  { id: 'rsa', name: 'South Africa', code: 'RSA', flag: '🇿🇦', strength: 41 },
  { id: 'nzl', name: 'New Zealand', code: 'NZL', flag: '🇳🇿', strength: 39 },
  { id: 'phi', name: 'Philippines', code: 'PHI', flag: '🇵🇭', strength: 38 },
  { id: 'swe', name: 'Sweden', code: 'SWE', flag: '🇸🇪', strength: 36 },
  { id: 'irl', name: 'Ireland', code: 'IRL', flag: '🇮🇪', strength: 34 },
  { id: 'ind', name: 'India', code: 'IND', flag: '🇮🇳', strength: 32 },
];

/** The flag every career defaults to, for saves made before countries existed. */
export const DEFAULT_NATION_ID = 'usa';

const BY_ID = new Map(NATIONS.map((n) => [n.id, n]));

export function nationById(id: string | undefined): Nation {
  return (id ? BY_ID.get(id) : undefined) ?? BY_ID.get(DEFAULT_NATION_ID)!;
}

/** Name with its flag in front, which is how the tournament screens read. */
export const nationLabel = (n: Nation): string => `${n.flag} ${n.name}`;
