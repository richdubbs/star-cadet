/**
 * tests/arch_manifest.mjs
 * OWNER: INTEGRATOR  (content written by ARCHITECT)
 * STATUS: IMPLEMENTED
 * Machine-readable twin of ARCHITECTURE.md section 1 (file ownership) and section 2 (export lists, layering rules).
 * tests/arch.test.mjs enforces it. Roles ADD files/exports by appending here (additive only) - never rename or remove an entry.
 *
 * FILES entry: { path, owner, exports?: string[], node?: false }
 *   exports  - names that MUST exist on the module namespace (checked by dynamic import)
 *   node:false - not importable in Node (needs DOM/three at import time): existence + header only
 */
const F = (path, owner, exports, extra = {}) => ({ path, owner, exports, ...extra });

export const FILES = [
  // ---- project root --------------------------------------------------------------------------------------------------
  F('ARCHITECTURE.md', 'ARCHITECT'), F('index.html', 'INTEGRATOR'), F('package.json', 'INTEGRATOR'), F('README.md', 'INTEGRATOR'),
  F('css/style.css', 'INTEGRATOR'), F('css/ui.css', 'UI'), F('sounds/README.txt', 'AUDIO'), F('tools/gen_data.mjs', 'DATA'),
  // ---- INTEGRATOR ----------------------------------------------------------------------------------------------------
  F('src/types.js', 'INTEGRATOR', []),
  F('src/main.js', 'INTEGRATOR', [], { node: false }),
  F('src/game.js', 'INTEGRATOR', ['createGame']),
  F('src/input.js', 'INTEGRATOR', ['createInput', 'createCheatMatcher', 'CHEAT_WORDS']),
  F('tests/arch_manifest.mjs', 'INTEGRATOR'), F('tests/arch.test.mjs', 'INTEGRATOR'),
  F('tests/helpers/seeded_rand.mjs', 'INTEGRATOR', ['mulberry32', 'constantRand', 'sequenceRand']),
  F('tests/helpers/fake_canvas.mjs', 'INTEGRATOR', ['CANVAS_API', 'createFakeCanvas', 'createFakeCanvasFactory', 'opsDigest']),
  F('tests/helpers/fake_physics.mjs', 'INTEGRATOR', ['createFakePhysics']),
  // ---- DATA ----------------------------------------------------------------------------------------------------------
  F('src/data/index.js', 'DATA', []),
  F('src/data/freeze.js', 'DATA', ['deepFreeze']),
  F('src/data/constants.js', 'DATA', ['TABLE', 'PHYS', 'MASKS', 'Z', 'CAMERA', 'PANEL', 'DEFAULT_KEYS', 'NAMES', 'TIMING', 'projectToTablePx', 'unprojectFloor']),
  F('src/data/events.js', 'DATA', ['EV', 'EVENT_TYPES']),
  F('src/data/heights.js', 'DATA', ['HEIGHTS']),
  F('src/data/materials.js', 'DATA', ['DEFAULT_MATERIAL', 'DEFAULT_KICKER', 'MATERIALS', 'KICKERS']),
  F('src/data/scoring.js', 'DATA', ['SCORE', 'MULTIPLIERS', 'POTS', 'acceptScoreFor']),
  F('src/data/text.js', 'DATA', ['APP_TITLE', 'fmt', 'INFO', 'MISSION_TEXT', 'RANK_NAMES', 'MISSION_NAMES']),
  F('src/data/names.js', 'DATA', ['COMPONENT_NAMES', 'BANKS', 'LAMP_NAMES', 'LAMP_GROUP_NAMES', 'FUEL_BARGRAPH_NAME', 'ALL_LAMPS_GROUP_NAME']),
  F('src/data/sounds.js', 'DATA', ['SOUND_FILES', 'MUSIC_FILE', 'NEVER_FETCH', 'SOUND_KEYS', 'SOUND_EVENT_MAP', 'SOUND_SOURCES', 'fileNameOf', 'soundDuration', 'SILENT_SOUND']),
  F('src/data/walls.js', 'DATA', ['WALLS', 'POSTS', 'TABLE_OUTLINE']),
  F('src/data/components.js', 'DATA', ['FLIPPERS', 'PLUNGER', 'BUMPERS', 'POPUP_TARGETS', 'SOLO_TARGETS', 'KICKBACKS', 'GATES', 'BLOCKER', 'DRAIN', 'KICKOUTS', 'SINKS', 'RAMP_HOLE', 'ONEWAYS', 'TRIPWIRES', 'ROLLOVERS', 'FLAGS', 'DEMO_TRIGGERS', 'DEMO_TIMERS', 'getComponent']),
  F('src/data/ramps.js', 'DATA', ['RAMPS', 'DECK_FLOOR_POLY', 'RAMP_FOOTPRINT_POLY']),
  F('src/data/lamps.js', 'DATA', ['LAMPS', 'LAMP_BY_NAME', 'LAMP_GROUPS', 'FUEL_BARGRAPH', 'LAMP_HOOK_NAMES', 'LAMP_FLASH_DEFAULT', 'LAMP_FLASH_OVERRIDES']),
  F('src/data/missions.js', 'DATA', ['MISSION_STATE', 'MISSIONS', 'MISSION_SELECT', 'rankGroupOf', 'missionForRank']),
  // ---- PHYSICS -------------------------------------------------------------------------------------------------------
  F('src/physics.js', 'PHYSICS', ['createPhysics']),
  F('src/physics/edges.js', 'PHYSICS', ['NO_HIT', 'makeLine', 'makeCircle', 'edgesFromPlain', 'rayLine', 'rayCircle', 'installWall', 'installLine', 'installCircle']),
  F('src/physics/collision.js', 'PHYSICS', ['basicCollision', 'throwBall']),
  F('src/physics/snapshot.js', 'PHYSICS', ['createSnapshot']),
  // ---- LAMPS ---------------------------------------------------------------------------------------------------------
  F('src/lamps.js', 'LAMPS', ['createLamps']),
  F('src/lamps/wheel.js', 'LAMPS', ['TimerWheel']),
  F('src/lamps/lamp.js', 'LAMPS', ['Lamp']),
  F('src/lamps/group.js', 'LAMPS', ['LightGroup']),
  F('src/lamps/bargraph.js', 'LAMPS', ['LightBargraph']),
  // ---- RULES ---------------------------------------------------------------------------------------------------------
  F('src/rules.js', 'RULES', ['createRules']),
  F('src/rules/scheduler.js', 'RULES', ['Scheduler']),
  F('src/rules/textbox.js', 'RULES', ['TextBoxQueue']),
  F('src/rules/highscores.js', 'RULES', ['HighScoreTable']),
  // ---- AUDIO ---------------------------------------------------------------------------------------------------------
  F('src/audio.js', 'AUDIO', ['createAudio']),
  F('src/audio/sources.js', 'AUDIO', ['candidateUrls', 'resolveSoundData']),
  F('src/audio/validate.js', 'AUDIO', ['validateBytes', 'sha1Hex', 'sha1Js', 'toBytes', 'toArrayBuffer', 'readWavFormat']),
  F('src/audio/loader.js', 'AUDIO', ['loadSounds', 'RETRY_DELAYS_MS']),
  F('src/audio/mixer.js', 'AUDIO', ['Mixer']),
  F('src/audio/midi.js', 'AUDIO', ['parseMidi']),
  F('src/audio/music.js', 'AUDIO', ['createMusic', 'buildNotes', 'instrumentFor', 'LOOKAHEAD_S', 'TICK_MS', 'MAX_VOICES']),
  F('src/audio/zip.js', 'AUDIO', ['readZip', 'inflateRawJs']),
  F('src/audio/userfiles.js', 'AUDIO', ['pickSoundFiles', 'soundKeyForName', 'snapshotDrop', 'attachDropTarget', 'pickDirectory', 'supportsDirectoryPicker', 'SOUND_NAME_RE']),
  F('src/audio/cache.js', 'AUDIO', ['createCache']),
  // ---- ART -----------------------------------------------------------------------------------------------------------
  F('src/render/art/index.js', 'ART', ['paintAll']),
  F('src/render/art/rng.js', 'ART', ['mulberry32']),
  F('src/render/art/mapping.js', 'ART', ['FLOOR_RECT', 'patchPx', 'pxToTable', 'patchUV', 'patchScale', 'DECK_RECT', 'patchHeight', 'lampCellUV']),
  F('src/render/art/palette.js', 'ART', ['PALETTE', 'BUMPER_RING_COLORS', 'bumperRingColor']),
  F('src/render/art/lamps.js', 'ART', ['drawLampShape', 'buildLampAtlas', 'lampKeys', 'lampPatchKey', 'lampInsetBounds', 'paintLampInsets', 'SHAPE_FRAC', 'ATLAS_COLS']),
  F('src/render/art/floor.js', 'ART', ['paintFloor']),
  F('src/render/art/deck.js', 'ART', ['paintDeck', 'rampSides']),
  F('src/render/art/panel.js', 'ART', ['paintPanel', 'panelBoxes', 'LOGO_RECT']),
  F('src/render/art/misc.js', 'ART', ['paintMisc']),
  // ---- RENDER --------------------------------------------------------------------------------------------------------
  F('src/render/index.js', 'RENDER', ['createRenderer'], { node: false }),
  F('src/render/convert.js', 'RENDER', ['t2v', 'v2t', 'angleToRotY']),
  F('src/render/camera_math.js', 'RENDER', ['viewOffsetFor', 'projectPoint']),
  F('src/render/geom/extrude.js', 'RENDER', ['polygonArea', 'extrudePolygon']),
  F('src/render/geom/deck.js', 'RENDER', ['deckHeightAt', 'buildDeckMesh']),
  // ---- UI ------------------------------------------------------------------------------------------------------------
  F('src/ui/index.js', 'UI', ['createUI']),
  F('src/ui/storage.js', 'UI', ['createStore', 'DEFAULT_OPTIONS', 'STORAGE_KEYS']),
  F('src/ui/dotfont.js', 'UI', ['GLYPHS', 'glyphFor', 'drawDotText']),
  F('src/ui/textlayout.js', 'UI', ['wrapText']),
  F('src/ui/format.js', 'UI', ['formatScore', 'formatHighScore']),
  F('src/ui/keylabels.js', 'UI', ['keyLabel']),
  F('src/ui/panel.js', 'UI', ['createPanel']),
  F('src/ui/menus.js', 'UI', ['createMenus']),
  F('src/ui/dialogs.js', 'UI', ['createDialogs']),
  F('src/ui/overlay.js', 'UI', ['createStartOverlay']),
];

/**
 * Files added by the roles beyond the contracted list of ARCHITECTURE.md section 1 (additive internals of the same owner; found at the integration
 * pass).  Same entry shape as FILES.  ARCHITECTURE.md stays frozen, so these are NOT required to be mentioned in it; tests/arch.test.mjs still checks
 * owner headers, exports and layering for them and fails when a file under src/ or tools/ is listed in neither FILES nor EXTRA_FILES.
 * Roles append here when they add a file.
 */
export const EXTRA_FILES = [
  F('src/physics/ball.js', 'PHYSICS', ['Ball']),
  F('src/physics/components.js', 'PHYSICS', ['BlockerComp', 'BumperComp', 'DemoComp', 'DrainComp', 'FlagComp', 'GateComp', 'HoleComp', 'KickbackComp', 'KickoutComp', 'OnewayComp', 'PlungerComp', 'PopupComp', 'RampSeamComp', 'ReboundComp', 'RolloverComp', 'SinkComp', 'SoloComp', 'TripwireComp', 'WallComp', 'buildTable', 'rearmAllRollovers', 'resetTable']),
  F('src/physics/engine.js', 'PHYSICS', ['Engine']),
  F('src/physics/flipper.js', 'PHYSICS', ['Flipper']),
  F('src/physics/ramps.js', 'PHYSICS', ['buildRamp', 'inTriangle', 'orientAgainst', 'planeZ']),
  F('src/physics/timers.js', 'PHYSICS', ['TIMER_EPS', 'Timers']),
  F('src/physics/world.js', 'PHYSICS', ['World']),
  F('src/render/art/decals.js', 'ART', ['EMBLEM', 'LANES', 'paintDecalsOver', 'paintDecalsUnder', 'paintPit', 'scalePoly', 'slotPlate']),
  F('src/render/art/draw.js', 'ART', ['TAU', 'centroid', 'darken', 'disc', 'gauss', 'glowDisc', 'lighten', 'line', 'linear', 'mix', 'ngonPath', 'noShadow', 'parseColor', 'pick', 'pointInPoly', 'polyFill', 'polyPath', 'polyStroke', 'radial', 'radial2', 'resample', 'rgb', 'rgba', 'ri', 'ring', 'rr', 'rrectPath', 'smoothClosedPath', 'smoothOpenPath', 'starPath', 'tableSpace']),
  F('src/render/art/font.js', 'ART', ['GLYPHS', 'arcSpan', 'drawLetters', 'drawLettersOnArc', 'glyphOf', 'screenAt', 'textWidth']),
  F('src/render/art/labels.js', 'ART', ['LABELS', 'RANK_RING', 'labelBox', 'paintLabels']),
  F('src/render/art_keys.js', 'RENDER', ['ARTPACK_MEMBERS_USED', 'MISC_KEYS_USED']),
  F('src/render/balls.js', 'RENDER', [], { node: false }),
  F('src/render/cameras.js', 'RENDER', [], { node: false }),
  F('src/render/geom/envmap.js', 'RENDER', ['chromeEnvPixels', 'CHROME_KEY_LIGHT']),
  F('src/render/geom/ride.js', 'RENDER', ['plungerRideOffset', 'PLUNGER_REST_SPEED']),
  F('src/render/geom/lamps.js', 'RENDER', ['buildLampQuads', 'dimTint', 'placeLamps', 'shiftAlongCameraRay', 'srgbHexToLinear', 'srgbToLinear']),
  F('src/render/geom/meshdata.js', 'RENDER', ['MeshBuilder', 'emptyMeshData', 'mergeMeshData', 'meshBounds', 'placeMeshData', 'triangleCount', 'validateMeshData', 'vertexCount']),
  F('src/render/geom/shapes.js', 'RENDER', ['annulusMesh', 'archMesh', 'boxMesh', 'cylinderMesh', 'discMesh', 'flipperParts', 'insetRibbonMesh', 'mergeMeshData', 'placeMeshData', 'quadMesh', 'regularPolygon', 'targetSlabMesh', 'taperedCapsuleOutline', 'wireMesh']),
  F('src/render/lamps_overlay.js', 'RENDER', [], { node: false }),
  F('src/render/materials.js', 'RENDER', [], { node: false }),
  F('src/render/table.js', 'RENDER', [], { node: false }),
  F('src/render/three_utils.js', 'RENDER', [], { node: false }),
  F('src/rules/cheats.js', 'RULES', ['installCheats']),
  F('src/rules/demo.js', 'RULES', ['installDemo']),
  F('src/rules/features.js', 'RULES', ['installFeatures']),
  F('src/rules/flow.js', 'RULES', ['installFlow']),
  F('src/rules/missions.js', 'RULES', ['installMissions']),
  F('src/rules/ranks.js', 'RULES', ['installRanks']),
  F('src/rules/state.js', 'RULES', ['createContext']),
  F('src/ui/dom.js', 'UI', ['callAction', 'clearChildren', 'focusableIn', 'h', 'setAttr', 'setHidden', 'setText']),
  F('src/ui/filepicker.js', 'UI', ['createFilePicker']),
  F('src/ui/pause.js', 'UI', ['createPauseOverlay']),
  F('src/ui/toast.js', 'UI', ['createToasts']),
  F('src/ui/touch.js', 'UI', ['TOUCH_BUTTONS', 'createTouchControls', 'wantsTouchControls']),
  F('tests/helpers/bot.mjs', 'INTEGRATOR', ['createBot', 'createRig']),
  F('src/render/cinematic.js', 'RENDER', ['createCinematicDirector', 'CINEMATIC']),
  F('src/render/dmd.js', 'RENDER', ['createDmd', 'dmdScore', 'dmdWidth', 'DMD']),
  F('src/render/cabinet.js', 'RENDER', [], { node: false }),
  F('src/render/art/cabinet.js', 'ART', ['paintCabinet', 'CABINET_SIZES', 'CABINET_KEYS']),
];

/** Test file each role owns (recommended name; a role may add more tests/<role>_*.test.mjs). Required when ARCH_STRICT=1. */
export const ROLE_TESTS = {
  DATA: 'tests/data.test.mjs', PHYSICS: 'tests/physics.test.mjs', LAMPS: 'tests/lamps.test.mjs', RULES: 'tests/rules.test.mjs',
  RENDER: 'tests/render.test.mjs', ART: 'tests/art.test.mjs', UI: 'tests/ui.test.mjs', AUDIO: 'tests/audio.test.mjs',
  INTEGRATOR: 'tests/integration.test.mjs',
};

/**
 * Layering rules for the import graph (longest matching prefix wins). allow = path prefixes or exact files (or bare specifiers),
 * deny = prefixes forbidden unless the import is an exact `allow` file. '*' = anything.
 */
export const IMPORT_RULES = [
  { prefix: 'src/data/', allow: ['src/data/'] },
  { prefix: 'src/physics', allow: ['src/data/', 'src/physics'] },
  { prefix: 'src/lamps', allow: ['src/data/', 'src/lamps'] },
  { prefix: 'src/rules', allow: ['src/data/', 'src/rules'] },
  { prefix: 'src/audio', allow: ['src/data/', 'src/audio'] },
  { prefix: 'src/render/art/', allow: ['src/data/', 'src/render/art/'] },
  { prefix: 'src/render/', allow: ['src/data/', 'src/render/', 'src/render/art/mapping.js', 'src/render/art/palette.js', 'src/render/art/rng.js', 'three'], deny: ['src/render/art/'] },
  { prefix: 'src/ui/', allow: ['src/data/', 'src/ui/'] },
  { prefix: 'src/game.js', allow: ['src/data/', 'src/physics.js', 'src/lamps.js', 'src/rules.js'] },
  { prefix: 'src/input.js', allow: ['src/data/'] },
  { prefix: 'src/types.js', allow: [] },
  { prefix: 'src/main.js', allow: ['*'] },
  { prefix: 'tools/', allow: ['*'] },
];

/** Mount points index.html must contain (ARCHITECTURE.md 8.1). */
export const REQUIRED_IDS = [
  'app', 'menubar', 'stage-wrap', 'stage', 'table-view', 'panel', 'touch-controls', 'start-overlay', 'status-line', 'dialog-root', 'toast-root',
];
