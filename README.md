# Star Cadet

A 3D pinball game for the browser, an unofficial fan remake inspired by *3D Pinball for Windows - Space Cadet*.
Not affiliated with, endorsed by or sponsored by Microsoft, Cinematronics or Maxis.

* the classic table **layout**, a ray-cast **physics model** (120 Hz fixed step) and the full **rules**
  (all 17 missions, ranks, fuel, wormholes, hyperspace, skill shot, bonus / jackpot pots, tilt, ball save, multiplayer, demo mode, cheats),
  a **lamp engine** and Windows-style menus / dialogs / scoreboard;
* an **original 3D look**: our own geometry and procedurally painted textures, lettering and logo - no bitmaps or code of the game are used or shipped;
* optional **original sounds**, loaded at run time only (never bundled; see "Sound" below).

Plain JavaScript ES modules, Three.js **0.160.0** through an import map (loaded from the jsDelivr CDN), **no build step, no npm dependencies**.

## Play

* **In your browser:** <https://richdubbs.github.io/star-cadet/>
* **Windows app:** download `StarCadet.exe` from the [latest release](https://github.com/richdubbs/star-cadet/releases/latest) and run it
  (Windows 10 / 11; it opens the game in its own Microsoft Edge window and works offline). The exe is not code-signed, so Windows SmartScreen may
  warn on first launch: choose *More info > Run anyway*. To use your own copies of the original sounds, put them in a `sounds` folder next to the exe.
  Build it yourself with `node desktop/build.mjs` (needs Node and npm; it fetches three.js 0.160.0 from npm and compiles `desktop/StarCadet.cs` with the
  C# compiler that ships with Windows).

## Run from source

```
python -m http.server 8765 --bind 127.0.0.1        (or: npm start)
```

then open <http://127.0.0.1:8765/>, pick **Start without sound** (or **Start with original sounds**) and play.
Any static file server works; the page must be served over http(s), not opened from `file://` (ES modules).
Needs a current desktop or mobile browser with WebGL and ES modules (Chrome, Edge, Firefox, Safari). Without WebGL the table area shows a notice
and everything else still runs. If the CDN is unreachable the rest of the page (menus, scoreboard) still comes up and the table area says so.

The page is laid out like the original window: a 600 x 416 virtual screen (table on the left, scoreboard on the right) scaled uniformly to the window
below the menu bar. On a phone the touch buttons sit above and below the stage; there is never horizontal scrolling. Held upright (narrow and portrait) the table takes the whole width and
the scoreboard becomes a text strip (player / ball / score / messages) under it; landscape and wide windows keep the original side-by-side stage.

## Controls

| action | key (default, rebindable in *Options > Player Controls...*, `F8`) |
|---|---|
| Left flipper | `Z` |
| Right flipper | `/` |
| Plunger (hold = pull, release = launch) | `Space` |
| Left / right / bottom table bump (nudge) | `X` / `.` / `Up Arrow` |
| New game | `F2` |
| Launch ball (menu command) | `Enter` |
| Pause / resume | `F3` |
| Full screen | `F4` |
| Sounds on / off | `F5` |
| Music on / off | `F6` |
| Player Controls dialog | `F8` |
| Help | `F1` |
| Camera: original / top / orbit | `V` |

Mouse over the table: left button = left flipper, right button = right flipper, middle button = plunger. Touch: left half of the table = left flipper,
right half = right flipper, plus the on-screen buttons (touch devices, or `?touch=1`). Key repeat is ignored. Gameplay keys are ignored while paused,
while tilted flippers are dead, and input is blocked in demo mode. Opening a menu or a dialog during a game pauses it; leaving the window pauses it too
(resume with `F3` or the Resume button; the attract mode `?demo` is the exception: it carries on by itself when its tab is visible again).
Keys are physical positions, so `Z` / `X` are also answered by the key *labelled* Z / X on QWERTZ, AZERTY and Dvorak keyboards.

Nudge too often and the table **tilts**. A hold of the plunger of about 2.5 s is full power; a quick tap does not get the ball out of the lane.

Typed cheat words (during play, like the original): `gmax`, `1max`, `bmax`, `rmax`, `easy mode`, and `hidden test` (debug mode). Cheats other than
`hidden test` disable the high-score entry for that game. In debug mode: drag the ball with the mouse, `H` high-score prompt, `R` rank up, `B` extra ball,
`S` random score, `I` / `J` all lamps on / off for a second, `Y` frame rate.

### URL flags (all optional)

`?demo` start in attract mode (with a remembered sound consent the files load at once and the sound starts at your first click or key, as browsers require) | `?seed=7` seeded random numbers (reproducible runs) | `?camera=original|top|orbit` | `?nosound` | `?quality=low|high`
(low = no shadows / bloom, smaller textures) | `?touch=1` force the on-screen buttons | `?debug=1` debug mode. The debug handle `window.__pinball`
exposes `game, physics, lamps, rules, audio, ui, renderer, input, data, store, art, actions`.

## Sound

The original sound files are copyrighted by their owners and are **never bundled or committed** here. If nothing can be loaded the game is silent with
**identical timing** (all durations come from a built-in table, never from the audio itself). Per file, the sources are tried in this order, and every file
must match the original's exact size and SHA-1 or it is discarded:

1. your own copy dropped into **`sounds/`** next to `index.html`: copy `SOUND*.WAV` (and optionally `PINBALL.MID`) from your Pinball installation into
   that folder (upper or lower case names, do not rename; details in `sounds/README.txt`) - this is probed first and a missing file is just skipped;
2. the Internet Archive copy of the game (two routes), fetched by your browser only when you choose **Start with original sounds** (the start card shows the
   consent line);
3. your own Pinball folder or `.zip` picked with **Options > Load My Sounds...** (or the link on the start card), or dropped onto the page.

Status is shown at the bottom left of the table ("sound: original (...)", "partial (n/41)", "not loaded"); *Options > Sound Status & Volume...* has the volume
slider. Music (`PINBALL.MID`) is optional, **off by default**, played by a small built-in MIDI synth (no soundfont, no third-party scripts), and comes from
`sounds/` or the Internet Archive only.

## Tests

Node 24, no dependencies:

```
npm test                  # node --test "tests/**/*.test.mjs"  (all unit + integration tests, a few seconds)
npm run test:arch         # architecture guard: files, owners, exports, layering, index.html mount points
npm run test:strict       # same suite with ARCH_STRICT=1: also fails on any placeholder module and on missing role test files
npm run test:input        # keyboard / mouse / touch mapping + cheat matcher
npm run test:integration  # headless full games with the real physics + lamps + rules
node --test tests/integration_app.test.mjs   # the whole page shell (src/main.js) in Node on a fake DOM
node --test tests/audio_integration.test.mjs # autoplay policy, pause timing and the local sounds/ folder over a temporary folder
```

Do **not** run `node --test tests/` on Node 24: it treats the directory as a module; use the glob form above.

`tests/integration.test.mjs` plays complete games in Node (real modules, seeded random numbers, a deterministic bot): new game, light show, plunger at full
boost, flipper hits, bumper scoring, tilt, drain, three balls, game over, high-score entry, two players, demo, pause, 1 minute of random flipping with a
ball-bounds check, byte-identical replays - plus repository conformance (no placeholder left, every import and `index.html` reference resolves).
`tests/integration_app.test.mjs` runs `createApp` of `src/main.js` (start flows, keys -> input -> rules -> physics, which sound keys reach `audio.play`, pause on blur /
hidden tab / menu / dialog, demo for ten simulated minutes, a failing renderer or frame stage, CDN down) on the UI role's fake DOM; `tests/audio_integration.test.mjs`
checks the local `sounds/` path with tiny fake files in a temporary folder (wrong hash / wrong size rejected, nothing downloaded).
Rendering and real browser input are checked by hand: serve, open the page, expect a clean console.

Some data cross-checks in `tests/data.test.mjs` (and `tools/gen_data.mjs`, which generated the committed `src/data` tables) need a private `research/` folder that is not part of this repository; without it those tests are skipped.

## Project layout

`ARCHITECTURE.md` is the binding contract (roles, interfaces, events, timing). Comments that cite "SPEC" sections refer to the private design notes.

```
index.html  css/{style,ui}.css          page, 600x416 stage geometry, UI styles
src/main.js                             browser wiring, animation loop, start flow, window.__pinball
src/game.js                             headless composition + fixed 120 Hz clock (Node-safe)
src/input.js                            keyboard / mouse / touch -> input events, cheat matcher
src/data/                               frozen tables: walls, components, lamps, missions, sounds manifest, constants
src/physics* src/lamps* src/rules*      the simulation (pure Node modules, injected into each other only by game.js)
src/render/ (+ art/)                    Three.js scene + procedural canvas painters
src/ui/                                 menus, scoreboard, dialogs, start card, toasts, touch buttons, storage
src/audio* sounds/                      fetch / validate / decode / mixer / MIDI synth / user files; drop-in folder
tests/                                  node:test suites per role + tests/integration.test.mjs
```

Frame order each animation frame: input -> `game.advance(dt)` (whole 1/120 s steps of physics -> rules events -> rules timers -> lamps) -> audio ->
render -> UI. The simulation never reads a wall clock; pausing simply stops stepping. Balls are drawn interpolated between the last two 120 Hz steps
(presentation only), so 144 / 165 Hz screens and uneven frame times stay smooth.

## Known limitations

* Headless / software-rendered Chrome only reaches 4-7 fps; frame rate on real GPUs has not been measured.
* The tube behind the hyperspace lane ("tube mouth") cannot be reached by any shot: the escape-chute sink catches everything coming up that channel
  (a ball in the tube is still handled and exits correctly).
* After a ball feed the nudge counter starts at -2 (SPEC 4.11 "grace"), so the first few nudges of a ball are free; SPEC 4.11 is also read as
  `max(0, ...)`, which would clear the grace at once - the grace is kept.
* A weak plunge that falls back down the right orbit crosses the deployment chute and rolls out through `s_onewy7` instead of being caught by the
  escape chute (`v_sink7`); this follows the extracted table data and has not been compared with the original.
* Probing the local `sounds/` folder for your own sound files may print up to about a dozen 404 lines in the browser console when the folder is empty
  (browsers log every failed request; the loader stops probing after a few misses).

## Licence and notices

The code, geometry, textures and lettering in this repository are original work, released under the MIT licence (see `LICENSE`).

*3D Pinball for Windows - Space Cadet*, its sounds and its music belong to Microsoft / Cinematronics / Maxis. None of them are included in this
repository, and this project is not affiliated with or endorsed by them. Three.js is MIT-licensed and loaded from a CDN.
