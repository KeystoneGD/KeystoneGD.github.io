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
    books: { from: 1, to: o.books || 250, next: 1 },
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
    seats: [],             // {name, book} — who is in the room
    openedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ games */

export function stagesFromPreset(preset) {
  return (preset || []).map((s) => ({
    key: s.key,
    label: s.label || (STAGE_TYPES[s.key] ? STAGE_TYPES[s.key].label : s.key),
    rows: STAGE_TYPES[s.key] ? STAGE_TYPES[s.key].rows : (s.rows || 1),
    prize: s.prize | 0,
    won: null,
  }));
}

export const DEFAULT_STAGES = [
  { key: "line", prize: 2000 },
  { key: "two", prize: 3000 },
  { key: "house", prize: 7500 },
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

export function clearCheck(s) {
  s.check = null;
  if (s.game && s.mode === "check") s.mode = "play";
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
      key: st.key, label: st.label, prize: st.prize,
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

export function seatFor(s, name) {
  const clean = String(name || "Player").slice(0, 18);
  const existing = s.seats.find((x) => x.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  if (s.books.next > s.books.to) s.books.to = s.books.next;   // room is fuller than planned
  const seat = { name: clean, book: s.books.next++, joined: Date.now() };
  s.seats.push(seat);
  return seat;
}

export function releaseSeat(s, name) {
  const i = s.seats.findIndex((x) => x.name === name);
  if (i >= 0) s.seats.splice(i, 1);
  return s;
}

/* ------------------------------------------------------------------ money */

export function sessionTotals(s) {
  let paid = 0, prizes = 0, jackpot = 0;
  for (const g of s.history) {
    for (const st of g.stages) {
      prizes += st.prize | 0;
      if (st.won) { paid += st.prize | 0; jackpot += st.won.jackpot | 0; }
    }
  }
  if (s.game) for (const st of s.game.stages) {
    prizes += st.prize | 0;
    if (st.won) { paid += st.prize | 0; jackpot += st.won.jackpot | 0; }
  }
  return { paid, offered: prizes, jackpot, games: s.history.length, seats: s.seats.length };
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
