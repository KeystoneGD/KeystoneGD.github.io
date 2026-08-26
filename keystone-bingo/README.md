# Palace Bingo

A 90-ball bingo hall that runs entirely on GitHub Pages. No server, no database, no
accounts. The host signs in, opens a room, and reads out a five-character code; everyone
else types their name and that code and takes a seat.

- **Proper 90-ball tickets.** Six to a sheet, fifteen numbers each, all ninety across the
  six, columns in range — the real strip layout, not a random grid.
- **Manual dabbing.** Nothing marks itself. Claim while the winning ball is still up or
  the prize has gone, same as the hall.
- **Verified claims.** A claim carries the ticket's seed. The host's page rebuilds that
  exact sheet from it and checks it against the numbers actually called, then shows
  valid or not, which ticket, which rows, which ball.
- **One line → two lines → full house**, called continuously through one game.
- **The caller's voice**, nicknames and all, if you want it.

---

## 1. Put it online

1. Create a repository and drop these files in at the top level.
2. **Settings → Pages → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Wait a minute. Your site is at `https://<you>.github.io/<repo>/`.

The `.nojekyll` file is there on purpose — it stops GitHub's build step from touching
anything.

## 2. Fit the lock

The host page has no password until you set one.

1. Open `set-password.html` on the published site.
2. Type the username and password you want. Long beats clever: four or five unrelated
   words is stronger than one word with symbols jammed into it.
3. Copy the block it produces over the whole of `js/credentials.js` and push.

Your password is not in that block. What ships is a random salt and a short token that
only the right username and password can decrypt (PBKDF2-HMAC-SHA256, 310,000 rounds,
AES-GCM). Lose the password and there is nothing to recover — generate a new lock.

`set-password.html` needs a secure page for the browser's crypto API, so open it over
`https` on the published site or over `http://localhost` — not as a `file://` page.

### What this login is and isn't

GitHub Pages serves static files. There is no server to check a password against, so the
check happens in the visitor's browser, and someone who downloads the page can run offline
guesses against the stored token. 310,000 rounds makes each guess slow — a long
passphrase holds up, `bingo123` does not.

The thing that actually protects a game in progress is not the password: a room only
exists inside the host's open tab. Someone who forced their way past the sign-in gets an
empty room of their own on their own screen. They cannot join yours, call numbers in it,
or award anything in it.

If you want a real server-side check later, the honest upgrade is a small serverless
function (Cloudflare Workers, Netlify, Vercel) that holds the hash and returns a signed
token. Nothing else here would need to change.

## 3. Run a game

**Host** — open `host.html`, sign in. The room opens by itself and shows a code.

| Control | What it does |
| --- | --- |
| Copy join link | A link with the room code already in it |
| Start game | Deals everyone a fresh sheet and starts the caller a few seconds later |
| Call speed | 4 to 15 seconds a ball |
| Pause for a check | Freezes the caller; happens automatically when a valid claim lands |
| Award & next stage | Awards the top valid claim and moves to the next prize |
| Check a code by hand | For anyone on a watch link |

**Players** — open the site, type a name and the room code, and dab. When a pattern
completes, **BINGO** lights up until the next ball. Pressing it sends the claim straight
to the host, who sees it verified within a second.

### If someone can't connect

Players join over WebRTC through PeerJS's free public broker. A few networks block it.
For those, **Copy watch link** hands out a link carrying the game itself: they play in
lockstep from their own clock, and claim by reading out the code their page gives them,
which the host types into *Check a code by hand*. Same verification, slower ceremony.

The room lives in the host's tab. Close it and the game ends — reopening deals a new one.

## 4. Working on it locally

ES modules don't load from `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# then http://localhost:8000
```

`localhost` counts as a secure context, so sign-in and `set-password.html` both work.

## Files

```
index.html          the hall — join screen, then the player's sheet
host.html           the caller's box — sign-in, then the console
set-password.html   generates the credentials blob; nothing leaves the page
js/bingo.js         tickets, the shuffle, win detection, claim codes — no DOM, no network
js/ui.js            shared rendering for both pages
js/net.js           the wire: room codes, host peer, guest peer
js/auth.js          the sign-in check
js/credentials.js   your generated lock — the only file you edit after deploying
css/styles.css      the whole look
```

## Making it yours

- **Name** — `Palace Bingo` appears in each page's `<title>` and `.brand h1`.
- **Colours** — the `:root` block at the top of `styles.css`. It's one committed dark
  palette: `--brass`, `--paper`, `--felt`, and `--dab` for the default dabber.
- **Prizes** — the three stages are `STAGES` in `js/bingo.js` and the `#prizes` list in
  both HTML files. Changing the pattern rules means editing `evaluate()` and
  `verifyClaim()` together, since the host re-checks every claim independently.
- **Calls** — the nicknames are `NICK` in `js/bingo.js`, indexed 1 to 90.
- **Call speeds** — the `#hSpeed` options in `host.html`.

## Credits

Bingo call nicknames are traditional. PeerJS is loaded from unpkg at a pinned version; if
you'd rather not depend on a CDN, vendor `peerjs.min.js` into the repo and point
`PEERJS_SRC` in `js/net.js` at your copy.
