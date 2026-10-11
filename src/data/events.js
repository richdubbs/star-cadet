/**
 * src/data/events.js
 * OWNER: DATA  (ARCHITECT-SEEDED, FROZEN CONTRACT: names may be added, never renamed or removed)
 * STATUS: IMPLEMENTED  (seeded by the architect; verified against the SPEC and research/*.json by tests/data.test.mjs)
 *
 * Physics -> Rules event type names. An event is a plain object { type, t, ...payload } (payload shapes: src/types.js
 * `PhysicsEvent`, and ARCHITECTURE.md section 5.3). PHYSICS emits with these constants, RULES switches on them.
 * Pure, Node-safe.
 */

export const EV = Object.freeze({
  BUMPER_HIT: 'bumperHit',                 // {name, impact}            hard hit only (impact > 2.5), never while tilt-locked
  REBOUNDER_HIT: 'rebounderHit',           // {name, impact}            hard hit only (impact >= 1.0)
  POPUP_HIT: 'popupHit',                   // {name}                    drop target went DOWN
  POPUP_UP: 'popupUp',                     // {name}                    drop target physically re-raised
  SOLO_HIT: 'soloHit',                     // {name, impact}            hard hit only (impact > 3.0)
  ROLLOVER_ENTER: 'rolloverEnter',         // {name}                    entry polygon crossed (also a_roll9)
  TRIPWIRE: 'tripwire',                    // {name}                    s_trip1..5, ball travelling against the normal
  ONEWAY: 'oneway',                        // {name}                    pass-through trigger fired (all 9 one-ways; rules filters)
  ONEWAY_SIDE: 'onewaySide',               // {name, impact}            wall side hit with impact > 0.2 (sound only)
  RAMP_LINE1: 'rampLine1',                 // {}                        mask-4 ball crossed Line 1
  RAMP_ENTER: 'rampEnter',                 // {ramp}                    'ramp' | 's_ramp9' (informational)
  RAMP_EXIT: 'rampExit',                   // {ramp, mask}              informational
  RAMP_HOLE_CAPTURED: 'rampHoleCaptured',  // {}                        informational
  RAMP_HOLE_RELEASED: 'rampHoleReleased',  // {}                        ball dropped to the floor above a_roll5
  KICKOUT_CAPTURE: 'kickoutCapture',       // {id: 1|2|3}               rules MAY call kickoutSetHold(id, s) in the handler
  KICKOUT_EJECT: 'kickoutEject',           // {id}
  SINK_CAPTURE: 'sinkCapture',             // {id: 1|2|3|7}             rules MAY call sinkSetRoute(id, exitId, hold) in the handler
  SINK_EJECT: 'sinkEject',                 // {id, from}                id = sink the ball leaves from, from = sink entered
  FLAG_FRAME: 'flagFrame',                 // {name, frame, dir}        every sprite step (score handler)
  FLAG_LOOP: 'flagLoop',                   // {name}                    frame wrapped to 0
  KICKBACK_FIRED: 'kickbackFired',         // {id: 1|2}                 the kick happened (sound)
  KICKBACK_TIMER_EXPIRED: 'kickbackTimerExpired', // {id}               final 0.1 s timer after the kick (re-enable gate, lamps off)
  BLOCKER_HIT: 'blockerHit',               // {impact}
  DRAIN: 'drain',                          // {ballId, remaining, via}  a ball was removed; remaining = balls still in play
  PLUNGER_FED: 'plungerFed',               // {ballId}                  new ball created at the plunger
  PLUNGER_PULL: 'plungerPull',             // {}                        charge started (silent sound slot)
  PLUNGER_RELEASE: 'plungerRelease',       // {boost, hitBall}
  STUCK_RELAUNCH: 'stuckRelaunch',         // {}                        stuck ball removed + relaunched by physics
  FLIPPER: 'flipper',                      // {side, action, byKey}     'extend' | 'retract'
  NUDGE: 'nudge',                          // {dir}
  NUDGE_COUNT: 'nudgeCount',               // {level, count}            level 'warn' (count>0.5) | 'tilt' (count>1.0); once per crossing
  DEMO_TRIGGER: 'demoTrigger',             // {id: 1400..1404}
});

/** All event type strings (for exhaustive tests). */
export const EVENT_TYPES = Object.freeze(Object.values(EV));
