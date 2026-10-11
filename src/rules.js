/**
 * src/rules.js
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 7 (rules), 5 (physics <-> rules interface), 6.5 (hooks); types Rules, RulesView (src/types.js); SPEC 5, 6.5, 6.9, 7.3
 * Facade: createRules({physics, lamps, sound?, rand?, highScores?, data?}) -> Rules. Pure Node module (imports only src/data and src/rules/*);
 * physics, lamps and the SoundPort arrive by injection and are never imported. All time comes from tick(dt) (scheduler + text boxes); there is
 * no setTimeout / Date / Math.random (rand is the injected source, Math.random only as the default).
 *
 * Wiring: rules/state.js builds the shared context R (scheduler, text boxes, view, players, lamp groups, scoring); the installers attach
 *   rules/ranks.js   R.ranks    rank lamps, AddRankProgress, promotion / demotion
 *   rules/features.js R.feat    every table-feature rule (bumpers ... hyperspace, wormholes) + the lamp / group hooks
 *   rules/missions.js R.m       the mission state machine + fuel callbacks
 *   rules/demo.js    R.demo     demo-mode AI
 *   rules/cheats.js  R.cheats   typed cheats + debug keys
 *   rules/flow.js    R.flow     new game, feed, drain, tilt, game over, pause, demo, input gating
 * onPhysicsEvents(events) first plays the DAT-bound sound of each event (SOUND_EVENT_MAP, suppressed while tilted), then runs the rules for its
 * type; unknown event types are ignored. Events that only matter during play are ignored in other phases; trigger events are ignored while tilted.
 *
 * ASSUMPTIONS (gap protocol; the module headers list the rest):
 *  - tick() is a no-op while paused (the game freezes the sim by not stepping; this keeps direct callers consistent);
 *  - rules.newGame() leaves demo mode (user action); the demo restarts itself internally;
 *  - the view's `score` is the current player's CurScore (0..999999999); high scores use the full score incl. the E9 counter;
 *  - cheats other than 'hidden test' work while a game is in its light show or playing.
 */
import * as DATA from './data/index.js';
import { createContext } from './rules/state.js';
import { installRanks } from './rules/ranks.js';
import { installFeatures } from './rules/features.js';
import { installMissions } from './rules/missions.js';
import { installDemo } from './rules/demo.js';
import { installCheats } from './rules/cheats.js';
import { installFlow } from './rules/flow.js';

/**
 * @param {import('./types.js').CreateRulesOpts} opts
 * @returns {import('./types.js').Rules}
 */
export function createRules(opts) {
  if (!opts || !opts.physics || !opts.lamps) throw new TypeError('createRules: opts.physics and opts.lamps are required');
  const D = opts.data || DATA;
  const R = createContext(opts, D);
  const { s } = R;
  installRanks(R);
  installFeatures(R);       // needs R.m at call time only (installed next)
  installMissions(R);
  installDemo(R);
  installCheats(R);
  installFlow(R);

  // -------------------------------------------------------------------------------------------------------------------------------
  // DAT-bound sounds (SPEC 7.3): first SOUND_EVENT_MAP entry that matches the event wins; suppressed while tilt-locked.
  // -------------------------------------------------------------------------------------------------------------------------------
  /** @type {Map<string, {match: Record<string, any[]>|undefined, key: string}[]>} */
  const soundsByType = new Map();
  for (const entry of D.SOUND_EVENT_MAP) {
    if (!soundsByType.has(entry.event)) soundsByType.set(entry.event, []);
    soundsByType.get(entry.event).push(entry);
  }
  function dispatchSound(e) {
    const list = soundsByType.get(e.type);
    if (!list) return;
    for (const entry of list) {
      let ok = true;
      if (entry.match) {
        for (const k of Object.keys(entry.match)) {
          if (!entry.match[k].includes(e[k])) { ok = false; break; }
        }
      }
      if (ok) { R.play(entry.key); return; }
    }
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Event routing (ARCHITECTURE 5.3)
  // -------------------------------------------------------------------------------------------------------------------------------
  function handleEvent(e) {
    if (!e || typeof e.type !== 'string') return;
    if (!s.tilted) dispatchSound(e);
    if (s.phase !== 'playing') return;
    switch (e.type) {
      case 'drain': R.flow.onDrain(e); break;
      case 'plungerFed': R.flow.onPlungerFed(e); break;
      case 'nudgeCount': R.flow.onNudgeCount(e); break;
      case 'kickbackTimerExpired': R.feat.kickbackTimerExpired(e); break;
      case 'demoTrigger': R.demo.onTrigger(e.id); break;
      default:
        if (s.tilted) break;                                // triggers are ignored while tilted
        switch (e.type) {
          case 'bumperHit': R.feat.bumperHit(e); break;
          case 'rebounderHit': R.feat.rebounderHit(e); break;
          case 'popupHit': R.feat.popupHit(e); break;
          case 'soloHit': R.feat.soloHit(e); break;
          case 'rolloverEnter': R.feat.rolloverEnter(e); break;
          case 'tripwire': R.feat.tripwire(e); break;
          case 'oneway': R.feat.oneway(e); break;
          case 'rampLine1': R.feat.rampLine1(e); break;
          case 'rampHoleReleased': R.feat.rampHoleReleased(e); break;
          case 'kickoutCapture': R.feat.kickoutCapture(e); break;
          case 'sinkCapture': R.feat.sinkCapture(e); break;
          case 'flagFrame': R.feat.flagFrame(e); break;
          case 'flagLoop': R.feat.flagLoop(e); break;
          case 'flipper': if (e.action === 'extend') R.feat.flipperExtend(e); break;
          default: break;                                   // informational / sound-only / unknown types
        }
    }
  }

  /** @type {import('./types.js').Rules} */
  const rules = {
    newGame(o) { R.flow.newGame(o); R.syncView(); },
    stopGame() { R.flow.stopGame(); R.syncView(); },
    setPlayers(n) { R.setPlayerCount(n); R.syncView(); },
    setDemo(on) { R.flow.setDemo(on); R.syncView(); },
    launchBall() { const ok = R.flow.launchBall(); R.syncView(); return ok; },
    setPaused(on) { R.flow.setPaused(on); R.syncView(); },
    isPaused() { return s.paused; },
    focusLost() { R.flow.focusLost(); },
    focusGained() { /* the game stays paused until F3 / the menu resumes it */ },
    input(action, down) { R.flow.input(action, down); },
    cheat(word) { R.cheats.cheat(word); R.syncView(); },
    debugKey(key) { R.cheats.debugKey(key); R.syncView(); },
    setDebug(on) { s.debug = !!on; R.syncView(); },
    onPhysicsEvents(events) {
      if (events && events.length) for (let i = 0; i < events.length; i++) handleEvent(events[i]);
      R.syncView();
    },
    tick(dt) {
      if (s.paused || !(dt > 0)) return;
      R.infoBox.tick(dt);
      R.missionBox.tick(dt);
      R.sched.advance(dt);
      R.syncView();
    },
    getView() { R.syncView(); return R.view; },
    submitName(name) { R.flow.submitName(name); R.syncView(); },
    highScores: R.hs,
  };
  return rules;
}
