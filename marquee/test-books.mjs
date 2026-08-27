/* Book numbers: who gets which, and what happens when one is given back.
   node test-books.mjs */

import { newSession, seatFor, dropSeat } from './js/session.js';
import { bookFor, ticketNumbers } from './js/core.js';

let fails = 0;
const bad = (m) => { console.log('  FAIL: ' + m); fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------- 1. books are handed out in order */
{
  const s = newSession({});
  const a = seatFor(s, 'Marjorie').book;
  const b = seatFor(s, 'Dot').book;
  const c = seatFor(s, 'Ken').book;
  console.log('three joined:', a, b, c);
  if (a !== 1 || b !== 2 || c !== 3) bad('books should start at 1 and count up');

  /* the same person coming back gets the same book, whatever case they type */
  if (seatFor(s, 'marjorie').book !== a) bad('a rejoining name should keep its book');
  if (s.seats.length !== 3) bad('rejoining made a second seat');
}

/* ------------------------------------------- 2. dropping really frees the book */
{
  const s = newSession({});
  seatFor(s, 'Marjorie');                       // 1
  const dots = seatFor(s, 'Dot').book;          // 2
  seatFor(s, 'Ken');                            // 3
  dropSeat(s, dots);
  console.log('after dropping book', dots + ':', 'free =', s.books.free.join(',') || '(none)');
  if (!s.books.free.includes(dots)) bad('a dropped book did not go back in the pool');

  const back = seatFor(s, 'Dot').book;
  console.log('Dot rejoins and gets book', back);
  if (back !== dots) bad('a dropped player should get their book back, not a fresh one');

  const fresh = seatFor(s, 'Sam').book;
  if (fresh !== 4) bad('the next new player should carry on from the top, got ' + fresh);
}

/* ------------------------------------------- 3. a book number means one thing */
{
  const s = newSession({});
  const seat = seatFor(s, 'Marjorie');
  const onConsole = bookFor(s.perm, seat.book);
  const onPhone = bookFor(s.perm, seat.book);       // what the phone builds from the wire
  if (!same(onConsole, onPhone)) bad('same perm and book number gave two different books');

  /* and a new perm must genuinely reissue it */
  const after = bookFor((s.perm ^ 0x5F5F5F5F) >>> 0, seat.book);
  if (same(onConsole, after)) bad('a new perm left the book unchanged');
  console.log('book', seat.book, 'ticket 1 before a new perm:', ticketNumbers(onConsole[0]).join(' '));
  console.log('book', seat.book, 'ticket 1 after  a new perm:', ticketNumbers(after[0]).join(' '));
}

/* ------------------------------------------- 4. a room fuller than planned */
{
  const s = newSession({ books: 3 });
  for (let i = 0; i < 5; i++) seatFor(s, 'P' + i);
  console.log('five in a room set up for three — range now', s.books.from + '-' + s.books.to);
  if (s.books.to < 5) bad('the range should stretch to cover everyone seated');
  if (new Set(s.seats.map((x) => x.book)).size !== 5) bad('two players share a book number');
}

console.log(fails === 0 ? '\nALL BOOK TESTS PASSED' : '\n' + fails + ' FAILURES');
process.exit(fails ? 1 : 0);
