/* Marquee Event System — the session model.

   One object describes everything the room can see, and every change to it is a pure
   function here. The console owns it; the display and the players render whatever they
   are handed. Keeping the transitions in one testable place is what stops the two
   screens ever disagreeing about who won what. */

import { callSequence, rand32, code, STAGE_TYPES } from "./core.js";

export const MODES = ["idle", "lobby", "play", "check", "won", "interval", "quiz"];

export function newSession(opts) {
  const o = opts || {};
  return {
    v: 1,
    venue: o.venue || "The Marquee",
    room: o.room || code(5),
    perm: o.perm || rand32(),
    books: { from: 1, to: o.books || 250, next: 1, free: [] },
    currency: o.currency || "£",
    mode: "idle",
    notice: "",
    media: {
      index: 0,
      slides: o.slides || [
        { title: "Welcome to the Marquee", body: "Eyes down shortly", tint: "#FFB020" },
        { title: "Bar open until late", body: "Ask about the session offer", tint: "#3DDC97" },
      ],
    },
    jackpot: { name: "House Jackpot", amount: 25000, callsToWin: 45, active: true, won: null },
    game: null,
    check: null,
    quiz: null,
    stats: { sharp: 0, won: 0, hot: [], tickets: 0 },
    history: [],           // completed games, for the session report
    seats: [],             // who is in the room, and where they stand
    bans: [],              // names barred from coming back
    openedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ games */

export function stagesFromPreset(preset) {
  return (preset || []).map((s) => ({
    key: s.key,
    label: s.label || (STAGE_TYPES[s.key] ? STAGE_TYPES[s.key].label : s.key),
    rows: STAGE_TYPES[s.key] ? STAGE_TYPES[s.key].rows : (s.rows || 1),
    kind: s.kind === "prize" ? "prize" : "cash",
    prize: s.prize | 0,                     // pence, when it's cash
    text: s.text || "",                     // what it is, when it isn't
    won: null,
  }));
}

export const DEFAULT_STAGES = [
  { key: "line", kind: "cash", prize: 2000 },
  { key: "two", kind: "cash", prize: 3000 },
  { key: "house", kind: "cash", prize: 7500 },
];

export function buildGame(s, spec) {
  const no = (s.history.length + 1);
  return {
    no,
    name: spec.name || ("Game " + no),
    seed: rand32(),
    interval: spec.interval || 7000,
    autocall: spec.autocall !== false,
    stages: stagesFromPreset(spec.stages && spec.stages.length ? spec.stages : DEFAULT_STAGES),
    stageIndex: 0,
    calls: [],
    paused: false,
    lobbyUntil: 0,
    jackpotEligible: !!spec.jackpot,
    startedAt: 0,
    endedAt: 0,
  };
}

/* Put a game on the board and open the lobby — the "eyes down in..." moment. */
export function openLobby(s, spec, lobbySeconds) {
  clearSeatStates(s);
  const g = buildGame(s, spec);
  g.lobbyUntil = Date.now() + (lobbySeconds == null ? 20 : lobbySeconds) * 1000;
  s.game = g;
  s.mode = "lobby";
  s.check = null;
  return s;
}

export function startPlay(s) {
  if (!s.game) return s;
  s.game.startedAt = Date.now();
  s.game.lobbyUntil = 0;
  s.game.paused = false;
  s.mode = "play";
  return s;
}

/* The next ball. In auto mode the console's timer calls this; in manual mode the
   operator taps a number and we take that one instead. */
export function drawCall(s, forced) {
  const g = s.game;
  if (!g || g.calls.length >= 90) return null;
  const seq = callSequence(g.seed);
  let n;
  if (forced != null) {
    n = forced | 0;
    if (n < 1 || n > 90 || g.calls.indexOf(n) >= 0) return null;
  } else {
    n = seq.find((x) => g.calls.indexOf(x) < 0);
    if (n == null) return null;
  }
  g.calls.push(n);
  return n;
}

export function undoCall(s) {
  const g = s.game;
  if (!g || !g.calls.length) return null;
  return g.calls.pop();
}

export function currentStage(s) {
  const g = s.game;
  if (!g) return null;
  return g.stages[Math.min(g.stageIndex, g.stages.length - 1)] || null;
}

export function pause(s, on) {
  if (!s.game) return s;
  s.game.paused = !!on;
  return s;
}

/* Hold the caller and put the check card on the display. */
export function openCheck(s, who) {
  if (!s.game) return s;
  s.game.paused = true;
  s.check = { name: who && who.name ? who.name : "", book: who && who.book ? who.book : null, result: null };
  s.mode = "check";
  return s;
}

export function setCheckResult(s, result) {
  if (!s.check) s.check = { name: "", book: null, result: null };
  s.check.result = result;
  return s;
}

/* Coming out of a check means the caller starts again — otherwise a false call would
   leave the room sitting in silence until someone noticed the pause. */
export function clearCheck(s) {
  s.check = null;
  if (s.game && s.mode === "check") {
    s.mode = "play";
    s.game.paused = false;
  }
  return s;
}

/* Award the current stage and move the game on. */
export function award(s, winner) {
  const g = s.game;
  if (!g) return s;
  const stage = g.stages[g.stageIndex];
  if (!stage) return s;
  stage.won = {
    name: (winner && winner.name) || "House",
    book: (winner && winner.book) || null,
    ticket: (winner && winner.ticket) != null ? winner.ticket : null,
    call: g.calls.length,
    at: Date.now(),
  };
  /* jackpot: the full house inside the call limit takes the pot */
  if (stage.key === "house" && g.jackpotEligible && s.jackpot.active &&
      g.calls.length <= s.jackpot.callsToWin && !s.jackpot.won) {
    stage.won.jackpot = s.jackpot.amount;
    s.jackpot.won = { name: stage.won.name, game: g.no, calls: g.calls.length, at: Date.now() };
  }
  s.check = null;
  s.mode = "won";
  const seat = winner && winner.book ? s.seats.find((x) => x.book === winner.book) : null;
  if (seat) { seat.state = "called"; seat.flash = 0; }
  return s;
}

/* From the winner card, on to the next prize — or close the game out. */
export function nextStage(s) {
  const g = s.game;
  if (!g) return s;
  if (g.stageIndex < g.stages.length - 1) {
    g.stageIndex++;
    g.paused = false;
    s.mode = "play";
    clearSeatStates(s);
    return s;
  }
  return endGame(s);
}

export function endGame(s) {
  const g = s.game;
  if (!g) return s;
  g.endedAt = Date.now();
  s.history.push({
    no: g.no, name: g.name, calls: g.calls.length, seed: g.seed,
    stages: g.stages.map((st) => ({
      key: st.key, label: st.label, prize: st.prize, kind: st.kind, text: st.text,
      won: st.won ? {
        name: st.won.name, book: st.won.book,
        ticket: st.won.ticket, call: st.won.call, jackpot: st.won.jackpot || 0,
      } : null,
    })),
    endedAt: g.endedAt,
  });
  s.game = null;
  s.check = null;
  s.mode = "interval";
  return s;
}

export function abandonGame(s) {
  s.game = null;
  s.check = null;
  s.mode = "idle";
  return s;
}

/* ------------------------------------------------------------------ seats */

/* The next book number to hand out. Dropped books come back here first, so "drop" means
   what the console says it means and the same player rejoining gets their book again
   instead of the room drifting off into higher and higher numbers. */
function takeBook(s) {
  if (!s.books.free) s.books.free = [];
  if (s.books.free.length) return s.books.free.shift();
  if (s.books.next < s.books.from) s.books.next = s.books.from;
  const no = s.books.next++;
  if (no > s.books.to) s.books.to = no;                       // room is fuller than planned
  return no;
}

function giveBack(s, book) {
  if (!s.books.free) s.books.free = [];
  if (book && s.books.free.indexOf(book) < 0) s.books.free.push(book);
  s.books.free.sort((a, b) => a - b);
}

export function seatFor(s, name) {
  const clean = String(name || "Player").slice(0, 18);
  const existing = s.seats.find((x) => x.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const seat = {
    name: clean, book: takeBook(s), joined: Date.now(),
    state: null,          // waiting | called | missed | false
    claim: null,          // the last claim they made this stage
    falses: 0,            // false calls this session
    flash: 0,             // when to stop shouting about the last false call
  };
  s.seats.push(seat);
  return seat;
}

/* Every prize starts everyone level again. False-call tallies carry on. */
export function clearSeatStates(s) {
  for (const x of s.seats) { x.state = null; x.claim = null; x.flash = 0; }
  return s;
}

export function releaseSeat(s, name) {
  const i = s.seats.findIndex((x) => x.name === name);
  if (i >= 0) giveBack(s, s.seats.splice(i, 1)[0].book);
  return s;
}

export function dropSeat(s, book) {
  const i = s.seats.findIndex((x) => x.book === book);
  if (i >= 0) giveBack(s, s.seats.splice(i, 1)[0].book);
  return s;
}

export function isBanned(s, name) {
  const want = String(name || "").trim().toLowerCase();
  return (s.bans || []).some((b) => b.toLowerCase() === want);
}

export function ban(s, name) {
  if (!s.bans) s.bans = [];
  const clean = String(name || "").trim();
  if (clean && !isBanned(s, clean)) s.bans.push(clean);
  return s;
}

export function unban(s, name) {
  const want = String(name || "").trim().toLowerCase();
  s.bans = (s.bans || []).filter((b) => b.toLowerCase() !== want);
  return s;
}

/* ------------------------------------------------------------------ money */

export function sessionTotals(s) {
  let paid = 0, offered = 0, jackpot = 0, goods = 0;
  const count = (st) => {
    const cash = st.kind !== "prize";
    if (cash) offered += st.prize | 0;
    if (!st.won) return;
    if (cash) paid += st.prize | 0; else goods++;
    jackpot += (st.won.jackpot | 0);
  };
  for (const g of s.history) g.stages.forEach(count);
  if (s.game) s.game.stages.forEach(count);
  return { paid, offered, jackpot, goods, games: s.history.length, seats: s.seats.length };
}

/* ------------------------------------------------------------------ quiz */

export function openQuiz(s, round) {
  s.quiz = {
    name: round.name || "Quickfire",
    questions: round.questions || [],
    index: -1,
    revealed: false,
    deadline: 0,
    scores: {},              // name -> points
    answers: {},             // name -> choice for the current question
  };
  s.mode = "quiz";
  return s;
}

export function quizNext(s, seconds) {
  const q = s.quiz;
  if (!q) return s;
  q.index++;
  q.revealed = false;
  q.answers = {};
  q.deadline = Date.now() + (seconds || 20) * 1000;
  return s;
}

export function quizReveal(s) {
  const q = s.quiz;
  if (!q || q.index < 0 || q.index >= q.questions.length) return s;
  q.revealed = true;
  const right = q.questions[q.index].answer;
  for (const name of Object.keys(q.answers)) {
    if (q.answers[name] === right) q.scores[name] = (q.scores[name] || 0) + 1;
  }
  return s;
}

export function quizAnswer(s, name, choice) {
  const q = s.quiz;
  if (!q || q.revealed || q.index < 0) return false;
  if (Date.now() > q.deadline) return false;
  q.answers[name] = choice | 0;
  return true;
}

export function quizTable(s) {
  const q = s.quiz;
  if (!q) return [];
  return Object.keys(q.scores)
    .map((name) => ({ name, pts: q.scores[name] }))
    .sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
}

export function closeQuiz(s) {
  s.quiz = null;
  s.mode = s.game ? "play" : "idle";
  return s;
}

/* ------------------------------------------------------------------ wire */

/* What actually goes to the display and the players — the whole session minus the
   book-keeping nobody else needs. Small enough to send on every ball. */
export function forWire(s) {
  return {
    v: 1,
    venue: s.venue,
    room: s.room,
    perm: s.perm,
    books: { from: s.books.from, to: s.books.to },
    currency: s.currency,
    mode: s.mode,
    notice: s.notice,
    media: s.media,
    jackpot: s.jackpot,
    game: s.game ? {
      no: s.game.no, name: s.game.name, seed: s.game.seed,
      interval: s.game.interval, autocall: s.game.autocall,
      stages: s.game.stages, stageIndex: s.game.stageIndex,
      calls: s.game.calls, paused: s.game.paused,
      lobbyUntil: s.game.lobbyUntil, jackpotEligible: s.game.jackpotEligible,
    } : null,
    check: s.check,
    quiz: s.quiz ? {
      name: s.quiz.name, index: s.quiz.index, revealed: s.quiz.revealed,
      deadline: s.quiz.deadline,
      question: s.quiz.index >= 0 && s.quiz.questions[s.quiz.index]
        ? { q: s.quiz.questions[s.quiz.index].q,
            options: s.quiz.questions[s.quiz.index].options,
            answer: s.quiz.revealed ? s.quiz.questions[s.quiz.index].answer : null }
        : null,
      total: s.quiz.questions.length,
      answered: Object.keys(s.quiz.answers).length,
      table: quizTable(s).slice(0, 8),
    } : null,
    stats: s.stats,
    seats: s.seats.length,
    totals: sessionTotals(s),
    stamp: Date.now(),
  };
}
