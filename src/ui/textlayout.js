/**
 * src/ui/textlayout.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 8.3; SPEC 6.2 (text boxes)
 * wrapText(text, cols, rows) -> string[] : the message layout of the two panel text boxes. Pure.
 * fitText(text, cols, rows, maxCols) -> {lines, cols} : wrapText plus a condensed fallback for the few messages that would otherwise lose their last line.
 *
 *   - left / top aligned, one line per array entry, at most `rows` lines of at most `cols` characters;
 *   - "\n" forces a break (a blank line is kept in the middle of a message, trailing blank lines are dropped);
 *   - greedy word wrap at spaces (a word that does not fit on the current line starts the next one);
 *   - a word longer than `cols` is split mid-word at `cols` characters (it starts on a fresh line);
 *   - lines beyond `rows` are cut; trailing spaces never appear; the empty string gives [].
 *
 * ASSUMPTIONS: runs of spaces collapse to one wrap opportunity (the original font box did not preserve indentation either);
 * a TAB counts as a space; CR is ignored.
 */

/**
 * @param {string} text   message text ('\n' = line break)
 * @param {number} cols   characters per line (15 for both panel boxes)
 * @param {number} [rows] maximum lines (2 info box, 4 mission box); default unlimited
 * @returns {string[]}
 */
export function wrapText(text, cols, rows = Infinity) {
  const maxCols = Math.floor(Number(cols));
  const maxRows = rows === Infinity ? Infinity : Math.floor(Number(rows));
  if (!(maxCols >= 1) || !(maxRows >= 1)) return [];
  const src = (text === null || text === undefined ? '' : String(text)).replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  const out = [];
  for (const paragraph of src.split('\n')) {
    wrapParagraph(paragraph, maxCols, out);
    if (out.length > maxRows) break;
  }
  trimTrailingBlank(out);
  if (out.length > maxRows) out.length = maxRows;
  trimTrailingBlank(out);
  return out;
}

/**
 * wrapText() with a safety net for messages that are a little too long for the box.
 * The normal layout (`cols` characters per line) is used whenever the whole message fits in `rows` lines. When it does not
 * (for example "Extra Ball Lit\n250000" in the 2-row info box, or "Launch Ramp Starts Satellite Retrieval Mission" in the 4-row
 * mission box) the characters are drawn a little narrower: the first column count between `cols + 1` and `maxCols` at which the whole
 * message fits is used, so the number / last word is not cut off. If even `maxCols` is not enough the normal layout (with the usual cut) is returned.
 * @param {string} text @param {number} cols @param {number} [rows] @param {number} [maxCols] widest condensed layout allowed (default = cols: never condense)
 * @returns {{lines:string[], cols:number}} the lines and the column count they were laid out for (cell width = box width / cols)
 */
export function fitText(text, cols, rows = Infinity, maxCols = cols) {
  const normal = wrapText(text, cols, rows);
  const limit = Math.floor(Number(maxCols));
  if (!(limit > cols) || !Number.isFinite(rows)) return { lines: normal, cols };
  if (wrapText(text, cols).length <= rows) return { lines: normal, cols };
  for (let c = Math.floor(Number(cols)) + 1; c <= limit; c++) {
    const lines = wrapText(text, c);
    if (lines.length <= rows) return { lines, cols: c };
  }
  return { lines: normal, cols };
}

/** @param {string[]} lines */
function trimTrailingBlank(lines) {
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
}

/**
 * Wrap one '\n'-free paragraph, appending the produced lines to `out`.
 * @param {string} paragraph @param {number} cols @param {string[]} out
 */
function wrapParagraph(paragraph, cols, out) {
  const words = paragraph.split(' ').filter((w) => w.length > 0);
  if (words.length === 0) { out.push(''); return; }
  let line = '';
  for (let word of words) {
    while (word.length > cols) {                 // a word wider than the box is split mid-word
      if (line !== '') { out.push(line); line = ''; }
      out.push(word.slice(0, cols));
      word = word.slice(cols);
    }
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= cols) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  if (line !== '') out.push(line);
}
