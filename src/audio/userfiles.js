/**
 * src/audio/userfiles.js
 * OWNER: AUDIO
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 10.5; SPEC 7.5 step 6
 * pickSoundFiles(input, {data}) -> Promise<Map<UPPERCASE key, ArrayBuffer>>   (keys: 'SOUND49D', 'PINBALL')
 * Collects the user's OWN sound files from every browser way of handing over a folder or a zip:
 *   - a FileList / File[] from <input type=file webkitdirectory multiple> or loose files (File.webkitRelativePath honoured);
 *   - `.zip` archives anywhere in the list (expanded with readZip, only the matching entries are inflated);
 *   - a FileSystemDirectoryHandle / FileSystemFileHandle (window.showDirectoryPicker(), Chromium);
 *   - a drag-and-drop DataTransfer (webkitGetAsEntry directory trees), or the plain snapshot array snapshotDrop() makes of it.
 * A path matches /(^|[\\/])(sound\d+d?\.wav|pinball\.mid)$/i on its base name: any 'SOUND\' sub-folder prefix and any letter case
 * are ignored. Nothing here validates content (the facade checks size + SHA-1) and nothing is uploaded anywhere.
 * Also exported for the wiring code: snapshotDrop, attachDropTarget, pickDirectory, supportsDirectoryPicker, soundKeyForName.
 *
 * ASSUMPTIONS:
 *  - Drag-and-drop item lists die when the drop handler returns, so the DataTransfer is turned into a plain array synchronously
 *    (before the first await) - pickSoundFiles(dataTransfer) and attachDropTarget both rely on that.
 *  - The first copy of a key wins (a folder that also contains a zip of the same files is harmless).
 *  - Directory walking is capped (depth 8, 20000 entries) so choosing a huge folder by mistake cannot hang the page.
 *  - The returned map holds every key whose file name matches the contract regex (including files the manifest does not use,
 *    e.g. SOUND6); the facade ignores those.
 */
import { readZip } from './zip.js';

/** The contract's name filter, applied to a whole path (base name must match). */
export const SOUND_NAME_RE = /(^|[\\/])(sound\d+d?\.wav|pinball\.mid)$/i;

const MAX_DEPTH = 8;
const MAX_VISITED = 20000;
const MAX_ZIP_BYTES = 256 * 1024 * 1024;

/**
 * Map a path / name to its key, or null if it is not a Pinball sound file.
 * @param {string} name e.g. 'Pinball/SOUND/sound49d.WAV' @returns {string|null} e.g. 'SOUND49D'
 */
export function soundKeyForName(name) {
  const m = SOUND_NAME_RE.exec(String(name || ''));
  return m ? m[2].replace(/\.(wav|mid)$/i, '').toUpperCase() : null;
}

const isZipName = (name) => /\.zip$/i.test(String(name || ''));

/** @returns {boolean} true when the browser offers window.showDirectoryPicker (Chromium) */
export function supportsDirectoryPicker(win = globalThis) {
  return !!win && typeof win.showDirectoryPicker === 'function';
}

/**
 * Ask the user for a directory with the File System Access API. MUST be called from a user gesture.
 * @returns {Promise<any|null>} a FileSystemDirectoryHandle, or null (unsupported / cancelled)
 */
export async function pickDirectory(win = globalThis) {
  if (!supportsDirectoryPicker(win)) return null;
  try {
    return await win.showDirectoryPicker({ id: 'pinball-sounds', mode: 'read' });
  } catch {
    return null; // AbortError when the user cancels
  }
}

/**
 * Synchronously turn a DataTransfer (drop event) into a stable array of FileSystemEntry / File objects.
 * @param {any} dt @returns {any[]}
 */
export function snapshotDrop(dt) {
  const out = [];
  if (!dt) return out;
  try {
    const items = dt.items ? Array.from(dt.items) : [];
    for (const it of items) {
      if (!it || (it.kind && it.kind !== 'file')) continue;
      let entry = null;
      try {
        if (typeof it.webkitGetAsEntry === 'function') entry = it.webkitGetAsEntry();
        else if (typeof it.getAsEntry === 'function') entry = it.getAsEntry();
      } catch { /* fall through to getAsFile */ }
      if (entry) { out.push(entry); continue; }
      try { const f = typeof it.getAsFile === 'function' ? it.getAsFile() : null; if (f) out.push(f); } catch { /* ignore */ }
    }
    if (!out.length && dt.files) for (const f of Array.from(dt.files)) out.push(f);
  } catch { /* ignore */ }
  return out;
}

/**
 * Make `target` accept dropped folders / zips / files. `onDrop(snapshot, event)` receives the stable snapshot, which can be passed
 * straight to audio.loadFromFiles(). Returns a function that removes the listeners.
 * @param {any} target an element / window / document @param {(snapshot:any[], e:any)=>void} onDrop @returns {()=>void}
 */
export function attachDropTarget(target, onDrop) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const hasFiles = (dt) => !!dt && Array.from(dt.types || []).includes('Files');
  const over = (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'copy'; } catch { /* ignore */ }
  };
  const drop = (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    const snapshot = snapshotDrop(e.dataTransfer); // must happen synchronously
    try { if (typeof onDrop === 'function') onDrop(snapshot, e); } catch { /* the handler's problem */ }
  };
  target.addEventListener('dragover', over);
  target.addEventListener('drop', drop);
  return () => {
    target.removeEventListener('dragover', over);
    target.removeEventListener('drop', drop);
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// input normalisation (synchronous) and traversal (asynchronous)
// ---------------------------------------------------------------------------------------------------------------------
const isFileLike = (x) => x && typeof x === 'object'
  && (typeof x.arrayBuffer === 'function' || (typeof x.name === 'string' && 'size' in x));
const isDirHandle = (x) => x && x.kind === 'directory' && (typeof x.values === 'function' || typeof x.entries === 'function');
const isFileHandle = (x) => x && x.kind === 'file' && typeof x.getFile === 'function';
const isEntry = (x) => x && (x.isFile === true || x.isDirectory === true);
const isDataTransfer = (x) => x && typeof x === 'object' && !Array.isArray(x) && !isFileLike(x)
  && ('items' in x || 'files' in x) && !('length' in x);

/** Everything that can be a root of the input, as a plain array. Runs synchronously (drag-and-drop items expire). */
function normaliseRoots(input) {
  if (input == null) return [];
  if (isDataTransfer(input)) return snapshotDrop(input);
  if (isFileLike(input) || isDirHandle(input) || isFileHandle(input) || isEntry(input)) return [input];
  if (typeof input.length === 'number' || typeof input[Symbol.iterator] === 'function') {
    const roots = [];
    for (const it of Array.from(input)) {
      if (it && typeof it.webkitGetAsEntry === 'function') { // a DataTransferItem inside a plain list
        let entry = null;
        try { entry = it.webkitGetAsEntry(); } catch { /* ignore */ }
        if (entry) { roots.push(entry); continue; }
        try { const f = it.getAsFile && it.getAsFile(); if (f) roots.push(f); } catch { /* ignore */ }
      } else if (it) {
        roots.push(it);
      }
    }
    return roots;
  }
  return [];
}

async function readFileBytes(file) {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  if (typeof FileReader === 'function') {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file);
    });
  }
  throw new Error('cannot read file');
}

/**
 * Collect the user's sound files.
 * @param {FileList|File[]|any} input FileList, File[], DataTransfer, drop snapshot, FileSystemDirectoryHandle / FileHandle / Entry
 * @param {object} [opts] reserved
 * @returns {Promise<Map<string, ArrayBuffer>>} upper-case key ('SOUND49D', 'PINBALL') -> bytes; never rejects
 */
export async function pickSoundFiles(input, opts = {}) {
  void opts;
  /** @type {Map<string, ArrayBuffer>} */
  const out = new Map();
  let roots;
  try {
    roots = normaliseRoots(input); // synchronous part: must run before the first await
  } catch {
    return out;
  }
  const budget = { visited: 0 };

  const take = (key, buf) => { if (key && buf && !out.has(key)) out.set(key, buf); };

  /** One file: a sound file is read, a zip is expanded, anything else is ignored. */
  async function consumeFile(pathName, readBytes, size, type) {
    const key = soundKeyForName(pathName);
    if (key) { take(key, await readBytes()); return; }
    if (isZipName(pathName) || /zip/i.test(String(type || ''))) {
      if (size > MAX_ZIP_BYTES) return;
      const files = await readZip(await readBytes(), { filter: (base) => soundKeyForName(base) !== null });
      for (const [base, buf] of files) take(soundKeyForName(base), buf);
    }
  }

  async function walk(node, prefix, depth) {
    if (++budget.visited > MAX_VISITED || depth > MAX_DEPTH) return;
    try {
      if (isDirHandle(node)) {
        const iter = typeof node.values === 'function' ? node.values() : node.entries();
        for await (const item of iter) {
          if (budget.visited > MAX_VISITED) break;
          const child = Array.isArray(item) ? item[1] : item;
          await walk(child, prefix + (node.name ? node.name + '/' : ''), depth + 1);
        }
      } else if (isFileHandle(node)) {
        const file = await node.getFile();
        await consumeFile(prefix + (node.name || file.name || ''), () => readFileBytes(file), file.size, file.type);
      } else if (isEntry(node)) {
        if (node.isDirectory) {
          const reader = node.createReader();
          for (;;) {
            const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
            if (!batch || !batch.length || budget.visited > MAX_VISITED) break;
            for (const child of batch) await walk(child, prefix + (node.name ? node.name + '/' : ''), depth + 1);
          }
        } else {
          const file = await new Promise((resolve, reject) => node.file(resolve, reject));
          await consumeFile(prefix + (node.name || file.name || ''), () => readFileBytes(file), file.size, file.type);
        }
      } else if (isFileLike(node)) {
        const name = node.webkitRelativePath || node.name || '';
        await consumeFile(name, () => readFileBytes(node), Number(node.size) || 0, node.type);
      }
    } catch {
      /* unreadable file / denied permission: skip it, keep going */
    }
  }

  for (const root of roots) await walk(root, '', 0);
  return out;
}
