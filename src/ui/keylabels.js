/**
 * src/ui/keylabels.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 8.6
 * keyLabel(code) -> human label for a KeyboardEvent.code: KeyZ -> "Z", Digit1 -> "1", Slash -> "/", Period -> ".", Space -> "Space",
 * ArrowUp -> "Up Arrow", ShiftLeft -> "Left Shift", Numpad1 -> "Num 1", F2 -> "F2". Unknown codes come back unchanged. Pure.
 */

/** @type {Readonly<Record<string, string>>} */
const NAMED = Object.freeze({
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Num Enter', Tab: 'Tab', Backspace: 'Backspace', Escape: 'Esc', CapsLock: 'Caps Lock',
  ArrowUp: 'Up Arrow', ArrowDown: 'Down Arrow', ArrowLeft: 'Left Arrow', ArrowRight: 'Right Arrow',
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt', MetaLeft: 'Left Win', MetaRight: 'Right Win', ContextMenu: 'Menu',
  Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
  PrintScreen: 'Print Screen', ScrollLock: 'Scroll Lock', Pause: 'Pause', NumLock: 'Num Lock',
  Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: '\'', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  IntlBackslash: '\\', Backquote: '`', Minus: '-', Equal: '=',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .', NumpadComma: 'Num ,',
});

/**
 * @param {string} code  KeyboardEvent.code
 * @returns {string}
 */
export function keyLabel(code) {
  if (typeof code !== 'string') return code === null || code === undefined ? '' : String(code);
  if (Object.prototype.hasOwnProperty.call(NAMED, code)) return NAMED[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return 'Num ' + m[1];
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}
