/* Palace Bingo — pure game logic. No DOM, no network.
   90-ball UK rules: 6 tickets to a sheet, 3x9 each, 15 numbers, all 90 across the six. */

export const STAGES = ["ONE LINE", "TWO LINES", "FULL HOUSE"];

export const NICK = ["", "Kelly's eye", "One little duck", "Cup of tea", "Knock at the door", "Man alive",
  "Half a dozen", "Lucky seven", "Garden gate", "Doctor's orders", "Downing Street", "Legs eleven",
  "One dozen", "Unlucky for some", "Valentine's Day", "Young and keen", "Sweet sixteen", "Dancing queen",
  "Coming of age", "Goodbye teens", "One score", "Royal salute", "Two little ducks", "Thee and me",
  "Two dozen", "Duck and dive", "Half a crown", "Gateway to heaven", "In a state", "Rise and shine",
  "Dirty Gertie", "Get up and run", "Buckle my shoe", "All the threes", "Ask for more", "Jump and jive",
  "Three dozen", "More than eleven", "Christmas cake", "Steps", "Life begins", "Time for fun",
  "Winnie the Pooh", "Down on your knees", "Droopy drawers", "Halfway there", "Up to tricks",
  "Four and seven", "Four dozen", "Nick nick", "Half a century", "Tweak of the thumb", "Danny La Rue",
  "Stuck in the tree", "Clean the floor", "Snakes alive", "Was she worth it", "Heinz varieties",
  "Make them wait", "Brighton line", "Five dozen", "Baker's bun", "Turn the screw", "Tickle me",
  "Almost retired", "Retirement age", "Clickety click", "Stairway to heaven", "Saving grace",
  "Favourite of mine", "Three score and ten", "Bang on the drum", "Six dozen", "Queen bee",
  "Hit the floor", "Strive and strive", "Trombones", "Two little crutches", "Thirty-nine more steps",
  "One more time", "Eight and blank", "Stop and run", "Straight on through", "Time for tea",
  "Seven dozen", "Staying alive", "Between the sticks", "Torquay in Devon", "Two fat ladies",
  "Nearly there", "Top of the shop"];

/* ---------- random ---------- */

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

/* ---------- tickets ---------- */

const COL_SIZE = [9, 10, 10, 10, 10, 10, 10, 10, 11];

/* How many numbers each ticket takes from each column: 1..3 per column,
   15 per ticket, and the column totals above across all six. */
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
        cands.sort((a, b) => ticketLeft[b] - ticketLeft[a]);
        const top = ticketLeft[cands[0]];
        const pool = cands.filter((t) => ticketLeft[t] === top);
        const t = pool[Math.floor(rnd() * pool.length)];
        counts[t][c]++; ticketLeft[t]--; need--;
      }
      if (!ok) break;
    }
    if (ok && ticketLeft.every((v) => v === 0)) return counts;
  }
  return null;
}

/* Place one ticket's column counts into 3 rows of exactly 5. */
function rowLayout(counts, rnd) {
  for (let attempt = 0; attempt < 3000; attempt++) {
    const grid = [new Array(9).fill(false), new Array(9).fill(false), new Array(9).fill(false)];
    const rowLeft = [5, 5, 5];
    let ok = true;
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort((a, b) => counts[b] - counts[a] || rnd() - 0.5);
    for (const c of order) {
      const n = counts[c];
      const rows = [0, 1, 2].filter((r) => rowLeft[r] > 0);
      if (rows.length < n) { ok = false; break; }
      rows.sort((a, b) => rowLeft[b] - rowLeft[a]);
      const pool = rows.slice();
      for (let k = 0; k < n; k++) {
        const best = pool.filter((r) => rowLeft[r] === rowLeft[pool[0]]);
        const r = best[Math.floor(rnd() * best.length)];
        grid[r][c] = true; rowLeft[r]--;
        pool.splice(pool.indexOf(r), 1);
        pool.sort((a, b) => rowLeft[b] - rowLeft[a]);
      }
    }
    if (ok && rowLeft.every((v) => v === 0)) return grid;
  }
  return null;
}

/* A full sheet: 6 tickets, each 3 rows x 9 columns of number-or-null. */
export function generateStrip(seed) {
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

/* ---------- the calls ---------- */

export function sequenceFor(seed) {
  const nums = [];
  for (let n = 1; n <= 90; n++) nums.push(n);
  return shuffle(nums, mulberry32(((seed >>> 0) ^ 0x5BD1E995) >>> 0));
}

/* How many balls are out, given the game's start time and the current clock. */
export function calledCount(g, now) {
  if (!g || g.status !== "running" || !g.startedAt) return 0;
  const elapsed = g.paused ? g.pausedElapsed : now - g.startedAt;
  if (elapsed < 0) return 0;
  return Math.max(0, Math.min(90, Math.floor(elapsed / g.interval) + 1));
}

export function msToNext(g, now) {
  if (!g || g.status !== "running" || g.paused || !g.startedAt) return g ? g.interval : 0;
  const elapsed = now - g.startedAt;
  if (elapsed < 0) return -elapsed;
  return g.interval - (elapsed % g.interval);
}

/* ---------- winning ---------- */

export function completedRows(ticket, marked) {
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

export function numbersIn(ticket, rows) {
  const out = [];
  for (const r of rows) for (let c = 0; c < 9; c++) if (ticket[r][c] != null) out.push(ticket[r][c]);
  return out;
}

/* The call index at which the last of `nums` came out, or -1 if any is still in the bag. */
export function completionCall(nums, seq, limit) {
  let max = -1;
  for (const n of nums) {
    const i = seq.indexOf(n);
    if (i < 0 || i >= limit) return -1;
    if (i > max) max = i;
  }
  return max;
}

export function combosFor(done, need) {
  if (need === 3) return done.length === 3 ? [[0, 1, 2]] : [];
  if (need === 2) return [[0, 1], [0, 2], [1, 2]].filter((p) => p.every((r) => done.indexOf(r) >= 0));
  return done.map((r) => [r]);
}

/* Best claim available from `marked` within the first `limit` calls. */
export function evaluate(strip, marked, stage, seq, limit) {
  const st = Math.min(2, stage | 0);
  const need = st + 1;
  let best = null;
  for (let t = 0; t < 6; t++) {
    const done = completedRows(strip[t], marked);
    if (done.length < need) continue;
    for (const rows of combosFor(done, need)) {
      const wc = completionCall(numbersIn(strip[t], rows), seq, limit);
      if (wc < 0) continue;
      if (!best || wc < best.winCall) best = { ticket: t, rows, winCall: wc, stage: st };
    }
  }
  return best;
}

/* Rebuild a sheet from its seed and check a claim against the numbers actually called.
   Returns {ok, ticket, rows, number} or {ok:false, reason}. */
export function verifyClaim(seed, claimCall, stage, seq) {
  if (!isFinite(claimCall) || claimCall < 0 || claimCall > 89) return { ok: false, reason: "bad-call" };
  const strip = generateStrip(seed >>> 0);
  if (!strip) return { ok: false, reason: "bad-seed" };
  const st = Math.min(2, stage | 0);
  const need = st + 1;
  const limit = claimCall + 1;
  const marked = new Set(seq.slice(0, limit));
  for (let t = 0; t < 6; t++) {
    const done = completedRows(strip[t], marked);
    if (done.length < need) continue;
    for (const rows of combosFor(done, need)) {
      if (completionCall(numbersIn(strip[t], rows), seq, limit) === claimCall) {
        return { ok: true, ticket: t, rows, number: seq[claimCall], call: claimCall };
      }
    }
  }
  return { ok: false, reason: "not-on" };
}

/* ---------- claim codes ---------- */

export function claimCode(seed, call) {
  return (seed >>> 0).toString(36).toUpperCase() + "-" + (call | 0).toString(36).toUpperCase();
}

export function parseClaimCode(raw) {
  const m = String(raw || "").trim().toUpperCase().match(/^([0-9A-Z]+)[-\s]+([0-9A-Z]+)$/);
  if (!m) return null;
  const seed = parseInt(m[1], 36) >>> 0;
  const call = parseInt(m[2], 36);
  if (!isFinite(call)) return null;
  return { seed, call };
}

/* ---------- shareable game link ---------- */

export function encodeGame(g) {
  const packed = [g.gameId >>> 0, g.gameSeed >>> 0, g.gameNo | 0, g.startedAt, g.interval | 0,
    g.paused ? 1 : 0, g.pausedElapsed | 0, Math.min(2, g.stage | 0)].join(".");
  return btoa(packed).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeGame(s) {
  try {
    const p = atob(String(s).replace(/-/g, "+").replace(/_/g, "/")).split(".");
    if (p.length < 8) return null;
    return {
      status: "running", gameId: +p[0] >>> 0, gameSeed: +p[1] >>> 0, gameNo: +p[2] | 0,
      startedAt: +p[3], interval: +p[4] | 0, paused: p[5] === "1",
      pausedElapsed: +p[6] | 0, stage: Math.min(2, +p[7] | 0),
    };
  } catch (e) { return null; }
}
