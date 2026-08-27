WILLOW Event System 4.2.117 — deployment folder
================================================

Contents
--------
index.html    the application (open this)
support.js    runtime required by index.html
standalone.html   optional single-file copy (no other files needed)

How to host
-----------
1. Upload the whole "willow-site" folder to your web host
   (public_html, /var/www/html, Netlify drop, GitHub Pages, S3 bucket, etc).
2. Point the domain / path at the folder. index.html is the entry point.
3. No build step, no server-side code, no database. Plain static hosting is enough.

Requirements
------------
- Any static web host or local double-click. No PHP/Node needed.
- Must be served over http(s) or opened from disk; keep index.html and
  support.js together in the same directory.

Sign on
-------
Operator: pick from the list        PIN: 1234

Data storage
------------
Settings, colour scheme, events, media list and game state are stored in the
browser's local storage on each terminal, under the key "willow.state.v1".
Clearing local data (Settings > Advanced) resets the terminal to defaults.

Modes
-----
Ents      rolling adverts from the advertising media folder, music continues
Bingo     random 1-90 draw, room codes, multi-room linked games
Karaoke   lyric engine, singer queue, key/tempo, instrumental library
BiGD      legacy equipment feed reformatted to venue screens
Games     Quiz, Higher or Lower, At The Races

Screens
-------
Sidebar > Show opens the full-screen output window for the current mode.
Esc closes it. Blackout mutes all screen output.

Colour scheme
-------------
Settings > Colours. Five presets plus per-element colour pickers
(window face, bevels, title bar, selection, fields, accent, screen colours).
