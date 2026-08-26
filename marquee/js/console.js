/* Marquee — the operator console.

   The only place the session actually lives. It calls the numbers, checks the claims,
   drives the display and answers the phones. Everything else in the system is a view. */

import {
  NICK, money, parseMoney, validate, scanRoom, bookFor, rand32, code, STAGE_TYPES,
} from "./core.js";
import {
  newSession, openLobby, startPlay, drawCall, undoCall, currentStage, pause,
  openCheck, setCheckResult, clearCheck, award, nextStage, endGame, abandonGame,
  seatFor, releaseSeat, sessionTotals, forWire, openQuiz, quizNext, quizReveal,
  quizAnswer, closeQuiz, DEFAULT_STAGES,
} from "./session.js";
import { openRoom } from "./bus.js";
import { checkCredentials, cryptoAvailable, session as gateSession } from "./auth.js";
import { CREDENTIALS } from "./credentials.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STORE = "marquee.session";
const PRESETS = "marquee.presets";
const QSTORE = "marquee.quiz";

let S = null;
let room = null;
let bookCache = new Map();
let lastCallAt = 0;
let pendingWinner = null;         // who Award will credit
let claims = [];
let quizRound = loadQuiz();
let toastTimer = 0;

/* ============================================================ sign in */

let attempts = 0;
function gateMsg(html, kind) {
  const el = $("gateMsg");
  el.className = "msg " + (kind || "");
  el.innerHTML = html;
}

if (!CREDENTIALS) {
  gateMsg("No lock fitted yet. Open <b>set-password.html</b>, choose an operator name and " +
    "password, and paste the result into <b>js/credentials.js</b>.", "err");
  $("gateBtn").disabled = true;
} else if (!cryptoAvailable()) {
  gateMsg("This page needs a secure context for the sign-in check — open it over https, " +
    "or over http://localhost while you're testing.", "err");
  $("gateBtn").disabled = true;
}

$("gateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!CREDENTIALS || !cryptoAvailable()) return;
  $("gateBtn").disabled = true;
  gateMsg("Checking…");
  await new Promise((r) => setTimeout(r, Math.min(attempts * 400, 2000)));
  const ok = await checkCredentials($("userIn").value, $("passIn").value, CREDENTIALS);
  $("gateBtn").disabled = false;
  if (!ok) {
    attempts++;
    $("passIn").value = "";
    $("passIn").focus();
    gateMsg("That operator name and password don't match.", "err");
    return;
  }
  gateSession.open();
  openConsole();
});

$("signOut").addEventListener("click", () => {
  gateSession.close();
  location.reload();
});

function openConsole() {
  $("gate").classList.add("hide");
  $("shell").classList.remove("hide");
  boot();
}

/* ============================================================ panes */

$$(".mod").forEach((b) => b.addEventListener("click", () => showPane(b.dataset.pane)));
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

const PANE_TITLES = { bingo: "Bingo", media: "Media", games: "Games", report: "Session report", setup: "Setup" };
function showPane(name) {
  $$(".mod").forEach((b) => b.classList.toggle("on", b.dataset.pane === name));
  ["bingo", "media", "games", "report", "setup"].forEach((p) => {
    $("pane" + p[0].toUpperCase() + p.slice(1)).classList.toggle("on", p === name);
  });
  $("paneTitle").textContent = PANE_TITLES[name] || name;
  if (name === "report") renderReport();
  if (name === "media") renderSlides();
  if (name === "games") renderQuizPane();
  if (name === "setup") fillSetup();
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 2600);
}

/* ============================================================ boot */

function loadSession() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.v === 1 ? s : null;
  } catch (e) { return null; }
}
function saveSession() {
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {}
}
function loadQuiz() {
  try {
    const raw = localStorage.getItem(QSTORE);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    name: "Quickfire",
    questions: [
      { q: "Which number is 'two fat ladies'?", options: ["44", "77", "88", "22"], answer: 2 },
      { q: "How many numbers on a bingo ticket?", options: ["12", "15", "18", "90"], answer: 1 },
      { q: "'Clickety click' is which number?", options: ["66", "77", "26", "16"], answer: 0 },
    ],
  };
}
function saveQuiz() { try { localStorage.setItem(QSTORE, JSON.stringify(quizRound)); } catch (e) {} }

async function boot() {
  S = loadSession() || newSession({});
  if (!S.seats) S.seats = [];
  bookCache = new Map();

  buildPad();
  injectAwardRow();
  wireControls();
  render();

  room = await openRoom(S.room, {
    onStatus(state, detail) {
      if (state === "open") {
        S.room = detail;
        $("railCode").textContent = detail;
        setChip("railLink", true, "Link");
        saveSession();
      } else if (state === "local") {
        setChip("railScreen", true, "Screen");
      } else if (state === "no-remote") {
        setChip("railLink", false, "No link");
      } else if (state === "reconnecting") {
        setChip("railLink", false, "Linking");
      } else if (state === "error") {
        setChip("railLink", false, "Link err");
      }
    },
    onJoin(p) {
      if (p.role === "display") { setChip("railScreen", true, "Screen"); publish(); return; }
      const seat = seatFor(S, p.name);
      p.seat = seat;
      room.send(p.id, { t: "seat", book: seat.book, perm: S.perm });
      renderSeats();
      publish();
      toast(seat.name + " joined — book " + seat.book);
    },
    onLeave() { renderSeats(); },
    onMessage(p, msg) {
      if (msg.t === "ping") { setChip("railScreen", true, "Screen"); publish(); return; }
      if (msg.t === "claim") return takeClaim(p, msg);
      if (msg.t === "answer") {
        if (quizAnswer(S, p.name, msg.choice)) publish();
        return;
      }
      if (msg.t === "hello" && p.local) publish();
    },
  });

  $("railCode").textContent = S.room;
  publish();
  setInterval(tick, 200);
  setInterval(saveSession, 4000);
}

function setChip(id, on, label) {
  const el = $(id);
  el.className = "chip " + (on ? "on" : "off");
  el.style.fontSize = "11px";
  el.style.padding = "4px 9px";
  el.innerHTML = "<i></i>" + label;
}

/* ============================================================ publish */

function publish() {
  refreshStats();
  if (room) room.publish({ t: "state", s: forWire(S) });
  render();
}

function refreshStats() {
  const g = S.game;
  if (!g || !g.calls.length) { S.stats = { sharp: 0, won: 0, hot: [], tickets: 0 }; return; }
  const st = currentStage(S);
  if (!st) return;
  const scan = scanRoom(S.perm, S.books.from, S.books.to, g.calls, st.rows, bookCache);
  S.stats = { sharp: scan.sharp, won: scan.won, hot: scan.hot.slice(0, 6), tickets: scan.tickets };
}

/* ============================================================ the clock */

function tick() {
  if (!S) return;
  if (S.mode === "lobby" && S.game && Date.now() >= S.game.lobbyUntil) {
    startPlay(S);
    lastCallAt = Date.now() - S.game.interval + 1200;    // a beat before the first ball
    publish();
    return;
  }
  if (S.mode === "play" && S.game && !S.game.paused && S.game.autocall) {
    if (Date.now() - lastCallAt >= S.game.interval) {
      if (S.game.calls.length >= 90) { pause(S, true); publish(); return; }
      drawCall(S);
      lastCallAt = Date.now();
      publish();
      return;
    }
  }
  if (S.mode === "lobby") renderLive();
}

/* ============================================================ claims */

function takeClaim(p, msg) {
  const g = S.game;
  const st = currentStage(S);
  if (!g || !st || (S.mode !== "play" && S.mode !== "check")) {
    room.send(p.id, { t: "verdict", ok: false, text: "there's no prize live just now." });
    return;
  }
  const book = msg.book | 0;
  const res = validate(S.perm, book, g.calls, st.rows, msg.call);
  const behind = g.calls.length - 1 - (msg.call | 0);
  const text = res.ok
    ? "Book " + book + ", ticket " + (res.ticket + 1) + " — " + st.label.toLowerCase() +
      " on call " + (res.call + 1) + ", number " + res.number + "." +
      (behind > 1 ? " Board has moved on " + behind + " balls." : "")
    : (res.reason === "not-on"
        ? "book " + book + " is " + res.toGo + " away from " + st.label.toLowerCase() + "."
        : "that claim didn't make sense.");

  claims.unshift({ name: p.name, book, ok: res.ok, text, ticket: res.ticket, at: Date.now() });
  claims = claims.slice(0, 8);
  room.send(p.id, { t: "verdict", ok: res.ok, text });
  renderClaims();

  if (res.ok) {
    pendingWinner = { name: p.name, book, ticket: res.ticket };
    openCheck(S, { name: p.name, book });
    setCheckResult(S, { ok: true, text: st.label + " — valid" });
    toast(p.name + " is claiming " + st.label.toLowerCase());
  }
  publish();
}

/* ============================================================ controls */

function injectAwardRow() {
  const wrap = document.createElement("div");
  wrap.id = "awardRow";
  wrap.className = "hide";
  wrap.style.marginTop = "14px";
  wrap.innerHTML =
    '<label class="lbl">Winner\'s name</label>' +
    '<div class="row"><input class="field" id="winName" placeholder="Name to put on the screen" style="flex:1;min-width:140px">' +
    '<button class="btn ok" id="bAward2">Award it</button></div>';
  $("ctrls").parentNode.insertBefore(wrap, $("padWrap"));
  $("bAward2").addEventListener("click", doAward);
}

function wireControls() {
  $("bMain").addEventListener("click", mainAction);
  $("bPause").addEventListener("click", () => {
    if (!S.game) return;
    pause(S, !S.game.paused);
    if (!S.game.paused) lastCallAt = Date.now();
    publish();
  });
  $("bCheck").addEventListener("click", () => {
    if (!S.game) return;
    if (S.mode === "check") { clearCheck(S); pendingWinner = null; lastCallAt = Date.now(); }
    else openCheck(S, { name: "" });
    publish();
  });
  $("bAward").addEventListener("click", doAward);
  $("bEnd").addEventListener("click", () => {
    if (!S.game) return;
    if (!window.confirm("End this game and put it in the report?")) return;
    endGame(S);
    pendingWinner = null; claims = [];
    renderClaims();
    publish();
  });
  $("bUndo").addEventListener("click", () => {
    const n = undoCall(S);
    if (n == null) return;
    toast("Took back " + n);
    publish();
  });

  $("modeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b || !S.game) return;
    S.game.autocall = b.dataset.mode === "auto";
    lastCallAt = Date.now();
    publish();
  });
  $("speedSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-speed]");
    if (!b || !S.game) return;
    S.game.interval = +b.dataset.speed;
    publish();
  });

  $("pad").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-n]");
    if (!b || b.disabled || !S.game) return;
    drawCall(S, +b.dataset.n);
    lastCallAt = Date.now();
    publish();
  });

  $("bLookup").addEventListener("click", lookup);
  $("bookIn").addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(); });
  $("openDisplay").addEventListener("click", openDisplayWindow);
  $("openDisplay2").addEventListener("click", openDisplayWindow);

  $("claims").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-claim]");
    if (!b) return;
    const c = claims[+b.dataset.claim];
    if (!c || !c.ok) return;
    pendingWinner = { name: c.name, book: c.book, ticket: c.ticket };
    doAward();
  });

  /* media */
  $("addSlide").addEventListener("click", () => {
    S.media.slides.push({ title: "New slide", body: "", tint: "#FFB020" });
    renderSlides(); publish();
  });
  $("noticeIn").addEventListener("input", (e) => { S.notice = e.target.value.slice(0, 120); publish(); });
  $("clearNotice").addEventListener("click", () => { S.notice = ""; $("noticeIn").value = ""; publish(); });
  $("showMedia").addEventListener("click", () => {
    if (S.game) { toast("Finish the game first"); return; }
    S.mode = "idle"; publish();
  });
  $("slideList").addEventListener("input", (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const [i, field] = k.split(".");
    S.media.slides[+i][field] = e.target.value;
    publish();
  });
  $("slideList").addEventListener("click", (e) => {
    const del = e.target.closest("button[data-del]");
    if (del) { S.media.slides.splice(+del.dataset.del, 1); renderSlides(); publish(); return; }
    const up = e.target.closest("button[data-up]");
    if (up) {
      const i = +up.dataset.up;
      if (i > 0) S.media.slides.splice(i - 1, 0, S.media.slides.splice(i, 1)[0]);
      renderSlides(); publish(); return;
    }
    const now = e.target.closest("button[data-now]");
    if (now) {
      S.media.index = +now.dataset.now;
      if (S.mode !== "idle" && S.mode !== "interval") S.mode = S.game ? S.mode : "idle";
      publish();
      toast("Slide up on the display");
    }
  });

  /* quiz */
  $("qStart").addEventListener("click", () => {
    openQuiz(S, quizRound);
    publish(); renderQuizPane();
  });
  $("qNext").addEventListener("click", () => {
    if (!S.quiz) return;
    if (S.quiz.index + 1 >= S.quiz.questions.length) { toast("That was the last one"); return; }
    quizNext(S, quizSeconds());
    publish(); renderQuizPane();
  });
  $("qReveal").addEventListener("click", () => { quizReveal(S); publish(); renderQuizPane(); });
  $("qClose").addEventListener("click", () => { closeQuiz(S); publish(); renderQuizPane(); });
  $("qSecs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-s]");
    if (!b) return;
    Array.from($("qSecs").children).forEach((x) => x.classList.toggle("on", x === b));
  });
  $("addQ").addEventListener("click", () => {
    quizRound.questions.push({ q: "New question", options: ["", "", "", ""], answer: 0 });
    saveQuiz(); renderQuizPane();
  });
  $("qList").addEventListener("input", (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const p = k.split(".");
    const q = quizRound.questions[+p[0]];
    if (p[1] === "q") q.q = e.target.value;
    else if (p[1] === "o") q.options[+p[2]] = e.target.value;
    saveQuiz();
  });
  $("qList").addEventListener("click", (e) => {
    const a = e.target.closest("button[data-ans]");
    if (a) {
      const p = a.dataset.ans.split(".");
      quizRound.questions[+p[0]].answer = +p[1];
      saveQuiz(); renderQuizPane(); return;
    }
    const d = e.target.closest("button[data-qdel]");
    if (d) { quizRound.questions.splice(+d.dataset.qdel, 1); saveQuiz(); renderQuizPane(); }
  });

  /* setup */
  $("sVenue").addEventListener("input", (e) => { S.venue = e.target.value.slice(0, 40); publish(); });
  $("sCur").addEventListener("input", (e) => { S.currency = e.target.value.slice(0, 3) || "£"; publish(); });
  $("sFrom").addEventListener("change", (e) => {
    S.books.from = Math.max(1, parseInt(e.target.value, 10) || 1);
    if (S.books.next < S.books.from) S.books.next = S.books.from;
    bookCache = new Map(); publish();
  });
  $("sTo").addEventListener("change", (e) => {
    S.books.to = Math.max(S.books.from, Math.min(4000, parseInt(e.target.value, 10) || S.books.from));
    bookCache = new Map(); publish();
  });
  $("sNewPerm").addEventListener("click", () => {
    if (S.game) { toast("Between games only"); return; }
    if (!window.confirm("Issue a new perm? Every book in the room changes.")) return;
    S.perm = rand32(); bookCache = new Map();
    fillSetup(); publish();
    toast("New perm issued");
  });
  $("jName").addEventListener("input", (e) => { S.jackpot.name = e.target.value.slice(0, 30); publish(); });
  $("jAmount").addEventListener("change", (e) => { S.jackpot.amount = parseMoney(e.target.value); fillSetup(); publish(); });
  $("jCalls").addEventListener("change", (e) => {
    S.jackpot.callsToWin = Math.max(1, Math.min(90, parseInt(e.target.value, 10) || 45)); publish();
  });
  $("jActive").addEventListener("change", (e) => { S.jackpot.active = e.target.checked; publish(); });
  $("copyDisplay").addEventListener("click", () => copy(base() + "display.html?room=" + S.room, "Display link"));
  $("copyJoin").addEventListener("click", () => copy(base() + "index.html?room=" + S.room, "Player link"));
  $("copyRoom").addEventListener("click", () => copy(S.room, "Room code"));

  /* report */
  $("repCsv").addEventListener("click", exportCsv);
  $("repPrint").addEventListener("click", () => window.print());

  /* builder */
  $("bxClose").addEventListener("click", () => $("builder").classList.remove("on"));
  $("bxGo").addEventListener("click", launchGame);
  $("bxAddStage").addEventListener("click", () => { draftStages.push({ key: "line", prize: 1000 }); renderDraft(); });
  $("bxStages").addEventListener("input", (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const [i, f] = k.split(".");
    if (f === "prize") draftStages[+i].prize = parseMoney(e.target.value);
  });
  $("bxStages").addEventListener("change", (e) => {
    const k = e.target.dataset.k;
    if (k && k.endsWith(".key")) {
      draftStages[+k.split(".")[0]].key = e.target.value;
      renderDraft();
    }
  });
  $("bxStages").addEventListener("click", (e) => {
    const d = e.target.closest("button[data-sdel]");
    if (d) { draftStages.splice(+d.dataset.sdel, 1); renderDraft(); }
  });
  $("bxMode").addEventListener("click", (e) => segPick(e, $("bxMode")));
  $("bxSpeed").addEventListener("click", (e) => segPick(e, $("bxSpeed")));
  $("bxSavePreset").addEventListener("click", savePreset);
  $("bxPresets").addEventListener("change", (e) => {
    const p = presets()[e.target.value];
    if (!p) return;
    draftStages = JSON.parse(JSON.stringify(p.stages));
    renderDraft();
  });

  document.addEventListener("keydown", (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (e.code === "Space") { e.preventDefault(); mainAction(); }
    if (e.key === "p" || e.key === "P") $("bPause").click();
    if (e.key === "c" || e.key === "C") $("bCheck").click();
  });
}

function segPick(e, seg) {
  const b = e.target.closest("button");
  if (!b) return;
  Array.from(seg.children).forEach((x) => x.classList.toggle("on", x === b));
}

function base() { return location.href.replace(/console\.html.*$/, ""); }
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(what + " copied"); }
  catch (e) { window.prompt("Copy this " + what.toLowerCase() + ":", text); }
}
function openDisplayWindow() {
  window.open("display.html", "marquee-display", "width=1280,height=720");
  toast("Display opened — drag it to the big screen and press F11");
}

/* ------------------------------------------------------------ main button */

function mainAction() {
  if (!S.game) { openBuilder(); return; }
  if (S.mode === "lobby") {
    startPlay(S);
    lastCallAt = Date.now() - S.game.interval + 800;
    publish(); return;
  }
  if (S.mode === "won") { nextStage(S); pendingWinner = null; lastCallAt = Date.now(); publish(); return; }
  if (S.mode === "play" || S.mode === "check") {
    if (S.game.calls.length >= 90) { toast("All ninety are out"); return; }
    if (S.mode === "check") { clearCheck(S); pendingWinner = null; }
    drawCall(S);
    lastCallAt = Date.now();
    publish();
  }
}

function doAward() {
  const st = currentStage(S);
  if (!S.game || !st) return;
  const typed = $("winName") ? $("winName").value.trim() : "";
  const who = pendingWinner || (typed ? { name: typed } : null);
  if (!who) {
    $("awardRow").classList.remove("hide");
    $("winName").focus();
    toast("Who won it?");
    return;
  }
  if (typed && !pendingWinner) who.name = typed;
  award(S, who);
  pendingWinner = null;
  if ($("winName")) $("winName").value = "";
  claims = [];
  renderClaims();
  publish();
}

/* ------------------------------------------------------------ builder */

let draftStages = JSON.parse(JSON.stringify(DEFAULT_STAGES));

function presets() {
  try {
    const raw = localStorage.getItem(PRESETS);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    standard: { name: "Standard", stages: [{ key: "line", prize: 2000 }, { key: "two", prize: 3000 }, { key: "house", prize: 7500 }] },
    quick: { name: "Quick single", stages: [{ key: "house", prize: 5000 }] },
    big: { name: "Big house", stages: [{ key: "line", prize: 2500 }, { key: "house", prize: 20000 }] },
  };
}
function savePreset() {
  const name = window.prompt("Name this preset:", "My game");
  if (!name) return;
  const all = presets();
  all[name.toLowerCase().replace(/[^a-z0-9]+/g, "-")] = { name, stages: JSON.parse(JSON.stringify(draftStages)) };
  try { localStorage.setItem(PRESETS, JSON.stringify(all)); } catch (e) {}
  fillPresets();
  toast("Preset saved");
}
function fillPresets() {
  const all = presets();
  $("bxPresets").innerHTML = '<option value="">Load a preset…</option>' +
    Object.keys(all).map((k) => '<option value="' + esc(k) + '">' + esc(all[k].name) + "</option>").join("");
}

function openBuilder() {
  $("bxName").value = "Game " + (S.history.length + 1);
  draftStages = JSON.parse(JSON.stringify(DEFAULT_STAGES));
  renderDraft();
  fillPresets();
  $("builder").classList.add("on");
}

function renderDraft() {
  $("bxStages").innerHTML = draftStages.map((st, i) => {
    const opts = Object.keys(STAGE_TYPES).map((k) =>
      '<option value="' + k + '"' + (k === st.key ? " selected" : "") + ">" +
      STAGE_TYPES[k].label + "</option>").join("");
    return '<div class="item"><div class="ih">' +
      '<select class="field" data-k="' + i + '.key" style="flex:1">' + opts + "</select>" +
      '<input class="field mono" data-k="' + i + '.prize" value="' +
        (st.prize / 100).toFixed(2) + '" inputmode="decimal" style="width:110px">' +
      '<button class="mini danger" data-sdel="' + i + '" aria-label="Remove">&#10005;</button>' +
      "</div></div>";
  }).join("");
}

function launchGame() {
  const stages = draftStages.filter((s) => STAGE_TYPES[s.key]);
  if (!stages.length) { toast("Give it at least one prize"); return; }
  const mode = $("bxMode").querySelector(".on").dataset.mode;
  const speed = +$("bxSpeed").querySelector(".on").dataset.speed;
  const lobby = Math.max(0, Math.min(300, parseInt($("bxLobby").value, 10) || 0));
  openLobby(S, {
    name: $("bxName").value.trim() || ("Game " + (S.history.length + 1)),
    stages, interval: speed, autocall: mode === "auto",
    jackpot: $("bxJackpot").checked,
  }, lobby);
  claims = []; pendingWinner = null;
  renderClaims();
  $("builder").classList.remove("on");
  bookCache = bookCache || new Map();
  publish();
  toast("On the board — eyes down in " + lobby + "s");
}

/* ------------------------------------------------------------ validate */

function lookup() {
  const bookNo = parseInt($("bookIn").value, 10);
  const out = $("lookOut");
  if (!isFinite(bookNo) || bookNo < 1) { out.innerHTML = '<div class="verdictbox bad">Give me a book number.</div>'; return; }
  const g = S.game, st = currentStage(S);
  if (!g || !st) { out.innerHTML = '<div class="verdictbox bad">No game running to check against.</div>'; return; }

  const res = validate(S.perm, bookNo, g.calls, st.rows);
  const book = res.book || bookFor(S.perm, bookNo);
  const called = new Set(g.calls);
  const winTicket = res.ok ? res.ticket : -1;

  out.innerHTML =
    '<div class="ticketset">' + book.map((t, i) => {
      let cells = "";
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 9; c++) {
          const v = t[r][c];
          if (v == null) { cells += '<span class="blank"></span>'; continue; }
          const hit = called.has(v);
          cells += '<span class="' + (hit ? "hit" : "") + '">' + v + "</span>";
        }
      }
      return '<div class="tk ' + (i === winTicket ? "win" : "") + '">' +
        '<div class="th"><span>Ticket ' + (i + 1) + "</span>" +
        (i === winTicket ? "<b>WINNER</b>" : "") + "</div>" +
        '<div class="tkgrid">' + cells + "</div></div>";
    }).join("") + "</div>" +
    '<div class="verdictbox ' + (res.ok ? "good" : "bad") + '">' +
      (res.ok
        ? "Valid — ticket " + (res.ticket + 1) + " completed " + st.label.toLowerCase() +
          " on call " + (res.call + 1) + " (number " + res.number + ")" +
          (res.late > 0 ? ", " + res.late + " ball" + (res.late === 1 ? "" : "s") + " ago" : "")
        : "Not on — closest ticket is " + res.toGo + " number" + (res.toGo === 1 ? "" : "s") +
          " off " + st.label.toLowerCase()) +
    "</div>" +
    (res.ok ? '<button class="btn ok wide sm" id="awardBook" style="margin-top:10px">Award this book</button>' : "");

  if (res.ok) {
    const seat = S.seats.find((x) => x.book === bookNo);
    pendingWinner = { name: seat ? seat.name : "Book " + bookNo, book: bookNo, ticket: res.ticket };
    openCheck(S, { name: pendingWinner.name, book: bookNo });
    setCheckResult(S, { ok: true, text: st.label + " — valid" });
    publish();
    const btn = $("awardBook");
    if (btn) btn.addEventListener("click", doAward);
  } else {
    if (S.mode === "check") {
      setCheckResult(S, { ok: false, text: "Not on — play on" });
      publish();
    }
  }
}

/* ============================================================ render */

function render() {
  renderLive();
  renderSeats();
  const g = S.game;

  const mode = { idle: "Idle", lobby: "Eyes down", play: "Calling", check: "Checking",
    won: "Winner", interval: "Interval", quiz: "Quiz" }[S.mode] || S.mode;
  const chip = $("modeChip");
  chip.className = "chip " + (S.mode === "play" ? "on" : S.mode === "check" ? "bad" : S.mode === "won" ? "warn" : "");
  chip.innerHTML = "<i></i>" + mode;
  $("seatChip").textContent = S.seats.length + (S.seats.length === 1 ? " in the room" : " in the room");

  /* main button wears whatever the moment needs */
  const b = $("bMain");
  if (!g) { b.textContent = "New game"; b.className = "btn go span2 huge"; }
  else if (S.mode === "lobby") { b.textContent = "Start calling"; b.className = "btn go span2 huge"; }
  else if (S.mode === "won") {
    const last = g.stageIndex >= g.stages.length - 1;
    b.textContent = last ? "Finish game" : "Next prize";
    b.className = "btn go span2 huge";
  } else { b.textContent = "Call next"; b.className = "btn go span2 huge"; }

  $("bPause").textContent = g && g.paused ? "Resume" : "Pause";
  $("bPause").disabled = !g || S.mode === "lobby";
  $("bCheck").textContent = S.mode === "check" ? "Back to play" : "Check";
  $("bCheck").disabled = !g || S.mode === "lobby";
  $("bAward").disabled = !g || S.mode === "lobby" || S.mode === "won";
  $("bEnd").disabled = !g;
  $("bUndo").disabled = !g || !g.calls.length;

  $("awardRow").classList.toggle("hide", !(g && (S.mode === "check" || S.mode === "play")));

  if (g) {
    Array.from($("modeSeg").children).forEach((x) =>
      x.classList.toggle("on", (x.dataset.mode === "auto") === !!g.autocall));
    Array.from($("speedSeg").children).forEach((x) =>
      x.classList.toggle("on", +x.dataset.speed === g.interval));
    $("padWrap").classList.toggle("hide", !!g.autocall);
    const st = currentStage(S);
    $("stageLabel").textContent = st ? st.label + " · " + money(st.prize, S.currency) : "—";
  } else {
    $("padWrap").classList.add("hide");
    $("stageLabel").textContent = "—";
  }

  const called = new Set(g ? g.calls : []);
  Array.from($("pad").children).forEach((btn) => {
    btn.disabled = called.has(+btn.dataset.n);
  });
}

function renderLive() {
  const g = S.game;
  const calls = g ? g.calls : [];
  const cur = calls.length ? calls[calls.length - 1] : 0;
  const ball = $("cBall");
  if (cur) { ball.className = "ball"; ball.textContent = cur; }
  else { ball.className = "ball blank"; ball.textContent = "—"; }

  if (!g) {
    $("cNick").textContent = "No game running";
    $("cSub").textContent = S.history.length ? "Interval — build the next game" : "Build a game to get started";
  } else if (S.mode === "lobby") {
    const left = Math.max(0, Math.ceil((g.lobbyUntil - Date.now()) / 1000));
    $("cNick").textContent = g.name;
    $("cSub").textContent = "Eyes down in " + left + "s";
  } else {
    $("cNick").textContent = cur ? NICK[cur] : g.name;
    $("cSub").textContent = g.paused ? "Caller stopped" : (g.autocall ? "Auto calling" : "Manual calling");
  }
  $("cCalled").textContent = calls.length;
  $("cSharp").textContent = S.stats ? S.stats.sharp : 0;
  $("cTape").innerHTML = calls.slice(-5, -1).reverse()
    .map((n) => '<span class="ball">' + n + "</span>").join("");
}

function renderSeats() {
  const el = $("seats");
  if (!S.seats.length) {
    el.innerHTML = '<span style="border:none;background:none;color:var(--faint);padding:0">Nobody yet</span>';
    return;
  }
  el.innerHTML = S.seats.map((s) =>
    "<span>" + esc(s.name) + "<b>" + s.book + "</b></span>").join("");
}

function renderClaims() {
  const el = $("claims");
  $("claimCount").textContent = claims.length ? claims.length + " in" : "none";
  if (!claims.length) {
    el.innerHTML = '<span style="color:var(--faint)">Claims from phones land here, already checked.</span>';
    return;
  }
  el.innerHTML = claims.map((c, i) =>
    '<div class="claim ' + (c.ok ? "ok" : "no") + '">' +
    '<span class="nm">' + esc(c.name) + "</span>" +
    '<span class="dt">' + esc(c.text) + "</span>" +
    (c.ok ? '<button class="btn sm ok" data-claim="' + i + '">Award</button>' : "") +
    "</div>").join("");
}

/* ------------------------------------------------------------ media pane */

function renderSlides() {
  $("noticeIn").value = S.notice || "";
  $("slideList").innerHTML = S.media.slides.map((s, i) =>
    '<div class="item">' +
      '<div class="ih"><span class="t">' + esc(s.title || "Untitled") + "</span>" +
        '<button class="mini" data-up="' + i + '" aria-label="Move up">&#9650;</button>' +
        '<button class="mini" data-now="' + i + '" aria-label="Show now">&#9654;</button>' +
        '<button class="mini danger" data-del="' + i + '" aria-label="Delete">&#10005;</button></div>' +
      '<input class="field" data-k="' + i + '.title" value="' + esc(s.title) + '" placeholder="Headline">' +
      '<input class="field" data-k="' + i + '.body" value="' + esc(s.body) + '" placeholder="Line underneath">' +
    "</div>").join("") ||
    '<span style="color:var(--faint)">No slides yet.</span>';
}

/* ------------------------------------------------------------ quiz pane */

function quizSeconds() {
  const on = $("qSecs").querySelector(".on");
  return on ? +on.dataset.s : 20;
}

function renderQuizPane() {
  const q = S.quiz;
  $("quizState").textContent = q ? ("question " + (q.index + 1) + " of " + q.questions.length) : "not running";
  $("qNext").disabled = !q;
  $("qReveal").disabled = !q || q.index < 0 || q.revealed;
  $("qClose").disabled = !q;
  $("qStart").textContent = q ? "Restart the round" : "Start the round";
  $("qLive").textContent = q
    ? (q.index < 0 ? "Round open — press Next question." :
       (Object.keys(q.answers).length + " answered" + (q.revealed ? " · answer shown" : "")))
    : "";

  $("qList").innerHTML = quizRound.questions.map((qq, i) =>
    '<div class="item">' +
      '<div class="ih"><span class="t">' + (i + 1) + ". " + esc(qq.q) + "</span>" +
      '<button class="mini danger" data-qdel="' + i + '" aria-label="Delete">&#10005;</button></div>' +
      '<input class="field" data-k="' + i + '.q" value="' + esc(qq.q) + '">' +
      '<div class="two">' + qq.options.map((o, j) =>
        '<div class="row tight"><input class="field" data-k="' + i + ".o." + j + '" value="' + esc(o) +
        '" placeholder="Answer ' + "ABCD"[j] + '">' +
        '<button class="mini ' + (qq.answer === j ? "" : "") + '" data-ans="' + i + "." + j + '" ' +
        'style="' + (qq.answer === j ? "background:var(--mint);color:#04150D" : "") + '" ' +
        'aria-label="Mark correct">&#10003;</button></div>').join("") +
      "</div>" +
    "</div>").join("") || '<span style="color:var(--faint)">No questions yet.</span>';
}

/* ------------------------------------------------------------ report */

function renderReport() {
  const t = sessionTotals(S);
  const mins = Math.round((Date.now() - S.openedAt) / 60000);
  $("repTiles").innerHTML =
    tile("Games played", t.games) +
    tile("In the room", S.seats.length) +
    tile("Prizes paid", money(t.paid, S.currency), "gold") +
    tile("Jackpot paid", money(t.jackpot, S.currency), "mint") +
    tile("Session length", mins + "m") +
    tile("Books in play", (S.books.to - S.books.from + 1));

  const rows = [];
  for (const g of S.history) {
    for (const st of g.stages) {
      rows.push("<tr><td>" + g.no + "</td><td>" + esc(g.name) + "</td><td>" + esc(st.label) + "</td>" +
        "<td>" + (st.won ? esc(st.won.name) : "<span style='color:var(--faint)'>not won</span>") + "</td>" +
        '<td class="num">' + (st.won && st.won.book ? st.won.book : "—") + "</td>" +
        '<td class="num">' + (st.won ? st.won.call : "—") + "</td>" +
        '<td class="num">' + money(st.won ? st.prize : 0, S.currency) +
          (st.won && st.won.jackpot ? " +" + money(st.won.jackpot, S.currency) : "") + "</td></tr>");
    }
  }
  $("repTable").innerHTML = rows.length
    ? '<table class="rep"><thead><tr><th>#</th><th>Game</th><th>Prize</th><th>Winner</th>' +
      "<th>Book</th><th>Calls</th><th>Paid</th></tr></thead><tbody>" + rows.join("") + "</tbody></table>"
    : '<div style="padding:18px;color:var(--faint)">Nothing played yet this session.</div>';
}

function tile(k, v, cls) {
  return '<div class="tile ' + (cls || "") + '"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + "</div></div>";
}

function exportCsv() {
  const lines = [["Game", "Name", "Prize", "Winner", "Book", "Ticket", "Calls", "Amount", "Jackpot"].join(",")];
  for (const g of S.history) {
    for (const st of g.stages) {
      lines.push([g.no, '"' + g.name + '"', '"' + st.label + '"',
        '"' + (st.won ? st.won.name : "") + '"',
        st.won && st.won.book ? st.won.book : "",
        st.won && st.won.ticket != null ? st.won.ticket + 1 : "",
        st.won ? st.won.call : "",
        st.won ? (st.prize / 100).toFixed(2) : "0.00",
        st.won && st.won.jackpot ? (st.won.jackpot / 100).toFixed(2) : ""].join(","));
    }
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "marquee-session.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast("Session exported");
}

/* ------------------------------------------------------------ setup */

function fillSetup() {
  $("sVenue").value = S.venue;
  $("sFrom").value = S.books.from;
  $("sTo").value = S.books.to;
  $("sCur").value = S.currency;
  $("sPerm").value = S.perm;
  $("jName").value = S.jackpot.name;
  $("jAmount").value = (S.jackpot.amount / 100).toFixed(2);
  $("jCalls").value = S.jackpot.callsToWin;
  $("jActive").checked = !!S.jackpot.active;
}

/* ------------------------------------------------------------ pad */

function buildPad() {
  let h = "";
  for (let n = 1; n <= 90; n++) h += '<button data-n="' + n + '">' + n + "</button>";
  $("pad").innerHTML = h;
}

/* ============================================================ go */

if (gateSession.isOpen() && CREDENTIALS && cryptoAvailable()) openConsole();
