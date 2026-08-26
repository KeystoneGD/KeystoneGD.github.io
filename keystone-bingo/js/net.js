/* Palace Bingo — the wire.

   The host's browser IS the server. Players open a WebRTC data channel straight to it
   through PeerJS's free public broker; no account, no backend, nothing to deploy beyond
   these static files. The broker only introduces the two browsers — the game itself
   never touches it.

   If WebRTC can't get through someone's network, the host can still hand out a watch
   link (see encodeGame in bingo.js) and they play in lockstep, claiming by code. */

const PEERJS_SRC = "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js";
const PREFIX = "palacebingo-v1-";

/* No 0/O/1/I — these get read aloud down a phone. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function makeRoomCode() {
  const b = new Uint8Array(5);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 5; i++) b[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (let i = 0; i < 5; i++) out += ALPHABET[b[i] % ALPHABET.length];
  return out;
}

/* Codes are read out loud, so forgive the usual mishearings before dropping anything else. */
export function normaliseCode(s) {
  return String(s || "").toUpperCase()
    .replace(/O/g, "Q").replace(/0/g, "Q")
    .replace(/[1I]/g, "J")
    .split("").filter((ch) => ALPHABET.indexOf(ch) >= 0).join("")
    .slice(0, 5);
}

let peerLoad = null;
export function loadPeer() {
  if (peerLoad) return peerLoad;
  peerLoad = new Promise((resolve) => {
    if (window.Peer) return resolve(window.Peer);
    const s = document.createElement("script");
    s.src = PEERJS_SRC;
    s.async = true;
    s.onload = () => resolve(window.Peer || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
    setTimeout(() => resolve(window.Peer || null), 12000);
  });
  return peerLoad;
}

/* ---------------------------------------------------------------- host side */

/* handlers: onStatus(state, detail), onJoin(player), onLeave(player), onMessage(player, msg) */
export async function openRoom(code, handlers) {
  const Peer = await loadPeer();
  if (!Peer) { handlers.onStatus("failed", "no-library"); return null; }

  const players = new Map();          // connection id -> {conn, name, seed, id}
  let peer = null, dead = false;

  function start(theCode) {
    peer = new Peer(PREFIX + theCode, { debug: 0 });

    peer.on("open", () => handlers.onStatus("open", theCode));

    peer.on("connection", (conn) => {
      conn.on("open", () => {
        const p = { id: conn.peer, conn, name: "Player", seed: 0 };
        players.set(conn.peer, p);
        conn.on("data", (msg) => {
          if (!msg || typeof msg !== "object") return;
          if (msg.t === "hello") {
            p.name = String(msg.name || "Player").slice(0, 18);
            p.seed = msg.seed >>> 0;
            handlers.onJoin(p);
            return;
          }
          handlers.onMessage(p, msg);
        });
      });
      const drop = () => {
        if (players.delete(conn.peer)) handlers.onLeave({ id: conn.peer });
      };
      conn.on("close", drop);
      conn.on("error", drop);
    });

    peer.on("error", (err) => {
      const type = err && err.type;
      if (type === "unavailable-id") {
        // Someone (probably us, a moment ago) still holds this code. Take a new one.
        try { peer.destroy(); } catch (e) {}
        if (!dead) start(makeRoomCode());
        return;
      }
      if (type === "peer-unavailable") return;      // a player vanished; not our problem
      handlers.onStatus("error", type || "unknown");
    });

    peer.on("disconnected", () => {
      handlers.onStatus("reconnecting", "");
      if (!dead) setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 1200);
    });
  }

  start(code);

  return {
    get code() { return peer && peer.id ? peer.id.slice(PREFIX.length) : code; },
    players: () => Array.from(players.values()),
    count: () => players.size,
    send(id, msg) {
      const p = players.get(id);
      if (p && p.conn && p.conn.open) { try { p.conn.send(msg); } catch (e) {} }
    },
    broadcast(msg) {
      players.forEach((p) => { if (p.conn && p.conn.open) { try { p.conn.send(msg); } catch (e) {} } });
    },
    close() {
      dead = true;
      try { peer.destroy(); } catch (e) {}
    },
  };
}

/* --------------------------------------------------------------- guest side */

/* handlers: onStatus(state, detail), onMessage(msg) */
export async function joinRoom(code, hello, handlers) {
  const Peer = await loadPeer();
  if (!Peer) { handlers.onStatus("failed", "no-library"); return null; }

  let peer = null, conn = null, dead = false, tries = 0;

  function connect() {
    if (dead) return;
    handlers.onStatus("connecting", "");
    peer = new Peer({ debug: 0 });

    peer.on("open", () => {
      conn = peer.connect(PREFIX + code, { reliable: true });
      conn.on("open", () => {
        tries = 0;
        handlers.onStatus("open", code);
        try { conn.send(Object.assign({ t: "hello" }, hello())); } catch (e) {}
      });
      conn.on("data", (msg) => { if (msg && typeof msg === "object") handlers.onMessage(msg); });
      conn.on("close", retry);
      conn.on("error", retry);
    });

    peer.on("error", (err) => {
      const type = err && err.type;
      if (type === "peer-unavailable") { handlers.onStatus("no-room", code); retry(); return; }
      handlers.onStatus("error", type || "unknown");
      retry();
    });
  }

  function retry() {
    if (dead) return;
    try { peer && peer.destroy(); } catch (e) {}
    peer = null; conn = null;
    tries++;
    handlers.onStatus("reconnecting", String(tries));
    setTimeout(connect, Math.min(1000 * tries, 8000));
  }

  connect();

  return {
    send(msg) { if (conn && conn.open) { try { conn.send(msg); return true; } catch (e) {} } return false; },
    connected: () => !!(conn && conn.open),
    close() { dead = true; try { peer && peer.destroy(); } catch (e) {} },
  };
}
