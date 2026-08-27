/* =====================================================================
   WILLOW Event System — PATRON SITE (interact.html)
   ---------------------------------------------------------------------
   Point patrons at  <your-site>/interact.html  (host it at /interact
   with a rewrite if you prefer the shorter address). They can:
       * join bingo when the operator opens sales, and play a real card
       * send shoutouts to the venue screens (operator moderates)
       * upload photos for the Interactions photo wall
   Everything reaches the console through js/net.js.
   ===================================================================== */
(function () {
  var CFG = window.WILLOW_CONFIG, N = window.WillowNet;
  var app = document.getElementById('app');
  var ME_KEY = 'willow.player.v1';

  var me = load();
  var tab = 'bingo';
  var draft = { shout: '', photo: null };
  var flash = { shout: '', photo: '', bingo: '' };

  function load() {
    try { return JSON.parse(localStorage.getItem(ME_KEY) || 'null') || {}; } catch (e) { return {}; }
  }
  function save() { try { localStorage.setItem(ME_KEY, JSON.stringify(me)); } catch (e) {} }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function venue() {
    var v = N.venue() || {};
    return {
      venueName: v.venueName || CFG.venueName,
      code: v.code || '',
      salesOpen: !!v.salesOpen,
      shoutoutsOpen: v.shoutoutsOpen !== false,
      photosOpen: v.photosOpen !== false,
      game: v.game || 1,
      pattern: v.pattern || '',
      prize: v.prize || 0,
      called: v.called || [],
      current: v.current || null,
      rooms: v.rooms || CFG.rooms.map(function (r) { return { name: r.name, code: r.code }; })
    };
  }
  function money(n) { return '£' + Number(n || 0).toLocaleString('en-GB'); }
  function mine(kind) {
    return N.feed().filter(function (x) { return x.kind === kind && x.player === me.id; });
  }

  /* ticket serial — what the operator asks for when checking a claim */
  function makeSerial(id, game) {
    var v = venue(), room = (v.code || 'WLW000').replace(/\D/g, '') || '000';
    var h = 0;
    var seed = id + ':' + game;
    for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    var block = h.toString(36).toUpperCase().slice(-4).padStart(4, 'X');
    return 'WLW-' + room + '-' + block + '-' + String(game).padStart(2, '0');
  }

  /* latest operator control aimed at this device */
  function myControl() {
    var last = null;
    N.feed().forEach(function (c) { if (c.kind === 'control' && c.target === me.id) last = c; });
    return last;
  }
  function banActive(c) {
    return c && c.action === 'ban' && (c.until === 'forever' || Number(c.until) > Date.now());
  }
  function awayText(m, pattern) {
    if (/full house/i.test(pattern)) return (15 - m.hits) + ' from a full house';
    var need = m.rows.map(function (r) { return r.tot - r.got; }).sort(function (a, b) { return a - b; });
    if (/two lines/i.test(pattern)) return (need[0] + need[1]) + ' from two lines';
    return need[0] + ' from a line';
  }

  /* ---------------- sign in ---------------------------------------- */
  function vSignIn() {
    var v = venue();
    var q = new URLSearchParams(location.search);
    var pre = q.get('code') || me.room || v.code || '';
    return '<header><div class="venue">' + esc(v.venueName) + '</div>' +
        '<div class="room">Join in</div>' +
        '<div class="who">Bingo · shoutouts · photos on the big screen</div></header>' +
      '<div class="wrap"><h2>Your details</h2><div class="card">' +
        '<label for="pName">Your name (shown on screen)</label>' +
        '<input id="pName" maxlength="24" placeholder="e.g. Dot from table 6" value="' + esc(me.name || '') + '">' +
        '<label for="pRoom">Room code</label>' +
        '<input id="pRoom" class="mono" maxlength="8" autocapitalize="characters" placeholder="WLW341" value="' + esc(pre) + '">' +
        '<div style="height:16px"></div>' +
        '<button class="btn" id="pGo">Enter</button>' +
        '<div class="note">Codes are shown on the screens in the room. Nothing is charged here — cards are issued by the operator.</div>' +
      '</div></div>';
  }

  /* ---------------- bingo ------------------------------------------ */
  function marks(card, called) {
    var hits = 0, rows = card.map(function (row) {
      var got = 0, tot = 0;
      row.forEach(function (n) { if (n) { tot++; if (called.indexOf(n) >= 0) { got++; hits++; } } });
      return { got: got, tot: tot };
    });
    return { hits: hits, rows: rows, lines: rows.filter(function (r) { return r.got === r.tot; }).length };
  }

  function vBingo() {
    var v = venue();
    if (!v.salesOpen && !me.card) {
      return '<h2>Bingo</h2><div class="card">' +
        '<div class="pill off">Sales closed</div>' +
        '<div class="note">Cards are not on sale yet. Keep this page open — it opens automatically when the operator starts selling for game ' + v.game + '.</div>' +
      '</div>';
    }
    if (!me.card) {
      return '<h2>Bingo</h2><div class="card">' +
        '<div class="pill on">Sales open</div>' +
        '<div class="big" style="margin:12px 0 2px">Game ' + v.game + '</div>' +
        '<div class="note" style="margin:0">' + esc(v.pattern) + ' · ' + money(v.prize) + ' prize</div>' +
        '<div style="height:16px"></div>' +
        '<button class="btn" id="bGet">Get my card</button>' +
        '<div class="note">One card per person. The operator sees your name join the game.</div>' +
      '</div>';
    }
    var card = me.card, m = marks(card, v.called);
    var full = m.hits === 15;
    var claimed = mine('claim').length > 0;
    var cells = '';
    card.forEach(function (row) {
      row.forEach(function (n) {
        if (!n) { cells += '<div class="cell blank"></div>'; return; }
        cells += '<div class="cell' + (v.called.indexOf(n) >= 0 ? ' hit' : '') + '">' + n + '</div>';
      });
    });
    var can = (m.lines >= 1 && /line/i.test(v.pattern)) || full || m.lines >= 2;
    return '<h2>Game ' + v.game + ' — ' + esc(v.pattern) + '</h2><div class="card">' +
      '<div class="mono" style="font-size:12px;color:var(--dim);letter-spacing:.06em">TICKET ' +
        esc(me.serial || makeSerial(me.id, v.game)) + '</div>' +
      '<div class="calls"><div class="cur">' + (v.current || '--') + '</div>' +
        '<div class="note mono" style="margin:0">last calls ' + esc(v.called.slice(-6).reverse().join(' · ') || '-') + '</div></div>' +
      '<div class="strip">' + cells + '</div>' +
      '<div class="note">' + m.hits + ' of 15 marked · <b style="color:var(--accent)">' +
        esc(awayText(m, v.pattern)) + '</b> · ' + money(v.prize) + '</div>' +
      '<div style="height:14px"></div>' +
      (claimed
        ? '<div class="pill on">Claim sent to the operator</div>'
        : '<button class="btn" id="bClaim"' + (can ? '' : ' disabled') + '>' +
            (full ? 'Claim full house!' : m.lines ? 'Claim line!' : 'Claim (when you have a line)') + '</button>') +
      '<div style="height:10px"></div>' +
      '<button class="btn ghost" id="bDrop">Leave this game</button>' +
      (flash.bingo ? '<div class="status ok">' + esc(flash.bingo) + '</div>' : '') +
    '</div>';
  }

  /* ---------------- shoutouts -------------------------------------- */
  function vShout() {
    var v = venue(), sent = mine('shoutout').slice(-4).reverse();
    if (!v.shoutoutsOpen) {
      return '<h2>Shoutouts</h2><div class="card"><div class="pill off">Closed</div>' +
        '<div class="note">The operator has shoutouts turned off right now.</div></div>';
    }
    return '<h2>Shoutouts</h2><div class="card">' +
      '<label for="sText">Message for the screens</label>' +
      '<textarea id="sText" maxlength="120" placeholder="Happy 60th to Maureen from all at table 9!">' + esc(draft.shout) + '</textarea>' +
      '<div style="height:12px"></div>' +
      '<button class="btn" id="sSend">Send to the screens</button>' +
      '<div class="note">The operator reads every message before it goes up. Keep it clean and keep it short.</div>' +
      (flash.shout ? '<div class="status ' + (flash.shout.indexOf('!') > -1 ? 'ok' : 'no') + '">' + esc(flash.shout) + '</div>' : '') +
      (sent.length ? '<div style="height:14px"></div>' + sent.map(function (x) {
        return '<div class="note" style="margin-top:8px">' +
          '<span class="pill ' + (x.status === 'approved' ? 'on' : x.status === 'rejected' ? 'off' : '') + '">' +
            (x.status === 'approved' ? 'On screen' : x.status === 'rejected' ? 'Not used' : 'Waiting') + '</span> ' +
          esc(x.text) + '</div>';
      }).join('') : '') +
    '</div>';
  }

  /* ---------------- photos ----------------------------------------- */
  function vPhoto() {
    var v = venue(), sent = mine('photo').slice(-6).reverse();
    if (!v.photosOpen) {
      return '<h2>Photos</h2><div class="card"><div class="pill off">Closed</div>' +
        '<div class="note">Photo uploads are turned off right now.</div></div>';
    }
    return '<h2>Photos</h2><div class="card">' +
      '<button class="btn" id="fPick">Choose or take a photo</button>' +
      '<input id="fInput" class="hide" type="file" accept="image/*">' +
      (draft.photo ? '<div class="shots"><img src="' + draft.photo + '" alt="your photo"></div>' +
        '<div style="height:12px"></div><button class="btn" id="fSend">Send to the photo wall</button>' : '') +
      '<div class="note">Photos are checked by the operator, then shown on the screens during Interactions. Only send photos everyone in them is happy with.</div>' +
      (flash.photo ? '<div class="status ' + (flash.photo.indexOf('!') > -1 ? 'ok' : 'no') + '">' + esc(flash.photo) + '</div>' : '') +
      (sent.length ? '<div class="shots">' + sent.map(function (x) {
        return '<img src="' + x.image + '" alt="sent photo" style="opacity:' + (x.status === 'approved' ? 1 : .5) + '">';
      }).join('') + '</div><div class="note">Dimmed photos are still waiting for the operator.</div>' : '') +
    '</div>';
  }

  /* ---------------- operator actions on this device ---------------- */
  function vBanned(c) {
    var until = c.until === 'forever' ? 'permanently'
      : 'until ' + new Date(Number(c.until)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return '<header><div class="venue">' + esc(venue().venueName) + '</div>' +
        '<div class="room">Access blocked</div></header>' +
      '<div class="wrap"><h2>Blocked</h2><div class="card">' +
        '<div class="pill off">' + esc(until) + '</div>' +
        '<div class="note">' + esc(c.text || 'The operator has blocked this device.') +
          ' Speak to a member of staff if you think this is a mistake.</div>' +
      '</div></div>';
  }

  function vDropped(c) {
    return '<header><div class="venue">' + esc(venue().venueName) + '</div>' +
        '<div class="room">Disconnected</div></header>' +
      '<div class="wrap"><h2>Removed</h2><div class="card">' +
        '<div class="pill off">Session ended</div>' +
        '<div class="note">' + esc(c.text || 'The operator has removed you from this session.') +
          ' Your card has been withdrawn.</div>' +
        '<div style="height:16px"></div>' +
        '<button class="btn ghost" id="dAck">Start again</button>' +
      '</div></div>';
  }

  /* ---------------- shell ------------------------------------------ */
  function render() {
    if (!me.id || !me.name) { app.innerHTML = vSignIn(); wire(); return; }
    var c = myControl();
    if (banActive(c)) { app.innerHTML = vBanned(c); return; }
    if (c && c.action === 'drop' && !(me.ackTs >= c.ts)) {
      if (me.card) { delete me.card; delete me.serial; save(); }
      app.innerHTML = vDropped(c);
      var ack = document.getElementById('dAck');
      if (ack) ack.addEventListener('click', function () { me.ackTs = c.ts; save(); render(); });
      return;
    }
    var v = venue();
    var body = tab === 'shout' ? vShout() : tab === 'photo' ? vPhoto() : vBingo();
    app.innerHTML =
      '<header><div class="venue">' + esc(v.venueName) + '</div>' +
        '<div class="room mono">' + esc(me.room || '—') + '</div>' +
        '<div class="who">' + esc(me.name) + ' · <a href="#" id="signout">change</a></div></header>' +
      '<div class="wrap">' + body + '</div>' +
      '<nav>' +
        '<div class="' + (tab === 'bingo' ? 'on' : '') + '" data-tab="bingo">Bingo</div>' +
        '<div class="' + (tab === 'shout' ? 'on' : '') + '" data-tab="shout">Shoutout</div>' +
        '<div class="' + (tab === 'photo' ? 'on' : '') + '" data-tab="photo">Photo</div>' +
      '</nav>';
    wire();
  }

  function on(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); }

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll('nav div'), function (d) {
      d.addEventListener('click', function () { tab = d.getAttribute('data-tab'); flash = { shout:'', photo:'', bingo:'' }; render(); });
    });
    on('signout', function (e) { e.preventDefault(); me = {}; save(); render(); });

    on('pGo', function () {
      var name = (document.getElementById('pName').value || '').trim();
      var room = (document.getElementById('pRoom').value || '').trim().toUpperCase();
      if (!name) { document.getElementById('pName').focus(); return; }
      me = { id: N.uid(), name: name, room: room };
      save();
      N.push({ kind: 'join', player: me.id, name: name, room: room, status: 'approved' });
      render();
    });

    on('bGet', function () {
      var v = venue();
      me.card = N.makeCard(me.id + ':' + v.game);
      me.serial = makeSerial(me.id, v.game);
      save();
      N.push({ kind: 'card', player: me.id, name: me.name, room: me.room, game: v.game,
               serial: me.serial, rows: me.card, status: 'approved' });
      flash.bingo = 'Card issued. Good luck!';
      render();
    });
    on('bDrop', function () { delete me.card; delete me.serial; save(); render(); });
    on('bClaim', function () {
      var v = venue(), m = marks(me.card, v.called);
      N.push({ kind: 'claim', player: me.id, name: me.name, room: me.room,
               serial: me.serial,
               text: (m.hits === 15 ? 'FULL HOUSE' : m.lines + ' line') + ' on game ' + v.game,
               game: v.game, status: 'pending' });
      flash.bingo = 'Claim sent — hold your card up. Ticket ' + me.serial;
      render();
    });

    var sText = document.getElementById('sText');
    if (sText) sText.addEventListener('input', function () { draft.shout = sText.value; });
    on('sSend', function () {
      var t = (draft.shout || '').trim();
      if (t.length < 3) { flash.shout = 'Type a message first.'; render(); return; }
      N.push({ kind: 'shoutout', player: me.id, name: me.name, room: me.room, text: t });
      draft.shout = '';
      flash.shout = 'Sent to the operator!';
      render();
    });

    on('fPick', function () { var i = document.getElementById('fInput'); if (i) i.click(); });
    var fi = document.getElementById('fInput');
    if (fi) fi.addEventListener('change', function () {
      var f = fi.files && fi.files[0];
      if (!f) return;
      shrink(f, function (dataUrl, err) {
        if (err) { flash.photo = 'Could not read that image.'; render(); return; }
        draft.photo = dataUrl; flash.photo = ''; render();
      });
    });
    on('fSend', function () {
      if (!draft.photo) return;
      N.push({ kind: 'photo', player: me.id, name: me.name, room: me.room, image: draft.photo });
      draft.photo = null;
      flash.photo = 'Sent for checking!';
      render();
    });
  }

  /* downscale in the browser so a phone photo is a few tens of KB */
  function shrink(file, cb) {
    var fr = new FileReader();
    fr.onerror = function () { cb(null, true); };
    fr.onload = function () {
      var img = new Image();
      img.onerror = function () { cb(null, true); };
      img.onload = function () {
        var max = (CFG.interact && CFG.interact.photoMaxPx) || 900;
        var sc = Math.min(1, max / Math.max(img.width, img.height));
        var cv = document.createElement('canvas');
        cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cb(cv.toDataURL('image/jpeg', (CFG.interact && CFG.interact.photoQuality) || 0.7));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  N.subscribe(function () { if (!document.activeElement || document.activeElement.tagName !== 'TEXTAREA') render(); });
  render();
  setInterval(function () {
    var a = document.activeElement, t = (a && a.tagName || '').toLowerCase();
    if (t !== 'input' && t !== 'textarea') render();
  }, 4000);
})();
