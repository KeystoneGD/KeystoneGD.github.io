/* Palace Bingo — the caller's box.

   The host's browser runs the game and every player's page is a window onto it. Nothing
   is stored anywhere else, which is also why nobody can hijack a room: it only exists
   for as long as this tab is open. */

import {
  STAGES, sequenceFor, calledCount, rand32, verifyClaim, parseClaimCode, encodeGame,
} from "./bingo.js";
import {
  initBoard, renderCaller, renderPrizes, setCallName, stopSpeaking, toast, store,
} from "./ui.js";
import { openRoom, makeRoomCode } from "./net.js";
import { checkCredentials, cryptoAvailable, session } from "./auth.js";
import { CREDENTIALS } from "./credentials.js";

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- the door */

let attempts = 0;

function gateMsg(html, kind) {
  const el = $("gateMsg");
  el.className = "doormsg " + (kind || "info");
  el.innerHTML = html;
}

if (!CREDENTIALS) {
  gateMsg("No lock has been fitted yet. Open <b>set-password.html</b>, choose a username and " +
    "password, and paste what it gives you into <b>js/credentials.js</b>.", "err");
  $("gateBtn").disabled = true;
} else if (!cryptoAvailable()) {
  gateMsg("This browser won&rsquo;t run the sign-in check. It needs a secure page &mdash; open the " +
    "site over https, or over http://localhost if you&rsquo;re testing.", "err");
  $("gateBtn").disabled = true;
} else {
  $("gateHint").textContent = "";
}

$("gateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!CREDENTIALS || !cryptoAvailable()) return;
  const user = $("userIn").value;
  const pass = $("passIn").value;
  $("gateBtn").disabled = true;
  gateMsg("Checking&hellip;", "info");

  // Deliberately unhurried: the derivation is slow by design, and guessing gets slower.
  await new Promise((r) => setTimeout(r, Math.min(attempts * 400, 2000)));
  const ok = await checkCredentials(user, pass, CREDENTIALS);
  $("gateBtn").disabled = false;

  if (!ok) {
    attempts++;
    $("passIn").value = "";
    $("passIn").focus();
    gateMsg("That username and password don&rsquo;t match. Try again.", "err");
    return;
  }
  session.open();
  openConsole();
});

function openConsole() {
  $("gate").classList.add("hide");
  $("console").classList.remove("hide");
  boot();
}

$("signOutBtn").addEventListener("click", () => {
  session.close();
  if (room) { room.broadcast({ t: "shut" }); room.close(); }
  location.reload();
});

/* ---------------------------------------------------------------- the room */

let room = null;
let g = null;                 // the game, or null between games
let seq = [];
const claims = [];            // {name, ok, text, stage, seed, call, awarded}
let lastCount = -1;
let gameNo = 0;
let voice = store.get("hostVoice", false);

function blankGame(interval) {
  return {
    status: "running",
    gameId: rand32(),
    gameSeed: rand32(),
    gameNo: ++gameNo,
    startedAt: Date.now() + 5000,          // a moment for everyone to settle
    interval,
    paused: false,
    pausedElapsed: 0,
    stage: 0,
  };
}

function pushState() {
  if (!room) return;
  room.broadcast({ t: "state", g, now: Date.now() });
}

function note(html, warn) {
  const el = $("hostNote");
  el.className = "hostnote" + (warn ? " warn" : "");
  el.innerHTML = html;
}

function chip(text, on) {
  const el = $("linkChip");
  el.textContent = text;
  el.className = "chip link" + (on ? "" : " off");
}

async function boot() {
  initBoard();
  setVoice(voice);
  renderPrizes(null);
  renderControls();
  renderPlayers();

  const code = store.get("roomCode", "") || makeRoomCode();
  store.set("roomCode", code);
  $("roomCode").textContent = code;
  chip("Opening the doors", false);

  room = await openRoom(code, {
    onStatus(state, detail) {
      if (state === "open") {
        store.set("roomCode", detail);
        $("roomCode").textContent = detail;
        chip("Doors open", true);
        note("Room <b>" + detail + "</b> is open. Read that code out, or send the join link.");
      } else if (state === "failed") {
        chip("Doors shut", false);
        note("Couldn&rsquo;t reach the connection service, so players can&rsquo;t join live. " +
          "You can still run the game and hand out a <b>watch link</b>.", true);
      } else if (state === "reconnecting") {
        chip("Reconnecting", false);
      } else if (state === "error") {
        chip("Connection trouble", false);
        note("The connection service reported: " + detail + ". Players may need to rejoin.", true);
      }
    },
    onJoin(p) {
      renderPlayers();
      toast("<b>" + escapeHtml(p.name) + "</b> has taken a seat.", 3500);
      if (g) room.send(p.id, { t: "state", g, now: Date.now() });
    },
    onLeave() { renderPlayers(); },
    onMessage(p, msg) {
      if (msg.t === "seat") {
        p.seed = msg.seed >>> 0;
        if (msg.name) p.name = String(msg.name).slice(0, 18);
        renderPlayers();
        return;
      }
      if (msg.t === "claim") takeClaim(p, msg);
    },
  });

  if (!room) {
    chip("Doors shut", false);
    note("Couldn&rsquo;t open a room &mdash; the connection library didn&rsquo;t load. Check you&rsquo;re online.", true);
  }
  setInterval(tick, 200);
  setInterval(() => { if (g) pushState(); }, 8000);   // keeps everyone's clocks honest
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderPlayers() {
  const list = room ? room.players() : [];
  $("playerCount").textContent = list.length === 0 ? "nobody in yet"
    : list.length + (list.length === 1 ? " player" : " players");
  $("players").innerHTML = list.length
    ? list.map((p) => '<span class="on">' + escapeHtml(p.name) + "</span>").join("")
    : '<span>Waiting for players</span>';
}

/* ---------------------------------------------------------------- claims */

function takeClaim(p, msg) {
  if (!g || g.status !== "running") {
    room.send(p.id, { t: "verdict", ok: false, text: "there&rsquo;s no game running." });
    return;
  }
  const stage = Math.min(2, g.stage | 0);
  const res = verifyClaim(msg.seed >>> 0, msg.call | 0, stage, seq);
  const count = calledCount(g, Date.now());
  const behind = count - 1 - (msg.call | 0);

  let text;
  if (res.ok) {
    text = "Ticket " + (res.ticket + 1) + ", " +
      (res.rows.length === 3 ? "full house" : "row" + (res.rows.length > 1 ? "s " : " ") +
        res.rows.map((r) => r + 1).join(" and ")) +
      ", complete on call " + (res.call + 1) + " — number " + res.number + "." +
      (behind > 1 ? " The board has since moved on " + behind + " balls." : "");
  } else {
    text = res.reason === "not-on"
      ? "that sheet isn't on for " + STAGES[stage].toLowerCase() + " at call " + ((msg.call | 0) + 1) + "."
      : "that claim didn't make sense.";
  }

  claims.unshift({
    name: p.name, ok: res.ok, text, stage,
    seed: msg.seed >>> 0, call: msg.call | 0, awarded: false,
  });
  renderClaims();
  room.send(p.id, { t: "verdict", ok: res.ok, text });
  if (res.ok) {
    toast("<b>" + escapeHtml(p.name) + "</b> is claiming " + STAGES[stage].toLowerCase() + "!", 6000);
    pause(true);
  }
}

function renderClaims() {
  const el = $("claims");
  if (!claims.length) { el.innerHTML = '<div class="empty">Nothing claimed yet.</div>'; return; }
  el.innerHTML = claims.slice(0, 6).map((c, i) =>
    '<div class="claimrow ' + (c.ok ? "ok" : "no") + '">' +
    '<span class="nm">' + escapeHtml(c.name) + "</span>" +
    '<span class="dt">' + c.text + "</span>" +
    (c.ok && !c.awarded ? '<button class="btn small primary" data-award="' + i + '">Award</button>' : "") +
    (c.awarded ? '<span class="lbl">Awarded</span>' : "") +
    "</div>").join("");
}

$("claims").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-award]");
  if (!b) return;
  const c = claims[+b.dataset.award];
  if (!c || c.awarded) return;
  c.awarded = true;
  award(c.name, c.stage);
});

/* ---------------------------------------------------------------- controls */

function award(name, stage) {
  if (!g) return;
  if (room) room.broadcast({ t: "award", name, stage });
  toast("<b>" + escapeHtml(name) + "</b> takes " + STAGES[stage].toLowerCase() + ".", 5000);
  nextStage();
}

function nextStage() {
  if (!g) return;
  const next = (g.stage | 0) + 1;
  resume();
  if (next > 2) {
    g.status = "finished";
    note("Game over. <b>New game</b> deals fresh tickets and starts again.");
  } else {
    g.stage = next;
  }
  renderClaims();
  renderControls();
  pushState();
}

function pause(on) {
  if (!g || g.status !== "running" || g.paused === on) return;
  if (on) { g.pausedElapsed = Date.now() - g.startedAt; g.paused = true; }
  else { g.startedAt = Date.now() - g.pausedElapsed; g.paused = false; }
  renderControls();
  pushState();
}
function resume() { pause(false); }

function startGame() {
  const interval = +$("hSpeed").value;
  if (g && g.status === "running" && g.paused) { resume(); return; }
  g = blankGame(interval);
  seq = sequenceFor(g.gameSeed);
  claims.length = 0;
  lastCount = -1;
  renderClaims();
  renderControls();
  pushState();
  note("Game " + g.gameNo + " starts in a few seconds. Everyone in the room has a fresh sheet.");
}

$("hStart").addEventListener("click", startGame);
$("hReset").addEventListener("click", () => { g = null; startGame(); });
$("hPause").addEventListener("click", () => pause(!(g && g.paused)));
$("hNext").addEventListener("click", () => {
  const top = claims.find((c) => c.ok && !c.awarded);
  if (top) { top.awarded = true; award(top.name, top.stage); }
  else nextStage();
});

$("hCheck").addEventListener("click", () => {
  const parsed = parseClaimCode($("hCode").value);
  if (!parsed) { note("That&rsquo;s not a claim code. They look like <b>1Z3K9P-R</b>.", true); return; }
  if (!g || g.status !== "running") { note("No game running to check it against.", true); return; }
  const stage = Math.min(2, g.stage | 0);
  const res = verifyClaim(parsed.seed, parsed.call, stage, seq);
  claims.unshift({
    name: "Watch link", ok: res.ok, stage, seed: parsed.seed, call: parsed.call, awarded: false,
    text: res.ok
      ? "Ticket " + (res.ticket + 1) + ", " + (res.rows.length === 3 ? "full house"
        : "row" + (res.rows.length > 1 ? "s " : " ") + res.rows.map((r) => r + 1).join(" and ")) +
        ", complete on call " + (res.call + 1) + " — number " + res.number + "."
      : "not on for " + STAGES[stage].toLowerCase() + " at call " + (parsed.call + 1) + ".",
  });
  $("hCode").value = "";
  renderClaims();
  if (res.ok) pause(true);
});

function renderControls() {
  const live = g && g.status === "running";
  $("hStart").textContent = live ? (g.paused ? "Resume the game" : "Game running") : "Start game";
  $("hStart").disabled = !!(live && !g.paused);
  $("hPause").textContent = live && g.paused ? "Resume" : "Pause for a check";
  $("hPause").disabled = !live;
  $("hNext").disabled = !live;
  $("hNext").textContent = live && (g.stage | 0) >= 2 ? "Award & end game" : "Award & next stage";
  renderPrizes(g);
}

/* ---------------------------------------------------------------- links */

function baseUrl() {
  return location.href.replace(/host\.html.*$/, "");
}
async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast("<b>" + what + "</b> copied.", 2500);
  } catch (e) {
    window.prompt("Copy this " + what.toLowerCase() + ":", text);
  }
}
$("copyJoin").addEventListener("click", () => {
  const code = room ? room.code : store.get("roomCode", "");
  copy(baseUrl() + "index.html?room=" + code, "Join link");
});
$("copyWatch").addEventListener("click", () => {
  if (!g) { note("Start a game first &mdash; a watch link carries the game with it.", true); return; }
  copy(baseUrl() + "index.html#w=" + encodeGame(g), "Watch link");
});

/* ---------------------------------------------------------------- voice */

function setVoice(on) {
  voice = !!on;
  store.set("hostVoice", voice);
  $("soundBtn").setAttribute("aria-pressed", String(voice));
  if (!voice) stopSpeaking();
}
$("soundBtn").addEventListener("click", () => setVoice(!voice));

/* ---------------------------------------------------------------- loop */

/* Last, so every binding above is initialised before a signed-in session walks straight in. */
if (session.isOpen() && CREDENTIALS && cryptoAvailable()) openConsole();

function tick() {
  if (!g) { setCallName("Nothing running"); return; }
  const r = renderCaller(g, Date.now(), seq, g.status === "running" ? "Live" : "Finished", voice);
  if (r.count !== lastCount) {
    const first = lastCount <= 0 && r.count === 1;
    lastCount = r.count;
    renderPrizes(g);
    if (first) {
      note("Game " + g.gameNo + " under way. Room <b>" + (room ? room.code : "") +
        "</b> is still open &mdash; latecomers get the next game&rsquo;s sheet.");
    }
    if (r.count >= 90 && g.status === "running") {
      note("That&rsquo;s all ninety called. <b>New game</b> when you&rsquo;re ready.");
    }
  }
}
