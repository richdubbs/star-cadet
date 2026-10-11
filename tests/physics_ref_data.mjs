/**
 * tests/physics_ref_data.mjs
 * OWNER: PHYSICS (test data)
 * STATUS: IMPLEMENTED
 * Reference numbers produced by tests/physics_ref_driver.py from research/physics_ref_sim.py (the brute-force Python port of the
 * original physics) with its random source replaced by a constant 0.5. Regenerate with:
 *     python -I tests/physics_ref_driver.py research > ref.json
 * and paste the three tables below. See the driver header for the exact scenarios.
 */

/** Free fall on an empty table from (0, -13): [t, y, speed] every 0.25 s. */
export const REF_FREEFALL = [[0.25,-12.6191,2.9251],[0.5,-11.5256,5.7074],[0.75,-9.7541,8.354],[1,-7.3378,10.8713],[1.25,-4.3082,13.2658],[1.5,-0.6952,15.5434],[1.75,3.4727,17.7098],[2,8.1685,19.7705],[2.25,13.3664,21.7306],[2.5,19.0418,23.5951],[2.75,25.1715,25.3685],[3,31.7332,27.0554]];

/**
 * Plunger launches (ball settled on the plunger, kicker live at t = 3.0 s): apex = minimum y within 2.5 s.
 * r05 = B 1.05 x Boost (rand 0.5), exact = B x Boost (rand 0).
 */
export const REF_LAUNCH = {"10":{"r05":7.4963,"exact":7.863},"15":{"r05":2.776,"exact":3.5431},"20":{"r05":-3.3836,"exact":-2.1083},"22":{"r05":-6.2088,"exact":-4.7045},"24":{"r05":-8.6514,"exact":-7.2702},"26":{"r05":-10.8336,"exact":-9.5969},"28":{"r05":-11.427,"exact":-11.3076},"30":{"r05":-12.0676,"exact":-11.9725},"100":{"r05":-12.1942,"exact":-12.1942}};

/** Left flipper shots, ball dropped from (1.9, 9.0): [press tick, speed when it first rises above y 10.0, x there] (null = never launched). */
export const REF_FLIPPER = [[0,null,null],[30,null,null],[56,null,null],[60,null,null],[64,null,null],[66,11.3389,2.1653],[68,24.9234,2.368],[70,15.9205,2.2598],[72,21.8996,2.0459],[74,26.8671,2.0339],[76,26.7627,1.8206],[78,28.4191,1.8029],[80,35.455,1.7205],[82,42.8818,1.3807],[84,38.9122,1.3377],[86,42.9958,1.4643],[88,43.6999,1.3288],[90,47.2482,1.2191]];
