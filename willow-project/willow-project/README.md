# WILLOW Event System 4.2.117

Venue event, music and games control with a patron-facing screen output.
Static site — no server-side code, no build step, no database.

## Contents

```
index.html        Operator sign-on (entry point)
console.html      Operator console — all modes
display.html      Venue screen output (open one per screen, F11 = full screen)
css/
  willow.css      Complete classic-desktop skin, driven by CSS variables
js/
  config.js       SITE CONFIG — venue, operators/PINs, rooms, paths, presets
  data.js         CONTENT — adverts, events, karaoke library, quiz, race card
  store.js        State + localStorage persistence + cross-window sync
  music.js        Real music playback — local files + Spotify Web Playback
  theme.js        Colour scheme application
  console.js      Console UI and all mode logic
  display.js      Screen output renderer
.nojekyll         Lets GitHub Pages serve files/folders beginning with _
```

## Hosting

Upload the whole folder to any static host and point the domain at it.
`index.html` is the entry point.

* **cPanel / shared hosting** — drop the folder contents into `public_html`.
* **IIS / Windows Server** — copy into the site root; no handler mapping needed.
* **GitHub Pages** — push to a repo, Settings ▸ Pages ▸ deploy from branch (root).
  `.nojekyll` is already included.
* **Netlify / Vercel / Cloudflare Pages** — drag-and-drop, no build command.
* **Local / kiosk** — double-click `index.html`, or serve with
  `python -m http.server` from this folder.

Serve over HTTPS if the venue screens are on other machines.

## Sign on

Operators and PINs are defined in `js/config.js` (`operators: []`).
Default PIN for all three seeded operators is **1234**. Change these before
going live — they are client-side only and gate the terminal, not real money.

## Running the venue screen

1. Sign on to the console.
2. Sidebar ▸ **Show**, or Screens ▸ Open Screen Output (F11), or open
   `display.html` directly on the screen PC.
3. Drag the window to the venue display and press **F11**.
4. **Blackout** mutes all screen output instantly.

The console is the master. `display.html` is a read-only renderer and follows
mode, calls, lyrics, adverts and colours live via BroadcastChannel, falling back
to the localStorage `storage` event. Multiple screens can be open at once.

## Modes

| Mode | What it does |
| --- | --- |
| **Ents** | Rolling adverts from the advertising media folder with per-file dwell, transition, optional event ticker; music keeps playing |
| **Bingo** | Random 1–90 draw, traditional calls, patterns, prize, auto-call, player join codes, multi-room linked games |
| **Karaoke** | Lyric engine (5-line scroll), singer queue, key and tempo, instrumental library |
| **BiGD** | Bingo Information Graphical Display — interprets legacy/modern equipment frames and reformats them onto venue screens |
| **Rich Media Games** | Quiz with team scoring, Higher or Lower, At The Races with tote and simulated run |

Keyboard: **Space** calls the next bingo number, **F2** schedule, **F4** media,
**F5** music, **F9** reports, **F11** screen output, **F12** blackout,
**Esc** closes menus and dialogs.

## Configuring the venue

Edit `js/config.js`:

* `venueName`, `licence`, `joinDomain`
* `operators` — names and PINs
* `rooms` — name, join code, player count (used by linked bingo)
* `paths` — the UNC paths shown in the UI for advertising / karaoke / music
* `display` — resolutions, screen count, burn-in and overlay flags
* `ents`, `bingo`, `bigd`, `music` — mode defaults
* `presets` — colour schemes offered in Settings ▸ Colours

Edit `js/data.js` for content: advertising files and captions, the seed event
schedule, karaoke library (title, artist, key, `lines[]`), quiz bank, race card,
music beds, report rows and the bingo call nicknames.

## Colour scheme

Settings ▸ Colours. Six presets plus a colour picker for every element
(window face, bevel highlight/shadow/outline, window text, title bar left/right,
title bar text, selection, field background/text, accent, screen background/text,
desktop backdrop). Any individual change becomes the "Custom" scheme.
Everything is driven by CSS custom properties in `css/willow.css`, so a scheme
applies to the console and the venue screens at once.

## Data storage

State lives in `localStorage` under `willow.state.v1` on each terminal —
settings, colour scheme, events, media list, singer queue and game state.
Settings ▸ Advanced ▸ **Clear Local Data** restores the values in
`js/config.js` / `js/data.js`.

Because state is per-browser, each terminal keeps its own copy. To share state
across machines, replace `js/store.js` with a version that reads/writes your
own API — nothing else needs to change.

## Music — real playback

Music Control (**F5**) drives a real player in `js/music.js`. Audio comes out of
the **console** window, so route that machine's output to the amp. Browsers
block audio until the operator clicks — the first **PLAY** press unlocks it.

### Local files (works immediately, no accounts)

* Music Control ▸ **Local files** ▸ `Load music folder...` — pick the venue
  music folder on the operator PC. Files never leave the machine; the picker
  has to be repeated after a console restart (browser security).
* Or host the audio with the site and add a `src` to each entry in
  `js/data.js` ▸ `tracks[]`, e.g. `src:'media/music/bed01.mp3'`. Those load
  automatically with no picking.
* Filenames like `Artist - Title.mp3` split into artist and title.

### Linking Spotify

In-browser Spotify playback needs a **Spotify Premium** account and a free app
registration. Five minutes, once:

1. Go to <https://developer.spotify.com/dashboard> and **Create app**
   (any name, e.g. "WILLOW Console").
2. In the app settings, add a **Redirect URI** that exactly matches the console
   URL, e.g. `https://your-site/console.html`. Spotify only accepts `https://`
   URLs, or `http://127.0.0.1:PORT/console.html` for local testing —
   `file://` and `localhost` will be refused.
3. Tick **Web Playback SDK** as the API in use, and save.
4. Copy the **Client ID**. Either paste it into `js/config.js` ▸
   `music.spotify.clientId` (applies to every terminal) or into the
   **Client ID** box in Music Control (saved on that terminal only).
5. Music Control ▸ source **Spotify (linked)** ▸ **Link Spotify account**.
   You are sent to Spotify, approve, and land back on the console linked.
   The console shows the exact redirect URI to paste into step 2.
6. Optional: map each playlist name to a Spotify URI in `js/config.js` ▸
   `music.spotify.playlists` (right-click a playlist in Spotify ▸ Share ▸
   Copy Spotify URI, e.g. `spotify:playlist:37i9dQZF1DXcBWIGoYBM5M`). With a
   URI set, choosing that playlist and pressing PLAY starts it. With none set,
   PLAY resumes whatever the account was last playing.

The console registers itself as a Spotify device (`WILLOW Console`) and takes
over playback. Transport, volume and ducking all act on the live Spotify
session. If the account is not Premium the SDK reports an account error and
playback will not start — use local files instead.

**Token storage:** the access/refresh tokens live in `localStorage`
(`willow.spotify.token`) on the operator terminal, obtained with PKCE, so no
client secret is stored anywhere in the site. **Unlink** in Music Control
clears them.

## Notes for going live

* Advertising files are listed by name; the screen shows the caption. Wire the
  real images by pointing the tile/preview at your media URLs in
  `js/display.js` and `js/console.js` (search for `caption`).
* Music transport is live (`js/music.js`) — local files and Spotify Web
  Playback. Ducking dips the bed to 25% while a call or the mic is open.
* BiGD shows a simulated frame monitor. A real serial/TCP bridge should POST
  frames to a small local service and write them into the store.
* Bingo draws use `Math.random()`. For licensed play, replace `callNumber()`
  with your certified RNG or the equipment feed.
