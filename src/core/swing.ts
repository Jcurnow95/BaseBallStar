import type { Attributes, BattedBall, ContactQuality, SwingInput } from './types';
import { Rng, clamp } from './rng';

/**
 * The core mechanic.
 *
 * The player taps the ball as it crosses the plate. The WHOLE ball is a
 * target: land the tap anywhere on it and the bat finds the ball. Where on the
 * ball you land decides what kind of contact it is:
 *
 *   - Vertically, the ideal contact point is slightly BELOW center. Catching
 *     the ball a bit under puts backspin and launch angle on it (a barrel).
 *     Tapping above center tops it into the ground; way under pops it up.
 *   - Horizontally, tapping to one side sprays the ball to that field.
 *   - The closer to the RIM you catch it, the more the ball curves. Off-centre
 *     contact puts sidespin on it, so a ball caught on the edge hooks or slices
 *     toward the line — and sometimes past it. The rim is playable, but it
 *     bends.
 *
 * The sweet spot is still there: a small zone around the ideal point that
 * turns a tap into a barrel and gives you the home-run chance. Everything else
 * on the ball is still a ball in play, just a less dangerous one.
 *
 * `Contact` widens the forgiveness radius around the ideal point; `Power`
 * turns good contact into exit velocity. Fatigue shrinks the window, which is
 * what makes stamina something you have to maintain rather than dump.
 */

/**
 * Tap further than this from ball center and the bat missed entirely. Past 1
 * (the drawn edge of the ball) so a fingertip that just clips the rim still
 * counts — on a phone the visible ball is the target, not the maths. This is
 * the ONLY way to whiff; anything on the ball is contact of some kind.
 */
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

/**
 * How close to the rim of the ball a tap landed: 0 at dead center, 1 on the
 * edge. This is what drives curve, and it's radial on purpose — a tap high on
 * the ball and one wide on the ball are both "edge" contact.
 */
export function edgeFactor(offsetX: number, offsetY: number): number {
  return clamp(Math.hypot(offsetX, offsetY), 0, 1);
}

/**
 * Sidespin from where on the ball the tap landed. Signed like `spray`: negative
 * bends the ball toward left field, positive toward right.
 *
 * The horizontal offset sets the direction (catch the left side of the ball
 * and it runs left), and the radial edge factor amplifies it, so a tap that's
 * half a radius wide bends gently near the middle of the ball and hard when it
 * is also up on the rim. Squared so the middle of the ball stays honest and the
 * curve only really shows up in the outer third.
 */
export function sideSpinFor(offsetX: number, offsetY: number): number {
  const edge = edgeFactor(offsetX, offsetY);
  return clamp(-offsetX * (0.3 + 0.7 * edge * edge), -1, 1);
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
  const edge = edgeFactor(offsetX, offsetY);

  // The barrel and solid tiers are the sweet spot proper — that's where the
  // home-run chance lives. The outer tiers are stretched to cover the rest of
  // the ball, so a tap on the rim is a real ball in play (weak, curving), and
  // only the far corners of the ball — topped into the dirt or skied off the
  // very bottom — count as a mishit.
  let quality: ContactQuality;
  if (ratio <= 0.55) quality = 'barrel';
  else if (ratio <= 1.1) quality = 'solid';
  else if (ratio <= 2.2) quality = 'flare';
  else if (ratio <= 3.4) quality = 'weak';
  else quality = 'mishit';

  // Exit velocity: power sets the ceiling, contact quality scales it down.
  // Scaling on `ratio` rather than raw error means a high-Contact hitter keeps
  // his exit velo over a wider miss, which is the point of the attribute.
  // Rim contact is glancing contact, so the outer edge gives a little more
  // back — cubed so the middle two-thirds of the ball pays almost nothing.
  const ceiling = 88 + clamp(attributes.power, 1, 99) * 0.28;
  const staminaScale = clamp(0.9 + (stamina / 100) * 0.1, 0.88, 1);
  const glancing = 1 - edge * edge * edge * 0.18;
  const efficiency = clamp((1 - ratio * 0.085) * glancing, 0.52, 1);
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

  // Curve: rim contact bends the ball the way it's already heading, so a ball
  // sprayed toward the line by an edge tap keeps running toward — and past —
  // it. Timing adds a touch, the way an early swing hooks a pulled ball.
  const sideSpin = clamp(
    sideSpinFor(offsetX, offsetY) + (0.98 - timing) * 0.5 + rng.range(-0.04, 0.04),
    -1,
    1,
  );

  return {
    battedBall: { quality, exitVelocity, launchAngle, spray, sideSpin },
    whiff: false,
  };
}
