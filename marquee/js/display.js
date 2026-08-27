/* Marquee — the room display (our BiGD).

   It holds no state of its own beyond what the console last sent it. Every screen here
   is a pure render of that object, which is why the display can be closed, reopened or
   moved to another machine mid-game and pick up exactly where the room is. */

import { NICK, money, prizeLabel, isCash } from "./core.js";
import { joinRoom } from "./bus.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const params = new URLSearchParams(location.search);
const ROOM = (params.get("room") || "").toUpperCase().slice(0, 6) || null;

let S = null;             // last session we were sent
let lastBall = -1;
let lastMode = "";
let slideTimer = 0;
let link = null;

/* ---------------------------------------------------------------- board */
(function buildBoard() {
  let h = "";
  for (let n = 1; n <= 90; n++) h += "<b>" + n + "</b>";
  $("board").innerHTML = h;
})();

/* ---------------------------------------------------------------- views */
function show(id) {
  ["vWaiting", "vMedia", "vLobby", "vPlay", "vCheck", "vWon", "vQuiz"].forEach((v) => {
    $(v).classList.toggle("on", v === id);
  });
}

function prizeRail(g, currency, into) {
  if (!g) { into.innerHTML = ""; return; }
  into.innerHTML = g.stages.map((st, i) => {
    const cls = st.won ? "won" : (i === g.stageIndex ? "now" : "");
    return '<div class="prize ' + cls + '">' +
      '<span class="nm">' + esc(st.label) + "</span>" +
      '<span class="amt' + (isCash(st) ? "" : " words") + '">' +
        (st.won ? esc(st.won.name || "Won") : esc(prizeLabel(st, currency))) + "</span>" +
      "</div>";
  }).join("");
}

/* ---------------------------------------------------------------- render */
function render() {
  if (!S) { show("vWaiting"); return; }

  $("venue").textContent = S.venue;
  $("joinCode").textContent = S.room || "—";
  $("notice").textContent = S.notice || "";

  const g = S.game;
  const jp = S.jackpot;
  $("jpSlot").classList.toggle("hide", !(jp && jp.active));
  $("div2").classList.toggle("hide", !(jp && jp.active));
  if (jp && jp.active) {
    $("jpAmount").textContent = jp.won ? "WON" : money(jp.amount, S.currency);
  }

  if (g) {
    $("gameName").textContent = g.name;
    const st = g.stages[g.stageIndex];
    $("stageSlot").classList.remove("hide");
    $("stageName").textContent = st ? st.label + "  " + prizeLabel(st, S.currency) : "—";
  } else {
    $("gameName").textContent = S.mode === "interval" ? "Interval" : "—";
    $("stageSlot").classList.add("hide");
  }

  /* sharps only mean anything while a game is live */
  const sharpOn = !!(g && S.stats && S.stats.sharp > 0 && (S.mode === "play" || S.mode === "check"));
  $("sharpBox").classList.toggle("hide", !sharpOn);
  if (sharpOn) $("sharpN").textContent = S.stats.sharp;

  switch (S.mode) {
    case "lobby": renderLobby(g); break;
    case "play": renderPlay(g); break;
    case "check": renderCheck(); break;
    case "won": renderWon(g); break;
    case "quiz": renderQuiz(); break;
    default: renderMedia(); break;
  }
  lastMode = S.mode;
}

function renderLobby(g) {
  show("vLobby");
  $("lobbyName").textContent = g ? g.name : "Next game";
  prizeRail(g, S.currency, $("lobbyPrizes"));
  tickLobby();
}

function tickLobby() {
  if (!S || S.mode !== "lobby" || !S.game) return;
  const left = Math.max(0, Math.ceil((S.game.lobbyUntil - Date.now()) / 1000));
  $("lobbyCount").textContent = left;
  $("lobbyWord").textContent = left > 0 ? "Eyes down in" : "Eyes down";
}

function renderPlay(g) {
  show("vPlay");
  if (!g) return;
  const calls = g.calls || [];
  const cur = calls.length ? calls[calls.length - 1] : 0;

  const ball = $("bigBall");
  if (cur !== lastBall) {
    lastBall = cur;
    if (cur) {
      ball.className = "ball bigball drop";
      ball.textContent = cur;
      $("nickname").textContent = NICK[cur] || "";
      setTimeout(() => { if (ball.classList.contains("drop")) ball.className = "ball bigball"; }, 520);
    } else {
      ball.className = "ball bigball blank";
      ball.textContent = "Eyes down";
      $("nickname").textContent = "";
    }
  }
  if (g.paused && cur) $("nickname").textContent = "Caller stopped";

  $("calledN").textContent = calls.length;
  $("leftN").textContent = 90 - calls.length;
  $("boardCount").textContent = calls.length + " / 90";

  const rec = calls.slice(-6, -1).reverse();
  $("recentBalls").innerHTML = rec.map((n) => '<span class="ball">' + n + "</span>").join("");

  const on = new Set(calls);
  const cells = $("board").children;
  for (let n = 1; n <= 90; n++) {
    cells[n - 1].classList.toggle("on", on.has(n));
    cells[n - 1].classList.toggle("now", n === cur);
  }

  prizeRail(g, S.currency, $("playPrizes"));
}

function renderCheck() {
  show("vCheck");
  const c = S.check || {};
  $("checkWho").textContent = c.name ? c.name : (c.book ? "Book " + c.book : "");
  const v = $("checkVerdict");
  if (c.result) {
    v.classList.remove("hide");
    v.className = "verdict " + (c.result.ok ? "good" : "bad");
    v.textContent = c.result.text;
    $("checkSub").textContent = c.result.ok ? "Valid claim" : "Not this time";
  } else {
    v.classList.add("hide");
    $("checkSub").textContent = "Caller stopped — validating the ticket";
  }
}

function renderWon(g) {
  show("vWon");
  if (!g) return;
  const st = g.stages[g.stageIndex];
  if (!st || !st.won) return;
  $("wonStage").textContent = st.label;
  const amt = $("wonAmount");
  amt.className = "amount" + (isCash(st) ? "" : " words");
  amt.textContent = prizeLabel(st, S.currency);
  $("wonName").textContent = st.won.name;
  const bits = [];
  if (st.won.book) bits.push("Book " + st.won.book);
  if (st.won.ticket != null) bits.push("Ticket " + (st.won.ticket + 1));
  bits.push("in " + st.won.call + " calls");
  $("wonDetail").textContent = bits.join("  ·  ");
  const jp = $("wonJackpot");
  if (st.won.jackpot) {
    jp.classList.remove("hide");
    jp.textContent = "Jackpot " + money(st.won.jackpot, S.currency) + " — in " + st.won.call + " calls";
  } else jp.classList.add("hide");
}

function renderMedia() {
  show("vMedia");
  const m = S.media || { slides: [], index: 0 };
  const slides = m.slides && m.slides.length ? m.slides : [{ title: S.venue, body: "" }];
  const i = Math.min(m.index || 0, slides.length - 1);
  const s = slides[i];
  $("slideKicker").textContent = S.mode === "interval" ? "Interval" : S.venue;
  $("slideKicker").style.color = s.tint || "var(--amber)";
  $("slideTitle").textContent = s.title || "";
  $("slideBody").textContent = s.body || "";
  $("slideDots").innerHTML = slides.map((_, k) =>
    '<i class="' + (k === i ? "on" : "") + '"></i>').join("");
}

function renderQuiz() {
  show("vQuiz");
  const q = S.quiz;
  if (!q) return;
  $("quizName").textContent = q.name;
  $("quizPos").textContent = q.index >= 0 ? "Question " + (q.index + 1) + " of " + q.total : "Get ready";
  $("quizAnswered").textContent = q.answered ? q.answered + " in" : "";
  if (!q.question) {
    $("quizQ").textContent = "Hands on buzzers";
    $("quizOpts").innerHTML = "";
  } else {
    $("quizQ").textContent = q.question.q;
    const keys = ["A", "B", "C", "D"];
    $("quizOpts").innerHTML = (q.question.options || []).map((o, i) =>
      '<div class="qopt ' + (q.revealed && q.question.answer === i ? "right" : "") + '">' +
      '<span class="k">' + keys[i] + "</span><span>" + esc(o) + "</span></div>").join("");
  }
  $("quizTable").innerHTML = (q.table || []).map((r) =>
    "<span>" + esc(r.name) + "<b>" + r.pts + "</b></span>").join("");
  tickQuiz();
}

function tickQuiz() {
  if (!S || !S.quiz) return;
  const q = S.quiz;
  const total = 20000;
  const left = Math.max(0, q.deadline - Date.now());
  $("quizBar").style.width = (q.revealed ? 0 : Math.min(100, (left / total) * 100)) + "%";
}

/* ---------------------------------------------------------------- slides */
function startSlideRotation() {
  clearInterval(slideTimer);
  slideTimer = setInterval(() => {
    if (!S || (S.mode !== "idle" && S.mode !== "interval")) return;
    const slides = (S.media && S.media.slides) || [];
    if (slides.length < 2) return;
    S.media.index = ((S.media.index || 0) + 1) % slides.length;
    renderMedia();
  }, 9000);
}

/* ---------------------------------------------------------------- wire */
function status(state, detail) {
  const w = $("waitTitle"), s = $("waitSub");
  if (state === "local") {
    w.textContent = "Waiting for the console";
    s.textContent = "Listening on this machine";
  } else if (state === "open") {
    w.textContent = "Connected to room " + detail;
    s.textContent = "Waiting for the console to send the room";
  } else if (state === "no-room") {
    w.textContent = "No room answering to " + detail;
    s.textContent = "Check the code, or open the console first";
  } else if (state === "failed") {
    w.textContent = "Can't reach the console";
    s.textContent = ROOM ? "The connection service didn't load" : "This browser has no local channel";
  } else if (state === "reconnecting") {
    s.textContent = "Reconnecting…";
  }
  $("waitCode").textContent = ROOM ? "Room " + ROOM : "display.html — same machine as the console";
}

(async function boot() {
  status(ROOM ? "connecting" : "local", ROOM || "");
  link = await joinRoom(ROOM, () => ({ name: "Room display", role: "display" }), {
    onStatus: status,
    onMessage(msg) {
      if (msg.t !== "state") return;
      const wasMode = S ? S.mode : "";
      const keepIndex = S && S.media ? S.media.index : 0;
      S = msg.s;
      if (S.media && (wasMode === "idle" || wasMode === "interval") &&
          (S.mode === "idle" || S.mode === "interval")) {
        S.media.index = keepIndex;          // don't restart the rotation on every heartbeat
      }
      render();
    },
  });
  startSlideRotation();
  setInterval(() => {
    if (!S) return;
    if (S.mode === "lobby") tickLobby();
    if (S.mode === "quiz") tickQuiz();
  }, 200);
  /* nudge the console in case the display opened first */
  setInterval(() => { if (!S && link) link.send({ t: "ping" }); }, 2000);
})();
