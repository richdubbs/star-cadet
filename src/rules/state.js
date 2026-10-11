/**
 * src/rules/state.js
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 7.2 (suggested file split); SPEC 5.1, 5.3
 * The shared context ("R") every rules module is installed on: injected dependencies (physics, lamps, sound, rand, data), the scheduler,
 * the two text boxes, the high-score table, the stable RulesView, the game state `s`, per-player slots, the lamp-group handles and the
 * scoring helpers addScore / specialAdd (SPEC 5.3). Pure Node module: imports only src/data (through the injected `D`) and src/rules/*.
 * Other modules (flow, features, missions, ranks, demo, cheats) attach their public functions to R (R.flow, R.feat, R.m, R.ranks, ...)
 * so they can call each other late-bound without import cycles.
 * ASSUMPTIONS: the displayed score rolls over at >= 1,000,000,000 (E9 counter) so the view always stays within 0..999999999.
 */
import { Scheduler } from './scheduler.js';
import { TextBoxQueue } from './textbox.js';
import { HighScoreTable } from './highscores.js';

/** @returns {{score:number, e9:number, ballCount:number, extraBalls:number, jackpot:number}} */
function newPlayer(D) {
  return { score: 0, e9: 0, ballCount: 3, extraBalls: 0, jackpot: D.POTS.jackpotStart };
}

/**
 * @param {import('../types.js').CreateRulesOpts} opts
 * @param {import('../types.js').DataModule} D
 */
export function createContext(opts, D) {
  const physics = opts.physics;
  const lamps = opts.lamps;
  const sound = opts.sound || D.SILENT_SOUND;
  const rand = typeof opts.rand === 'function' ? opts.rand : Math.random;
  const sched = new Scheduler();
  const boxOpts = { minDisplay: D.TIMING.textMinDisplay, skipOverdue: D.TIMING.textSkipOverdue };
  const infoBox = new TextBoxQueue(boxOpts);
  const missionBox = new TextBoxQueue(boxOpts);
  const hs = opts.highScores || new HighScoreTable();

  /** @type {import('../types.js').RulesView} */
  const view = {
    revision: 0, phase: 'idle', demo: false, paused: false, tilted: false, debug: false, score: 0, player: 1, playerCount: 1,
    ballNumber: 0, info: '', mission: '', bumperLevels: { attack: 0, launch: 0 }, launchEnabled: false,
    highScoresEnabled: false, newGameEnabled: true, namePrompt: null, missionState: 0, extraBalls: 0, fuelLevel: 0,
  };

  const players = [newPlayer(D), newPlayer(D), newPlayer(D), newPlayer(D)];

  /** Mutable game state (table-level quantities of SPEC 5.1 plus bookkeeping). */
  const s = {
    phase: 'idle',               // 'idle' | 'lightShow' | 'playing' | 'gameOver'
    demo: false, paused: false, tilted: false, debug: false,
    playerCount: 1, cur: 0, maxBalls: 3,
    cheatsUsed: false, unlimited: false, easyMode: false,
    bonus: D.POTS.bonusNewGame, bonusFlag: false, jackpotFlag: false, reflex: 0,
    mult: 0,                     // ScoreMultiplier index 0..4
    attackLevel: 0, launchLevel: 0,
    lastBall: false,             // field(lite199) == 1: the drain in progress ends the game
    ballInDrain: false,
    gameOverEnded: false,        // EndGame ran (F2 Starts New Game is showing)
    popDown: Object.create(null), // 'already hit' flag of every drop target
    prompt: null,                // NamePrompt currently shown
    promptQueue: [],
    ebPending: false,            // extra-ball lamps lit, flash-at-55 s still to happen (lite17 hook flag)
    rankFlashPending: false,     // outer ring is in its 5 s promotion flash
    h: Object.create(null),      // scheduler handles by name
  };

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Lamp group handles (18 groups + the hidden all-lamps group). The same object is returned by lamps.group() on every call.
  // ---------------------------------------------------------------------------------------------------------------------------------
  /** @type {Record<string, import('../types.js').LampGroup>} */
  const G = {};
  for (const name of D.LAMP_GROUP_NAMES) G[name] = lamps.group(name);
  G.all = lamps.group(D.ALL_LAMPS_GROUP_NAME);

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------------------------------------------
  /** Current player's slot. */
  const P = () => players[s.cur];

  /** Plays a sound key through the injected SoundPort; returns the manifest duration in seconds (or -1). Never throws. */
  function play(key) {
    let d = -1;
    try { d = sound.play(key); } catch (_) { d = -1; }
    return typeof d === 'number' && Number.isFinite(d) ? d : -1;
  }

  const info = (text, secs) => infoBox.push(text, secs === undefined ? -1 : secs);
  const msg = (text, secs) => missionBox.push(text, secs === undefined ? -1 : secs);

  function addTo(v) {
    const p = players[s.cur];
    p.score += v;
    while (p.score >= D.POTS.e9) { p.score -= D.POTS.e9; p.e9 += 1; }
  }

  /** SPEC 5.3 AddScore: multiplier applies; the raw points also feed the jackpot / bonus pots while their flags are set. */
  function addScore(x) {
    if (!(x > 0)) return;
    const p = players[s.cur];
    if (s.jackpotFlag) p.jackpot = Math.min(p.jackpot + x, D.POTS.cap);
    if (s.bonusFlag) s.bonus = Math.min(s.bonus + x, D.POTS.cap);
    addTo(x * D.MULTIPLIERS[s.mult]);
  }

  /** SPEC 5.3 SpecialAdd: no multiplier, no pot accumulation. */
  function specialAdd(x) { if (x > 0) addTo(x); }

  /** Player i's full score (E9 counter included). */
  const totalScore = (i) => players[i].e9 * D.POTS.e9 + players[i].score;

  function setPlayerCount(n) {
    const v = Math.trunc(Number(n));
    s.playerCount = Number.isFinite(v) ? Math.min(4, Math.max(1, v)) : s.playerCount;
  }

  function resetPlayers() {
    for (let i = 0; i < 4; i++) Object.assign(players[i], newPlayer(D));
    s.cur = 0;
  }

  /** Cancels a named scheduler handle. */
  function cancelH(name) {
    if (s.h[name] !== undefined && s.h[name] !== null) sched.cancel(s.h[name]);
    s.h[name] = null;
  }

  /** (Re)starts a named one-shot timer. */
  function startH(name, seconds, fn) {
    cancelH(name);
    s.h[name] = sched.after(seconds, () => { s.h[name] = null; fn(); });
  }

  // View synchronisation: revision +1 whenever ANY displayed field changed since the previous sync (no allocation).
  let changed = false;
  function setv(k, v) { if (view[k] !== v) { view[k] = v; changed = true; } }
  function syncView() {
    const p = players[s.cur];
    changed = false;
    const idle = s.phase === 'idle';
    setv('phase', s.phase);
    setv('demo', s.demo);
    setv('paused', s.paused);
    setv('tilted', s.tilted);
    setv('debug', s.debug);
    setv('score', p.score);
    setv('player', s.cur + 1);
    setv('playerCount', s.playerCount);
    setv('ballNumber', idle || p.ballCount <= 0 ? 0 : Math.min(s.maxBalls, s.maxBalls - p.ballCount + 1));
    setv('info', infoBox.current());
    setv('mission', missionBox.current());
    setv('launchEnabled', s.phase === 'playing' && !s.demo);
    setv('highScoresEnabled', !idle && !s.demo);
    setv('namePrompt', s.prompt);
    setv('missionState', R.m ? R.m.state : 0);
    setv('extraBalls', p.extraBalls);
    setv('fuelLevel', lamps.fuel ? lamps.fuel.level : 0);
    if (view.bumperLevels.attack !== s.attackLevel) { view.bumperLevels.attack = s.attackLevel; changed = true; }
    if (view.bumperLevels.launch !== s.launchLevel) { view.bumperLevels.launch = s.launchLevel; changed = true; }
    if (changed) view.revision += 1;
  }

  /** The context object shared by all rules modules. */
  const R = {
    physics, lamps, sound, rand, D, sched, infoBox, missionBox, hs, view, players, s, G,
    P, play, info, msg, addScore, specialAdd, totalScore, setPlayerCount, resetPlayers, cancelH, startH, syncView,
    // installed by the other modules:
    flow: null, feat: null, m: null, ranks: null, demo: null, cheats: null,
  };
  return R;
}
