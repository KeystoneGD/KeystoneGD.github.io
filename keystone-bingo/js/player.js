/* Palace Bingo — the player's seat. */

import {
  STAGES, generateStrip, sequenceFor, calledCount, evaluate, claimCode,
  hash2, rand32, decodeGame,
} from "./bingo.js";
import {
  initBoard, renderStrip, refreshCells, markTicket, renderCaller, renderPrizes,
  setCallName, setDabColour, buildSwatches, stopSpeaking, toast, resetRenderCache, store,
} from "./ui.js";
import { joinRoom, normaliseCode } from "./net.js";

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- state */

const me = {
  id: (store.get("playerId", 0) | 0) || rand32(),
  name: store.get("playerName", ""),
  dab: store.get("dab", "#FF2E88"),
  voice: store.get("voice", false),
};
store.set("playerId", me.id);

let mode = "idle";          // idle | joined | watch | practice
let link = null;            // the wire, when we have one
let g = null;               // the game
let seq = [];
let strip = null, ticketSeed = 0;
let clockOffset = 0;        // host clock minus ours
let claimedAtCall = -1;
let lastCount = -1;

const now = () => Date.now() + clockOffset;
const dabKey = () => "dabs." + (mode === "practice" ? "L" : "R") + ":" + ((g && g.gameId) >>> 0);
const dabs = () => new Set(store.get(dabKey(), []));
const saveDabs = (s) => store.set(dabKey(), Array.from(s));

/* ---------------------------------------------------------------- sheet */

function newSheet() {
  ticketSeed = hash2(me.id, hash2((g && g.gameId) >>> 0, store.get("sheetBump", 0)));
  strip = generateStrip(ticketSeed) || generateStrip((ticketSeed + 1) >>> 0);
  renderStrip(strip, ticketSeed, calledSet(), dabs());
}

function calledSet() {
  if (!g || g.status !== "running") return new Set();
  return new Set(seq.slice(0, calledCount(g, now())));
}

/* ---------------------------------------------------------------- the door */

$("nameIn").value = me.name;
{
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("room") || (location.hash.match(/room=([0-9A-Za-z]+)/) || [])[1];
  if (fromUrl) $("codeIn").value = normaliseCode(fromUrl);
  const watch = (location.hash.match(/w=([A-Za-z0-9_-]+)/) || [])[1];
  if (watch) startWatch(watch);
}

$("codeIn").addEventListener("input", (e) => {
  const p = e.target.selectionStart;
  e.target.value = normaliseCode(e.target.value);
  e.target.setSelectionRange(p, p);
});

$("joinForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("nameIn").value.trim();
  const code = normaliseCode($("codeIn").value);
  if (!name) { door("Give us a name to put against your sheet.", "err"); return; }
  me.name = name; store.set("playerName", name);
  if (code.length !== 5) { door("Room codes are five characters. Check with the host.", "err"); return; }
  startJoin(code);
});

$("practiceBtn").addEventListener("click", () => {
  const name = $("nameIn").value.trim();
  me.name = name || "You";
  store.set("playerName", me.name);
  startPractice();
});

function door(msg, kind) {
  const el = $("doorMsg");
  el.className = "doormsg " + (kind || "info");
  el.innerHTML = msg;
}

function enterHall() {
  $("doors").classList.add("hide");
  $("game").classList.remove("hide");
  $("whoami").textContent = me.name;
}

/* ---------------------------------------------------------------- joining */

function startJoin(code) {
  $("joinBtn").disabled = true;
  door("Knocking on the door&hellip;", "info");
  mode = "joined";
  history.replaceState(null, "", "?room=" + code);

  joinRoom(code, () => ({ name: me.name, seed: ticketSeed }), {
    onStatus(state, detail) {
      if (state === "open") {
        chip("In the room", true);
        enterHall();
        $("joinBtn").disabled = false;
      } else if (state === "failed") {
        $("joinBtn").disabled = false;
        door("Couldn&rsquo;t load the connection library &mdash; check you&rsquo;re online, or take a practice round.", "err");
      } else if (state === "no-room") {
        $("joinBtn").disabled = false;
        door("No room answering to <b>" + detail + "</b>. Check the code, or wait for the host to open the doors.", "err");
        chip("Looking for the room", false);
      } else if (state === "reconnecting" || state === "connecting") {
        chip("Reconnecting", false);
      } else if (state === "error") {
        chip("Connection trouble", false);
      }
    },
    onMessage: handle,
  }).then((l) => { link = l; });
}

function chip(text, on) {
  const el = $("linkChip");
  el.textContent = text;
  el.className = "chip link" + (on ? "" : " off");
}

function handle(msg) {
  if (msg.t === "state") {
    if (typeof msg.now === "number") clockOffset = msg.now - Date.now();
    applyGame(msg.g);
  } else if (msg.t === "verdict") {
    if (msg.ok) toast("<b>Valid claim.</b> " + msg.text, 6000);
    else toast("Not this time &mdash; " + msg.text, 6000);
  } else if (msg.t === "award") {
    toast("<b>" + escapeHtml(msg.name) + "</b> takes " + (STAGES[msg.stage] || "the prize").toLowerCase() + "!", 6000);
  } else if (msg.t === "shut") {
    chip("Room closed", false);
    toast("The host has closed the room. Thanks for playing.", 8000);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------------------------------------------------------- watch link */

function startWatch(encoded) {
  const decoded = decodeGame(encoded);
  if (!decoded) return;
  mode = "watch";
  me.name = me.name || "You";
  applyGame(decoded);
  enterHall();
  chip("Watch link", false);
  toast("Following the game from a link. Claims won&rsquo;t send &mdash; you&rsquo;ll get a code to read out.", 7000);
}

/* ---------------------------------------------------------------- practice */

function startPractice() {
  mode = "practice";
  applyGame({
    status: "running", gameId: rand32(), gameSeed: rand32(), gameNo: 1,
    startedAt: Date.now() + 3000, interval: 7000, paused: false, pausedElapsed: 0, stage: 0,
  });
  enterHall();
  chip("Practice", false);
  setCallName("Practice round");
}

/* ---------------------------------------------------------------- game state */

function applyGame(next) {
  if (!next) return;
  const wasId = (g && g.gameId) >>> 0;
  g = next;
  seq = sequenceFor(g.gameSeed);
  if ((g.gameId >>> 0) !== wasId || !strip) {
    claimedAtCall = -1; lastCount = -1;
    resetRenderCache();
    newSheet();
    if (link && link.connected()) link.send({ t: "seat", seed: ticketSeed, name: me.name });
  }
  renderPrizes(g);
}

/* ---------------------------------------------------------------- dabbing */

$("strip").addEventListener("click", (e) => {
  const cell = e.target.closest(".cell[data-n]");
  if (!cell || !g) return;
  const n = +cell.dataset.n;
  const set = dabs();
  if (set.has(n)) { set.delete(n); saveDabs(set); refreshCells(calledSet(), set); updateClaim(); return; }
  if (seq.indexOf(n) >= calledCount(g, now())) {
    cell.classList.remove("nope"); void cell.offsetWidth; cell.classList.add("nope");
    return;
  }
  set.add(n); saveDabs(set);
  refreshCells(calledSet(), set);
  updateClaim();
});

$("newSheetBtn").addEventListener("click", () => {
  if (g && g.status === "running" && calledCount(g, now()) > 0) {
    say("You can&rsquo;t swap sheets <b>mid&#8209;game</b>. Wait for the next one.", "warn");
    return;
  }
  store.set("sheetBump", ((store.get("sheetBump", 0) | 0) + 1) | 0);
  saveDabs(new Set());
  newSheet();
  updateClaim();
});

/* ---------------------------------------------------------------- claiming */

function bestClaim() {
  if (!g || g.status !== "running" || !strip) return null;
  return evaluate(strip, dabs(), g.stage, seq, calledCount(g, now()));
}

function say(html, kind) {
  const el = $("claimMsg");
  el.className = "claim-msg" + (kind ? " " + kind : "");
  el.innerHTML = html;
}

function updateClaim() {
  const btn = $("bingoBtn");
  const count = g ? calledCount(g, now()) : 0;
  const best = bestClaim();
  if (!best) {
    markTicket(null);
    btn.disabled = true; btn.classList.remove("live");
    say(g && g.status === "running"
      ? "Dab your numbers as they&rsquo;re called. The button lights up the moment you&rsquo;re on."
      : "No game running. The host will start one shortly.");
    return;
  }
  const open = best.winCall === count - 1;
  const claimed = claimedAtCall === best.winCall;
  markTicket(best.ticket, open && !claimed ? "claimable" : "won");
  btn.disabled = !open || claimed;
  btn.classList.toggle("live", open && !claimed);

  if (claimed) say("Claim with the host. Sit tight.", "good");
  else if (open) say("You&rsquo;re on for <b>" + STAGES[best.stage] + "</b> on ticket " +
    (best.ticket + 1) + ". Call it before the next ball.");
  else say("Ticket " + (best.ticket + 1) + " is complete, but the <b>ball has moved on</b>. " +
    "That prize has gone &mdash; play on for the next one.", "warn");
}

$("bingoBtn").addEventListener("click", () => {
  const count = calledCount(g, now());
  const best = bestClaim();
  if (!best || best.winCall !== count - 1) return;
  claimedAtCall = best.winCall;

  const sent = link && link.connected() &&
    link.send({ t: "claim", seed: ticketSeed, call: best.winCall, stage: best.stage, name: me.name });

  $("claimWhat").innerHTML = "You&rsquo;re on for <b>" + STAGES[best.stage] + "</b> &mdash; ticket " +
    (best.ticket + 1) + (best.rows.length === 3 ? ", the full fifteen."
      : ", row" + (best.rows.length > 1 ? "s " : " ") + best.rows.map((r) => r + 1).join(" and ") + ".");
  $("claimSent").classList.toggle("hide", !sent);
  $("claimManual").classList.toggle("hide", !!sent);
  $("claimCode").textContent = claimCode(ticketSeed, best.winCall);
  $("claimDlg").showModal();
  if (me.voice) stopSpeaking();
  updateClaim();
});

/* ---------------------------------------------------------------- chrome */

document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-close]");
  if (c) { const d = c.closest("dialog"); if (d) d.close(); }
});
$("rulesBtn").addEventListener("click", () => $("rulesDlg").showModal());
$("settingsBtn").addEventListener("click", () => $("settingsDlg").showModal());
$("leaveBtn").addEventListener("click", () => {
  if (link) link.close();
  location.href = location.pathname;
});

function setVoice(on) {
  me.voice = !!on;
  store.set("voice", me.voice);
  $("soundBtn").setAttribute("aria-pressed", String(me.voice));
  $("voiceToggle").setAttribute("aria-pressed", String(me.voice));
  $("voiceToggle").textContent = me.voice ? "Voice on" : "Voice off";
  if (!me.voice) stopSpeaking();
}
$("soundBtn").addEventListener("click", () => setVoice(!me.voice));
$("voiceToggle").addEventListener("click", () => setVoice(!me.voice));

/* ---------------------------------------------------------------- loop */

function tick() {
  if (!g) return;
  const r = renderCaller(g, now(), seq, mode === "practice" ? "Practice"
    : (mode === "watch" ? "Watching" : "Live"), me.voice);
  if (r.count !== lastCount) {
    if (lastCount >= 0 && r.count > lastCount) claimedAtCall = -1;
    lastCount = r.count;
    refreshCells(calledSet(), dabs());
    renderPrizes(g);
  }
  updateClaim();
}

initBoard();
setDabColour(me.dab);
buildSwatches(me.dab, (c) => { me.dab = c; store.set("dab", c); });
setVoice(me.voice);
if (!strip) newSheet();          // a sheet is waiting on the table before the game starts
updateClaim();
setInterval(tick, 200);
