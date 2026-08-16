/**
 * Little pictures for the play-by-play feed. Each line of the log gets a
 * glyph that says at a glance what happened — a ball leaving the yard, a
 * glove for a catch, a K for a strikeout — so the feed reads without reading.
 *
 * Icons are inline SVG drawn in currentColor, so they pick up the line's tone
 * (green for good, red for bad, gold for a homer) for free.
 */

export type FeedIcon =
  | 'homer'
  | 'hit'
  | 'extraBase'
  | 'strikeout'
  | 'walk'
  | 'catch'
  | 'groundout'
  | 'error'
  | 'foul'
  | 'run'
  | 'batter'
  | 'alert'
  | 'inning'
  | 'ball';

const S = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** A baseball: circle with the two curved seams. */
const BALL =
  '<circle cx="12" cy="12" r="8.5"/>' +
  '<path d="M6.5 6.5c2.5 2 2.5 9 0 11"/><path d="M17.5 6.5c-2.5 2-2.5 9 0 11"/>' +
  '<path d="M7.6 8.6l1.4.5M7.9 10.9l1.5.2M7.9 13.1l1.5-.2M7.6 15.4l1.4-.5"/>' +
  '<path d="M16.4 8.6l-1.4.5M16.1 10.9l-1.5.2M16.1 13.1l-1.5-.2M16.4 15.4l-1.4-.5"/>';

const ICONS: Record<FeedIcon, string> = {
  // Ball rocketing up and out with motion lines behind it.
  homer: S(
    '<circle cx="15.5" cy="8.5" r="4.5"/>' +
      '<path d="M12.3 5.3c1.5 1.2 1.5 5.2 0 6.4"/><path d="M18.7 5.3c-1.5 1.2-1.5 5.2 0 6.4"/>' +
      '<path d="M3 21l7-7"/><path d="M3 15l4-4"/><path d="M9 21l4-4"/>',
  ),
  // Bat meeting ball.
  hit: S(
    '<path d="M4 20l11.5-11.5"/><path d="M15.5 8.5l3-3a1.4 1.4 0 0 1 2 2l-3 3"/>' +
      '<circle cx="7.5" cy="6.5" r="2.6"/><path d="M6 4.6c.9.7.9 3.1 0 3.8"/>',
  ),
  // Ball splitting the gap: two chevrons racing right.
  extraBase: S(
    '<circle cx="7" cy="12" r="3.5"/><path d="M5.7 9.4c1 .8 1 4.4 0 5.2"/>' +
      '<path d="M13 8l4 4-4 4"/><path d="M17.5 8l4 4-4 4"/>',
  ),
  // The scorer's K.
  strikeout: S('<path d="M7 4v16"/><path d="M17 4l-9 8 9 8"/>'),
  // Four balls, batter takes first.
  walk: S(
    '<circle cx="6" cy="6" r="2.2"/><circle cx="12" cy="6" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="6" cy="12" r="2.2"/>' +
      '<path d="M5 19h12"/><path d="M14 16l3 3-3 3"/>',
  ),
  // Ball settling into a glove.
  catch: S(
    '<path d="M6 21v-5.5c0-4 1.5-7 4-8.5l2-1c1.6-.8 3.5.2 3.5 2v2"/>' +
      '<path d="M9.5 8.5c-1-1.5-.5-3.5 1.2-4"/><path d="M13 7c0-2 1.2-3.5 2.8-3.2"/>' +
      '<path d="M15.5 10c1.5-.6 3 .2 3 2v3.5c0 3-2 5.5-5 5.5H6"/>' +
      '<circle cx="9" cy="14" r="2.2"/>',
  ),
  // Ball skipping across the dirt to a fielder.
  groundout: S(
    '<path d="M3 18h18"/><path d="M4 16c2-3 4-3 6 0s4 3 6 0"/>' +
      '<circle cx="18" cy="9" r="2.5"/><path d="M17 7.2c.7.5.7 3.1 0 3.6"/>',
  ),
  // The ball got away: bobble and an X.
  error: S(
    '<circle cx="9" cy="14" r="4"/><path d="M7.5 11c1.2.9 1.2 5.1 0 6"/>' +
      '<path d="M15 4l5 5"/><path d="M20 4l-5 5"/>',
  ),
  // Ball hooking outside the line.
  foul: S(
    '<path d="M3 21L14 10"/><circle cx="17" cy="7" r="2.8"/>' +
      '<path d="M15.9 5c.9.6.9 3.4 0 4"/><path d="M12 21l4-3 4 3"/>',
  ),
  // Runner crossing home plate.
  run: S(
    '<circle cx="14" cy="4.5" r="2"/>' +
      '<path d="M12 8l-3 4 3 2-1 6"/><path d="M12 8l3 1 3-2"/><path d="M12 14l3 3 2 3"/><path d="M9 12l-4 1"/>' +
      '<path d="M15 21h5l1-2h-7z" fill="currentColor"/>',
  ),
  // Batter stepping in.
  batter: S(
    '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7"/><path d="M12 14l-3 7"/><path d="M12 14l3 7"/>' +
      '<path d="M12 9l5-4"/><path d="M17 5l3-3"/>',
  ),
  // Heads up — ball coming your way.
  alert: S(
    '<circle cx="12" cy="12" r="4"/><path d="M10.5 9c1.2.9 1.2 5.1 0 6"/>' +
      '<path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/>',
  ),
  // The diamond, for a new half-inning.
  inning: S('<path d="M12 3l9 9-9 9-9-9z"/><path d="M12 12h.01"/>'),
  ball: S(BALL),
};

/**
 * Pick a picture from the words. Every line in the feed comes through here,
 * whether it came from the sim, the swing model or the top-down field, so the
 * matching is on the phrases those actually produce. Order matters: a line
 * like "Deep to left... that ball is GONE!" must land on the homer before the
 * generic hit check gets a look at it.
 */
export function feedIconFor(text: string): FeedIcon {
  const t = text.toLowerCase();

  if (/\bstrikes? out\b|strike three|struck out|caught looking/.test(t)) return 'strikeout';
  if (/\bwalks?\b|draws a walk|ball four|take your base/.test(t)) return 'walk';
  if (/home run|\bhomers?\b|it's gone|is gone|goes deep|leaves the yard/.test(t)) return 'homer';
  if (/\berror\b|misplay|bobble|kicks it/.test(t)) return 'error';
  if (/\bfoul/.test(t)) return 'foul';
  if (/\btriples?\b|\bdoubles?\b|the gap\b|corner\b/.test(t)) return 'extraBase';
  if (/\bsingles?\b|base hit|finds a hole|bloop|beats it out|infield hit/.test(t)) return 'hit';
  if (/\bruns? scores?\b|scores from|crosses the plate|comes home/.test(t)) return 'run';
  if (/grounds? out|dribbler|thrown out|beats the throw|force|double play|out at/.test(t)) return 'groundout';
  if (/flies out|pops? out|popped up|lines out|fly ball|caught|snags|hauls it in|easy out|makes the play/.test(t)) return 'catch';
  if (/your way|coming to you/.test(t)) return 'alert';
  if (/steps in|steps to the plate|leads off/.test(t)) return 'batter';
  if (/^(top|bottom|middle|end)\b|inning|stretch/.test(t)) return 'inning';
  return 'ball';
}

/** SVG markup for an icon. */
export function feedIconSvg(icon: FeedIcon): string {
  return ICONS[icon];
}
