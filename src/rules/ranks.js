/**
 * src/rules/ranks.js
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 7.2; SPEC 5.8, 5.13.4 (rank idioms)
 * Ranks: nine ranks = number of lit lamps of `middle_circle` (lite154..162); progress = the 18 lamps of `outer_circle`.
 *   addProgress(n)  lit(lite16); n x outer_circle.nextOn(2 s); when the ring is full (count == 18): the ring flashes 5 s then clears,
 *                   middle_circle.groupReset(), and (rank < 9) middle_circle.nextOn(5 s) + "Promotion to <Rank>" 8 s + sound SW10;
 *                   otherwise from 13 lit lamps on the rank lamps rotate (animationForward(-1)) until the next group reset.
 *   promoteOne()    cheat 'rmax' / Time Warp forward: rank + 1 at once (5 s flash), text + sound, no progress points.
 *   demote()        Time Warp backward: highest rank lamp off, "Demotion to <Rank>" 8 s.
 * Rank and progress persist across balls (per player, via lamps.playerChanged); they reset at New Game (lamps.resetAll).
 * ASSUMPTIONS: at Fleet Admiral a full ring only flashes/clears (no text, no sound, no "promotion" result), as SPEC 9 #8 says.
 */

/** @param {object} R rules context (state.js) */
export function installRanks(R) {
  const { lamps, G, D, s } = R;
  const T = D.MISSION_TEXT;
  const RING = 18;
  const HINT_AT = 13;                 // 3/4 of 18

  /** Current rank 1..9 (0 before the first ball feed lit the first rank lamp). */
  const rank = () => G.middle_circle.count();
  const rankName = (r) => D.RANK_NAMES[Math.min(D.RANK_NAMES.length, Math.max(1, r)) - 1];

  /** Promotion by +1 rank right now. Returns true when a rank lamp was added. */
  function promoteOne() {
    const r = rank();
    if (r >= D.RANK_NAMES.length) return false;
    G.middle_circle.groupReset();
    G.middle_circle.nextOn(D.TIMING.rankFlash);
    R.msg(D.fmt(T.promotionTo, rankName(r + 1)), 8);
    R.play('SW10');
    return true;
  }

  /** Demotion by one rank (Time Warp backward). Returns true when a rank lamp was removed. */
  function demote() {
    const r = rank();
    if (r <= 1) return false;
    G.middle_circle.dropTop();
    R.msg(D.fmt(T.demotionTo, rankName(r - 1)), 8);
    return true;
  }

  /**
   * SPEC 5.8 AddRankProgress(n).
   * @param {number} n progress lamps to light (18 = one full promotion)
   * @returns {boolean} true when the rank went up
   */
  function addProgress(n) {
    lamps.on('lite16');
    G.outer_circle.groupReset();                          // stop the mission chase so the new lamps flash cleanly
    for (let i = 0; i < n; i++) G.outer_circle.nextOn(D.TIMING.lampFlash);
    const count = G.outer_circle.count();
    if (count >= RING) {
      G.outer_circle.broadcast('flashThenOff', D.TIMING.rankFlash);
      s.rankFlashPending = true;
      R.startH('rankFlash', D.TIMING.rankFlash, () => { s.rankFlashPending = false; });
      G.middle_circle.groupReset();
      const r = rank();
      if (r < D.RANK_NAMES.length) {
        G.middle_circle.nextOn(D.TIMING.rankFlash);
        R.msg(D.fmt(T.promotionTo, rankName(r + 1)), 8);
        R.play('SW10');
        return true;
      }
      return false;
    }
    if (count >= HINT_AT) G.middle_circle.animationForward(-1);
    return false;
  }

  R.ranks = { rank, rankName, addProgress, promoteOne, demote };
}
