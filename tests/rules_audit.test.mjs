/**
 * tests/rules_audit.test.mjs
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * Regression tests added by the RULES / LAMPS audit against SPEC 5 and research/rules.md (shares tests/rules_rig.mjs with the other rules tests).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRig } from './rules_rig.mjs';

const hit = (r, type, payload) => r.ev(type, payload);

test('easy mode: the centre post stays up AND its lamp lite1 is lit again at every ball start (the end-of-ball block clears it)', () => {
  const r = makeRig().play();
  r.rules.cheat('easy mode');
  assert.equal(r.on('lite1'), true);
  r.endBall();                                                  // real drain, 1.82 s, next ball fed
  assert.deepEqual(r.calls('blockerSetEnabled').at(-1).slice(1), [true], 'the post stays up through the end-of-ball block');
  assert.equal(r.on('lite1'), true, 'lamp back on for ball 2');
  r.endBall();
  assert.equal(r.on('lite1'), true, 'and for ball 3');
  r.rules.cheat('easy mode');                                   // toggled off: post down, lamp off
  assert.equal(r.on('lite1'), false);
  r.endBall();
  assert.equal(r.on('lite1'), false);
});

test('Time Warp backward while the rank hint animation rotates the middle ring: the demoted rank lamp disappears at once', () => {
  const r = makeRig().play();
  r.refuel(); r.deploy(); r.tick(1);
  r.accept(17); r.tick(4.1);
  for (let i = 0; i < 25; i++) hit(r, 'rebounderHit', { name: 'v_rebo' + (1 + (i % 4)), impact: 3 });
  assert.equal(r.state(), 24);
  const mid = r.lamps.group('middle_circle');
  const ring = r.lamps.group('outer_circle');
  for (let i = 0; i < 13; i++) ring.offsetForward();            // >= 13 progress lamps: the rank lamps run the hint animation
  mid.animationForward(-1);
  assert.equal(mid.isAnimating(), true);
  assert.equal(mid.count(), 6);
  r.tick(0.5);
  hit(r, 'kickoutCapture', { id: 2 });                          // hyperspace chute: Time Warp backward
  assert.equal(mid.count(), 5, 'rank 6 -> 5');
  const visible = () => mid.members.filter((m) => r.lamps.isLit(m)).length;
  for (let i = 0; i < 20; i++) {
    assert.equal(visible(), 5, 'the visible rank lamps match the new rank (step ' + i + ')');
    r.tick(0.08);
  }
  assert.equal(r.mission().includes('Time Warp Backward') || r.mission().includes('Demotion'), true);
});

test('mission completion at 13+ progress lamps starts the rank hint; a later demotion or promotion keeps the ring consistent', () => {
  const r = makeRig().play();
  r.refuel(); r.deploy(); r.tick(1);
  r.accept(5); r.tick(4.1);                                     // Science: 9 progress points
  for (let i = 1; i <= 9; i++) hit(r, 'popupHit', { name: 'a_targ' + i });
  r.tick(1);
  r.accept(2); r.tick(4.1);                                     // Target Practice: 6 more -> 15 lamps
  for (let i = 0; i < 8; i++) hit(r, 'bumperHit', { name: 'a_bump1', impact: 5 });
  r.tick(1);
  const mid = r.lamps.group('middle_circle');
  assert.equal(r.count('outer_circle'), 15);
  assert.equal(mid.isAnimating(), true);
  const rank = mid.count();
  r.rules.cheat('rmax');                                        // promotion stops the hint (GroupReset) and lights the next rank lamp
  assert.equal(mid.count(), rank + 1);
  assert.equal(mid.isAnimating(), false);
  assert.equal(mid.members.filter((m) => r.lamps.steady(m)).length, rank + 1);
});

test('every lamp name that appears as a literal in src/rules/*.js is a real lamp (a typo would only throw when that branch runs)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { LAMP_NAMES, LAMP_GROUP_NAMES } = await import('../src/data/index.js');
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'rules');
  const lamps = new Set(LAMP_NAMES);
  const groups = new Set([...LAMP_GROUP_NAMES, 'all']);
  let checked = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const m of src.matchAll(/'(lite\d+|literoll\d+)'/g)) { assert.ok(lamps.has(m[1]), `${f}: unknown lamp ${m[1]}`); checked++; }
    for (const m of src.matchAll(/\bG\.([a-z_]+)\b/g)) { assert.ok(groups.has(m[1]), `${f}: unknown group ${m[1]}`); checked++; }
    for (const m of src.matchAll(/\bgoals\(([\d,\s]+)\)/g)) {
      for (const n of m[1].split(',').map((x) => x.trim()).filter(Boolean)) { assert.ok(lamps.has('lite' + n), `${f}: unknown goal lamp lite${n}`); checked++; }
    }
  }
  assert.ok(checked > 150, 'the scan found the literals (' + checked + ')');
});

// =====================================================================================================================================
// Lamp hygiene after EVERY mission (SPEC 5.7.2 select-state initialiser): goal lamps, trek chase, wormhole lamps and the mission lamps go dark
// =====================================================================================================================================
const lanes = (r, names) => { for (const n of names) hit(r, 'rolloverEnter', { name: n }); };
const solos = (r, names) => { for (const n of names) hit(r, 'soloHit', { name: n, impact: 5 }); };
const FINISH = {
  2: (r) => { for (let i = 0; i < 8; i++) hit(r, 'bumperHit', { name: 'a_bump1', impact: 5 }); },
  3: (r) => { for (let i = 0; i < 3; i++) r.ev('rampLine1'); },
  4: (r) => lanes(r, ['a_roll1', 'a_roll2', 'a_roll3']),
  5: (r) => { for (let i = 1; i <= 9; i++) hit(r, 'popupHit', { name: 'a_targ' + i }); },
  6: (r) => { solos(r, ['a_targ19', 'a_targ20', 'a_targ21']); hit(r, 'kickoutCapture', { id: 2 }); },
  7: (r) => { lanes(r, ['a_roll110', 'a_roll111', 'a_roll112']); hit(r, 'kickoutCapture', { id: 3 }); },
  8: (r) => { solos(r, ['a_targ16', 'a_targ17', 'a_targ18']); hit(r, 'sinkCapture', { id: 2 }); },
  9: (r) => { for (let i = 0; i < 15; i++) hit(r, 'soloHit', { name: 'a_targ' + (10 + (i % 3)), impact: 5 }); },
  10: (r) => { lanes(r, ['a_roll1', 'a_roll2', 'a_roll3']); for (let i = 0; i < 8; i++) hit(r, 'bumperHit', { name: 'a_bump2', impact: 5 }); },
  11: (r) => { for (const n of ['a_targ1', 'a_targ2', 'a_targ3']) hit(r, 'popupHit', { name: n }); hit(r, 'kickoutCapture', { id: 2 }); },
  12: (r) => { for (let i = 0; i < 3; i++) hit(r, 'bumperHit', { name: 'a_bump4', impact: 5 }); },
  13: (r) => { for (let i = 0; i < 15; i++) lanes(r, ['a_roll6']); },
  14: (r) => { for (let i = 0; i < 3; i++) lanes(r, ['a_roll4']); },
  15: (r) => { for (let i = 0; i < 75; i++) hit(r, 'flagFrame', { name: 'a_flag1', frame: i % 8, dir: 1 }); lanes(r, ['a_roll9']); },
  16: (r) => { for (const id of [3, 1, 2]) hit(r, 'sinkCapture', { id }); },
  17: (r) => { for (let i = 0; i < 25; i++) hit(r, 'rebounderHit', { name: 'v_rebo' + (1 + (i % 4)), impact: 3 }); r.ev('rampLine1'); },
};

for (const id of Object.keys(FINISH).map(Number)) {
  test(`mission ${id}: after completion only the select prompt lamp is flashing; goal / trek / wormhole / mission lamps are dark`, () => {
    const r = makeRig().play();
    r.refuel(); r.deploy(); r.tick(1);
    r.accept(id); r.tick(4.1);
    FINISH[id](r);
    assert.equal(r.state(), 1, 'mission ' + id + ' completed');
    r.tick(14);                                                 // every flash window (2 s / 5 s) is over
    const goal = r.lamps.group('goal_lights');
    const lit = goal.members.filter((m) => r.lamps.lightOn(m));
    assert.deepEqual(lit, ['lite319'], 'only the "hit mission targets" prompt lamp is left');
    assert.equal(r.lamps.overlay('lite319'), 'flash');
    for (const g of ['l_trek_lights', 'r_trek_lights', 'worm_hole_lights', 'bsink_arrow_lights', 'ramp_tgt_lights']) {
      assert.equal(r.lamps.group(g).members.some((m) => r.lamps.lightOn(m)), false, g + ' dark');
      assert.equal(r.lamps.group(g).isAnimating(), false, g + ' not animating');
    }
    for (const l of ['lite56', 'lite198', 'lite55', 'lite26', 'lite130', 'lite110']) assert.equal(r.lamps.lightOn(l), false, l + ' off');
    assert.equal(r.lamps.group('outer_circle').isAnimating(), false);
    assert.equal(r.lamps.getField('lite4'), 0, 'wormhole destination cleared');
    assert.equal(r.lamps.getField('lite56'), 0);
    assert.equal(r.lamps.lightOn('lite16'), true, 'bonus lane lamp lit by the completion');
    assert.equal(r.view.mission, 'Hit Mission Targets to Pick a Mission');
  });
}

test('mission 18 Maelstrom: the whole 8-stage chain leaves the table clean (goal lamps, flags, wormhole lamps) and the grand reward lit', () => {
  const r = makeRig().play();
  r.refuel(); r.deploy(); r.tick(1);
  r.accept(18); r.tick(4.1);
  for (const n of ['a_targ1', 'a_targ2', 'a_targ3']) hit(r, 'popupHit', { name: n });
  solos(r, ['a_targ10', 'a_targ19', 'a_targ22']);
  lanes(r, ['a_roll6', 'a_roll7', 'a_roll4', 'a_roll8', 'a_roll5']);
  assert.equal(r.state(), 27);
  lanes(r, ['a_roll184']);
  r.ev('rampLine1');
  hit(r, 'flagFrame', { name: 'a_flag2', frame: 1, dir: 1 });
  assert.equal(r.state(), 30);
  assert.equal(r.lamps.group('bsink_arrow_lights').members.every((m) => r.lamps.overlay(m) === 'flash'), true, 'arrows flash at the wormhole stage');
  hit(r, 'sinkCapture', { id: 3 });
  assert.equal(r.state(), 31);
  assert.equal(r.lamps.overlay('lite130'), 'flash');
  assert.equal(r.lamps.overlay('lite304'), 'flash');
  hit(r, 'kickoutCapture', { id: 2 });
  assert.equal(r.state(), 1);
  r.tick(14);
  assert.deepEqual(r.lamps.group('goal_lights').members.filter((m) => r.lamps.lightOn(m)), ['lite319']);
  assert.equal(r.lamps.lightOn('lite130'), false);
  assert.equal(r.lamps.group('worm_hole_lights').members.some((m) => r.lamps.lightOn(m)), false);
  assert.equal(r.on('lite16'), true);
  // grand reward lamps are still up (their windows are 55 / 60 s)
  assert.equal(r.count('top_target_lights'), 4);
  assert.equal(r.on('lite17') && r.on('lite18') && r.on('lite1') && r.on('lite60') && r.on('lite59'), true);
});
