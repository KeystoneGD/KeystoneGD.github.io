# WILLOW Event System 4.2.117

Venue event, music and games control with a patron-facing screen output and a
patron phone site. Static site — no server-side code, no build step, no
database.

---

## Which folder do I use?

**Use `willow-project/`.** That is the real, editable site: separate HTML pages,
config files you can edit, and the folder you upload to your host.

`willow-site/` and the root `WILLOW Event System (standalone).html` are the
earlier single-file versions. They still open and demo, but they have **no
patron site, no real music playback and no editable config**. Keep them as a
backup if you like; everything from here on refers to `willow-project/`.

---

## Contents

```
index.html        Operator sign-on (entry point)
console.html      Operator console — all modes
display.html      Venue screen output (open one per screen, F11 = full screen)
interact.html     Patron site — bingo tickets, shoutouts, photo uploads
css/
  willow.css      Complete classic-desktop skin, driven by CSS variables
js/
  config.js       SITE CONFIG — venue, operators/PINs, rooms, paths, presets,
                  Spotify credentials, patron-site transport
  data.js         CONTENT — adverts, events, karaoke library, quiz, race card,
                  music beds
  store.js        Console state + localStorage + cross-window sync
  net.js          Patron traffic transport (local or REST relay) + card maths
  music.js        Real music playback — local files + Spotify Web Playback
  theme.js        Colour scheme application
  console.js      Console UI and all mode logic
  display.js      Screen output renderer
  interact.js     Patron site logic
.nojekyll         Lets GitHub Pages serve files/folders beginning with _
```

---

## 1. Put it online

Upload the **contents of `willow-project/`** to any static host, so that
`index.html` sits at the root of the site.

| Host | Steps |
| --- | --- |
| GitHub Pages | New repo → upload the files → Settings ▸ Pages ▸ deploy from `main` / root |
| Netlify / Vercel | Drag the folder onto the dashboard, no build command |
| Cloudflare Pages | Create project ▸ Direct upload |
| Venue web space | FTP the folder into `public_html` |
| Local only | Serve it — `python3 -m http.server 8000` in the folder, then `http://127.0.0.1:8000`. Do **not** open the files with `file://`; Spotify and some browser features refuse to run |

**Serve over HTTPS.** Phones need it for camera/photo access, and Spotify will
not authorise an `http://` address (except `http://127.0.0.1`).

### Optional: the short `/interact` address

Patrons find `yoursite.com/interact` easier than `interact.html`. Either
create a folder `interact/` containing a copy of `interact.html` renamed to
`index.html`, or add a host rewrite:

* Netlify — `_redirects` file: `/interact  /interact.html  200`
* Cloudflare Pages — `_redirects`, same line
* Apache — `.htaccess`: `RewriteRule ^interact$ interact.html [L]`

Then set `interact.path` in `js/config.js` to `'interact'` so the console shows
patrons the short address.

---

## 2. Set up the venue (`js/config.js`)

This is the only file most venues need to edit. Everything is read at boot;
operator changes made in Settings are saved per terminal and win over these
defaults (Settings ▸ Advanced ▸ Clear Local Data restores the file values).

| Key | What to change |
| --- | --- |
| `venueName`, `licence`, `joinDomain` | Shown on the console, screens and patron site |
| `operators` | Operator names and **sign-on PINs** — change from `1234` before going live |
| `rooms` | Room names, board codes, seat counts |
| `paths` | The folder paths shown in the UI (advertising, karaoke, music, exports) |
| `display` | Screen resolutions, how many outputs, idle-screen flags |
| `bingo` | Ball count, patterns, default prize, auto-call speed, which rooms link by default |
| `bigd` | Equipment source list, protocol, frame mapping |
| `music` | Sources, zones, playlists, default volume, ducking, **Spotify credentials** |
| `interact` | Patron-site transport, endpoint, photo size, what is open by default |
| `presets` / `defaultPreset` | Colour schemes |
| `modes` | Which modes appear in menus and Mode Control |

Content — adverts, events, karaoke songs and lyrics, quiz questions, race
runners, music beds, report rows, bingo nicknames — lives in `js/data.js`.

**PINs are terminal gates only.** They are client-side and do not protect money
or licensed play.

---

## 3. Run a session

1. Open `index.html`, pick an operator, enter the PIN.
2. **Screens ▸ Open Screen Output** (or `F11`) once per venue screen. Drag each
   window to its monitor and press `F11` for full screen. Any number can be
   open at once; they all follow the console live.
3. Pick a mode — Ents, Bingo, Karaoke, BiGD, Rich Media Games, Interactions.
4. `F12` blacks out every screen instantly.

Console and screens talk over `BroadcastChannel`, falling back to the
localStorage `storage` event, so **all windows must be on the same machine and
browser profile**. For screens on other PCs, run a console on each, or replace
`js/store.js` with a version backed by your own API.

### Keyboard

| Key | Action |
| --- | --- |
| `F2` | Event schedule |
| `F4` | Media folder manager |
| `F5` | Music control |
| `F6` | Interactions |
| `F9` | Reports |
| `F11` | Open screen output |
| `F12` | Blackout toggle |
| `Ctrl+N` | New event |
| `Ctrl+L` | Sign off |
| `Esc` | Close menus and dialogs |

---

## 4. Modes

| Mode | What it does |
| --- | --- |
| Ents | Rolling advert display from the media folder, with ticker and dwell control |
| Bingo | Linked random draw, board, pattern, prize, room codes, **connected players and ticket checks** |
| Karaoke | Singer queue and the synced lyric engine |
| BiGD | Bingo Information Graphical Display — big-digit board fed by equipment |
| Rich Media Games | Quiz, Higher or Lower, At The Races |
| Interactions | Patron shoutouts and photo wall on the screens |

---

## 5. Music — real playback

Music Control (`F5`) drives a real player. Audio comes out of the **console**
window, so route that machine's output to the amp. Browsers block audio until
the operator clicks — the first **PLAY** press unlocks it. Ducking dips the bed
to 25% while a bingo call goes out (tick *Duck music on bingo call / mic*).

### Local files — works immediately, no accounts

* Music Control ▸ **Local files** ▸ `Load music folder…` and pick the venue
  music folder on the operator PC. Files never leave the machine. The pick has
  to be repeated after a console restart — browsers do not allow silent folder
  access.
* Or host the audio with the site and add a `src` to each entry in `js/data.js`
  ▸ `tracks[]`, e.g. `src:'media/music/bed01.mp3'`. Those load automatically
  with nothing to pick.
* Filenames like `Artist - Title.mp3` split into artist and title.

### Linking Spotify

In-browser Spotify playback needs a **Spotify Premium** account and a free app
registration. Five minutes, once:

1. Go to <https://developer.spotify.com/dashboard> ▸ **Create app** (any name,
   e.g. "WILLOW Console").
2. Add a **Redirect URI** that exactly matches your console URL, e.g.
   `https://yoursite.com/console.html`. Spotify accepts `https://` only, or
   `http://127.0.0.1:8000/console.html` for local testing — `file://` and
   `localhost` are refused. The console prints the exact URI to paste.
3. Tick **Web Playback SDK** as the API in use, and save.
4. Copy the **Client ID**. Put it either in `js/config.js` ▸
   `music.spotify.clientId` (all terminals) or in the **Client ID** box in
   Music Control (this terminal only), then press **Save**.
5. Music Control ▸ source **Spotify (linked)** ▸ **Link Spotify account**. You
   approve on Spotify and land back on the console, linked.
6. Optional: map playlist names to Spotify URIs in `js/config.js` ▸
   `music.spotify.playlists` (in Spotify: right-click a playlist ▸ Share ▸ Copy
   Spotify URI, e.g. `spotify:playlist:37i9dQZF1DXcBWIGoYBM5M`). With a URI
   set, choosing that playlist and pressing PLAY starts it; with none set, PLAY
   resumes whatever the account last played.

The console registers itself as a Spotify device (`WILLOW Console`) and takes
over playback; transport, volume and ducking act on the live session. A
non-Premium account reports an account error and will not play — use local
files. Tokens are obtained with PKCE and stored in `localStorage`
(`willow.spotify.token`) on that terminal; no client secret exists anywhere in
the site. **Unlink** clears them.

---

## 6. Patron site (`interact.html`)

Patrons open `yoursite.com/interact.html` (or `/interact`) on their phones,
enter a name and the room code shown on the screens, and get three tabs:

* **Bingo** — when the operator opens sales they take a real 90-ball strip
  ticket with a **ticket serial** printed at the top. It marks itself as
  numbers are called and tells them how many they are off a claim. Claiming
  sends the claim to the console.
* **Shoutout** — up to 120 characters, queued for operator approval.
* **Photo** — camera or gallery, downscaled on the phone, queued for approval.

### Operator side — where things live

**Bingo Mode ▸ Player Join & Tickets** is the bingo half:

* **Sales open** tick — until this is on, patrons cannot take a ticket.
* Connected player list: name, room, ticket state, and **To go** — how many
  numbers that ticket needs for the pattern in play (`CLAIM` at zero,
  highlighted at one).
* `[i]` on a player shows their **ticket serial**, game, distance from a claim,
  and the **Drop** / **Ban** buttons.
* **Claim check** — type the serial the patron reads off their ticket: you get
  marked count, completed lines, whether the claim is valid for the pattern in
  play, and exactly which numbers are still missing.

**Interactions (`F6`)** is only shoutouts and photos: accept/decline toggles,
what the screens show (Both / Shoutouts / Photos), the approval queue, what is
live on screen with a **pull** link, the join address, and the ban list.
Pressing **Check** on a bingo claim in the queue runs the same serial lookup
and reports the verdict.

**Drop** ends that device's session, withdraws its ticket and tells the patron
why; they can rejoin. **Ban** blocks the device for 10 minutes, 1 hour, the
rest of tonight, or permanently — banned devices see a blocked screen and their
submissions stop reaching the queue. Bans are listed with a **Lift** button.

### Making the patron site work on real phones

`js/config.js` ▸ `interact.transport`:

* `'local'` (default) — console, screens and patron page in **one browser
  profile** on one machine. The whole flow works end to end; use it to
  rehearse, or for venue tablets on that profile.
* `'rest'` — real phones. Set `interact.endpoint` to a tiny JSON relay you
  control (Cloudflare Worker, Supabase REST table, Firebase RTDB REST, a
  20-line Node or PHP script). The contract is one GET and four POST ops,
  documented at the top of `js/net.js`. Nothing else in the site changes.

Photos travel as downscaled JPEG data URLs (`interact.photoMaxPx`,
`photoQuality`), so a relay only has to store JSON.

---

## 7. Colour scheme

Settings ▸ Colours. Six presets plus a colour picker for every element —
window face, bevels, title bar, selection, fields, accent, screen background
and text, desktop backdrop. Editing any slot creates a **Custom** scheme. Add
your own presets in `js/config.js` ▸ `presets`, and choose which slots are
editable with `themeLabels`. The scheme applies to the console and the venue
screens at once.

---

## 8. Data storage

Console state lives in `localStorage` under `willow.state.v1` per terminal —
settings, colour scheme, events, media list, singer queue, game state. Patron
traffic lives under `willow.interact.v1` (local transport). Settings ▸ Advanced
▸ **Clear Local Data** restores `js/config.js` / `js/data.js` values;
Interactions ▸ **Clear all patron traffic** wipes the patron feed.

Because state is per-browser, each terminal keeps its own copy. To share state
across machines, replace `js/store.js` with a version that reads/writes your
own API — nothing else needs to change.

---

## 9. Notes for going live

* Change the operator PINs in `js/config.js`.
* Advertising files are listed by name and the screen shows the caption. Point
  the tile/preview at your real media URLs in `js/display.js` and
  `js/console.js` (search for `caption`).
* BiGD shows a simulated frame monitor. A real serial/TCP bridge should POST
  frames to a small local service that writes them into the store.
* Bingo draws use `Math.random()`. For licensed play, replace `callNumber()`
  with your certified RNG or the equipment feed.
* Patron tickets are generated on the phone from the device id, so a serial is
  reproducible and checkable on the console. For money games, issue tickets
  from your licensed system and keep the serial column.
* Moderate photos and shoutouts before they hit the screens — the queue exists
  for that reason; `interact.autoApproveShoutouts` is off by default.
