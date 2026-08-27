/* =====================================================================
   WILLOW Event System — VENUE SCREEN RENDERER (display.html)
   Read-only mirror of console state. Open one per screen; press F11 for
   full screen. Updates arrive over BroadcastChannel / localStorage.
   ===================================================================== */
(function () {
  var CFG = window.WILLOW_CONFIG, DATA = window.WILLOW_DATA, S = window.WillowStore;
  var root = document.getElementById('screen');

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function money(n) { return '£' + Number(n || 0).toLocaleString('en-GB'); }
  function nickname(n) { return n ? (DATA.nicknames[n] || 'Number ' + n) : ''; }
  function rooms() {
    var linked = S.get().bingo.linked || [];
    return CFG.rooms.filter(function (r) { return linked.indexOf(r.name) >= 0; });
  }
  function players() { return rooms().reduce(function (a, r) { return a + r.players; }, 0); }
  function activeMedia() { return S.get().media.filter(function (m) { return m.on; }); }

  function ticker() {
    var s = S.get();
    var next = s.events.slice(0, 4).map(function (e) { return e.time + ' ' + e.name; }).join('   ·   ');
    return 'COMING UP:   ' + next + '   ·   JOIN GAMES AT ' + s.joinDomain;
  }

  function board(cols, size) {
    var b = S.get().bingo, out = '';
    for (var n = 1; n <= CFG.bingo.ballCount; n++) {
      var cls = b.called.indexOf(n) >= 0 ? ' hit' : '';
      if (b.current === n) cls = ' cur';
      out += '<div class="c' + cls + '">' + n + '</div>';
    }
    return '<div class="board" style="grid-template-columns:repeat(' + cols + ',1fr)' + (size ? ';font-size:' + size + 'px' : '') + '">' + out + '</div>';
  }

  function ents() {
    var s = S.get(), list = activeMedia();
    var cur = list.length ? list[s.entsIndex % list.length] : null;
    return '<div class="stage">' +
      '<div class="ents-stage hatch">' +
        '<div class="mono" style="font-size:13px;opacity:.5">' + esc(cur ? cur.name : 'NO ACTIVE MEDIA') + '</div>' +
        '<div class="caption">' + esc(cur ? cur.caption : 'Enable media in the advertising folder') + '</div>' +
        '<div class="mono" style="font-size:15px;color:var(--w-accent)">' + esc(s.venueName + ' · ' + s.joinDomain) + '</div>' +
      '</div>' +
      (s.entsTicker ? '<div class="ticker">' + esc(ticker()) + '</div>' : '') + '</div>';
  }

  function bingo() {
    var s = S.get(), b = s.bingo;
    return '<div class="stage"><div class="bingo-stage">' +
      '<div style="display:flex;flex-direction:column;justify-content:center;gap:18px">' +
        '<div style="text-align:center">' +
          '<div class="mono" style="font-size:14px;opacity:.55">GAME ' + b.game + ' — ' + esc(b.pattern) + '</div>' +
          '<div class="hero">' + (b.current || '--') + '</div>' +
          '<div class="big" style="font-size:26px;color:var(--w-accent)">' + esc(nickname(b.current) || 'ready to call') + '</div>' +
        '</div>' +
        '<div class="mono" style="text-align:center;font-size:15px;opacity:.8">' + esc(b.called.slice(-6).reverse().join('   ') || 'no numbers called') + '</div>' +
        '<div class="join"><div class="mono" style="font-size:13px;opacity:.7">JOIN AT ' + esc(s.joinDomain) + '</div>' +
          '<div class="code">' + esc(b.code) + '</div>' +
          '<div class="mono" style="font-size:13px;color:var(--w-accent)">' + players() + ' PLAYERS · ' + rooms().length + ' ROOMS LINKED · ' + money(b.prize) + '</div></div>' +
      '</div>' + board(10) + '</div></div>';
  }

  function karaoke() {
    var s = S.get(), k = s.karaoke, song = DATA.songs[k.songIndex % DATA.songs.length];
    var lines = '';
    for (var o = -2; o <= 2; o++) {
      var i = k.lineIndex + o;
      lines += '<div class="l n' + Math.abs(o) + '">' + esc(i >= 0 && i < song.lines.length ? song.lines[i] : '') + '</div>';
    }
    var pct = Math.round(((k.lineIndex + 1) / song.lines.length) * 100);
    return '<div class="stage">' +
      '<div class="topbar"><div>' + esc(k.queue.length ? 'NOW SINGING: ' + k.queue[0].singer : 'SINGER LIST OPEN') + '</div>' +
        '<div>' + esc(song.title + ' (' + song.artist + ')') + '</div></div>' +
      '<div class="karaoke-stage">' + lines + '</div>' +
      '<div class="bar" style="height:9px"><i style="width:' + pct + '%"></i></div></div>';
  }

  function bigd() {
    var s = S.get(), b = s.bingo, g = s.bigd;
    return '<div class="stage"><div class="bigd-stage">' +
      '<div class="mono" style="display:flex;justify-content:space-between;font-size:15px;opacity:.6">' +
        '<div>' + esc(s.venueName) + ' — BiGD</div><div>' + esc(g.source) + '</div></div>' +
      '<div style="display:flex;align-items:center;gap:34px">' +
        '<div class="hero">' + (b.current || '--') + '</div>' +
        '<div><div class="big" style="font-size:38px">' + esc(nickname(b.current) || 'awaiting call') + '</div>' +
          '<div class="mono" style="font-size:16px;margin-top:12px;opacity:.8">PREVIOUS ' + esc(b.called.slice(-6).reverse().join('  ') || '-') + '</div>' +
          '<div class="mono" style="font-size:16px;margin-top:6px;color:var(--w-accent)">PRIZE ' + money(b.prize) + ' · ' + players() + ' PLAYERS</div></div>' +
      '</div>' + board(18, 15) +
      '<div class="mono" style="font-size:14px;color:var(--w-accent);box-shadow:inset 0 1px 0 rgba(255,255,255,.2);padding-top:12px;white-space:nowrap;overflow:hidden">BiGD ' +
        esc(g.protocol) + ' · ' + esc(g.source) + ' · JOIN AT ' + esc(s.joinDomain) + '</div>' +
    '</div></div>';
  }

  function games() {
    var s = S.get(), top, main, sub;
    if (s.gameTab === 'Higher or Lower') {
      var h = s.hol;
      top = 'HIGHER OR LOWER — STREAK ' + h.streak;
      main = h.current + '   vs   ' + (h.revealedNext ? h.next : '?');
      sub = h.status;
    } else if (s.gameTab === 'At The Races') {
      var r = s.races;
      top = 'AT THE RACES — RACE ' + r.num;
      main = (r.finished && r.winner !== null) ? DATA.runners[r.winner].name + ' WINS' : 'RUNNERS AND RIDERS';
      sub = DATA.runners.map(function (x, i) { return (i + 1) + ' ' + x.odds; }).join('   ·   ');
    } else {
      var q = s.quiz, qq = DATA.quiz[q.index % DATA.quiz.length];
      top = 'ROUND ' + q.round + ' — QUESTION ' + ((q.index % DATA.quiz.length) + 1);
      main = qq.q;
      sub = q.revealed ? 'ANSWER: ' + qq.a[qq.correct] : 'ANSWER ON YOUR PHONE — ' + s.joinDomain;
    }
    return '<div class="stage"><div class="games-stage">' +
      '<div class="mono" style="font-size:15px;opacity:.6">' + esc(top) + '</div>' +
      '<div class="main">' + esc(main) + '</div>' +
      '<div class="sub">' + esc(sub) + '</div></div></div>';
  }

  function interact() {
    var s = S.get(), i = s.interact || {}, feed = window.WillowNet.feed();
    var ok = function (k) { return feed.filter(function (x) { return x.kind === k && x.status === 'approved'; }); };
    var shouts = ok('shoutout').slice(-6).reverse();
    var photos = ok('photo').slice(-8).reverse();
    var show = i.showKind || 'Both';
    var wall = photos.length
      ? '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;flex:1;align-content:start">' +
          photos.map(function (p) {
            return '<div style="position:relative"><img src="' + p.image + '" alt="" ' +
              'style="width:100%;aspect-ratio:4/3;object-fit:cover;border:3px solid rgba(255,255,255,.12)">' +
              '<div class="mono" style="font-size:13px;opacity:.75;margin-top:6px">' + esc(p.name) + '</div></div>';
          }).join('') + '</div>'
      : '<div class="mono" style="opacity:.5;font-size:16px">NO PHOTOS APPROVED YET</div>';
    var wallSlot = (show === 'Shoutouts') ? '' : wall;
    var shoutSlot = (show === 'Photos') ? '' : (shouts.length
      ? '<div style="display:flex;flex-direction:column;gap:10px">' + shouts.map(function (x, idx) {
          return '<div style="font-size:' + (idx === 0 ? 34 : 22) + 'px;font-weight:700;line-height:1.15">' +
            esc(x.text) + '<span class="mono" style="font-size:14px;opacity:.6;font-weight:400"> — ' + esc(x.name) + '</span></div>';
        }).join('') + '</div>'
      : '<div class="mono" style="opacity:.5;font-size:16px">SEND A SHOUTOUT FROM YOUR PHONE</div>');

    return '<div class="stage"><div class="bigd-stage">' +
      '<div class="mono" style="display:flex;justify-content:space-between;font-size:15px;opacity:.6">' +
        '<div>' + esc(s.venueName) + ' — INTERACTIONS</div><div>' + (i.salesOpen ? 'BINGO SALES OPEN' : 'JOIN IN') + '</div></div>' +
      shoutSlot + wallSlot +
      '<div class="join" style="text-align:center"><div class="mono" style="font-size:14px;opacity:.7">JOIN IN AT</div>' +
        '<div class="code">' + esc(s.joinDomain) + '</div>' +
        '<div class="mono" style="font-size:14px;color:var(--w-accent)">ROOM CODE ' + esc(s.bingo.code) +
          (i.salesOpen ? ' · CARDS ON SALE NOW' : '') + '</div></div>' +
    '</div></div>';
  }

  function render() {
    var s = S.get();
    if (s.blackout) { root.innerHTML = '<div class="blackout">BLACKOUT</div>'; return; }
    switch (s.mode) {
      case 'bingo':   root.innerHTML = bingo(); break;
      case 'karaoke': root.innerHTML = karaoke(); break;
      case 'bigd':    root.innerHTML = bigd(); break;
      case 'games':   root.innerHTML = games(); break;
      case 'interact': root.innerHTML = interact(); break;
      default:        root.innerHTML = ents();
    }
    var tag = document.getElementById('screenTag');
    if (tag) tag.textContent = s.outRes + ' · ' + (s.signedOn ? s.operator : 'console offline');
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'F11') { ev.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    }
  });

  S.subscribe(render);
  window.WillowNet.subscribe(render);
  render();
  setInterval(render, 1000);   /* keeps countdowns / progress fresh if the console tab is throttled */
})();
