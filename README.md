# Baseball Star

A mobile career-mode baseball game. Create a player, start in Single-A, and hit your way
to the Majors. You play only *your* moments — every plate appearance, every ball hit at
your position, and every trip around the bases — and the rest of the game simulates
around you.

Built as a TypeScript + canvas app wrapped by Capacitor, so one codebase ships to Android
and iOS.

## Running it

```bash
npm install
```

```bash
npm run dev
```

Open the URL it prints. It's designed portrait for a phone, but it scales properly
everywhere — see below.

## Playing it on a PC

```bash
npm run desktop
```

That builds the web bundle and opens the game in an Electron window — the quickest way
to play without packaging anything.

To produce the actual executables:

```bash
npm run dist:win
```

Two files land in `release/`, both about 100 MB:

- **`BaseballStar-<version>-portable.exe`** — double-click and play. Nothing is installed;
  copy it anywhere, including a USB stick.
- **`BaseballStar-<version>-setup.exe`** — a normal installer with a Start Menu and
  desktop shortcut, installed per-user so it needs no admin rights.

Careers save to `%APPDATA%\baseball-star\store.json`, not next to the exe — so the
portable build keeps your progress between runs, you can move or replace the exe freely,
and uninstalling doesn't wipe your career.

### Why it isn't loaded from `file://`

`electron/main.js` serves the game over a registered `app://` scheme rather than opening
`dist/index.html` off disk. Two things in this game break under `file://`:

- `ui/audio.ts` loads every clip with `fetch()` before decoding it, and Chromium blocks
  `fetch` on `file://` outright — the entire soundtrack would be silent.
- `core/save.ts` keeps careers in `localStorage`, which `file://` treats as an opaque
  origin, so saves wouldn't survive a restart.

The handler also implements **Range requests**. That isn't padding: without
`Content-Length` and range support, an `<audio>` element can't determine a track's
duration, which reports as `NaN` and stops `loop` working — the seven-minute crowd bed
would play once and fall silent.

### Why saves don't use localStorage on desktop

Serving from `app://` fixes `fetch`, but Chromium still won't reliably *persist*
localStorage for a custom origin — values are written to disk and read back empty on the
next launch, which would silently wipe a career every time the game was closed. So the
desktop shell exposes a small file-backed store through a sandboxed preload
(`electron/preload.cjs`), and `core/storage.ts` picks it when present and falls back to
localStorage everywhere else. `core/save.ts` and `ui/audio.ts` go through that shim, so
the browser and mobile builds are unchanged.

`npx electron electron/smoke.js` boots the real main process and checks the origin,
rendering, storage, audio decoding and ambience duration against the live window. It's
excluded from the packaged build.

## Putting it on a phone

The native projects are committed (`android/`, `ios/`). One command rebuilds the web
bundle and pushes it into both:

```bash
npm run sync
```

Then open the platform you want. Both scripts sync first, so this is the only command
you need after changing any game code:

```bash
npm run android
```

```bash
npm run ios
```

From there you press Run in Android Studio or Xcode. `npm run run:android` /
`npm run run:ios` skip the IDE and deploy straight to a connected device.

**What you need installed.** Neither toolchain ships with this repo:

| Target | Requires | Works on |
|---|---|---|
| Android | Android Studio + JDK 21 | Windows, macOS, Linux |
| iOS | Xcode + CocoaPods, and an Apple Developer account to run on a real device | **macOS only** |

There is no way around the iOS one — Apple does not ship a toolchain for Windows or
Linux. To build the iPhone app from a Windows machine you need either a Mac, a hosted Mac
CI runner, or a cloud build service. Everything in `ios/` is complete and correct; it just
needs a machine that can compile it.

**Installing on your own phone** (no App Store involved):

- **Android** — plug the phone in with USB debugging on and press Run; or
  `cd android && ./gradlew assembleDebug` and sideload
  `android/app/build/outputs/apk/debug/app-debug.apk`.
- **iPhone** — open `ios/App/App.xcworkspace`, set your Apple ID under Signing &
  Capabilities, and Run with the phone connected. A free account signs apps for seven
  days before they need reinstalling; a paid account lasts a year.

### What the native shell adds

Beyond wrapping the page, the app configures the things a browser gives you for free:

- **Portrait lock** on both platforms — the at-bat stage is a fixed 0.6-aspect portrait
  box, so landscape only letterboxes it.
- **iOS audio session** set to `.playback` in `AppDelegate.swift`. A WKWebView defaults to
  the ambient category, which means the ring/silent switch would mute the entire game.
  `.mixWithOthers` is on, so launching it doesn't stop the player's music.
- **Android back button** routed through `App.back()` in `app.ts`. It exits from the title
  and clubhouse, backs out to the clubhouse from any sub-screen, and is deliberately
  swallowed mid-game — there's no way to resume a half-played game, so a stray press
  shouldn't throw one away.
- **Crowd ambience suspends** when the app is backgrounded and resumes when it returns,
  rather than streaming over whatever the player switched to.
- **Game time stops with the frames.** The pitch and the stretch catch run off a clock that
  only advances while frames are being drawn (capped at 50 ms a frame), so minimising the
  app mid-pitch is a pause, not a called strike you never saw. Come back mid-flight and the
  pitch is delivered again. A tap during the windup is a no-op, not a swing.
- **Splash screen** hidden from JS on first paint rather than on a timer, so it never
  flashes away early or lingers over a game that's already up.

## Screen sizes

The game is portrait-first, and it holds its shape rather than stretching to fill:

- **Phones** get the full width, edge to edge.
- **Tablets and desktops** run the game in a centred column at its intended width, with a
  subtle border either side. Blowing a phone UI up to 1280px would just make everything
  enormous.
- **The at-bat screen** fits a fixed-aspect play area inside the canvas. Deriving
  horizontal features from canvas width and vertical ones from canvas height
  independently — which is what it used to do — stretches the field, the strike zone and
  the ball on any screen that isn't phone-shaped. The strike zone now keeps the same
  width-to-height ratio at every size, so a barrel is a barrel on any device.
- Rather than showing black letterbox bars, the sky and grass **bleed past the play area**
  to cover the whole canvas. A wider screen shows more ballpark, not more nothing.

## Learning it

The first **Play Ball** of a new install goes by way of a five-card **How to Play** —
hitting, running, fielding, the stretch catch, throwing — and it stays reachable from the
clubhouse and the title screen. On top of that the first at-bat, the first ball hit your
way and the first time you're on the bases each get a one-line coach tip over the play,
gone on the first touch. Both are remembered per install (`baseball-star:howto-seen`,
`baseball-star:tips-seen`), not per career.

The **FAST** toggle only speeds up the simulated stretches between your moments; it
disappears while you're actually batting or fielding so it can't read as the pitch being
sped up.

A **pause** button (top-left of the stage) freezes everything at once: the pitch or play
in progress, the wait before the next event, and the crowd. It's a true freeze — the
frame-driven at-bat/catch clocks stop advancing and the play-by-play timer keeps whatever
it had left, so **Resume** picks up exactly where you were rather than jumping. Sending the
app to the background pauses it for you.

## At the plate

The ball leaves the pitcher's hand small and far away, grows as it comes, and **breaks
late**. You tap it. Where inside the ball you land decides everything:

| Tap position | Result |
| --- | --- |
| Slightly **under** center (~⅓ of a ball radius) | Barrel — launch angle and backspin, your home-run swing |
| Dead center | Line drive |
| **Above** center | Topped into the ground |
| Far under | Lazy popup |
| Left / right of center | Sprays to that field |
| More than ~1 radius away | Swing and a miss |

Don't swing and the umpire calls it: pitches outside the zone are balls, so taking a good
at-bat and drawing a walk is a real option.

**The batting eye.** A timing ring closes on the ball through every pitch and locks onto
it as it reaches the plate — that's your tap moment. Once your Vision reaches **65** the
ring also tells you ball from strike: on a pitch over the plate it locks gold and the ball
glows gold; on one off the plate the gold never comes and the ring washes out — no gold, no
swing. Below 65 the ring locks white on every pitch, so the timing is there to learn but
whether it's a strike is your own read of the dashed zone. Progress is tracked in Player
&amp; Development.

After every swing the game freezes for a moment and draws your tap point (gold X) against
the ideal contact point (green circle). That circle *is* your Contact attribute — it grows
as you develop, and shrinks when you're worn down.

**The perfect hit zone.** Once your Contact and Vision total **120**, the ideal contact
point is marked on the ball *as it comes in* — a green ring and crosshair sitting just
under centre, fading in as the ball arrives. It needs both attributes because it
represents both halves of the skill: Vision is picking the ball up, Contact is the size of
the window you can cover. It's a visual aid only and changes nothing about how contact
resolves — where you actually tap still decides everything. Progress toward it is tracked
in Player &amp; Development.

## On the field

Hit a fair ball and the view cuts to a **top-down field** with a camera that follows the
play, zooming out when the ball and your player spread apart.

**Batting — run the bases.** Your runner takes off for first automatically, and reads the
ball like any runner would: an extra base that's clearly there gets taken (the banner says
**Waved on!**), a coin-flip doesn't — that one is yours to call. Three buttons, each
labelled with the base it actually commits you to: **GO FOR SECOND** to push on, **HOLD AT
SECOND** to pull up there, **BACK TO FIRST** to turn round and scramble for the bag you
left. They only appear when there's a real choice — no HOLD when you're already stopping
there anyway, no BACK when you're stood on a bag, and GO into a bag a team-mate is standing
on shoves him along ahead of you.

The feedback is on screen while you decide:

- A status line reads **RUNNING TO SECOND**, **HOLDING AT FIRST** or **BACK TO FIRST**, so
  what you're committed to is never ambiguous.
- A dashed line runs from you to the bag you're heading for, with a ring on it — behind
  you when you've turned round.
- If the ball is beating you there — a throw in the air, or a fielder already stood on the
  bag with it — the line and ring turn red and pulse, and the status line flashes **BALL TO
  SECOND — RUN OR GO BACK!**

Push it on a ball that gets through and you turn a single into a double; push it on a ball
the right fielder is already under and you get thrown out. Going back isn't a free undo:
the throw can beat you back to the bag as well, and a fielder waiting on it with the ball
tags you as you arrive.

Your team-mates run for themselves. Everyone on base breaks on contact and goes about
halfway, then reads the ball where it lands: forced runners take the base they owe, nobody
takes another one without beating the throw. On a catch they all scramble back.

**Fielding — get to the ball.** Drag anywhere on screen for a virtual joystick and run
your fielder down. On a fly ball a pulsing gold circle marks where it's coming down —
camp under it. Your **Fielding** attribute sets your glove radius, the same way Contact
sets your sweet spot at the plate.

**Get under it, or earn it.** Being *near* the ball isn't the same as being *under* it.
Inside the routine zone the catch is automatic. Reach it at full stretch and the play
freezes into a catch minigame: the ball comes rushing in and you have to tap it, with the
window set by your Fielding and the speed set by how far out of position you were. Miss,
and it's a hit — you had to dive for it, so it's not scored as an error. In testing this
fires on roughly one in six catch attempts, so it's a moment rather than a chore.

AI fielders muff one occasionally too, more often the further they have to reach. A drop
in the routine zone is charged as an error and every runner takes off; a ball that gets
past a fielder at full stretch is just a hit.

**Throwing.** Once you have the ball, buttons appear for **1ST / 2ND / 3RD / HOME**. Pick
the base and your **Arm** decides how fast the throw gets there. Any runner still short of
that bag is out — including at the plate, so a runner rounding third is playable.

The other eight know their jobs. They only throw to a bag somebody is actually covering,
and a fielder with no play doesn't stand there admiring it — he gets the ball back in to
the base ahead of the lead runner. You can still throw wherever you like; picking an
unmanned bag is how the ball ends up in the outfield with everyone taking another base.

**And they throw to you.** If the ball is hit elsewhere and your position covers the base,
the throw is coming to *you* — get to the bag before it arrives. If nobody is covering,
the throw sails through and every runner takes another base, charged to you as an error.

The important part: if the ball is yours and you don't go get it, no teammate bails you
out. The nearest fielder only backs up the play. In testing, a center fielder who chases
records outs on 74% of balls in play; one who stands still records 60%, and gives up four
times as many doubles.

## Ballparks

Six parks, and they play like genuinely different fields rather than the same arc
recoloured. Each team owns one as its home field, so the road trip changes what your
swing is worth.

| Park | Lines / gaps / centre | Character |
| --- | --- | --- |
| Riverside Commons | 330 / 382 / 400 | Honest and symmetrical |
| The Bandbox | 308 / 350 / 366 | Tiny, low walls, homers everywhere |
| Cavern Field | 352 / 408 / 428 | Enormous with 14-foot walls |
| The Notch | 340 / 406 / 404, **302 in right** | Short porch one way, canyon the other |
| Ironworks Park | 312 / 368 / 398, **36-foot wall in left** | Short but the wall eats home runs |
| Prairie Yard | 318 / 410 / 392 | Short lines, endless gaps |

Wall height matters as much as distance. A ball that clears the fence distance but not the
wall **caroms back into play** instead of leaving, which is what makes Ironworks' monster
turn home runs into loud doubles.

The wall is solid. Fielders — yours and theirs — pull up three feet short of it and cannot
run through it, so a ball hit out of the park is chased to the warning track and no
further. Behind the wall is the stand, and **how full it is depends on the level**: Single-A
plays in front of rows of empty plastic, the Majors in front of a packed bowl. It is
purely cosmetic, but it's the fastest read on how far you've come. Measured over 1500 balls in play each, home run rate
runs from **3.5% at Cavern Field to 14.4% at The Bandbox** — and Ironworks, despite being
one of the shortest parks, sits at 7.9% because of that wall.

## Weather

Every game on the schedule has a forecast, rolled with the season and shown in the
clubhouse and on the first-pitch card, so you can read it before you play. About 60% of
days are clear; the rest are overcast, rain, or the occasional storm. Wind blows in any
direction at 0–25 mph and holds steady all game — there's a flag in the corner of both
the at-bat and field views with an arrow the way it's going and the speed — and rain
streaks across the screen, heavier in a storm.

Both act on the batted ball, in `core/ballFlight.ts`:

- **Wind** enters the drag term as the air the ball is actually flying through, so with the
  wind at its back it holds speed and carries, and into it it gets shoved back. A crosswind
  bends fly balls sideways. Scaled to real batted-ball data — roughly 3 ft per mph — because
  the fitted drag is heavier than real air and unscaled wind moved balls twice as far as it
  should. A 100 mph, 28° ball goes 378 ft calm, **406 with 10 mph out, 351 with 10 in**, and
  a 15 mph crosswind drifts it about 23 ft. A 25 mph storm blowing in turns that home-run
  swing into a 282 ft fly out.
- **Rain** makes the air heavier and takes spin off the ball (about 20 ft of carry in a
  downpour), and soaks the turf: bounces die, rollers stop early (a hard grounder that runs
  to 137 ft dry pulls up at 115 ft wet), and gloves get slippery — a few more chances become
  stretch catches, and AI fielders muff about twice as often.

`npx tsx tools/weather.ts` prints the carry table across a range of days.

## Uniforms

Every club has its own colour identity and two kits: a bold home strip and a darker road
one. The home side always wears home, the visitor always wears away, so the two nines on
the field never read as the same team. Your opponent's pitcher wears their colours too,
and the standings carry a colour chip per club.

Twelve kits (crimson, navy, forest, gold, violet, teal, orange, slate, maroon, sky,
graphite, rose) are dealt out uniquely across the six teams in a league, alongside their
ballparks.

## Money and gear

You get paid per game, and you spend it on equipment that wears out.

**The contract you sign** is chosen when you create your player, and it decides the shape
of your income for the whole career — the salary scales with the level you're at, but the
trade never changes:

| Deal | Per game at Single-A | Bonuses |
| --- | --- | --- |
| Standard | $150 | ×1 |
| Guaranteed Money | $240 | ×0.45 |
| Incentive Laden | $60 | ×2.1 |

On top of the salary comes a **performance bonus** for what you actually did: singles,
doubles, triples and homers, walks, RBI, stolen bases, putouts in the field, and a win. An
incentive deal is a real bet on yourself — a hitless loss pays you the $60 and nothing
else, while two walks in that same loss is another $63.

**The gear store** is open from the clubhouse every day. Four slots — bat, batting gloves,
fielding glove, cleats — and three tiers in each. Better gear costs more, gives more, and
lasts longer:

| Tier | Price | Lasts | Example |
| --- | --- | --- | --- |
| Club issue | ~$300 | 6 games | Ash Club, +3 Power |
| Pro model | ~$1,000 | 12 games | Pro Web Mitt, +6 Fielding, +3 Arm |
| Signature | ~$2,700 | 20 games | Custom Stitch Grips, +9 Contact, +4 Vision |

Gear is deliberately temporary — a permanent stat buy would just be a slower version of the
attribute-point economy, and wear is what keeps the money loop running all season. Every
game takes one off everything equipped; when a piece hits zero it's gone, and the post-game
screen tells you so.

Equipment lifts your attributes **for gameplay only** — the sweet spot on the bat, the
glove window, how fast you cover ninety feet. It does **not** count toward the overall
rating the front office grades you on at the end of the year: they're rating the player,
not the bat. The clubhouse shows both, with the gear share in green.

## The season calendar

A season is a run of dated days, not just a list of games. You get short homestands and
road trips of two to four games, then an off day — occasionally two. A 24-game Single-A
season lays out over roughly 33 days.

**Game days** you play. **Off days** are when you train: spend Energy on as many
activities as it will cover, then End Day to roll over and get it back. The hub shows a
strip of the whole season with today marked, so you can see when the next off day lands
and plan whether to burn yourself down before it.

**Player & Development is open every day**, from the hub. Attribute points, your stats and
the attribute reference are always reachable — the calendar only gates the training drills
themselves, since those are what burn the day.

## Attributes

| Attribute | What it actually does |
| --- | --- |
| Power | Raises your exit-velocity ceiling. This is what unlocks home runs. |
| Contact | Widens the forgiveness circle around the ideal contact point. |
| Vision | Reads pitch type out of the hand; keeps the strike-zone guide visible. At 65, unlocks the batting eye (gold = strike). |
| Speed | How fast you cover 90 feet. Beats out grounders, takes the extra base. |
| Fielding | Widens your glove window on catch attempts. |
| Arm | Throw velocity. Decides whether you can beat a runner to the bag. |

**Stamina** is the one you have to *maintain*: it drains every game and directly shrinks
your sweet spot. In testing, a Double-A player hitting .244 at full stamina drops to .154
at 25% stamina. Train it or pay for it late in the season.

## Progression

Single-A → Double-A → Triple-A → The Majors. At the end of each season the front office
checks two things: your overall rating and your season grade (an OPS-driven 0–100 score).
Clear both and you get called up; miss and you repeat the level.

Games earn XP → levels → attribute points. Between games you spend Energy on training,
and each option trades Energy, Stamina and XP differently.

## Project layout

```
src/
  core/            Pure simulation. No DOM — portable to Rust/WASM later.
    swing.ts         Tap offset -> contact quality, exit velocity, launch angle
    ballFlight.ts    Batted-ball physics: drag, backspin lift, bounce and roll
    ballpark.ts      Park layouts: per-angle fence distances and wall heights
    weather.ts       Game-day wind and rain, and what they do to the air and the turf
    gear.ts          Equipment, wear, contracts and per-game earnings
    uniforms.ts      Team colour identities, home and away kits
    fieldGeometry.ts Diamond coordinates in feet, fair/foul, base coverage
    playSim.ts       A live play: fielder AI, catches, throws, runners, force outs
    outcome.ts       Abstract resolver, used for simulated (non-player) plate appearances
    pitching.ts      Pitch arsenal, late break, pitcher AI and command
    gameSim.ts       Nine-inning game loop; surfaces your moments as events
    league.ts        Levels, teams, home parks, schedule, calendar, standings
    progression.ts   XP, attribute points, training, promotion checks
  game/            Canvas views: atBatView (catcher POV), playView (top-down field),
                   catchOverlay (the stretch-catch minigame), coachTips (one-time hints),
                   weatherFx (rain streaks and the wind flag)
  screens/         Title, create player, hub, how-to-play, training, gear store, game day, results
  ui/              Canvas helpers, DOM helpers, modal, sprites (animated players)
tools/             Headless harnesses — see below
```

`core/` deliberately has zero DOM dependencies. If you later want the simulation in Rust
compiled to WASM, that's the boundary to port — the rendering layer never has to change.

## Dev menu

Running `npm run dev` puts a **DEV BUILD** strip at the top of the clubhouse with a
**Player stats** button. It edits the live save directly — no confirmation, no cost:

- Every attribute on a slider (5–99), plus Rookie / Average / Star / Maxed presets
- Stamina, energy, level, XP, unspent attribute points and money
- Name, position and handedness
- The season and career batting lines, and the fielding line
- One-shot buttons: refill stamina and energy, +25 points, unlock the perfect hit zone

Typed batting lines are kept legal — hits are derived from 1B/2B/3B/HR, and AB and PA are
raised to cover the line — so the promotion check never sees more hits than at-bats.

A production build hides it, which means Capacitor never ships it. To get at it on a real
device, set `baseball-star:dev` to `1` in localStorage.

## Headless harnesses

The models are tuned against measurements, not by feel. All three run without a browser.

```bash
npx tsx tools/fitFlight.ts
```

Grid-searches the aerodynamic constants in `ballFlight.ts` against real carry distances.
Current fit is about 23 ft weighted RMSE, and inside the barrel range that decides home
runs (80–105 mph, 20–40 degrees) it lands within roughly 10 ft. `tools/flight.ts` prints
the resulting distance table. Re-run these after touching any flight constant.

```bash
npx tsx tools/play.ts
```

Runs live plays headlessly and reports outcome mix, how the batter was retired, play
duration and any hangs. It also runs cohorts where the player stands still, which is how
the "does the player's input actually matter" question gets answered, and two where the
player hammers GO and BACK every frame, which is how "can the runner be exploited" gets
answered — those should come out mostly outs. Plays should resolve in 4–6 seconds with
zero timeouts. It also counts **crowded** plays (two runners within a few strides of each
other for more than a moment) and **doubled-up** ones (two runners credited with the same
base at the end); both should be zero.

```bash
npx tsx tools/season.ts
```

Walks whole seasons day by day across several seeds and asserts the season ends exactly
once, at the end. It exists because of a real bug: "is the season over?" was answered with
"is there a game today?", which is also true on every ordinary off day, so seasons ended
after two or three games. Exits non-zero on failure.

```bash
npx tsx tools/parks.ts
```

Runs 1500 balls in play through every ballpark and reports home run rate, wall balls and
dimensions, then walks a whole season through the calendar to confirm every scheduled game
lands on a day and the off days fall where they should.

```bash
npx tsx tools/balance.ts
```

Simulates thousands of plate appearances to check pitch-level balance: zone rate, walks,
whiffs per swing, and contact quality by level. Note the scope — since batted balls now
resolve on the field, this harness covers **the plate appearance** (counts, walks,
strikeouts, foul rate, contact quality) plus the abstract resolver still used for
simulated non-player at-bats. Your own batting line comes out of `playSim.ts`, where your
baserunning and the defense decide it.

## Building for Android and iOS

Capacitor is already configured (`capacitor.config.ts`, app id `com.baseballstar.app`).

**Android** — needs Android Studio and the Android SDK installed:

```bash
npm run build && npx cap add android && npx cap open android
```

**iOS** — needs a Mac with Xcode. This cannot be built from Windows; the platform files
can be generated anywhere but the build and simulator require macOS:

```bash
npm run build && npx cap add ios && npx cap open ios
```

After any web change, `npm run sync` rebuilds and pushes into the native projects. Commit
the generated `android/` and `ios/` folders — that's where icons, splash screens and
permissions live.

## Current state

A playable vertical slice, not a finished game. What's real:

- At-bat minigame: five pitch types, late break, ball/strike calls, counts, fouls
- Top-down field with camera, baserunning decisions, fielder positioning, throws to bases
- Routine vs stretch catches, with a tap minigame for the ones you have to earn
- Batted-ball physics fitted to real carry distances, with bounce and roll
- Six ballparks with distinct dimensions and wall heights, and balls that play off the wall
- Solid outfield walls, and crowds that fill up as you climb the levels
- Per-team home and away uniforms, so the two sides on the field are always distinct
- Batting eye (ball/strike read at the plate) unlocked at 65 Vision
- Perfect hit zone unlocked at 120 combined Contact and Vision
- Nine-inning games with play-by-play, extra innings, standings, four-level promotion
- Per-game pay off the contract you signed, and a gear store selling equipment that wears out
- Day-by-day season calendar with off days for training, and a localStorage save

Deliberately simplified in the live play — worth knowing before you build on it:

- A throw to a base is a **force play** against anyone running into it and a **tag**
  against anyone scrambling back to it — there's no rundown in between, and a fielder
  stood on the bag with the ball tags whoever arrives. Relay men aren't drawn, but long
  throws are charged for one — a throw from the track goes through a cut-off, which is
  why an outfield arm doesn't beat everybody home.
- No tag-ups: on a caught fly, runners return rather than advancing, and nobody gets
  doubled off.
- CPU runners break halfway on contact, make one advancement decision when the ball
  lands, then commit.
- Runners can't pass each other, and aren't modelled as individual players.
- You're only credited a run scored on your own home runs.

Audio lives in `ui/audio.ts`, playing clips from `public/audio/` — effects through
Web Audio, the crowd bed streamed. Every file's source and license is tracked in
`public/audio/README.md`; add a row there before adding a sound.

Still missing generally: batted-ball animation beyond the ball itself, stealing,
pitching as a mode, and any art assets — everything on screen is drawn procedurally.
Season length is 24 games (`SEASON_GAMES` in `core/league.ts`) so a career fits in a
sitting; raise it once pacing is tuned.
