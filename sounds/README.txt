sounds/README.txt - OWNER: AUDIO   STATUS: IMPLEMENTED (documentation only)

OPTIONAL DROP-IN FOLDER FOR YOUR OWN COPIES OF THE ORIGINAL GAME SOUNDS
=======================================================================

This replica does not ship, bundle or commit any of the original game's audio. The sound effects and the music of
"3D Pinball for Windows - Space Cadet" belong to their owners (Microsoft / Cinematronics / Maxis).
If you own a copy of the game you can let this replica play YOUR files:

  1. Find your Pinball folder, e.g.  C:\Program Files\Windows NT\Pinball\   (Windows 2000 / ME / XP install)
     or the folder you unpacked from your own copy of the game.
  2. Copy the SOUND*.WAV files (SOUND1.WAV, SOUND3.WAV, SOUND4.WAV ... SOUND131.WAV) into THIS folder (sounds/).
     Optional music: also copy PINBALL.MID here (music stays OFF until you switch it on in the Options menu).
     File names may be upper or lower case (SOUND49D.WAV or sound49d.wav). Do not rename them.
     Do NOT copy PINBALL2.MID (it is a bitmap font, not music) or any other file.
  3. Serve the project (python -m http.server 8765 from the project root) and click Start with sound enabled.

What happens at start (per file, first match wins):
  1. an earlier validated copy cached in your own browser (IndexedDB),
  2. this folder:  ./sounds/SOUND1.WAV (then ./sounds/sound1.wav),
  3. the Internet Archive copy of the game (two routes),
  4. otherwise nothing: use "Load My Sounds..." in the Options menu (or the link on the start screen) to pick your own
     Pinball folder or zip file, or drag the folder / zip onto the page.

Every file is checked by exact size and SHA-1 against the original game's files. A file that does not match
(another edition, a damaged copy, an HTML error page) is ignored, never played. If a folder is empty or a file is missing, the
game simply runs without that sound; gameplay timing is identical with or without sound because every sound duration comes
from a built-in table, never from the audio itself.

Six sounds were never shipped with the original game (SOUND2, SOUND37, SOUND44, SOUND52, SOUND59, SOUND62); they are silent in
the original too and are never requested.

This folder may stay empty. Files you put here are for your own use on your own machine - do not commit or redistribute them.
