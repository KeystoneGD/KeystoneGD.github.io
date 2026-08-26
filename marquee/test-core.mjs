import {
  makeBook, bookFor, bookSeed, ticketNumbers, callSequence, rowsComplete,
  toGo, winningCall, validate, scanRoom, money, parseMoney, normaliseCode,
} from './js/core.js';

let fails = 0;
const bad = (msg) => { console.log('  FAIL: ' + msg); fails++; };

/* ---------------------------------------------- 1. books are legal ---- */
for (let b = 1; b <= 1500; b++) {
  const book = bookFor(12345, b);
  if (!book) { bad('no book for ' + b); continue; }
  const all = [];
  for (const t of book) {
    let total = 0;
    for (let r = 0; r < 3; r++) {
      let row = 0;
      for (let c = 0; c < 9; c++) {
        const v = t[r][c];
        if (v == null) continue;
        row++; total++; all.push(v);
        const lo = c === 0 ? 1 : c * 10, hi = c === 8 ? 90 : c * 10 + 9;
        if (v < lo || v > hi) bad('column range, book ' + b);
      }
      if (row !== 5) bad('row of ' + row + ' in book ' + b);
    }
    if (total !== 15) bad('ticket of ' + total + ' in book ' + b);
    for (let c = 0; c < 9; c++) {
      const col = [t[0][c], t[1][c], t[2][c]].filter((v) => v != null);
      if (!col.length || col.length > 3) bad('column of ' + col.length + ' in book ' + b);
      if (String(col) !== String(col.slice().sort((x, y) => x - y))) bad('column order, book ' + b);
    }
  }
  if (all.length !== 90 || new Set(all).size !== 90) bad('book ' + b + ' does not hold all 90');
}
console.log('books 1-1500 legal:', fails === 0 ? 'yes' : 'NO');

/* ---------------------------------------------- 2. deterministic ------ */
const a1 = JSON.stringify(bookFor(777, 4172));
const a2 = JSON.stringify(bookFor(777, 4172));
const a3 = JSON.stringify(bookFor(778, 4172));
console.log('same perm + book identical:', a1 === a2, '| different perm differs:', a1 !== a3);
if (a1 !== a2 || a1 === a3) bad('determinism');

/* ---------------------------------------------- 3. toGo vs brute force  */
{
  const book = bookFor(999, 42);
  const seq = callSequence(555);
  let checked = 0;
  for (let cut = 0; cut <= 90; cut += 7) {
    const marked = new Set(seq.slice(0, cut));
    for (const ticket of book) {
      for (const [rows, name] of [[1, 'line'], [2, 'two'], [3, 'house']]) {
        const got = toGo(ticket, marked, rows);
        // brute force: smallest number of unmarked numbers needed to complete `rows` rows
        const perRow = [0, 1, 2].map((r) => {
          let n = 0;
          for (let c = 0; c < 9; c++) if (ticket[r][c] != null && !marked.has(ticket[r][c])) n++;
          return n;
        });
        let want;
        if (rows === 3) want = perRow[0] + perRow[1] + perRow[2];
        else {
          const s = perRow.slice().sort((x, y) => x - y);
          want = s.slice(0, rows).reduce((p, q) => p + q, 0);
        }
        if (got !== want) bad('toGo ' + name + ' got ' + got + ' want ' + want);
        checked++;
      }
    }
  }
  console.log('toGo agrees with brute force over', checked, 'checks');
}

/* ---------------------------------------------- 4. winningCall -------- */
{
  const book = bookFor(2024, 7);
  const seq = callSequence(31337);
  for (const rows of [1, 2, 3]) {
    for (const ticket of book) {
      const wc = winningCall(ticket, seq, rows);
      if (wc < 0) { bad('nothing ever wins over a full 90 calls'); continue; }
      const before = new Set(seq.slice(0, wc));
      const at = new Set(seq.slice(0, wc + 1));
      if (toGo(ticket, at, rows) !== 0) bad('not complete at its own winning call');
      if (wc > 0 && toGo(ticket, before, rows) === 0) bad('was already complete a call earlier');
    }
  }
  console.log('winningCall is the exact first completing call: yes');
}

/* ---------------------------------------------- 5. validation --------- */
{
  const PERM = 88991, BOOK = 4172;
  const seq = callSequence(4242);
  const book = bookFor(PERM, BOOK);
  const rows = 1;
  let earliest = 99, which = -1;
  book.forEach((t, i) => {
    const wc = winningCall(t, seq, rows);
    if (wc < earliest) { earliest = wc; which = i; }
  });

  const good = validate(PERM, BOOK, seq.slice(0, earliest + 1), rows, earliest);
  console.log('valid claim:', good.ok, '| ticket', good.ticket + 1, '| call', good.call + 1,
    '| number', good.number, '| matches expected ticket:', good.ticket === which);
  if (!good.ok || good.ticket !== which) bad('validation of a true claim');

  const early = validate(PERM, BOOK, seq.slice(0, earliest), rows, earliest - 1);
  console.log('same book claimed one call early:', early.ok ? 'ACCEPTED (wrong)' : 'rejected, ' + early.toGo + ' to go');
  if (early.ok) bad('accepted a premature claim');

  const wrongBook = validate(PERM, BOOK + 1, seq.slice(0, earliest + 1), rows, earliest);
  console.log('a different book at the same call:', wrongBook.ok ? 'also on (possible)' : 'not on, ' + wrongBook.toGo + ' to go');

  // late claim: checked against everything called so far, and reports how late
  const late = validate(PERM, BOOK, seq.slice(0, earliest + 4), rows);
  console.log('late claim still valid:', late.ok, '| balls behind:', late.late);
  if (!late.ok || late.late !== 3) bad('late claim accounting');
}

/* ---------------------------------------------- 6. sharps ------------- */
{
  const PERM = 5150, FROM = 1, TO = 120;
  const seq = callSequence(1066);
  const calls = seq.slice(0, 40);
  const rows = 1;
  const scan = scanRoom(PERM, FROM, TO, calls, rows);

  // brute force the same thing
  let sharp = 0, won = 0;
  const hot = new Map();
  const marked = new Set(calls);
  for (let b = FROM; b <= TO; b++) {
    for (const t of bookFor(PERM, b)) {
      const g = toGo(t, marked, rows);
      if (g === 0) won++;
      else if (g === 1) {
        sharp++;
        for (const n of ticketNumbers(t)) {
          if (marked.has(n)) continue;
          marked.add(n);
          if (toGo(t, marked, rows) === 0) hot.set(n, (hot.get(n) || 0) + 1);
          marked.delete(n);
        }
      }
    }
  }
  console.log('room scan — tickets', scan.tickets, '| won', scan.won, '(want ' + won + ')',
    '| sharp', scan.sharp, '(want ' + sharp + ')');
  if (scan.won !== won || scan.sharp !== sharp) bad('scanRoom counts');
  const topScan = scan.hot.slice(0, 3).map((x) => x[0] + 'x' + x[1]).join(' ');
  const topBrute = Array.from(hot.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map((x) => x[0] + 'x' + x[1]).join(' ');
  console.log('hot numbers:', topScan || '(none)', '| brute force:', topBrute || '(none)');
  if (scan.hot.length !== hot.size) bad('scanRoom hot numbers');
}

/* ---------------------------------------------- 7. speed -------------- */
{
  const cache = new Map();
  const seq = callSequence(7);
  let t0 = Date.now();
  for (let b = 1; b <= 400; b++) bookFor(9, b);
  const gen = Date.now() - t0;
  t0 = Date.now();
  scanRoom(9, 1, 400, seq.slice(0, 45), 1, cache);
  const first = Date.now() - t0;
  t0 = Date.now();
  for (let i = 0; i < 20; i++) scanRoom(9, 1, 400, seq.slice(0, 45 + i), 1, cache);
  const warm = (Date.now() - t0) / 20;
  console.log('400 books: generate', gen + 'ms | first scan', first + 'ms | cached scan',
    warm.toFixed(1) + 'ms each');
  if (warm > 60) bad('cached room scan too slow for a live display');
}

/* ---------------------------------------------- 8. odds and ends ------ */
console.log('money:', money(2000), money(1250), money(0), '| parse "£7.50" =', parseMoney('£7.50'));
console.log('code tidy: "o1qq" ->', normaliseCode('o1qq'));
if (money(2000) !== '£20' || parseMoney('£7.50') !== 750) bad('money formatting');

console.log(fails === 0 ? '\nALL CORE TESTS PASSED' : '\n' + fails + ' FAILURES');
process.exit(fails ? 1 : 0);
