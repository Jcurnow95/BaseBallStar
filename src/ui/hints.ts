/**
 * What each meter does for the player, in the words the "?" beside it shows.
 * Kept in one place so the clubhouse, the training room and the Life screen
 * all tell the same story about the same number.
 */
export const HINTS = {
  stamina:
    'Your body over the season.\n\n' +
    'Every game takes 6–10 off it and a night’s sleep gives back 9, so a run of games with no ' +
    'off day wears you down. Low stamina shrinks the sweet spot on the ball, softens contact ' +
    'and makes a steal less likely to work.\n\n' +
    'Rebuild it on off days with Conditioning or a Rest Day. A good home and the jet protect a ' +
    'point or two a game.',
  energy:
    'Your budget for one day.\n\n' +
    'Training and off-field activities each spend some, and when it runs out the day is over. ' +
    'It refills overnight — more with a better home, a fast car and good morale.\n\n' +
    'It barely touches the game itself: only when it is very low does a steal jump lose its snap.',
  xp: 'Experience toward the next level. Every level pays attribute points to spend, with a bonus every fifth.',
  fame:
    'How many people know the name.\n\n' +
    'Fills the stands, lifts your performance bonus, and decides which sponsors call. Earned ' +
    'with home runs, walk-offs, October and the world stage, and the honours at the end of a ' +
    'year. A winter takes a tenth of it back.',
  morale:
    'How you feel about life.\n\n' +
    'Moves the overnight energy roll by up to 10 either way, and how much a game teaches, from ' +
    '90% to 110% of the XP. Drifts back toward the middle on its own; family time, a night out ' +
    'and a day on the water lift it.',
  clubhouse:
    'How the teammates feel about you.\n\n' +
    'Adds or takes up to 4 rating points on every teammate behind you in a game. Wins, ' +
    'training and a team dinner lift it; losses and a big mouth in the tunnel cost it.',
  bond:
    'How close you are.\n\n' +
    'Fades a little every game on the road; time together on an off day puts it back. A ' +
    'partner kept close through a winter might make it a family; one left at zero moves out.',
};
