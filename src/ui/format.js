/**
 * src/ui/format.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 8.3; SPEC 6.2 / 5.2.7 / E3
 * formatScore(n): plain decimal, "" if n < 0 (SPEC E3: no commas, no padding).
 * formatHighScore(n): thousands separators 1,234,567 - the ONLY place in the app with commas; negative values (the -999 "empty slot") give "".
 * Pure, Node-safe (no DOM, no locale APIs: the grouping is done by hand so every machine prints the same text).
 *
 * ASSUMPTIONS: non-finite or non-numeric input is treated like a blank (""), never thrown on.
 */

/**
 * Score as shown in the panel digit cells and in text messages.
 * @param {number} n  CurScore; -1 (any negative) = blank box
 * @returns {string}
 */
export function formatScore(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '';
  return String(Math.trunc(n));
}

/**
 * Score as shown in the high-score list (SPEC 5.2.7): digits grouped in threes with commas.
 * @param {number} n  score; the empty-slot value -999 (any negative) gives ""
 * @returns {string}
 */
export function formatHighScore(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '';
  const digits = String(Math.trunc(n));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}
