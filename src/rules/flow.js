/**
 * src/rules/flow.js
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 5.5 (sequences), 7.3, 7.8, 7.9; SPEC 5.2 (all), 4.11 (tilt consequences), 6.5 (input gating)
 * Game flow: new game + light show, ball feed, drain / ball save / replay / extra ball / end-of-ball reset block, multiplayer turn change,
 * tilt, game over + EndGame + name prompts + the mission-box cycle, pause, demo on/off, exit, input gating.
 * Phases: idle -> lightShow -> playing -> gameOver (-> lightShow ...).  `gameOver` is entered when the last ball's 1.82 s drain timer ends
 * (flippers disabled, nothing in play); the EndGame step 3.0 s later sets gameOverEnded ("F2 Starts New Game", name prompts, twinkle, cycle).
 * ASSUMPTIONS: a drain with via 'forced' (the 30 s tilt timeout, tests) never uses the ball save / replay; a repeated `drain` with remaining 0
 * while the drain timer runs is ignored; "Game Over" / "F2 Starts New Game" / "Game Paused"
 * clear the info box first so they show at once; the demo restarts 5.0 s after the game-over step began; cheat `bmax` re-feeds the ball
 * silently (no bonus, no ball lost) and clears itself at the next feed; the tilt text "TILT!" is removed again when the next ball is fed.
 */

/** @param {object} R rules context (state.js) */
export function installFlow(R) {
  const { physics, lamps, sched, D, s, G } = R;
  const { INFO, TIMING, POTS, fmt } = D;
  const T = D.MISSION_TEXT;

  const playerText = (n) => fmt(s.demo ? INFO.demoPlayer : INFO.player, n);

  function clearTimers() {
    sched.cancelAll();
    for (const k of Object.keys(s.h)) s.h[k] = null;
  }

  /** Everything a new game / exit / demo-off wipes (SPEC 5.2.1 step 1). */
  function resetEverything() {
    clearTimers();
    R.infoBox.clear();
    R.missionBox.clear();
    s.paused = false; s.tilted = false; s.cheatsUsed = false; s.unlimited = false; s.easyMode = false;
    s.ballInDrain = false; s.lastBall = false; s.gameOverEnded = false;
    s.prompt = null; s.promptQueue.length = 0;
    s.bonus = POTS.bonusNewGame; s.bonusFlag = false; s.jackpotFlag = false; s.reflex = 0; s.mult = 0;
    s.attackLevel = 0; s.launchLevel = 0; s.ebPending = false; s.rankFlashPending = false;
    for (const k of Object.keys(s.popDown)) s.popDown[k] = false;
    R.resetPlayers();
    R.m.reset();
    R.demo.reset();
    physics.removeAllBalls();
    physics.resetTable();
    physics.setFlippersEnabled(true);
    physics.setDemoTriggers(s.demo);
    lamps.resetAll();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // New game and the start-up light show (SPEC 5.2.1)
  // ---------------------------------------------------------------------------------------------------------------------------------
  /** Starts a game with the current s.demo flag. F2 during the light show cuts it and starts ball 1 at once. */
  function startNewGame(opts) {
    const wasShow = s.phase === 'lightShow';
    if (opts && opts.players !== undefined) R.setPlayerCount(opts.players);
    resetEverything();
    if (wasShow) { startGamePlayer1(); return; }
    s.phase = 'lightShow';
    G.all.lightShow(TIMING.lightShowStep);
    const d = R.play('NEW_GAME');
    R.startH('show', d > 0 ? d : TIMING.lightShowFallback, startGamePlayer1);
  }

  /** User-initiated new game (F2 / menu): leaves demo mode. */
  function newGame(opts) {
    s.demo = false;
    startNewGame(opts);
  }

  /** End of the light show: the board goes dark, "Player 1" is shown and ball 1 is fed. */
  function startGamePlayer1() {
    s.h.show = null;
    G.all.groupReset();
    G.all.broadcast('off');
    R.info(playerText(1), -1);
    s.phase = 'playing';
    feedBall();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Ball feed (SPEC 5.2.2)
  // ---------------------------------------------------------------------------------------------------------------------------------
  function feedBall() {
    s.unlimited = false;
    const resave = lamps.lightOn('lite200');                // a ball-save / replay relaunch keeps ALL table state
    if (G.middle_circle.count() === 0) G.middle_circle.offsetForward();
    if (!resave) R.feat.ballStartBlock();
    lamps.setField('lite200', 0);
    R.play('BALL_FEED');
    if (resave) physics.relaunch(); else physics.startFeed({});
  }

  function onPlungerFed() {
    if (s.tilted) {
      s.tilted = false;
      lamps.clearTiltLock();
    }
    if (R.infoBox.current() === INFO.tilt) R.infoBox.clear();
    if (R.m.state === 0) R.msg(T.awaitingDeployment, -1); else R.m.showText();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Drain, ball save, replay, extra ball, turn change (SPEC 5.2.4 - 5.2.6, 5.2.10)
  // ---------------------------------------------------------------------------------------------------------------------------------
  function onDrain(e) {
    const remaining = Number.isFinite(e.remaining) ? e.remaining : physics.ballsInPlay();
    if (remaining > 0 || s.phase !== 'playing' || s.ballInDrain) return;
    s.ballInDrain = true;
    R.cancelH('tilt');
    if (s.unlimited) {                                      // cheat bmax: the ball never drains
      s.ballInDrain = false;
      R.play('BALL_FEED');
      physics.startFeed({});
      return;
    }
    if (s.tilted || e.via === 'forced') {                   // no ball save / replay on a tilt (the 30 s timeout drains with via 'forced')
      lamps.off('lite200');
      lamps.off('lite199');
    }
    if (lamps.lightOn('lite200')) {                         // BALL SAVE
      R.play('SW27');
      lamps.on('lite200');
      R.info(INFO.redeploy, -1);
    } else if (lamps.lightOn('lite199')) {                  // REPLAY
      R.play('SW27');
      lamps.off('lite199');
      lamps.on('lite200');
      R.info(INFO.replayBall, 2);
    } else {                                                // REAL end of ball
      if (!s.tilted) {
        R.play('SW27');                                     // SPEC 7.3: the drain sound also plays on an ordinary drain
        R.specialAdd(s.bonus);
        R.info(fmt(INFO.crashBonus, s.bonus), 2);
      }
      const P = R.P();
      if (P.extraBalls > 0) {
        P.extraBalls -= 1;
        R.play('SW59');                                     // the shoot-again drain sound (file absent in the release: silent)
        R.info(fmt(INFO.playerShootAgain, s.cur + 1), -1);
      } else {
        P.ballCount -= 1;
        if (s.cur + 1 !== s.playerCount || P.ballCount !== 0) {
          switchToNextPlayer();
          s.lastBall = false;
        } else {
          s.lastBall = true;
        }
        lamps.setField('lite199', s.lastBall ? 1 : 0);
      }
      endOfBallReset();
    }
    R.startH('drain', TIMING.drainDelay, afterDrain);
  }

  function afterDrain() {
    s.ballInDrain = false;
    if (s.lastBall) gameOver(); else feedBall();
  }

  /** Hot-seat turn change: lamps are saved / restored per player and the reset block then runs on the INCOMING player's lamps. */
  function switchToNextPlayer() {
    if (s.playerCount < 2) return;
    const outgoing = s.cur;
    const incoming = (s.cur + 1) % s.playerCount;
    lamps.playerChanged(outgoing, incoming);
    s.cur = incoming;
    R.info(playerText(incoming + 1), -1);
  }

  /** The end-of-ball reset block (SPEC 5.2.4). Rank lamps, lite58, lite199, lite200, lite84/85 and the 23 goal lamps are not in it. */
  function endOfBallReset() {
    for (const n of ['skill_shot_lights', 'l_trek_lights', 'r_trek_lights']) G[n].groupReset();
    for (const n of ['bmpr_inc_lights', 'ramp_bmpr_inc_lights']) G[n].broadcast('off');
    for (const l of ['lite30', 'lite29', 'lite1', 'lite54', 'lite55', 'lite56', 'lite17', 'lite18', 'lite27', 'lite28', 'lite16', 'lite20']) lamps.off(l);
    G.hyperspace_lights.broadcast('off');
    for (const l of ['lite25', 'lite26', 'lite130', 'lite19']) lamps.off(l);
    for (const n of ['worm_hole_lights', 'bsink_arrow_lights', 'l_trek_lights', 'r_trek_lights']) G[n].broadcast('off');
    for (const l of ['lite60', 'lite59', 'lite61']) lamps.off(l);
    for (const n of ['bumper_target_lights', 'top_target_lights', 'top_circle_tgt_lights', 'ramp_tgt_lights', 'lchute_tgt_lights',
      'bpr_solotgt_lights', 'skill_shot_lights']) G[n].broadcast('off');
    for (const l of ['lite110', 'lite77', 'lite198', 'lite196', 'lite195']) lamps.off(l);
    for (const m of lamps.fuel.members) lamps.off(m);
    lamps.fuel.reset();                                     // fuel level 0
    lamps.off('lite62');
    R.feat.endOfBall();                                     // gravity well disarmed, gates re-closed, post removed, targets up, bumpers 0
    for (const a of ['lite2', 'lite3', 'lite4', 'lite101', 'lite102', 'lite103']) lamps.setField(a, 0);
    R.m.endOfBall(s.lastBall);                              // mission cancelled: state 0 (32 when the game is over)
    G.outer_circle.groupReset();                            // rank lamps stay lit; only their animations stop
    G.middle_circle.groupReset();
    if (s.rankFlashPending) {                               // a promotion flash was still running: finish the progress reset now
      G.outer_circle.broadcast('off');
      s.rankFlashPending = false;
      R.cancelH('rankFlash');
    }
    s.tilted = false;                                       // ClearTiltLock
    physics.setTiltLock(false);
    lamps.clearTiltLock();
    if (lamps.lightOn('lite58')) lamps.off('lite58'); else s.bonus = POTS.bonusAfterBall;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Tilt (SPEC 4.11, 5.2.8)
  // ---------------------------------------------------------------------------------------------------------------------------------
  function tilt() {
    R.infoBox.clear();
    R.missionBox.clear();
    R.info(INFO.tilt, -1);
    R.play('TILT');
    lamps.fuel.reset();                                     // the fuel gauge level is reset on tilt
    lamps.tiltOff();
    s.tilted = true;
    physics.setTiltLock(true);
    R.startH('tilt', TIMING.tiltTimeout, () => physics.forceDrainAll());
  }

  function onNudgeCount(e) {
    if (s.tilted || s.phase !== 'playing') return;
    if (e.level === 'warn') R.info(INFO.careful, TIMING.carefulText);
    else if (e.level === 'tilt' && !s.ballInDrain) tilt();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Game over, EndGame, high scores (SPEC 5.2.7)
  // ---------------------------------------------------------------------------------------------------------------------------------
  const scoreCount = () => s.playerCount;
  function anyQualifies() {
    for (let i = 0; i < scoreCount(); i++) if (R.hs.qualifies(R.totalScore(i))) return true;
    return false;
  }

  function gameOver() {
    s.phase = 'gameOver';
    s.gameOverEnded = false;
    physics.setFlippersEnabled(false);
    physics.removeAllBalls();
    R.play('GAME_OVER');
    R.missionBox.clear();
    R.infoBox.clear();
    R.info(INFO.gameOver, -1);
    if (!s.demo && !s.cheatsUsed && anyQualifies()) {
      R.play('SW3');
      G.all.broadcast('flashThenOff', 3.0);
      R.msg(T.highScore, -1);
    }
    R.startH('end', TIMING.gameOverToEnd, endGame);
    if (s.demo) R.startH('demoRestart', TIMING.demoRestart, () => startNewGame());
  }

  function endGame() {
    s.gameOverEnded = true;
    R.infoBox.clear();
    R.info(INFO.f2StartsNewGame, -1);
    G.all.gameOver(1.4);
    if (!s.demo && !s.cheatsUsed) {
      const order = Array.from({ length: s.playerCount }, (_, i) => i).sort((a, b) => R.totalScore(b) - R.totalScore(a) || a - b);
      for (const i of order) s.promptQueue.push({ player: i + 1, score: R.totalScore(i) });
      if (!s.prompt) openNextPrompt();
    }
    cycle(0);
  }

  /** The mission box game-over cycle: title 10 s, every real player's score 3 s, every table entry 3 s, then again (plain order 1..5). */
  function cycle(i) {
    const list = [{ text: T.title, secs: 10 }];
    for (let p = 0; p < s.playerCount; p++) list.push({ text: fmt(T.playerScore, p + 1, R.totalScore(p)), secs: 3 });
    R.hs.entries().forEach((e, k) => { if (e.score > 0) list.push({ text: fmt(T.highScoreN, k + 1, e.score), secs: 3 }); });
    const item = list[i % list.length];
    R.msg(item.text, item.secs);
    R.startH('cycle', item.secs, () => cycle((i + 1) % list.length));
  }

  function openNextPrompt() {
    s.prompt = null;
    while (s.promptQueue.length) {
      const p = s.promptQueue.shift();
      if (R.hs.qualifies(p.score)) {
        s.prompt = { player: p.player, rank: R.hs.rankOf(p.score), score: p.score, defaultName: 'Player ' + p.player };
        return;
      }
    }
  }

  /** Queues a name prompt for (player, score); opens it at once when none is showing (debug key H). */
  function queuePrompt(player, score) {
    s.promptQueue.push({ player, score });
    if (!s.prompt) openNextPrompt();
  }

  /** @param {string|null} name null = cancel */
  function submitName(name) {
    const p = s.prompt;
    if (!p) return;
    if (name !== null && name !== undefined) {
      const text = String(name);
      R.hs.insert(text.trim() === '' ? p.defaultName : text, p.score);
    }
    openNextPrompt();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Pause, demo, exit
  // ---------------------------------------------------------------------------------------------------------------------------------
  function setPaused(on) {
    const v = !!on;
    if (v === s.paused) return;
    s.paused = v;
    if (s.phase === 'idle') return;
    R.infoBox.clear();
    if (v) R.info(INFO.gamePaused, -1);
    else if (s.phase === 'gameOver') R.info(s.gameOverEnded ? INFO.f2StartsNewGame : INFO.gameOver, -1);
    else R.info(INFO.continuePlay, 5);
  }

  /** Demo ended by the user: table reset, game-over state, mission box cleared, "F2 Starts New Game". */
  function endDemo() {
    resetEverything();
    physics.setFlippersEnabled(false);
    s.phase = 'gameOver';
    s.gameOverEnded = true;
    R.info(INFO.f2StartsNewGame, -1);
    G.all.gameOver(1.4);
  }

  function setDemo(on) {
    const v = !!on;
    if (v === s.demo) return;
    s.demo = v;
    if (v) startNewGame(); else endDemo();
  }

  /** Exit: table reset, phase idle, no text. */
  function stopGame() {
    s.demo = false;
    resetEverything();
    s.phase = 'idle';
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Input gating (ARCHITECTURE 7.8)
  // ---------------------------------------------------------------------------------------------------------------------------------
  const FLIPPER_SIDE = { flipperLeft: 'left', flipperRight: 'right' };
  const NUDGE_DIR = { nudgeLeft: 'left', nudgeRight: 'right', nudgeBottom: 'bottom' };

  const inputOpen = () => s.phase === 'playing' && !s.paused && !s.demo && !s.tilted;

  function input(action, down) {
    const on = !!down;
    if (FLIPPER_SIDE[action]) {
      if (!on || inputOpen()) physics.setFlipperButton(FLIPPER_SIDE[action], on);
    } else if (action === 'plunger') {
      if (!on || inputOpen()) physics.setPlungerButton(on);
    } else if (NUDGE_DIR[action]) {
      if (!on || inputOpen()) physics.nudge(NUDGE_DIR[action], on);
    }
  }

  function launchBall() {
    if (s.phase !== 'playing' || s.demo || s.paused) return false;
    return physics.launchInstant() !== false;
  }

  function focusLost() {
    physics.setFlipperButton('left', false);
    physics.setFlipperButton('right', false);
    // a player who pulled the plunger gets it back WITHOUT a half-power launch behind their back; the demo's own timed pull still releases (it has no key)
    if (!s.demo && typeof physics.cancelPlunger === 'function') physics.cancelPlunger(); else physics.setPlungerButton(false);
  }

  R.flow = {
    newGame, startNewGame, stopGame, setDemo, setPaused, input, launchBall, focusLost, submitName, queuePrompt, openNextPrompt,
    feedBall, onPlungerFed, onDrain, onNudgeCount, tilt, clearTimers, endOfBallReset, gameOver, endGame,
  };
}
