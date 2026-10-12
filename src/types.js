/**
 * src/types.js - SHARED TYPEDEFS. NO RUNTIME CODE.
 * OWNER: INTEGRATOR (content written by ARCHITECT; ARCHITECTURE.md wins on any mismatch - report it, do not "fix" the contract).
 * STATUS: IMPLEMENTED (integration pass: additive typedefs reported by the role hand-offs are merged in - see "ADDITIVE" notes below)
 *
 * Import for editor hints only:   /** @typedef {import('../types.js').Pt} Pt *\/
 * Nothing may import a runtime value from this file (it exports nothing).
 *
 * FRAME: every position below is in the T-frame (SPEC 1.1): +x = screen-LEFT, +y = DOWN the table toward the
 * player, +z = up. Units = table units, seconds, radians. Angles are CCW-positive in the T-frame.
 */
export {};

// =====================================================================================================
// 1. PRIMITIVES
// =====================================================================================================
/** @typedef {[number, number]} Pt           T-frame point [x, y] (static data uses arrays, never objects). */
/** @typedef {number} Seconds */
/** @typedef {() => number} Rand01           Uniform [0,1). The ONLY allowed source of randomness in physics/rules/lamps/art. */
/** @typedef {'left'|'right'} Side */
/** @typedef {{smoothness:number, elasticity:number}} Material */
/**
 * @typedef {Object} Kicker
 * @property {number} threshold        normal-speed threshold of a "hard hit" (default 8.9999999e10 = never)
 * @property {number} boost            speed added along the normal on a hard hit
 * @property {number} [throwMult]      kickout/sink: throw speed jitter factor (x0.01 applied by throwBall)
 * @property {[number,number,number]} [throwDir]
 * @property {number} [throwAngle]     radians, random +/- angle (only a_kout1 non-zero)
 */
/** @typedef {1|2|4|6} MaskBits         collision mask bit field: 1 playfield, 2 ramp/tube, 4 deck, 6 = shell 103 */
/** @typedef {typeof import('./data/index.js')} DataModule   the data barrel namespace (import * as data from './data/index.js') */
/**
 * Rounded, ball-radius-INFLATED collision primitive exactly as in research/physics_data.json (SPEC 4.6).
 * line: one-sided, blocks a ball moving AGAINST (nx,ny); circle: two-sided from outside.
 * `gate` (rollover edges only): 'active' = live while armed, 'rolloverflag' = live while a ball is inside.
 * `role` (oneway/kickout/hole/flag/sink edges): 'wall'|'passthrough'|'capture'|'side_a'|'side_b' ...
 * @typedef {({k:'line', x0:number, y0:number, x1:number, y1:number, nx:number, ny:number} |
 *            {k:'circle', cx:number, cy:number, r:number}) & {role?:string, gate?:'active'|'rolloverflag'}} PlainEdge
 */

// =====================================================================================================
// 2. DATA DEFINITIONS (src/data/*.js)  -- all deep-frozen, never mutated by anyone
// =====================================================================================================
/**
 * @typedef {Object} WallDef                  src/data/walls.js : WALLS (45 entries = 41 plain walls + shells 103/106 + v_rebo1-4)
 * @property {string} name                    'wall_280' | 'v_rebo1' ...   (DAT name if it has one, else 'wall_<group>')
 * @property {number} group                   DAT group number
 * @property {Pt[]} pts                       DAT order, the closing duplicate of the first vertex REMOVED
 * @property {number} mask                    1 | 2 | 4 | 6
 * @property {Material} material
 * @property {Kicker|null} kicker             v_rebo1-4 only ({threshold:1, boost:18}); all others null
 * @property {'island'|'shell'} solid         shoelace S>0 island (ball outside) ; S<0 shell (ball inside: groups 103 and 106)
 * @property {number|null} top                visual top z (absolute); null for shells 103/106
 * @property {string|null} lamp               rebounder decal lamp ('lite84' for v_rebo1, 'lite85' for v_rebo2) else null
 * @property {string} role                    short human text
 * @property {PlainEdge[]} edges              inflated collision edges (physics reads ONLY this)
 */
/**
 * @typedef {Object} PostDef                  src/data/walls.js : POSTS (19)
 * @property {string} name                    'post_310' ...
 * @property {number} group @property {Pt} c
 * @property {number} r                       DAT radius (ball sees r + 0.3)
 * @property {number} mask @property {Material} material
 * @property {number} top                     cap top z (0.9) or 1.57 for deck posts 326-328
 * @property {PlainEdge[]} edges
 */
/**
 * @typedef {Object} FlipperDef               FLIPPERS[0] = a_flip1 (LEFT on screen, +x), FLIPPERS[1] = a_flip2 (RIGHT)
 * @property {string} name  @property {number} group  @property {Side} side
 * @property {Pt} pivot @property {number} pivotR @property {Pt} restTip @property {number} tipR @property {Pt} raisedTip
 * @property {number} angleMax                +1.21523 (left) / -1.214923 (right)
 * @property {number} extendSeconds @property {number} retractSeconds @property {number} collisionMult
 * @property {Material} material @property {number} mask
 */
/**
 * @typedef {Object} PlungerDef               PLUNGER
 * @property {string} name @property {number} group
 * @property {[Pt,Pt]} face                   un-inflated face line (y = 11.974978)
 * @property {Pt} feed                        new-ball position (-7.020939, 10.084854)
 * @property {Material} material              {smoothness:0.5, elasticity:0.5}
 * @property {number} maxBoost @property {number} tickSeconds @property {number} feedDelay @property {number} mask
 * @property {PlainEdge[]} edges              [contact line y = 11.675, normal (0,-1)]
 */
/**
 * @typedef {Object} BumperDef                BUMPERS (7)
 * @property {string} name @property {number} group @property {'attack'|'launch'} kind
 * @property {Pt} c @property {number} r      DAT radius (0.35 attack / 0.25 launch); ball sees r+0.3
 * @property {number} mask @property {Material} material @property {Kicker} kicker @property {number} hitSeconds
 * @property {PlainEdge[]} edges
 */
/**
 * @typedef {Object} PopupTargetDef           POPUP_TARGETS (9)
 * @property {string} name @property {number} group @property {Pt[]} poly @property {Pt} center
 * @property {'booster'|'medal'|'multiplier'} bank @property {0|1|2} index
 * @property {Kicker} kicker @property {Material} material @property {number} mask @property {number} repopSeconds @property {number} top
 * @property {PlainEdge[]} edges
 */
/**
 * @typedef {Object} SoloTargetDef            SOLO_TARGETS (13)
 * @property {string} name @property {number} group @property {Pt[]} poly @property {Pt} center
 * @property {'fuel'|'mission'|'leftHazard'|'rightHazard'|'wormhole'} bankKind @property {number} index  index inside its bank
 * @property {string} lamp                    e.g. 'lite70'
 * @property {Kicker} kicker @property {Material} material @property {number} mask @property {number} rearmSeconds @property {number} top
 * @property {PlainEdge[]} edges
 */
/**
 * @typedef {Object} KickbackDef              KICKBACKS (2)
 * @property {string} name @property {number} group @property {1|2} id @property {[Pt,Pt]} line  un-inflated
 * @property {string} gate                    'v_gate1' | 'v_gate2'
 * @property {Material} material @property {Kicker} kicker  {threshold:0 (value when ARMED), boost:55}
 * @property {number} armSeconds @property {number} tickSeconds @property {number} mask
 * @property {PlainEdge[]} edges
 */
/**
 * @typedef {Object} GateDef                  GATES (2)
 * @property {string} name @property {number} group @property {1|2} id @property {[Pt,Pt]} line  un-inflated
 * @property {Material} material @property {[string,string]} lamps  ['lite30','lite196'] / ['lite29','lite195'] @property {number} mask
 * @property {PlainEdge[]} edges
 */
/** @typedef {{name:string, group:number, c:Pt, r:number, material:Material, lamp:string, mask:number, edges:PlainEdge[]}} BlockerDef */
/** @typedef {{name:string, group:number, line:[Pt,Pt], delaySeconds:number, material:Material, mask:number, edges:PlainEdge[]}} DrainDef */
/**
 * @typedef {Object} KickoutDef               KICKOUTS (3): a_kout1 gravity well, a_kout2 hyperspace, a_kout3 black hole
 * @property {string} name @property {number} group @property {1|2|3} id
 * @property {'gravityWell'|'hyperspace'|'blackHole'} role
 * @property {Pt} c @property {number} fieldRadius @property {number} pull @property {number} captureFactor @property {number} captureRadius
 * @property {boolean} startsActive           a_kout1 false; a_kout2/3 true
 * @property {boolean} rearms                 true for a_kout2 and a_kout3 (re-arm 0.05 s after throw)
 * @property {[number,number,number]} throwDir @property {number} boost @property {number} throwMult @property {number} angleMult
 * @property {number} heldZ @property {number} defaultHold @property {Material} material @property {number} mask
 * @property {PlainEdge[]} edges              [capture circle]
 */
/**
 * @typedef {Object} SinkDef                  SINKS (4): v_sink1 red, v_sink2 green, v_sink3 yellow, v_sink7 escape chute
 * @property {string} name @property {number} group @property {1|2|3|7} id @property {[Pt,Pt]} line  un-inflated capture line
 * @property {Pt} reemit @property {[number,number]} throwDir @property {number} boost @property {number} throwMult
 * @property {number} holdSeconds @property {'red'|'green'|'yellow'|null} color @property {Material} material @property {number} mask
 * @property {PlainEdge[]} edges
 */
/** @typedef {{name:string, group:number, c:Pt, fieldRadius:number, pull:number, captureFactor:number, captureRadius:number, releaseZ:number, releaseMask:number, holdSeconds:number, material:Material, mask:number, edges:PlainEdge[]}} HoleDef */
/**
 * @typedef {Object} OnewayDef                ONEWAYS (9)
 * @property {string} name @property {number} group @property {Pt} p0 @property {Pt} p1  DAT order
 * @property {Pt} normal                      unit pass-through direction n = (dy,-dx)/len
 * @property {number} mask @property {Material} material
 * @property {boolean} visible                draw a wire (s_onewy1, s_onewy9, s_onewy10)
 * @property {boolean} scripted               true for s_onewy1, s_onewy4, s_onewy10
 * @property {boolean} sideSound              true for s_onewy9, s_onewy10 (SOUND111 on side hit)
 * @property {PlainEdge[]} edges              [wall line (role 'wall'), trigger line (role 'passthrough')]
 */
/** @typedef {{name:string, group:number, p0:Pt, p1:Pt, normal:Pt, lamp:string, mask:number, edges:PlainEdge[]}} TripwireDef  TRIPWIRES (5) */
/**
 * @typedef {Object} RolloverDef              ROLLOVERS (18 = 17 plain + a_roll9 with light:true)
 * @property {string} name @property {number} group @property {Pt[]} entry  attr-600 polygon (listed order, no closing dup)
 * @property {Pt[]} exit                      attr-603 = entry reversed
 * @property {Pt} center @property {number} mask @property {string|null} lamp @property {boolean} light  true only for a_roll9
 * @property {number} spriteSeconds           0.15 for a_roll9 else 0
 * @property {PlainEdge[]} edges              entry edges (gate 'active') + exit edges (gate 'rolloverflag')
 */
/** @typedef {{name:string, group:number, p0:Pt, p1:Pt, lamp:string, maxSpeed:number, minSpeed:number, decay:number, mask:number, edges:PlainEdge[]}} FlagDef  FLAGS (2) */
/** @typedef {{id:1400|1401|1402|1403|1404, shape:'line'|'triangle', pts:Pt[], action:'leftDelayed'|'leftNow'|'rightDelayed'|'rightNow'|'plunger'}} DemoTriggerDef */
/** @typedef {{v:[Pt,Pt,Pt], offset:[number,number,number], g1:number, g2:number, force:[number,number]}} RampPlane  surface z = a*x+b*y+c ; force = 25*sin(g1)*(cos g2, sin g2) */
/** @typedef {{p0:Pt, p1:Pt, ballMask:number, newMask:number}} RampSeam   a ball with mask ballMask crossing p0->p1 gets mask newMask (pass-through) */
/**
 * @typedef {Object} RampDef                  RAMPS.ramp (launch ramp, 18 planes) and RAMPS.tube (s_ramp9, 2 planes). Seam values are the
 *                                            SNAPPED ones of SPEC 3.5.1/3.5.3 (not the raw DAT attrs).
 * @property {string} name @property {number} group @property {number} mask  surface mask (2)
 * @property {RampPlane[]} planes @property {0|1} zOffsetFlag @property {number} fieldMult  0.2 (extra drag)
 * @property {RampSeam} enter                 ramp: lower mouth (mask1->2, takes plane 17); tube: mouth seam (mask1->2)
 * @property {RampSeam|null} enterUpper       ramp only: deck mouth (mask4->2, takes plane 1)
 * @property {RampSeam} exit                  enter reversed, mask 2 -> enter.ballMask (1)
 * @property {RampSeam|null} exitUpper        ramp only: enterUpper reversed, mask 2 -> 4
 * @property {RampSeam|null} exitFar          tube only: far-end seam (-3.751826,-10.333077)->(-3.045506,-10.781628), mask 2 -> 1, z 0.3
 * @property {RampSeam|null} line1            ramp only: trigger line, ballMask 4, newMask 4 (no state change, fires rampLine1)
 * @property {number} wallBallOffset          0.3 (tube exit z)
 */
/**
 * @typedef {Object} LampDef                  LAMPS (140; lite192 has pos:null)
 * @property {string} name                    'lite1' | 'literoll179'
 * @property {Pt|null} pos                    T-frame centre where the overlay is drawn AT HEIGHT z (already corrected for z>0)
 * @property {number} z                       overlay height (0.01 floor, 1.078 deck, ~0.5 wormhole rings)
 * @property {'A'|'B'|'C'|'D'} tier
 * @property {[number,number]} sprite         original sprite px (w,h)
 * @property {[number,number]} size           overlay quad size in world units (w,h)
 * @property {string|null} group @property {number|null} groupIndex
 * @property {'dot'|'arrow'|'bar'|'ring'|'triangle'|'decal'|'cross'|'rect'} shape
 * @property {number} rot                     radians, T-frame CCW orientation hint for arrows/bars (0 if none)
 * @property {{unlit:string, lit:string}[]} colors   one entry per ON image (length === nStates); CSS hex
 * @property {{off:number, on:number}} flash  flash phase durations in seconds (attr 900 / 901)
 * @property {1|3} nStates                    3 only for lite2, lite3, lite4 (arrow colour = onIdx: 0 yellow, 1 green, 2 red)
 * @property {string} role
 */
/** @typedef {{name:string, members:string[], step:number}} LampGroupDef   default animation step seconds (0.08 or 0.2) */
/** @typedef {{name:string, members:string[], step:number, durations:number[]}} BargraphDef  durations[level] seconds, level 0..11 */
/** @typedef {{bytes:number, sha1:string, timer:number}} SoundFileDef     timer = bytes/11000 (seconds) */
/** @typedef {{file:string|null, missing?:string}} SoundKeyDef            file = key in SOUND_FILES, null = missing in release (silent) */
/**
 * @typedef {Object} MissionDef               src/data/missions.js : MISSIONS[id]  (SPEC 5.7.3)
 * @property {number} id @property {string} key       camelCase id, e.g. 'targetPractice'
 * @property {string} name                    display name (MISSION_NAMES)
 * @property {number|null} counter            starting counter (8, 3, 3, 9, 15, ...) or null if not counter-based
 * @property {number} accept @property {number} reward @property {number} rankPts   SpecialAdd values / rank progress points
 * @property {string} doneText                key into MISSION_TEXT shown 4 s on completion
 * @property {number[]} states                mission state ids this mission occupies (e.g. [10, 20] for Alien Menace)
 */

// =====================================================================================================
// 3. PHYSICS (src/physics.js)
// =====================================================================================================
/**
 * @typedef {Object} Ball
 * @property {number} id @property {number} x @property {number} y @property {number} z
 * @property {number} dx @property {number} dy      UNIT direction
 * @property {number} speed                          u/s, <= 60
 * @property {number} mask                           collision mask the ball carries (1, 2 or 4)
 * @property {boolean} active                        false while captured by a sink / removed
 * @property {object|null} heldBy                    kickout / hole currently holding it
 * @property {boolean} cdisabled @property {object[]} remembered @property {boolean} onRamp @property {object|null} plane @property {number} dt
 */
/**
 * @typedef {Object} Edge                            one runtime collidable primitive (SPEC 4.2); exposed for tests
 * @property {'line'|'circle'} k @property {number} mask @property {string} owner  component name
 * @property {string} role @property {boolean} active
 * line   : x0,y0 (P0) dx,dy (unit direction) nx,ny (= dy,-dx) lo,hi (extent along x, or y when useX=false) useX
 * circle : cx,cy,r,rsq
 */

/**
 * Physics -> Rules events. Every event: { type, t (physics seconds), ...payload }. Constants in src/data/events.js (EV).
 * @typedef {(
 *  {type:'bumperHit', t:number, name:string, impact:number} |
 *  {type:'rebounderHit', t:number, name:string, impact:number} |
 *  {type:'popupHit', t:number, name:string} |
 *  {type:'popupUp', t:number, name:string} |
 *  {type:'soloHit', t:number, name:string, impact:number} |
 *  {type:'rolloverEnter', t:number, name:string} |
 *  {type:'tripwire', t:number, name:string} |
 *  {type:'oneway', t:number, name:string} |
 *  {type:'onewaySide', t:number, name:string, impact:number} |
 *  {type:'rampLine1', t:number} |
 *  {type:'rampEnter', t:number, ramp:string} |
 *  {type:'rampExit', t:number, ramp:string, mask:number} |
 *  {type:'rampHoleCaptured', t:number} |
 *  {type:'rampHoleReleased', t:number} |
 *  {type:'kickoutCapture', t:number, id:1|2|3} |
 *  {type:'kickoutEject', t:number, id:1|2|3} |
 *  {type:'sinkCapture', t:number, id:1|2|3|7} |
 *  {type:'sinkEject', t:number, id:1|2|3|7, from:1|2|3|7} |
 *  {type:'flagFrame', t:number, name:string, frame:number, dir:1|-1} |
 *  {type:'flagLoop', t:number, name:string} |
 *  {type:'kickbackFired', t:number, id:1|2} |
 *  {type:'kickbackTimerExpired', t:number, id:1|2} |
 *  {type:'blockerHit', t:number, impact:number} |
 *  {type:'drain', t:number, ballId:number, remaining:number, via:'drain'|'sinkTilt'|'forced'} |
 *  {type:'plungerFed', t:number, ballId:number} |
 *  {type:'plungerPull', t:number} |
 *  {type:'plungerRelease', t:number, boost:number, hitBall:boolean} |
 *  {type:'stuckRelaunch', t:number} |
 *  {type:'flipper', t:number, side:Side, action:'extend'|'retract', byKey:boolean} |
 *  {type:'flipperHit', t:number, side:Side, ballId:number, speed:number} |         ADDITIVE: an extending flipper struck a ball (cinematic camera)
 *  {type:'nudge', t:number, dir:'left'|'right'|'bottom'} |
 *  {type:'nudgeCount', t:number, level:'warn'|'tilt', count:number} |
 *  {type:'demoTrigger', t:number, id:1400|1401|1402|1403|1404}
 * )} PhysicsEvent
 */
/** @typedef {{id:number, x:number, y:number, z:number, mask:number, visible:boolean, held:boolean, speed:number}} BallSnap */
/**
 * Stable object updated IN PLACE by physics.snapshot() (never reallocated; do not keep references across frames).
 * Every record below has EXACTLY the keys of the matching COMPONENT_NAMES list (src/data/names.js), present from creation.
 * @typedef {Object} PhysicsSnapshot
 * @property {number} time                           physics clock (s)
 * @property {boolean} tiltLocked @property {number} nudgeCount
 * @property {{x:number,y:number}} shake             original-image shift in px at 365-px width (+x = screen right, +y = down)
 * @property {BallSnap[]} balls                      only balls that exist and are not sink-captured
 * @property {{a_flip1:{angle:number, up:boolean}, a_flip2:{angle:number, up:boolean}}} flippers   angle = current T-frame angle (rad)
 * @property {{pull:number, boost:number, charging:boolean, fired:boolean}} plunger              pull = 0..1 visual pull-back
 * @property {Record<string,{up:boolean}>} popups                 a_targ1..a_targ9
 * @property {Record<string,{flash:number}>} solos                a_targ10..a_targ22, flash 1 -> 0 over 0.1 s after a hard hit
 * @property {Record<string,{hit:boolean}>} bumpers               a_bump1..a_bump7 (true during the 0.1 s hit frame)
 * @property {Record<string,{flash:boolean}>} rebounders          v_rebo1..v_rebo4 (0.1 s)
 * @property {Record<string,{kicked:boolean, armed:boolean}>} kickbacks   a_kick1, a_kick2
 * @property {Record<string,{enabled:boolean}>} gates             v_gate1, v_gate2 (enabled = solid + visible)
 * @property {{up:boolean}} blocker                               v_bloc1
 * @property {Record<string,{frame:number, angle:number, spinning:boolean}>} flags   a_flag1, a_flag2 (frame 0..7, angle = frame*PI/4)
 * @property {Record<string,{active:boolean, held:boolean}>} kickouts   a_kout1..a_kout3
 * @property {Record<string,{occupied:boolean}>} sinks            v_sink1, v_sink2, v_sink3, v_sink7
 * @property {{occupied:boolean, drop:number}} rampHole           drop 0..1 visual fall progress
 * @property {Record<string,{lit:boolean}>} rolloverSprites       only a_roll9 (lit 0.15 s after exit)
 */
/**
 * @typedef {Object} CreatePhysicsOpts
 * @property {Rand01} [rand]                          default Math.random
 * @property {DataModule} [data]                      default: the real data barrel (tests may pass a spread-and-override copy)
 */
/**
 * @typedef {Object} Physics                         what createPhysics() returns (src/physics.js)
 * @property {(dt?:number)=>void} step               one fixed update (default PHYS.dt = 1/120, never > 0.1); advances every physics timer
 * @property {()=>PhysicsEvent[]} drainEvents        returns the queued events in order and clears the queue (fresh array)
 * @property {()=>PhysicsSnapshot} snapshot
 * @property {Ball[]} balls                          live list (read-only for everyone but physics)
 * @property {()=>number} ballsInPlay                balls that exist or are sink-captured (not yet drained); a pending feed does not count
 * @property {()=>boolean} ballAtPlunger             a ball rests in the plunger lane at the plunger face
 * @property {()=>number} getNudgeCount
 * @property {()=>boolean} isTiltLocked
 * @property {()=>void} [cancelPlunger]                                ADDITIVE (final): window focus lost - drop a manual plunger pull without firing it
 * @property {(side:Side, down:boolean)=>boolean} setFlipperButton      low-level, no game gating; false if disabled/tilted. Emits 'flipper' on a real state change
 * @property {(down:boolean)=>void} setPlungerButton                    down = start charging (emits 'plungerPull'), up = release
 * @property {(dir:'left'|'right'|'bottom', down?:boolean)=>boolean} nudge   down=true (default) applies, down=false undoes now; false if tilted
 * @property {(opts?:{delay?:number})=>void} startFeed                  default delay 0.96 s, then creates the ball + 'plungerFed'
 * @property {()=>void} relaunch                                        ball-save feed + auto self-charging plunger (tick 0.025/4)
 * @property {()=>boolean} launchInstant                                menu "Launch Ball": Boost=100 and release; false if no ball at the plunger
 * @property {(id:1|2, enabled:boolean)=>void} gateSetEnabled
 * @property {(enabled:boolean)=>void} blockerSetEnabled
 * @property {(names:string|string[], immediate?:boolean)=>void} popupReenable   'all' allowed; physical re-raise 0.25 s later unless immediate; emits 'popupUp'
 * @property {(id:1|2|3, active:boolean)=>void} kickoutSetActive
 * @property {(id:1|2|3, seconds:number)=>void} kickoutSetHold         call inside the 'kickoutCapture' handler (restarts the hold from now)
 * @property {(id:1|2|3|7, exitId:1|2|3|7, holdSeconds?:number)=>void} sinkSetRoute   call inside the 'sinkCapture' handler
 * @property {(on:boolean)=>void} setTiltLock                          true: plain bounces, kickouts+blocker off, sinks drain, plunger autofires, kickbacks kick at once, flippers retract+ignored
 * @property {(enabled:boolean)=>void} setFlippersEnabled              false = forced retract (flipper event byKey:false) + ignore input
 * @property {(on:boolean)=>void} setDemoTriggers                      enable the demo (attract AI) trigger edges; they emit 'demoTrigger'
 * @property {()=>void} forceDrainAll                                  every ball -> 'drain' events (via 'forced'; tilt timeout)
 * @property {()=>void} removeAllBalls                                 silently, no events, cancels pending feed/relaunch/sink ejects
 * @property {()=>void} resetTable                                     all components to start state, no balls, event queue cleared
 * @property {(x:number, y:number, opts?:{mask?:number, vx?:number, vy?:number})=>Ball|null} spawnBall   debug 'B' key / tests (counts as in play)
 * @property {(x:number, y:number)=>boolean} debugGrab @property {(x:number, y:number)=>void} debugDrag @property {()=>void} debugRelease
 */

// =====================================================================================================
// 4. LAMPS (src/lamps.js)
// =====================================================================================================
/** @typedef {{version:number, lit:Record<string,boolean>, onIdx:Record<string,number>}} LampsView  filled in place by fillView; lit = VISUAL state; version bumps whenever any lit/onIdx changed */
/** @typedef {'turnOn'|'turnOff'|'on'|'off'|'flash'|'flasherStart'|'flashThenOn'|'flashThenOff'|'timedOn'|'timedOff'|'resetTimed'|'toggleValue'|'resetAndToggleValue'} LampVerbName */
/**
 * @typedef {Object} LampGroup
 * @property {string} name @property {string[]} members
 * @property {()=>number} count                                         members whose steady flag S is true
 * @property {(t?:number)=>boolean} nextOn                              first unlit member flashThenOn(t=2.0); false if all lit
 * @property {()=>boolean} dropTop                                      steady-off the highest-index lit member (no flash)
 * @property {()=>boolean} offsetForward                                steady-on the first unlit member, no flash
 * @property {()=>void} stepForward @property {()=>void} stepBackward   lane-change rotation (SPEC 5.13.3)
 * @property {(step?:number)=>void} animationForward @property {(step?:number)=>void} animationBackward   step<0/omitted = group default
 * @property {(step?:number)=>void} lightShow                           LightShowAnimation (default 0.2)
 * @property {(step?:number)=>void} gameOver                            GameOverAnimation (default 1.4)
 * @property {()=>boolean} isAnimating @property {()=>boolean} lastFlashing
 * @property {()=>void} groupReset
 * @property {(t:number)=>void} restartNotifyTimer @property {(fn:(group:string)=>void)=>void} onNotifyExpired
 * @property {(t:number)=>void} flashWhenOn
 * @property {(verb:LampVerbName, ...args:number[])=>void} broadcast    applies the verb to every member, LAST member first
 */
/**
 * @typedef {Object} Bargraph                                           lamps.fuel
 * @property {string[]} members @property {number} level                0..11, read-only
 * @property {(L:number)=>void} setLevel                                ToggleSplitIndex (SPEC 5.5)
 * @property {()=>void} reset
 * @property {(h:{beforeSetLevel?:(L:number)=>void, tick?:(level:number)=>void, ended?:()=>void})=>void} setHooks
 */
/**
 * @typedef {Object} CreateLampsOpts
 * @property {Rand01} [rand]  @property {DataModule} [data]
 */
/**
 * @typedef {Object} Lamps                                              what createLamps() returns (src/lamps.js)
 * @property {(dt:number)=>void} advance                                seconds -> integer-ms timer wheel (fractional ms carried)
 * @property {(ms:number)=>void} advanceMs @property {()=>number} nowMs
 * @property {(name:string)=>boolean} isLit                             VISUAL lit (overlay-aware) - render uses this
 * @property {(name:string)=>boolean} lightOn                           light_on(): S||FORCE_ON||FLASH - all rule tests use this
 * @property {(name:string)=>boolean} steady                            S flag
 * @property {(name:string)=>'none'|'flash'|'on'|'off'} overlay
 * @property {(name:string)=>number} getField @property {(name:string, v:number)=>void} setField
 * @property {(name:string)=>number} getOnIdx @property {(name:string, i:number)=>void} setOnIdx
 * @property {(name:string)=>void} on @property {(name:string)=>void} off                       ResetAndTurnOn / ResetAndTurnOff  (SPEC lit / unlit)
 * @property {(name:string)=>void} turnOn @property {(name:string)=>void} turnOff               raw S set (overlay untouched)
 * @property {(name:string, t?:number)=>void} flash                                              FlasherStartTimed(t); t<=0/omitted = until reset
 * @property {(name:string)=>void} flasherStart                                                  indefinite, cancels the timeout
 * @property {(name:string, t:number)=>void} flashThenOn @property {(name:string, t:number)=>void} flashThenOff
 * @property {(name:string, t:number)=>void} timedOn @property {(name:string, t:number)=>void} timedOff
 * @property {(name:string)=>void} resetTimed
 * @property {(name:string, v:number)=>void} toggleValue @property {(name:string, v:number)=>void} resetAndToggleValue
 * @property {(name:string)=>LampGroup} group                                                     18 groups + 'all'
 * @property {Bargraph} fuel
 * @property {(name:string, fn:(lamp:string)=>void)=>void} onLampTimer                          ControlTimerExpired hook (lite17, lite59, lite60, lite200)
 * @property {()=>void} tiltOff                                                                  TurnOffTimed(0) on all 140 + lite77 flasherStart
 * @property {()=>void} clearTiltLock                                                            ResetTimed broadcast to all 140
 * @property {()=>void} resetAll                                                                 new game: Reset() on lamps, groups, bargraph
 * @property {(outgoing:number, incoming:number)=>void} playerChanged                            SPEC 5.13.5
 * @property {(view:LampsView)=>LampsView} fillView
 * @property {string[]} names
 */

// =====================================================================================================
// 5. RULES (src/rules.js)
// =====================================================================================================
/** @typedef {'flipperLeft'|'flipperRight'|'plunger'|'nudgeLeft'|'nudgeRight'|'nudgeBottom'} GameAction */
/** @typedef {'hidden test'|'gmax'|'1max'|'bmax'|'rmax'|'easy mode'} CheatWord */
/** @typedef {{play:(key:string)=>number}} SoundPort   play(SoundKey) returns the manifest duration in seconds, or -1 when silent-by-design. NEVER throws. */
/** @typedef {{name:string, score:number}} HighScoreEntry   empty slot = {name:'', score:-999} */
/** @typedef {{player:number, rank:number, score:number, defaultName:string}} NamePrompt   player 1..4, rank 1..5 */
/**
 * @typedef {Object} RulesView                         rules.getView() - stable object updated in place
 * @property {number} revision                         +1 whenever ANY displayed field changed (UI repaint flag)
 * @property {'idle'|'lightShow'|'playing'|'gameOver'} phase
 * @property {boolean} demo @property {boolean} paused @property {boolean} tilted @property {boolean} debug
 * @property {number} score                            CurScore 0..999999999 (plain decimal); -1 = blank
 * @property {number} player @property {number} playerCount     player 1..4
 * @property {number} ballNumber                       MaxBallCount-BallCount+1 (1..3); 0 = blank
 * @property {string} info @property {string} mission  current text-box messages ('' = empty; '\n' = line break)
 * @property {{attack:number, launch:number}} bumperLevels   0..3
 * @property {boolean} launchEnabled @property {boolean} highScoresEnabled @property {boolean} newGameEnabled
 * @property {NamePrompt|null} namePrompt
 * @property {number} missionState @property {number} extraBalls @property {number} fuelLevel   (debug / UI info)
 */
/**
 * @typedef {Object} CreateRulesOpts
 * @property {Physics} physics @property {Lamps} lamps
 * @property {SoundPort} [sound]                       default SILENT_SOUND (src/data/sounds.js)
 * @property {Rand01} [rand]                           default Math.random
 * @property {HighScoreTableApi} [highScores]          default: new HighScoreTable()
 * @property {DataModule} [data]
 */
/**
 * @typedef {Object} Rules                             what createRules() returns (src/rules.js)
 * @property {(opts?:{players?:number})=>void} newGame
 * @property {()=>void} stopGame                       Exit: table reset, phase 'idle', no text
 * @property {(n:number)=>void} setPlayers
 * @property {(on:boolean)=>void} setDemo
 * @property {()=>boolean} launchBall                  menu Launch Ball; false if not allowed
 * @property {(on:boolean)=>void} setPaused @property {()=>boolean} isPaused
 * @property {()=>void} focusLost @property {()=>void} focusGained
 * @property {(action:GameAction, down:boolean)=>void} input          the ONLY game-input entry; applies all gating
 * @property {(word:CheatWord)=>void} cheat
 * @property {(key:'H'|'R'|'B'|'S'|'I'|'J')=>void} debugKey @property {(on:boolean)=>void} setDebug
 * @property {(events:PhysicsEvent[])=>void} onPhysicsEvents
 * @property {(dt:number)=>void} tick
 * @property {()=>RulesView} getView
 * @property {(name:string|null)=>void} submitName     name prompt result (null = cancel)
 * @property {HighScoreTableApi} highScores
 */
/**
 * @typedef {Object} HighScoreTableApi                 src/rules/highscores.js : class HighScoreTable
 * @property {()=>HighScoreEntry[]} entries            always 5 entries
 * @property {(score:number)=>boolean} qualifies @property {(name:string, score:number)=>number} insert   returns rank 1..5 or 0
 * @property {(entries:HighScoreEntry[])=>void} load   replace contents (sanitised to exactly 5 entries); does NOT call onChange
 * @property {()=>void} clear @property {()=>HighScoreEntry[]} toJSON
 * @property {((entries:HighScoreEntry[])=>void)|null} onChange
 * @property {(score:number)=>number} [rankOf]         ADDITIVE (RULES): the rank 1..5 a score would get (0 = does not qualify)
 */

// =====================================================================================================
// 6. AUDIO (src/audio.js)
// =====================================================================================================
/** @typedef {{state:'idle'|'loading'|'ready'|'partial'|'unavailable', loaded:number, total:number, source:'local'|'S1'|'S5'|'user'|'mixed'|null, text:string}} AudioStatus */
/**
 * @typedef {Object} CreateAudioOpts
 * @property {typeof fetch} [fetch] @property {typeof AudioContext} [AudioContext]
 * @property {(buf:ArrayBuffer)=>Promise<string>} [sha1]  hex SHA-1 (default crypto.subtle)
 * @property {DataModule} [data]
 */
/**
 * @typedef {Object} Audio                             what createAudio() returns (src/audio.js); also satisfies SoundPort
 * @property {(key:string)=>number} play               returns SOUND_KEYS duration (data/sounds.js soundDuration) or -1; plays only if loaded && enabled; never throws
 * @property {(key:string)=>number} durationOf
 * @property {()=>Promise<void>} unlock                call synchronously from a user gesture
 * @property {()=>void} [unlockOnGesture]              ADDITIVE (INTEGRATOR): arm the one-shot "first click / key / touch" unlock (?demo with a remembered consent has no gesture yet)
 * @property {()=>Promise<AudioStatus>} load           local -> S1 -> S5 per file, validated by size + SHA-1; never rejects
 * @property {(files:FileList|File[])=>Promise<AudioStatus>} loadFromFiles   user's own Pinball folder / zip
 * @property {(on:boolean)=>void} setEnabled @property {()=>boolean} isEnabled
 * @property {(v:number)=>void} setVolume
 * @property {(on:boolean)=>void} setPaused @property {()=>void} stopAll
 * @property {(dt:number)=>void} update
 * @property {()=>AudioStatus} getStatus @property {(cb:(s:AudioStatus)=>void)=>(()=>void)|void} onStatus
 * @property {{available:()=>boolean, setEnabled:(on:boolean)=>Promise<void>, pause:()=>void, resume:()=>void, stop:()=>void, restart?:()=>void, retry?:()=>Promise<void>, tick?:()=>void}} music
 * ADDITIVE (AUDIO, all optional for callers): pickDirectory(): Promise<AudioStatus> and canPickDirectory(): boolean (showDirectoryPicker flow),
 *  attachDropTarget(el?, onDone?): ()=>void (drop a Pinball folder / zip on the page), setSfxVolume(v) / setMusicVolume(v), getLastImport():
 *  {matched, accepted, rejected, music}, getSourceMap(): Record<string,string>, dispose(). `onStatus(cb)` returns an unsubscribe function.
 * @property {(()=>Promise<AudioStatus>)} [pickDirectory] @property {(()=>boolean)} [canPickDirectory]
 * @property {((el?:EventTarget|null, onDone?:(s:AudioStatus)=>void)=>(()=>void))} [attachDropTarget]
 * @property {((v:number)=>void)} [setSfxVolume] @property {((v:number)=>void)} [setMusicVolume]
 * @property {(()=>{matched:number, accepted:number, rejected:number, music:boolean})} [getLastImport]
 * @property {(()=>Record<string,string>)} [getSourceMap] @property {(()=>void)} [dispose]
 */

// =====================================================================================================
// 7. RENDER + ART
// =====================================================================================================
/** @typedef {'original'|'top'|'orbit'} CameraMode */
/** @typedef {HTMLCanvasElement|OffscreenCanvas|object} CanvasLike   (tests pass tests/helpers/fake_canvas.mjs canvases) */
/**
 * @typedef {Object} CanvasPatch                       a canvas painted over a rectangle of the T-frame floor
 * @property {CanvasLike} canvas @property {number} width @property {number} height   pixels
 * @property {{xMin:number,xMax:number,yMin:number,yMax:number}} rect
 * Mapping (ART and RENDER both use src/render/art/mapping.js):  px = (rect.xMax - x)/(xMax-xMin) * width ; py = (y - yMin)/(yMax-yMin) * height
 * i.e. the canvas looks exactly like the table seen from above by the player. Three UV (flipY=true): u = px/width, v = 1 - py/height.
 */
/**
 * @typedef {{canvas:CanvasLike, width:number, height:number, cells:Record<string,{u0:number,v0:number,u1:number,v1:number,w:number,h:number}>, cell?:number, cols?:number, rows?:number, keys?:string[]}} LampAtlas
 * keys 'lite5', and 'lite2#0','lite2#1','lite2#2' for 3-image lamps; cells are the LIT sprite, alpha-keyed (uniform square cells, 128 px / 64 px at 'low').
 * ADDITIVE (ART): `cell` (cell size px), `cols`, `rows`, `keys` (row-major key order). Cell mapping: local T +x = cell left edge, local +y = cell bottom edge (art/mapping.js lampCellUV).
 */
/** @typedef {{name:string, start:number, count:number}} MeshGroup   ADDITIVE (RENDER): a named index range of a MeshData */
/** @typedef {{positions:Float32Array, normals:Float32Array, uvs:Float32Array, indices:Uint32Array, groups?:MeshGroup[]}} MeshData   T-frame pure geometry (src/render/geom/**); `groups` is ADDITIVE (RENDER) */
/**
 * @typedef {Object} ArtPack                           what paintAll() returns (src/render/art/index.js)
 * @property {CanvasPatch} floor                       whole playfield albedo (rect x[-8,8] y[-14,15]) incl. dim unlit lamp insets (lamps with z < 1)
 * @property {CanvasPatch} deck                        ramp + deck albedo (rect = bbox of shell 103) incl. unlit insets of deck lamps (z >= 1)
 * @property {LampAtlas} lampAtlas
 * @property {Record<string, CanvasLike>} misc         named small textures - exact key list in ARCHITECTURE.md 9.3; RENDER must tolerate missing keys
 * @property {CanvasLike} panel                        203x394 static panel (bezel, 3 black boxes, ORIGINAL logo, 'BALL' label); UI draws dynamic dots on top
 * @property {Record<string, CanvasLike>} [cabinet]    ADDITIVE (ART): the arcade cabinet's panels (art/cabinet.js CABINET_KEYS); RENDER tolerates missing keys
 */
/**
 * @typedef {Object} PaintOpts                         paintAll(data, opts)
 * @property {(w:number, h:number)=>CanvasLike} createCanvas
 * @property {number} [seed]                           default 1995; all randomness derives from it (deterministic output)
 * @property {'high'|'normal'|'low'} [quality]         floor width 2048 / 1536 / 1024 px (default 'normal')
 */
/**
 * @typedef {Object} RenderFrame                       built each frame by game.buildRenderFrame()
 * @property {number} time @property {number} dt       seconds (game clock / frame dt)
 * @property {PhysicsSnapshot} physics @property {LampsView} lamps @property {RulesView} rules
 * @property {{weight:number, active:boolean, ballId:number|null, target:{x:number,y:number,z:number}, speed:number, lead:{x:number,y:number}}} [cinematic]
 *           ADDITIVE: the cinematic camera director's state (render/cinematic.js), set by main.js; absent = no cinematic blend
 */
/**
 * @typedef {Object} CreateRendererOpts
 * @property {DataModule} data @property {ArtPack} art
 * @property {HTMLCanvasElement} [canvas]              default: creates one
 * @property {{shadows?:boolean, bloom?:boolean, dprMax?:number}} [quality]
 */
/**
 * @typedef {Object} Renderer                          what createRenderer() returns (src/render/index.js)
 * @property {HTMLCanvasElement} domElement
 * @property {(cssW:number, cssH:number, dpr:number)=>void} resize
 * @property {(frame:RenderFrame)=>void} render
 * @property {(mode:CameraMode)=>void} setCameraMode @property {()=>CameraMode} getCameraMode @property {()=>CameraMode} cycleCameraMode
 * @property {(clientX:number, clientY:number)=>Pt|null} pickTable      T-frame floor point under a client pixel (debug drag)
 * @property {(q:{shadows?:boolean, bloom?:boolean, dprMax?:number})=>void} setQuality
 * @property {()=>{drawCalls:number, triangles:number, textures:number}} info
 * @property {()=>void} dispose
 * @property {object} [debug]                           ADDITIVE (RENDER): {scene, THREE, renderer, table, lamps, balls, cameras, cabinet, kit, lights} for browser smoke tests (absent on the fallback renderers)
 * @property {(on:boolean)=>void} [setMouseLook]        ADDITIVE (RENDER): the mouse turns / zooms the original camera (drag, wheel, double-click resets)
 * @property {()=>void} [resetView]                     ADDITIVE (RENDER): back to the original view (and the orbit camera to its start)
 * @property {()=>{yaw:number, pitch:number, zoom:number}} [getView] @property {(v:{yaw?:number, pitch?:number, zoom?:number})=>void} [setView]   ADDITIVE: the mouse view (tests / debugging)
 */

// =====================================================================================================
// 8. INPUT / UI / GAME
// =====================================================================================================
/** @typedef {Record<GameAction, string>} Bindings      GameAction -> KeyboardEvent.code */
/**
 * @typedef {(
 *  {kind:'game', action:GameAction, down:boolean} |
 *  {kind:'app', action:'newGame'|'launchBall'|'pause'|'fullscreen'|'sounds'|'music'|'controls'|'help'|'camera'|'cinematic'} |
 *  {kind:'cheat', word:CheatWord} |
 *  {kind:'debug', key:'H'|'R'|'B'|'S'|'I'|'J'|'Y'} |
 *  {kind:'pointer', phase:'down'|'move'|'up', clientX:number, clientY:number, button:number}
 * )} InputEvent
 */
/**
 * @typedef {Object} CreateInputOpts
 * @property {(e:InputEvent)=>void} onEvent
 * @property {()=>void} [onFocusLoss]                   ADDITIVE (final): window blur / hidden tab, called BEFORE the held keys are released
 * @property {Window|EventTarget} [target]             default window
 * @property {Bindings} [bindings]                     default DEFAULT_KEYS
 * @property {Document} [doc]
 */
/**
 * @typedef {Object} Input                             what createInput() returns (src/input.js)
 * @property {()=>void} attach @property {()=>void} detach
 * @property {()=>Bindings} getBindings @property {(b:Bindings)=>void} setBindings @property {()=>Bindings} defaultBindings
 * @property {(blocked:boolean)=>void} setBlocked      true while a dialog/text field has focus: swallow game + cheat keys
 * @property {()=>void} releaseAll                     emit 'up' for every held game key (blur, pause, tilt)
 * @property {(on:boolean)=>void} setDebug             enables debug keys + pointer events
 * @property {(on:boolean)=>void} setPointerFlippers   mouse/touch flippers on #table-view (default true; false in 'orbit' camera)
 * @property {(on:boolean)=>void} [setMouseButtons]    ADDITIVE: mouse buttons work the flippers / plunger (default true; false = Mouse Rotates View; touch unaffected)
 * @property {()=>boolean} [isBlocked] @property {()=>boolean} [isDebug] @property {(action:GameAction)=>boolean} [isDown]   ADDITIVE (INTEGRATOR): read-only state for tests
 */
/** @typedef {{sounds:boolean, music:boolean, fullscreen:boolean, players:1|2|3|4, camera:CameraMode, volume:number, soundConsent:'unset'|'granted'|'denied', cinematic:boolean, mouseLook:boolean}} Options   cinematic, mouseLook: ADDITIVE */
/**
 * @typedef {Object} Store                             src/ui/storage.js (every access try/catch; works with storage === null)
 * @property {()=>Options} getOptions @property {(patch:Partial<Options>)=>Options} setOptions
 * @property {()=>Bindings|null} getBindings @property {(b:Bindings)=>void} setBindings
 * @property {()=>HighScoreEntry[]|null} getHighScores @property {(e:HighScoreEntry[])=>void} setHighScores
 */
/**
 * @typedef {Object} UIActions                         UI -> application callbacks (implemented in src/main.js)
 * @property {(o:{withSound:boolean, players:number, music:boolean})=>void} start   start-overlay click (a user gesture)
 * @property {()=>void} newGame @property {()=>void} launchBall @property {()=>void} togglePause @property {()=>void} toggleDemo
 * @property {()=>void} showHighScores @property {()=>void} exit
 * @property {(n:number)=>void} selectPlayers @property {(on:boolean)=>void} setSounds @property {(on:boolean)=>void} setMusic
 * @property {(v:number)=>void} setVolume
 * @property {()=>void} toggleFullscreen @property {(m:CameraMode)=>void} setCamera
 * @property {(on:boolean)=>void} [setCinematic] @property {(on:boolean)=>void} [setMouseLook] @property {()=>void} [resetView]   ADDITIVE: cinematic camera, mouse view
 * @property {(name:string|null)=>void} submitName @property {()=>void} clearHighScores
 * @property {(b:Bindings)=>void} setBindings @property {()=>void} resetBindings
 * @property {(files:FileList|File[])=>void} loadLocalSounds
 */
/**
 * @typedef {Object} CreateUIOpts
 * @property {HTMLElement} root                        document.body or #app (UI queries the mount points of ARCHITECTURE.md 8.1 inside it)
 * @property {Store} store @property {UIActions} actions @property {CanvasLike} panelArt  ArtPack.panel
 * @property {Options} options @property {Bindings} bindings
 * @property {(open:boolean)=>void} [onDialogChange]
 * @property {(open:boolean)=>void} [onMenuChange]     ADDITIVE (UI): called when a menu opens / closes (main.js blocks the game keys and auto-pauses while one is open)
 * @property {Document} [doc] @property {DataModule} [data]
 */
/**
 * @typedef {Object} UI                                what createUI() returns (src/ui/index.js)
 * @property {(view:RulesView, dt:number)=>void} update            every frame; repaints the panel only when view.revision changed; also refreshes view-derived menu state
 * @property {(o:Options)=>void} setOptions                        refresh option-derived menu checks (sounds, music, fullscreen, players, camera)
 * @property {(o:{soundStatus:AudioStatus})=>void} showStartOverlay @property {()=>void} hideStartOverlay
 * @property {(s:AudioStatus)=>void} setSoundStatus
 * @property {(entries:HighScoreEntry[], o?:{clearable?:boolean})=>void} showHighScores
 * @property {(p:NamePrompt)=>void} promptName @property {(b:Bindings)=>void} showControls
 * @property {()=>void} showAbout @property {()=>void} showHelp
 * @property {(text:string, ms?:number)=>void} toast @property {(fps:number|null)=>void} setFps
 * @property {()=>boolean} isDialogOpen @property {()=>void} closeAllDialogs @property {()=>void} dispose
 * @property {()=>void} [showSound] @property {()=>Bindings} [getBindings] @property {Record<string,HTMLElement>} [elements]   ADDITIVE (UI): Sound dialog, current key bindings, DOM handles
 */
/**
 * @typedef {Object} CreateGameOpts
 * @property {SoundPort} [sound] @property {Rand01} [rand] @property {DataModule} [data] @property {HighScoreTableApi} [highScores]
 * @property {{createPhysics?:Function, createLamps?:Function, createRules?:Function}} [factories]   test seam: replace a factory (e.g. spies proving the step order)
 * @property {(events:PhysicsEvent[])=>void} [onPhysicsEvents]   ADDITIVE: observer of every drained event batch (after the rules); main.js feeds the cinematic camera
 */
/**
 * @typedef {Object} Game                              what createGame() returns (src/game.js) - headless, Node-safe
 * @property {Physics} physics @property {Lamps} lamps @property {Rules} rules
 * @property {()=>void} step                           one fixed 1/120 s step in the contract order
 * @property {(frameDt:number)=>number} advance        clamps to 0.1 s, accumulates, runs whole steps (none while paused), returns steps run
 * @property {(on:boolean)=>void} setPaused @property {()=>boolean} isPaused
 * @property {()=>number} simTime
 * @property {(dt:number, out?:RenderFrame)=>RenderFrame} buildRenderFrame
 */
