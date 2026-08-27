/* Marquee Event System — core engine.

   No DOM, no network, no clock. Everything here is a pure function of the session
   perm seed and the numbers actually called, which is what makes validation trustworthy:
   the console can rebuild any book in the range from its number alone and check a claim
   against the real call list, whether the ticket is on a phone or on paper.

   Terms, as a bingo club uses them:
     BOOK   one player's set of six tickets, identified by a book number
     PERM   the seed the whole session's books are generated from; same perm, same books
     TICKET 3 rows x 9 columns, fifteen numbers, five to a row
     STAGE  a prize within one game: a line, two lines, the full house
     SHARP  a ticket one number away from winning the current stage
*/

export const STAGE_TYPES = {
  line: { key: "line", label: "One Line", rows: 1 },
  two: { key: "two", label: "Two Lines", rows: 2 },
  house: { key: "house", label: "Full House", rows: 3 },
};

export const NICK = ["", "Kelly's eye", "One little duck", "Cup of tea", "Knock at the door",
  "Man alive", "Half a dozen", "Lucky seven", "Garden gate", "Doctor's orders", "Downing Street",
  "Legs eleven", "One dozen", "Unlucky for some", "Valentine's Day", "Young and keen",
  "Sweet sixteen", "Dancing queen", "Coming of age", "Goodbye teens", "One score",
  "Royal salute", "Two little ducks", "Thee and me", "Two dozen", "Duck and dive",
  "Half a crown", "Gateway to heaven", "In a state", "Rise and shine", "Dirty Gertie",
  "Get up and run", "Buckle my shoe", "All the threes", "Ask for more", "Jump and jive",
  "Three dozen", "More than eleven", "Christmas cake", "Steps", "Life begins", "Time for fun",
  "Winnie the Pooh", "Down on your knees", "Droopy drawers", "Halfway there", "Up to tricks",
  "Four and seven", "Four dozen", "Nick nick", "Half a century", "Tweak of the thumb",
  "Danny La Rue", "Stuck in the tree", "Clean the floor", "Snakes alive", "Was she worth it",
  "Heinz varieties", "Make them wait", "Brighton line", "Five dozen", "Baker's bun",
  "Turn the screw", "Tickle me", "Almost retired", "Retirement age", "Clickety click",
  "Stairway to heaven", "Saving grace", "Favourite of mine", "Three score and ten",
  "Bang on the drum", "Six dozen", "Queen bee", "Hit the floor", "Strive and strive",
  "Trombones", "Two little crutches", "Thirty-nine more steps", "One more time",
  "Eight and blank", "Stop and run", "Straight on through", "Time for tea", "Seven dozen",
  "Staying alive", "Between the sticks", "Torquay in Devon", "Two fat ladies", "Nearly there",
  "Top of the shop"];

/* ------------------------------------------------------------------ random */

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

export function hash2(a, b) {
  let h = ((a >>> 0) ^ 0x9E3779B9) >>> 0;
  h = Math.imul(h ^ (((b >>> 0) + 0x85EBCA6B) >>> 0), 0xC2B2AE35) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0x27D4EB2D) >>> 0; h ^= h >>> 15;
  return h >>> 0;
}

export function rand32() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1;
  }
  return (Math.floor(Math.random() * 4294967295) >>> 0) || 1;
}

/* ------------------------------------------------------------------ books */

const COL_SIZE = [9, 10, 10, 10, 10, 10, 10, 10, 11];

/* THE RULE FOR EVERYTHING BELOW: a book number must mean the same six tickets on the
   caller's laptop and on every phone in the room, and those are different browsers with
   different JavaScript engines. So nothing in the generator may depend on *how* an engine
   does its work — only on what the spec guarantees.

   Two things break that rule, and both used to be in here:

     1. Calling rnd() inside a sort comparator. The spec never says how many times a
        comparator is called, so V8, JavaScriptCore and SpiderMonkey each draw a different
        number of random values and every ticket from that point on diverges.
     2. A comparator that returns 0 for two different items. Sorting is only stable for
        equal *comparisons*, and relying on that ordering is fragile — so ties are broken
        explicitly, by original position, and the order is then the only correct answer any
        algorithm can return.

   `pick` is the one place randomness enters, and it always draws exactly once. */

function order(list, weight) {
  return list
    .map((v, i) => ({ v, i, w: weight(v) }))
    .sort((a, b) => b.w - a.w || a.i - b.i)      // total: no two entries ever compare equal
    .map((x) => x.v);
}

function pick(list, rnd) { return list[Math.floor(rnd() * list.length)]; }

function columnCounts(rnd) {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const counts = [];
    for (let t = 0; t < 6; t++) counts.push([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const ticketLeft = [6, 6, 6, 6, 6, 6];
    const colLeft = COL_SIZE.map((n) => n - 6);
    let ok = true;
    for (const c of shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8], rnd)) {
      let need = colLeft[c], guard = 0;
      while (need > 0) {
        if (guard++ > 500) { ok = false; break; }
        const cands = [];
        for (let t = 0; t < 6; t++) if (counts[t][c] < 3 && ticketLeft[t] > 0) cands.push(t);
        if (!cands.length) { ok = false; break; }
        let top = -1;
        for (const t of cands) if (ticketLeft[t] > top) top = ticketLeft[t];
        const t = pick(cands.filter((x) => ticketLeft[x] === top), rnd);
        counts[t][c]++; ticketLeft[t]--; need--;
      }
      if (!ok) break;
    }
    if (ok && ticketLeft.every((v) => v === 0)) return counts;
  }
  return null;
}

function rowLayout(counts, rnd) {
  for (let attempt = 0; attempt < 3000; attempt++) {
    const grid = [new Array(9).fill(false), new Array(9).fill(false), new Array(9).fill(false)];
    const rowLeft = [5, 5, 5];
    let ok = true;
    /* fullest columns first, ties settled by a shuffle that always costs eight draws */
    const cols = order(shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8], rnd), (c) => counts[c]);
    for (const c of cols) {
      const n = counts[c];
      let pool = order([0, 1, 2].filter((r) => rowLeft[r] > 0), (r) => rowLeft[r]);
      if (pool.length < n) { ok = false; break; }
      for (let k = 0; k < n; k++) {
        const top = rowLeft[pool[0]];
        const r = pick(pool.filter((x) => rowLeft[x] === top), rnd);
        grid[r][c] = true; rowLeft[r]--;
        pool = order(pool.filter((x) => x !== r), (x) => rowLeft[x]);
      }
    }
    if (ok && rowLeft.every((v) => v === 0)) return grid;
  }
  return null;
}

/* One book: six tickets, all ninety numbers across them. */
export function makeBook(seed) {
  const rnd = mulberry32(seed >>> 0);
  for (let attempt = 0; attempt < 60; attempt++) {
    const counts = columnCounts(rnd);
    if (!counts) continue;
    const grids = []; let ok = true;
    for (let t = 0; t < 6; t++) {
      const g = rowLayout(counts[t], rnd);
      if (!g) { ok = false; break; }
      grids.push(g);
    }
    if (!ok) continue;

    const pools = [];
    for (let c = 0; c < 9; c++) {
      const start = c === 0 ? 1 : c * 10;
      const end = c === 8 ? 90 : c * 10 + 9;
      const nums = [];
      for (let n = start; n <= end; n++) nums.push(n);
      pools.push(shuffle(nums, rnd));
    }
    const tickets = grids.map(() => [new Array(9).fill(null), new Array(9).fill(null), new Array(9).fill(null)]);
    for (let c = 0; c < 9; c++) {
      let idx = 0;
      for (let t = 0; t < 6; t++) {
        const take = pools[c].slice(idx, idx + counts[t][c]).sort((a, b) => a - b);
        idx += counts[t][c];
        let k = 0;
        for (let r = 0; r < 3; r++) if (grids[t][r][c]) tickets[t][r][c] = take[k++];
      }
    }
    return tickets;
  }
  return null;
}

/* The book a given number resolves to under this session's perm. Deterministic:
   the same perm and book number always produce the same six tickets, on any device. */
export function bookSeed(perm, bookNo) { return hash2(perm >>> 0, (bookNo | 0) + 0x9E37); }
export function bookFor(perm, bookNo) { return makeBook(bookSeed(perm, bookNo)); }

/* A short number every device can work out for itself from a fixed book. The console
   sends its own along with each seat; if a phone comes up with something different then
   that phone is not building the same tickets the caller is checking, and it says so
   rather than letting the mismatch turn up as an argument at the front desk. */
let FP = 0;
export function bookFingerprint() {
  if (FP) return FP;
  const b = bookFor(0x5EED1234, 1);
  let h = 0x811C9DC5 >>> 0;
  if (!b) return (FP = 1);
  for (let t = 0; t < 6; t++) for (const n of ticketNumbers(b[t])) h = hash2(h, n);
  return (FP = h >>> 0);
}

/* Flat list of a ticket's fifteen numbers, and of a whole book's ninety. */
export function ticketNumbers(ticket) {
  const out = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) if (ticket[r][c] != null) out.push(ticket[r][c]);
  return out;
}

/* ------------------------------------------------------------------ the caller */

export function callSequence(seed) {
  const nums = [];
  for (let n = 1; n <= 90; n++) nums.push(n);
  return shuffle(nums, mulberry32(((seed >>> 0) ^ 0x5BD1E995) >>> 0));
}

/* ------------------------------------------------------------------ winning */

export function rowsComplete(ticket, marked) {
  const done = [];
  for (let r = 0; r < 3; r++) {
    let all = true;
    for (let c = 0; c < 9; c++) {
      const v = ticket[r][c];
      if (v != null && !marked.has(v)) { all = false; break; }
    }
    if (all) done.push(r);
  }
  return done;
}

/* How many of a ticket's numbers for this stage are still to come.
   0 means it has won; 1 means it is sharp. */
export function toGo(ticket, marked, stageRows) {
  if (stageRows >= 3) {
    let left = 0;
    for (const n of ticketNumbers(ticket)) if (!marked.has(n)) left++;
    return left;
  }
  const perRow = [];
  for (let r = 0; r < 3; r++) {
    let left = 0;
    for (let c = 0; c < 9; c++) {
      const v = ticket[r][c];
      if (v != null && !marked.has(v)) left++;
    }
    perRow.push(left);
  }
  perRow.sort((a, b) => a - b);
  let sum = 0;
  for (let i = 0; i < stageRows; i++) sum += perRow[i];
  return sum;
}

/* The call index at which this ticket completes the stage, or -1 if it hasn't yet.
   `calls` is the real, ordered list of numbers the caller has drawn. */
export function winningCall(ticket, calls, stageRows) {
  const marked = new Set();
  for (let i = 0; i < calls.length; i++) {
    marked.add(calls[i]);
    if (toGo(ticket, marked, stageRows) === 0) return i;
  }
  return -1;
}

/* Which single numbers would finish this ticket off. Empty unless it is one away —
   that is what lets the console tell the caller who is waiting on what. */
export function needs(ticket, marked, stageRows) {
  if (toGo(ticket, marked, stageRows) !== 1) return [];
  const out = [];
  for (const n of ticketNumbers(ticket)) {
    if (marked.has(n)) continue;
    marked.add(n);
    const left = toGo(ticket, marked, stageRows);
    marked.delete(n);
    if (left === 0) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/* Where a whole book stands for the current prize: the closest ticket, how far off it
   is, whether it has already come on, and what it is waiting for. */
export function bookStanding(book, calls, stageRows) {
  const marked = new Set(calls);
  let best = 99, bestT = -1;
  for (let t = 0; t < 6; t++) {
    const g = toGo(book[t], marked, stageRows);
    if (g < best) { best = g; bestT = t; }
  }
  const out = { toGo: best, ticket: bestT, waitingOn: [], onSince: -1 };
  if (best === 1) out.waitingOn = needs(book[bestT], marked, stageRows);
  if (best === 0) out.onSince = winningCall(book[bestT], calls, stageRows);
  return out;
}

/* ------------------------------------------------------------------ validation */

/* Check one claim properly: rebuild the book from its number and test it against the
   numbers actually called. `atCall` is the call index the claim was made on; leave it
   undefined to check against everything called so far. */
export function validate(perm, bookNo, calls, stageRows, atCall) {
  const book = bookFor(perm, bookNo);
  if (!book) return { ok: false, reason: "no-book" };
  const limit = atCall == null ? calls.length : Math.min(calls.length, atCall + 1);
  const upTo = calls.slice(0, limit);
  const results = [];
  for (let t = 0; t < 6; t++) {
    const wc = winningCall(book[t], upTo, stageRows);
    results.push(wc);
  }
  let best = -1, bestTicket = -1;
  for (let t = 0; t < 6; t++) {
    if (results[t] < 0) continue;
    if (best < 0 || results[t] < best) { best = results[t]; bestTicket = t; }
  }
  if (bestTicket < 0) {
    const marked = new Set(upTo);
    let closest = 99, ct = -1;
    for (let t = 0; t < 6; t++) {
      const g = toGo(book[t], marked, stageRows);
      if (g < closest) { closest = g; ct = t; }
    }
    return { ok: false, reason: "not-on", toGo: closest, ticket: ct, book, checkedTo: limit };
  }
  const rows = rowsComplete(book[bestTicket], new Set(upTo.slice(0, best + 1)));
  return {
    ok: true, book, ticket: bestTicket, rows,
    call: best, number: calls[best], checkedTo: limit,
    late: atCall == null ? calls.length - 1 - best : 0,
  };
}

/* ------------------------------------------------------------------ sharps */

/* Scan every book in play and report how the room stands: how many tickets have won,
   how many are one number away, and which numbers would win it. This is what lets the
   display say "4 tickets on one to go" — the same trick a real club system uses, since
   every book in the range is known from the perm. */
export function scanRoom(perm, from, to, calls, stageRows, cache) {
  const marked = new Set(calls);
  let sharp = 0, won = 0, twoAway = 0;
  const winners = new Map();          // number -> how many tickets it would complete
  const store = cache || null;
  for (let b = from; b <= to; b++) {
    let book = store && store.get(b);
    if (!book) { book = bookFor(perm, b); if (store) store.set(b, book); }
    for (let t = 0; t < 6; t++) {
      const g = toGo(book[t], marked, stageRows);
      if (g === 0) { won++; continue; }
      if (g === 2) { twoAway++; continue; }
      if (g !== 1) continue;
      sharp++;
      /* which single number finishes it */
      const nums = stageRows >= 3
        ? ticketNumbers(book[t])
        : ticketNumbers(book[t]);
      for (const n of nums) {
        if (marked.has(n)) continue;
        marked.add(n);
        const nowGone = toGo(book[t], marked, stageRows);
        marked.delete(n);
        if (nowGone === 0) winners.set(n, (winners.get(n) || 0) + 1);
      }
    }
  }
  const hot = Array.from(winners.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return { sharp, won, twoAway, hot, books: to - from + 1, tickets: (to - from + 1) * 6 };
}

/* ------------------------------------------------------------------ money */

export function money(pence, symbol) {
  const s = symbol || "£";
  const p = Math.round(pence || 0);
  if (p === 0) return s + "0";
  return p % 100 === 0 ? s + (p / 100).toLocaleString() : s + (p / 100).toFixed(2);
}

/* A prize is either cash or a thing. One place decides how it reads, so the display,
   the phone and the report never disagree about what is being played for. */
export function prizeLabel(stage, currency) {
  if (!stage) return "";
  if (stage.kind === "prize") return String(stage.text || "Prize").trim() || "Prize";
  return money(stage.prize, currency);
}

export function isCash(stage) { return !stage || stage.kind !== "prize"; }

export function parseMoney(text) {
  const n = parseFloat(String(text).replace(/[^0-9.]/g, ""));
  return isFinite(n) ? Math.round(n * 100) : 0;
}

/* ------------------------------------------------------------------ ids */

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function code(len) {
  const n = len || 5;
  const b = new Uint8Array(n);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (let i = 0; i < n; i++) out += ALPHABET[b[i] % ALPHABET.length];
  return out;
}

export function normaliseCode(s) {
  return String(s || "").toUpperCase()
    .replace(/[O0]/g, "Q").replace(/[1I]/g, "J")
    .split("").filter((ch) => ALPHABET.indexOf(ch) >= 0).join("")
    .slice(0, 5);
}
