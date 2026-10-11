/**
 * src/rules/features.js
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 7 (events 5.3 -> reactions); SPEC 5.2.3, 5.3, 5.4 (all of it), 5.5 (fuel sources), 5.6, 5.9
 * Table-feature rules, one handler per physics event family. Every handler first runs the component's OWN scoring/lamp logic and then forwards
 * a neutral event to the mission controller (R.m.forward), exactly the "component handler first, controller second" order of SPEC 5.7.1.
 *   bumpers + levels + 60 s decay, rebounders, drop-target banks (booster / medal / multiplier), spot targets (fuel / mission / hazard /
 *   wormhole destination), rollovers (re-entry, launch lanes, outlanes, bonus lane, return lanes, fuel chute, space warp), tripwires and
 *   skill shot, launch ramp + reflex shot + ramp hole, hyperspace ladder, gravity well, black hole, wormholes + escape chute, flag spinners,
 *   kickbacks + gates, centre post, extra-ball lamps, grand reward, wormhole destination.
 * Lamp hooks / group notify timers are registered here (lite17, lite59, lite60, lite200, hyperspace / medal / multiplier decay).
 * ASSUMPTIONS (gap protocol): ladder / commendation / multiplier info messages last 2 s; "Upgraded" texts restart the 60 s decay even when the
 * level is already 3; the bonus lane (lite16) is consumed when it pays out; hazard-bank and gate lamps use flashThenOn(5) for the gate lamp and
 * flash(5) for its arrow; a pass of a re-entry lane stops the trek chase only while one is animating.
 */

/** @param {object} R rules context (state.js) */
export function installFeatures(R) {
  const { physics, lamps, D, s, G } = R;
  const { SCORE, INFO, TIMING, fmt } = D;
  const fwd = (ev) => R.m.forward(ev);

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Static tables derived from the data modules
  // ---------------------------------------------------------------------------------------------------------------------------------
  const GATE_LAMPS = { 1: D.GATES.find((g) => g.id === 1).lamps, 2: D.GATES.find((g) => g.id === 2).lamps };
  const POPUP = Object.fromEntries(D.POPUP_TARGETS.map((t) => [t.name, t]));
  const SOLO = Object.fromEntries(D.SOLO_TARGETS.map((t) => [t.name, t]));
  const TRIPWIRE_LAMP = Object.fromEntries(D.TRIPWIRES.map((t) => [t.name, t.lamp]));
  const REENTRY = { a_roll1: 'lite10', a_roll2: 'lite9', a_roll3: 'lite8' };
  const LAUNCH_LANE = { a_roll110: 'lite169', a_roll111: 'lite170', a_roll112: 'lite171' };
  const RETURN_LANE = { a_roll6: 'lite27', a_roll7: 'lite28' };
  const OUTLANE = { a_roll4: 1, a_roll8: 2 };
  const FUEL_ROLL = { a_roll179: 1, a_roll180: 2, a_roll181: 3, a_roll182: 4, a_roll183: 5, a_roll184: 6 };
  const SINK_RIM = { 1: 'lite5', 2: 'lite6', 3: 'lite7' };                  // wormhole rim lamps (sink index = group index + 1)
  const SINK_ARROW = { 1: ['lite4', 2], 2: ['lite2', 1], 3: ['lite3', 0] };  // arrow lamp + its ON image (red=2, green=1, yellow=0)
  const BUMPER_RE = /^a_bump([1-7])$/;
  const UPGRADE_FLASH = 5;                 // lane lamps blink 5 s after the third lane lights up (SPEC 5.6)
  const TREK_STEP = 0.2;                   // trek chase period (SPEC 5.13.3)

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Small shared helpers
  // ---------------------------------------------------------------------------------------------------------------------------------
  const P = () => R.players[s.cur];

  /** Trek chase lamps (cosmetic): seed one lamp and let it circulate every 0.2 s. */
  function startTrek() {
    for (const g of [G.l_trek_lights, G.r_trek_lights]) {
      g.groupReset();
      g.broadcast('off');
      g.offsetForward();
      g.animationBackward(TREK_STEP);
    }
  }
  function stopTrek() {
    for (const g of [G.l_trek_lights, G.r_trek_lights]) { g.groupReset(); g.broadcast('off'); }
  }
  function stopTrekIfRunning() {
    if (G.l_trek_lights.isAnimating() || G.r_trek_lights.isAnimating()) stopTrek();
  }

  /** Refuel to a full tank and restart the 72 s countdown (SPEC 5.5). */
  function refuel() { lamps.fuel.setLevel(11); }

  /** Outlane gate OPEN (disabled, hidden) with its lamp pair flashing 5 s (SPEC 5.4.8). */
  function openGate(id) {
    physics.gateSetEnabled(id, false);
    lamps.flashThenOn(GATE_LAMPS[id][0], 5);
    lamps.flash(GATE_LAMPS[id][1], 5);
  }
  /** Outlane gate CLOSED (enabled, solid) and its lamps off. */
  function closeGate(id) {
    physics.gateSetEnabled(id, true);
    lamps.off(GATE_LAMPS[id][0]);
    lamps.off(GATE_LAMPS[id][1]);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Bumper levels (SPEC 5.4.1)
  // ---------------------------------------------------------------------------------------------------------------------------------
  const levelOf = (kind) => (kind === 'attack' ? s.attackLevel : s.launchLevel);

  function setBumperLevel(kind, level, quiet = false) {
    const prev = levelOf(kind);
    if (kind === 'attack') s.attackLevel = level; else s.launchLevel = level;
    if (level === 0) R.cancelH(kind + 'Decay');
    if (!quiet && prev !== level) fwd({ k: 'bumperLevel', group: kind, level });
  }
  function restartBumperDecay(kind) {
    R.startH(kind + 'Decay', TIMING.bumperDecay, () => {
      const lvl = levelOf(kind);
      if (lvl <= 0) return;
      setBumperLevel(kind, lvl - 1);
      if (lvl - 1 > 0) restartBumperDecay(kind);
    });
  }
  function upgradeBumpers(kind) {
    if (levelOf(kind) < 3) {
      setBumperLevel(kind, levelOf(kind) + 1);
      R.info(kind === 'attack' ? INFO.weaponsUpgraded : INFO.engineUpgraded, 2);
      R.play('BUMPER');
    }
    restartBumperDecay(kind);
  }

  function bumperHit(e) {
    const m = BUMPER_RE.exec(e.name || '');
    if (!m) return;
    const launch = Number(m[1]) >= 5;
    const lvl = launch ? s.launchLevel : s.attackLevel;
    R.addScore(launch ? SCORE.bumperLaunch[lvl] : SCORE.bumperAttack[lvl]);
    fwd({ k: 'bumper', name: e.name, attack: !launch });
  }

  function rebounderHit(e) {
    R.addScore(SCORE.rebounder);
    if (e.name === 'v_rebo1') lamps.timedOn('lite84', TIMING.rebounderFlash);
    else if (e.name === 'v_rebo2') lamps.timedOn('lite85', TIMING.rebounderFlash);
    fwd({ k: 'rebounder', name: e.name });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Lane lamps (SPEC 5.6)
  // ---------------------------------------------------------------------------------------------------------------------------------
  /**
   * Pass of a lane: unlit -> lit, steady lit -> unlit, a flashing lane ignores the pass. Three lit lanes upgrade the bumpers and the three lamps
   * blink 5 s (steady flags go false at once).
   */
  function laneLogic(group, lamp, kind) {
    if (lamps.overlay(lamp) !== 'flash') {
      if (lamps.steady(lamp)) lamps.off(lamp); else lamps.on(lamp);
    }
    if (group.count() === 3) {
      upgradeBumpers(kind);
      group.broadcast('flash', UPGRADE_FLASH);
      group.broadcast('turnOff');
    }
  }

  /** Left flipper pressed -> both lane groups step toward higher index; right flipper -> the other way (SPEC 5.6). */
  function flipperExtend(e) {
    if (e.side === 'left') { G.bmpr_inc_lights.stepBackward(); G.ramp_bmpr_inc_lights.stepBackward(); }
    else if (e.side === 'right') { G.bmpr_inc_lights.stepForward(); G.ramp_bmpr_inc_lights.stepForward(); }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Rollovers (SPEC 5.3 table, 5.2.6, 5.4.8, 5.5)
  // ---------------------------------------------------------------------------------------------------------------------------------
  function awardExtraBall(seconds) {
    P().extraBalls += 1;
    R.info(INFO.extraBall, seconds);
  }

  function rolloverEnter(e) {
    const name = e.name;
    if (REENTRY[name]) {
      R.addScore(SCORE.reentryLane);
      if (!lamps.lightOn('lite56')) stopTrekIfRunning();
      laneLogic(G.bmpr_inc_lights, REENTRY[name], 'attack');
      fwd({ k: 'lane', name, lane: 'reentry' });
    } else if (LAUNCH_LANE[name]) {
      R.addScore(SCORE.launchLane);
      laneLogic(G.ramp_bmpr_inc_lights, LAUNCH_LANE[name], 'launch');
      fwd({ k: 'lane', name, lane: 'launch' });
    } else if (OUTLANE[name]) {
      const side = OUTLANE[name];
      R.addScore(SCORE.outlane);
      if (lamps.lightOn('lite17') || lamps.lightOn('lite18')) {
        awardExtraBall(2);
        R.play('SW28');
        lamps.off('lite17');
        lamps.off('lite18');
        s.ebPending = false;
      } else {
        R.play('SW26');
      }
      if (lamps.lightOn(GATE_LAMPS[side][0])) {            // kick-back about to fire: the lamp pair flashes
        lamps.flasherStart(GATE_LAMPS[side][0]);
        lamps.flasherStart(GATE_LAMPS[side][1]);
      }
      fwd({ k: 'lane', name, lane: 'outlane' });
    } else if (name === 'a_roll5') {
      if (lamps.lightOn('lite16')) {
        const pot = s.bonus;
        R.specialAdd(pot);
        R.info(fmt(INFO.bonusAwarded, pot), 2);
        R.play('SW50');
        lamps.off('lite16');
      } else {
        R.addScore(SCORE.bonusLaneUnlit);
        R.play('SW25');
      }
      refuel();
      fwd({ k: 'lane', name, lane: 'bonus' });
    } else if (RETURN_LANE[name]) {
      const lamp = RETURN_LANE[name];
      if (lamps.lightOn(lamp)) {
        R.addScore(SCORE.returnLaneLit);
        lamps.off(lamp);
        lamps.off('lite59');                               // quirk: the bonus-window lamp goes out, its flag stays (SPEC 5.4.5)
      } else {
        R.addScore(SCORE.returnLane);
      }
      fwd({ k: 'lane', name, lane: 'return' });
    } else if (FUEL_ROLL[name]) {
      const k = FUEL_ROLL[name];
      R.addScore(SCORE.fuelRollover);
      if (lamps.fuel.level <= 2 * k - 1) {
        lamps.fuel.setLevel(2 * k - 1);
        R.info(INFO.shipRefueled, 2);
      } else {
        lamps.timedOff('literoll' + (178 + k), 0.05);
      }
      fwd({ k: 'fuelRoll', name, n: k });
    } else if (name === 'a_roll9') {
      R.addScore(SCORE.spaceWarp);
      lamps.on('lite27');
      lamps.on('lite28');
      fwd({ k: 'spaceWarp' });
    }
  }

  function kickbackTimerExpired(e) {
    if (e.id !== 1 && e.id !== 2) return;
    if (s.easyMode) return;                                // easy mode: kick-backs do not re-close the gates
    closeGate(e.id);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Drop-target banks (SPEC 5.4.4 - 5.4.6)
  // ---------------------------------------------------------------------------------------------------------------------------------
  /** All nine drop targets back up (mission initialisers, end of ball). */
  function reenableAll() {
    for (const k of Object.keys(s.popDown)) s.popDown[k] = false;
    physics.popupReenable('all');
  }

  function reenableBank(bank) {
    const names = D.BANKS[bank];
    for (const n of names) s.popDown[n] = false;
    physics.popupReenable(names.slice());
  }

  function boosterSet() {
    if (lamps.lightOn('lite61')) {
      if (lamps.lightOn('lite60')) {
        if (lamps.lightOn('lite59')) {
          if (lamps.lightOn('lite58')) {
            R.addScore(SCORE.booster.allLitExtra);
          } else {
            lamps.on('lite58');
            R.info(INFO.bonusHold, 2);
            R.play('SW48');
          }
        } else {
          s.bonusFlag = true;
          lamps.timedOn('lite59', TIMING.upgradeWindow);
          R.info(INFO.bonusActivated, 2);
          R.play('SW46');
        }
      } else {
        s.jackpotFlag = true;
        lamps.timedOn('lite60', TIMING.upgradeWindow);
        R.info(INFO.jackpotActivated, 2);
        R.play('SW45');
      }
    } else if (R.m.state !== 15 && R.m.state !== 29) {
      lamps.timedOn('lite20', TIMING.upgradeWindow);
      lamps.timedOn('lite19', TIMING.upgradeWindow);
      lamps.timedOn('lite61', TIMING.upgradeWindow);
      R.info(INFO.flagsUpgraded, 2);
      R.play('SW47');
    }
    reenableBank('booster');
    R.addScore(SCORE.booster.setComplete);
    fwd({ k: 'boosterSet' });
  }

  function medalSet() {
    const g = G.bumper_target_lights;
    g.nextOn(TIMING.lampFlash);
    g.restartNotifyTimer(TIMING.medalDecay);
    const level = g.count();
    if (level === 1) {
      R.addScore(SCORE.medal.level1);
      R.info(INFO.levelOneCommendation, 2);
    } else if (level === 2) {
      R.addScore(SCORE.medal.level2);
      R.info(INFO.levelTwoCommendation, 2);
    } else {
      awardExtraBall(4);
      R.info(INFO.levelThreeCommendation, 2);
    }
    reenableBank('medal');
  }

  function multiplierSet() {
    R.addScore(SCORE.multiplier.setComplete);              // paid at the OLD multiplier, then the field multiplier steps up
    const g = G.top_target_lights;
    g.nextOn(TIMING.lampFlash);
    g.restartNotifyTimer(TIMING.multiplierDecay);
    s.mult = Math.min(4, g.count());
    if (s.mult >= 1) R.info(INFO.fieldMultiplier[s.mult - 1], 2);
    reenableBank('multiplier');
  }

  function popupHit(e) {
    const t = POPUP[e.name];
    if (!t || s.popDown[e.name]) return;
    s.popDown[e.name] = true;
    const names = D.BANKS[t.bank];
    const allDown = names.every((n) => s.popDown[n]);
    if (t.bank === 'booster') {
      if (allDown) boosterSet(); else R.addScore(SCORE.booster.each);
    } else if (t.bank === 'medal') {
      if (allDown) medalSet(); else R.addScore(SCORE.medal.each);
    } else if (allDown) {
      multiplierSet();
    } else {
      R.addScore(SCORE.multiplier.each);
    }
    fwd({ k: 'popup', name: e.name });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Spot targets (SPEC 5.4.8, 5.4.10, 5.9)
  // ---------------------------------------------------------------------------------------------------------------------------------
  /** hazard bank bookkeeping: the field register keeps bit 1/2/4 per hit target (lite104 left, lite107 right). */
  function hazardBits(reg, index) {
    const bits = lamps.getField(reg) | (1 << index);
    lamps.setField(reg, bits);
    return bits;
  }

  function soloHit(e) {
    const t = SOLO[e.name];
    if (!t) return;
    switch (t.bankKind) {
      case 'fuel': {
        R.addScore(SCORE.fuelSpot);
        lamps.flashThenOn(t.lamp, TIMING.lampFlash);
        if (G.top_circle_tgt_lights.count() === 3) {
          G.top_circle_tgt_lights.broadcast('flashThenOff', TIMING.lampFlash);
          R.info(INFO.shipRefueled, 2);
          refuel();
          R.play('SW25');
        } else {
          R.play('SW49D');
        }
        break;
      }
      case 'mission': {
        R.addScore(SCORE.missionSpot);
        lamps.flashThenOn(t.lamp, TIMING.lampFlash);
        if (G.ramp_tgt_lights.count() === 3) G.ramp_tgt_lights.broadcast('flashThenOff', TIMING.lampFlash);
        break;                                             // the select-mission controller (R.m) plays its own sound
      }
      case 'leftHazard':
      case 'rightHazard': {
        const left = t.bankKind === 'leftHazard';
        const group = left ? G.lchute_tgt_lights : G.bpr_solotgt_lights;
        R.addScore(SCORE.hazard);
        lamps.flashThenOn(t.lamp, TIMING.lampFlash);
        hazardBits(left ? 'lite104' : 'lite107', t.index);
        if (group.count() === 3) {
          group.broadcast('flashThenOff', TIMING.lampFlash);
          openGate(left ? 1 : 2);                          // left bank re-opens gate 1 (left outlane), right bank gate 2
          R.play('SW14');
        } else {
          R.play('SW49D');
        }
        break;
      }
      case 'wormhole': {
        R.addScore(SCORE.wormholeTarget);
        advanceDest();
        break;
      }
      default: return;
    }
    fwd({ k: 'solo', name: e.name, bank: t.bankKind, index: t.index });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Wormholes (SPEC 5.9)
  // ---------------------------------------------------------------------------------------------------------------------------------
  const ARROWS = ['lite2', 'lite3', 'lite4'];
  const destOf = () => lamps.getField('lite4');
  function setDest(d) {
    for (const a of ARROWS) {
      lamps.setField(a, d);
      if (d > 0) lamps.setOnIdx(a, 3 - d);
    }
  }

  /** a_targ22 / flag loop / Space Radiation / Maelstrom: next destination colour (3 -> 1); blocked during the Secret mission. */
  function advanceDest() {
    const st = R.m.state;
    if (st === 16 || st === 22 || st === 23) return;
    const d = destOf();
    const next = d >= 3 ? 1 : d + 1;
    setDest(next);
    if (d === 0) {
      G.worm_hole_lights.broadcast('on');
      G.bsink_arrow_lights.broadcast('on');
      lamps.flashThenOn('lite110', 3);
      R.info(INFO.wormholeOpened, 2);
    }
  }

  function clearDest() {
    setDest(0);
    G.worm_hole_lights.broadcast('off');
    G.bsink_arrow_lights.broadcast('off');
    lamps.off('lite110');
  }

  /** Flash the rim lamp + arrow of a sink while the ball is held / on its way out (2 s). */
  function flashSink(id) {
    lamps.flashThenOff(SINK_RIM[id], D.SINKS[0].holdSeconds);
    lamps.setOnIdx(SINK_ARROW[id][0], SINK_ARROW[id][1]);
    lamps.flashThenOff(SINK_ARROW[id][0], D.SINKS[0].holdSeconds);
  }

  function sinkCapture(e) {
    const id = e.id;
    if (id === 7) { physics.sinkSetRoute(7, 7, D.SINKS.find((x) => x.id === 7).holdSeconds); return; }
    if (id !== 1 && id !== 2 && id !== 3) return;
    const hold = D.SINKS.find((x) => x.id === id).holdSeconds;
    const d = destOf();
    let exit = id;
    if (d !== 0) {
      clearDest();
      if (d === id) {
        lamps.on('lite199');
        R.info(INFO.replayAwarded, 4);
        R.addScore(SCORE.wormhole.match);
      } else {
        R.addScore(SCORE.wormhole.mismatch);
        exit = d;
      }
    } else {
      R.addScore(SCORE.wormhole.none);
    }
    R.info(INFO.wormhole, 2);
    flashSink(exit);
    physics.sinkSetRoute(id, exit, hold);
    fwd({ k: 'wormhole', id });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Flag spinners (SPEC 5.4.12)
  // ---------------------------------------------------------------------------------------------------------------------------------
  function flagFrame(e) {
    R.addScore(lamps.lightOn('lite20') ? SCORE.flagFrameUpgraded : SCORE.flagFrame);
    fwd({ k: 'flag', name: e.name });
  }
  function flagLoop() {
    if (destOf() !== 0) advanceDest();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Centre post, extra-ball lamps, gravity well, grand reward
  // ---------------------------------------------------------------------------------------------------------------------------------
  /** Post up for 55 s (+5 s flashing); lamp lite1 FORCE_ON for 55 s, then a 5 s blink (rules timer: lite1 has no hook). */
  function raiseCentrePost() {
    physics.blockerSetEnabled(true);
    R.play('BLOCKER_MOVE');
    lamps.timedOn('lite1', TIMING.centerPostOn);
    R.startH('post55', TIMING.centerPostOn, () => lamps.flash('lite1', TIMING.centerPostFlash));
    R.startH('post60', TIMING.centerPostOn + TIMING.centerPostFlash, () => {
      if (!s.easyMode) physics.blockerSetEnabled(false);
      R.play('BLOCKER_MOVE');
    });
  }
  function cancelCentrePost() {
    R.cancelH('post55');
    R.cancelH('post60');
  }

  function lightExtraBall() {
    lamps.timedOn('lite17', TIMING.extraBallOn);
    lamps.timedOn('lite18', TIMING.extraBallOn);
    s.ebPending = true;
  }

  function armGravityWell() {
    physics.kickoutSetActive(1, true);
    lamps.flasherStart('lite62');
  }

  /** SPEC 5.7.6: Maelstrom finale (lite130 lit at the hyperspace chute). */
  function grandReward() {
    s.mult = 4;
    G.top_target_lights.broadcast('on');
    G.top_target_lights.restartNotifyTimer(TIMING.multiplierDecay);
    G.bumper_target_lights.broadcast('on');
    G.bumper_target_lights.restartNotifyTimer(TIMING.medalDecay);
    s.jackpotFlag = true;
    lamps.timedOn('lite60', TIMING.upgradeWindow);
    s.bonusFlag = true;
    lamps.timedOn('lite59', TIMING.upgradeWindow);
    lamps.timedOn('lite19', TIMING.upgradeWindow);
    lamps.timedOn('lite20', TIMING.upgradeWindow);
    lamps.timedOn('lite61', TIMING.upgradeWindow);
    lamps.on('lite58');
    lamps.on('lite27');
    lamps.on('lite28');
    lightExtraBall();
    raiseCentrePost();
    armGravityWell();
    P().jackpot = Math.max(P().jackpot, D.POTS.grandRewardMin);
    s.bonus = Math.max(s.bonus, D.POTS.grandRewardMin);
    lamps.off('lite130');
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Kickouts (SPEC 5.4.2, 5.4.11)
  // ---------------------------------------------------------------------------------------------------------------------------------
  /** Sound key table for the hyperspace chute when none of the reflex flags is lit: by the lit-lamp count BEFORE the hit. */
  const HYPER_SOUND = { 1: 'SW36', 2: 'SW35', 3: 'SW38', 4: 'SW39' };

  function hyperspace() {
    const H = G.hyperspace_lights;
    const n = H.count();
    const l25 = lamps.lightOn('lite25');
    const l26 = lamps.lightOn('lite26');
    const l130 = lamps.lightOn('lite130');
    const flags = (l25 ? 1 : 0) + (l26 ? 2 : 0) + (l130 ? 4 : 0);
    H.nextOn(TIMING.lampFlash);
    H.restartNotifyTimer(TIMING.hyperspaceDecay);
    switch (n) {
      case 0:
        R.addScore(SCORE.hyperspace[0]);
        R.info(fmt(INFO.hyperspaceBonus, SCORE.hyperspace[0]), 2);
        break;
      case 1: {
        const jackpot = P().jackpot;
        R.specialAdd(jackpot);
        P().jackpot = D.POTS.jackpotStart;
        R.info(fmt(INFO.jackpotAwarded, jackpot), 2);
        break;
      }
      case 2:
        raiseCentrePost();
        R.addScore(SCORE.hyperspace[2]);
        R.info(fmt(INFO.centerPost, SCORE.hyperspace[2]), 2);
        break;
      case 3:
        lightExtraBall();
        R.addScore(SCORE.hyperspace[3]);
        R.info(fmt(INFO.extraBallAvailable, SCORE.hyperspace[3]), 2);
        break;
      default:
        H.broadcast('turnOff');
        R.addScore(SCORE.hyperspace[4]);
        armGravityWell();
        R.info(fmt(INFO.gravityWell, SCORE.hyperspace[4]), 2);
        break;
    }
    if (l25) {
      R.specialAdd(s.reflex);
      R.info(fmt(INFO.reflexShotAward, s.reflex), 2);
    }
    if (l130) grandReward();

    let hold;
    let big = false;
    if (flags === 1) hold = R.play('SW21');
    else if (flags === 2 || flags === 3) hold = R.play('SW40');
    else if (flags >= 4) { hold = R.play('SW41'); R.play('SW36'); R.play('SW50'); big = true; }
    else hold = R.play(HYPER_SOUND[n] || 'SW35');
    if (!(hold > 0)) hold = D.KICKOUTS.find((k) => k.id === 2).defaultHold;
    lamps.flash('lite25', big ? hold + TIMING.reflexWindow : TIMING.reflexWindow);
    physics.kickoutSetHold(2, hold);
    fwd({ k: 'hyperspace' });
  }

  function gravityWell() {
    R.addScore(SCORE.gravityWell);
    R.info(fmt(INFO.gravityNormalized, SCORE.gravityWell), 2);
    lamps.off('lite62');
    physics.kickoutSetActive(1, false);
    let hold = R.play('SW7');
    if (!(hold > 0)) hold = D.KICKOUTS.find((k) => k.id === 1).defaultHold;
    physics.kickoutSetHold(1, hold);
  }

  function blackHole() {
    R.addScore(SCORE.blackHole);
    R.info(fmt(INFO.blackHole, SCORE.blackHole), 2);
    physics.kickoutSetHold(3, D.KICKOUTS.find((k) => k.id === 3).defaultHold);
    fwd({ k: 'blackHole' });
  }

  function kickoutCapture(e) {
    if (e.id === 1) gravityWell();
    else if (e.id === 2) hyperspace();
    else if (e.id === 3) blackHole();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Launch ramp, reflex shot, ramp hole (SPEC 5.4.3)
  // ---------------------------------------------------------------------------------------------------------------------------------
  function rampLine1() {
    const l54 = lamps.lightOn('lite54');
    const flags = (l54 ? 1 : 0) + (lamps.lightOn('lite55') ? 2 : 0) + (lamps.lightOn('lite56') ? 4 : 0);
    R.play(flags === 0 ? 'SW30' : flags === 1 ? 'SW21' : flags < 4 ? 'SW23' : 'SW24');
    if (flags === 0) {
      R.addScore(SCORE.rampPlain);
    } else if (l54) {
      R.specialAdd(s.reflex);
      R.info(fmt(INFO.reflexShotAward, s.reflex), 2);
    }
    fwd({ k: 'ramp' });
  }

  function rampHoleReleased() {
    lamps.flash('lite54', TIMING.reflexWindow);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Tripwires, one-ways, skill shot (SPEC 5.2.3)
  // ---------------------------------------------------------------------------------------------------------------------------------
  function tripwire(e) {
    const lamp = TRIPWIRE_LAMP[e.name];
    if (!lamp || !lamps.lightOn('lite67')) return;
    lamps.on(lamp);
    R.play('SW14');
  }

  function oneway(e) {
    switch (e.name) {
      case 's_onewy1':
        lamps.timedOn('lite200', TIMING.ballSaveSteady);
        if (lamps.lightOn('lite67')) {
          G.skill_shot_lights.groupReset();
          G.skill_shot_lights.broadcast('off');
          lamps.on('lite67');
          lamps.flash('lite54', TIMING.reflexWindow);
          lamps.flash('lite25', TIMING.reflexWindow);
          refuel();
          R.play('SW14');
        }
        break;
      case 's_onewy4': {
        const n = G.skill_shot_lights.count();
        if (n > 0) {
          const award = SCORE.skillShot[Math.min(n, SCORE.skillShot.length) - 1];
          R.addScore(award);
          R.info(fmt(INFO.skillShot, award), 2);
          R.play('SW3');
          if (!lamps.lightOn('lite56')) stopTrek();
          G.skill_shot_lights.groupReset();
          G.skill_shot_lights.flashWhenOn(TIMING.skillLampFlash);
        }
        R.m.deploy();
        break;
      }
      case 's_onewy10':
        G.skill_shot_lights.groupReset();
        G.skill_shot_lights.broadcast('off');
        R.m.deploy();
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Ball-feed lamp block and end-of-ball cleanup of the features (called from flow.js)
  // ---------------------------------------------------------------------------------------------------------------------------------
  /** First feed of a ball (not a ball-save / replay relaunch): SPEC 5.2.2. */
  function ballStartBlock() {
    G.skill_shot_lights.groupReset();
    G.skill_shot_lights.broadcast('off');
    lamps.on('lite67');
    G.skill_shot_lights.animationBackward(0.25);
    startTrek();
    s.reflex = SCORE.reflexShotStart;
    s.mult = 0;
    G.top_target_lights.broadcast('off');
    G.top_target_lights.restartNotifyTimer(-1);
    for (const m of lamps.fuel.members) lamps.on(m);       // all six fuel lamps lit while the LEVEL stays 0 (SPEC 5.5 quirk)
    lamps.on('lite200');
    openGate(1);
    openGate(2);
    if (s.easyMode) {                                      // easy mode keeps the post up: its lamp (cleared by the end-of-ball block) goes back on
      physics.blockerSetEnabled(true);
      lamps.on('lite1');
    }
  }

  /** The feature part of the end-of-ball reset (SPEC 5.2.4). */
  function endOfBall() {
    R.cancelH('attackDecay');
    R.cancelH('launchDecay');
    cancelCentrePost();
    R.cancelH('tilt');
    s.attackLevel = 0;
    s.launchLevel = 0;
    s.ebPending = false;
    for (const k of Object.keys(s.popDown)) s.popDown[k] = false;
    physics.popupReenable('all', true);
    physics.kickoutSetActive(1, false);                    // gravity well disarmed
    if (s.easyMode) {                                      // easy mode: post stays up, both gates stay open
      physics.blockerSetEnabled(true);
      physics.gateSetEnabled(1, false);
      physics.gateSetEnabled(2, false);
    } else {
      physics.gateSetEnabled(1, true);
      physics.gateSetEnabled(2, true);
      physics.blockerSetEnabled(false);
    }
    for (const g of [G.hyperspace_lights, G.bumper_target_lights, G.top_target_lights]) g.restartNotifyTimer(-1);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Hooks (SPEC 5.13.1): lamp timers and group decay timers
  // ---------------------------------------------------------------------------------------------------------------------------------
  lamps.onLampTimer('lite17', () => {                       // extra-ball lamps: after 55 s both flash 5 s
    if (!s.ebPending) return;
    s.ebPending = false;
    lamps.flash('lite17', TIMING.extraBallFlash);
    lamps.flash('lite18', TIMING.extraBallFlash);
  });
  lamps.onLampTimer('lite59', () => { s.bonusFlag = false; });
  lamps.onLampTimer('lite60', () => { s.jackpotFlag = false; });
  lamps.onLampTimer('lite200', () => {                      // ball save: 5 s steady, then 5 s flashing, then off
    if (lamps.getField('lite200') === 0) {
      lamps.flashThenOff('lite200', TIMING.ballSaveFlash);
      lamps.setField('lite200', 1);
    } else {
      lamps.setField('lite200', 0);
    }
  });

  G.hyperspace_lights.onNotifyExpired(() => {
    G.hyperspace_lights.dropTop();
    if (G.hyperspace_lights.count() > 0) G.hyperspace_lights.restartNotifyTimer(TIMING.hyperspaceDecay);
  });
  G.bumper_target_lights.onNotifyExpired(() => {
    G.bumper_target_lights.dropTop();
    if (G.bumper_target_lights.count() > 0) G.bumper_target_lights.restartNotifyTimer(TIMING.medalDecay);
  });
  G.top_target_lights.onNotifyExpired(() => {
    s.mult = Math.max(0, s.mult - 1);
    G.top_target_lights.dropTop();
    if (G.top_target_lights.count() > 0) G.top_target_lights.restartNotifyTimer(TIMING.multiplierDecay);
  });

  R.feat = {
    bumperHit, rebounderHit, popupHit, soloHit, rolloverEnter, tripwire, oneway, rampLine1, rampHoleReleased, kickoutCapture, sinkCapture,
    flagFrame, flagLoop, kickbackTimerExpired, flipperExtend,
    openGate, closeGate, startTrek, stopTrek, refuel, armGravityWell, setBumperLevel, raiseCentrePost, cancelCentrePost, lightExtraBall,
    advanceDest, clearDest, setDest, destOf, grandReward, ballStartBlock, endOfBall, levelOf, reenableBank, reenableAll, flashSink,
    sinkRim: SINK_RIM, sinkArrow: SINK_ARROW,
  };
}
