/**
 * src/render/balls.js
 * OWNER: RENDER
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 9.1 per-frame table: physics.balls[i] -> chrome sphere (radius 0.3) at t2v(x, y, z), pool of >= 4 meshes keyed by id,
 * `visible:false` hides it, rolls about the axis perpendicular to its velocity by distance / R, soft contact shadow decal on the surface under it.
 * (additive module, imports three).
 *
 * Shadow decal: a soft dark disc on the surface the ball is above (floor for mask 1, the ramp / deck height field for masks 2 / 4), offset a little
 * away from the key light, fading and growing with the height of the ball above that surface; hidden while the ball is below the surface (holes).
 *
 * ASSUMPTIONS: the chrome ball has a faint scratch texture (three_utils.ballDetailTexture) so that rolling is visible on an otherwise perfect mirror;
 *  the pool starts at 6 meshes and GROWS on demand (up to 32) because physics allows up to 20 balls; a ball resting on the plunger rides the rod back
 *  by pull * travel (geom/ride.js, presentation only - the physics keeps it at the rest face).
 */
import * as THREE from 'three';
import { getDeckField } from './geom/deck.js';
import { clamp } from './convert.js';
import { plungerRideOffset } from './geom/ride.js';

const R = 0.3;

/**
 * @param {{data:import('../types.js').DataModule, kit:ReturnType<typeof import('./materials.js').createMaterialKit>, size?:number}} o
 */
export function createBalls(o) {
  const { data, kit } = o;
  const size = o.size ?? 6;
  const field = getDeckField(data);
  const root = new THREE.Group();
  root.name = 'balls';
  const sphere = new THREE.SphereGeometry(R, 40, 26);
  const plane = new THREE.PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);
  const slots = [];
  const MAX_SLOTS = 32;
  /** Add one pooled ball mesh + contact shadow (the pool grows on demand up to MAX_SLOTS: physics allows up to 20 balls). */
  function addSlot() {
    const mesh = new THREE.Mesh(sphere, kit.ball);
    mesh.castShadow = true;
    mesh.visible = false;
    const shMat = kit.ballShadow();
    const shadow = new THREE.Mesh(plane, shMat);
    shadow.renderOrder = 5;
    shadow.visible = false;
    root.add(mesh, shadow);
    const slot = { id: -1, mark: -1, mesh, shadow, shMat, px: 0, py: 0, fresh: true, spins: 0 };
    slots.push(slot);
    return slot;
  }
  for (let i = 0; i < size; i++) addSlot();
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  let frameNo = 0;
  const slotOf = new Int16Array(MAX_SLOTS);

  return {
    root,
    slots,
    /**
     * @param {import('../types.js').BallSnap[]} balls @param {number} dt @param {{pull:number}} [plunger] physics.plunger (a ball resting on the rod rides it back)
     */
    update(balls, dt, plunger) {
      void dt;
      const pull = plunger ? plunger.pull : 0;
      frameNo++;
      const n = Math.min(balls ? balls.length : 0, slotOf.length);
      // 1. keep the slots of balls we already show
      for (let i = 0; i < n; i++) {
        slotOf[i] = -1;
        const id = balls[i].id;
        for (let s = 0; s < slots.length; s++) if (slots[s].id === id && slots[s].mark !== frameNo) { slots[s].mark = frameNo; slotOf[i] = s; break; }
      }
      // 2. give new balls a free slot
      for (let i = 0; i < n; i++) {
        if (slotOf[i] >= 0) continue;
        for (let s = 0; s < slots.length; s++) {
          if (slots[s].mark !== frameNo) { slots[s].id = balls[i].id; slots[s].mark = frameNo; slots[s].fresh = true; slotOf[i] = s; break; }
        }
        if (slotOf[i] < 0 && slots.length < MAX_SLOTS) {
          const slot = addSlot();
          slot.id = balls[i].id; slot.mark = frameNo; slotOf[i] = slots.length - 1;
        }
      }
      // 3. hide slots that were not used this frame
      for (const s of slots) if (s.mark !== frameNo) { s.id = -1; s.mesh.visible = false; s.shadow.visible = false; }
      // 4. pose
      for (let i = 0; i < n; i++) {
        const b = balls[i];
        const s = slotOf[i] >= 0 ? slots[slotOf[i]] : null;
        if (!s) continue;
        const vis = b.visible !== false;
        s.mesh.visible = vis;
        if (!vis) { s.shadow.visible = false; s.fresh = true; continue; }
        const ry = b.y + (pull > 0 ? plungerRideOffset(b, pull, data.PLUNGER, data.HEIGHTS.plungerTravel, R) : 0);   // drawn y (rolling / physics use b.y)
        s.mesh.position.set(-b.x, b.z, ry);
        // rolling: rotate about the axis perpendicular to the (three-space) motion
        if (!s.fresh) {
          const dxv = -(b.x - s.px), dzv = b.y - s.py;
          const d = Math.hypot(dxv, dzv);
          if (d > 1e-5 && d < 2) {
            axis.set(dzv / d, 0, -dxv / d);
            q.setFromAxisAngle(axis, d / R);
            s.mesh.quaternion.premultiply(q);
            if ((++s.spins & 255) === 0) s.mesh.quaternion.normalize();
          }
        }
        s.px = b.x; s.py = b.y; s.fresh = false;
        // contact shadow
        const surf = b.mask === 1 ? 0 : field.heightAt(b.x, b.y);
        const h = b.z - R - surf;
        if (h < -0.06 || b.z < 0.05) { s.shadow.visible = false; continue; }
        const hh = Math.max(0, h);
        const k = clamp(1 - hh / 1.3, 0, 1);
        s.shadow.visible = k > 0.02;
        s.shMat.opacity = 0.62 * k;
        const sc = 0.98 + 0.55 * hh;
        s.shadow.scale.set(sc * 1.08, 1, sc * 1.08);
        s.shadow.position.set(-b.x + 0.07 + 0.25 * hh, surf + 0.014 + (b.mask === 2 ? 0.03 : 0), ry + 0.10 + 0.35 * hh);
      }
    },
    dispose() { sphere.dispose(); plane.dispose(); },
  };
}
