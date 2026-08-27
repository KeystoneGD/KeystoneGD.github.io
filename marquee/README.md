# Marquee Event System

A venue bingo system in three screens: an **operator console** you drive with a finger, a
**room display** for the big screen, and a **phone page** for anyone playing along. Static
files only — it runs on GitHub Pages with nothing behind it.

Built after the shape of Willow Event: the caller works a touchscreen, the room watches a
graphical display, and a game manager builds each game before it goes on the board.

```
console.html   the caller's box — game manager, calling, validation, media, quiz, report
display.html   the room screen — flashboard, current call, prizes, winner cards, slides
index.html     the phone — a book of six tickets, dab and claim
```

---

## Getting it up

1. Put these files in a repo, **Settings → Pages → deploy from `main`, `/ (root)`**.
2. Open `set-password.html` — either on the live site or by double-clicking it in the
   folder; it carries its own crypto and needs nothing else. Create the first **admin**,
   copy the block it gives you over the whole of `js/credentials.js`, and push.
3. Open `console.html`, sign in, and press **Open display**. Drag that window to the big
   screen and press F11.

More operators are added from the console itself — see *Who can sign in* below.

The `.nojekyll` file stops GitHub's build step touching anything.

The other three pages are ES modules, so they need to be served — from GitHub Pages, or
locally with `python3 -m http.server 8000` and `http://localhost:8000`. Only
`set-password.html` works straight off the disk.

## Running a session

**Build a game.** *New game* opens the builder: name it, set the prizes in order (one
line, two lines, full house — add or remove as many as you like), pick auto or manual
calling and the speed, and say whether the full house is playing for the jackpot. Save any
setup as a preset and fire it off in two taps next time.

Each prize is either **cash** or a **thing**. Flick the switch on the row: cash takes an
amount, a prize takes a description — *Bottle of fizz*, *Meat tray*, *Bar tab*. The
display, the phones and the report all say the right one, and the session totals only add
up the cash.

**Eyes down.** The game goes on the board with a countdown, the display shows the prize
rail, and calling starts by itself when the clock runs out.

**Call.** Auto calls every few seconds; *Call next* pulls one early. Switch to **manual**
and a 1–90 pad appears — tap whatever your physical machine drew and the whole system
follows. *Undo call* takes back a misheard ball on every screen at once.

**Check a claim.** Two ways in:

- *Someone on a phone* presses BINGO. The claim arrives already validated — name, book,
  ticket, which ball completed it — the caller stops, and the display shows CHECK. Press
  **Award**.
- *Someone with a paper book* shouts. Press **Check** to stop the caller, type their book
  number, and the console rebuilds their exact six tickets, marks off what's been called,
  and tells you whether they're on — and if not, how far off they are.

**Award, and on to the next prize.** The display shows the winner card, then *Next prize*
carries the same game on to two lines and the full house.

**Anyone can shout, and be wrong.** The BINGO button on a phone is live whenever a prize
is — it only glows when they're genuinely on. A false call stops the caller, tells the
room, and goes on that player's tally. *Back to play* starts the caller again.

### The room board

Down the right of the Bingo pane, everyone in the room with where they stand — closest
first, because the console knows every book from the perm:

| | |
| --- | --- |
| grey | playing, with how many they need |
| amber edge | one away, and **the numbers they're waiting on** |
| **yellow** | claim in, waiting for you |
| **green** | called it, and got it |
| **red** | missed it, or called falsely |

The header line says what the whole room is sitting on — *waiting on 74 ×3, 83 ×3*.

Tap anyone to open their card: where they stand, their false-call tally, and

- **Drop** — frees their book, leaves them connected
- **Kick out** — puts them out of the room; they can come back
- **Bar** — puts them out and refuses them at the door until you let them back in

## How a book number can be checked at all

Every session has a **perm** — one number the whole book range is generated from. Book
4172 under a given perm is always the same six tickets, on the console, on a phone, on a
printout. That is what makes validation honest: the caller isn't taking anyone's word for
what their ticket says, the console rebuilds it and checks it against the numbers actually
called.

It also gives you the thing a club system does that nothing else can — because every book
in the range is known, the console scans the whole room after each ball and the display
can say **318 on one to go**. Set the range in Setup to however many books are actually
out.

*New perm* in Setup reissues every book in the room. Between games only.

## The other modules

**Media** — slides for the display between games, plus a ticker along the bottom that
shows on every screen the moment you type it. *Show now* puts a particular slide up.

**Games** — a Quickfire quiz round the console runs on the display: question and four
answers on the big screen, players answer on their phones, *Reveal* scores it and the
leaderboard updates. Edit the questions in the same pane.

**Report** — games played, prizes paid, jackpot paid, who won what in how many calls.
Export as CSV or print it.

## The two ways screens connect

| | how | needs internet |
| --- | --- | --- |
| Display on the same machine | direct browser channel | no |
| Display somewhere else | room code | yes |
| Phones | room code | yes |

A display opened from the console's own button talks to it directly and keeps working with
the network unplugged — the console and the big screen are a closed system. Phones and
remote displays join by the five-character room code, over WebRTC through PeerJS's free
public broker. If that's blocked on someone's network they simply can't join; the game
itself is unaffected.

The session lives in the console tab, and is saved as you go — reload it and the game,
the seats and the report are all still there. Close it and the room ends.

## Keyboard, for a caller in a hurry

| key | does |
| --- | --- |
| `space` | whatever the big button says — eyes down, call next, next prize |
| `p` | pause / resume |
| `c` | check / back to play |

## What this is not

This is not a licensed gaming system. There's no certified RNG, no cash handling, no
Gambling Commission approval, and nothing here meets RTS technical standards. Prize
amounts are bookkeeping so the display and the report can show them — for a club night,
a holiday park social, a fundraiser, a roleplay server. If you ever want to run real cash
bingo you need certified equipment and a licence, and none of that starts here.

The operator sign-in is a client-side lock: PBKDF2 with a salt per operator, so no
password is in the files, but the check happens in the visitor's browser and a determined
person could grind guesses against it offline. Use long passphrases. Roles decide what
each operator sees, not what they could reach if they went digging in the source — treat
them as a way of keeping people out of each other's way, not as a security boundary.

The thing that actually protects a live session is that the room only exists inside the
operator's open tab. Somebody past the sign-in gets an empty console of their own, never
yours.

## Files

```
console.html  display.html  index.html  set-password.html
css/base.css        tokens, buttons, the ball, the flashboard
css/console.css     the operator surface
css/display.css     the room screen, sized in vmin so it fits any TV
css/player.css      the phone
js/core.js          books, perms, the shuffle, win detection, validation, room scan
js/session.js       the session model — every state change lives here
js/bus.js           the wire: local channel + WebRTC
js/console.js       the caller's box
js/display.js       the room screen
js/player.js        the phone
js/auth.js          the sign-in check, roles and what each one may touch
js/credentials.js   your operators — the only file you edit after deploying
test-core.mjs       node test-core.mjs — proves the engine before you trust it
```

`test-core.mjs` checks fifteen hundred books for legality, that the same perm always
produces the same tickets, that "how many to go" agrees with brute force, that a claim one
ball early is refused, and that the room scan matches a slow correct count. Run it after
touching anything in `core.js`.

## Making it yours

- **Name** — the venue name is in Setup, and shows across the top of the display.
- **Colours** — `:root` at the top of `css/base.css`. `--amber` is the house colour.
- **Bingo calls** — `NICK` in `js/core.js`, indexed 1 to 90.
- **Prize types** — `STAGE_TYPES` in `js/core.js`. Adding one means teaching `toGo` what
  completing it looks like; everything else follows from that single function.
- **Call speeds** — the `#bxSpeed` options in `console.html`.
