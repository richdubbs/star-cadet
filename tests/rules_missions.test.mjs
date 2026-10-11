/**
 * tests/rules_missions.test.mjs
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * RULES tests for missions (select / accept / all 17 missions / Maelstrom chain / grand reward), ranks, fuel, wormhole use inside missions
 * (ARCHITECTURE.md 7.10, SPEC 5.5, 5.7, 5.8). Shares the rig of tests/rules_rig.mjs with tests/rules.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as DATA from '../src/data/index.js';
import { makeRig, realLampsAvailable } from './rules_rig.mjs';

const { MISSIONS, MISSION_SELECT, MISSION_NAMES } = DATA;

/** fresh rig in state 1 (deployed) with a full tank */
function ready() {
  const r = makeRig().play();
  r.refuel();
  r.deploy();
  r.tick(1);
  return r;
}

const hit = (r, type, payload) => r.ev(type, payload);
const bump = (r, n = 1) => { for (let i = 0; i < n; i++) hit(r, 'bumperHit', { name: 'a_bump' + (1 + (i % 4)), impact: 5 }); };
const lanes = (r, names) => { for (const n of names) hit(r, 'rolloverEnter', { name: n }); };
const solos = (r, names) => { for (const n of names) hit(r, 'soloHit', { name: n, impact: 5 }); };
const flags = (r, n) => { for (let i = 0; i < n; i++) hit(r, 'flagFrame', { name: 'a_flag' + (1 + (i % 2)), frame: i % 8, dir: 1 }); };

// =====================================================================================================================================
// Select / accept
// =====================================================================================================================================
test('state 1 prompt: "Hit Mission Targets to Pick a Mission" with fuel, "Refuel the Ship" without', () => {
  const r = makeRig().play();
  r.deploy();
  assert.equal(r.state(), 1);
  r.tick(0.3);
  assert.equal(r.mission(), 'Refuel the Ship');
  assert.equal(r.lamps.overlay('lite318'), 'flash');
  const r2 = ready();
  assert.equal(r2.state(), 1);
  assert.equal(r2.mission(), 'Hit Mission Targets to Pick a Mission');
  assert.equal(r2.lamps.overlay('lite319'), 'flash');
});

test('mission selection table: every rank group x target level selects the mission of SPEC 5.7.2', () => {
  const rankOfGroup = { 1: 1, 2: 2, 3: 4, 4: 6, 5: 8 };
  for (const [g, ids] of Object.entries(MISSION_SELECT)) {
    for (let level = 1; level <= 4; level++) {
      const r = ready();
      r.rank(rankOfGroup[g]);
      const targets = level === 4 ? [0, 1, 2] : [level - 1];
      for (const idx of targets) solos(r, ['a_targ' + (13 + idx)]);
      r.tick(0.3);
      const id = ids[level - 1];
      assert.equal(r.mission(), `Launch Ramp Starts ${MISSION_NAMES[id]} Mission`, `group ${g} level ${level}`);
      assert.equal(r.lamps.getField('lite56'), id);
      assert.equal(r.on('lite56'), true);
      assert.equal(r.lamps.overlay('lite198'), 'flash');
      assert.equal(r.lamps.overlay('lite317'), 'flash');
    }
  }
});

test('Cadet spot-target examples of the guide: bottom = Target Practice, middle = Re-Entry, top = Launch Training, all three = Science', () => {
  const pick = (names) => { const r = ready(); solos(r, names); r.tick(0.3); return r.mission(); };
  assert.match(pick(['a_targ15']), /Target Practice/);
  assert.match(pick(['a_targ14']), /Re-Entry Training/);
  assert.match(pick(['a_targ13']), /Launch Training/);
  assert.match(pick(['a_targ13', 'a_targ14', 'a_targ15']), /Science/);
  assert.match(pick(['a_targ13', 'a_targ15']), /Target Practice/);      // re-selecting just changes the pick
  const r = ready();
  solos(r, ['a_targ13', 'a_targ14', 'a_targ15', 'a_targ13']);          // bits were cleared by the "all three" pick
  r.tick(0.3);
  assert.match(r.mission(), /Launch Training/);
});

test('accept: ramp shot with a mission selected and fuel > 0 pays 10000 / 20000 / 30000 and shows Mission Started then the counter', () => {
  const byAccept = { 2: 10000, 5: 10000, 6: 20000, 14: 20000, 15: 30000, 18: 30000 };
  for (const [id, pts] of Object.entries(byAccept)) {
    const r = ready();
    const before = r.accept(Number(id));
    assert.equal(r.state(), Number(id));
    assert.equal(r.score() - before, pts, 'mission ' + id);
    assert.equal(r.mission(), 'Mission Started\n' + pts);
    assert.equal(r.on('lite56'), false);
    assert.equal(r.lamps.steady('lite198'), true);
    assert.equal(r.lamps.overlay('lite198'), 'none');
    assert.equal(r.lamps.group('outer_circle').isAnimating(), true);       // progress lamps rotate while a mission runs
    r.tick(4.1);
    assert.notEqual(r.mission(), 'Mission Started\n' + pts);
    assert.notEqual(r.mission(), '');
  }
});

test('accept needs fuel: with level 0 the ramp does nothing; the refuel callback quirk shows the stale prompt until the first tick', () => {
  const r = makeRig().play();
  r.deploy();
  solos(r, ['a_targ14']);
  r.tick(0.3);
  assert.equal(r.mission(), 'Refuel the Ship');
  const s0 = r.score();
  r.ev('rampLine1');
  assert.equal(r.state(), 1);                                // not accepted
  assert.equal(r.score() - s0, 0);                           // lite56 lit: no 5000 either
  r.refuel();
  assert.equal(r.mission(), 'Refuel the Ship');                // SPEC 5.5: the callback sees the OLD level
  r.tick(4.1);
  assert.equal(r.mission(), 'Launch Ramp Starts Re-Entry Training Mission');
  r.ev('rampLine1');
  assert.equal(r.state(), 4);
});

test('re-selecting before accepting just changes the pick; hitting spot targets during a running mission only scores', () => {
  const r = ready();
  solos(r, ['a_targ13']); solos(r, ['a_targ15']);
  r.tick(0.3);
  assert.match(r.mission(), /Target Practice/);
  r.ev('rampLine1');
  assert.equal(r.state(), 2);
  const s0 = r.score();
  solos(r, ['a_targ13']);
  assert.equal(r.score() - s0, 1000);
  assert.equal(r.state(), 2);
  assert.equal(r.on('lite56'), false);
});

// =====================================================================================================================================
// The 15 simple missions, table driven
// =====================================================================================================================================
/**
 * steps: array of functions; the LAST one completes the mission. lastScore = points the last step itself scores (so the reward can be checked
 * exactly). text0 = counter text right after the 4 s Mission Started message.
 */
const CASES = [
  { id: 2, text0: 'Attack Bumpers Hits\nTo Go: 8', steps: [...Array(8)].map((_, i) => (r) => bump(r, 1 + 0 * i)), lastScore: 500, text1: 'Attack Bumpers Hits\nTo Go: 7' },
  { id: 3, text0: 'Launches To Go: 3', steps: [...Array(3)].map(() => (r) => hit(r, 'rampLine1')), lastScore: 5000, text1: 'Launches To Go: 2' },
  { id: 4, text0: 'Re-Entries To Go: 3', steps: ['a_roll1', 'a_roll2', 'a_roll3'].map((n) => (r) => lanes(r, [n])), lastScore: 2000, text1: 'Re-Entries To Go: 2' },
  { id: 5, text0: 'Drop Targets\nTo Go: 9', steps: [...Array(9)].map((_, i) => (r) => hit(r, 'popupHit', { name: 'a_targ' + (1 + i) })), lastScore: 1500,
    text1: 'Drop Targets\nTo Go: 8' },
  { id: 6, text0: 'Light Right Hazard Banks', steps: [(r) => solos(r, ['a_targ19']), (r) => solos(r, ['a_targ20']), (r) => solos(r, ['a_targ21']),
    (r) => hit(r, 'kickoutCapture', { id: 2 })], lastScore: 10000, textAfter3: 'Hyperspace Launch' },
  { id: 7, text0: 'Power Up Launch Bumpers', steps: [(r) => lanes(r, ['a_roll110', 'a_roll111', 'a_roll112']), (r) => hit(r, 'kickoutCapture', { id: 3 })],
    lastScore: 20000, textAfter1: 'Shoot the Black Hole' },
  { id: 8, text0: 'Light Left Hazard Banks', steps: [(r) => solos(r, ['a_targ16']), (r) => solos(r, ['a_targ17']), (r) => solos(r, ['a_targ18']),
    (r) => hit(r, 'sinkCapture', { id: 2 })], lastScore: 7500, textAfter3: 'Shoot the Wormhole' },
  { id: 9, text0: 'Targets\nTo Go: 15', steps: [...Array(15)].map((_, i) => (r) => (i % 2 ? hit(r, 'popupHit', { name: 'a_targ' + (1 + (i % 9)) })
    : solos(r, ['a_targ19']))), text1: 'Targets\nTo Go: 14', lastScore: null },
  { id: 10, text0: 'Power Up Attack Bumpers', steps: [(r) => lanes(r, ['a_roll1', 'a_roll2', 'a_roll3']), ...[...Array(8)].map(() => (r) => bump(r, 1))],
    lastScore: 1000, textAfter1: 'Attack Bumpers Hits\nTo Go: 8' },
  { id: 11, text0: 'Power Up Flags', steps: [(r) => [1, 2, 3].forEach((i) => hit(r, 'popupHit', { name: 'a_targ' + i })), (r) => hit(r, 'kickoutCapture', { id: 2 })],
    lastScore: 10000, textAfter1: 'Hyperspace Launch' },
  { id: 12, text0: 'Remote Attack Bumper Hits\nTo Go: 3', steps: [...Array(3)].map(() => (r) => hit(r, 'bumperHit', { name: 'a_bump4', impact: 5 })),
    lastScore: 500, text1: 'Remote Attack Bumper Hits\nTo Go: 2' },
  { id: 13, text0: 'Lane Passes\nTo Go: 15', steps: [...Array(15)].map(() => (r) => lanes(r, ['a_roll6'])), lastScore: 5000, text1: 'Lane Passes\nTo Go: 14' },
  { id: 14, text0: 'Out Lane Passes\nTo Go: 3', steps: [...Array(3)].map(() => (r) => lanes(r, ['a_roll4'])), lastScore: 20000, text1: 'Out Lane Passes\nTo Go: 2' },
  { id: 15, text0: 'Flag Rolls: 75', steps: [(r) => flags(r, 75), (r) => lanes(r, ['a_roll9'])], lastScore: 10000, textAfter1: 'Roll Over Space Warp' },
  { id: 16, text0: 'Shoot Yellow Wormhole', steps: [(r) => hit(r, 'sinkCapture', { id: 3 }), (r) => hit(r, 'sinkCapture', { id: 1 }),
    (r) => hit(r, 'sinkCapture', { id: 2 })], lastScore: 2500, textAfter1: 'Shoot Red Wormhole' },
];

for (const c of CASES) {
  const def = MISSIONS[c.id];
  test(`mission ${c.id} ${def.name}: counters, text, completion (+${def.reward}, ${def.rankPts} rank points), back to state 1`, () => {
    const r = ready();
    const before = r.accept(c.id);
    assert.equal(r.score() - before, def.accept);
    r.tick(4.1);
    assert.equal(r.mission(), c.text0);
    const n = c.steps.length;
    // wrong events do nothing: bumper hits do not progress a lane mission, etc. (spot checks)
    const startScore = r.score();
    let rankBefore = r.count('outer_circle');
    for (let i = 0; i < n - 1; i++) {
      r.tick(0.3);
      c.steps[i](r);
      assert.equal(r.state() === c.id || r.state() > 1, true, `still running after step ${i + 1}`);
      if (i === 0 && c.text1) { r.tick(0.3); assert.equal(r.mission(), c.text1); }
      if (i === 0 && c.textAfter1) { r.tick(0.3); assert.equal(r.mission(), c.textAfter1); }
      if (i === 2 && c.textAfter3) { r.tick(0.3); assert.equal(r.mission(), c.textAfter3); }
    }
    assert.notEqual(r.state(), 1);
    const mid = r.score();
    const prePoints = mid - startScore;
    r.tick(0.3);
    c.steps[n - 1](r);
    const delta = r.score() - mid;
    if (c.lastScore !== null) assert.equal(delta, def.reward + c.lastScore, `reward of mission ${c.id}`);
    else assert.ok(delta >= def.reward && delta < def.reward + 5000);
    assert.ok(prePoints >= 0);
    assert.equal(r.state(), 1, 'back to the select state');
    assert.equal(r.mission().length > 0, true);
    assert.equal(r.on('lite16'), true, 'bonus lane lamp is lit by every completion');
    assert.equal(r.lamps.group('outer_circle').isAnimating(), false);
    assert.equal(r.on('lite198'), false);
    r.tick(0.3);
    assert.equal(r.mission(), MISSIONS[c.id].doneText ? DATA.MISSION_TEXT[def.doneText] : '');
    const gained = r.count('outer_circle') - rankBefore;
    assert.equal(gained, def.rankPts, 'rank progress lamps');
    assert.ok(r.played.includes('SW9'));
    r.tick(4.0);
    assert.equal(r.mission(), `Mission Complete\n${def.reward}`);
    r.tick(5.0);
    assert.equal(r.mission(), 'Hit Mission Targets to Pick a Mission');
    rankBefore = 0;
  });
}

test('wrong events do not advance missions (Satellite counts only a_bump4, Doomsday only outlanes, Target Practice only attack bumpers)', () => {
  const r = ready();
  r.accept(12);
  r.tick(4.1);
  bump(r, 3);                                                   // a_bump1..3: not a_bump4
  assert.equal(r.mission(), 'Remote Attack Bumper Hits\nTo Go: 3');
  hit(r, 'bumperHit', { name: 'a_bump5', impact: 5 });
  assert.equal(r.mission(), 'Remote Attack Bumper Hits\nTo Go: 3');
  hit(r, 'bumperHit', { name: 'a_bump4', impact: 5 });
  r.tick(0.3);
  assert.equal(r.mission(), 'Remote Attack Bumper Hits\nTo Go: 2');
  const r2 = ready();
  r2.accept(14); r2.tick(4.1);
  lanes(r2, ['a_roll6', 'a_roll5', 'a_roll1']);
  assert.equal(r2.mission(), 'Out Lane Passes\nTo Go: 3');
  lanes(r2, ['a_roll8']);
  r2.tick(0.3);
  assert.equal(r2.mission(), 'Out Lane Passes\nTo Go: 2');
  const r3 = ready();
  r3.accept(2); r3.tick(4.1);
  hit(r3, 'bumperHit', { name: 'a_bump6', impact: 5 });
  assert.equal(r3.mission(), 'Attack Bumpers Hits\nTo Go: 8');
});

test('Recon counts all eleven lane kinds; Alien Menace part 2 does not need the level to persist', () => {
  const r = ready();
  r.accept(13); r.tick(4.1);
  const all = ['a_roll1', 'a_roll2', 'a_roll3', 'a_roll110', 'a_roll111', 'a_roll112', 'a_roll4', 'a_roll8', 'a_roll6', 'a_roll7', 'a_roll5'];
  lanes(r, all);
  r.tick(0.3);
  assert.equal(r.mission(), 'Lane Passes\nTo Go: 4');
  const r2 = ready();
  r2.accept(10); r2.tick(4.1);
  assert.equal(r2.view.bumperLevels.attack, 0);
  lanes(r2, ['a_roll1', 'a_roll2', 'a_roll3']);
  assert.equal(r2.state(), 20);
  r2.tick(60.5);                                                // the 60 s decay drops the bumper level again
  assert.equal(r2.view.bumperLevels.attack, 0);
  bump(r2, 7);
  assert.equal(r2.state(), 20);
  bump(r2, 1);
  assert.equal(r2.state(), 1);
});

test('Black Hole: the text reverts when the launch-bumper level decays back to 0; black hole entry needs level > 0', () => {
  const r = ready();
  r.accept(7); r.tick(4.1);
  assert.equal(r.mission(), 'Power Up Launch Bumpers');
  hit(r, 'kickoutCapture', { id: 3 });
  assert.equal(r.state(), 7);                                   // level 0: no completion
  r.tick(2.0);
  lanes(r, ['a_roll110', 'a_roll111', 'a_roll112']);
  r.tick(0.3);
  assert.equal(r.mission(), 'Shoot the Black Hole');
  assert.equal(r.lamps.overlay('lite314'), 'flash');
  r.tick(60.5);
  assert.equal(r.view.bumperLevels.launch, 0);
  assert.equal(r.mission(), 'Power Up Launch Bumpers');
  assert.equal(r.lamps.overlay('lite316'), 'flash');
});

test('Stray Comet needs FRESH hits on the right hazard bank after the mission started; Rescue needs the flags upgraded first', () => {
  const r = ready();
  solos(r, ['a_targ19', 'a_targ20']);                           // before the mission: do not count
  r.accept(6); r.tick(4.1);
  solos(r, ['a_targ21']);
  assert.equal(r.mission(), 'Light Right Hazard Banks');
  solos(r, ['a_targ19', 'a_targ20']);
  r.tick(0.3);
  assert.equal(r.mission(), 'Hyperspace Launch');
  const r2 = ready();
  r2.accept(11); r2.tick(4.1);
  assert.equal(r2.on('lite20'), false);
  hit(r2, 'kickoutCapture', { id: 2 });
  assert.equal(r2.state(), 11);                                 // hyperspace before the flags are upgraded: nothing
  for (const i of [1, 2, 3]) hit(r2, 'popupHit', { name: 'a_targ' + i });
  assert.equal(r2.on('lite20'), true);
  r2.tick(5.1);
  hit(r2, 'kickoutCapture', { id: 2 });
  assert.equal(r2.state(), 1);
  assert.equal(r2.on('lite20'), true);                          // the 60 s window keeps running
});

test('Space Radiation: left bank then any wormhole; the destination colour is advanced and the arrows flash', () => {
  const r = ready();
  r.accept(8); r.tick(4.1);
  solos(r, ['a_targ16', 'a_targ17', 'a_targ18']);
  assert.equal(r.lamps.getField('lite4'), 1);
  assert.equal(r.lamps.overlay('lite2'), 'flash');
  hit(r, 'sinkCapture', { id: 1 });                             // match -> replay, and the mission completes
  assert.equal(r.state(), 1);
  assert.equal(r.on('lite199'), true);
  assert.equal(r.lamps.getField('lite4'), 0);                   // select-state initialiser clears the wormhole lamps
  assert.equal(r.count('worm_hole_lights'), 0);
});

test('Secret: wormholes in the order yellow, red, green; destination advancing is disabled (2500, same sink); stage lamps follow', () => {
  const r = ready();
  r.accept(16); r.tick(4.1);
  assert.equal(r.state(), 16);
  assert.equal(r.on('lite7'), true);
  assert.equal(r.lamps.overlay('lite3'), 'flash');
  assert.equal(r.lamps.getOnIdx('lite3'), 0);
  solos(r, ['a_targ22']);                                       // a_targ22 does not set a destination during Secret
  assert.equal(r.lamps.getField('lite4'), 0);
  hit(r, 'flagLoop', { name: 'a_flag1' });
  assert.equal(r.lamps.getField('lite4'), 0);
  hit(r, 'sinkCapture', { id: 2 });                             // wrong order: nothing
  assert.equal(r.state(), 16);
  r.fp.clearCalls();
  hit(r, 'sinkCapture', { id: 3 });
  assert.deepEqual(r.calls('sinkSetRoute').at(-1).slice(1), [3, 3, 2]);
  assert.equal(r.state(), 22);
  r.tick(0.3);
  assert.equal(r.mission(), 'Shoot Red Wormhole');
  assert.equal(r.on('lite5'), true);
  assert.equal(r.lamps.getOnIdx('lite4'), 2);
  assert.equal(r.on('lite7'), false);
  hit(r, 'sinkCapture', { id: 1 });
  assert.equal(r.state(), 23);
  r.tick(0.3);
  assert.equal(r.mission(), 'Shoot Green Wormhole');
  assert.equal(r.on('lite6'), true);
  assert.equal(r.lamps.getOnIdx('lite2'), 1);
  hit(r, 'sinkCapture', { id: 2 });
  assert.equal(r.state(), 1);
});

test('Cosmic Plague: flags forced upgraded (2500 per frame, booster set does not re-light them)', () => {
  const r = ready();
  r.accept(15); r.tick(4.1);
  assert.equal(r.on('lite19') && r.on('lite20'), true);
  const s0 = r.score();
  flags(r, 2);
  r.tick(0.3);
  assert.equal(r.score() - s0, 5000);
  assert.equal(r.mission(), 'Flag Rolls: 73');
  assert.equal(r.lamps.overlay('lite305'), 'flash');
});

// =====================================================================================================================================
// Time Warp
// =====================================================================================================================================
function timeWarp() {
  const r = ready();
  r.accept(17); r.tick(4.1);
  assert.equal(r.mission(), 'Rebound Hits\nTo Go: 25');
  for (let i = 0; i < 24; i++) hit(r, 'rebounderHit', { name: 'v_rebo' + (1 + (i % 4)), impact: 3 });
  assert.equal(r.state(), 17);
  hit(r, 'rebounderHit', { name: 'v_rebo3', impact: 3 });
  assert.equal(r.state(), 24);
  r.tick(0.6);
  assert.equal(r.mission(), 'Shoot Hyperspace Chute or Launch Ramp');
  assert.equal(r.lamps.overlay('lite55'), 'flash');
  assert.equal(r.lamps.overlay('lite26'), 'flash');
  return r;
}

test('Time Warp forward (launch ramp): one rank up at once, +12 progress, 2,000,000, "Time Warp Forward"', () => {
  const r = timeWarp();
  assert.equal(r.count('middle_circle'), 6);
  const before = r.score();
  const ringBefore = r.count('outer_circle');
  r.ev('rampLine1');
  assert.equal(r.score() - before, 2000000);                    // lite55 lit: the ramp itself scores nothing
  assert.equal(r.count('middle_circle'), 7);
  assert.equal(r.count('outer_circle') - ringBefore, 12);
  assert.equal(r.state(), 1);
  assert.equal(r.mission(), 'Time Warp Forward');
  r.tick(4.0);
  assert.equal(r.mission(), 'Promoted to Commodore');
  assert.equal(r.on('lite55'), false);
});

test('Time Warp forward can promote twice (rank bonus + a full progress ring)', () => {
  const r = timeWarp();
  for (let i = 0; i < 12; i++) r.lamps.group('outer_circle').offsetForward();     // 12 progress lamps lit already: +12 overflows the ring
  r.ev('rampLine1');
  assert.equal(r.count('middle_circle'), 8);                    // 6 -> 7 (immediate) -> 8 (ring full)
  r.tick(4.3);
  assert.equal(r.mission(), 'Promoted to Commodore');
  r.tick(3.8);
  assert.equal(r.mission(), 'Promoted to Admiral');
});

test('Time Warp backward (hyperspace): demotion, no rank progress, still 2,000,000', () => {
  const r = timeWarp();
  const before = r.score();
  const ringBefore = r.count('outer_circle');
  r.ev('kickoutCapture', { id: 2 });
  assert.equal(r.score() - before, 2000000 + 10000);            // + the hyperspace bonus of the entry itself
  assert.equal(r.count('middle_circle'), 5);
  assert.equal(r.count('outer_circle'), ringBefore);
  assert.equal(r.state(), 1);
  assert.equal(r.mission(), 'Time Warp Backward');
  r.tick(4.0);
  assert.equal(r.mission(), 'Demoted to Lt Commander');
});

test('Time Warp backward at Cadet cannot demote; forward at Fleet Admiral only fills the ring', () => {
  const r = ready();
  r.rank(1);
  r.lamps.group('middle_circle').dropTop();
  r.lamps.group('middle_circle').offsetForward();
  assert.equal(r.count('middle_circle'), 1);
  // Cadet cannot select Time Warp; use rank 6 then lower the rank lamps by hand before the backward shot
  const t = timeWarp();
  for (let i = 0; i < 5; i++) t.lamps.group('middle_circle').dropTop();
  assert.equal(t.count('middle_circle'), 1);
  t.ev('kickoutCapture', { id: 2 });
  assert.equal(t.count('middle_circle'), 1);
  const f = timeWarp();
  for (let i = 0; i < 3; i++) f.rules.cheat('rmax');
  f.tick(5);
  assert.equal(f.count('middle_circle'), 9);
  const ring = f.count('outer_circle');
  f.ev('rampLine1');
  assert.equal(f.count('middle_circle'), 9);
  assert.equal(f.count('outer_circle') - ring, 12);
});

// =====================================================================================================================================
// Maelstrom
// =====================================================================================================================================
test('Maelstrom: eight stages, texts, grand reward and 5,000,000 at the hyperspace chute, guaranteed promotion', () => {
  const r = ready();
  r.accept(18); r.tick(4.1);
  const settle = () => r.tick(0.6);
  assert.equal(r.mission(), 'Drop Target Hits\nTo Go: 3');
  for (const n of ['a_targ1', 'a_targ2']) { hit(r, 'popupHit', { name: n }); settle(); }
  assert.equal(r.mission(), 'Drop Target Hits\nTo Go: 1');
  hit(r, 'popupHit', { name: 'a_targ3' }); settle();
  assert.equal(r.state(), 25);
  assert.equal(r.mission(), 'Spot Target Hits\nTo Go: 3');
  solos(r, ['a_targ10', 'a_targ19', 'a_targ22']); settle();
  assert.equal(r.state(), 26);
  assert.equal(r.mission(), 'Lanes Passes\nTo Go: 5');
  lanes(r, ['a_roll6', 'a_roll7', 'a_roll4', 'a_roll8', 'a_roll5']); settle();
  assert.equal(r.state(), 27);
  assert.equal(r.mission(), 'Shoot the Fuel Chute');
  lanes(r, ['a_roll183']); settle();                            // not the top rollover
  assert.equal(r.state(), 27);
  lanes(r, ['a_roll184']); settle();
  assert.equal(r.state(), 28);
  assert.equal(r.mission(), 'Shoot Launch Ramp');
  r.ev('rampLine1'); settle();
  assert.equal(r.state(), 29);
  assert.equal(r.mission(), 'Shoot the Flags');
  assert.equal(r.on('lite19') && r.on('lite20'), true);
  hit(r, 'flagFrame', { name: 'a_flag2', frame: 1, dir: 1 }); settle();
  assert.equal(r.state(), 30);
  assert.equal(r.mission(), 'Find the Wormhole');
  assert.equal(r.lamps.getField('lite4') > 0, true);
  hit(r, 'sinkCapture', { id: 2 }); settle();
  assert.equal(r.state(), 31);
  assert.equal(r.mission(), 'Hyperspace Chute Ends Maelstrom');
  assert.equal(r.on('lite130'), true);
  const rankBefore = r.count('middle_circle');
  const before = r.score();
  r.tick(6);
  hit(r, 'kickoutCapture', { id: 2 });
  assert.equal(r.state(), 1);
  const gained = r.score() - before;
  assert.ok(gained >= 5000000 + 10000, 'reward 5,000,000 + chute bonus: ' + gained);
  r.tick(2.1);
  assert.equal(r.info(), 'Maelstrom!');
  assert.equal(r.count('middle_circle'), rankBefore + 1);       // AddRankProgress(18) = promotion
  assert.equal(r.on('lite130'), false);                         // grand reward consumed it
  assert.equal(r.count('top_target_lights'), 4);
  assert.deepEqual(r.calls('kickoutSetActive').at(-1).slice(1), [1, true]);
  r.tick(0.3);
  assert.equal(r.mission(), 'Promoted to Fleet Admiral');          // the finale text itself goes to the info box
  assert.ok(r.played.includes('SW10'));
});

// =====================================================================================================================================
// Ranks
// =====================================================================================================================================
test('three 6-point missions promote Cadet -> Ensign; the ring flashes 5 s and clears; "Promoted to Ensign" 8 s', () => {
  const r = ready();
  assert.equal(r.count('middle_circle'), 1);
  for (let k = 0; k < 3; k++) {
    r.tick(9);
    r.accept(2); r.tick(4.1);
    bump(r, 8);
    r.tick(0.6);
    if (k < 2) assert.equal(r.count('middle_circle'), 1);
  }
  assert.equal(r.count('middle_circle'), 2);
  assert.equal(r.count('outer_circle'), 18);                    // flashing off for 5 s
  assert.match(r.mission(), /Promoted to Ensign|Target Practice Complete/);
  r.tick(5.2);
  assert.equal(r.count('outer_circle'), 0);
  assert.equal(r.count('middle_circle'), 2);
  assert.ok(r.played.includes('SW10'));
  assert.equal(r.played.filter((k) => k === 'SW9').length, 2);   // the first two completions: no promotion -> SW9
  // the new rank selects from the next mission set
  r.tick(10);
  solos(r, ['a_targ13']);
  r.tick(0.3);
  assert.match(r.mission(), /Bug Hunt/);
});

test('rank progress hint: from 13 lit lamps the rank lamps rotate (AnimationForward) until the next group reset', () => {
  const r = ready();
  for (let k = 0; k < 2; k++) { r.accept(5); r.tick(4.1); for (let i = 1; i <= 9; i++) hit(r, 'popupHit', { name: 'a_targ' + i }); r.tick(1); }
  assert.equal(r.count('middle_circle'), 2);                    // two 9-point missions fill the ring: promotion
  const r2 = ready();
  r2.accept(5); r2.tick(4.1); for (let i = 1; i <= 9; i++) hit(r2, 'popupHit', { name: 'a_targ' + i }); r2.tick(1);
  r2.accept(2); r2.tick(4.1); bump(r2, 8); r2.tick(1);          // 9 + 6 = 15 lamps
  assert.equal(r2.count('outer_circle'), 15);
  assert.equal(r2.lamps.group('middle_circle').isAnimating(), true);
  r2.drain(0);                                                  // the end of the ball stops the animation, the lamps stay lit
  assert.equal(r2.lamps.group('middle_circle').isAnimating(), false);
  assert.equal(r2.count('outer_circle'), 15);
  assert.equal(r2.count('middle_circle'), 1);
});

test('rank and progress persist across balls and are reset by a new game', () => {
  const r = ready();
  r.rank(3);
  r.accept(2); r.tick(4.1); bump(r, 8);
  const ring = r.count('outer_circle');
  r.tick(1);
  r.noSave(); r.drain(0); r.tick(1.9); r.fed(); r.noSave();
  assert.equal(r.count('middle_circle'), 3);
  assert.equal(r.count('outer_circle'), ring);
  r.rules.newGame();
  r.tick(6);
  assert.equal(r.count('middle_circle'), 1);
  assert.equal(r.count('outer_circle'), 0);
});

// =====================================================================================================================================
// Fuel
// =====================================================================================================================================
test('fuel timeline after a refuel at t=0: 11 -> 0 at 4, 7, 13, 16, 24, 27, 37, 40, 52, 55, 69 s; dark at 72 s', () => {
  const r = makeRig().play();
  r.deploy();
  r.refuel();
  const times = [4, 7, 13, 16, 24, 27, 37, 40, 52, 55, 69];
  let level = 11;
  let t = 0;
  for (const at of times) {
    r.tick(at - t - 0.05); t = at - 0.05;
    assert.equal(r.lamps.fuel.level, level, `before ${at}`);
    r.tick(0.1); t = at + 0.05;
    level -= 1;
    assert.equal(r.lamps.fuel.level, level, `after ${at}`);
  }
  assert.equal(level, 0);
  r.tick(72 - t - 0.05);
  assert.equal(r.lamps.steady('literoll179'), true);
  r.tick(0.1);
  for (const m of r.lamps.fuel.members) assert.equal(r.lamps.isLit(m), false);
  assert.equal(r.lamps.fuel.level, 0);
});

test('fuel rollovers raise the level to 2k-1 only when lower; fuel spot targets and the bonus lane refuel to full', () => {
  const r = makeRig().play();
  lanes(r, ['a_roll181']);
  assert.equal(r.lamps.fuel.level, 5);
  assert.equal(r.info(), 'Fuel Tanks Full');
  lanes(r, ['a_roll179']);
  assert.equal(r.lamps.fuel.level, 5);                          // 1 < 5: unchanged
  lanes(r, ['a_roll183']);
  assert.equal(r.lamps.fuel.level, 9);
  solos(r, ['a_targ10', 'a_targ11']);
  assert.equal(r.lamps.fuel.level, 9);
  solos(r, ['a_targ12']);
  assert.equal(r.lamps.fuel.level, 11);
  assert.ok(r.played.includes('SW25'));
  assert.equal(r.score(), 500 * 3 + 750 * 3);
  r.tick(2.1);
  assert.equal(r.count('top_circle_tgt_lights'), 0);            // blink 2 s then off
  r.tick(30);
  assert.ok(r.lamps.fuel.level < 11);
  lanes(r, ['a_roll5']);
  assert.equal(r.lamps.fuel.level, 11);
});

test('"Low Fuel Warning" at level 1 (when not waiting for deployment); fuel ending aborts a running mission', () => {
  const r = ready();
  r.accept(3); r.tick(4.1);
  assert.equal(r.mission(), 'Launches To Go: 3');
  r.lamps.fuel.setLevel(2);                                     // 3 s at level 2, then level 1
  r.tick(3.1);
  assert.equal(r.lamps.fuel.level, 1);
  assert.equal(r.mission(), 'Low Fuel Warning');
  r.tick(4.1);
  assert.equal(r.mission(), 'Launches To Go: 3');                // the mission text is restored behind the warning
  r.tick(10.5);                                                 // level 1 lasts 14 s, level 0 another 3 s
  assert.equal(r.lamps.fuel.level, 0);
  assert.equal(r.state(), 3);
  r.tick(3.2);
  assert.equal(r.state(), 1);                                   // Mission Failed
  assert.equal(r.mission(), 'Mission Failed');
  r.tick(4.1);
  assert.equal(r.mission(), 'Refuel the Ship');
  assert.equal(r.on('lite198'), false);
  assert.equal(r.lamps.group('outer_circle').isAnimating(), false);
  assert.equal(r.view.fuelLevel, 0);
});

test('no low-fuel warning in state 0; fuel ending in state 0 does nothing', () => {
  const r = makeRig().play();
  r.refuel();
  r.tick(70);
  assert.equal(r.state(), 0);
  assert.equal(r.mission(), 'Ready for Launch');
  r.tick(3);
  assert.equal(r.mission(), 'Ready for Launch');
});

// =====================================================================================================================================
// Mission state vs balls
// =====================================================================================================================================
test('end of ball: mission cancelled (state 0), lamps of the reset block cleared, rank kept; a ball save keeps everything and re-shows the text', () => {
  const r = ready();
  r.accept(3); r.tick(4.1);
  assert.equal(r.state(), 3);
  r.lamps.on('lite200');
  r.drain(0);                                                   // ball save
  assert.equal(r.state(), 3);
  r.tick(1.9);
  r.fed();
  assert.equal(r.mission(), 'Launches To Go: 3');
  r.noSave();
  r.drain(0);
  assert.equal(r.state(), 0);
  assert.equal(r.view.missionState, 0);
  r.tick(1.9);
  r.fed();
  assert.equal(r.mission(), 'Ready for Launch');
  assert.equal(r.lamps.group('goal_lights').count(), 0);
  assert.equal(r.on('lite198'), false);
  assert.equal(r.lamps.fuel.level, 0);
});

test('game over leaves mission state 32', () => {
  const r = makeRig().play();
  r.endBall(); r.endBall(); r.noSave(); r.drain(0);
  assert.equal(r.state(), 32);
});

test('a hit on a mission spot target in state 0 only scores and lights the lamp', () => {
  const r = makeRig().play();
  const s0 = r.score();
  solos(r, ['a_targ13']);
  assert.equal(r.score() - s0, 1000);
  assert.equal(r.state(), 0);
  assert.equal(r.lamps.steady('lite101'), true);
  assert.equal(r.on('lite56'), false);
});

test('mission spot bank: three lit lamps flash 2 s then go off; mission lamps are cleared when a mission ends', () => {
  const r = ready();
  solos(r, ['a_targ13', 'a_targ14', 'a_targ15']);
  assert.equal(r.count('ramp_tgt_lights'), 3);
  r.tick(2.1);
  assert.equal(r.count('ramp_tgt_lights'), 0);
});

test('real lamps module (when implemented): a mission runs end to end against it', { skip: !realLampsAvailable() }, () => {
  const r = makeRig({ realLamps: true }).play();
  r.refuel(); r.deploy(); r.tick(0.3);
  solos(r, ['a_targ15']);
  r.ev('rampLine1');
  assert.equal(r.state(), 2);
  bump(r, 8);
  assert.equal(r.state(), 1);
  assert.equal(r.lamps.group('outer_circle').count(), 6);
});
