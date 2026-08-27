/* Marquee Event System — the wire.

   The console is the only authority. It publishes the session on two channels at once:

     BroadcastChannel  the room display running on the same machine — a second monitor,
                       another tab, the projector output. Instant, and works with the
                       internet unplugged.
     PeerJS/WebRTC     players on their phones, and a display on some other machine,
                       reached by room code through a free public broker.

   Nothing about the game depends on the network being there. Pull the plug and the
   console and its display carry on calling; the phones simply stop updating. */

const PEERJS_SRC = "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js";
const PREFIX = "marquee-event-v1-";
const CHANNEL = "marquee-event-v1";

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

function channel() {
  try { return "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL) : null; }
  catch (e) { return null; }
}

/* ------------------------------------------------------------------ console */

/* handlers: onStatus(state, detail), onJoin(peer), onLeave(peer), onMessage(peer, msg)

   Returns straight away with the local channel already live — the console and its own
   display must never sit waiting on a CDN. The remote side attaches when it is ready. */
export function openRoom(roomCode, handlers) {
  const local = channel();
  const peers = new Map();
  let peer = null, dead = false, live = roomCode;

  if (local) {
    local.onmessage = (e) => {
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "state") return;              // our own broadcast coming back
      if (msg.t === "ping") { handlers.onStatus("local", "display"); }
      handlers.onMessage({ id: "local", name: "Display", local: true }, msg);
    };
  }

  loadPeer().then((Peer) => {
    if (dead) return;
    if (!Peer) { handlers.onStatus("no-remote", "library"); return; }
    const start = (theCode) => {
      peer = new Peer(PREFIX + theCode, { debug: 0 });
      peer.on("open", (id) => { live = id.slice(PREFIX.length); handlers.onStatus("open", live); });
      peer.on("connection", (conn) => {
        conn.on("open", () => {
          const p = { id: conn.peer, conn, name: "Player", role: "player" };
          peers.set(conn.peer, p);
          conn.on("data", (msg) => {
            if (!msg || typeof msg !== "object") return;
            if (msg.t === "hello") {
              p.name = String(msg.name || "Player").slice(0, 18);
              p.role = msg.role === "display" ? "display" : "player";
              handlers.onJoin(p);
              return;
            }
            handlers.onMessage(p, msg);
          });
        });
        const drop = () => { if (peers.delete(conn.peer)) handlers.onLeave({ id: conn.peer }); };
        conn.on("close", drop);
        conn.on("error", drop);
      });
      peer.on("error", (err) => {
        const type = err && err.type;
        if (type === "unavailable-id") {
          try { peer.destroy(); } catch (e) {}
          if (!dead) start(roomCode + "X");
          return;
        }
        if (type === "peer-unavailable") return;
        handlers.onStatus("error", type || "unknown");
      });
      peer.on("disconnected", () => {
        handlers.onStatus("reconnecting", "");
        if (!dead) setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 1200);
      });
    };
    start(roomCode);
  });

  return {
    get code() { return live; },
    hasLocal: !!local,
    peers: () => Array.from(peers.values()),
    count: () => peers.size,
    /* show someone the door: tell them why, then hang up */
    kick(id, reason) {
      const p = peers.get(id);
      if (!p) return false;
      try { if (p.conn && p.conn.open) p.conn.send({ t: "kicked", reason: reason || "removed" }); } catch (e) {}
      setTimeout(() => { try { p.conn.close(); } catch (e) {} }, 120);
      peers.delete(id);
      return true;
    },
    find(name) {
      const want = String(name || "").toLowerCase();
      for (const p of peers.values()) if (String(p.name).toLowerCase() === want) return p;
      return null;
    },
    send(id, msg) {
      const p = peers.get(id);
      if (p && p.conn && p.conn.open) { try { p.conn.send(msg); } catch (e) {} }
      if (id === "local" && local) { try { local.postMessage(msg); } catch (e) {} }
    },
    publish(msg) {
      if (local) { try { local.postMessage(msg); } catch (e) {} }
      peers.forEach((p) => {
        if (p.conn && p.conn.open) { try { p.conn.send(msg); } catch (e) {} }
      });
    },
    close() {
      dead = true;
      try { local && local.close(); } catch (e) {}
      try { peer && peer.destroy(); } catch (e) {}
    },
  };
}

/* ------------------------------------------------------------------ client */

/* A display or a player. With no room code we listen on the local channel only —
   that is the second screen on the operator's own machine. */
export async function joinRoom(roomCode, hello, handlers) {
  if (!roomCode) {
    const local = channel();
    if (!local) { handlers.onStatus("failed", "no-channel"); return null; }
    local.onmessage = (e) => {
      if (e.data && typeof e.data === "object") handlers.onMessage(e.data);
    };
    handlers.onStatus("local", "");
    try { local.postMessage({ t: "ping" }); } catch (e) {}
    return {
      send(msg) { try { local.postMessage(msg); return true; } catch (e) { return false; } },
      connected: () => true,
      local: true,
      close() { try { local.close(); } catch (e) {} },
    };
  }

  const Peer = await loadPeer();
  if (!Peer) { handlers.onStatus("failed", "no-library"); return null; }

  let peer = null, conn = null, dead = false, tries = 0;

  function connect() {
    if (dead) return;
    handlers.onStatus("connecting", "");
    peer = new Peer({ debug: 0 });
    peer.on("open", () => {
      conn = peer.connect(PREFIX + roomCode, { reliable: true });
      conn.on("open", () => {
        tries = 0;
        handlers.onStatus("open", roomCode);
        try { conn.send(Object.assign({ t: "hello" }, hello())); } catch (e) {}
      });
      conn.on("data", (msg) => { if (msg && typeof msg === "object") handlers.onMessage(msg); });
      conn.on("close", retry);
      conn.on("error", retry);
    });
    peer.on("error", (err) => {
      const type = err && err.type;
      if (type === "peer-unavailable") { handlers.onStatus("no-room", roomCode); retry(); return; }
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
    local: false,
    close() { dead = true; try { peer && peer.destroy(); } catch (e) {} },
  };
}
