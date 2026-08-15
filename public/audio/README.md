# Audio credits and licensing

Every file in this folder, where it came from, and what license covers it. Keep
this current — if you add a sound, add its row. If a sound has no row, treat it
as unclear to ship until someone traces it back to a source.

Downloaded 2026-08-12. Wired up in `src/ui/audio.ts`.

## How these are played

**The files here are raw library recordings and are not trimmed.** Most are
multi-take: `catch-leather-thud.mp3` is 62 seconds containing about forty
separate hits, `bat-tap.mp3` is 4.4 seconds of room tone with one tap at 3.17s,
and all three cheer files open with a two-second fade-in.

Rather than ship edited copies, `src/ui/audio.ts` declares an offset and
duration per sound and trims at playback. Two consequences worth knowing:

- **Changing a file means rechecking its window.** Replace a file and its
  offsets are meaningless. The windows are listed in `CLIPS` in that module.
- **The offsets and gains were measured, not guessed.** Each was derived from
  the decoded waveform — transient detection to find the usable hit inside the
  take, and the peak level inside the chosen window to set a gain that puts
  every clip at a comparable loudness. The sources range from -0.19 to -0.96
  full scale, so without per-clip gain the mix is badly uneven.

If you ever do trim these into single-hit files, delete the offsets rather than
leaving them pointing into the wrong part of a shorter file.

## License summary

All 23 files are **Pixabay Content License**. At download time each source page
carried the line "Free for use under the Pixabay Content License" — that was
checked per file, not assumed from the site as a whole.

What that license grants (see https://pixabay.com/service/license-summary/):

- Free for commercial and non-commercial use.
- No attribution required (this file is for your own traceability, not a legal
  obligation).
- You may modify them — trim, pitch-shift, layer.

What it does not allow, and the second one is the clause that matters for a game
that might get an asset-pack spinoff:

- Redistributing the audio in a form where the sound itself is the product
  (reselling on a stock site, bundling into a sample pack).
- Using identifiable people or brands in a way implying endorsement.

## The files

Uploader links are included because the Pixabay license is granted by the
uploader — if a file's licensing is ever challenged, the uploader page is where
the trail starts.

### Bat contact

| File | Size | Original title | Uploader | Source |
|---|---|---|---|---|
| `bat-hit-ping.mp3` | 44 KB | baseball bat | [freesound_community](https://pixabay.com/users/freesound_community-46691455/) | [89107](https://pixabay.com/sound-effects/film-special-effects-baseball-bat-89107/) |
| `bat-tap.mp3` | 139 KB | Baseball Bat Tap | [freesound_community](https://pixabay.com/users/freesound_community-46691455/) | [94771](https://pixabay.com/sound-effects/baseball-bat-tap-94771/) |
| `bat-bonk.mp3` | 40 KB | Bonk Sound effect | [freesound_community](https://pixabay.com/users/freesound_community-46691455/) | [36055](https://pixabay.com/sound-effects/film-special-effects-bonk-sound-effect-36055/) |

### Swing and miss

Five variants so repeated strikeouts don't play the identical sample. All from
the same uploader's numbered series, so they're tonally consistent.

| File | Size | Original title | Uploader | Source |
|---|---|---|---|---|
| `whiff-1.mp3` | 7.5 KB | Swing Whoosh 1 | [floraphonic](https://pixabay.com/users/floraphonic-38928062/) | [198494](https://pixabay.com/sound-effects/film-special-effects-swing-whoosh-1-198494/) |
| `whiff-2.mp3` | 5.3 KB | Swing Whoosh 2 | [floraphonic](https://pixabay.com/users/floraphonic-38928062/) | [198497](https://pixabay.com/sound-effects/film-special-effects-swing-whoosh-2-198497/) |
| `whiff-3.mp3` | 7.5 KB | Swing Whoosh 3 | [floraphonic](https://pixabay.com/users/floraphonic-38928062/) | [198495](https://pixabay.com/sound-effects/film-special-effects-swing-whoosh-3-198495/) |
| `whiff-4.mp3` | 8.3 KB | Swing Whoosh 4 | [floraphonic](https://pixabay.com/users/floraphonic-38928062/) | [198496](https://pixabay.com/sound-effects/film-special-effects-swing-whoosh-4-198496/) |
| `whiff-5.mp3` | 7.5 KB | Swing Whoosh 5 | [floraphonic](https://pixabay.com/users/floraphonic-38928062/) | [198498](https://pixabay.com/sound-effects/film-special-effects-swing-whoosh-5-198498/) |

There are 12 in this series (ids 198494–198505) if you want more variety later.

### Catch / mitt pop

None of these is literally a baseball mitt — see "Rejected sources" below for
why. They're the closest free-licensed stand-ins; all three need trimming to the
initial transient, and the leather one is the most convincing pop.

| File | Size | Original title | Uploader | Source |
|---|---|---|---|---|
| `catch-leather-thud.mp3` | 1.2 MB | 021361_leather couch sounds impact thud strike.wav | [freesound_community](https://pixabay.com/users/freesound_community-46691455/) | [63666](https://pixabay.com/sound-effects/film-special-effects-021361-leather-couch-sounds-impact-thud-strikewav-63666/) |
| `catch-basketball.mp3` | 1.0 MB | basketball catch | [freesound_community](https://pixabay.com/users/freesound_community-46691455/) | [68773](https://pixabay.com/sound-effects/film-special-effects-basketball-catch-68773/) |
| `catch-palming-football.mp3` | 524 KB | palming football | [freesound_community](https://pixabay.com/users/freesound_community-46691455/) | [34928](https://pixabay.com/sound-effects/film-special-effects-palming-football-34928/) |

### Home run and stingers

| File | Size | Original title | Uploader | Source |
|---|---|---|---|---|
| `homerun.mp3` | 1.0 MB | baseball home run | [ballparkfanatic444](https://pixabay.com/users/ballparkfanatic444-22123207/) | [419442](https://pixabay.com/sound-effects/film-special-effects-baseball-home-run-419442/) |
| `sting-charge-long.mp3` | 144 KB | Baseball calvary sting long sustain | [freesound_community](https://pixabay.com/users/freesound_community-46691455/) | [102081](https://pixabay.com/sound-effects/musical-baseball-calvary-sting-long-sustain-102081/) |
| `sting-charge-short.mp3` | 95 KB | Baseball cavalry sting short sustain | [freesound_community](https://pixabay.com/users/freesound_community-46691455/) | [80564](https://pixabay.com/sound-effects/musical-baseball-cavalry-sting-short-sustain-80564/) |

### Crowd ambience (loops)

| File | Size | Original title | Uploader | Source |
|---|---|---|---|---|
| `crowd-ambience-long.mp3` | 8.2 MB | baseball sounds | [freesound_community](https://pixabay.com/users/freesound_community-46691455/) | [52818](https://pixabay.com/sound-effects/city-baseball-sounds-52818/) |
| `crowd-fenway.mp3` | 2.5 MB | Fenway Ambience 3 | [freesound_community](https://pixabay.com/users/freesound_community-46691455/) | [59185](https://pixabay.com/sound-effects/people-fenway-ambience-3-59185/) |
| `crowd-ambience-short.mp3` | 661 KB | Baseball Game Crowd Noise | [alex-morgan](https://pixabay.com/users/alex-morgan-54692529/) | [375083](https://pixabay.com/sound-effects/people-baseball-game-crowd-noise-375083/) |

`crowd-ambience-long` is 7:10 and 8.2 MB — most of this folder's weight. For a
Capacitor build, cut it to a seamless 20–30s loop before shipping, or drop it in
favour of `crowd-ambience-short`.

### Crowd reactions

Three intensities so the reaction can scale with the play.

| File | Size | Original title | Uploader | Source |
|---|---|---|---|---|
| `cheer-soft.mp3` | 673 KB | Free Crowd Cheering Sounds - 05 - Soft cheering - I | [GregorQuendel](https://pixabay.com/users/gregorquendel-19912121/) | [116192](https://pixabay.com/sound-effects/people-free-crowd-cheering-sounds-05-soft-cheering-i-116192/) |
| `cheer-strong-short.mp3` | 439 KB | Free Crowd Cheering Sounds - 04 - Strong cheering - II - Short | [GregorQuendel](https://pixabay.com/users/gregorquendel-19912121/) | [116191](https://pixabay.com/sound-effects/people-free-crowd-cheering-sounds-04-strong-cheering-ii-short-116191/) |
| `cheer-strong.mp3` | 782 KB | Free Crowd Cheering Sounds - 03 - Strong cheering - I | [GregorQuendel](https://pixabay.com/users/gregorquendel-19912121/) | [116189](https://pixabay.com/sound-effects/people-free-crowd-cheering-sounds-03-strong-cheering-i-116189/) |
| `clap-rhythmic.mp3` | 74 KB | bb-clapRhm | [freesound_community](https://pixabay.com/users/freesound_community-46691455/) | [87606](https://pixabay.com/sound-effects/film-special-effects-bb-claprhm-87606/) |

### Between innings

| File | Size | Original title | Uploader | Source |
|---|---|---|---|---|
| `organ.mp3` | 245 KB | baseball organ | [freesound_community](https://pixabay.com/users/freesound_community-46691455/) | [106664](https://pixabay.com/sound-effects/musical-baseball-organ-106664/) |
| `take-me-out.mp3` | 855 KB | Take me Out to the Ball Game | [freesound_community](https://pixabay.com/users/freesound_community-46691455/) | [73499](https://pixabay.com/sound-effects/people-take-me-out-to-the-ball-game-73499/) |

`take-me-out` is a public-domain melody (1908), but this specific *recording* is
covered by the Pixabay license like everything else here.

## Rejected sources

**101soundboards.com — not used.** The originally requested mitt catch
(`101soundboards.com/sounds/1356728-baseball-mitt-catch`) was not downloaded.
That site's disclaimer at
https://www.101soundboards.com/pages/terms_and_privacy states its clips are
"copyrighted, unlicensed" samples that "retain their original copyright as owned
by their respective" owners, offered "under fair use purely for your own
personal use and enjoyment." It grants no license for redistribution in a game,
so it fails the free-to-use bar this file exists to enforce. The three `catch-*`
files above are the free-licensed substitutes.

This applies to the whole site, not just that one clip — it's user-uploaded with
no per-file provenance, so nothing from it should be treated as clearable.

## What plays when

| Sound | Fires on | Source file |
|---|---|---|
| `whiff` | Any swing and miss — one of five takes at random, slightly detuned | `whiff-1`…`whiff-5` |
| `mitt` | Pitch taken, and behind a whiff — the ball reaching the catcher | `catch-basketball` |
| `contactBarrel` | Barreled contact | `bat-hit-ping` |
| `contactSolid` | Solid contact | `bat-tap` |
| `contactWeak` | Flare, weak or mishit contact | `bat-bonk` |
| `foul` | Ball fouled off | `bat-hit-ping` (earlier, deader hit) |
| `catchMade` | Stretch catch held | `catch-leather-thud` |
| `catchMissed` | Stretch catch dropped | `catch-palming-football` |
| `homeRun` | Your home run — crowd only, the bat already cracked at contact | `homerun` |
| `fanfare` | 1.4s after a home run, answering the roar | `sting-charge-long` |
| `rally` | You step in with runners on | `sting-charge-short` |
| `clap` | You step in with the bases empty, 25% of the time | `clap-rhythmic` |
| `cheerBig` | Your hit drives in runs | `cheer-strong` |
| `cheerShort` | Your hit with nobody scoring, or a putout you made | `cheer-strong-short` |
| `cheerSoft` | You draw a walk | `cheer-soft` |
| `organ` | Between innings, 30% of the time | `organ` |
| *(ambience)* | Streams and loops for the whole game at low volume | `crowd-ambience-long` |

`crowd-ambience-long.mp3` is deliberately the 7-minute file and deliberately
*not* decoded: it plays through a streaming `<audio>` element, so its 8.2 MB
never becomes ~70 MB of resident PCM, and the length keeps the bed from looping
audibly. The short one is the fallback if app size ever matters more.

`take-me-out.mp3` is downloaded and credited but not currently wired to
anything — there's no natural moment for a 40-second singalong in a game that
skips to your plate appearances. Seventh-inning stretch would be the spot.

Deliberately silent: strikeouts and outs you make. There's no free-licensed
crowd groan in the set, and a cheer would be worse than nothing.

## Still missing

No free-licensed source found yet for:

- **Umpire calls** ("strike!", "yer out!") — the Pixabay baseball tag has none.
  Recording your own is likely faster than searching.
- **A clean wooden bat crack.** `bat-hit-ping` reads metal/aluminium. Freesound
  (CC0-filtered) is the better hunting ground.
- **Ball hitting a glove**, per above.

Good free-licensed sources when extending this set: Freesound (filter to CC0),
OpenGameArt, and Mixkit. Check the per-file license on Freesound — the site
hosts CC-BY and CC-BY-NC alongside CC0, and only CC0 avoids attribution and
commercial-use conditions.
