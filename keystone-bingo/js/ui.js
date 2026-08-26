/* Palace Bingo — shared rendering. Both the player page and the host console use these. */

import { NICK, STAGES, mulberry32, calledCount, msToNext } from "./bingo.js";

const $ = (id) => document.getElementById(id);
const RING = 2 * Math.PI * 70;

let lastBall = 0, lastCount = -1, lastSpoken = -1;

export function resetRenderCache() { lastBall = 0; lastCount = -1; lastSpoken = -1; }

export function initBoard() {
  const el = $("board");
  if (!el) return;
  let h = "";
  for (let n = 1; n <= 90; n++) h += "<span>" + n + "</span>";
  el.innerHTML = h;
}

export function setDabColour(c) {
  document.documentElement.style.setProperty("--dab", c);
}

function serial(seed) {
  return ("000000" + (seed >>> 0).toString(36).toUpperCase()).slice(-6);
}

export function renderStrip(strip, seed, called, dabs) {
  const el = $("strip");
  if (!el || !strip) return;
  const rnd = mulberry32(seed >>> 0);
  let html = '<div class="paper">';
  for (let t = 0; t < 6; t++) {
    html += '<div class="ticket" data-t="' + t + '">' +
      '<div class="t-head"><span class="flag">Ticket ' + (t + 1) + '</span>' +
      '<span class="serial">' + serial(seed) + "&nbsp;/&nbsp;" + (t + 1) + "</span></div>" +
      '<div class="grid">';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 9; c++) {
        const v = strip[t][r][c];
        if (v == null) { html += '<div class="cell blank"></div>'; continue; }
        let cls = "cell";
        if (dabs.has(v)) cls += " dabbed";
        else if (called.has(v)) cls += " callable";
        html += '<button class="' + cls + '" data-n="' + v + '" style="--rot:' +
          (rnd() * 30 - 15).toFixed(1) + 'deg">' + v + "</button>";
      }
    }
    html += "</div></div>";
  }
  el.innerHTML = html + "</div>";
}

export function refreshCells(called, dabs) {
  const cells = document.querySelectorAll("#strip .cell[data-n]");
  for (let i = 0; i < cells.length; i++) {
    const el = cells[i], n = +el.dataset.n;
    const d = dabs.has(n);
    el.classList.toggle("dabbed", d);
    el.classList.toggle("callable", !d && called.has(n));
  }
}

export function markTicket(index, cls) {
  const nodes = document.querySelectorAll("#strip .ticket");
  for (let i = 0; i < nodes.length; i++) nodes[i].classList.remove("claimable", "won");
  if (index == null) return;
  const el = document.querySelector('#strip .ticket[data-t="' + index + '"]');
  if (el) el.classList.add(cls);
}

/* The caller rail. `label` is the small text at the top right of the panel. */
export function renderCaller(g, now, seq, label, voice) {
  const live = g && g.status === "running";
  const count = live ? calledCount(g, now) : 0;
  const cur = count > 0 ? seq[count - 1] : 0;
  const stageName = STAGES[Math.min(2, (g && g.stage) | 0)];
  const ball = $("ball");

  if ($("calledCount")) $("calledCount").textContent = count;
  if ($("remaining")) $("remaining").textContent = (90 - count) + " left";
  if ($("stageLabel")) $("stageLabel").textContent = label;
  if ($("stageChip")) {
    $("stageChip").innerHTML = live
      ? "Playing for <b>" + stageName + "</b>"
      : "Game <b>" + ((g && g.gameNo) || 1) + "</b>";
  }

  if (!live || !cur) {
    if (lastBall !== -1) { ball.className = "ball idle"; lastBall = -1; }
    ball.textContent = g && g.status === "finished" ? "That's it" : "Eyes down";
    $("callSub").textContent = g && g.paused ? "Paused - checking a claim"
      : (live ? "First ball on its way" : "");
  } else {
    if (cur !== lastBall) {
      lastBall = cur;
      ball.className = "ball pop";
      ball.textContent = cur;
      setTimeout(() => { if (ball.classList.contains("pop")) ball.className = "ball"; }, 470);
      $("callName").textContent = NICK[cur];
    }
    $("callSub").textContent = g.paused ? "Paused - checking a claim"
      : (count >= 90 ? "That's the lot" : "Playing for " + stageName);
  }

  const ring = $("ring");
  if (live && !g.paused && count < 90) {
    const frac = 1 - Math.max(0, Math.min(1, msToNext(g, now) / g.interval));
    ring.setAttribute("stroke-dashoffset", (RING * (1 - frac)).toFixed(1));
  } else {
    ring.setAttribute("stroke-dashoffset", g && g.paused ? "0" : String(RING));
  }

  const changed = count !== lastCount;
  if (changed) {
    lastCount = count;
    $("recent").innerHTML = seq.slice(Math.max(0, count - 6), count).reverse()
      .map((n) => "<i>" + n + "</i>").join("");
    const cells = $("board").children;
    for (let n = 1; n <= 90; n++) {
      const el = cells[n - 1];
      el.classList.toggle("on", seq.indexOf(n) < count);
      el.classList.toggle("now", n === cur);
    }
  }

  if (live && voice && cur && cur !== lastSpoken && !g.paused) { lastSpoken = cur; speak(cur); }
  return { count, cur, changed };
}

export function renderPrizes(g) {
  const el = $("prizes");
  if (!el) return;
  const stage = Math.min(2, (g && g.stage) | 0);
  const live = g && g.status === "running";
  const finished = g && g.status === "finished";
  for (let s = 0; s < 3; s++) {
    const li = el.children[s];
    const done = finished || (live && s < stage);
    const now = !finished && live && s === stage;
    li.className = done ? "done" : (now ? "now" : "");
    li.lastElementChild.textContent = done ? "Won" : (now ? "Playing" : "To come");
  }
}

export function setCallName(text) { $("callName").textContent = text; }

export function speak(n) {
  if (!("speechSynthesis" in window)) return;
  try {
    const text = n < 10 ? "On its own, number " + n : NICK[n] + ", " + n;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.94; u.pitch = 0.92;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) { /* no voice available */ }
}

export function stopSpeaking() { try { speechSynthesis.cancel(); } catch (e) {} }

let toastTimer = 0;
export function toast(html, ms) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.innerHTML = html;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms || 4200);
}

export const DABBERS = [
  ["#FF2E88", "Magenta"], ["#FF7A1A", "Orange"], ["#2FB8FF", "Blue"],
  ["#57D06A", "Green"], ["#A97BFF", "Violet"], ["#FFD400", "Yellow"],
];

export function buildSwatches(current, onPick) {
  const el = $("swatches");
  if (!el) return;
  el.innerHTML = DABBERS.map((d) =>
    '<button data-c="' + d[0] + '" title="' + d[1] + '" aria-label="' + d[1] +
    ' dabber" style="background:' + d[0] + '" aria-pressed="' + (d[0] === current) + '"></button>').join("");
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-c]");
    if (!b) return;
    const all = el.querySelectorAll("button");
    for (let i = 0; i < all.length; i++) all[i].setAttribute("aria-pressed", String(all[i].dataset.c === b.dataset.c));
    setDabColour(b.dataset.c);
    onPick(b.dataset.c);
  });
}

/* Small localStorage helper, namespaced so it never collides with anything else on the domain. */
export const store = {
  get(k, d) {
    try { const v = localStorage.getItem("palace." + k); return v === null ? d : JSON.parse(v); }
    catch (e) { return d; }
  },
  set(k, v) { try { localStorage.setItem("palace." + k, JSON.stringify(v)); } catch (e) {} },
};
