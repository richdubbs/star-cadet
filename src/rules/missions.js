/**
 * src/rules/missions.js
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 7; SPEC 5.7 (all), 5.5 (fuel callbacks), 5.8 (rank points), 5.9 (Secret / Space Radiation wormhole use)
 * The mission state machine (`field(lite198)`): state 0 WaitingDeployment, 1 SelectMission, 2..18 the 17 missions, 20..24 and 25..31 their later
 * parts / the Maelstrom chain, 32 GameOver. Table events arrive as neutral events through forward(ev) AFTER the component's own scoring handler
 * (features.js) has run; the controller of the CURRENT state reacts. Event kinds:
 *   bumper{name,attack} rebounder popup{name} solo{name,bank,index} lane{name,lane} fuelRoll{n} spaceWarp ramp flag hyperspace blackHole
 *   wormhole{id} bumperLevel{group,level} boosterSet
 * Public: forward(ev), deploy() (0 -> 1), accept(), endOfBall(gameOver), showText() (refresh the mission box), state / counter (read-only fields).
 * Fuel hooks (SPEC 5.5) are registered here: beforeSetLevel re-evaluates the select prompt with the OLD level (callback-order quirk), tick shows
 * "Warning -- Low Fuel" at level 1, ended aborts a running mission.
 * ASSUMPTIONS: hazard-bank progress of Stray Comet / Space Radiation is tracked in the mission itself (fresh hits only; the lamp registers
 * field(lite104/107) are also maintained for display); on a mission end the wormhole destination register is cleared together with its lamps
 * (SPEC 5.7.2 issue #124 fix); goal lamps of the stages the SPEC does not name (Maelstrom 25 / 26) reuse the hazard / lane arrows;
 * after "Warning -- Low Fuel" the mission box restores the mission's own text.
 */

/** @param {object} R rules context (state.js) */
export function installMissions(R) {
  const { lamps, D, s, G } = R;
  const { MISSIONS, MISSION_NAMES, TIMING, fmt } = D;
  const T = D.MISSION_TEXT;

  const M = {
    state: 0,            // field(lite198)
    selected: 0,         // mission id picked in state 1 (field(lite56) while selecting), 0 = none
    counter: 0,          // remaining count of the running stage (field(lite56) while running)
    stage: 0,            // sub-stage inside a state (Stray Comet / Black Hole / Space Radiation / Rescue)
    spotBits: 0,         // field(lite101): mission spot targets hit since the last reset (1,2,4)
    bits: 0,             // fresh hazard-bank hits since the mission started
  };

  /** state id -> MissionDef it belongs to */
  const MISSION_OF_STATE = {};
  for (const def of Object.values(MISSIONS)) for (const st of def.states) MISSION_OF_STATE[st] = def;

  function setState(n) {
    M.state = n;
    lamps.setField('lite198', n);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Mission box text
  // ---------------------------------------------------------------------------------------------------------------------------------
  function textFor(st) {
    switch (st) {
      case 0: return T.awaitingDeployment;
      case 2: case 20: return fmt(T.attackBumperHitsLeft, M.counter);
      case 3: return fmt(T.launchesLeft, M.counter);
      case 4: return fmt(T.reentriesLeft, M.counter);
      case 5: return fmt(T.dropTargetsLeft, M.counter);
      case 6: return M.stage === 0 ? T.fillRightHazardBanks : T.hyperspaceLaunch;
      case 7: return M.stage === 0 ? T.upgradeLaunchBumpers : T.enterBlackHole;
      case 8: return M.stage === 0 ? T.fillLeftHazardBanks : T.enterWormhole;
      case 9: return fmt(T.targetsLeft, M.counter);
      case 10: return T.upgradeAttackBumpers;
      case 11: return M.stage === 0 ? T.upgradeFlags : T.hyperspaceLaunch;
      case 12: return fmt(T.remoteAttackBumperHitsLeft, M.counter);
      case 13: return fmt(T.lanePassesLeft, M.counter);
      case 14: return fmt(T.outLanePassesLeft, M.counter);
      case 15: return fmt(T.rollFlags, M.counter);
      case 21: return T.hitSpaceWarpRollover;
      case 16: return T.hitYellowWormhole;
      case 22: return T.hitRedWormhole;
      case 23: return T.hitGreenWormhole;
      case 17: return fmt(T.reboundHitsLeft, M.counter);
      case 24: return T.hitHyperspaceChuteOrLaunchRamp;
      case 18: return fmt(T.dropTargetHitsLeft, M.counter);
      case 25: return fmt(T.spotTargetHitsLeft, M.counter);
      case 26: return fmt(T.lanesPassesLeft, M.counter);
      case 27: return T.shootBallUpFuelChute;
      case 28: return T.hitLaunchRamp;
      case 29: return T.hitFlags;
      case 30: return T.hitWormHole;
      case 31: return T.hyperspaceChuteToEndMaelstrom;
      default: return '';
    }
  }

  /** (Re)shows the text of the current state, persistent. */
  function showText() {
    if (M.state === 1) { showSelectPrompt(); return; }
    const text = textFor(M.state);
    if (text) R.msg(text, -1);
  }

  /**
   * State 1 prompt (SPEC 5.7.2). `fuelLevel` lets the fuel callback pass the OLD level (SPEC 5.5 ordering quirk).
   * @param {number} [fuelLevel]
   */
  function showSelectPrompt(fuelLevel) {
    const fuel = fuelLevel === undefined ? lamps.fuel.level : fuelLevel;
    lamps.off('lite317');
    lamps.off('lite318');
    lamps.off('lite319');
    if (fuel <= 0) {
      R.msg(T.refuelShip, -1);
      lamps.flasherStart('lite318');
    } else if (M.selected) {
      R.msg(fmt(T.launchRampToAccept, MISSION_NAMES[M.selected]), -1);
      lamps.flasherStart('lite317');
    } else {
      R.msg(T.hitMissionTargets, -1);
      lamps.flasherStart('lite319');
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Goal lamps
  // ---------------------------------------------------------------------------------------------------------------------------------
  function clearGoals() {
    G.goal_lights.broadcast('off');
    lamps.off('lite55');
    lamps.off('lite26');
    lamps.off('lite130');
  }
  /** Flash the given goal lamps (numbers N -> 'liteN') indefinitely, after clearing the previous goals. */
  function goals(...ns) {
    for (const n of ns) lamps.flasherStart('lite' + n);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // State 1: select / accept
  // ---------------------------------------------------------------------------------------------------------------------------------
  /** The select-state initialiser (SPEC 5.7.2 last paragraph); runs on 0 -> 1 and whenever a mission ends. */
  function initSelect() {
    M.selected = 0;
    M.spotBits = 0;
    M.stage = 0;
    M.counter = 0;
    M.bits = 0;
    lamps.off('lite198');
    lamps.off('lite56');
    G.outer_circle.groupReset();
    G.ramp_tgt_lights.broadcast('off');
    lamps.setField('lite56', 0);
    lamps.setField('lite101', 0);
    R.feat.stopTrek();
    clearGoals();
    R.feat.clearDest();                                   // wormhole + arrow lamps off, destination cleared (issue #124 fix)
    showSelectPrompt();
  }

  function deploy() {
    if (M.state !== 0) return;
    setState(1);
    initSelect();
  }

  /** A mission spot target was hit in state 1: pick the mission for (rank, target level). */
  function select(index) {
    let bits = M.spotBits | (1 << index);
    let level = index + 1;
    if (bits === 7) { level = 4; bits = 0; }
    M.spotBits = bits;
    lamps.setField('lite101', bits);
    const rank = Math.max(1, G.middle_circle.count());
    M.selected = D.missionForRank(rank, level);
    lamps.setField('lite56', M.selected);
    lamps.flashThenOn('lite56', TIMING.lampFlash);
    lamps.flasherStart('lite198');
    R.play('SW52');                                        // sound slot of the original, file missing there -> silent
    showSelectPrompt();
  }

  /** Launch-ramp event with a mission selected and fuel in the tank (SPEC 5.7.2 ACCEPT). */
  function accept() {
    const id = M.selected;
    if (!MISSIONS[id]) return;
    lamps.off('lite56');
    lamps.on('lite198');
    G.outer_circle.animationBackward(-1);
    lamps.off('lite317');
    lamps.off('lite318');
    lamps.off('lite319');
    const pts = D.acceptScoreFor(id);
    R.specialAdd(pts);
    R.msg(fmt(T.missionAccepted, pts), 4);                 // shown first; the mission's own text queues behind it
    M.selected = 0;
    enterState(id);
  }

  function selectCtl(ev) {
    if (ev.k === 'solo' && ev.bank === 'mission') select(ev.index);
    else if (ev.k === 'ramp' && M.selected && lamps.fuel.level > 0) accept();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Mission initialisers
  // ---------------------------------------------------------------------------------------------------------------------------------
  /** Secret mission stage lamps: rim of the wanted sink lit + its arrow flashing in the sink's colour (yellow 3, red 1, green 2). */
  function secretStage(sink) {
    R.feat.clearDest();
    lamps.on(R.feat.sinkRim[sink]);
    const [arrow, idx] = R.feat.sinkArrow[sink];
    lamps.setOnIdx(arrow, idx);
    lamps.flasherStart(arrow);
  }

  /** "Enter Wormhole" hint: advance the destination colour and make the arrows flash (Space Radiation stage 2, Maelstrom stage 7). */
  function wormholeHint() {
    R.feat.advanceDest();
    G.bsink_arrow_lights.broadcast('flasherStart');
  }

  /** Initialises state n (the original sends "mission complete" to the NEW state as its initialiser). */
  function enterState(n) {
    setState(n);
    const def = MISSION_OF_STATE[n];
    const idx = def ? def.states.indexOf(n) : -1;
    const c = def && idx >= 0 ? def.stageCounters[idx] : null;
    M.counter = c === null || c === undefined ? 0 : c;
    M.stage = 0;
    M.bits = 0;
    lamps.setField('lite56', M.counter);
    clearGoals();
    switch (n) {
      case 2: goals(308, 311); break;
      case 3: goals(317); break;
      case 4: goals(307); R.feat.startTrek(); break;
      case 5: R.feat.reenableAll(); goals(303, 309, 315); break;
      case 6: lamps.setField('lite107', 0); goals(306); break;
      case 7: R.feat.setBumperLevel('launch', 0, true); goals(316); break;
      case 8: lamps.setField('lite104', 0); goals(313); break;
      case 9:
        R.feat.reenableAll();
        G.lchute_tgt_lights.broadcast('off');
        G.bpr_solotgt_lights.broadcast('off');
        G.ramp_tgt_lights.broadcast('off');
        G.top_circle_tgt_lights.broadcast('off');
        goals(306, 308, 310, 313, 319);
        break;
      case 10: R.feat.setBumperLevel('attack', 0, true); goals(307); break;
      case 20: goals(308, 311); break;
      case 11: lamps.off('lite19'); lamps.off('lite20'); goals(303); break;
      case 12: goals(308); break;
      case 13: goals(301, 302, 307, 316, 320, 321); break;
      case 14: goals(301, 320); break;
      case 15: lamps.on('lite19'); lamps.on('lite20'); goals(305, 312); break;
      case 21: goals(310); break;
      case 16: secretStage(3); break;
      case 22: secretStage(1); break;
      case 23: secretStage(2); break;
      case 17: goals(300, 322); break;
      case 24: goals(55, 26, 304, 317); break;
      case 18: goals(303, 309, 315); break;
      case 25: goals(306, 313, 319); break;
      case 26: goals(301, 302, 307, 316, 320, 321); break;
      case 27: goals(318); break;
      case 28: goals(317); break;
      case 29: lamps.on('lite19'); lamps.on('lite20'); goals(305, 312); break;
      case 30: wormholeHint(); break;
      case 31: lamps.flasherStart('lite130'); goals(304); break;
      default: break;
    }
    showText();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Completion, abort, end of ball
  // ---------------------------------------------------------------------------------------------------------------------------------
  /** Ends the running mission: state back to 1 and the select-state initialiser (SPEC 5.7.7). */
  function finish() {
    setState(1);
    initSelect();
  }

  /** SPEC 5.7.7 completeMission. */
  function complete(def) {
    R.specialAdd(def.reward);
    const done = T[def.doneText];
    if (def.doneBox === 'info') R.info(done, 4); else R.msg(done, 4);
    const promoted = R.ranks.addProgress(def.rankPts);
    if (!promoted) {
      R.play('SW9');
      R.msg(fmt(T.missionCompleted, def.reward), 8);
    }                                                      // a promotion pushed its own "Promotion to <Rank>" text and SW10
    finish();
  }

  function timeWarpForward() {
    const def = MISSIONS[17];
    R.msg(T.timeWarpForward, 4);
    const first = R.ranks.promoteOne();
    const second = R.ranks.addProgress(def.rankPts);
    if (!first && !second) R.play('SW9');
    R.specialAdd(def.reward);
    finish();
  }

  function timeWarpBackward() {
    const def = MISSIONS[17];
    R.msg(T.timeWarpBackward, 4);
    R.ranks.demote();                                      // no rank progress on the backward branch
    R.specialAdd(def.reward);
    finish();
  }

  /** Fuel ran out during a mission (SPEC 5.5). */
  function abort() {
    R.feat.stopTrek();
    R.msg(T.missionAborted, 4);
    finish();
  }

  /** End of ball: the old mission is cancelled; state 0 (or 32 when the game is over). */
  function endOfBall(gameOver) {
    M.selected = 0;
    M.spotBits = 0;
    M.stage = 0;
    M.counter = 0;
    M.bits = 0;
    setState(gameOver ? 32 : 0);
    lamps.setField('lite56', 0);
    lamps.setField('lite101', 0);
    clearGoals();                                          // the 23 goal lamps are cleared by the last "mission complete" initialiser
  }

  /** New game: forget everything. */
  function reset() {
    endOfBall(false);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Counting helpers and the controllers of the running missions
  // ---------------------------------------------------------------------------------------------------------------------------------
  function counterDone() {
    switch (M.state) {
      case 15: enterState(21); break;
      case 17: enterState(24); break;
      case 18: enterState(25); break;
      case 25: enterState(26); break;
      case 26: enterState(27); break;
      default: complete(MISSION_OF_STATE[M.state]);
    }
  }

  function countDown() {
    M.counter -= 1;
    lamps.setField('lite56', M.counter);
    if (M.counter <= 0) counterDone(); else showText();
  }

  function hazardCtl(ev, bank, nextStage) {
    if (M.stage !== 0 || ev.k !== 'solo' || ev.bank !== bank) return;
    M.bits |= 1 << ev.index;
    if ((M.bits & 7) === 7) nextStage();
  }

  function forward(ev) {
    if (ev.k === 'solo' && ev.bank === 'mission' && M.state !== 1) R.play('SW49D');
    switch (M.state) {
      case 1: selectCtl(ev); break;
      case 2: case 20:
        if (ev.k === 'bumper' && ev.attack) countDown();
        break;
      case 3:
        if (ev.k === 'ramp') countDown();
        break;
      case 4:
        if (ev.k === 'lane' && ev.lane === 'reentry') countDown();
        break;
      case 5: case 18:
        if (ev.k === 'popup') countDown();
        break;
      case 6:                                              // Stray Comet
        hazardCtl(ev, 'rightHazard', () => { M.stage = 1; clearGoals(); goals(304); showText(); });
        if (ev.k === 'hyperspace' && M.stage === 1) complete(MISSIONS[6]);
        break;
      case 7:                                              // Black Hole
        if (ev.k === 'bumperLevel' && ev.group === 'launch') {
          const st = ev.level > 0 ? 1 : 0;
          if (st !== M.stage) { M.stage = st; clearGoals(); goals(st ? 314 : 316); showText(); }
        } else if (ev.k === 'blackHole' && s.launchLevel > 0) {
          complete(MISSIONS[7]);
        }
        break;
      case 8:                                              // Space Radiation
        hazardCtl(ev, 'leftHazard', () => { M.stage = 1; clearGoals(); wormholeHint(); showText(); });
        if (ev.k === 'wormhole' && M.stage === 1) complete(MISSIONS[8]);
        break;
      case 9:
        if (ev.k === 'popup' || ev.k === 'solo') countDown();
        break;
      case 10:                                             // Alien Menace part 1
        if (ev.k === 'bumperLevel' && ev.group === 'attack' && ev.level > 0) enterState(20);
        break;
      case 11:                                             // Rescue
        if (ev.k === 'boosterSet' && M.stage === 0 && lamps.lightOn('lite20')) {
          M.stage = 1; clearGoals(); goals(304); showText();
        } else if (ev.k === 'hyperspace' && M.stage === 1 && lamps.lightOn('lite20')) {
          complete(MISSIONS[11]);
        }
        break;
      case 12:
        if (ev.k === 'bumper' && ev.name === 'a_bump4') countDown();
        break;
      case 13: case 26:
        if (ev.k === 'lane') countDown();
        break;
      case 14:
        if (ev.k === 'lane' && ev.lane === 'outlane') countDown();
        break;
      case 15: case 29:                                    // Cosmic Plague part 1 counts flag frames; Maelstrom stage 6 needs one
        if (ev.k === 'flag') { if (M.state === 29) enterState(30); else countDown(); }
        break;
      case 21:
        if (ev.k === 'spaceWarp') complete(MISSIONS[15]);
        break;
      case 16:                                             // Secret: yellow, red, green
        if (ev.k === 'wormhole' && ev.id === 3) enterState(22);
        break;
      case 22:
        if (ev.k === 'wormhole' && ev.id === 1) enterState(23);
        break;
      case 23:
        if (ev.k === 'wormhole' && ev.id === 2) complete(MISSIONS[16]);
        break;
      case 17:
        if (ev.k === 'rebounder') countDown();
        break;
      case 24:                                             // Time Warp part 2
        if (ev.k === 'ramp') timeWarpForward();
        else if (ev.k === 'hyperspace') timeWarpBackward();
        break;
      case 25:
        if (ev.k === 'solo') countDown();
        break;
      case 27:
        if (ev.k === 'fuelRoll' && ev.n === 6) enterState(28);
        break;
      case 28:
        if (ev.k === 'ramp') enterState(29);
        break;
      case 30:
        if (ev.k === 'wormhole') enterState(31);
        break;
      case 31:
        if (ev.k === 'hyperspace') complete(MISSIONS[18]);
        break;
      default: break;                                      // 0 (waiting) and 32 (game over): nothing
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Fuel callbacks (SPEC 5.5)
  // ---------------------------------------------------------------------------------------------------------------------------------
  lamps.fuel.setHooks({
    beforeSetLevel: () => { if (M.state === 1) showSelectPrompt(lamps.fuel.level); },      // OLD level on purpose (callback-order quirk)
    tick: (level) => {
      if (level === 1 && M.state !== 0 && M.state !== 32) {
        R.msg(T.warningLowFuel, 4);
        showText();                                        // restore the persistent text behind the warning
      }
    },
    ended: () => {
      if (M.state > 1 && M.state < 32) abort();
      else if (M.state === 1) showSelectPrompt(0);
    },
  });

  Object.assign(M, { forward, deploy, accept, endOfBall, reset, showText, showSelectPrompt, initSelect, enterState, abort, textFor });
  R.m = M;
}
