/* Marquee — the player's phone.

   Holds nothing the console can't rebuild: a book number and which numbers this player
   has dabbed. The tickets themselves come out of the perm, so the caller can always
   check the claim against the same six tickets the player is looking at. */

import {
  NICK, bookFor, toGo, winningCall, money, prizeLabel, normaliseCode, mulberry32,
  bookFingerprint,
} from "./core.js";
import { joinRoom } from "./bus.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const LS = {
  get(k, d) { try { const v = localStorage.getItem("mq." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("mq." + k, JSON.stringify(v)); } catch (e) {} },
};

let S = null;              // the room, as last sent
let link = null;
let book = null;           // our six tickets
let bookNo = 0;
let perm = 0;
let claimedAt = -1;
let lastBall = -1;
let lastCallCount = -1;
let answered = -1;
let builtFor = "";
let me = {
  name: LS.get("name", ""),
  dab: LS.get("dab", "#FF2E88"),
  voice: LS.get("voice", false),
};

const dabKey = () => "dabs." + perm + "." + bookNo + "." + (S && S.game ? S.game.no : 0);
const dabs = () => new Set(LS.get(dabKey(), []));
const saveDabs = (s) => LS.set(dabKey(), Array.from(s));

/* ---------------------------------------------------------------- door */

$("nameIn").value = me.name;
{
  const p = new URLSearchParams(location.search);
  const r = p.get("room");
  if (r) $("codeIn").value = normaliseCode(r);
}
$("codeIn").addEventListener("input", (e) => {
  const at = e.target.selectionStart;
  e.target.value = normaliseCode(e.target.value);
  e.target.setSelectionRange(at, at);
});

$("joinForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("nameIn").value.trim();
  const room = normaliseCode($("codeIn").value);
  if (!name) return door("Give the caller a name to shout.", "err");
  if (room.length !== 5) return door("Room codes are five characters.", "err");
  me.name = name; LS.set("name", name);
  join(room);
});

function door(msg, kind) {
  const el = $("doorMsg");
  el.className = "msg " + (kind || "");
  el.innerHTML = msg;
}

/* ---------------------------------------------------------------- join */

function join(room) {
  $("joinBtn").disabled = true;
  door("Knocking…");
  history.replaceState(null, "", "?room=" + room);
  joinRoom(room, () => ({ name: me.name, role: "player" }), {
    onStatus(state, detail) {
      if (state === "open") {
        chip("In the room", true);
        $("door").classList.add("hide");
        $("hall").classList.remove("hide");
        $("pName").textContent = me.name;
        $("joinBtn").disabled = false;
      } else if (state === "no-room") {
        $("joinBtn").disabled = false;
        door("Nothing answering to <b>" + esc(detail) + "</b>. Check with the caller.", "err");
        chip("Looking", false);
      } else if (state === "failed") {
        $("joinBtn").disabled = false;
        door("Couldn't load the connection library — check you're online.", "err");
      } else if (state === "reconnecting" || state === "connecting") {
        chip("Reconnecting", false);
      }
    },
    onMessage: handle,
  }).then((l) => { link = l; });
}

function chip(text, on) {
  const el = $("pLink");
  el.className = "chip " + (on ? "on" : "off");
  el.innerHTML = "<i></i>" + esc(text);
}

/* Build the six tickets, and never let a stale set survive a change of perm — a new perm
   reissues every book in the room, so the phone has to draw again or it ends up dabbing
   tickets the caller is no longer checking against. */
function setBook(newPerm, newBookNo) {
  const p = newPerm >>> 0, n = newBookNo | 0;
  if (p === perm && n === bookNo && book) return;
  perm = p; bookNo = n;
  book = (perm && bookNo) ? bookFor(perm, bookNo) : null;
  builtFor = "";                       // the drawn tickets on screen are now wrong
  if (bookNo) $("pBook").textContent = "Book " + bookNo;
}

function handle(msg) {
  if (msg.t === "seat") {
    setBook(msg.perm, msg.book);
    if (msg.fp && (msg.fp >>> 0) !== bookFingerprint()) {
      say("<b>This phone is building different tickets to the caller's screen.</b> " +
        "Don't play on it — tell the caller.", "bad");
      $("pBook").textContent = "Book " + bookNo + " — mismatch";
    }
    render();
    return;
  }
  if (msg.t === "state") {
    const before = S && S.game ? S.game.no : -1;
    S = msg.s;
    if (S.game && S.game.no !== before) { claimedAt = -1; lastCallCount = -1; answered = -1; }
    if (S.perm) setBook(S.perm, bookNo);
    render();
    return;
  }
  if (msg.t === "kicked") {
    if (link) link.close();
    link = null;
    $("hall").classList.add("hide");
    $("door").classList.remove("hide");
    $("joinBtn").disabled = false;
    door(msg.reason === "banned"
      ? "The caller has barred you from this room."
      : "The caller has taken you out of the room. You can ask to come back in.", "err");
    return;
  }
  if (msg.t === "verdict") {
    say(msg.ok ? "<b>Valid.</b> " + esc(msg.text) : "Not this time — " + esc(msg.text),
      msg.ok ? "good" : "bad");
  }
}

/* ------------------------------------------------------- the room screen, small */

(function buildMiniBoard() {
  let h = "";
  for (let n = 1; n <= 90; n++) h += "<b>" + n + "</b>";
  $("mBoard").innerHTML = h;
})();

let miniOn = LS.get("mini", true);
function setMini(on) {
  miniOn = !!on;
  LS.set("mini", miniOn);
  $("screenBtn").setAttribute("aria-pressed", String(miniOn));
  $("mini").classList.toggle("hide", !miniOn || !S || S.mode === "quiz");
}
$("screenBtn").addEventListener("click", () => setMini(!miniOn));

/* The same picture the hall is looking at, at a tenth the size: what's been called,
   what's being played for, and whatever the big screen is shouting about. */
function renderMini() {
  const show = miniOn && S && S.mode !== "quiz";
  $("mini").classList.toggle("hide", !show);
  if (!show) return;

  const g = S.game;
  const calls = g ? g.calls || [] : [];
  const cur = calls.length ? calls[calls.length - 1] : 0;

  $("mVenue").textContent = S.venue;
  $("mGame").textContent = g
    ? g.name + " · " + calls.length + "/90"
    : (S.mode === "interval" ? "Interval" : "Between games");

  const on = new Set(calls);
  const cells = $("mBoard").children;
  for (let n = 1; n <= 90; n++) {
    cells[n - 1].classList.toggle("on", on.has(n));
    cells[n - 1].classList.toggle("now", n === cur);
  }

  $("mPrizes").innerHTML = g ? g.stages.map((st, i) =>
    '<span class="mprize ' + (st.won ? "won" : (i === g.stageIndex ? "now" : "")) + '">' +
    '<span class="n">' + esc(st.label) + "</span>" +
    '<span class="a">' + (st.won ? esc(st.won.name || "Won") : esc(prizeLabel(st, S.currency))) +
    "</span></span>").join("")
    : (S.jackpot && S.jackpot.active
        ? '<span class="mprize now"><span class="n">' + esc(S.jackpot.name) +
          '</span><span class="a">' + money(S.jackpot.amount, S.currency) + "</span></span>"
        : "");

  const note = $("mNote");
  if (S.mode === "check" && S.check) {
    note.className = "mnote " + (S.check.result && !S.check.result.ok ? "bad" : "check");
    note.textContent = (S.check.result ? S.check.result.text + " — " : "Check — ") +
      (S.check.name || (S.check.book ? "Book " + S.check.book : ""));
  } else if (S.mode === "won" && g) {
    const st = g.stages[g.stageIndex];
    note.className = "mnote won";
    note.textContent = st && st.won
      ? st.won.name + " takes " + st.label.toLowerCase() + " — " + prizeLabel(st, S.currency)
      : "Winner";
  } else if (S.notice) {
    note.className = "mnote";
    note.style.color = "var(--muted)";
    note.textContent = S.notice;
  } else {
    note.className = "mnote hide";
    return;
  }
  note.classList.remove("hide");
}

/* ---------------------------------------------------------------- render */

function say(html, kind) {
  const el = $("say");
  el.className = "say" + (kind ? " " + kind : "");
  el.innerHTML = html;
}

function render() {
  if (!S) return;
  const g = S.game;
  renderMini();

  if (S.mode === "quiz" && S.quiz) {
    builtFor = "";
    $("callstrip").classList.add("hide");
    return renderQuiz();
  }

  if (!g) {
    $("pBody").innerHTML =
      '<div class="card"><h2>' + esc(S.venue) + "</h2>" +
      "<p>" + (S.mode === "interval" ? "Interval — next game shortly." : "Waiting for the next game.") +
      "</p>" + (S.notice ? '<p style="margin-top:10px;color:var(--amber)">' + esc(S.notice) + "</p>" : "") +
      "</div>" + sheetPreview();
    $("callstrip").classList.add("hide");
    $("bingoBtn").disabled = true;
    say("Sit tight.");
    lastBall = -1; lastCallCount = -1; builtFor = "";
    return;
  }

  if (S.mode === "lobby") {
    const left = Math.max(0, Math.ceil((g.lobbyUntil - Date.now()) / 1000));
    $("pBody").innerHTML =
      '<div class="card"><h2>' + esc(g.name) + "</h2>" +
      '<div class="big">' + left + "</div><p>Eyes down</p>" +
      '<p style="margin-top:10px">' + g.stages.map((s) =>
        esc(s.label) + " " + esc(prizeLabel(s, S.currency))).join(" · ") + "</p></div>" + sheetPreview();
    $("callstrip").classList.add("hide");
    $("bingoBtn").disabled = true;
    builtFor = "";
    say("Book " + bookNo + " is yours for this one.");
    return;
  }

  /* in play — build the book once, then only ever patch it. Rebuilding the DOM under
     someone's thumb loses their scroll position and swallows taps. */
  const calls = g.calls || [];
  const cur = calls.length ? calls[calls.length - 1] : 0;
  const want = g.no + "/" + bookNo + "/" + perm;
  $("callstrip").classList.remove("hide");
  if (builtFor !== want) {
    builtFor = want;
    $("pBody").innerHTML = '<div class="book" id="bookBox"></div>';
    drawBook(calls);
    lastCallCount = -1;
  }
  if (lastCallCount !== calls.length) {
    if (lastCallCount >= 0 && calls.length > lastCallCount) claimedAt = -1;
    lastCallCount = calls.length;
    if (me.voice && cur && cur !== lastBall && !g.paused) speak(cur);
    lastBall = cur;
    refreshCells(calls);
  }
  updateStrip(g, calls, cur);
  updateClaim(g, calls);
}

/* only the classes change from here on */
function refreshCells(calls) {
  const called = new Set(calls);
  const marked = dabs();
  document.querySelectorAll("#bookBox .cell[data-n]").forEach((el) => {
    const n = +el.dataset.n;
    const d = marked.has(n);
    el.classList.toggle("dabbed", d);
    el.classList.toggle("callable", !d && called.has(n));
  });
}

function updateStrip(g, calls, cur) {
  const b = $("pBall");
  if (!b) return;
  const st = g.stages[g.stageIndex];
  if (b.textContent !== String(cur || "—")) {
    b.textContent = cur || "—";
    b.className = "ball" + (cur ? "" : " blank");
  }
  $("pNick").textContent = g.paused ? "Caller stopped" : (cur ? NICK[cur] : "Eyes down");
  $("pMeta").textContent = (st ? st.label + " · " + prizeLabel(st, S.currency) : "") +
    " · " + calls.length + " called";
  $("pTape").innerHTML = calls.slice(-5, -1).reverse()
    .map((n) => '<span class="ball">' + n + "</span>").join("");
}

function drawBook(calls) {
  const box = $("bookBox");
  if (!box || !book) return;
  const marked = dabs();
  const called = new Set(calls);
  const rnd = mulberry32(bookNo * 2654435761 % 4294967295);
  box.innerHTML = book.map((t, i) => {
    let cells = "";
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 9; c++) {
        const v = t[r][c];
        if (v == null) { cells += '<span class="cell blank"></span>'; continue; }
        let cls = "cell";
        if (marked.has(v)) cls += " dabbed";
        else if (called.has(v)) cls += " callable";
        cells += '<button class="' + cls + '" data-n="' + v + '" style="--rot:' +
          (rnd() * 26 - 13).toFixed(1) + 'deg">' + v + "</button>";
      }
    }
    return '<div class="ticket" data-t="' + i + '">' +
      '<div class="th"><span>Ticket ' + (i + 1) + "</span>" +
        '<span class="togo" data-togo="' + i + '"></span>' +
        "<b>" + bookNo + " / " + (i + 1) + "</b></div>" +
      '<div class="tgrid">' + cells + "</div></div>";
  }).join("");
  paintTickets(calls);
}

/* mark which tickets are close, and which have it */
function paintTickets(calls) {
  if (!S || !S.game || !book) return;
  const st = S.game.stages[S.game.stageIndex];
  if (!st) return;
  const marked = dabs();
  document.querySelectorAll("#bookBox .ticket").forEach((el) => {
    const i = +el.dataset.t;
    const g = toGo(book[i], marked, st.rows);
    el.classList.toggle("live", g === 0);
    el.classList.toggle("sharp", g === 1);
    const tag = el.querySelector("[data-togo]");
    if (tag) tag.textContent = g === 0 ? "on" : (g <= 3 ? g + " to go" : "");
  });
}

/* The button is live whenever a prize is: you can call whenever you like, and be wrong
   about it, exactly as you can in a hall. What changes is how loudly it invites you. */
function updateClaim(g, calls) {
  const btn = $("bingoBtn");
  if (!book) { btn.disabled = true; return; }
  const st = g.stages[g.stageIndex];
  if (!st) { btn.disabled = true; return; }
  const marked = dabs();

  let best = -1, bestT = -1;
  for (let t = 0; t < 6; t++) {
    if (toGo(book[t], marked, st.rows) !== 0) continue;   // only what they have actually dabbed
    const wc = winningCall(book[t], calls, st.rows);
    if (wc >= 0 && (best < 0 || wc < best)) { best = wc; bestT = t; }
  }
  paintTickets(calls);

  const thisCall = calls.length - 1;
  const alreadyIn = claimedAt === thisCall;
  const canCall = S.mode === "play" && !alreadyIn && calls.length > 0;
  const onNow = bestT >= 0 && best === thisCall;

  btn.disabled = !canCall;
  btn.classList.toggle("hot", canCall && onNow);
  btn.dataset.ticket = bestT;
  btn.dataset.call = thisCall;

  if (alreadyIn) { say("Claim's in with the caller.", "good"); return; }
  if (S.mode === "check") { say("Caller's checking a claim."); return; }
  if (g.paused) { say("Caller stopped."); return; }
  if (onNow) { say("You're on for <b>" + esc(st.label) + "</b> — call it now!"); return; }
  if (bestT >= 0) { say("Ticket " + (bestT + 1) + " came on, but the <b>ball's moved on</b>.", "bad"); return; }

  /* how close are they, so a false call is at least an informed one */
  let closest = 99;
  for (let t = 0; t < 6; t++) closest = Math.min(closest, toGo(book[t], marked, st.rows));
  say(closest === 1
    ? "One number off. Call it when it comes."
    : "Dab your numbers as they come" + (closest < 90 ? " — " + closest + " off a " +
      esc(st.label.toLowerCase()) + "." : "."));
}

function sheetPreview() {
  if (!book) return "";
  return '<div class="sheetlist"><span>Your book: <b>' + bookNo + "</b></span>" +
    (S && S.jackpot && S.jackpot.active
      ? "<span>" + esc(S.jackpot.name) + ": " + money(S.jackpot.amount, S.currency) +
        " in " + S.jackpot.callsToWin + "</span>" : "") + "</div>";
}

/* ---------------------------------------------------------------- quiz */

function renderQuiz() {
  const q = S.quiz;
  $("bingoBtn").disabled = true;
  if (!q.question) {
    $("pBody").innerHTML = '<div class="card"><h2>' + esc(q.name) + "</h2><p>Hands on buzzers.</p></div>";
    say("Question coming up.");
    return;
  }
  const keys = ["A", "B", "C", "D"];
  $("pBody").innerHTML = '<div class="qwrap"><div class="qq">' + esc(q.question.q) + "</div>" +
    q.question.options.map((o, i) => {
      let cls = "qbtn";
      if (answered === i) cls += " picked";
      if (q.revealed) cls += (q.question.answer === i ? " right" : " wrong");
      return '<button class="' + cls + '" data-choice="' + i + '"' +
        (q.revealed || answered >= 0 ? " disabled" : "") + ">" +
        '<span class="k">' + keys[i] + "</span><span>" + esc(o) + "</span></button>";
    }).join("") + "</div>";
  say(q.revealed ? "Answer's up." : (answered >= 0 ? "Locked in." : "Pick one."));
}

$("pBody").addEventListener("click", (e) => {
  const q = e.target.closest("button[data-choice]");
  if (q) {
    if (answered >= 0 || !link) return;
    answered = +q.dataset.choice;
    link.send({ t: "answer", choice: answered });
    renderQuiz();
    return;
  }
  const cell = e.target.closest(".cell[data-n]");
  if (!cell || !S || !S.game) return;
  const n = +cell.dataset.n;
  const calls = S.game.calls || [];
  /* your dabber, your business — mark whatever you like. The caller checks the ticket
     against the numbers actually called, so a wrong dab just makes for a false call. */
  const set = dabs();
  if (set.has(n)) { set.delete(n); saveDabs(set); cell.classList.remove("dabbed"); }
  else {
    set.add(n); saveDabs(set);
    cell.classList.add("dabbed"); cell.classList.remove("callable");
  }
  updateClaim(S.game, calls);
});

$("bingoBtn").addEventListener("click", () => {
  const btn = $("bingoBtn");
  if (btn.disabled || !link || !S || !S.game) return;
  const st = S.game.stages[S.game.stageIndex];
  claimedAt = +btn.dataset.call;
  link.send({
    t: "claim", book: bookNo, ticket: +btn.dataset.ticket,
    call: +btn.dataset.call, stage: st ? st.key : "line",
  });
  btn.disabled = true;
  btn.classList.remove("hot");
  say("Claim's in with the caller.", "good");
});

/* ---------------------------------------------------------------- chrome */

const DABS = [["#FF2E88", "Magenta"], ["#FF7A1A", "Orange"], ["#2FB8FF", "Blue"],
  ["#57D06A", "Green"], ["#A97BFF", "Violet"], ["#FFD400", "Yellow"]];

$("swatches").innerHTML = DABS.map((d) =>
  '<button data-c="' + d[0] + '" title="' + d[1] + '" aria-label="' + d[1] +
  '" style="background:' + d[0] + '" aria-pressed="' + (d[0] === me.dab) + '"></button>').join("");
$("swatches").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-c]");
  if (!b) return;
  me.dab = b.dataset.c; LS.set("dab", me.dab);
  document.documentElement.style.setProperty("--dab", me.dab);
  Array.from($("swatches").children).forEach((x) =>
    x.setAttribute("aria-pressed", String(x.dataset.c === me.dab)));
});
$("pSettings").addEventListener("click", () => $("setDlg").showModal());
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-close]");
  if (c) { const d = c.closest("dialog"); if (d) d.close(); }
});
$("voiceChk").checked = me.voice;
$("voiceChk").addEventListener("change", (e) => { me.voice = e.target.checked; LS.set("voice", me.voice); });
$("leaveBtn").addEventListener("click", () => { if (link) link.close(); location.href = location.pathname; });

function speak(n) {
  if (!("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(n < 10 ? "On its own, number " + n : NICK[n] + ", " + n);
    u.rate = 0.95; u.pitch = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {}
}

document.documentElement.style.setProperty("--dab", me.dab);
setMini(miniOn);
setInterval(() => { if (S && S.mode === "lobby") render(); }, 300);
