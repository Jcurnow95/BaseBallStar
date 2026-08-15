import type { Attributes, BattedBall, ContactQuality, SwingInput } from './types';
import { Rng, clamp } from './rng';

/**
 * The core mechanic.
 *
 * The player taps the ball as it crosses the plate. Two things about *where*
 * inside the ball they tapped decide everything:
 *
 *   - Vertically, the ideal contact point is slightly BELOW center. Catching
 *     the ball a bit under puts backspin and launch angle on it (a barrel).
 *     Tapping above center tops it into the ground; way under pops it up.
 *   - Horizontally, tapping to one side sprays the ball to that field.
 *
 * `Contact` widens the forgiveness radius around the ideal point; `Power`
 * turns good contact into exit velocity. Fatigue shrinks the window, which is
 * what makes stamina something you have to maintain rather than dump.
 */

/** Tap further than this from ball center and the bat missed entirely. */
const WHIFF_RADIUS = 1.12;

/** Ideal contact is this far under dead center, in ball radii. */
export const IDEAL_UNDER = 0.32;

export interface SwingContext {
  attributes: Attributes;
  /** 0-100. Below ~50 the sweet spot starts visibly shrinking. */
  stamina: number;
}

export interface SwingResult {
  battedBall: BattedBall | null;
  /** True when the bat never touched it. */
  whiff: boolean;
}

/** Radius of the forgiveness zone around the ideal contact point. */
export function sweetSpotRadius(contact: number, stamina: number): number {
  const fatigue = clamp(0.72 + (stamina / 100) * 0.28, 0.6, 1);
  return (0.2 + (clamp(contact, 1, 99) / 100) * 0.3) * fatigue;
}

export function resolveSwing(
  swing: SwingInput,
  ctx: SwingContext,
  rng: Rng,
): SwingResult {
  const { offsetX, offsetY, timing } = swing;
  const { attributes, stamina } = ctx;

  const rawDistance = Math.hypot(offsetX, offsetY);
  if (rawDistance > WHIFF_RADIUS) {
    return { battedBall: null, whiff: true };
  }

  const sweet = sweetSpotRadius(attributes.contact, stamina);
  const error = Math.hypot(offsetX, offsetY - IDEAL_UNDER);
  const ratio = error / sweet;

  // Miss the plane of the ball badly enough and the bat goes through empty air.
  if (ratio > 3.0) {
    return { battedBall: null, whiff: true };
  }

  let quality: ContactQuality;
  if (ratio <= 0.55) quality = 'barrel';
  else if (ratio <= 1.1) quality = 'solid';
  else if (ratio <= 1.8) quality = 'flare';
  else if (ratio <= 2.6) quality = 'weak';
  else quality = 'mishit';

  // Exit velocity: power sets the ceiling, contact quality scales it down.
  // Scaling on `ratio` rather than raw error means a high-Contact hitter keeps
  // his exit velo over a wider miss, which is the point of the attribute.
  const ceiling = 88 + clamp(attributes.power, 1, 99) * 0.28;
  const staminaScale = clamp(0.9 + (stamina / 100) * 0.1, 0.88, 1);
  const efficiency = clamp(1 - ratio * 0.11, 0.52, 1);
  const exitVelocity = clamp(
    ceiling * efficiency * staminaScale + rng.range(-3.5, 3.5),
    38,
    122,
  );

  // Launch angle comes almost entirely from how far under the ball you tapped.
  const launchAngle = clamp(offsetY * 85 - 5 + rng.range(-3, 3), -28, 78);

  // Spray: side of the ball you caught, plus timing. Early = pulled.
  // The horizontal term carries most of it — at a lower weight a squared-up
  // tap put almost everything into centre field, which made every hit look the
  // same. Catching the ball off-centre should visibly pull or push it.
  // 1.05 is where the spread stops improving: past it the extra pull only
  // slices balls into foul ground rather than sending them to the corners.
  const spray = clamp(-offsetX * 1.05 + (0.98 - timing) * 1.8 + rng.range(-0.08, 0.08), -1, 1);

  return {
    battedBall: { quality, exitVelocity, launchAngle, spray },
    whiff: false,
  };
}
