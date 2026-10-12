/**
 * src/render/cinematic.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: additive (Options > Cinematic Camera). Pure: no three, no DOM, no clock; Node-importable (tests/cinematic.test.mjs).
 *
 * The director of the cinematic camera. It decides WHEN the camera leaves the normal view and WHICH ball it follows; the camera rig
 * (cameras.js) decides how that looks. A shot:
 *   - starts when a flipper STRIKES a ball (physics event 'flipperHit', an extending flipper boosting the ball off its face) hard enough;
 *   - zooms in quickly (easeIn) and slows the simulation to `slowScale` (70 %) while the camera follows that ball;
 *   - lasts `holdSeconds` of real time; every time the score goes up while the ball is followed the shot is extended by `extendSeconds`
 *     (at most once per `extendGap`, never longer than `maxSeconds` in total);
 *   - ends early when the ball comes back down towards the flippers (lower part of the table, falling) so the player sees the flippers again,
 *     when the ball drains / is captured / disappears, on tilt, when the game stops, or when the option is switched off;
 *   - another strike during a shot refreshes it (and switches to the struck ball in multiball).
 * The zoom-out is slower (easeOut) than the zoom-in. Nothing here touches the simulation: main.js multiplies its frame time by timeScale().
 *
 *   const d = createCinematicDirector();
 *   d.setEnabled(true);
 *   game taps physics events -> d.onPhysicsEvents(events)
 *   per frame: d.update({balls, time, score, player, playing, tilted, paused}, realDt) -> d.state; next frame: game.advance(dt * d.timeScale())
 *
 * state (stable object, updated in place): {weight 0..1 (eased), active, ballId, target {x,y,z} (T-frame, smoothed), speed (smoothed u/s),
 * lead {x,y} (T-frame: where the camera looks ahead of the ball, along its smoothed velocity, so the ball has open space in front of it),
 * remaining (s), elapsed (s), shots (count)}.
 *
 * ASSUMPTIONS: times are REAL seconds (a "moment or two" is what the viewer sees, not simulation time); the ball list is the render frame's
 * (interpolated) one; BallSnap.y grows towards the flippers (T-frame), so a falling ball has a positive y velocity.
 */

/** Tunables (all times in real seconds, distances in table units). */
export const CINEMATIC = Object.freeze({
  slowScale: 0.7,          // simulation speed during a shot (70 %)
  holdSeconds: 1.7,        // follow time after a flipper strike
  extendSeconds: 0.9,      // added for every scoring moment while following
  extendGap: 0.2,          // at most one extension per this many seconds (spinners score every frame)
  maxSeconds: 7,           // hard cap of one shot (extensions included)
  minStrikeSpeed: 14,      // weaker flipper contacts (taps, a ball rolling off) start nothing
  easeIn: 0.3,             // zoom-in time
  easeOut: 0.6,            // zoom-out time
  returnY: 8.6,            // a ball below this table y (towards the flippers) ...
  returnVy: 1.5,           // ... and falling faster than this (u/s, simulation time) ends the shot ...
  returnGrace: 0.4,        // ... unless the strike was less than this ago (right after a flip the ball is still low)
  follow: 11,              // 1/s: how fast the camera target catches up with the ball
  leadRate: 5,             // 1/s: smoothing of the velocity the look-ahead uses (slower: no jerk on bounces)
  leadPerSpeed: 0.045,     // look-ahead distance per u/s of ball speed ...
  leadMax: 1.6,            // ... capped
});

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * @param {Partial<typeof CINEMATIC>} [opts] overrides of the tunables
 */
export function createCinematicDirector(opts = {}) {
  const C = { ...CINEMATIC, ...opts };
  let enabled = false;
  /** linear 0..1 ramp; state.weight = smoothstep(ramp) */
  let ramp = 0;
  /** @type {{ballId:number, speed:number}[]} strikes seen since the last update */
  const pending = [];
  let lastScore = -1, lastPlayer = 0, sinceExtend = 1e9, strikeAge = 0;
  let lastX = 0, lastY = 0, lastT = -1, vx = 0, vy = 0, svx = 0, svy = 0;
  let haveTarget = false;

  const state = {
    weight: 0, active: false, ballId: /** @type {number|null} */ (null),
    target: { x: 0, y: 0, z: 0 }, speed: 0, lead: { x: 0, y: 0 }, remaining: 0, elapsed: 0, shots: 0,
  };

  function end() {
    state.active = false;
    state.remaining = 0;
  }

  function findBall(balls, id) {
    if (!balls || id === null) return null;
    for (let i = 0; i < balls.length; i++) { const b = balls[i]; if (b && b.id === id) return b; }
    return null;
  }

  function usable(b) { return Boolean(b) && b.visible !== false && !b.held; }

  /** @param {{ballId:number, speed:number}} s @param {any} b the struck ball's snapshot @param {any} input */
  function start(s, b, input) {
    const fresh = !state.active;
    if (fresh || state.ballId !== s.ballId) {
      state.ballId = s.ballId;
      lastT = -1; vx = 0; vy = 0;
      if (!haveTarget || ramp < 0.05) { state.target.x = b.x; state.target.y = b.y; state.target.z = b.z || 0; state.speed = b.speed || 0; haveTarget = true; }
    }
    if (fresh) { state.elapsed = 0; state.remaining = C.holdSeconds; state.shots++; }
    else state.remaining = Math.max(state.remaining, Math.min(C.holdSeconds, C.maxSeconds - state.elapsed));
    state.active = true;
    strikeAge = 0;
    lastScore = typeof input.score === 'number' ? input.score : -1;
    lastPlayer = input.player;
  }

  return {
    state,
    /** Switch the cinematic camera on / off (off: a running shot fades out, normal speed comes back). @param {boolean} on */
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) { end(); pending.length = 0; }
    },
    isEnabled: () => enabled,
    /** Feed one drained batch of physics events (every batch, in order). @param {import('../types.js').PhysicsEvent[]} events */
    onPhysicsEvents(events) {
      if (!enabled || !events) return;
      for (let i = 0; i < events.length; i++) {
        const e = /** @type {any} */ (events[i]);
        if (e && e.type === 'flipperHit' && e.speed >= C.minStrikeSpeed) pending.push({ ballId: e.ballId, speed: e.speed });
      }
      if (pending.length > 16) pending.splice(0, pending.length - 16);
    },
    /**
     * Once per animation frame.
     * @param {{balls?:import('../types.js').BallSnap[], time?:number, score?:number, player?:number, playing?:boolean, tilted?:boolean, paused?:boolean}} input
     * @param {number} dt real seconds since the last frame
     */
    update(input, dt) {
      dt = dt > 0 ? Math.min(dt, 0.1) : 0;
      if (!input || input.paused) return state;                      // a paused game freezes the shot (and the camera)
      const balls = input.balls || [];
      const allowed = enabled && input.playing !== false && !input.tilted;
      // strikes since the last frame: the hardest one with a ball that is really on the table wins
      if (pending.length) {
        if (allowed) {
          let best = null, bestBall = null;
          for (const s of pending) {
            const b = findBall(balls, s.ballId);
            if (usable(b) && (!best || s.speed > best.speed)) { best = s; bestBall = b; }
          }
          if (best) start(best, bestBall, input);
        }
        pending.length = 0;
      }
      const ball = findBall(balls, state.ballId);
      if (state.active) {
        if (!allowed || !usable(ball)) end();
        else {
          state.elapsed += dt;
          state.remaining -= dt;
          strikeAge += dt;
          sinceExtend += dt;
          // points scored while following: more time (same player only; a new player's score is not "more points")
          const score = typeof input.score === 'number' ? input.score : -1;
          if (input.player === lastPlayer && lastScore >= 0 && score > lastScore && sinceExtend >= C.extendGap) {
            state.remaining = Math.min(state.remaining + C.extendSeconds, C.maxSeconds - state.elapsed);
            sinceExtend = 0;
          }
          lastScore = score; lastPlayer = input.player;
          if (strikeAge >= C.returnGrace && ball.y > C.returnY && vy > C.returnVy) end();
          else if (state.remaining <= 0) end();
        }
      }
      if (!state.active && state.ballId !== null && !usable(ball) && ramp <= 0) state.ballId = null;
      // camera target: follows the ball (also while fading out, as long as it is there)
      if (usable(ball)) {
        // velocity in simulation time (the frame's balls are interpolated, so this is smooth); a jump (sink re-emit) is not a speed
        const t = typeof input.time === 'number' ? input.time : -1;
        if (lastT >= 0 && t > lastT) {
          const ix = (ball.x - lastX) / (t - lastT), iy = (ball.y - lastY) / (t - lastT);
          if (Math.hypot(ix, iy) < 80) { vx = ix; vy = iy; }
        }
        if (t >= 0) { lastT = t; lastX = ball.x; lastY = ball.y; }
        const kl = 1 - Math.exp(-C.leadRate * dt);
        svx += (vx - svx) * kl; svy += (vy - svy) * kl;
        const sp = Math.hypot(svx, svy), lead = Math.min(C.leadMax, sp * C.leadPerSpeed);
        state.lead.x = sp > 1e-6 ? (svx / sp) * lead : 0;
        state.lead.y = sp > 1e-6 ? (svy / sp) * lead : 0;
        const k = 1 - Math.exp(-C.follow * dt);
        if (!haveTarget) { state.target.x = ball.x; state.target.y = ball.y; state.target.z = ball.z || 0; haveTarget = true; }
        state.target.x += (ball.x - state.target.x) * k;
        state.target.y += (ball.y - state.target.y) * k;
        state.target.z += ((ball.z || 0) - state.target.z) * k;
        state.speed += ((ball.speed || 0) - state.speed) * k;
      }
      // zoom ramp
      if (state.active) ramp = Math.min(1, ramp + dt / C.easeIn);
      else ramp = Math.max(0, ramp - dt / C.easeOut);
      state.weight = smooth(ramp);
      if (ramp <= 0 && !state.active) { haveTarget = false; svx = 0; svy = 0; state.lead.x = 0; state.lead.y = 0; }
      return state;
    },
    /** Simulation speed factor for the next frame: 1 normally, down to slowScale during a shot (eased with the zoom). */
    timeScale() { return 1 - (1 - C.slowScale) * state.weight; },
    /** Drop everything at once (new game, exit). */
    reset() {
      end();
      pending.length = 0;
      ramp = 0; state.weight = 0; state.ballId = null; state.elapsed = 0; haveTarget = false; lastT = -1; vx = 0; vy = 0; svx = 0; svy = 0;
      state.lead.x = 0; state.lead.y = 0;
    },
  };
}
