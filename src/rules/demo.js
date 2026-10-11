/**
 * src/rules/demo.js
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 12.3; SPEC 5.2.9, 2.19
 * Demo-mode "AI": the five invisible demo triggers (ids 1400..1404, physics event `demoTrigger`) schedule flipper / plunger presses through
 * the rules' Scheduler and drive physics.setFlipperButton / setPlungerButton DIRECTLY (rules.input is blocked in demo mode).
 *   1400 / 1402  schedule a (left / right) press after t1 + t2 - rand()*2*t2 s, unless that flipper is pending or held
 *   1401 / 1403  press (left / right) now, unless it is already held
 *   1404         pull the plunger; release after 2.0 + rand() s (and, if the ball is still on the plunger 1.5 s later, pull again)
 *   a pressed flipper is released after u1 + u2 - rand()*2*u2 s;  (t1, t2, u1, u2) = DEMO_TIMERS (0.2, 0.1, 0.4, 0.2)
 * Nudging is never used. reset() forgets pending state (the scheduler itself is cleared by the caller).
 */

/** @param {object} R rules context (state.js) */
export function installDemo(R) {
  const { physics, sched, D, s, rand } = R;
  const timers = D.DEMO_TIMERS;
  const sides = { left: { pending: null, held: false }, right: { pending: null, held: false } };
  let plungerHeld = false;

  function press(side) {
    const st = sides[side];
    if (st.held) return;
    st.held = true;
    physics.setFlipperButton(side, true);
    const hold = timers.u1 + timers.u2 - rand() * 2 * timers.u2;
    sched.after(hold, () => {
      st.held = false;
      physics.setFlipperButton(side, false);
    });
  }

  function schedulePress(side) {
    const st = sides[side];
    if (st.pending !== null || st.held) return;
    const delay = timers.t1 + timers.t2 - rand() * 2 * timers.t2;
    st.pending = sched.after(delay, () => {
      st.pending = null;
      press(side);
    });
  }

  function pullPlunger() {
    if (plungerHeld) return;
    plungerHeld = true;
    physics.setPlungerButton(true);
    sched.after(2.0 + rand(), () => {
      plungerHeld = false;
      physics.setPlungerButton(false);
      // the 'ball entered the plunger zone' trigger fires once: a pull that was cut short (window focus lost mid-pull, a weak launch that rolled back)
      // would leave the attract game waiting on the plunger for ever, so look again once a launch has had time to happen
      sched.after(1.5, () => {
        if (s.demo && s.phase === 'playing' && typeof physics.ballAtPlunger === 'function' && physics.ballAtPlunger()) pullPlunger();
      });
    });
  }

  /** @param {number} id demo trigger id 1400..1404 */
  function onTrigger(id) {
    if (!s.demo || s.phase !== 'playing') return;
    switch (id) {
      case 1400: schedulePress('left'); break;
      case 1401: press('left'); break;
      case 1402: schedulePress('right'); break;
      case 1403: press('right'); break;
      case 1404: pullPlunger(); break;
      default: break;
    }
  }

  function reset() {
    sides.left.pending = null; sides.left.held = false;
    sides.right.pending = null; sides.right.held = false;
    plungerHeld = false;
  }

  R.demo = { onTrigger, reset };
}
