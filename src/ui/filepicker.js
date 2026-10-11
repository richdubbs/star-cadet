/**
 * src/ui/filepicker.js
 * OWNER: UI
 * STATUS: IMPLEMENTED
 * CONTRACT: ARCHITECTURE.md 8.2 (Options > Load My Sounds...) and 8.4 (start overlay "Use my own Pinball folder / zip..."); internal to src/ui.
 * createFilePicker({root, doc, onFiles}) -> {pickFolder(), pickFiles(), dispose()}
 *
 * Two hidden <input type="file"> elements living under `root` (ids file-folder and file-zip):
 *   - folder picker : webkitdirectory + multiple  (the user's whole Pinball folder, SOUND subfolder included)
 *   - file picker   : multiple, accept .zip .wav .mid .midi  (a zip of the game, or loose sound files)
 * pickFolder()/pickFiles() must be called synchronously from a click handler (browsers only open pickers inside a user gesture).
 * When the user chooses something, `onFiles(File[])` is called once and the input is reset so the same choice can be made again.
 * The module never reads the files: the application hands them to the audio loader (UIActions.loadLocalSounds).
 */
import { h } from './dom.js';

/**
 * @param {{root:any, doc:Document, onFiles:(files:File[])=>void}} opts
 * @returns {{pickFolder:()=>void, pickFiles:()=>void, dispose:()=>void, inputs:{folder:any, files:any}}}
 */
export function createFilePicker({ root, doc, onFiles }) {
  const make = (id, extra) => h(doc, 'input', { type: 'file', id, class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true', multiple: true, ...extra });
  const folder = make('file-folder', { webkitdirectory: true, directory: true, mozdirectory: true });
  const files = make('file-zip', { accept: '.zip,.wav,.mid,.midi,application/zip,audio/wav,audio/midi' });

  const onChange = (e) => {
    const input = e.currentTarget || e.target;
    const list = input && input.files ? Array.from(input.files) : [];
    if (list.length > 0) onFiles(list);
    try { input.value = ''; } catch { /* some browsers refuse to reset a file input programmatically */ }
  };
  folder.addEventListener('change', onChange);
  files.addEventListener('change', onChange);
  root.appendChild(folder);
  root.appendChild(files);

  return {
    inputs: { folder, files },
    pickFolder() { folder.click(); },
    pickFiles() { files.click(); },
    dispose() {
      folder.removeEventListener('change', onChange);
      files.removeEventListener('change', onChange);
      if (folder.parentNode) folder.parentNode.removeChild(folder);
      if (files.parentNode) files.parentNode.removeChild(files);
    },
  };
}
