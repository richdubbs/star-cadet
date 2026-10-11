/**
 * src/rules/cheats.js
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 7.8; SPEC 5.10, 6.9
 * Typed cheat words and the debug keys.
 *   'hidden test'  toggles debug mode (does NOT mark CheatsUsed)
 *   'gmax'         arms the gravity well, info "Gravity Well"
 *   '1max'         one extra ball, info "Extra Ball" 2 s
 *   'bmax'         toggles "unlimited balls" for the current ball (the ball never drains; the flag clears at the next ball feed)
 *   'rmax'         one rank up ("Promotion to <rank>" 8 s)
 *   'easy mode'    toggles: centre post permanently up, both outlane gates open, kick-backs do not re-close them
 * Every word except 'hidden test' sets CheatsUsed (no high-score entry that game). Debug keys act only while debug is on:
 *   H name prompt with score 1,000,000,000   R +1 rank   B spawn a ball at (6.0, 7.0) if the spot is free   S add a random score 0..999,999
 *   I / J force every lamp on / off for 1.0 s   (Y = FPS is a UI matter and ignored here)
 * ASSUMPTIONS: gameplay cheats are accepted while a game is in the light show or playing; debug keys R, B and S also mark CheatsUsed.
 */

/** @param {object} R rules context (state.js) */
export function installCheats(R) {
  const { physics, lamps, D, s, G } = R;
  const { INFO } = D;
  const GATE_LAMP = { 1: D.GATES.find((g) => g.id === 1).lamps[0], 2: D.GATES.find((g) => g.id === 2).lamps[0] };
  const SPAWN = [6.0, 7.0];
  const SPAWN_CLEAR = 1.2 * 2 * D.TABLE.R;

  const live = () => s.phase === 'playing' || s.phase === 'lightShow';
  const mark = () => { s.cheatsUsed = true; };

  function applyEasyMode() {
    if (s.easyMode) {
      physics.blockerSetEnabled(true);
      physics.gateSetEnabled(1, false);
      physics.gateSetEnabled(2, false);
      lamps.on('lite1');
    } else {
      physics.blockerSetEnabled(false);
      lamps.off('lite1');
      for (const id of [1, 2]) physics.gateSetEnabled(id, !lamps.lightOn(GATE_LAMP[id]));
    }
  }

  /** @param {string} word one of CHEAT_WORDS */
  function cheat(word) {
    if (word === 'hidden test') { s.debug = !s.debug; return; }
    if (!live()) return;
    switch (word) {
      case 'gmax':
        mark();
        R.feat.armGravityWell();
        R.info(INFO.gravityWellCheat, 2);
        break;
      case '1max':
        mark();
        R.P().extraBalls += 1;
        R.info(INFO.extraBall, 2);
        break;
      case 'bmax':
        mark();
        s.unlimited = !s.unlimited;
        break;
      case 'rmax':
        mark();
        R.ranks.promoteOne();
        break;
      case 'easy mode':
        mark();
        s.easyMode = !s.easyMode;
        applyEasyMode();
        break;
      default:
        break;
    }
  }

  /** @param {string} key 'H' | 'R' | 'B' | 'S' | 'I' | 'J' (| 'Y') */
  function debugKey(key) {
    if (!s.debug) return;
    switch (String(key).toUpperCase()) {
      case 'H':
        R.flow.queuePrompt(s.cur + 1, 1000000000);
        break;
      case 'R':
        mark();
        R.ranks.promoteOne();
        break;
      case 'B': {
        mark();
        const free = !physics.balls.some((b) => b && b.active !== false && Math.hypot(b.x - SPAWN[0], b.y - SPAWN[1]) < SPAWN_CLEAR);
        if (free) physics.spawnBall(SPAWN[0], SPAWN[1]);
        break;
      }
      case 'S':
        mark();
        R.addScore(Math.floor(R.rand() * 1000000));
        break;
      case 'I':
        G.all.broadcast('timedOn', 1.0);
        break;
      case 'J':
        G.all.broadcast('timedOff', 1.0);
        break;
      default:
        break;
    }
  }

  R.cheats = { cheat, debugKey };
}
