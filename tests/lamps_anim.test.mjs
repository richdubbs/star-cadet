/**
 * tests/lamps_anim.test.mjs
 * OWNER: LAMPS
 * STATUS: IMPLEMENTED
 * Regression tests for the group verbs that touch the steady layer while an OVERLAY animation (chase / light show) is running
 * (research/rules.md L4 "mirror", L5 #32 OffsetAnimationForward, #33 OffsetAnimationBackward, #41 ResetAndTurnOn = nextOn).
 * Found by the RULES / LAMPS audit: Time Warp "backward" drops a rank lamp with dropTop() while the rank hint animation (>= 13 progress
 * lamps) rotates the middle ring; the stale overlay pattern kept showing the dropped lamp.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLamps } from '../src/lamps.js';

const shown = (l, g) => g.members.map((m) => (l.isLit(m) ? 1 : 0)).join('');
const steady = (l, g) => g.members.map((m) => (l.steady(m) ? 1 : 0)).join('');

test('dropTop under a running chase re-mirrors: the dropped lamp disappears at once and never comes back', () => {
  const l = createLamps();
  const g = l.group('middle_circle');
  for (let i = 0; i < 5; i++) g.offsetForward();
  g.animationForward(-1);                                    // the rank hint animation
  assert.equal(g.isAnimating(), true);
  assert.equal(g.count(), 5);
  assert.equal(shown(l, g).split('1').length - 1, 5);
  assert.equal(g.dropTop(), true);
  assert.equal(g.count(), 4);
  assert.equal(steady(l, g), '111100000');
  assert.equal(shown(l, g).split('1').length - 1, 4, 'the visible pattern follows the new steady layer immediately');
  for (let i = 0; i < 40; i++) {                             // keep rotating: always exactly four lamps lit
    l.advanceMs(80);
    assert.equal(shown(l, g).split('1').length - 1, 4, 'rotation step ' + i);
  }
  assert.equal(g.isAnimating(), true, 'the animation keeps running');
  g.groupReset();
  assert.equal(shown(l, g), '111100000');
});

test('offsetForward under a running chase re-mirrors too (the new lamp joins the rotating pattern)', () => {
  const l = createLamps();
  const g = l.group('outer_circle');
  g.offsetForward(); g.offsetForward();
  g.animationBackward(-1);
  assert.equal(g.offsetForward(), true);
  assert.equal(g.count(), 3);
  assert.equal(shown(l, g).split('1').length - 1, 3);
  l.advanceMs(80);
  assert.equal(shown(l, g).split('1').length - 1, 3);
  g.groupReset();
  assert.equal(shown(l, g).split('1').length - 1, 3);
});

test('dropTop / offsetForward without an animation behave as before (steady layer only, no overlays)', () => {
  const l = createLamps();
  const g = l.group('hyperspace_lights');
  assert.equal(g.offsetForward(), true);
  assert.equal(g.offsetForward(), true);
  assert.equal(g.dropTop(), true);
  assert.equal(steady(l, g), '1000');
  assert.ok(g.members.every((m) => l.overlay(m) === 'none'));
  assert.equal(g.isAnimating(), false);
});

test('nextOn stops a running overlay animation first (GroupReset), then flashes the new lamp; all-lit does nothing', () => {
  const l = createLamps();
  const g = l.group('outer_circle');
  g.offsetForward();
  g.animationBackward(-1);
  assert.equal(g.isAnimating(), true);
  assert.equal(g.nextOn(2), true);
  assert.equal(g.isAnimating(), false, 'the chase was stopped');
  assert.equal(g.count(), 2);
  assert.equal(l.overlay(g.members[1]), 'flash', 'the new lamp flashes (not masked by a FORCE overlay)');
  assert.equal(l.overlay(g.members[0]), 'none');
  l.advanceMs(2000);
  assert.equal(shown(l, g).slice(0, 2), '11');

  const full = createLamps();
  const h = full.group('bumper_target_lights');
  for (let i = 0; i < 3; i++) h.offsetForward();
  h.animationBackward(0.5);
  assert.equal(h.nextOn(2), false);
  assert.equal(h.isAnimating(), true, 'nothing to light: the animation is not touched');
});
