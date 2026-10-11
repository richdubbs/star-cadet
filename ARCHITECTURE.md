# ARCHITECTURE.md - Star Cadet (BINDING CONTRACT)

Written by the ARCHITECT. About eight implementers code against this file **in parallel and without talking to each other**, so every
interface here is exact. `research/SPEC.md` (2,080 lines) stays the source of truth for **numbers and behaviour**; this file is the
source of truth for **structure, interfaces, ownership, ordering and tests**.

| conflict between | winner |
|---|---|
| ARCHITECTURE.md vs SPEC.md about a signature, file, export, event name, ordering, owner | **ARCHITECTURE.md** |
| ARCHITECTURE.md vs SPEC.md about a number, rule, timing, formula, string | **SPEC.md** |
| SPEC.md vs any other `research/*.md` | SPEC.md |
| the task's sound policy vs SPEC 7.5 | **the sound policy of section 10** (local folder -> Internet Archive S1 -> S5 -> user file picker; no GitHub/jsDelivr mirrors) |
| `src/types.js` vs ARCHITECTURE.md | ARCHITECTURE.md (report it in your hand-off note; INTEGRATOR fixes `types.js`) |

## 0. Read this first

### 0.1 Project in one paragraph

Star Cadet, a 3D browser pinball game modelled on the classic Windows pinball table: the original table LAYOUT, PHYSICS feel (the original ray-cast
model with the original constants), RULES / missions / scoring / lamp behaviour, UI behaviour and (optionally) the ORIGINAL SOUND FILES,
loaded at run time only. The 3D look is **original work** (our own geometry, procedural canvas textures, our own lettering and logo): never
reproduce the game's bitmaps or its cartoon pilot. Short text strings of the game (mission names, rank names, messages) are fine. Do not
paste decompiled source code: implement from the SPEC's paraphrased pseudo-code.

### 0.2 Hard constraints (from the task)

1. Plain JavaScript ES modules, **no build step, no npm dependencies at runtime**. Three.js **0.160.0** only, through the import map in
   `index.html` (`https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js`; addons from `.../examples/jsm/`).
2. Served by `python -m http.server 8765` from the project root (`index.html` at the root). All paths are relative; every import has an
   explicit `.js` extension; no bare specifiers except `three` / `three/addons/...` (RENDER only).
3. `src/data/**`, physics, rules, lamps, the audio manifest/timer logic and the pure ART/UI/RENDER helpers are **pure modules runnable in Node 24**
   (no DOM, no `three`, no `window`/`document`/`localStorage`/`AudioContext` at import time) and are unit-tested with `node --test`.
4. Sound policy: per file the source order is (1) same-origin `./sounds/<NAME>` (the user may drop their own originals there; probe it first,
   404 => skip), (2) Internet Archive S1 zip route, then S5 loose-file route, (3) the user picks their own Pinball folder/zip with a file
   picker. Every file is validated by byte length + SHA-1. Nothing is bundled. If nothing loads the game is silent **with identical timers**.
   Music (`PINBALL.MID`) is optional, default OFF, from `./sounds/` or S1 only.
5. All visuals are original; no game bitmaps, no pilot character.

### 0.3 How to work (rules of engagement)

* You own exactly the files of your role (section 1). **Never edit a file you do not own.** If you need a change elsewhere, work around it
  through the documented interface and leave a note in your hand-off message; additive exports in your own files are always allowed.
* `src/data/*.js` names, `src/types.js` typedef names and the lists in `tests/arch_manifest.mjs` are **frozen: names may be added, never renamed
  or removed**. When you add a file or export, append it to `tests/arch_manifest.mjs` (the only shared file every role may *append* to).
* Every source file starts with a header comment containing `OWNER: <ROLE>` and `STATUS: STUB|SEEDED|IMPLEMENTED`. The stubs written by the
  architect already compile and import; replace `STATUS: STUB` with `STATUS: IMPLEMENTED` when your module is complete (`SEEDED` = real values already in place, DATA verifies).
* **Gap protocol.** When this file and the SPEC are silent, pick the simplest behaviour consistent with the SPEC, implement it, and write it
  down in an `ASSUMPTIONS:` block in your module header (and in your hand-off note). Never invent a new cross-role interface; never change an
  existing signature.
* Fail fast on programmer errors (unknown lamp/group/component names throw `TypeError`), never on runtime conditions (a missing sound, a
  throwing `localStorage`, a 404 must never throw out of the module).
* Run `node --test` (all) or `node --test tests/<role>.test.mjs` (yours) before you hand off. **`node --test tests/` does NOT work on Node 24**
  (it treats the directory as a module); use `node --test "tests/**/*.test.mjs"` (= `npm test`) or bare `node --test`.
* Browser checks: `python -m http.server 8765 --bind 127.0.0.1` then open `http://127.0.0.1:8765/`; the page must produce **no console errors**.

### 0.4 Roles

| role | owns (summary) | deliverable |
|---|---|---|
| **DATA** | `src/data/**`, `tools/` | every constant / table / geometry / lamp / string / sound manifest as frozen pure modules |
| **PHYSICS** | `src/physics.js`, `src/physics/**` | the fixed-step ray-cast simulation, components, flippers, plunger, ramps, event queue |
| **LAMPS** | `src/lamps.js`, `src/lamps/**` | the lamp engine: lamps, groups, bargraph, timers, per-player save |
| **RULES** | `src/rules.js`, `src/rules/**` | game flow, scoring, missions, ranks, fuel, wormholes, text boxes, high-score table, demo AI, cheats |
| **RENDER** | `src/render/**` except `art/` | Three.js scene, camera, meshes, per-frame animation, lamp overlays |
| **ART** | `src/render/art/**` | procedural canvas painters: floor, deck, lamp atlas, misc textures, scoreboard panel |
| **UI** | `src/ui/**`, `css/ui.css` | menus, scoreboard panel, dialogs, overlay, toasts, storage, touch controls |
| **AUDIO** | `src/audio.js`, `src/audio/**`, `sounds/` | fetch/validate/decode, mixer, user-file import, MIDI synth, duration table use |
| **INTEGRATOR** | `index.html`, `css/style.css`, `package.json`, `README.md`, `src/main.js`, `src/game.js`, `src/input.js`, `src/types.js`, `tests/helpers/**`, `tests/arch*`, `tests/integration*` | wiring, input, headless game, conformance + integration tests |
| ARCHITECT | this file | frozen |

### 0.5 Vocabulary

* **T-frame**: the DAT's own world frame, used by *all* simulation data and logic (SPEC 1.1). `+x` points to the **screen-LEFT** (the plunger
  lane is at `x = -7`, screen right), `+y` points **down the table toward the player** (top `y = -14`, flippers `y ~ 12`, drain `y = 14.437`),
  `+z` is up. Playfield rectangle `x in [-8,8]`, `y in [-14,15]`. Ball radius `R = 0.3`. Flipper 1 (`a_flip1`) is the **left** flipper (+x).
  Only RENDER converts to Three.js axes (`src/render/convert.js`); only ART/RENDER use pixel coordinates.
* **mask**: collision-layer bit field (1 playfield, 2 ramp/tube, 4 deck, 6 = shell 103). A ball carries one mask and collides only with edges
  sharing a bit (SPEC 1.5).
* **edge**: a one-sided line or a circle, already inflated by the ball radius where the SPEC says so (SPEC 4.6).
* **S / light_on / isLit**: lamp steady flag; the rules' test (S or FORCE_ON or FLASH); the visual state (SPEC 5.13.1).
* **SoundKey**: `'BUMPER'`, `'FLIP_UP'`, `'SW3'` ... the keys of `SOUND_KEYS` (`src/data/sounds.js`).
* **seeded**: a data file the architect already filled with real values (DATA verifies and completes it).

### 0.6 Reading list per role (besides this file)

| role | SPEC sections |
|---|---|
| DATA | 0, 1, 2, 3, App. A, App. B, 5.11, 7.3-7.5 + `research/physics_data.json`, `layout_data.json`, `lamp_positions.json` |
| PHYSICS | 1, 2, 3.5, 4, 5.14, App. D; `research/physics_ref_sim.py` (numerical cross-check), `physics_data.json` |
| LAMPS | 5.13 (all), 5.5, App. A (group lists); App. D #7, #9 |
| RULES | 5 (all), 2 (scores/timers), 6.5, 6.9, 7.3-7.4, 4.11 |
| RENDER | 1, 3 (all), 6.8, 6.10, 2 (3D notes), App. A (lamp colours) |
| ART | 6.2, 6.3, 6.8, App. A, 3.5.2 (painted look) |
| UI | 6 (all), 5.11, 5.2.7, 5.2.9 |
| AUDIO | 7 (all) + the sound policy above |
| INTEGRATOR | 1.4, 6.1, 6.7, 6.5, Appendix C, D |

---

## 1. Directory layout and file ownership

```
/                                  web root = project root  (python -m http.server 8765)
├─ index.html                      INTEGRATOR  mount points + import map            (Appendix B)
├─ package.json                    INTEGRATOR  {"type":"module"}, scripts, NO dependencies
├─ README.md                       INTEGRATOR  how to run / test
├─ ARCHITECTURE.md                 ARCHITECT   this file
├─ css/
│   ├─ style.css                   INTEGRATOR  page + stage geometry (600x416 box, % rectangles)
│   └─ ui.css                      UI          menus, panel, overlay, dialogs, toast, touch buttons
├─ sounds/
│   └─ README.txt                  AUDIO       drop-in folder for the user's own originals (never committed)
├─ research/                       (read-only inputs; never imported at runtime)
├─ tools/
│   └─ gen_data.mjs                DATA        dev-time generator research/*.json -> src/data/*.js (optional)
├─ src/
│   ├─ types.js                    INTEGRATOR  JSDoc typedefs only (no runtime code)
│   ├─ main.js                     INTEGRATOR  browser entry: wires everything, rAF loop, window.__pinball
│   ├─ game.js                     INTEGRATOR  headless composition + fixed-step clock (Node-safe)
│   ├─ input.js                    INTEGRATOR  keyboard / pointer / touch -> InputEvent, cheat matcher
│   ├─ data/                       DATA        frozen pure data (section 3)
│   │   ├─ index.js freeze.js constants.js events.js heights.js materials.js scoring.js text.js     (seeded)
│   │   ├─ names.js sounds.js                                                                       (seeded)
│   │   └─ walls.js components.js ramps.js lamps.js missions.js                                      (DATA fills)
│   ├─ physics.js                  PHYSICS     facade: createPhysics
│   ├─ physics/                    PHYSICS     edges.js collision.js snapshot.js (+ anything else you need)
│   ├─ lamps.js                    LAMPS       facade: createLamps
│   ├─ lamps/                      LAMPS       wheel.js lamp.js group.js bargraph.js
│   ├─ rules.js                    RULES       facade: createRules
│   ├─ rules/                      RULES       scheduler.js textbox.js highscores.js (+ flow/features/missions/... as you like)
│   ├─ audio.js                    AUDIO       facade: createAudio
│   ├─ audio/                      AUDIO       sources.js validate.js loader.js mixer.js midi.js music.js zip.js userfiles.js cache.js
│   ├─ render/
│   │   ├─ index.js                RENDER      facade: createRenderer (the only render file the app imports, besides art/)
│   │   ├─ convert.js camera_math.js           RENDER   pure helpers (no three)
│   │   ├─ geom/extrude.js geom/deck.js        RENDER   pure geometry builders -> MeshData (no three)
│   │   └─ art/                    ART         index.js rng.js mapping.js palette.js lamps.js floor.js deck.js panel.js misc.js
│   └─ ui/                         UI          index.js storage.js dotfont.js textlayout.js format.js keylabels.js panel.js menus.js dialogs.js overlay.js
└─ tests/
    ├─ arch_manifest.mjs  arch.test.mjs        INTEGRATOR  file/export/layering conformance (this file's machine-readable twin)
    ├─ helpers/                                INTEGRATOR  seeded_rand.mjs fake_canvas.mjs fake_physics.mjs
    └─ <role>.test.mjs                         each role (data, physics, lamps, rules, render, art, ui, audio, integration)
```

### 1.1 Ownership table (every contracted file has exactly ONE owner)

| path | owner | what it is |
|---|---|---|
| `ARCHITECTURE.md` | ARCHITECT | this contract (frozen) |
| `index.html` | INTEGRATOR | skeleton, import map, mount points (Appendix B) |
| `package.json` | INTEGRATOR | ES-module marker, `npm test`, no dependencies |
| `README.md` | INTEGRATOR | run/test instructions |
| `css/style.css` | INTEGRATOR | page layout + stage geometry |
| `css/ui.css` | UI | all UI styling |
| `sounds/README.txt` | AUDIO | explains the optional drop-in folder |
| `tools/gen_data.mjs` | DATA | optional dev-time data generator (never imported by the app) |
| `src/types.js` | INTEGRATOR | typedefs for every contract object |
| `src/main.js` | INTEGRATOR | browser wiring |
| `src/game.js` | INTEGRATOR | `createGame` headless composition |
| `src/input.js` | INTEGRATOR | `createInput`, `createCheatMatcher`, `CHEAT_WORDS` |
| `src/data/index.js` | DATA | barrel re-exporting every data module |
| `src/data/freeze.js` | DATA | `deepFreeze` |
| `src/data/constants.js` | DATA | `TABLE PHYS MASKS Z CAMERA PANEL DEFAULT_KEYS NAMES TIMING projectToTablePx unprojectFloor` |
| `src/data/events.js` | DATA | `EV`, `EVENT_TYPES` (physics event type names) |
| `src/data/heights.js` | DATA | `HEIGHTS` (SPEC 3.6) |
| `src/data/materials.js` | DATA | `DEFAULT_MATERIAL DEFAULT_KICKER MATERIALS KICKERS` |
| `src/data/scoring.js` | DATA | `SCORE MULTIPLIERS POTS acceptScoreFor` |
| `src/data/text.js` | DATA | `APP_TITLE fmt INFO MISSION_TEXT RANK_NAMES MISSION_NAMES` |
| `src/data/names.js` | DATA | `COMPONENT_NAMES BANKS LAMP_NAMES LAMP_GROUP_NAMES FUEL_BARGRAPH_NAME ALL_LAMPS_GROUP_NAME` |
| `src/data/sounds.js` | DATA | sound manifest, keys, event map, sources, durations |
| `src/data/walls.js` | DATA | `WALLS POSTS TABLE_OUTLINE` |
| `src/data/components.js` | DATA | `FLIPPERS PLUNGER BUMPERS ... DEMO_TIMERS getComponent` |
| `src/data/ramps.js` | DATA | `RAMPS DECK_FLOOR_POLY RAMP_FOOTPRINT_POLY` |
| `src/data/lamps.js` | DATA | `LAMPS LAMP_BY_NAME LAMP_GROUPS FUEL_BARGRAPH LAMP_HOOK_NAMES LAMP_FLASH_*` |
| `src/data/missions.js` | DATA | `MISSION_STATE MISSIONS MISSION_SELECT rankGroupOf missionForRank` |
| `src/physics.js` | PHYSICS | `createPhysics` facade |
| `src/physics/edges.js` | PHYSICS | edge construction, ray casts, wall installer |
| `src/physics/collision.js` | PHYSICS | `basicCollision`, `throwBall` |
| `src/physics/snapshot.js` | PHYSICS | `createSnapshot` (idle snapshot builder; real) |
| `src/lamps.js` | LAMPS | `createLamps` facade |
| `src/lamps/wheel.js` | LAMPS | integer-ms `TimerWheel` |
| `src/lamps/lamp.js` | LAMPS | `Lamp` (TLight) |
| `src/lamps/group.js` | LAMPS | `LightGroup` (TLightGroup) |
| `src/lamps/bargraph.js` | LAMPS | `LightBargraph` (fuel gauge) |
| `src/rules.js` | RULES | `createRules` facade |
| `src/rules/scheduler.js` | RULES | seconds-based `Scheduler` |
| `src/rules/textbox.js` | RULES | `TextBoxQueue` |
| `src/rules/highscores.js` | RULES | `HighScoreTable` |
| `src/audio.js` | AUDIO | `createAudio` facade |
| `src/audio/sources.js` | AUDIO | `candidateUrls` (source policy) |
| `src/audio/validate.js` | AUDIO | `validateBytes` (size + SHA-1) |
| `src/audio/loader.js` | AUDIO | `loadSounds` (network layer, pure) |
| `src/audio/mixer.js` | AUDIO | `Mixer` voice pool |
| `src/audio/midi.js` | AUDIO | `parseMidi` |
| `src/audio/music.js` | AUDIO | `createMusic` built-in synth |
| `src/audio/zip.js` | AUDIO | `readZip` (no third-party lib) |
| `src/audio/userfiles.js` | AUDIO | `pickSoundFiles` |
| `src/audio/cache.js` | AUDIO | `createCache` (optional IndexedDB) |
| `src/render/index.js` | RENDER | `createRenderer` facade (imports `three`) |
| `src/render/convert.js` | RENDER | `t2v v2t angleToRotY` |
| `src/render/camera_math.js` | RENDER | `viewOffsetFor projectPoint` |
| `src/render/geom/extrude.js` | RENDER | `polygonArea extrudePolygon` |
| `src/render/geom/deck.js` | RENDER | `deckHeightAt buildDeckMesh` |
| `src/render/art/index.js` | ART | `paintAll` |
| `src/render/art/rng.js` | ART | `mulberry32` |
| `src/render/art/mapping.js` | ART | `FLOOR_RECT patchPx pxToTable patchUV patchScale` |
| `src/render/art/palette.js` | ART | `PALETTE BUMPER_RING_COLORS bumperRingColor` |
| `src/render/art/lamps.js` | ART | `drawLampShape buildLampAtlas` |
| `src/render/art/floor.js` | ART | `paintFloor` |
| `src/render/art/deck.js` | ART | `paintDeck` |
| `src/render/art/panel.js` | ART | `paintPanel` |
| `src/render/art/misc.js` | ART | `paintMisc` |
| `src/ui/index.js` | UI | `createUI` facade |
| `src/ui/storage.js` | UI | `createStore DEFAULT_OPTIONS STORAGE_KEYS` |
| `src/ui/dotfont.js` | UI | `GLYPHS glyphFor drawDotText` |
| `src/ui/textlayout.js` | UI | `wrapText` |
| `src/ui/format.js` | UI | `formatScore formatHighScore` |
| `src/ui/keylabels.js` | UI | `keyLabel` |
| `src/ui/panel.js` | UI | `createPanel` |
| `src/ui/menus.js` | UI | `createMenus` |
| `src/ui/dialogs.js` | UI | `createDialogs` |
| `src/ui/overlay.js` | UI | `createStartOverlay` |
| `tests/arch_manifest.mjs`, `tests/arch.test.mjs` | INTEGRATOR | conformance guard |
| `tests/helpers/seeded_rand.mjs` | INTEGRATOR | `mulberry32 constantRand sequenceRand` |
| `tests/helpers/fake_canvas.mjs` | INTEGRATOR | recording `CanvasLike` (`createFakeCanvas createFakeCanvasFactory opsDigest CANVAS_API`) |
| `tests/helpers/fake_physics.mjs` | INTEGRATOR | recording Physics double for RULES tests |
| `tests/<role>.test.mjs` | the role | that role's tests (section 13) |

### 1.2 Directory ownership by prefix (for files you add)

`src/data/**`, `tools/**` DATA | `src/physics*` PHYSICS | `src/lamps*` LAMPS | `src/rules*` RULES | `src/render/art/**` ART | `src/render/**` (rest)
RENDER | `src/ui/**`, `css/ui.css` UI | `src/audio*`, `sounds/**` AUDIO | everything else at the root of `src/`, `index.html`, `css/style.css`,
`package.json`, `README.md`, `tests/helpers/**`, `tests/arch*`, `tests/integration*` INTEGRATOR. A new file needs an `OWNER:` header and an
appended entry in `tests/arch_manifest.mjs`; the layering test (2.1) checks every file under `src/` and `tools/` whether listed or not.

---

## 2. Modules, layering and call graph

### 2.1 Layering (enforced by `tests/arch.test.mjs`, rules in `tests/arch_manifest.mjs` IMPORT_RULES)

```
                       main.js  (may import anything)
        ┌────────────────┬──────────────┬────────────┬─────────────┬────────────┐
     game.js           input.js       render/      ui/          audio.js     (art: render/art/)
   ┌─────┼──────┐          │          (+three)       │           audio/
physics  lamps  rules      │             │           │              │
 .js      .js    .js       │             │           │              │
   │       │      │       └─────────────┴───────────┴──────────────┘
   └───────┴──────┴──────────────────►  src/data/**   (leaf: imports only src/data/)
```

| importer | may import |
|---|---|
| `src/data/**` | `src/data/**` only |
| `src/physics.js`, `src/physics/**` | `src/data/**`, `src/physics*` |
| `src/lamps.js`, `src/lamps/**` | `src/data/**`, `src/lamps*` |
| `src/rules.js`, `src/rules/**` | `src/data/**`, `src/rules*` - **never physics or lamps** (they arrive by injection in `createRules`) |
| `src/audio.js`, `src/audio/**` | `src/data/**`, `src/audio*` |
| `src/render/art/**` | `src/data/**`, `src/render/art/**` |
| `src/render/**` (not art) | `src/data/**`, `src/render/**`, `three`, and from art ONLY `mapping.js`, `palette.js`, `rng.js` |
| `src/ui/**` | `src/data/**`, `src/ui/**` - never rules/physics/lamps/render/audio (it only sees `RulesView`, `AudioStatus`, `Options`) |
| `src/game.js` | `src/data/**`, `src/physics.js`, `src/lamps.js`, `src/rules.js` |
| `src/input.js` | `src/data/**` |
| `src/main.js`, `tools/**` | anything |
| tests | anything |

No cycles. No module-level side effects (except `main.js`). `three` is imported only by RENDER modules that are not marked pure; pure
RENDER helpers (`convert.js`, `camera_math.js`, `geom/**`) never import it so they stay Node-testable.

### 2.2 Factories (the whole public surface of the app)

| factory | file | called by | returns |
|---|---|---|---|
| `createPhysics({rand?, data?})` | `src/physics.js` | `game.js` | `Physics` |
| `createLamps({rand?, data?})` | `src/lamps.js` | `game.js` | `Lamps` |
| `createRules({physics, lamps, sound?, rand?, highScores?, data?})` | `src/rules.js` | `game.js` | `Rules` |
| `createGame({sound?, rand?, data?, highScores?, factories?})` | `src/game.js` | `main.js`, tests | `Game` (`factories` = test seam to inject spies for the step order) |
| `paintAll(data, {createCanvas, seed?, quality?})` | `src/render/art/index.js` | `main.js` | `ArtPack` |
| `createRenderer({data, art, canvas?, quality?})` | `src/render/index.js` | `main.js` | `Renderer` |
| `createUI({root, store, actions, panelArt, options, bindings, onDialogChange?})` | `src/ui/index.js` | `main.js` | `UI` |
| `createStore(storage?)` | `src/ui/storage.js` | `main.js` | `Store` |
| `createAudio({fetch?, AudioContext?, sha1?, data?})` | `src/audio.js` | `main.js` | `Audio` (also a `SoundPort`) |
| `createInput({onEvent, target?, bindings?})` | `src/input.js` | `main.js` | `Input` |

Typedefs of every returned object are in `src/types.js` (`Physics`, `Lamps`, `Rules`, `Game`, `ArtPack`, `Renderer`, `UI`, `Store`, `Audio`,
`Input`, `UIActions`, `RulesView`, `PhysicsSnapshot`, `PhysicsEvent`, `LampsView`, `RenderFrame`, `Options`, `Bindings`, `AudioStatus`, ...).
The signatures are repeated in the section of the owning role below.

### 2.3 Who calls whom at run time (complete)

| caller | calls |
|---|---|
| `game.step()` | `physics.step`, `physics.drainEvents`, `rules.onPhysicsEvents`, `rules.tick`, `lamps.advance` |
| `game.buildRenderFrame` | `physics.snapshot`, `lamps.fillView`, `rules.getView` |
| `rules` | `physics.*` commands (5.4), `lamps.*` verbs (6.2), `sound.play(key)`, own `Scheduler`/`TextBoxQueue`/`HighScoreTable` |
| `lamps` | only its own hooks (`onLampTimer`, group `onNotifyExpired`, bargraph `setHooks`) registered by rules; calls nobody else |
| `physics` | nobody (pure producer: events + snapshot) |
| `main.js` | `input` events -> `rules.input/cheat/debugKey`, `actions` (UI) -> `rules/audio/renderer/input/store`, `game.advance`, `audio.update`, `renderer.render`, `ui.update` |
| `ui` | `actions.*` only (callbacks supplied by `main.js`), `store.*` |
| `renderer` | nobody (reads the `RenderFrame` it is given) |
| `audio` | nobody (`play(key)` is called by `rules` and returns a duration) |

---

## 3. Data contracts (`src/data/**`, owner DATA)

### 3.1 General rules

* Every export is **deep-frozen** (`deepFreeze`, `src/data/freeze.js`), JSON-like (numbers, strings, booleans, arrays, plain objects; the only
  functions are the documented helpers). Points are arrays `[x, y]` (never `{x,y}`). **T-frame everywhere** (section 0.5), units = table units,
  seconds, radians.
* Import style: `import * as data from './data/index.js'` (the barrel; passed around as `opts.data`, typedef `DataModule`) or a named import from
  the specific file. `export *` name clashes silently drop a name: **export names must be unique across all data files** (arch test checks).
* Shapes are the typedefs in `src/types.js` (`WallDef`, `PostDef`, `FlipperDef`, ..., `LampDef`, `MissionDef`, `PlainEdge`). A def is a plain
  object whose first key group is `name`, `group` (DAT group number), geometry, `mask`, `material`, `kicker`.
* **Resolved, not referenced**: `material` is `{smoothness, elasticity}`, `kicker` is `{threshold, boost, throwMult?, throwDir?, throwAngle?}`
  (already looked up through the DAT attributes; `MATERIALS`/`KICKERS` keyed by DAT group exist for tests). Defaults (no attr): material
  `0.95/0.6`, kicker `threshold 8.9999999e10, boost 0`.
* **Pre-inflated edges ship in the data.** Every collidable def carries `edges: PlainEdge[]` exactly as in `research/physics_data.json`
  (rounded to 6 decimals, same order, same `role`/`gate` tags). PHYSICS reads **only** `edges` at run time; the raw geometry (`pts`, `poly`,
  `c`, `r`, ...) is for RENDER/ART/RULES. PHYSICS still implements `installWall/installLine/installCircle` (4.2) and a test proves it reproduces
  the shipped edges to 1e-4 (that is the cross-check that the data is right).
* Generation: DATA may write the big geometry modules by hand or with `tools/gen_data.mjs` (dev-time; reads `research/*.json` and the SPEC
  tables, emits static modules that are **committed**). The browser and Node tests never read `research/` (only DATA's own tests may, via `fs`).
* Counts below are asserted by `tests/data.test.mjs`.

### 3.2 Seeded modules (already real - DATA verifies against the SPEC and may ADD exports, never rename/remove)

| file | exports | notes |
|---|---|---|
| `freeze.js` | `deepFreeze(o)` | |
| `constants.js` | `TABLE PHYS MASKS Z CAMERA PANEL DEFAULT_KEYS NAMES TIMING projectToTablePx unprojectFloor` | SPEC 1.1-1.7, 4.1, 5.12, 6.1. `PHYS.dt = 1/120`, `PHYS.gravity = [3.916845e-6, 11.985638]`, `PHYS.tableOutline`, `PHYS.outlineKicker = {threshold 5, boost 15}`. `TIMING` holds every timer of SPEC 5.12 in seconds. `NAMES` maps ids to names (`NAMES.kickout[1] === 'a_kout1'`). |
| `events.js` | `EV`, `EVENT_TYPES` | physics event type strings (5.3) |
| `heights.js` | `HEIGHTS` | SPEC 3.6 visual heights (RENDER/ART only) |
| `materials.js` | `DEFAULT_MATERIAL DEFAULT_KICKER MATERIALS KICKERS` | SPEC 2.2 keyed by DAT group |
| `scoring.js` | `SCORE MULTIPLIERS POTS acceptScoreFor` | SPEC 5.1/5.3 raw point values |
| `text.js` | `APP_TITLE fmt INFO MISSION_TEXT RANK_NAMES MISSION_NAMES` | SPEC 5.11 strings; `fmt(template, ...args)` expands `%ld %d %s`; plain decimals, never thousands separators |
| `names.js` | `COMPONENT_NAMES BANKS LAMP_NAMES LAMP_GROUP_NAMES FUEL_BARGRAPH_NAME ALL_LAMPS_GROUP_NAME` | the canonical name lists (keys of snapshots/views) |
| `sounds.js` | `SOUND_FILES MUSIC_FILE NEVER_FETCH SOUND_KEYS SOUND_EVENT_MAP SOUND_SOURCES fileNameOf soundDuration SILENT_SOUND` | see 3.8 |
| `missions.js` (partly) | `MISSION_STATE MISSION_SELECT rankGroupOf missionForRank` | `MISSIONS` is for DATA to fill (3.9) |
| `lamps.js` (partly) | `LAMP_GROUPS FUEL_BARGRAPH LAMP_HOOK_NAMES LAMP_FLASH_DEFAULT LAMP_FLASH_OVERRIDES` | `LAMPS` + `LAMP_BY_NAME` are for DATA to fill (3.6) |

### 3.3 Geometry modules DATA must fill

All counts, sources and derivations (physics_data = `research/physics_data.json`, SPEC refs in brackets):

| export | count | def type | source / derivation |
|---|---|---|---|
| `WALLS` | 45 | `WallDef` | polygons of SPEC 3.2 / App. B.1 + shells 103/106 + `v_rebo1-4` (469-472). `name`: DAT name if it has one (`v_rebo1`..) else `wall_<group>`. `pts` = DAT order without the closing duplicate. `mask` from `collision_mask`. `solid`: `'island'` when shoelace S>0 else `'shell'` (only groups 103 and 106). `kicker`: rebounders `{threshold 1, boost 18}`, others `null`. `material`: group 95 -> `0.8/0.5`, 97 -> `0.9/0.5` (329, 330, 331-336, 103, 106), rebounders default `0.95/0.6`. `top` per SPEC 3.2 (0.85 walls, 0.6 slingshot rubbers/rebounders, 0.5 wormhole rubbers, 1.6/1.77 deck walls, `null` for shells). `lamp`: `'lite84'` for `v_rebo1`, `'lite85'` for `v_rebo2`, else `null`. `edges`: physics_data `edges` of the same id, verbatim. |
| `POSTS` | 19 | `PostDef` | circles of SPEC 3.3 (groups 310-328); `name = 'post_<group>'`; `edges` = one circle `r + 0.3` |
| `TABLE_OUTLINE` | 1 | `{pts, material, kicker, mask:1, edges}` | the four UN-inflated backstop lines. **Orientation trap:** with `n = (dy,-dx)/len` the listed vertex order `(8,15),(-8,15),(-8,-14),(8,-14)` gives *outward* normals; emit each line **reversed** (as `physics_ref_sim.py` does) so `(nx,ny)` points INTO the table. Material `0.95/0.6`, kicker `{5, 15}`. |
| `FLIPPERS` | 2 | `FlipperDef` | `[a_flip1 (LEFT, +x), a_flip2 (RIGHT)]`, SPEC 2.3; `angleMax +1.21523 / -1.214923`; `extendSeconds 0.04`, `retractSeconds 0.08`, `collisionMult 0.9`, material `0.5/0.75`; no `edges` (dynamic) |
| `PLUNGER` | 1 | `PlungerDef` | SPEC 2.4: `face [[-8.002954,11.974978],[-6.384019,11.974978]]`, `feed [-7.020939,10.084854]`, material `0.5/0.5`, `maxBoost 100`, `tickSeconds 0.025`, `feedDelay 0.96`; `edges` = the line at `y = 11.674978` normal `(0,-1)` |
| `BUMPERS` | 7 | `BumperDef` | SPEC 2.5. `kind` attack (1-4, `r 0.35`, kicker `{2.5, 17}`) / launch (5-7, `r 0.25`, kicker `{2.5, 12}`, mask 4); `hitSeconds 0.1` |
| `POPUP_TARGETS` | 9 | `PopupTargetDef` | SPEC 2.17: `poly` raw polygon, `center`, `bank` `'booster'\|'medal'\|'multiplier'` (a_targ1-3 / 4-6 / 7-9), `index` 0..2, kicker `{3, 5}`, `repopSeconds 0.25`, `top 0.70` |
| `SOLO_TARGETS` | 13 | `SoloTargetDef` | SPEC 2.18 (a_targ10-22): `bankKind` fuel / mission / leftHazard / rightHazard / wormhole, `index`, `lamp` (`'lite70'` ...), kicker `{3, 5}`, `rearmSeconds 0.1`, `top` per target |
| `KICKBACKS` | 2 | `KickbackDef` | SPEC 2.7: `line` un-inflated, `gate` name, material `0.7/0.2`, kicker `{threshold 0 (armed value), boost 55}`, `armSeconds 0.7`, `tickSeconds 0.1` |
| `GATES` | 2 | `GateDef` | SPEC 2.7 (`v_gate1` lamps `['lite30','lite196']`, `v_gate2` `['lite29','lite195']`) |
| `BLOCKER` | 1 | `BlockerDef` | `v_bloc1` centre `(0.000002, 13.25)` `r 0.175`, `lamp 'lite1'` |
| `DRAIN` | 1 | `DrainDef` | `line [[-10.391989,14.437246],[10.32141,14.437246]]`, `delaySeconds 1.82`; `edges` at `y = 14.137246` normal `(0,-1)` |
| `KICKOUTS` | 3 | `KickoutDef` | SPEC 2.9. `fieldRadius` = attr-600 radius (3.2 / 0.412526 / 0.412526), `pull` (30/32/32), `captureFactor`, `captureRadius = captureFactor * fieldRadius`, `startsActive` (false/true/true), `rearms` (false/true/true), `throwDir`, `boost` 45/35/35, `throwMult 5`, `angleMult 1.256637/0/0`, `heldZ 0.3/0/0`, `defaultHold 1.5` (a_kout1: 2.404 = SW7 duration), `edges` = capture circle |
| `SINKS` | 4 | `SinkDef` | SPEC 2.10: `line` un-inflated, `reemit` (attr 601 x,y), `throwDir` 2-vector, `boost 35`, `throwMult 5`, `holdSeconds 2`, `color` `'red'\|'green'\|'yellow'\|null` (sink1/2/3/7) |
| `RAMP_HOLE` | 1 | `HoleDef` | SPEC 2.11: `c (5.870174,7.607636)`, `fieldRadius 0.325772`, `pull 10`, `captureFactor 0.1`, `captureRadius 0.0325772`, `releaseZ 0.325772`, `releaseMask 1`, `holdSeconds 0.5`, `mask 4` |
| `ONEWAYS` | 9 | `OnewayDef` | SPEC 2.13: `p0,p1` DAT order, `normal = (dy,-dx)/len`, flags `visible/scripted/sideSound`, material `0.9/0.8`, `edges` = `[wall (role 'wall'), trigger (role 'passthrough')]` from physics_data |
| `TRIPWIRES` | 5 | `TripwireDef` | SPEC 2.14 (`lamp` = skill-shot lamp `lite68, lite69, lite131, lite132, lite133`) |
| `ROLLOVERS` | 18 | `RolloverDef` | 17 plain + `a_roll9` (`light:true`, `spriteSeconds 0.15`); `entry` = attr-600 polygon (SPEC App. B.2), `exit` = reversed copy, `lamp` per SPEC 2.15 (`null` where the lamp is a script matter), `edges` = physics_data (entry edges `gate:'active'`, exit edges `gate:'rolloverflag'`) |
| `FLAGS` | 2 | `FlagDef` | SPEC 2.16 (`maxSpeed 50000, minSpeed 5, decay 0.65`, lamps `lite19`/`lite20`) |
| `DEMO_TRIGGERS` | 5 | `DemoTriggerDef` | SPEC 2.19 ids 1400-1404 (`shape` line/triangle, `pts` as listed, `action`) |
| `DEMO_TIMERS` | 1 | `{t1,t2,u1,u2}` | `0.2, 0.1, 0.4, 0.2` |
| `RAMPS.ramp` | 1 | `RampDef` | SPEC 3.5.1: 18 planes (`v`, `offset [a,b,c]`, `g1`, `g2`, `force = 25*sin(g1)*(cos g2, sin g2)`), SNAPPED seams (`enter`, `enterUpper`, `exit`, `exitUpper`, `line1`), `zOffsetFlag 0`, `fieldMult 0.2`, `mask 2` |
| `RAMPS.tube` | 1 | `RampDef` | SPEC 3.5.3: 2 planes (offset `[0,0,-5]`, `g1 0`, `g2 pi/2`), `enter` (mouth, mask 1->2), `exit` (mouth reversed, 2->1), `exitFar` (`(-3.751826,-10.333077)->(-3.045506,-10.781628)`, 2->1), `zOffsetFlag 1` |
| `DECK_FLOOR_POLY`, `RAMP_FOOTPRINT_POLY` | 2 | `Pt[]` | SPEC 3.5.2 polygons, verbatim |
| `getComponent(name)` | fn | | `{kind, def}` across FLIPPERS..FLAGS (not walls/posts), else `null` |

Kicker translation from physics_data: key `"401"` -> `threshold`, `"402"` -> `boost`, `"403"` -> `throwMult`, `"405"` -> `throwAngle`, `dir` -> `throwDir`;
`"406"` (a sound id) is dropped. Missing `"401"` -> `8.9999999e10`. A kickback's kicker is the ARMED value `{threshold: 0, boost: 55}`.

### 3.4 Masks, layers, materials, kickers

`MASKS = {PLAYFIELD:1, RAMP:2, DECK:4, SHELL103:6}`; `mask` of every def = the bit field of SPEC 1.5 / E6 (`602 n` is a BIT INDEX: `a_bump5-7`,
`ramp_hole`, `a_roll110-112`, walls 306-309, posts 326-328, `s_onewy12` are mask 4; ramp surface and tube are mask 2; shell 103 is 6).
`Z = {floor 0, ball 0.3, deck 1.068, ballOnDeck 1.368, tubeBall -4.7, holeRelease 0.325772}`.

### 3.5 Heights (`HEIGHTS`)

Seeded from SPEC 3.6 (visual only, [E]). RENDER and ART are the only readers.

### 3.6 Lamps (`src/data/lamps.js`)

`LAMPS` = 140 `LampDef`, in `LAMP_NAMES` order; `LAMP_BY_NAME[name]`. Derivation:

* `pos`: SPEC Appendix A compact JSON (the **spec overrides** `lamp_positions.json`; `lite2/3/4/306/307` are the moved ones). `lite192` -> `pos: null`.
  For raised lamps (`lite5/6/7`, z 0.5) apply the SPEC 8 formula `x' = x0*(21-z)/21`, `y' = 13.5 + (y0-13.5)*(21-z)/21` so `pos` is where the
  overlay sits **at height `z`**.
* `z`: `0.01` for floor lamps; `1.078` for lamps whose `(x,y)` lies inside `DECK_FLOOR_POLY` (point-in-polygon test; expected: `lite54 lite55 lite56 lite169
  lite170 lite171 lite198 lite316 lite317` - DATA lists the exact result in a comment; the fuel lamps `literoll179-184` sit in the floor channel and stay at
  `0.01`); `0.5` for the raised wormhole rim lamps `lite5/6/7`. ART paints the unlit inset of z >= 1 lamps into `ArtPack.deck`, all others into `ArtPack.floor`.
* `tier`, `sprite`, `role`: Appendix A columns. `group`/`groupIndex`: `LAMP_GROUPS` / `FUEL_BARGRAPH` membership (`null` when ungrouped).
* `shape`, `rot`, `size`, `colors`, `nStates`: DATA's visual decisions from SPEC 6.8 / App. A colour families: `size` = sprite px converted to table units with
  the local projection scale (`|D|/z1` px per unit horizontally), clamped to `[0.3, 1.3]`; `colors[i] = {unlit, lit}` CSS hex (one per ON image;
  `lite2/3/4` have 3: yellow, green, red); fuel bars per SPEC 5.5 colours; rings blue (outer) / orange (middle); wormhole rims red/green/yellow.
* `flash`: `LAMP_FLASH_OVERRIDES[name] ?? LAMP_FLASH_DEFAULT`.
* `nStates`: 3 for `lite2/3/4`, else 1.

### 3.7 Text

Seeded (`INFO`, `MISSION_TEXT`, `RANK_NAMES`, `MISSION_NAMES`, `APP_TITLE`). Exact English of SPEC 5.11; `\n` = line break; numbers via `fmt`.

### 3.8 Sounds (`src/data/sounds.js`, seeded and cross-checked)

* `SOUND_FILES[SOUNDnn] = {bytes, sha1, timer}`: 41 files, 528,396 bytes, `timer = bytes/11000` (SPEC 7.4). All 41 SHA-1 values were verified against the
  independent `installer/assets/software/Pinball/checksum.sha1` of the space-cadet-pinball installer repo.
* `SOUND_KEYS[key] = {file, missing?}`; `file === null` -> the original had no file (GAME_OVER, PLUNGER_PULL, SW37, SW44, SW52, SW59): silent, duration `-1`.
* `soundDuration(key)` and `SILENT_SOUND` (a `SoundPort` that returns the true durations without playing) are the default sound for rules and all headless tests.
* `SOUND_EVENT_MAP`: DAT-bound sounds triggered by physics events (matching rule in the file header); script sounds (`SW*`) are played by RULES directly.
* `SOUND_SOURCES`: `local` (`./sounds/<NAME>`, tries upper-case then lower-case spelling), `S1`, `S5`; `music:false` on S5. `NEVER_FETCH` lists names that must
  never be requested. `MUSIC_FILE` = `PINBALL.MID`.

### 3.9 Scoring and missions

* `SCORE`, `MULTIPLIERS`, `POTS` seeded (raw point values; the field multiplier is applied only inside RULES' `addScore`).
* `MISSIONS[id]` (ids 2..18, `MissionDef`): `name`, `counter` (8, 3, 3, 9, -, 15, ..., see SPEC 5.7.3/5.7.4), `accept` (10,000 / 20,000 / 30,000), `reward`, `rankPts`,
  `doneText` (a key of `MISSION_TEXT`), `states` (e.g. Alien Menace `[10, 20]`, Cosmic Plague `[15, 21]`, Secret `[16, 22, 23]`, Time Warp `[17, 24]`,
  Maelstrom `[18, 25..31]`). Time Warp `rankPts` is `12` (forward) - RULES handles the backward case.
* `MISSION_STATE` (names -> `field(lite198)` ids), `MISSION_SELECT`, `rankGroupOf(rank)`, `missionForRank(rank, level)` are seeded and exact.

### 3.10 Data tests (`tests/data.test.mjs`, DATA)

Counts of 3.3; `LAMPS.length === 140` and `LAMPS.map(l => l.name)` equals `LAMP_NAMES`; all group members exist; fuel `durations` sum to 72; every wall's `solid`
agrees with its shoelace sign; ONEWAYS normals equal SPEC 2.13 (±5e-4) and are unit length; ramp plane `force` equals `25 sin(g1)(cos g2, sin g2)` (±1e-3) and
plane heights at the vertices equal the SPEC 3.5.1 table (±2e-3); **every `edges` array equals `research/physics_data.json` for the same id (1e-6)**; outline
lines point inward; projection checkpoints of App. D #1 (`projectToTablePx(2.4888,12.0631) -> (132.6,384.3)` ±0.1, plunger rest `(319.5,343.4)`, the four corners of SPEC 1.3,
and `unprojectFloor` round trips); sounds (41 files, byte total 528396, 40-hex SHA-1, `timer === bytes/11000` ±1e-6, every non-null key file exists, no file is unused,
`NEVER_FETCH` disjoint); every `fmt`/INFO/MISSION string has no thousands separator; `getComponent` resolves every name of `COMPONENT_NAMES`; deep-frozen (mutation throws in strict mode).

---

## 4. Physics module (`src/physics.js` + `src/physics/**`, owner PHYSICS)

Implements SPEC section 4 **literally** (ray-cast model, original constants) plus the component list of SPEC section 2. Pure Node module: imports only
`src/data/**`. It never scores, never plays sounds, never touches lamps. Its only outputs are the event queue and the snapshot.

### 4.1 Construction and state

```js
/** @param {{rand?: () => number, data?: DataModule}} [opts]  @returns {Physics} */
export function createPhysics(opts = {}) {}
```

* `rand` defaults to `Math.random`. Tests inject `constantRand(0.5)` (no lateral jitter) or `mulberry32(seed)`. `data` defaults to the real barrel; tests may pass
  `{ ...data, WALLS: [], POSTS: [] }` style overrides, so read every table through `opts.data`, never through a direct import of the data files.
* After creation the table is in the state of `resetTable()`: no balls, empty event queue, time 0; flippers at rest and enabled; plunger at rest; both gates ENABLED (solid);
  centre post down; `a_kout1` inactive, `a_kout2`/`a_kout3` active; all nine drop targets up; solo targets armed; kickbacks idle; sinks and ramp hole empty;
  demo triggers OFF; tilt lock off; nudge counter 0. (The *rules* open the gates, enable the post etc. as the game requires.)
* Physics time advances only through `step(dt)`; every physics timer counts physics seconds. `dt` defaults to `PHYS.dt` (1/120); values above `0.1` are clamped.

### 4.2 Edges (`src/physics/edges.js`) - stable internals other tests may rely on

```js
export const NO_HIT = 1e9;
makeLine(x0,y0,x1,y1, mask, owner, role='wall') -> Edge      // {k:'line', x0,y0, dx,dy (unit), nx,ny = (dy,-dx), lo,hi, useX, mask, owner, role, active:true}
makeCircle(cx,cy,r, mask, owner, role='wall') -> Edge        // {k:'circle', cx,cy,r,rsq, mask, owner, role, active:true}
edgesFromPlain(plainEdges, mask, owner) -> Edge[]            // PlainEdge[] (data) -> runtime Edge[]; keeps role/gate
rayLine(edge, ox,oy, dx,dy, maxDist) -> number               // SPEC 4.6: hit iff dot(dir,n) < 0 && -0.002 <= t <= maxDist && hit point inside [lo,hi]; else NO_HIT
rayCircle(edge, ox,oy, dx,dy, maxDist) -> number             // SPEC 4.6 (two-sided from outside; origin inside returns tca - sqrt(..) <= 0)
installWall(pts, offset) -> PlainEdge[]                      // closed polygon, DAT order, closing duplicate removed, per vertex [corner circle (if cross sign == sign(offset)), line]
installLine(p0, p1, offset) -> PlainEdge[]                   // code 2: one line shifted by offset along its normal
installCircle(c, r, offset) -> PlainEdge[]                   // code 1: circle radius r + offset
```

`installWall(WALLS[i].pts, 0.3)` must equal `WALLS[i].edges` (1e-4, same order) for every inflated wall; `installLine/installCircle` likewise for the
line/circle components. `offset = 0` for rollovers, flag spinners, demo triggers and ramp seams; `offset = +0.3` (the ball radius) for everything else, **including tripwires** (SPEC 2.14).

### 4.3 Update loop and collision handlers

Exactly SPEC 4.3 (`update`, `advanceBall`), 4.4 (forces), 4.5 (already-hit list), 4.7 (`basicCollision`, tilt rule), 4.8 (flippers), 4.9.1-4.9.15 (components),
4.10 (layers/ramps), 4.11 (nudge/tilt), 4.12 (stuck balls). `src/physics/collision.js`:

```js
basicCollision(ball, hx, hy, nx, ny, e, s, T, B) -> number   // returns `rebound` (normal speed before the bounce); SPEC 4.7.1 verbatim
throwBall(ball, dx, dy, angleMult, m1, m2, rand, exactBug = true)   // SPEC 4.9.6, uses PHYS.exactThrowBug by default at the call sites
```

Implementation notes that the SPEC leaves to you (decisions, do not deviate):

* **Order inside `step`:** (1) timers due (feed, kickback, hold releases, popup re-raise, nudge undo, plunger tick, ...) in due-time/insertion order; (2) forces + sub-stepped motion of all balls and flippers
  exactly as SPEC 4.3; (3) nudge counter; (4) snapshot refresh is lazy (done in `snapshot()`).
* **Event timing:** an event is queued at the moment it happens, with `t = physics.time` of that step; events keep their order within a step.
* **Tilt lock** (`setTiltLock(true)`): hard-hit thresholds become `1e9` (plain bounces, no hard-hit events), flippers retract and ignore input, `a_kout1/2/3` and the
  blocker deactivate, sinks drain the ball (`'drain'` with `via:'sinkTilt'`), the plunger fires at once at full power when a ball touches it, kickbacks kick at once, flag/rollover/tripwire/
  one-way triggers keep working but RULES ignores them while `tilted`. The lock also clears automatically when a ball is fed (`'plungerFed'`).
* **`kickoutSetHold` / `sinkSetRoute` are called from RULES inside the event handler**, i.e. after `step()` returned and before the next one, with zero simulated time elapsed since the capture,
  so "restart the hold timer with this duration from now" is exact.
* **Sink exit blocked:** if another ball is within `2R` of the exit when the timer fires, retry after 0.5 s (SPEC 4.9.7). **Feed blocked:** retry every 1.0 s (SPEC 4.9.14).
* **Ramp hole:** hold 0.5 s, then a fixed 0.5 s visual drop (ball `z` eases from its deck `z` to `0.325772`, `snapshot.rampHole.drop` 0..1), then release at the hole centre with `speed 0`,
  `mask 1`, event `'rampHoleReleased'`.
* **`relaunch()`** = feed (delay 0.96 s) + the plunger self-charges with tick `0.025/4` and releases at `Boost 100` (the launch gets `100 + rand*10`), emitting `plungerFed`, `plungerPull`, `plungerRelease`.
* **`launchInstant()`** = `Boost = 100` + release; returns `false` (and does nothing) when `ballAtPlunger()` is false.
* **`ballAtPlunger()`** = a free ball with `mask 1` exists with `|x - plunger.feed.x| < 0.4` and `y > 11.0`.
* **Nudge:** `nudge(dir, true)` applies `(dx*0.5, dy*0.5)` (`left` (+1.0,+0.5), `right` (-1.0,+0.5), `bottom` (0,+0.5), T-frame velocity change) to every active free ball, sets the nudge flag,
  sets `snapshot.shake` to `(+2,-1) / (-2,-1) / (0,-1)`, (re)starts the shared 0.4 s undo timer and emits `'nudge'`; `nudge(dir, false)` or the timer undoes the change, clears the flag and the shake.
  The counter follows SPEC 4.11 every step (`+= 4*dt` while the flag is set, else `max(0, count - dt)`); `'nudgeCount'` events are edge-triggered when the count rises above `0.5` (`'warn'`) and above `1.0`
  (`'tilt'`), re-armed when it falls below the threshold again. Feeding a ball sets the counter to `-2`.
* **Randomness (determinism contract):** `rand()` is called (a) exactly **once per free active ball per step** for the lateral jitter (`ax += -(0.5 - rand())*speed*0.2`), (b) twice per `throwBall`, (c) once per plunger
  release for the boost jitter, (d) in the stuck-ball re-throw. Nothing else. Same seed + same inputs => identical event stream (tested).
* **Performance budget:** one ball, full table, `step()` <= 0.3 ms on a laptop (Node 24); worst case with 3 balls <= 1 ms. Brute force over ~1150 edges per ray is acceptable; a 10x15 cell grid walked along the ray is allowed.

### 4.4 Files

`src/physics.js` (facade), `edges.js`, `collision.js`, `snapshot.js` are contracted. Add whatever else you need under `src/physics/` (suggested: `world.js` edge registry + nearest hit, `ball.js`, `flipper.js`,
`plunger.js`, `timers.js`, `components/*.js` per class). The facade must keep the exact `Physics` surface of `src/types.js` (also listed in 5.4).

---

## 5. Physics <-> Rules interface (SPEC 5.14, made exact)

### 5.1 Conventions

* Physics -> rules is a pull queue: `game.step()` calls `rules.onPhysicsEvents(physics.drainEvents())` right after `physics.step(dt)`. Events are plain objects `{type, t, ...payload}`; `type` strings are the
  values of `EV` (`src/data/events.js`). Rules switches on `event.type` and **must ignore unknown types** (additive changes only).
* Rules -> physics is a set of **synchronous commands** (5.4). They take effect immediately on physics state; their *physical consequences* (collisions, motion) happen in the following steps. Commands are only ever
  called between `step()` calls (from rules event handlers, rules timers, `rules.input`), never from inside `step`. Commands are idempotent where it makes sense (`gateSetEnabled(1, true)` twice is fine).
* Component names are the DAT names of `COMPONENT_NAMES`; ids are 1-based as in the DAT (`a_kout1` = 1, `v_sink7` = 7). Unknown names/ids throw `TypeError`.
* Physics never reads rules state; the only shared mutable fact is `isTiltLocked()` / `setTiltLock()`.

### 5.2 Snapshot (`physics.snapshot()` -> `PhysicsSnapshot`, types in `src/types.js`)

One stable object, **updated in place** on each call (RENDER must not keep references to inner arrays across frames; `balls` is reused). Every record has exactly the keys of the matching `COMPONENT_NAMES` list.

| field | meaning |
|---|---|
| `time` | physics seconds since creation |
| `tiltLocked`, `nudgeCount` | lock flag; current nudge counter (can be negative: grace) |
| `shake` | `{x,y}` image shift in original px at 365-px width (+x screen right, +y down): `(+2,-1)` after key X, `(-2,-1)` after `.`, `(0,-1)` after Up, `(0,0)` when the 0.4 s undo ran |
| `balls[]` | `{id,x,y,z,mask,visible,held,speed}`; `visible=false` for a ball inside the hidden tube (`mask 2 && z < 0`); balls captured by a sink are not listed; `z` is the ball CENTRE height (0.3 on the floor, 1.368 on the deck, plane+0.3 on the ramp) |
| `flippers.a_flip1/2` | `{angle, up}`: current T-frame angle (rad, CCW positive; left flipper 0..+1.21523, right 0..-1.214923) and whether the button is held (extended/extending) |
| `plunger` | `{pull 0..1 (Boost/100, eases back to 0 in 0.1 s after release), boost, charging, fired (true for 0.1 s after release)}` |
| `popups.a_targN` | `{up}` physical state (up = collidable) |
| `solos.a_targN` | `{flash}` 1 at a hard hit decaying linearly to 0 in 0.1 s |
| `bumpers.a_bumpN` | `{hit}` true for the 0.1 s hit frame |
| `rebounders.v_reboN` | `{flash}` true for 0.1 s after a hard hit |
| `kickbacks.a_kickN` | `{kicked, armed}`: `kicked` true from the kick until its final 0.1 s timer; `armed` true while the 0.7 s wait is over and a touch will kick |
| `gates.v_gateN` | `{enabled}` (solid and visible) |
| `blocker` | `{up}` |
| `flags.a_flagN` | `{frame 0..7, angle = frame*PI/4, spinning}` |
| `kickouts.a_koutN` | `{active, held}` |
| `sinks.v_sinkN` | `{occupied}` true during the hold |
| `rampHole` | `{occupied, drop 0..1}` |
| `rolloverSprites.a_roll9` | `{lit}` true 0.15 s after the exit crossing |

### 5.3 Events (physics -> rules)

`impact` = normal speed before the bounce (`basicCollision` return value). "tilt" = behaviour while `tiltLocked`.

| type | payload | emitted when | tilt | rules reaction (SPEC) |
|---|---|---|---|---|
| `bumperHit` | `name, impact` | hard hit on `a_bump1-7` (impact > 2.5) | never (T = 1e9) | score by bumper level, bumper sound, mission counters (5.4.1, 5.7) |
| `rebounderHit` | `name, impact` | hard hit on `v_rebo1-4` (impact > 1.0) | never | 500, REBOUNDER, decal lamps `lite84/85` 0.1 s, Time Warp counter |
| `popupHit` | `name` | `a_targ1-9` hard hit (> 3.0); the target went down | never | bank logic (5.4.4-5.4.6), POPUP_HIT |
| `popupUp` | `name` | the target physically re-raised (after `popupReenable`) | n/a | sounds for `a_targ4`, `a_targ7` |
| `soloHit` | `name, impact` | `a_targ10-22` hard hit (> 3.0), edges inactive 0.1 s | never | fuel/mission/hazard/wormhole logic |
| `rolloverEnter` | `name` | entry polygon of a rollover crossed while armed (also `a_roll9`) | emitted | lane logic, fuel, outlanes (5.4.8, 5.5, 5.6) - ignore while `tilted` |
| `tripwire` | `name` | `s_trip1-5` crossed against the normal | emitted | skill-shot lamps (5.2.3) - ignore while `tilted` |
| `oneway` | `name` | any `s_onewy*` trigger line crossed in the pass direction | emitted | scripts only for `s_onewy1`, `s_onewy4`, `s_onewy10` |
| `onewaySide` | `name, impact` | wall line of `s_onewy9/10` hit with impact > 0.2 | emitted | ONEWAY_SIDE sound only |
| `rampLine1` | - | a mask-4 ball crossed Line 1 | emitted | launch-ramp event (5.4.3) |
| `rampEnter` | `ramp` | mouth seam taken (`'ramp'` or `'s_ramp9'`) | emitted | informational |
| `rampExit` | `ramp, mask` | exit seam taken; `mask` = ball mask after | emitted | informational |
| `rampHoleCaptured` | - | ball captured by `ramp_hole` | emitted | informational |
| `rampHoleReleased` | - | ball dropped onto the floor | emitted | `lite54` flashes 5 s (5.4.3) |
| `kickoutCapture` | `id` | ball captured by `a_kout1/2/3` | never (kickouts off) | score/messages/sounds; MAY call `kickoutSetHold(id, s)` and `kickoutSetActive(1,false)` |
| `kickoutEject` | `id` | ball thrown out | n/a | KICKOUT sound for `id` 1,2 |
| `sinkCapture` | `id` | ball captured by `v_sink1/2/3/7` | becomes `drain` | wormhole logic (5.9); MUST call `sinkSetRoute(id, exitId, hold)` |
| `sinkEject` | `id, from` | ball re-emitted from sink `id` (`from` = sink entered) | n/a | SINK sound, flash lamps |
| `flagFrame` | `name, frame, dir` | every sprite step of a spinner | emitted | 500/2500 points per frame, FLAG_TICK |
| `flagLoop` | `name` | frame wrapped to 0 | emitted | advance wormhole destination (5.9) |
| `kickbackFired` | `id` | the kick happened | emitted | KICKBACK sound |
| `kickbackTimerExpired` | `id` | the final 0.1 s timer after the kick | emitted | re-enable the gate, outlane lamps off (5.4.8) |
| `blockerHit` | `impact` | ball hit the centre post | emitted | BLOCKER_HIT |
| `drain` | `ballId, remaining, via` | a ball was removed (`'drain'` line, `'sinkTilt'`, `'forced'`) | emitted | end-of-ball logic when `remaining === 0` (5.2.4) |
| `plungerFed` | `ballId` | the new ball appeared at the plunger | emitted | mission box "Awaiting Deployment" (5.2.2) |
| `plungerPull` | - | charge started | - | PLUNGER_PULL (silent slot) |
| `plungerRelease` | `boost, hitBall` | plunger released | - | PLUNGER_RELEASE |
| `stuckRelaunch` | - | a stuck ball was removed and a plunger relaunch issued by physics | - | nothing (no ball lost) |
| `flipper` | `side, action, byKey` | extend/retract started; `byKey:false` for forced retracts | - | FLIP_UP / FLIP_DOWN sounds; lane-change lamp rotation on `extend` (5.6) |
| `nudge` | `dir` | a nudge was applied | - | nothing |
| `nudgeCount` | `level, count` | counter crossed 0.5 / 1.0 upward | - | `warn`: info "Careful..." 2 s; `tilt`: TILT sequence unless a ball is draining (4.11) |
| `demoTrigger` | `id` | a demo trigger (1400-1404) was touched (only while `setDemoTriggers(true)`) | - | demo AI timers (5.2.9) |

### 5.4 Commands (rules -> physics) = the `Physics` surface

| command | effect | typical caller |
|---|---|---|
| `step(dt?)` | advance one fixed update | `game.step` |
| `drainEvents()` | take and clear the queue | `game.step` |
| `snapshot()` | refresh and return the stable snapshot | `game.buildRenderFrame` |
| `balls`, `ballsInPlay()`, `ballAtPlunger()`, `getNudgeCount()`, `isTiltLocked()` | read-only queries | rules |
| `setFlipperButton('left'\|'right', down)` | low-level press/release; no game gating; `false` if disabled/tilted; emits `flipper` on a state change | `rules.input`, demo AI |
| `setPlungerButton(down)` | `true`: Boost := 0, charge (+1 now, then every 0.025 s, max 100), emit `plungerPull`; `false`: release/launch | `rules.input`, demo AI |
| `nudge(dir, down=true)` | 5.3 / 4.3 nudge | `rules.input` |
| `startFeed({delay = 0.96})` | after `delay`, create the ball at `PLUNGER.feed` (retry every 1.0 s if blocked), `ballsInPlay += 1`, clear tilt lock, nudge counter := -2, emit `plungerFed` | rules (ball feed) |
| `relaunch()` | ball-save feed + self-charging plunger (4.3) | rules (ball save) |
| `launchInstant()` | menu "Launch Ball" | `rules.launchBall` |
| `gateSetEnabled(1\|2, bool)` | solid+visible or open+hidden | rules (5.4.8) |
| `blockerSetEnabled(bool)` | centre post up/down | rules (5.4.9) |
| `popupReenable(nameOrNames \| 'all', immediate?)` | re-raise after 0.25 s (or now); emits `popupUp` | rules |
| `kickoutSetActive(id, bool)` | arm/disarm | rules |
| `kickoutSetHold(id, seconds)` | restart the hold timer of the ball just captured (`0` = throw at the next step) | rules in `kickoutCapture` |
| `sinkSetRoute(id, exitId, hold?)` | which sink the captured ball leaves from and after how long (default 2.0) | rules in `sinkCapture` |
| `setTiltLock(bool)` | 4.3 tilt behaviour | rules |
| `setFlippersEnabled(bool)` | `false`: forced retract (`flipper` byKey:false) + ignore input | rules (game over, tilt, focus loss) |
| `setDemoTriggers(bool)` | enable the 5 invisible demo triggers | rules (demo) |
| `forceDrainAll()` | every ball -> `drain` (`via:'forced'`) | rules (30 s tilt timeout) |
| `removeAllBalls()` | silently remove balls, cancel pending feed/relaunch/sink ejects | rules (new game / stop) |
| `resetTable()` | 4.1 start state, queue cleared | rules (new game / stop) |
| `spawnBall(x,y,opts?)` | debug `B` key / tests | rules (debug), tests |
| `debugGrab(x,y)`, `debugDrag(x,y)`, `debugRelease()` | mouse ball-drag (debug mode; ignores gravity while grabbed) | main.js |

### 5.5 Sequences (what must happen, in order)

**Normal ball.** `rules.newGame` -> `physics.removeAllBalls(); resetTable()` -> light show -> `rules.feed()`: lamps set up (5.2.2), `physics.gateSetEnabled(1,false); (2,false)`, `sound.play('BALL_FEED')`,
`physics.startFeed()` -> 0.96 s -> event `plungerFed` -> player holds Space: `setPlungerButton(true)` ... release -> `plungerRelease` -> ball climbs the lane, crosses `s_onewy1` (`oneway`) ... ->
ball reaches the flippers and drains: event `drain{remaining:0}` -> rules runs the drain handler (5.2.4) and `scheduler.after(1.82, next)`; `next` = game over or `feed()` again.

**Ball save.** `drain` while `lite200` lit -> rules plays `SW27`, shows "Re-Deploy", keeps all table state, and at the end of the 1.82 s timer calls `physics.relaunch()` (no feed lamps reset).

**Kickout.** `kickoutCapture{id:2}` -> rules scores, picks the sound (5.4.2), `hold = sound.play(key)` (or default), `physics.kickoutSetHold(2, hold)` -> after `hold` physics throws the ball, `kickoutEject{id:2}`.

**Wormhole.** `sinkCapture{id:1}` -> rules decides the exit sink `e` (5.9) -> `physics.sinkSetRoute(1, e, 2.0)` -> 2 s later the ball appears at sink `e`'s re-emit point, `sinkEject{id:e, from:1}`.

**Tilt.** `nudgeCount{level:'tilt'}` -> rules: texts, `sound.play('TILT')`, `lamps.tiltOff()`, `physics.setTiltLock(true)`, `scheduler.after(30, physics.forceDrainAll)`; each `drain` -> when `remaining 0` end-of-ball without
bonus. The lock is cleared by `plungerFed` (physics) and by `ClearTiltLock` in the drain reset block (rules: `physics.setTiltLock(false); lamps.clearTiltLock()`).

**Game over.** last ball drains -> after 1.82 s `phase:'gameOver'`; rules calls `physics.setFlippersEnabled(false)`, `physics.removeAllBalls()` (nothing in play), `physics.resetTable()` on the next `newGame`.

### 5.6 Physics acceptance tests (`tests/physics.test.mjs`, PHYSICS)

Use `constantRand(0.5)` unless noted; tolerances are for the Python port numbers quoted in SPEC 4.9.14/4.8 (ESTIMATED), so allow the stated bands.

1. **Edges:** `installWall/installLine/installCircle` reproduce every `data.*.edges` (1e-4); `rayLine/rayCircle` unit cases (grazing, behind-origin -0.002, one-sided back face, origin inside circle).
2. **basicCollision:** head-on speed `v*e`; the SPEC example (v=10, 45 deg, e=0.5, s=0.8 -> speed 6.46, 58 deg from the normal); hard hit adds `B` along the normal; moving-away case leaves the direction alone.
3. **Free fall (App. D #2):** empty-table `data` override, ball from rest: `v(t) = 59.93 (1 - e^-0.2t)` within 1%, 20 units in 1.95 s +/- 0.05; terminal speed <= 60.
4. **Plunger (App. D #3):** apex after a held-boost launch: Boost 10 -> y 6.8, 15 -> 2.0, 20 -> -4.0, 22 -> -6.6, 24 -> -8.9, 26 -> -10.7, 28 -> -11.7 (each +/- 0.6); Boost >= 30 enters the table (passes `s_onewy10` region / `oneway` event); full charge takes 2.475 s (`plungerPull` then `snapshot.plunger.boost === 100` at 2.475 s +/- 1 step).
5. **Flipper (App. D #4):** from rest, pressing at the right moment a ball dropped at (1.9, 9.0) leaves the left flipper at 30-49 u/s (search the press time); too early/late 7-12 u/s; `angleMax` reached in 0.04 s (extend) and rest in 0.08 s (retract) +/- 1 step; the ball never tunnels (soak 12 s).
6. **Ramp (App. D #5):** a strong shot through the low mouth ends `mask 4`, `z === 1.368`, event `rampEnter`/`rampExit`; a weak shot rolls back out to `mask 1`; `rampLine1` fires once for a deck ball crossing Line 1; tube: entry hides the ball (`visible:false`, `z -4.7`), exit at the far end restores `mask 1`, `z 0.3`.
7. **Kickouts (App. D #6):** `a_kout1` inert until `kickoutSetActive(1,true)`; `a_kout2/3` capture inside the capture radius; `kickoutSetHold` honoured; black hole default 1.5 s; sink hold 2.0 s +/- 1 step, route to another sink; tilt turns a sink capture into `drain via 'sinkTilt'`.
8. **Components:** popup down/up cycle and `popupUp`; solo re-arm 0.1 s; bumper threshold + 0.1 s hard-hit lockout; kickback 0.7 s + 0.1 s sequence and `kickbackTimerExpired`; one-way passes only in +n; rollover entry event once per pass and 0.1 s re-arm; flag spinner frame events; gates disabled = ball passes; blocker; drain removes a ball and queues `drain`.
9. **Tilt/nudge (App. D #10):** holding a nudge 0.27 s emits `nudgeCount tilt`; 0.2 s only `warn`; three 0.15 s taps 0.3 s apart tilt; counter decays 1/s; `setTiltLock(true)` forces plain bounces.
10. **Stuck ball:** speed < 0.8 for > 0.5 s re-throws, then removal + `stuckRelaunch` after 21 failures.
11. **Determinism:** same seed + same input script twice -> identical `drainEvents()` streams and identical snapshots.
12. **Snapshot:** `snapshot()` returns the same object every call; keys match `COMPONENT_NAMES`; `createSnapshot` matches the idle shape.

---

## 6. Lamps API (`src/lamps.js` + `src/lamps/**`, owner LAMPS)

Implements SPEC 5.13 (TLight, TLightGroup, TLightBargraph, per-player save) and 5.5 (fuel). Pure Node module: imports only `src/data/**` (`LAMPS`, `LAMP_GROUPS`, `FUEL_BARGRAPH`, `LAMP_NAMES`, `LAMP_FLASH_*`, `LAMP_HOOK_NAMES`).
Nothing in this module knows about rules or physics.

### 6.1 Time model

* All lamp timers are **integer milliseconds** on a private `TimerWheel` (`src/lamps/wheel.js`). Verbs take seconds and convert with `Math.trunc(seconds * 1000)`.
* `lamps.advance(dt)` (dt in seconds) accumulates `dt*1000` with the fractional remainder carried and calls `advanceMs(whole)`; `advanceMs(ms)` moves the wheel `ms` forward.
  Timers fire **one at a time in (time, insertion) order**; a timeout and a flash toggle due at the same ms: the timeout wins (SPEC 5.13.1). Tests drive `advanceMs` directly.
* `TimerWheel`: `schedule(ms, fn) -> id` (delay from now), `cancel(id)`, `advance(ms)`, `now()`. It is **re-entrant**: callbacks may call any lamp verb (that schedules/cancels timers);
  a timer scheduled during `advance` whose due time is `<=` the current target time fires within the same `advance` call.
* The game freezes lamps while paused simply because `game.advance` runs no steps.

### 6.2 Lamp API (every name is a string from `LAMP_NAMES`; unknown names throw `TypeError`)

| SPEC verb (rules text) | API | exact effect (SPEC 5.13.2) |
|---|---|---|
| `lit(L)` ResetAndTurnOn | `lamps.on(L)` | `S = true`, cancel timeout + flash, overlay NONE |
| `unlit(L)` ResetAndTurnOff | `lamps.off(L)` | `S = false`, same reset |
| TurnOn / TurnOff | `lamps.turnOn(L)` / `lamps.turnOff(L)` | raw `S`, overlays untouched |
| `flash(L,t)` FlasherStartTimed | `lamps.flash(L, t)` | start the waveform if not flashing (first phase = opposite of `S`); `t <= 0` or omitted = until reset |
| FlasherStart | `lamps.flasherStart(L)` | indefinite flash, cancels the timeout |
| `flashThenOn(L,t)` | `lamps.flashThenOn(L, t)` | `S = true` now (counts), flash `t`, end steady lit |
| `flashThenOff(L,t)` | `lamps.flashThenOff(L, t)` | flash `t` then `S = false` (`t <= 0` flashes forever) |
| `timedOn(L,t)` TurnOnTimed | `lamps.timedOn(L, t)` | FORCE_ON overlay for `t` s then back to `S` (NOT to off) |
| TurnOffTimed | `lamps.timedOff(L, t)` | FORCE_OFF overlay (`t = 0`: indefinite) |
| ResetTimed | `lamps.resetTimed(L)` | cancel timeout/flash, overlay NONE; `S`, `field`, `onIdx` kept |
| SetMessageField / `field(L)` | `lamps.setField(L, v)` / `lamps.getField(L)` | integer scratch register (`floor(v)`) |
| SetOnStateBmpIndex | `lamps.setOnIdx(L, i)` / `getOnIdx(L)` | clamp `floor(i)` to `0..nStates-1` |
| ToggleValue / ResetAndToggleValue | `lamps.toggleValue(L, v)` / `lamps.resetAndToggleValue(L, v)` | `S = floor(v) != 0` (second also ResetTimed) |
| `light_on()` | `lamps.lightOn(L)` | `S \|\| FORCE_ON \|\| FLASH` - **every rule test ("if lite56 is lit") uses this** |
| visual state | `lamps.isLit(L)` | overlay-aware: FLASH -> phase, FORCE_ON -> true, FORCE_OFF -> false, else `S` - **render uses this** |
| steady flag | `lamps.steady(L)`, `lamps.overlay(L)` | `S`; `'none'\|'flash'\|'on'\|'off'` |
| ControlTimerExpired | `lamps.onLampTimer(L, fn)` | hook, only for `LAMP_HOOK_NAMES` (`lite17 lite59 lite60 lite200`); `fn(lampName)` runs after the timeout expiry processing |
| tilt | `lamps.tiltOff()` / `lamps.clearTiltLock()` | `timedOff(L, 0)` on all 140, then `flasherStart('lite77')` (its FLASH overlay replaces the FORCE_OFF one) / `resetTimed` broadcast to all 140 |
| new game | `lamps.resetAll()` | Reset(): `S=false`, everything cancelled, `onIdx=0`, `field=0` on lamps, groups, bargraph |
| per player | `lamps.playerChanged(outgoing, incoming)` | SPEC 5.13.5 (players 0..3; saves `{flashing, onIdx, S, field}` per lamp, groups' registers, bargraph level) |
| clock | `lamps.advance(dt)`, `advanceMs(ms)`, `nowMs()` | 6.1 |
| view | `lamps.fillView(view)` | 6.6 |
| lists | `lamps.names` | the 140 names |

Flash timing per lamp: `LAMPS[i].flash` (`off` = dark phase, `on` = lit phase). The state fields of a lamp, the flash waveform, the timeout rules and `count(G)` are exactly SPEC 5.13.1.

### 6.3 Groups (`lamps.group(name)`; names = `LAMP_GROUP_NAMES` plus `'all'`; the same object is returned every call)

Member lists/order and default step come from `LAMP_GROUPS` (`'all'` = all 140 lamps in `LAMP_NAMES` order). Methods (typedef `LampGroup`):

| method | semantics (SPEC 5.13.3) |
|---|---|
| `count()` | number of members with `S` true (`GetOnCount`) |
| `nextOn(t = 2.0)` | first member (lowest index) with `S` false -> `flashThenOn(t)`; returns `false` and does nothing if all are lit |
| `dropTop()` | highest-index member with `S` true -> `off()` (steady off, no flash); `false` if none |
| `offsetForward()` | first member with `S` false -> `on()` (steady, no flash) |
| `stepForward()` / `stepBackward()` | lane-change rotation of the steady layer (`S` and `field`); no-op if the LAST member is flashing / in any overlay |
| `animationForward(step)` / `animationBackward(step)` | chase on the overlay layer; `step <= 0` or omitted = group default (`LAMP_GROUPS[i].step`); runs until `groupReset()` |
| `lightShow(step = 0.2)` / `gameOver(step = 1.4)` | the two random animations (29 % per member per tick, uses the injected `rand`) |
| `isAnimating()` / `lastFlashing()` | queries used by the rules |
| `groupReset()` | cancel the step timer; if an overlay animation was running broadcast ResetTimed; `S` untouched |
| `restartNotifyTimer(t)` / `onNotifyExpired(fn)` | decay timer: the group ONLY raises `fn(groupName)` on expiry; the rules handler does `dropTop()`, restarts, lowers the multiplier |
| `flashWhenOn(t)` | for lit members: `S = false` now then flash `t` seconds and end off |
| `broadcast(verb, ...args)` | apply a `LampVerbName` to every member, LAST member first |

### 6.4 Fuel gauge (`lamps.fuel`, typedef `Bargraph`)

`members` = `literoll179..184`; `level` 0..11 (read-only). `setLevel(L)` (ToggleSplitIndex), expiry ticks and the timeline are SPEC 5.5: level durations `[3,14,3,12,3,10,3,8,3,6,3,4]`
(`FUEL_BARGRAPH.durations`), lit lamps = `floor(level/2)+1`, the top lamp flashes at every even level. After `setLevel(11)` at t=0 the level changes at t = 4, 7, 13, 16, 24, 27, 37, 40, 52, 55, 69 s and
everything is dark with the "ended" event at 72 s. `reset()` = all off, level 0, no timer. At ball start the RULES light all six lamps with `lamps.on(...)` but leave `level` 0 (SPEC 5.5 quirk) - the bargraph
object must therefore allow lamps to be lit independently of `level`. Hooks: `fuel.setHooks({ beforeSetLevel(L), tick(level), ended() })`: `beforeSetLevel` runs BEFORE the lamps update (SPEC callback-order quirk),
`tick(newLevel)` after every timer-driven decrement (after the update), `ended()` when the countdown reaches the end.

### 6.5 Hooks and re-entrancy rules

* Hooks are registered once by RULES in `createRules` and replace any previous hook for that lamp/group.
* A hook (or group/bargraph callback) may call any lamp verb, including on the lamp that raised it. LAMPS must finish its own state update **before** invoking the callback and must not hold iterators over timers/members while calling out.
* `onLampTimer` for a lamp not in `LAMP_HOOK_NAMES` throws `TypeError`.

### 6.6 View for render

```js
lamps.fillView(view /* {version, lit: Record<string,boolean>, onIdx: Record<string,number>} */) -> view
```
Fills **all 140 names** into `view.lit` (visual state, `isLit`) and `view.onIdx`; `view.version` increases by 1 whenever any `lit` or `onIdx` value changed since the previous call (RENDER skips work when unchanged). Allocation-free after the first call.

### 6.7 LAMPS acceptance tests (`tests/lamps.test.mjs`, LAMPS)

SPEC 5.13.6 vectors, all via `advanceMs`:
* **T1** off lamp, `flash(L, 5)`: lit [0,100), dark [100,200), lit [200,300) ...; at 5000 the timeout wins the tie with the toggle: dark, `S=false`, no extra pulse.
* **T2** group `nextOn` on an all-off 3-lamp group at t=0: lamp0 `S` true immediately (count 1); display dark [0,100), lit [100,200) ...; steady from 2000; a second `nextOn` at 500 targets lamp1 and lamp0's flash continues.
* **T3** three lane lamps lit then the third lane passed (rules idiom: count 3 -> `broadcast('flash', 5)` then `broadcast('turnOff')`): count 0 at once, the three blink in sync (dark first) until 5000 then off.
* **T4** `tiltOff()` at T: every lamp dark at once, `lite77` flashing (lit 800 / dark 200, lit first), steady flags unchanged; `clearTiltLock()` restores.
* **T5** fuel: ticks at 4,7,13,16,24,27,37,40,52,55,69 s; dark + `ended` at 72 s (App. D #7); `beforeSetLevel`/`tick` ordering.
* **T6** ball save: `on('lite200')`, `timedOn('lite200', 5)` -> `lightOn` true until t=10 via the hook idiom (hook: `flashThenOff(5)`); flashing 5..10; off at 10.
* Group verbs: `nextOn` on all-lit returns false; `dropTop`; `stepBackward` moves the pattern toward higher index with wrap and is ignored while the last member flashes; chase animations first frame already shifted by one; `flashWhenOn`; `restartNotifyTimer` callback once; `broadcast` order (last first).
* `fillView` keys = 140; `version` bumps only on change; `onIdx` of `lite2/3/4` clamps to 0..2; unknown names throw; re-entrancy (a hook that flashes the same lamp); `playerChanged` round trip; `resetAll`.

---

## 7. Rules module (`src/rules.js` + `src/rules/**`, owner RULES)

Implements SPEC section 5 completely (flow 5.2, scoring 5.3, features 5.4, fuel 5.5, lane lamps 5.6, missions 5.7, ranks 5.8, wormholes 5.9, cheats 5.10, text 5.11, timers 5.12) plus 6.5/6.9 input gating and cheats and SPEC 4.11 tilt consequences.
Pure Node module: imports only `src/data/**`. **Physics, lamps and sound arrive by injection and must never be imported by rules code.**

```js
/** @param {{physics:Physics, lamps:Lamps, sound?:SoundPort, rand?:()=>number, highScores?:HighScoreTableApi, data?:DataModule}} opts  @returns {Rules} */
export function createRules(opts) {}
```

### 7.1 Scheduler (`src/rules/scheduler.js`)

`class Scheduler { after(seconds, fn) -> handle; cancel(handle); cancelAll(); advance(dt); now() }` - float seconds; fires due callbacks in (due time, insertion) order; re-entrant (callbacks may schedule/cancel; a new timer already due
fires in the same `advance`); callbacks that throw are not swallowed. `rules.tick(dt)` = `scheduler.advance(dt)` + text-box ticks. All rule timers (drain 1.82, feed, tilt 30, gravity-well notify, game-over 3, demo restart 5,
demo AI flipper holds, sink/kickout follow-ups, "Careful" text, ...) use it; **no `setTimeout`, no `Date`**.

### 7.2 Suggested file split (all optional except the three contracted files)

`rules.js` (facade + wiring), `rules/scheduler.js`, `rules/textbox.js`, `rules/highscores.js`, and as you like: `state.js` (GameState + addScore/specialAdd), `flow.js` (new game, feed, drain, game over, players), `features.js`
(bumpers, banks, lanes, hyperspace, ramp, kickbacks, post, wormholes), `missions.js`, `ranks.js`, `fuel.js`, `demo.js`, `cheats.js`, `sound.js` (dispatcher). Events are routed by `event.type`.

### 7.3 Outputs

| to | what | how |
|---|---|---|
| **UI** | `RulesView` (`rules.getView()`, one stable object mutated in place, `revision` +1 on any displayed change) | fields in `src/types.js`: `phase 'idle'\|'lightShow'\|'playing'\|'gameOver'`, `demo/paused/tilted/debug`, `score` (0..999999999, -1 = blank), `player` 1..4, `playerCount`, `ballNumber` (`MaxBallCount-BallCount+1`, 0 = blank), `info`, `mission` (current text-box strings, `\n` breaks), `bumperLevels {attack, launch}`, `launchEnabled` (`phase==='playing' && !demo`), `highScoresEnabled` (`phase !== 'idle' && !demo`), `newGameEnabled` (true), `namePrompt` (`{player, rank, score, defaultName}` or `null`), `missionState`, `extraBalls`, `fuelLevel` |
| **RENDER** | the same `RulesView` (bumper ring colours from `bumperLevels`) | via `RenderFrame.rules` |
| **AUDIO** | `sound.play(key)` calls; the return value is the duration used for gameplay timers | 7.6 |
| **LAMPS** | verbs of 6.2 / group verbs of 6.3 | direct calls on the injected `lamps` |
| **PHYSICS** | commands of 5.4 | direct calls on the injected `physics` |

Score model: `CurScore` 0..999,999,999 with the E9 billions counter (SPEC 5.1); `addScore(x)` applies the field multiplier and the pot flags, `specialAdd(x)` does not (SPEC 5.3). Display `score` = `CurScore`.

### 7.4 Text boxes (`src/rules/textbox.js`)

`class TextBoxQueue { constructor({minDisplay = 0.25, skipOverdue = 2.0}); push(text, seconds /* -1 persistent */); clear(); tick(dt); current() -> string }` implements SPEC 5.11 exactly: FIFO, only the head shows; empty text ignored; a repeat of the
newest queued message only refreshes its timer; a different message is appended and clears a persistent one on screen; messages overdue by more than 2 s are skipped; minimum display 0.25 s. Rules own two queues (`info`, `mission`);
`RulesView.info/mission` = `current()` each tick. Strings come only from `INFO` / `MISSION_TEXT` through `fmt`. Numbers are plain decimals.

### 7.5 High scores (`src/rules/highscores.js`)

`class HighScoreTable` implements `HighScoreTableApi` (types.js): 5 entries, empty slot `{name:'', score:-999}`; `qualifies(score)` = `score > 0` and better than at least one slot; `insert(name, score)` shifts entries down and returns the rank 1..5 (0 if
not inserted), names trimmed to 31 chars; `load(entries)` sanitises to exactly 5 entries without calling `onChange`; `clear()`; `onChange(entries)` is called after `insert`/`clear` (main.js persists it through `Store`). Game over (SPEC 5.2.7): players sorted
by score descending; each score that qualifies (and `!demo`, `!cheatsUsed`) sets `RulesView.namePrompt = {player, rank, score, defaultName:'Player N'}`; the UI answers with `rules.submitName(name | null)`; prompts are sequential. The score list display
(commas) is UI's job (`formatHighScore`).

### 7.6 Sounds

* Every sound goes through `sound.play(key)`; the **return value** is the duration in seconds (or `-1` when silent by design) and is what gameplay timers use: new-game light show (`d > 0 ? d : 5.0`), hyperspace hold, gravity-well hold (`SW7` = 2.404 s), black hole 1.5 s default.
  `sound` defaults to `SILENT_SOUND` (data/sounds.js), so silent and audio builds behave identically.
* DAT-bound sounds: for each physics event find the first `SOUND_EVENT_MAP` entry that matches (rule in `src/data/sounds.js`) and `play` its key. **Suppress all of them while `tilted`** (SPEC 7.3). Script sounds (`SW3 ... SW59`) and `NEW_GAME`, `GAME_OVER`, `TILT`,
  `BALL_FEED`, `BLOCKER_MOVE` are played explicitly where SPEC 5.x says. Wall bounces, nudges, score ticks, replay awards and name typing are silent.

### 7.7 Lamp hooks RULES must register in `createRules`

`lamps.onLampTimer('lite17' | 'lite59' | 'lite60' | 'lite200', ...)` (extra-ball lamps flash 5 s after 55 s; bonus/jackpot flag clear; ball-save two-stage), `group('hyperspace_lights' | 'bumper_target_lights' | 'top_target_lights').onNotifyExpired(...)`,
`lamps.fuel.setHooks({beforeSetLevel, tick, ended})`, and the blocker lamp `lite1` idiom (the 55 s mark flashes it 5 s - a rules timer, `lite1` has no hook).

### 7.8 Input gating - `rules.input(action, down)` is the ONLY game-input entry

| action | accepted when | effect |
|---|---|---|
| `flipperLeft/Right`, `down=true` | `phase==='playing' && !paused && !demo && !tilted` | `physics.setFlipperButton(side, true)` (the `flipper` event then rotates the lane lamps, SPEC 5.6) |
| same, `down=false` | always (release) | `physics.setFlipperButton(side, false)` |
| `plunger`, `down=true` | `phase==='playing' && !paused && !demo && !tilted` | `physics.setPlungerButton(true)` |
| `plunger`, `down=false` | always | `physics.setPlungerButton(false)` |
| `nudgeLeft/Right/Bottom`, `down=true` | `phase==='playing' && !paused && !demo && !tilted` | `physics.nudge('left'/'right'/'bottom', true)` |
| nudge, `down=false` | always | `physics.nudge(dir, false)` |

`rules.launchBall()` -> `phase==='playing' && !demo && !paused` -> `physics.launchInstant()`. `focusLost()` = release both flippers and the plunger, retract, stop music request; the page then calls `game.setPaused(true)`; `focusGained()` does nothing else (the game stays paused until F3).
`setPaused(on)` shows/clears the "Game Paused\nF3 to Resume" / "Continue Play" messages (SPEC 5.2.11). `cheat(word)` and `debugKey(key)` follow SPEC 5.10/6.9; debug keys act only while `debug` is on.

### 7.9 Phases

`idle` (before the first game / after `stopGame`) -> `newGame()` -> `lightShow` (5.2.1, length from `sound.play('NEW_GAME')`) -> `playing` (feed, drain loop) -> `gameOver` (5.2.7, after the 3.0 s timer: `F2 Starts New Game`, high-score cycle). Demo (5.2.9) is a normal game with `demo:true`,
`physics.setDemoTriggers(true)` and the AI driven by `demoTrigger` events; it restarts 5.0 s after its game over until `setDemo(false)`/`newGame`. Multiplayer (5.2.10): use `lamps.playerChanged(outgoing, incoming)` at the turn change and run the end-of-ball reset block on the incoming player's lamps.

### 7.10 RULES acceptance tests (`tests/rules.test.mjs`, RULES) - use real `createLamps` (or a local double until LAMPS lands), `createFakePhysics`, a recording `SoundPort`, `mulberry32(1)`

* App. D #8: skill shot with three lamps lit = 75,000 (and the whole award table 15000/30000/75000/30000/15000/7500 for 1..6); three lane lamps upgrade the attack bumpers ("Weapons Upgraded"); the third drop target of a bank scores per 5.3/5.4.4-5.4.6.
* Flow: new game -> light show length 5.045 s -> `startFeed` -> `plungerFed` -> "Awaiting Deployment"; drain with ball save (`SW27`, "Re-Deploy", `relaunch`); real drain -> crash bonus, ball count, 1.82 s then feed; extra ball ("Shoot Again"); game over after ball 3; 2-4 players rotate; high-score prompt + table.
* Scoring: multiplier applies in `addScore` only; `specialAdd` ignores multiplier and pots; pots (bonus 25000 after a ball, jackpot persists); score E9 rollover; every row of the 5.3 table with its point value.
* Hyperspace ladder 10000 / jackpot / post / extra ball / 150000 + gravity well armed; gravity-well capture 50000 and hold 2.404 s via `kickoutSetHold`; black hole 20000; wormhole matrix 2500/5000+replay/7500 with `sinkSetRoute`.
* Missions: select -> "Launch Ramp To Accept ..." -> accept (+10000/20000/30000) -> counters -> completion reward + rank points (Target Practice: 8 attack-bumper hits = +500,000, rank progress 6); three 6-point missions promote Cadet -> Ensign; Mission Aborted when fuel ends; Time Warp both branches; Maelstrom chain.
* Fuel: refuel sources, `Warning -- Low Fuel` at level 1, mission needs level > 0.
* Tilt: `nudgeCount warn` -> "Careful..." 2 s; `tilt` -> "TILT!", `TILT` sound, `tiltOff`, `setTiltLock(true)`, 30 s -> `forceDrainAll`, no crash bonus; cleared at the next ball.
* Text box queue semantics (SPEC 5.11), pause/resume texts, input gating table 7.8, cheats (`1max`, `rmax`, ...), demo AI scheduling, sound dispatch (tilt suppression, `SOUND_EVENT_MAP`), unknown event types ignored, every `EVENT_TYPES` value accepted without throwing.

---

## 8. UI (`src/ui/**`, `css/ui.css`, owner UI; `index.html` and `css/style.css` are INTEGRATOR's)

The UI turns `RulesView` into pixels/DOM and user gestures into `UIActions` callbacks. It never imports rules, physics, lamps, render or audio: it sees only `RulesView`, `AudioStatus`, `Options`, `Bindings`, `HighScoreEntry`, `NamePrompt`
and the data barrel. Logic that can be pure (`textlayout`, `format`, `keylabels`, `storage`, `dotfont` glyph tables) lives in pure modules with Node tests; DOM-building code stays thin.

```js
/** @param {CreateUIOpts} opts @returns {UI} */   // src/ui/index.js  (types in src/types.js)
export function createUI({ root, store, actions, panelArt, options, bindings, onDialogChange, doc, data }) {}
```

### 8.1 Mount points (INTEGRATOR owns `index.html`; frozen ids - the exact file is in Appendix B)

| id | element | filled by | contents created by UI |
|---|---|---|---|
| `app` | `div.app` | - | root passed as `opts.root` (UI queries everything below inside it) |
| `menubar` | `nav.menubar` | UI | `ul.menu-bar` (8.2) |
| `stage-wrap` > `stage` | `main` > `div.stage` | INTEGRATOR css | 600x416 virtual screen (aspect-ratio box) |
| `table-view` | `div.table-view` | `main.js` | the Three.js canvas (UI does not touch it) |
| `panel` | `aside.panel` | UI | `canvas#panel-canvas` (203x394) + visually hidden `div#panel-aria[aria-live=polite]` (score and both messages as text) |
| `touch-controls` | `div.touch-controls[hidden]` | UI | touch buttons (8.7); UI removes `hidden` only when `matchMedia('(pointer: coarse)').matches` or `?touch=1` |
| `start-overlay` | `div.overlay.start-overlay[hidden]` | UI | the start / consent card (8.4) |
| `status-line` | `div.status-line` | UI | `span#sound-status` ("sound: ...") and `span#fps` |
| `dialog-root` | `div.dialog-root` | UI | modal dialogs (8.4) |
| `toast-root` | `div.toast-root` | UI | transient `div.toast` messages |

Geometry (css/style.css): the stage is the 600x416 virtual screen of the original; the table canvas covers `x 0..365`; the panel is the 203x394 rectangle at `(386, 12)`, i.e. `left 64.333%`, `top 2.885%`, `width 33.833%`, `height 94.712%`.
The panel `<canvas>` has fixed intrinsic size 203x394 and is scaled by CSS (`width:100%; height:100%`); render it with `image-rendering: auto`. Everything UI-created must scale with `#stage` (use `%`, `em` relative to a font-size set from the stage width, or `container` units) and must
work at a 360 px wide phone (16 px gutters, no horizontal page scroll), on a black page, and in fullscreen. `css/ui.css` is the only stylesheet UI writes.

### 8.2 Menu bar (SPEC 6.4)

```html
<ul class="menu-bar" role="menubar">
  <li class="menu" data-menu="game" role="none">
    <button class="menu-title" role="menuitem" aria-haspopup="true" aria-expanded="false">Game</button>
    <ul class="menu-items" role="menu" hidden>
      <li role="none"><button class="menu-item" role="menuitem" data-cmd="newGame">New Game <kbd>F2</kbd></button></li>
      ...
```

Items (label, shortcut hint, `data-cmd`, extra attribute):

| menu | item | cmd | state |
|---|---|---|---|
| Game | New Game `F2` | `newGame` | always enabled |
| Game | Launch Ball `Enter` | `launchBall` | enabled = `view.launchEnabled` |
| Game | Pause Game / Resume Game `F3` | `pause` | label follows `view.paused`; disabled when `phase==='idle'` |
| Game | High Scores... | `highScores` | enabled = `view.highScoresEnabled` |
| Game | Demo | `demo` | `role=menuitemcheckbox`, `aria-checked = view.demo` |
| Game | Exit | `exit` | always |
| Options | Full Screen `F4` | `fullscreen` | checkbox = `options.fullscreen` |
| Options | 1 Player / 2 Players / 3 Players / 4 Players | `players` + `data-value="1".."4"` | `menuitemradio`, checked = `options.players`; choosing one starts a new game |
| Options | Sounds `F5` | `sounds` | checkbox = `options.sounds` |
| Options | Music `F6` | `music` | checkbox = `options.music` (default off) |
| Options | Camera > Original / Top / Orbit `V` cycles | `camera` + `data-value` | radio = `options.camera` |
| Options | Load My Sounds... | `loadSounds` | opens a file picker (`input[type=file][multiple][webkitdirectory]`, plus a second item for `.zip`) -> `actions.loadLocalSounds(files)` |
| Options | Player Controls... `F8` | `controls` | always |
| Help | Help Topics `F1` | `help` | always |
| Help | About | `about` | always |

Behaviour: click opens/closes; hover switches between open menus; `Escape` and outside click close; arrow keys move; menus never steal the game keys (input.js handles all shortcuts globally; the menu only *displays* the hint). `ui.setOptions(options)` refreshes the checks, `ui.update(view)`
refreshes the view-derived states (cheap: only touch the DOM when a value changed). The original "Select Table" item does nothing in the source build: omit it.

### 8.3 Scoreboard panel (SPEC 6.2/6.3)

`ArtPack.panel` (203x394, painted by ART: bezel, three black boxes, original logo, the printed word BALL) is drawn once into `#panel-canvas`; UI then draws dots on top **only when `view.revision` changed**.

Field rectangles (panel-local px = `PANEL.fields` in `src/data/constants.js`): `score1 (47,185,135,22)` 9 right-aligned cells of 15 px; `player1 (17,185,15,22)`; `ball1 (167,140,15,22)`; `info (19,227,165,44)` 15 columns x 2 rows; `mission (19,291,165,88)` 15 columns x 4 rows (text cell 11x22 px).
ART must leave these rectangles black inside the three boxes (box = field rect expanded by 4 px; the score row box is the union of `player1` and `score1` expanded by 5 px).

| function | spec |
|---|---|
| `formatScore(n)` | `n < 0 ? '' : String(Math.trunc(n))` - plain decimal, no commas, no padding (SPEC E3) |
| `formatHighScore(n)` | thousands separators `1,234,567` - the ONLY place with commas |
| `wrapText(text, cols, rows) -> string[]` | left/top aligned; `\n` forces a break; greedy word wrap at spaces; a word longer than `cols` is split; at most `rows` lines (the rest is cut); trailing spaces trimmed. `wrapText('Awaiting Deployment', 15, 2) -> ['Awaiting', 'Deployment']` |
| `GLYPHS[ch]` | 7 strings of 5 chars (`#` = dot, `.` = off), for every ASCII 32..126 (own bitmaps, public-domain style 5x7) |
| `drawDotText(ctx, text, rect, {cellW, cellH, cols, rows, align})` | draws each glyph as a lattice of round dots: mid `#7858e8`, highlight `#98c8f8` (upper-left of each dot), shade `#282858`; unlit dots invisible (or `#08081a`) |

Digits use the same 5x7 glyphs scaled into the 15x22 cell. The `ballcount` digit is `view.ballNumber` (blank when 0), the `player` digit is `view.player` (blank when `phase==='idle'`). `#panel-aria` text = `"Player N, ball B, score S. <info> <mission>"`, updated on the same revision change.

### 8.4 Start overlay and dialogs

**Start overlay** (`#start-overlay`, shown by `ui.showStartOverlay({soundStatus})`, hidden by `hideStartOverlay()`; SPEC 6.7). A centred card over the dimmed table with:

| id | content |
|---|---|
| `start-title` | `APP_TITLE` |
| `start-consent` | exact line: "Original game sounds are fetched from the Internet Archive; they are copyright Microsoft/Cinematronics and are not bundled." |
| `start-players` | `<select>` 1-4 players (default `options.players`) |
| `start-music` | checkbox "Music (off by default)" |
| `start-btn-sound` | primary button "Start with original sounds" -> `actions.start({withSound:true, players, music})` |
| `start-btn-silent` | "Start without sound" -> `actions.start({withSound:false, players, music:false})` |
| `start-load-local` | "Use my own Pinball folder / zip..." -> hidden `input[type=file]` -> `actions.loadLocalSounds(files)` (does not start the game) |
| `start-status` | the `AudioStatus.text` |

The click on a start button is the user gesture for the AudioContext; the handlers must call `actions.start` synchronously. If `options.soundConsent` is `'denied'` the silent button is focused; `'granted'` focuses the sound button.

**Dialogs** (`.dialog[role=dialog][aria-modal=true]` inside `#dialog-root`, backdrop dims the page, focus trap, `Esc` = cancel, `Enter` = OK, focus returns to the previous element). `onDialogChange(open)` is called when the number of open dialogs changes between 0 and 1.

| id | trigger | content |
|---|---|---|
| `dlg-highscores` | `ui.showHighScores(entries, {clearable})` | title "High Scores"; table columns Rank, Name, Score (commas via `formatHighScore`; empty slots blank); buttons OK and, if `clearable`, Clear (confirm dialog text "Clear High Scores?" with title "Confirm") -> `actions.clearHighScores()` |
| `dlg-name` | opened by `ui.update` when `view.namePrompt` becomes non-null (also `ui.promptName(p)`) | "Player N - new high score #k", text input `maxlength=31`, default `p.defaultName`; OK -> `actions.submitName(name)`, Cancel -> `actions.submitName(null)` |
| `dlg-controls` | `ui.showControls(bindings)` (menu / F8) | title "Player Controls"; group "Control Options" with six key pickers (Left Flipper, Right Flipper, Plunger, Left Table Bump, Right Table Bump, Bottom Table Bump), each a button showing `keyLabel(code)`; clicking arms it and the next `keydown` (captured, `preventDefault`) sets `KeyboardEvent.code`; "Default" restores `Z, /, Space, X, ., Up`; group "Instructions" with help text; OK -> `actions.setBindings(b)`, Cancel |
| `dlg-about` | menu | fan-replica notice: unofficial, not affiliated with Microsoft/Cinematronics/Maxis; original sounds are not included and are only fetched/loaded at the user's choice; tech credits |
| `dlg-help` | F1 / menu | short original instructions: keys, plunger, flippers, nudging/tilt, missions overview, cheats NOT listed |

### 8.5 Storage (`src/ui/storage.js`)

```js
export const DEFAULT_OPTIONS = { sounds: true, music: false, fullscreen: false, players: 1, camera: 'original', volume: 0.8, soundConsent: 'unset' };
export const STORAGE_KEYS = { options: 'scp.options.v1', bindings: 'scp.bindings.v1', highScores: 'scp.highscores.v1' };
createStore(storage?) -> Store     // default storage = window.localStorage read INSIDE try/catch
```
Every read and write is wrapped in `try/catch`; with `storage === null`, a throwing getter (private window), a full quota or corrupt JSON the store silently keeps working in memory and returns defaults. `getOptions()` always returns a complete `Options` (defaults filled, values validated);
`getBindings()`/`getHighScores()` return `null` when nothing valid is stored (5 entries `{name, score}` with `score` a finite number). Nothing else in the app touches `localStorage`.

### 8.6 `keyLabel(code)` (`src/ui/keylabels.js`)

`KeyZ -> 'Z'`, `Digit1 -> '1'`, `Slash -> '/'`, `Period -> '.'`, `Space -> 'Space'`, `ArrowUp -> 'Up Arrow'`, `ArrowDown/Left/Right` likewise, `Enter`, `ShiftLeft -> 'Left Shift'`, `Numpad1 -> 'Num 1'`, `F2 -> 'F2'`; unknown codes return the code string.

### 8.7 Touch controls

`#touch-controls` holds `<button class="tc" data-action="flipperLeft|flipperRight|plunger|nudgeLeft|nudgeRight|nudgeBottom">` and `<button class="tc" data-app="pause|newGame|launchBall">`. UI only creates and styles them; **input.js** (INTEGRATOR) listens by delegation on
`#touch-controls` (`pointerdown` -> `{kind:'game', action, down:true}` / `{kind:'app', action}`; `pointerup|pointercancel|pointerleave` -> `down:false`). Buttons are at least 56 px, never overlap the table area on a phone in portrait (they sit below the stage).

### 8.8 Status line, toast, fps

`ui.setSoundStatus(status)` writes `status.text` into `#sound-status` (and into `#start-status` while the overlay is open). `ui.toast(text, ms = 2500)` shows a transient message in `#toast-root` (polite live region). `ui.setFps(n | null)` shows/hides `#fps`.

### 8.9 UIActions callbacks (implemented by `main.js`; UI calls them, never anything else)

`start`, `newGame`, `launchBall`, `togglePause`, `toggleDemo`, `showHighScores`, `exit`, `selectPlayers(n)`, `setSounds(on)`, `setMusic(on)`, `setVolume(v)`, `toggleFullscreen`, `setCamera(mode)`, `submitName(name|null)`, `clearHighScores`, `setBindings(b)`, `resetBindings`, `loadLocalSounds(files)` - signatures in `src/types.js`.

### 8.10 UI acceptance tests (`tests/ui.test.mjs`, UI) - pure modules in Node

`wrapText` cases (15 columns: "Awaiting Deployment" -> 2 lines; a 20-letter word splits; `\n`; more lines than `rows` are cut; empty string -> `[]`); `formatScore` (`-1 -> ''`, `0 -> '0'`, `999999999`); `formatHighScore` (`1234567 -> '1,234,567'`, `-999 -> ''`);
`GLYPHS` covers ASCII 32..126, every glyph is 7 rows x 5 chars; `keyLabel` table; `createStore` with `null` storage, with a storage whose methods throw, with corrupt JSON, round trips of options/bindings/high scores; `drawDotText` against `tests/helpers/fake_canvas.mjs`
(only whitelisted canvas calls, draws nothing for blank text, deterministic); `createPanel(...).update(view)` repaints only when `revision` changed (count fake-canvas ops). DOM construction is checked in the browser by the INTEGRATOR (screenshot at 1280x720 and 375x667, no console errors).

---

## 9. Render and Art

Two roles, one seam: **ART paints canvases (pure, Node-testable with a fake canvas), RENDER builds geometry and the Three.js scene and applies the canvases as textures.** `main.js` calls `paintAll` once and hands the `ArtPack` to `createRenderer`.
All visuals are ORIGINAL work (SPEC 0/6.8): do not reproduce the game's bitmaps or its pilot; our own geometry, procedural textures and lettering.

### 9.1 RENDER (`src/render/**` except `art/`, owner RENDER)

```js
/** @param {{data: DataModule, art: ArtPack, canvas?: HTMLCanvasElement, quality?: {shadows?:boolean, bloom?:boolean, dprMax?:number}}} opts @returns {Renderer} */
export function createRenderer(opts) {}
```
`Renderer` (types.js): `domElement`, `resize(cssW, cssH, dpr)`, `render(frame: RenderFrame)`, `setCameraMode(mode)`, `getCameraMode()`, `cycleCameraMode()` (returns the new mode, order `original -> top -> orbit`), `pickTable(clientX, clientY) -> Pt|null`
(T-frame floor point under a client pixel; `null` off the table), `setQuality(q)`, `info()`, `dispose()`. `main.js` appends `domElement` to `#table-view`, calls `resize` from a ResizeObserver, and calls `render` once per animation frame.

**Frames and units.** All data is T-frame. Convert only here, with `src/render/convert.js`: `t2v(x,y,z) = [-x, z, y]` (positions AND directions), a T-frame CCW angle `a` is `mesh.rotation.y = +a`, the table centre in Three.js is `x=0, z=0.5`.
Heights come from `HEIGHTS` (`src/data/heights.js`, SPEC 3.6).

**Camera (SPEC 1.4) - mode `'original'` is the default and must match `research/layout_map.png`.**
```js
const S = canvasWidth / 365;                       // canvasHeight should be 416*S
camera = new THREE.PerspectiveCamera(61.505, 366/476, 0.5, 120);
camera.position.set(0, 21.0, 13.5);                // Three axes
camera.up.set(0, 0.406737, -0.913545);
camera.lookAt(0, 21.0 - 0.913545, 13.5 - 0.406737);
camera.setViewOffset(366*S, 476*S, 0, 0, 365*S, 416*S);
```
Never overwrite `camera.aspect` on resize; resize only the renderer and the view-offset window, then `updateProjectionMatrix()`. `camera_math.js` (pure) provides `viewOffsetFor(canvasWidthPx) -> {fullW, fullH, x, y, w, h}` for that call and `projectPoint(x,y,z)`
(= `data.projectToTablePx`), so the camera is unit-tested without three. Shake: `frame.physics.shake` (original px at 365 width) shifts the view offset by `shake*S` pixels. Modes `'top'` (orthographic top-down fitting the playfield) and `'orbit'` (perspective with
`three/addons/controls/OrbitControls.js`, pan disabled; main.js disables mouse flippers while in this mode) are debugging extras.

**What to build (SPEC 3.7, once, from `opts.data`):**
1. Floor plane `x -8..8, y -14..15` textured with `art.floor` (UV via `patchUV`), holes/dark pits for kickouts, sinks and the drain mouth as you see fit.
2. Cabinet walls (1.6 high, outside the rectangle) using `misc.metalSide`.
3. Every island wall of `WALLS` extruded to `top` (`geom/extrude.js`), red-edged silver tops (`misc.wallTop`), rubbers (`misc.rubber`); posts (`POSTS`) as cylinders with a red band and silver cap.
4. The ramp + deck + rails as ONE mesh from the visual height field (`geom/deck.js`: exact plane height inside a ramp triangle, `1.068` on the deck, 0.45 margin blend), textured with `art.deck`; deck walls 306-309 and posts 326-328.
5. Components at their exact coordinates: attack/launch bumpers (drum, star ring `misc.bumperStar` tinted by `bumperRingColor(kind, level)`, cap), 9 drop targets, 13 spot targets, 2 slingshot bodies + rebounders, flippers (tapered capsule pivot radius 0.311 / tip 0.193, thickness 0.36), plunger rod, 2 kickback plates + rods, 2 gates, centre post, flag spinners, one-way wires (visible ones only), rollover inserts (a_roll9 hexagon), kickout/sink housings, hidden-tube hoods.
6. 139 lamp overlays, one per lamp that has a position (all but `lite192`; see "Lamp overlays" below), ball meshes, ball contact shadow, lights (ambient + a key directional + soft fill), optional bloom, background black.
Use `MeshStandardMaterial`/`MeshBasicMaterial` freely; keep draw calls < 250 and triangles < 250k. If a `misc` texture key is missing use a flat colour from `PALETTE` (**RENDER must tolerate missing `misc` keys and an empty `lampAtlas.cells`**).

**Per-frame state read from `RenderFrame` (nothing else is read):**

| source | visual |
|---|---|
| `physics.balls[i]` | chrome sphere (radius 0.3) at `t2v(x,y,z)` (pool of >= 4 meshes keyed by `id`); `visible:false` hides it; rolls by rotating about the axis perpendicular to its velocity by `distance/R`; contact shadow decal on the floor under it (fades with `z`) |
| `physics.flippers[name].angle` | flipper group at the pivot, `rotation.y = angle` |
| `physics.plunger.pull` | rod translated by `+pull * 1.0` along T `+y` (away from the playfield) |
| `physics.popups[n].up` | slab top 0.70 when up, -0.05 (flush) when down (60 ms ease) |
| `physics.solos[n].flash` | target face brightness pulse |
| `physics.bumpers[n].hit` | cap depresses by `capTravel`, ring brightens (0.1 s) |
| `physics.rebounders[n].flash` | rubber band brightens |
| `physics.kickbacks[n].kicked` | kick rod extended |
| `physics.gates[n].enabled` | flap visible/solid vs hidden |
| `physics.blocker.up` | post raised to 0.7 / lowered (0.1 s ease) |
| `physics.flags[n].angle` | panel rotates about its line axis |
| `physics.kickouts[n]`, `sinks[n].occupied`, `rampHole` | pit glow / ball inside (optional) |
| `physics.rolloverSprites.a_roll9.lit` | hexagon insert lit |
| `physics.tiltLocked` | optional dimming |
| `physics.shake` | camera view-offset shake |
| `rules.bumperLevels` | bumper ring colour per level |
| `lamps.lit[name]`, `lamps.onIdx[name]` | lamp overlay visibility and atlas cell |

**Lamp overlays.** One mesh with 139 quads (a single draw call; `lite192` has no position and no overlay) built from `LAMPS`: quad centred at `t2v(pos, z)`, lying flat (normal up), size `LampDef.size`, rotated about the vertical axis by `rot` (T-frame CCW), textured with the lit sprite of `art.lampAtlas.cells[name]` (or `cells[name+'#'+onIdx]` for the
3-image lamps `lite2/3/4`); per-vertex alpha 1 when `lamps.lit[name]` else 0; update only when `lamps.version` changed (plus `onIdx` changes). Additive or alpha blending, `depthWrite:false`, `toneMapped:false` so lit lamps read as emissive; the unlit look is already in the floor texture.

**Robustness.** If WebGL is unavailable `createRenderer` must not throw: return a Renderer whose canvas shows the message "WebGL is not available" and whose `render` is a no-op. `dispose()` releases GPU resources. `setQuality({dprMax})` caps the device pixel ratio (default 2).

**Pure helpers (Node-testable, no `three`):** `convert.js` (`t2v v2t angleToRotY`), `camera_math.js` (`viewOffsetFor projectPoint`), `geom/extrude.js`, `geom/deck.js`. `MeshData = {positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint32Array}` in **T-frame** coordinates
(`x, y, z=height`); the scene code converts. `extrudePolygon(pts, z0, z1, {capBottom=false, uv?}) -> MeshData` handles concave simple polygons of either winding (`polygonArea` is the signed shoelace). `deckHeightAt(x, y, data)` returns the surface height of SPEC 3.5.2;
`buildDeckMesh(data, {cell = 0.1}) -> MeshData` triangulates the cells whose centre is inside shell 103 and adds the rail extrusion (`HEIGHTS.rampRailAbove`).

**RENDER acceptance tests (`tests/render.test.mjs`, RENDER, pure parts only):** `t2v/v2t` round trip and the SPEC 1.2 rotation identity (rotating a T-frame vector by `a` equals rotating `t2v(v)` about Three's Y by `a`); `projectPoint` checkpoints of App. D #1 (flipper pivot -> (132.6, 384.3), plunger rest -> (319.5, 343.4), four corners);
`viewOffsetFor(365) = {fullW 366, fullH 476, x 0, y 0, w 365, h 416}` and scales linearly; `polygonArea` signs for the SPEC 3.1 islands/shells; `extrudePolygon` of a square and of a concave polygon (vertex/triangle counts, all normals unit, total top-cap area equals the polygon area);
`deckHeightAt` equals the exact plane value at ramp triangle centroids (SPEC 3.5.1), `1.068` at a deck point, and is continuous across the footprint boundary within 0.05; `buildDeckMesh` is watertight enough (no NaN, indices in range). Visual checks happen in the browser (INTEGRATOR screenshots vs `layout_map.png`).

### 9.2 ART (`src/render/art/**`, owner ART)

```js
/** @param {DataModule} data @param {{createCanvas:(w,h)=>CanvasLike, seed?:number, quality?:'high'|'normal'|'low'}} opts @returns {ArtPack} */
export function paintAll(data, opts) {}
```
Pure given `createCanvas` (browser: `document.createElement('canvas')`; tests: `tests/helpers/fake_canvas.mjs`). **All randomness comes from `mulberry32(seed)`** (`rng.js`, default seed 1995); the same seed must give identical drawing operations (`opsDigest`).
No images, no fonts to load, no `window`/`document`, no network. Only the **canvas 2D API subset** `CANVAS_API` exported by `tests/helpers/fake_canvas.mjs` may be used (save/restore/translate/scale/rotate/setTransform, beginPath/moveTo/lineTo/arc/ellipse/rect/closePath/quadraticCurveTo/bezierCurveTo,
fill/stroke/clip, fillRect/strokeRect/clearRect, fillText/measureText, drawImage (canvas -> canvas only), createLinearGradient/createRadialGradient, getImageData/putImageData/createImageData, setLineDash; properties fillStyle, strokeStyle, lineWidth, lineCap, lineJoin, globalAlpha,
globalCompositeOperation, font, textAlign, textBaseline, shadowColor/Blur/OffsetX/OffsetY, imageSmoothingEnabled). Budget: `paintAll` <= 1.5 s in a desktop browser at `'normal'`.

`ArtPack` (types.js):

| member | content |
|---|---|
| `floor` | `CanvasPatch`: whole playfield rect `x[-8,8] y[-14,15]`, width 2048/1536/1024 px for `high/normal/low`, height `round(width*29/16)`. The look of SPEC 6.8 painted as seen from above: deep navy field with teal veins and star specks, central ring emblem (cyan disc, dark-red centre dot r 0.3 at (0,6), brown rim, 9 orange + 18 blue ring lamps' unlit insets), nebula glows, copper plunger lane/orbit/hyperspace chute, black apron triangles with red outlines, red patch with grey starfighter, rocket arrow, asteroid cluster, blue X, flipper inlane slopes, slingshot decals' unlit art, and the **dim unlit insets of every floor lamp** (`LampDef.z < 1`) drawn with `drawLampShape(..., 'unlit')` |
| `deck` | `CanvasPatch` over the bounding box of shell 103 (`rect {xMin 1.04, xMax 7.65, yMin -2.06, yMax 7.94}`), width = floor width / 2: lilac chevron ramp bands, pink tongue at the low mouth, deck lilac with dark red-brown rim, **unlit insets of the deck lamps** (`z >= 1`) |
| `lampAtlas` | `LampAtlas`: uniform square cells (128 px, 64 px at `'low'`), 12 per row, row-major in `LAMP_NAMES` order, with the extra images `lite2#0..#2`, `lite3#0..#2`, `lite4#0..#2` instead of `lite2/3/4` (145 cells = 139 positioned lamps with `lite2/3/4` expanded to 3 images each); each cell is the **lit** sprite (colour from `LampDef.colors[i].lit`, glow, alpha-keyed); the cell is stretched by RENDER onto a quad of `LampDef.size`, so ART draws the shape pre-compensated for the aspect ratio `size[0]:size[1]`; `cells[key] = {u0,v0,u1,v1,w,h}` with `v` in the flipY convention of `patchUV` |
| `misc` | named small canvases, keys in 9.3 |
| `panel` | 203x394 static scoreboard art (SPEC 6.3): bezel `#888888` with highlight/shadow, the three black boxes (rects in 8.3), an ORIGINAL logo (starfield, small green planet, pale-violet bubble lettering "SPACE CADET" and a smaller blue-violet "3D PINBALL", an original friendly pilot-in-saucer drawn in our own style, orange flame), the dark-red word BALL left of the ball digit. No digits/messages |

**`mapping.js` (REAL, shared with RENDER):** `FLOOR_RECT`; `patchPx(patch, x, y) -> [px, py]` with `px = (xMax - x)/(xMax-xMin)*width`, `py = (y - yMin)/(yMax-yMin)*height` (so the canvas looks exactly like the table seen from above by the player: x=+8 is at the left edge); `pxToTable`; `patchUV(patch, x, y) -> [px/width, 1 - py/height]`;
`patchScale(patch)` px per unit. `palette.js`: `PALETTE`, `BUMPER_RING_COLORS`, `bumperRingColor(kind, level)` (may be extended). `lamps.js`: `drawLampShape(ctx, def, state: 'unlit'|'lit', pxPerUnitX, pxPerUnitY)` - one function used by the floor/deck painters (unlit) and the atlas (lit) so inset and overlay align.

### 9.3 `ArtPack.misc` keys (exact; sizes in px; RENDER tolerates missing keys)

| key | size | content |
|---|---|---|
| `ballEnv` | 512x256 | equirectangular room/studio environment for the chrome ball (RENDER maps it with `EquirectangularReflectionMapping`) |
| `metalSide` | 256x256 | tileable dark brushed metal `#484848/#383838` (cabinet and wall sides) |
| `wallTop` | 128x128 | silver top face with a red `#c41315` edge stripe |
| `rubber` | 128x128 | red rubber band (slingshots, rebounders) |
| `postBand` | 64x64 | red post band with highlight |
| `bumperDrum` | 256x128 | white drum `#e5d9d0` shading |
| `bumperStar` | 256x256 | WHITE seven-point star ring on transparent (RENDER tints it) |
| `bumperCap` | 128x128 | dark-blue cap `#0b1a86` radial |
| `targetYellow` | 128x64 | bright yellow `#faf947` tile with a tan frame |
| `flagPanel` | 128x64 | cream flag panel |
| `flipperBody` | 256x64 | light-grey flipper top with red-pink `#e85050` rim (long axis = u) |
| `rampSide` | 128x128 | dark purple-black side tube |
| `plungerRod` | 64x256 | chrome rod |

**ART acceptance tests (`tests/art.test.mjs`, ART):** `paintAll(data, {createCanvas, seed:1, quality:'low'})` returns the full `ArtPack` shape; floor/deck patch sizes and rects; `lampAtlas.cells` has 145 keys, all `u0<u1`, `v0<v1`, inside [0,1], no overlaps; every `misc` key of 9.3 present with the stated size;
panel 203x394; **determinism** (`opsDigest` equal for equal seeds, different for different seeds); only `CANVAS_API` methods/properties are used (run with the strict fake canvas, which throws on anything else); `patchPx/pxToTable/patchUV` round trips and the floor corners; `drawLampShape` draws for every lamp in both states;
`mulberry32` reproducible; no external resource strings (`http`, `data:image`) in the module sources.

---

## 10. Audio (`src/audio.js` + `src/audio/**`, `sounds/`, owner AUDIO)

Implements SPEC 7 with the task's **sound policy** (it overrides SPEC 7.5). The original sounds are never bundled or committed; they are fetched/loaded into the visitor's browser only. If nothing loads, the game is silent **with identical gameplay timers** because every duration
comes from the manifest table (`src/data/sounds.js`), never from a decoded buffer.

```js
/** @param {{fetch?: typeof fetch, AudioContext?: typeof AudioContext, sha1?: (buf: ArrayBuffer) => Promise<string>, data?: DataModule}} [opts] @returns {Audio} */
export function createAudio(opts = {}) {}
```
Importable in Node (touch `fetch`, `AudioContext`, `crypto.subtle`, `indexedDB` only inside methods, and only through the injected opts when given).

### 10.1 `Audio` surface (types.js) - semantics

| member | semantics |
|---|---|
| `play(key) -> number` | **always** returns `soundDuration(key)` (seconds; `-1` for a key whose file is missing or unknown), never throws; plays the buffer only if audio is unlocked, loaded for that file, enabled and not paused. The same method satisfies `SoundPort` for rules |
| `durationOf(key)` | `soundDuration(key)` |
| `unlock()` | create/resume the `AudioContext`; **must be called synchronously inside a user gesture** (the start button); idempotent; resolves even when audio is impossible |
| `load()` | run the loader (10.2) over the 41 files (+ the MID only if music was ever requested), decode into `AudioBuffer`s keyed by upper-case file key, update status; never rejects |
| `loadFromFiles(files)` | user's own folder/zip (10.5); fills only files whose bytes validate; merges with what is already loaded |
| `setEnabled(on)` / `isEnabled()` | master "Sounds" switch (persisted by main.js) |
| `setVolume(v)` | 0..1 master gain |
| `setPaused(on)` / `stopAll()` | pause silences and suspends the context; `stopAll` stops every voice |
| `update(dt)` | per-frame housekeeping (voice expiry, status flush); cheap |
| `getStatus()` / `onStatus(cb)` | `AudioStatus {state, loaded, total, source, text}`; `text`: `'sound: not loaded'`, `'sound: loading 12/41...'`, `'sound: original (local\|Internet Archive\|your files\|mixed)'`, `'sound: partial (n/41)'` |
| `music` | `{available(), setEnabled(on) -> Promise, pause(), resume(), stop()}` (10.4) |

### 10.2 Loading policy (`sources.js`, `validate.js`, `loader.js`, `cache.js`)

Per file (`SOUND_FILES` keys + `fileNameOf`), concurrency 4:
1. `candidateUrls(fileKey, {music})` returns, in order, `local` (upper-case then lower-case file name: `./sounds/SOUND1.WAV`, `./sounds/sound1.wav`), `S1` (archive zip route), `S5` (archive loose route; **never for the MID**). `NEVER_FETCH` names are never requested. A `404` (or any non-2xx) on a source => try the next source for that file immediately (a 404 is not retried).
2. Network errors/5xx: up to 2 retries with 0.5 s then 1.5 s backoff on the SAME source, then the next source. `fetch(url, {mode:'cors', credentials:'omit', cache:'force-cache'})` for remote sources; `{cache:'no-cache'}` is fine for `./sounds`.
3. **Accept bytes only if `byteLength === SOUND_FILES[k].bytes` AND the SHA-1 equals `sha1`** (`crypto.subtle.digest('SHA-1')`, injectable). Anything else (HTML error page, LFS pointer, truncated body, a different edition's file) is discarded and the next source is tried.
4. Optional IndexedDB cache (`cache.js`: `get(key)`/`put(key, buf)` keyed `name+sha1`) wrapped in try/catch; absent IndexedDB => no-op.
5. Decode with `ctx.decodeAudioData(buf.slice(0))`; on the first decoded file read the RIFF `fmt ` chunk and `console.info` it (expected PCM, 1 ch, 11025 Hz, 8 bit); never use `AudioBuffer.duration` for gameplay.
6. All sources failed for every file => state `'unavailable'`, game continues silent. Partial success => `'partial'`.

`loadSounds({fetchImpl, sha1Fn, data, onProgress, concurrency, music}) -> Promise<{files: Map<string, ArrayBuffer>, music: ArrayBuffer|null, sources: Record<string, 'local'|'S1'|'S5'>}>` is pure (no AudioContext) so it is fully testable with a fake `fetch`.

### 10.3 Mixer (`mixer.js`)

`class Mixer { constructor({ctx, maxVoices = 8}); play(buffer, {gain = 1}); setVolume(v); stopAll() }`: one `AudioBufferSourceNode` per play, never looped, **at most 8 simultaneous voices (when full stop the OLDEST)**, master gain + a separate music gain. No panning (SPEC: default off). Takes the context by injection, so it is testable with a fake.

### 10.4 Music (`midi.js`, `music.js`) - optional, default OFF

`PINBALL.MID` (`MUSIC_FILE`) from `./sounds/` or S1 only (never S5, SHA-1 validated). Playback is a **built-in synth**: `parseMidi(buf) -> {ticksPerBeat, events: [{t (s), ch, type, a, b}], duration}` (SMF type 0/1, tempo map honoured, running status, meta events skipped) and `createMusic({ctx, ...})`
schedules sine/triangle/square oscillator notes (+ noise for channel 10 percussion) with a look-ahead scheduler, looping forever. No third-party scripts, no soundfont. `music.setEnabled(true)` loads the MID lazily; if anything fails it stays silent and `available()` is false.
Music starts at New Game when enabled, pauses on pause/focus loss, resumes on resume (main.js calls `pause()/resume()`).

### 10.5 User files (`zip.js`, `userfiles.js`)

`pickSoundFiles(fileList | File[]) -> Promise<Map<string, ArrayBuffer>>` keyed by upper-case file key (`SOUND49D`, `PINBALL`): accepts the files of a picked folder (`webkitdirectory`), loose files, and `.zip` archives (expanded with `readZip`); a file name matches
`/(^|[\\/])(sound\d+d?\.wav|pinball\.mid)$/i` on its base name (ignore any `SOUND\` sub-folder prefix and case). `readZip(buf) -> Promise<Map<lowerCaseBaseName, ArrayBuffer>>`: central-directory reader, methods stored(0) and deflate(8) via `DecompressionStream('deflate-raw')`; **no third-party library**;
corrupt archives resolve to an empty map. Everything is validated like any other source (size + SHA-1) before use. `loadFromFiles` reports `source:'user'` (or `'mixed'`).

### 10.6 Start flow (shared with UI/main, SPEC 6.7)

Overlay shows the consent line; the click on a start button => `audio.unlock()` (sync) then, if the user chose sound, `audio.load()` (async, non-blocking, status pushed to the UI) while the game already starts. The choice is remembered in `Options.soundConsent`.

### 10.7 AUDIO acceptance tests (`tests/audio.test.mjs`, AUDIO)

`candidateUrls` order and case variants, S5 excluded for the MID, `NEVER_FETCH` excluded; `validateBytes` with `node:crypto` SHA-1 (accepts exact, rejects 1-byte change, wrong length, HTML page); `loadSounds` with a fake `fetch`: local 404 -> S1 ok; S1 500x3 -> S5; all fail -> empty result and no throw; retry/backoff
counts (inject a fake timer/`sleep`); concurrency <= 4; progress callback; `Mixer` voice stealing with a fake context; `play(key)` returns the manifest duration for all 55 keys (and `-1` for missing-file keys) in every state (not unlocked, disabled, loaded); `parseMidi` on a synthetic SMF (tempo change, running status);
`readZip` on a small stored+deflate zip built in the test with `node:zlib`; `pickSoundFiles` name filtering; `createAudio` is importable and usable in Node with no globals; status text strings.

---

## 11. Input (`src/input.js`, owner INTEGRATOR)

```js
/** @param {{onEvent:(e:InputEvent)=>void, target?:Window|EventTarget, bindings?:Bindings, doc?:Document}} opts @returns {Input} */
export function createInput(opts) {}
export function createCheatMatcher() {}          // { feed(ch) -> CheatWord|null, reset() }
export const CHEAT_WORDS = ['hidden test', 'gmax', '1max', 'bmax', 'rmax', 'easy mode'];
```
Safe to import in Node (no DOM at import; `window`/`document` only through `opts` or inside `attach`). `Input` surface: `attach()`, `detach()`, `getBindings()`, `setBindings(b)`, `defaultBindings()` (= `DEFAULT_KEYS`), `setBlocked(bool)`, `releaseAll()`, `setDebug(bool)`, `setPointerFlippers(bool)`.

### 11.1 Mapping

| source | `InputEvent` |
|---|---|
| keydown/keyup of `bindings.flipperLeft` (default `KeyZ`), `flipperRight` (`Slash`), `plunger` (`Space`), `nudgeLeft` (`KeyX`), `nudgeRight` (`Period`), `nudgeBottom` (`ArrowUp`) | `{kind:'game', action, down}` - **key repeat ignored** (only the first keydown counts), `preventDefault` on bound keys |
| `F2` / `Enter` / `F3` / `F4` / `F5` / `F6` / `F8` / `F1` / `KeyV` (keydown only) | `{kind:'app', action: 'newGame' / 'launchBall' / 'pause' / 'fullscreen' / 'sounds' / 'music' / 'controls' / 'help' / 'camera'}` (`preventDefault` so the browser's own F-key behaviour does not fire) |
| typed printable characters (lower-cased `event.key`; `Tab` counts as a space) | fed to `createCheatMatcher`; a completed word emits `{kind:'cheat', word}`. The matcher keeps a **rolling 11-character buffer** and compares its tail with each word; the buffer resets on `reset()` and when blocked |
| while debug is on: `KeyH KeyR KeyB KeyS KeyI KeyJ KeyY` | `{kind:'debug', key}` (these keys do not feed the cheat buffer in debug mode) |
| mouse (over `#table-view`): button 0 = left flipper, button 2 = right flipper, button 1 = plunger; touch: left half of `#table-view` = left flipper, right half = right flipper | `{kind:'game', ...}` unless `setPointerFlippers(false)`; context menu suppressed over the table |
| debug mode: pointerdown/move/up on `#table-view` | `{kind:'pointer', phase, clientX, clientY, button}` (instead of flipper mapping) |
| `[data-action]` / `[data-app]` buttons inside `#touch-controls` (pointer events, delegated) | `{kind:'game', action, down}` / `{kind:'app', action}` (8.7) |
| window `blur` / `visibilitychange: hidden` | `releaseAll()` (emits `down:false` for every held game key); main.js then pauses |

Cheat words are ignored while a bound gameplay key has been changed from its default to a letter that appears in the word (SPEC 6.9: "ignored if a gameplay key is rebound to a letter used in the word"; with the default bindings all six words work although `x` is also the left-nudge key).
`setBlocked(true)` (a dialog or text field is open): no game, app, cheat or debug events are emitted, and keys are not `preventDefault`ed except `Escape` handling by the dialogs themselves.

### 11.2 Nudge semantics (who does what)

Input emits only `nudgeLeft|nudgeRight|nudgeBottom` down/up. `rules.input` applies the gating (7.8) and calls `physics.nudge(dir, down)`; physics applies the velocity change, the 0.4 s undo, the shake offset and the tilt counter (5.3, 4.3). `X` = "left table bump" (`dir 'left'`, T-frame velocity `+1.0,+0.5`), `.` = right (`-1.0,+0.5`), Up arrow = bottom (`0,+0.5`).

### 11.3 INTEGRATOR tests for input

Cheat matcher (each word completes once; TAB for the space in `hidden test`; a partial word + wrong char resets; rolling buffer length 11); key mapping with a fake `EventTarget` (repeat ignored, blocked mode, bindings changes, `releaseAll`, app keys, pointer mapping, touch delegation, debug mode).

---

## 12. Main loop, clocks, pause, demo, start flow

### 12.1 Clock ownership

* **One simulation clock**, owned by `game.js`: whole steps of `PHYS.dt = 1/120 s`, accumulator `acc += min(frameDt, 0.1)`, `while (acc >= dt) step()`. Physics, rules (scheduler + text boxes) and lamps are driven only by `step()`; none of them reads a wall clock.
* The renderer, UI (toasts) and audio housekeeping use the frame `dt` and run once per animation frame; nothing in the sim depends on the display rate. Presentation only: `game.buildRenderFrame` blends each ball in the snapshot between its position before the last step and after it by `acc/dt` (never more than one step behind; teleports > 1.5 u in a step and balls without a previous record are not blended; a bare `game.step()` shows the newest state), so 144/165 Hz screens and jittery 60 Hz frames move smoothly. `physics.balls` and every later `snapshot()` call stay exact.
* `game.step()` order (frozen, implemented in `src/game.js`):
  1. `physics.step(dt)`
  2. `rules.onPhysicsEvents(physics.drainEvents())`
  3. `rules.tick(dt)`    (scheduler + text boxes)
  4. `lamps.advance(dt)` (lamp hooks may call back into rules; allowed)
* Per animation frame (`main.js`), in this order: **input** (DOM event handlers have already called `rules.input` / `cheat` / actions synchronously between frames) -> `game.advance(frameDt)` (steps 1-4, repeated) -> `audio.update(dt)` -> `renderer.render(game.buildRenderFrame(dt))` -> `ui.update(rules.getView(), dt)`.
  (The task's order "input -> physics -> rules timers -> lamps -> audio -> render -> ui" is exactly this.)

### 12.2 Pause, focus, auto-pause

* `game.setPaused(true)`: `advance()` runs no steps (so physics, rules timers and lamps freeze), `rules.setPaused(true)` shows "Game Paused\nF3 to Resume"; `main.js` also calls `audio.setPaused(true)` and `audio.music.pause()`. Rendering and UI continue (so the message and menus update).
  Resume: `rules.setPaused(false)` shows "Continue Play" 5 s (or "F2 Starts New Game" at game over); the accumulator is cleared.
* Window blur / tab hidden: `input` first calls `opts.onFocusLoss` (= `rules.focusLost()`: flippers up, a manually pulled plunger goes back WITHOUT firing; a ball-save relaunch keeps charging), then `input.releaseAll()`, then `game.setPaused(true)`. Regaining focus does not resume by itself (F3 / menu does).
* Opening a modal dialog during a running game (not demo) auto-pauses; closing it resumes only if the dialog caused the pause.
* `newGame` while paused unpauses.

### 12.3 Demo mode

`rules.setDemo(true)` (menu Game > Demo, `?demo`, or `actions.toggleDemo`): rules start a demo game, `physics.setDemoTriggers(true)`; `demoTrigger` events schedule flipper/plunger presses through the rules' `Scheduler` and `physics.setFlipperButton/setPlungerButton` (never through `rules.input`, which blocks input in demo). Demo restarts itself 5.0 s after game over until switched off.

### 12.4 Start flow (SPEC 6.7)

`main.js` boots with the start overlay (`ui.showStartOverlay`); nothing runs until the user clicks (so audio can unlock). `actions.start({withSound, players, music})` => persist options, `audio.setEnabled/unlock/load`, hide overlay, `rules.newGame({players})` (light show 5.045 s, then ball 1). `F2` / `Game > New Game` restarts at any time.
URL flags (all optional): `?demo`, `?seed=<int>` (seeded rand for reproducible runs), `?camera=original|top|orbit`, `?nosound`, `?quality=low`, `?touch=1`, `?debug=1` (turns on `rules.setDebug` and `input.setDebug`).

### 12.5 Debug handle

`window.__pinball = { game, physics, lamps, rules, audio, ui, renderer, input, data, store, art }` - the only global; set by `main.js`, read by nobody.

### 12.6 Performance targets

60 fps on a mid laptop at 1280x720 with one ball: `game.advance` <= 2 ms, `render` <= 6 ms, `ui.update` <= 0.3 ms (no DOM writes when nothing changed). `paintAll` <= 1.5 s. First paint of the start overlay <= 1 s after the page loads (art painting may run before the overlay is shown but must not block it for more than that).

---

## 13. Test conventions

### 13.1 Runner and layout

* `node:test` + `node:assert/strict`, files `tests/<role>.test.mjs` (plus optional `tests/<role>_<topic>.test.mjs`), ES modules, imports with explicit relative paths (`../src/physics.js`). Node 24 only; no test dependencies.
* Commands (project root): `npm test` = `node --test "tests/**/*.test.mjs"`; one role: `node --test tests/physics.test.mjs`; architecture guard: `npm run test:arch`; final gate: `ARCH_STRICT=1 node --test "tests/**/*.test.mjs"`
  (PowerShell: `$env:ARCH_STRICT=1; node --test "tests/**/*.test.mjs"`). **`node --test tests/` fails on Node 24** (the directory is loaded as a module); never write that command anywhere.
* A test file must pass **alone** (no ordering between files), run in < 10 s (physics soak tests <= 20 s), use no network, no real timers (`setTimeout`), no `Date.now`, no `Math.random`. Randomness comes from `tests/helpers/seeded_rand.mjs`
  (`mulberry32(seed)`; `constantRand(0.5)` removes the physics jitter). Time comes from `physics.step(dt)`, `lamps.advanceMs(ms)`, `rules.tick(dt)`, `audio` fake timers, `game.advance(dt)`.
* Reading `research/*.json` from a test via `fs` is allowed only in DATA and PHYSICS tests (cross-checks). Never from `src/`.
* Doubles: `tests/helpers/fake_physics.mjs` (records commands, injects events), `tests/helpers/fake_canvas.mjs` (recording `CanvasLike`, `strict` mode whitelists `CANVAS_API`), `SILENT_SOUND` or a recording `SoundPort` `{play(key){calls.push(key); return soundDuration(key)}}`.
* Each stub already imports in Node; a role's tests may therefore be written against the stubs on day one and turn green as the implementation lands.

### 13.2 Acceptance tests per role (details in the role's section)

| role | file | key tests (SPEC Appendix D where it applies) |
|---|---|---|
| DATA | `tests/data.test.mjs` | 3.10: counts, shoelace/solid, edges == physics_data, outline orientation, projection checkpoints (D#1), sounds manifest, ramp planes/forces, frozen, lamp/group integrity |
| PHYSICS | `tests/physics.test.mjs` | 5.6: installer == data, `basicCollision` examples, free fall (D#2), plunger table (D#3), flipper (D#4), ramp (D#5), kickouts/sinks (D#6), components, tilt/nudge (D#10), stuck ball, determinism, snapshot shape |
| LAMPS | `tests/lamps.test.mjs` | 6.7: T1-T6 (D#9), fuel timeline (D#7), group verbs, hooks/re-entrancy, view, per-player |
| RULES | `tests/rules.test.mjs` | 7.10: skill shot 75,000 and lane/bank scoring (D#8), flow/drain/ball save/game over, missions/ranks/fuel/wormholes/hyperspace, tilt, text boxes, input gating, sound dispatch, cheats, demo, every event type accepted |
| RENDER | `tests/render.test.mjs` | 9.1: convert, camera_math/projection (D#1), extrude, deck height field |
| ART | `tests/art.test.mjs` | 9.2: ArtPack shape, atlas cells, determinism, canvas API whitelist, mapping |
| UI | `tests/ui.test.mjs` | 8.10: wrapText, formats, glyphs, keyLabel, storage resilience, dotfont/panel with fake canvas |
| AUDIO | `tests/audio.test.mjs` | 10.7: source order, size+SHA-1 validation, loader fallbacks, mixer, durations, MIDI, zip, user files |
| INTEGRATOR | `tests/arch.test.mjs`, `tests/integration.test.mjs`, input tests | 13.3 |

### 13.3 INTEGRATOR tests

* `tests/arch.test.mjs` (written): file/owner/exports/layering/package/index.html/ARCHITECTURE mentions; `ARCH_STRICT=1` fails on remaining stubs and missing role tests.
* `tests/integration.test.mjs` (headless, real modules, `mulberry32(1)`, `SILENT_SOUND`): `createGame` composes; `step()` order proven with spies injected through `opts.factories`; `advance()` clamps to 0.1 s, returns whole steps, runs none while paused; new game -> `phase 'lightShow'` for 5.045 s -> `'playing'`;
  feed -> `plungerFed` -> plunger hold 0.8 s + release -> a ball is in play above the plunger; `forceDrainAll` loops through 3 balls to `gameOver`; deterministic replays (same seed + same input script => same score, same event count, same snapshot); `buildRenderFrame` shape (lamps view has 140 keys, physics snapshot keys, rules view);
  1 minute of simulated random flipping with a seeded script never throws and never leaves a ball outside the table rectangle; pause freezes the scoreboard.
* Input tests (`tests/input.test.mjs`): section 11.3.
* Browser smoke (manual or scripted with the Browser pane, not part of `npm test`): serve, load `http://127.0.0.1:8765/`, **no console errors/warnings**, start overlay visible, start a game, screenshot at 1280x720 and 375x667 and compare composition with `research/layout_map.png`, play with keys, nudge/tilt, pause, resize, fullscreen, sound status label.

---

## 14. Coding conventions

* **Language**: ES2022 modules, `'use strict'` implied. Two-space indent, semicolons, single quotes, trailing commas in multi-line literals, max line ~140. No TypeScript, no JSX, no transpile. JSDoc types import from `src/types.js` (`/** @type {import('../types.js').Ball} */`).
* **Names**: files `lower_snake.js`/`lowercase.js`; functions/variables `camelCase`; classes `PascalCase`; frozen data constants `UPPER_SNAKE`; event type strings `camelCase` (`'bumperHit'`); component/lamp names exactly as the DAT (`a_bump1`, `lite56`, `literoll179`); sound keys `UPPER_SNAKE` / `SW3`.
* **Exports**: named exports only (no `default`); factory functions `createX`; classes only where the contract says (`TimerWheel`, `Lamp`, `LightGroup`, `LightBargraph`, `Scheduler`, `TextBoxQueue`, `HighScoreTable`, `Mixer`). Every import has an explicit `.js`/`.mjs` extension.
* **Frames and units**: everything is T-frame (`+x` = screen-LEFT, `+y` toward the player, `+z` up), table units, **seconds**, **radians**; angles CCW-positive in the T-frame. Convert to Three.js only in `src/render/` (`t2v`) and to pixels only in `src/render/art/mapping.js` / the camera. Never mix; comment any conversion.
* **Time**: sim code never calls `Date.now`, `performance.now`, `setTimeout`, `setInterval`, `requestAnimationFrame`. Time enters only through `step(dt)`, `advance(dt)`, `tick(dt)`, `advanceMs(ms)`. Lamps use integer ms; everything else float seconds.
* **Randomness**: only the injected `rand` (`() => [0,1)`); `Math.random` only as the default value of that option in the factories and in `main.js`.
* **State and globals**: no module-level mutable state (put it in the factory closure/class instance); no globals except `window.__pinball` set in `main.js`; no side effects at import (no DOM/`localStorage`/`AudioContext`/`fetch` access at import time).
* **Immutability**: `src/data/**` is deep-frozen and must never be mutated; copy before changing. Snapshots/views are the opposite: stable objects updated **in place** (document it; never hold references across frames; never allocate per frame in hot paths).
* **Errors**: fail fast (`throw new TypeError(...)`) on programmer errors (unknown lamp/group/component name, bad argument types in factories); never throw on runtime conditions (404, no WebGL, no storage, no audio, tilted input). `console.error` only for genuine bugs; `console.info/warn` sparingly; the page must start with a clean console.
* **Allocation**: no per-frame / per-step allocation of arrays and objects in physics, lamps, rules ticks and render (reuse buffers); event objects are the exception.
* **Accessibility/UX**: keyboard operable menus and dialogs, visible focus, `aria-live` for the scoreboard text, `prefers-reduced-motion` respected for UI animations (not for the game).
* **Licensing**: no copied game bitmaps/code; paraphrase from the SPEC; credit text only where the About dialog says.
* **Comments**: header block on every file (`OWNER`, `STATUS`, `CONTRACT`, `ASSUMPTIONS`), JSDoc on every export; reference SPEC sections (`SPEC 4.9.6`) where behaviour is non-obvious.
* **Dependencies**: none. Three.js 0.160.0 via import map only (RENDER). No other CDN script/stylesheet/font anywhere (all UI fonts are system fonts).

---

## 15. Delivery protocol

### 15.1 Phases

0. **Architect (done)**: this file, stubs, `types.js`, seeded data, helpers, `tests/arch*`, `index.html`, `css/style.css`, `package.json`.
1. **Parallel implementation**: each role replaces its stubs (keeping every export), writes `tests/<role>.test.mjs`, keeps `npm test` green. Roles do not wait for each other: every cross-role call has a stub that returns a valid value, and `tests/helpers` provide doubles.
2. **Integration (INTEGRATOR)**: wire `main.js`, finish `input.js`, run `ARCH_STRICT=1 npm test`, fix seams by *adapting main/game* (never by editing another role's file), then browser verification (13.3).
3. **Polish**: visual comparison with `layout_map.png`, feel tuning within the SPEC's [X] freedoms only, performance pass.

### 15.2 Definition of done (per role)

* All exports of your files in `tests/arch_manifest.mjs` exist with the contracted signature; header `STATUS: IMPLEMENTED`; `ASSUMPTIONS:` documented; your acceptance tests (section 13.2) pass; `node --test` is green for the whole repo.
* No stub behaviour left (`throw new Error('NOT_IMPLEMENTED')` and `void [..]` placeholders gone); no TODOs that change behaviour.
* Hand-off note: what is done, assumptions, deviations from SPEC (with the SPEC section), anything another role must know.

### 15.3 Change protocol

Additive changes in your own files: free. Additive exports/typedefs elsewhere: ask the INTEGRATOR through the hand-off note (they edit `types.js`/manifest). Renames/removals/signature changes of anything in sections 2-12: **forbidden**. Conflicts between roles are resolved by this file; where it is silent, by the SPEC; where both are silent, by the gap protocol (0.3).

### 15.4 Known traps (read before coding)

1. `node --test tests/` does not work on Node 24 (13.1).
2. `+x` is the screen-LEFT. `a_flip1`, `a_kick1`, `v_gate1`, `a_roll4`, `lite30` are on the screen-left; "left/right" in rule texts is the player's point of view.
3. The table outline lines must be oriented **inward** (3.3) - the DAT order points them outward.
4. Wall normals: `n = (dy, -dx)/len`; a line only blocks a ball moving against `n`; polygons of area S>0 are islands (ball outside), S<0 shells (ball inside). Do not "fix" winding.
5. Edges in the data are already inflated by 0.3; the drain contact line is at `y = 14.137`, the plunger face at `y = 11.675`. Never inflate twice.
6. Collision masks are bit fields; ramp/tube/deck use masks 2/4; seams change the ball's mask; the launch ramp keeps the ball's `z` when it leaves (1.368 on the deck).
7. `lamps.lightOn(L)` (rules logic) differs from `lamps.isLit(L)` (visual) - FORCE_OFF does not count as off for rules.
8. Lamp timers are integer ms and a timeout beats a flash toggle on the same ms; verbs convert with `Math.trunc(seconds*1000)`.
9. All sound durations come from the manifest (`bytes/11000`), never from decoded buffers; a missing file returns `-1` and callers fall back to their defaults (light show 5.0 s, kickout 1.5 s).
10. In-game numbers are plain decimals ("150000"); thousands separators appear only in the high-score list.
11. `export *` silently drops duplicate names: keep data export names unique.
12. The gravity well `a_kout1` starts INACTIVE; the hyperspace and black-hole kickouts are always active (SPEC E4). `v_gate1/2` are OPEN at the start of every ball (SPEC L3). Fuel lamps are all lit at ball start while the fuel LEVEL is 0 (SPEC 5.5 quirk).
13. Do not use `Date`, timers or `Math.random` in sim code; do not allocate per frame.

---

## Appendix A. Decision log (where the architecture chose among SPEC freedoms)

| # | decision |
|---|---|
| A1 | Rules is the single owner of sounds: physics emits events; rules maps them (`SOUND_EVENT_MAP`) and plays script sounds. Physics and lamps never import audio. |
| A2 | Rules never import physics/lamps; they are injected (`createRules`), keeping rules unit-testable with doubles. |
| A3 | Pre-inflated edges ship in `src/data`; the installer is implemented and tested against them instead of being the runtime source. |
| A4 | Lane-change lamp rotation is driven by the `flipper` event (`extend`), so the demo AI rotates lanes exactly like a player. |
| A5 | While tilt-locked, physics still emits trigger events (rollovers, tripwires, flags, one-ways) but never hard-hit events and never kickout/sink captures; RULES ignores triggers while `tilted`. |
| A6 | Sink/kickout follow-ups use `sinkSetRoute` / `kickoutSetHold`, called by rules inside the capture handler (zero simulated time elapsed). |
| A7 | `ballsInPlay()` counts sink-captured balls (they come back) but not a pending feed; `drain.remaining` is that count after removal. |
| A8 | Lamp API names: SPEC `lit/unlit` = `on/off`; `isLit` is visual, `lightOn` is the rules' test; unknown names throw. |
| A9 | Music uses a built-in WebAudio synth (no html-midi-player / Tone / Magenta / soundfont fetch); default OFF. |
| A10 | ZIP import uses `DecompressionStream('deflate-raw')`, no JSZip. Local `./sounds/` probing is per file (upper then lower case), a 404 skips that source for that file. |
| A11 | `UI.setMenuState` of the early draft was replaced by `UI.setOptions(options)` + `UI.update(view)`; dialogs auto-pause the game via `onDialogChange`. |
| A12 | Regaining window focus does not unpause (F3/menu does). |
| A13 | Time Warp reward 2,000,000 (code) rather than 1,500,000 (guide); Fleet Admiral forward just fills/resets the outer ring (SPEC 9 #8). |
| A14 | Multiplayer lamp persistence goes through `lamps.playerChanged` and the end-of-ball reset block runs on the incoming player's lamps (SPEC 5.13.5); only the lamps outside the block persist. |
| A15 | The lamp atlas has 145 cells (139 positioned lamps with `lite2/3/4` expanded to 3 images each); `lite192` has no bitmap and no overlay. |
| A16 | `physics.nudge` flag lifetime = from the nudge until its undo (key release or 0.4 s); `nudgeCount` events are edge-triggered. |
| A17 | URL flags (`?demo ?seed ?camera ?nosound ?quality ?touch ?debug`) exist for reproducible testing; none is needed for normal play. |

---

## Appendix B. `index.html` (verbatim; INTEGRATOR owns it, the ids are frozen)

```html
<!doctype html>
<!--
  index.html - OWNER: INTEGRATOR   STATUS: IMPLEMENTED (skeleton; contract = ARCHITECTURE.md 8.1)
  Mount points only. The UI role fills #menubar, #panel, #touch-controls, #start-overlay, #status-line, #dialog-root and #toast-root
  from src/ui/index.js; main.js appends the renderer canvas to #table-view. Ids and structure are a frozen contract.
  Serve with:  python -m http.server 8765   (from this folder)  ->  http://127.0.0.1:8765/
-->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <title>Star Cadet</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="css/style.css">
  <link rel="stylesheet" href="css/ui.css">
  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
  }
  </script>
</head>
<body>
  <div id="app" class="app">
    <!-- UI fills: <ul class="menu-bar"> Game / Options / Help (ARCHITECTURE.md 8.2) -->
    <nav id="menubar" class="menubar" aria-label="Game menu"></nav>

    <main id="stage-wrap" class="stage-wrap">
      <!-- The 600x416 virtual screen of the original (SPEC 6.1). INTEGRATOR sizes it (css/style.css); children are positioned in % of it. -->
      <div id="stage" class="stage">
        <!-- main.js appends the Three.js canvas here (365:416 area at the left of the stage) -->
        <div id="table-view" class="table-view"></div>
        <!-- UI fills: <canvas id="panel-canvas" width="203" height="394"> + visually-hidden live region #panel-aria -->
        <aside id="panel" class="panel" aria-label="Scoreboard"></aside>
        <!-- UI fills: buttons with [data-action] (touch devices only; see 8.7) -->
        <div id="touch-controls" class="touch-controls" hidden></div>
        <!-- UI fills: start / sound-consent card (SPEC 6.7) -->
        <div id="start-overlay" class="overlay start-overlay" hidden></div>
        <!-- UI fills: "sound: ..." status text and optional fps -->
        <div id="status-line" class="status-line" aria-live="polite"></div>
      </div>
    </main>

    <!-- UI fills: modal dialogs (high scores, name entry, controls, about, help) -->
    <div id="dialog-root" class="dialog-root"></div>
    <!-- UI fills: transient messages -->
    <div id="toast-root" class="toast-root" aria-live="polite"></div>
  </div>
  <noscript>This game needs JavaScript (ES modules) to run.</noscript>
  <script type="module" src="src/main.js"></script>
</body>
</html>
```
