/**
 * src/rules/highscores.js
 * OWNER: RULES
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 7.5; type HighScoreTableApi (src/types.js); SPEC 5.2.7, 6.6
 * HighScoreTable: exactly 5 entries sorted by score descending; an empty slot is {name:'', score:-999}.
 *   qualifies(score)  score > 0 and strictly better than at least one slot (= better than the 5th slot)
 *   insert(name, score) -> rank 1..5 (0 = not inserted); entries below shift down; names are trimmed to 31 chars; onChange(entries) fires after it
 *   load(entries)     replaces the contents (sanitised to exactly 5, sorted, names clipped), does NOT call onChange
 *   clear()           blanks the table and calls onChange
 *   rankOf(score)     ADDITIVE helper: the rank the score would get (1..5) or 0, without inserting (used for the name prompt)
 * Ties: a new score equal to an existing one ranks BELOW it (the earlier holder keeps the higher place).
 * Persistence is main.js' job (it assigns `onChange` and feeds `load`); this class never touches storage.
 * ASSUMPTIONS: entries whose score is not a finite number are treated as empty slots on load; the empty/blank name of an inserted entry is kept as ''.
 */

const SLOTS = 5;
const MAX_NAME = 31;
const EMPTY_SCORE = -999;

/** @returns {{name:string, score:number}} */
function blank() { return { name: '', score: EMPTY_SCORE }; }

export class HighScoreTable {
  /** @type {((entries: {name:string, score:number}[]) => void) | null} */
  onChange = null;

  /** @param {{name:string, score:number}[]} [entries] optional initial contents */
  constructor(entries) {
    this._e = Array.from({ length: SLOTS }, blank);
    if (entries) this.load(entries);
  }

  /** @returns {{name:string, score:number}[]} a fresh copy of the 5 entries */
  entries() { return this._e.map((x) => ({ name: x.name, score: x.score })); }

  /** @param {number} score @returns {boolean} */
  qualifies(score) {
    return Number.isFinite(score) && score > 0 && score > this._e[SLOTS - 1].score;
  }

  /** @param {number} score @returns {number} 1..5 or 0 */
  rankOf(score) {
    if (!this.qualifies(score)) return 0;
    let i = 0;
    while (i < SLOTS && this._e[i].score >= score) i++;
    return i < SLOTS ? i + 1 : 0;
  }

  /**
   * @param {string} name
   * @param {number} score
   * @returns {number} rank 1..5, or 0 when the score did not make the table
   */
  insert(name, score) {
    const rank = this.rankOf(score);
    if (rank === 0) return 0;
    const clean = String(name === undefined || name === null ? '' : name).trim().slice(0, MAX_NAME);
    this._e.splice(rank - 1, 0, { name: clean, score });
    this._e.length = SLOTS;
    if (typeof this.onChange === 'function') this.onChange(this.entries());
    return rank;
  }

  /** @param {{name:string, score:number}[]} entries */
  load(entries) {
    const list = [];
    if (Array.isArray(entries)) {
      for (const x of entries) {
        if (!x || typeof x !== 'object') continue;
        const score = Number(x.score);
        if (!Number.isFinite(score) || score <= 0) continue;
        list.push({ name: String(x.name === undefined || x.name === null ? '' : x.name).trim().slice(0, MAX_NAME), score });
      }
    }
    list.sort((a, b) => b.score - a.score);            // stable: equal scores keep their stored order
    this._e = Array.from({ length: SLOTS }, (_, i) => list[i] || blank());
  }

  clear() {
    this._e = Array.from({ length: SLOTS }, blank);
    if (typeof this.onChange === 'function') this.onChange(this.entries());
  }

  /** @returns {{name:string, score:number}[]} */
  toJSON() { return this.entries(); }
}
