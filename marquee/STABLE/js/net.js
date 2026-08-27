/* =====================================================================
   WILLOW Event System — INTERACT TRANSPORT
   ---------------------------------------------------------------------
   Carries traffic between the patron site (interact.html) and the
   console (Interactions view):

       player  --push-->  feed   --moderate-->  console  --> screens
       console --publishVenue--> venue snapshot --> player site

   Two backends, chosen in js/config.js > interact.transport:

     'local'  Same browser only (BroadcastChannel + localStorage).
              Use it to test the whole flow on one machine, or when the
              patron tablets run in the same browser profile.

     'rest'   Real multi-device. Point interact.endpoint at any tiny
              JSON service (Cloudflare Worker, Supabase REST table,
              Firebase RTDB REST, 20-line Node/PHP script). Contract:

                GET  <endpoint>            -> { venue:{...}, feed:[...] }
                POST <endpoint>  {op:'push',   item:{...}}
                POST <endpoint>  {op:'patch',  id, patch:{...}}
                POST <endpoint>  {op:'venue',  venue:{...}}
                POST <endpoint>  {op:'clear'}

              Nothing else in the site needs to change.
   ===================================================================== */
(function () {
  var CFG = window.WILLOW_CONFIG;
  var IC = CFG.interact || {};
  var FEED_KEY = IC.storageKey || 'willow.interact.v1';
  var VENUE_KEY = FEED_KEY + '.venue';
  var CH = IC.channel || 'willow-interact';
  var MAX = IC.maxItems || 60;

  var subs = [];
  function emit() { subs.forEach(function (f) { try { f(); } catch (e) {} }); }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ------------------------------------------------------------------
     LOCAL backend
     ------------------------------------------------------------------ */
  var Local = (function () {
    var bus = ('BroadcastChannel' in window) ? new BroadcastChannel(CH) : null;
    function rd(k, fb) { try { return JSON.parse(localStorage.getItem(k) || 'null') || fb; } catch (e) { return fb; } }
    function wr(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} if (bus) { try { bus.postMessage({ k: k }); } catch (e) {} } }
    if (bus) bus.onmessage = function () { emit(); };
    window.addEventListener('storage', function (ev) {
      if (ev.key === FEED_KEY || ev.key === VENUE_KEY) emit();
    });
    return {
      feed: function () { return rd(FEED_KEY, []); },
      venue: function () { return rd(VENUE_KEY, {}); },
      push: function (item) {
        var f = rd(FEED_KEY, []); f.push(item);
        wr(FEED_KEY, f.slice(-MAX)); emit(); return Promise.resolve(item);
      },
      patch: function (id, patch) {
        var f = rd(FEED_KEY, []).map(function (x) { return x.id === id ? Object.assign({}, x, patch) : x; });
        wr(FEED_KEY, f); emit(); return Promise.resolve();
      },
      publishVenue: function (v) { wr(VENUE_KEY, v); emit(); return Promise.resolve(); },
      clear: function () { wr(FEED_KEY, []); emit(); return Promise.resolve(); },
      start: function () {}
    };
  })();

  /* ------------------------------------------------------------------
     REST backend — cached snapshot + polling
     ------------------------------------------------------------------ */
  var Rest = (function () {
    var url = IC.endpoint || '';
    var cache = { venue: {}, feed: [] };
    var timer = null, inflight = false;

    function pull() {
      if (!url || inflight) return;
      inflight = true;
      fetch(url, { headers: IC.headers || {} })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          inflight = false;
          if (!j) return;
          var changed = JSON.stringify(j.feed || []) !== JSON.stringify(cache.feed) ||
                        JSON.stringify(j.venue || {}) !== JSON.stringify(cache.venue);
          cache.feed = j.feed || [];
          cache.venue = j.venue || {};
          if (changed) emit();
        })['catch'](function () { inflight = false; });
    }
    function post(body) {
      if (!url) return Promise.reject(new Error('interact.endpoint is not set in js/config.js'));
      return fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, IC.headers || {}),
        body: JSON.stringify(body)
      }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json()['catch'](function () { return null; }); })
        .then(function (x) { pull(); return x; });
    }
    return {
      feed: function () { return cache.feed; },
      venue: function () { return cache.venue; },
      push: function (item) { cache.feed = cache.feed.concat([item]); emit(); return post({ op: 'push', item: item }); },
      patch: function (id, patch) {
        cache.feed = cache.feed.map(function (x) { return x.id === id ? Object.assign({}, x, patch) : x; });
        emit(); return post({ op: 'patch', id: id, patch: patch });
      },
      publishVenue: function (v) { cache.venue = v; return post({ op: 'venue', venue: v }); },
      clear: function () { cache.feed = []; emit(); return post({ op: 'clear' }); },
      start: function () { pull(); if (!timer) timer = setInterval(pull, IC.pollSeconds ? IC.pollSeconds * 1000 : 3000); }
    };
  })();

  var back = (IC.transport === 'rest') ? Rest : Local;

  /* ------------------------------------------------------------------
     UK 90-ball strip card, deterministic from a seed
     ------------------------------------------------------------------ */
  function rng(seed) {
    var h = 2166136261;
    for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  }

  function makeCard(seed) {
    var rnd = rng(String(seed));
    var cols = [];
    for (var c = 0; c < 9; c++) {
      var lo = c === 0 ? 1 : c * 10, hi = c === 8 ? 90 : c * 10 + 9;
      var pool = [];
      for (var n = lo; n <= hi; n++) pool.push(n);
      for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      cols.push(pool);
    }
    /* choose how many numbers each column contributes (15 total, max 3) */
    var counts = [1,1,1,1,1,1,1,1,1], left = 6;
    while (left > 0) {
      var k = Math.floor(rnd() * 9);
      if (counts[k] < 3) { counts[k]++; left--; }
    }
    /* place into 3 rows, 5 per row */
    var grid = [[],[],[]], rowFill = [0,0,0];
    for (var r = 0; r < 3; r++) for (var cc = 0; cc < 9; cc++) grid[r][cc] = null;
    for (var col = 0; col < 9; col++) {
      var take = cols[col].slice(0, counts[col]).sort(function (a, b) { return a - b; });
      var rowsOrder = [0,1,2].filter(function (r) { return rowFill[r] < 5; })
        .sort(function (a, b) { return rowFill[a] - rowFill[b] || (rnd() - 0.5); });
      for (var t2 = 0; t2 < take.length; t2++) {
        var row = rowsOrder[t2 % rowsOrder.length];
        if (grid[row][col] !== null || rowFill[row] >= 5) {
          row = [0,1,2].find(function (r) { return grid[r][col] === null && rowFill[r] < 5; });
          if (row === undefined) continue;
        }
        grid[row][col] = take[t2]; rowFill[row]++;
      }
    }
    /* top up any short row from unused numbers */
    for (var r2 = 0; r2 < 3; r2++) {
      while (rowFill[r2] < 5) {
        var free = [];
        for (var c2 = 0; c2 < 9; c2++) if (grid[r2][c2] === null) free.push(c2);
        if (!free.length) break;
        var pickC = free[Math.floor(rnd() * free.length)];
        var used = [grid[0][pickC], grid[1][pickC], grid[2][pickC]];
        var cand = cols[pickC].filter(function (n) { return used.indexOf(n) < 0; })[0];
        if (cand == null) break;
        grid[r2][pickC] = cand; rowFill[r2]++;
      }
      grid[r2] = grid[r2].map(function (v) { return v; });
    }
    return grid;
  }

  window.WillowNet = {
    uid: uid,
    makeCard: makeCard,
    transport: (IC.transport === 'rest') ? 'rest' : 'local',
    endpoint: IC.endpoint || '',
    feed: function () { return back.feed(); },
    venue: function () { return back.venue(); },
    push: function (item) {
      return back.push(Object.assign({ id: uid(), ts: Date.now(), status: 'pending' }, item));
    },
    patch: function (id, patch) { return back.patch(id, patch); },
    publishVenue: function (v) { return back.publishVenue(v); },
    clear: function () { return back.clear(); },
    subscribe: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },
    start: function () { back.start(); }
  };
  window.WillowNet.start();
})();
