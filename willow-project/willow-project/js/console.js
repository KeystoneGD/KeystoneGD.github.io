/* =====================================================================
   WILLOW Event System — OPERATOR CONSOLE
   Renders the console window and owns every mode's live logic. The
   patron-facing screen (display.html) is a pure renderer of this state.
   ===================================================================== */
(function () {
  var CFG = window.WILLOW_CONFIG, DATA = window.WILLOW_DATA;
  var S = window.WillowStore, Theme = window.WillowTheme;
  var app = document.getElementById('app');

  /* ---------------- helpers ---------------------------------------- */
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function money(n) { return '£' + Number(n || 0).toLocaleString('en-GB'); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function clock() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function opt(list, sel) {
    return list.map(function (o) { return '<option' + (o === sel ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
  }
  function chk(on) { return '<div class="check">' + (on ? 'x' : '') + '</div>'; }
  function act(name, arg) { return 'data-act="' + name + '"' + (arg !== undefined ? ' data-arg="' + esc(arg) + '"' : ''); }
  function bind(path, type) { return 'data-bind="' + path + '"' + (type ? ' data-type="' + type + '"' : ''); }
  function modeDef(id) { return CFG.modes.filter(function (m) { return m.id === id; })[0] || CFG.modes[0]; }
  function activeMedia() { return S.get().media.filter(function (m) { return m.on; }); }
  function currentAd() { var a = activeMedia(); return a.length ? a[S.get().entsIndex % a.length] : null; }
  function rooms() {
    var linked = S.get().bingo.linked || [];
    return CFG.rooms.map(function (r) { return Object.assign({}, r, { linked: linked.indexOf(r.name) >= 0 }); });
  }
  function linkedRooms() { return rooms().filter(function (r) { return r.linked; }); }
  function tickerText() {
    var s = S.get();
    var next = s.events.slice(0, 4).map(function (e) { return e.time + ' ' + e.name; }).join('   ·   ');
    return 'COMING UP:   ' + next + '   ·   JOIN GAMES AT ' + s.joinDomain;
  }

  /* ---------------- transient (non-persisted) UI state ------------- */
  var menuOpen = null;
  var dialog = null;          /* {kind:'message'|'event', title, body, draft} */
  var displayWin = null;

  /* ---------------- menus / toolbar -------------------------------- */
  function menuDefs() {
    return [
      { name: 'File', items: [
        { label: 'New Event...',    key: 'Ctrl+N', act: 'event.new' },
        { label: 'Event Schedule',  key: 'F2',     act: 'nav', arg: 'events' },
        { label: 'Reports',         key: 'F9',     act: 'nav', arg: 'reports' },
        { label: 'Sign Off',        key: 'Ctrl+L', act: 'signoff' }
      ]},
      { name: 'Modes', items: CFG.modes.map(function (m) { return { label: m.label, key: '', act: 'mode', arg: m.id }; }) },
      { name: 'Media', items: [
        { label: 'Media Folder Manager', key: 'F4', act: 'nav', arg: 'media' },
        { label: 'Music Control',        key: 'F5', act: 'nav', arg: 'music' },
        { label: 'Rescan Advertising',   key: '',   act: 'media.rescan' }
      ]},
      { name: 'Games', items: [
        { label: 'Bingo Control',   key: '', act: 'mode', arg: 'bingo' },
        { label: 'Quiz',            key: '', act: 'game.tab', arg: 'Quiz' },
        { label: 'Higher or Lower', key: '', act: 'game.tab', arg: 'Higher or Lower' },
        { label: 'At The Races',    key: '', act: 'game.tab', arg: 'At The Races' }
      ]},
      { name: 'Screens', items: [
        { label: 'Open Screen Output', key: 'F11', act: 'display.open' },
        { label: 'Blackout Toggle',    key: 'F12', act: 'blackout' },
        { label: 'Display Settings',   key: '',    act: 'settings.tab', arg: 'Display' }
      ]},
      { name: 'Tools', items: [
        { label: 'Colour Scheme...',  key: '', act: 'settings.tab', arg: 'Colours' },
        { label: 'Venue Settings...', key: '', act: 'settings.tab', arg: 'Venue' },
        { label: 'Advanced / Data...',key: '', act: 'settings.tab', arg: 'Advanced' }
      ]},
      { name: 'Help', items: [ { label: 'About WILLOW', key: '', act: 'about' } ] }
    ];
  }

  var TOOLBAR = [
    ['Dashboard','dashboard','var(--w-title1)'], ['Schedule','events','#8a6f2a'], ['Ents','ents','#2a6f8a'],
    ['Bingo','bingo','#a3213c'], ['Karaoke','karaoke','#5c2a8a'], ['BiGD','bigd','#2a8a56'],
    ['Games','games','#8a4a2a'], ['Media','media','#6f6f6f'], ['Music','music','#2a8a8a'],
    ['Reports','reports','#444c6a'], ['Settings','settings','#8a2a6f']
  ];

  var TITLES = {
    dashboard: ['Operator Dashboard', 'terminal ' + CFG.terminal],
    events:    ['Event Schedule', 'double-click to edit'],
    ents:      ['Ents Mode — Advertising Rotation', ''],
    bingo:     ['Bingo Mode — Game Control', 'random draw, 1-' + CFG.bingo.ballCount],
    karaoke:   ['Karaoke Mode — Lyric Engine', 'instrumental library'],
    bigd:      ['BiGD — Bingo Information Graphical Display', ''],
    games:     ['Rich Media Games', 'patron-facing'],
    media:     ['Media Folder Manager', ''],
    music:     ['Music Control', ''],
    reports:   ['Reports', ''],
    settings:  ['System Settings', '']
  };

  /* ---------------- shell ------------------------------------------ */
  function shell() {
    var s = S.get(), m = modeDef(s.mode);
    var t = TITLES[s.view] || TITLES.dashboard;
    var hint = t[1] || (s.view === 'ents' ? ('rotation ' + (s.entsRunning ? 'running' : 'paused'))
      : s.view === 'media' ? s.mediaPath : s.view === 'music' ? s.musicSource
      : s.view === 'reports' ? s.reportPeriod : s.view === 'settings' ? s.settingsTab
      : s.view === 'bigd' ? s.bigd.source : '');

    return '' +
    '<div class="deskpad"><div class="win">' +
      '<div class="titlebar">' +
        '<div class="titleicon"></div>' +
        '<div class="caption">WILLOW Event System ' + CFG.build + ' &nbsp;-&nbsp; ' + esc(s.venueName) + ' &nbsp;[' + esc(m.label) + ']</div>' +
        '<div class="row" style="gap:2px">' +
          '<div class="sysbtn">_</div><div class="sysbtn">□</div>' +
          '<div class="sysbtn" ' + act('signoff') + ' title="Sign off">x</div>' +
        '</div>' +
      '</div>' +
      menubar() + toolbar() +
      '<div class="body">' + sidebar() +
        '<div class="content">' +
          '<div class="contenthead"><div class="t">' + esc(t[0]) + '</div><div class="mono dim">' + esc(hint) + '</div></div>' +
          '<div class="view">' + view() + '</div>' +
        '</div>' +
      '</div>' +
      statusbar() +
    '</div></div>' + (dialog ? dialogHtml() : '');
  }

  function menubar() {
    return '<div class="menubar">' + menuDefs().map(function (m) {
      var items = menuOpen === m.name ? '<div class="dropdown">' + m.items.map(function (it) {
        return '<div class="item" ' + act(it.act, it.arg) + '><div class="grow">' + esc(it.label) + '</div><div class="key">' + esc(it.key) + '</div></div>';
      }).join('') + '</div>' : '';
      return '<div class="menu' + (menuOpen === m.name ? ' open' : '') + '">' +
        '<div class="label" ' + act('menu', m.name) + ' data-menuhover="' + esc(m.name) + '">' + esc(m.name) + '</div>' + items + '</div>';
    }).join('') + '</div>';
  }

  function toolbar() {
    var v = S.get().view;
    return '<div class="toolbar">' + TOOLBAR.map(function (t) {
      return '<div class="tbtn' + (v === t[1] ? ' active' : '') + '" ' + act('nav', t[1]) + ' title="' + esc(t[0]) + '">' +
        '<div class="chip" style="background:' + t[2] + '"></div><div>' + esc(t[0]) + '</div></div>';
    }).join('') + '</div>';
  }

  function sidebar() {
    var s = S.get();
    var nodes = [];
    nodes.push({ label: s.venueName, glyph: '-', pad: 6, dot: 'var(--w-title1)', act: 'nav', arg: 'dashboard' });
    rooms().forEach(function (r) {
      nodes.push({ label: r.name, glyph: '', pad: 20, dot: r.linked ? 'var(--w-accent)' : '#9a9a9a', act: 'nav', arg: 'events' });
    });
    nodes.push({ label: 'Modes', glyph: '-', pad: 6, dot: '#8a6f2a', act: 'nav', arg: 'dashboard' });
    CFG.modes.forEach(function (m) {
      nodes.push({ label: m.label, glyph: '', pad: 20, dot: s.mode === m.id ? 'var(--w-accent)' : '#9a9a9a',
        sel: s.view === m.view, act: 'mode', arg: m.id });
    });
    nodes.push({ label: 'Media', glyph: '-', pad: 6, dot: '#6f6f6f', act: 'nav', arg: 'media' });
    nodes.push({ label: 'ADVERTISING', glyph: '', pad: 20, dot: '#6f6f6f', sel: s.view === 'media', act: 'nav', arg: 'media' });
    nodes.push({ label: 'MUSIC', glyph: '', pad: 20, dot: '#6f6f6f', sel: s.view === 'music', act: 'nav', arg: 'music' });
    nodes.push({ label: 'Reports', glyph: '', pad: 6, dot: '#444c6a', sel: s.view === 'reports', act: 'nav', arg: 'reports' });
    nodes.push({ label: 'Settings', glyph: '', pad: 6, dot: '#8a2a6f', sel: s.view === 'settings', act: 'nav', arg: 'settings' });

    var ad = currentAd();
    var preview = s.blackout ? 'BLACKOUT'
      : s.mode === 'ents' ? (ad ? ad.name + '<br>next in ' + s.entsCountdown + 's' : 'no active media')
      : s.mode === 'bingo' ? 'BINGO — call ' + (s.bingo.current || '--')
      : s.mode === 'karaoke' ? 'KARAOKE — lyric engine'
      : s.mode === 'bigd' ? 'BiGD board mirror' : 'RICH MEDIA GAMES';

    return '<div class="sidebar">' +
      '<div class="sidehead">Venue Explorer</div>' +
      '<div class="tree">' + nodes.map(function (n) {
        return '<div class="node' + (n.sel ? ' sel' : '') + '" style="padding-left:' + n.pad + 'px" ' + act(n.act, n.arg) + '>' +
          '<div class="glyph">' + n.glyph + '</div><div class="dot" style="background:' + n.dot + '"></div>' +
          '<div class="nowrap">' + esc(n.label) + '</div></div>';
      }).join('') + '</div>' +
      '<div class="sidebox">' +
        '<div class="bold mb6">Screen Output</div>' +
        '<div class="row mb6"><div class="btn grow" ' + act('display.open') + '>Show</div>' +
          '<div class="btn grow' + (s.blackout ? ' down' : '') + '" ' + act('blackout') + '>Blackout</div></div>' +
        '<div class="disp mono center" style="height:76px;display:flex;align-items:center;justify-content:center;padding:5px;line-height:1.5;font-size:10px">' + preview + '</div>' +
      '</div></div>';
  }

  function statusbar() {
    var s = S.get(), m = modeDef(s.mode);
    return '<div class="statusbar">' +
      '<div class="cell">Operator: ' + esc(s.operator) + '</div>' +
      '<div class="cell">Mode: ' + esc(m.label) + '</div>' +
      '<div class="cell">Screens ' + s.screenCount + ' / ' + (s.blackout ? 'BLACKOUT' : 'LIVE') + '</div>' +
      '<div class="cell">Music ' + (s.musicPlaying ? 'playing' : 'paused') + ' · vol ' + s.volume + '</div>' +
      '<div class="cell clock" id="clockCell">' + clock() + '</div></div>';
  }

  /* ---------------- views ------------------------------------------ */
  function view() {
    switch (S.get().view) {
      case 'events':   return vEvents();
      case 'ents':     return vEnts();
      case 'bingo':    return vBingo();
      case 'karaoke':  return vKaraoke();
      case 'bigd':     return vBigd();
      case 'games':    return vGames();
      case 'media':    return vMedia();
      case 'music':    return vMusic();
      case 'reports':  return vReports();
      case 'settings': return vSettings();
      default:         return vDashboard();
    }
  }

  function panel(title, body, extra) {
    return '<div class="panel"' + (extra ? ' style="' + extra + '"' : '') + '><div class="hd">' + title + '</div><div class="bd">' + body + '</div></div>';
  }

  function vDashboard() {
    var s = S.get();
    var today = new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    var tonight = '<div class="grid" style="grid-template-columns:62px 1fr 96px 96px 76px">' +
      ['Time','Event','Room','Mode','Status'].map(function (c) { return '<div class="th">' + c + '</div>'; }).join('') +
      s.events.slice(0, 5).map(function (e) {
        var sel = s.selEvent === e.id ? ' sel' : '';
        var td = function (v, cls) { return '<div class="td' + sel + (cls ? ' ' + cls : '') + '" ' + act('event.sel', e.id) + '>' + esc(v) + '</div>'; };
        return td(e.time, 'mono') + td(e.name) + td(e.room) + td(e.mode) + td(e.status);
      }).join('') + '</div>';

    var track = DATA.tracks[s.trackIndex % DATA.tracks.length];
    var music = '<div class="field groove" style="padding:6px;background:var(--w-field);color:var(--w-fieldtext)">' +
        '<div class="bold nowrap">' + esc(track.title) + '</div><div class="dim nowrap">' + esc(track.artist) + '</div>' +
        '<div class="bar mt6" style="height:9px;background:var(--w-face)"><i style="width:' + s.trackPos + '%"></i></div></div>' +
      '<div class="row mt6"><div class="btn grow" ' + act('music.prev') + '>|&lt;&lt;</div>' +
        '<div class="btn bold" style="flex:2" ' + act('music.toggle') + '>' + (s.musicPlaying ? 'PAUSE' : 'PLAY') + '</div>' +
        '<div class="btn grow" ' + act('music.next') + '>&gt;&gt;|</div></div>' +
      '<div class="row mt6"><div class="lbl" style="width:42px">Volume</div>' +
        '<input type="range" min="0" max="100" value="' + s.volume + '" class="grow" ' + bind('volume','int') + '>' +
        '<div class="mono right" style="width:24px">' + s.volume + '</div></div>';

    var modeCtl = '<div class="cols2">' + CFG.modes.map(function (m) {
      return '<div class="tbtn' + (s.mode === m.id ? ' active' : '') + '" style="padding:7px 8px;gap:7px" ' + act('mode', m.id) + '>' +
        '<div class="chip" style="width:14px;height:14px;background:' + (s.mode === m.id ? 'var(--w-accent)' : '#9a9a9a') + '"></div>' +
        '<div><div class="bold">' + esc(m.label) + '</div><div class="dim" style="font-size:10px">' + esc(m.sub) + '</div></div></div>';
    }).join('') + '</div>';

    var log = '<div class="log">' + s.syslog.slice().reverse().map(function (l) { return '<div class="nowrap">' + esc(l) + '</div>'; }).join('') + '</div>';

    return '<div class="cols3">' +
      '<div style="grid-column:span 2">' + panel('Tonight — ' + esc(today), tonight) + '</div>' +
      panel('Music — ' + esc(s.musicSource), music) +
      '<div style="grid-column:span 3" class="cols2">' + panel('Mode Control', modeCtl) + panel('System Log', log) + '</div>' +
    '</div>';
  }

  function vEvents() {
    var s = S.get(), f = (s.eventFilter || '').toLowerCase();
    var rows = s.events.filter(function (e) {
      return !f || (e.name + ' ' + e.room + ' ' + e.mode + ' ' + e.status).toLowerCase().indexOf(f) >= 0;
    });
    var cols = ['Date','Time','Event','Room','Mode','Cap.','Status'];
    var sel = s.events.filter(function (e) { return e.id === s.selEvent; })[0];
    return '<div class="row wrap mb6">' +
        '<div class="btn" ' + act('event.new') + '>New Event...</div>' +
        '<div class="btn" ' + act('event.edit') + '>Edit...</div>' +
        '<div class="btn" ' + act('event.del') + '>Delete</div>' +
        '<div class="btn bold" ' + act('event.load') + '>Load to Screen</div>' +
        '<div class="grow"></div>' +
        '<input type="text" placeholder="Filter..." style="width:154px" value="' + esc(s.eventFilter) + '" ' + bind('eventFilter') + '>' +
      '</div>' +
      '<div class="grid" style="grid-template-columns:100px 62px 1fr 112px 104px 66px 84px">' +
        cols.map(function (c) { return '<div class="th" ' + act('event.sort', c) + '>' + c + '</div>'; }).join('') +
        rows.map(function (e) {
          var cls = s.selEvent === e.id ? ' sel' : '';
          var td = function (v, extra) {
            return '<div class="td' + cls + (extra ? ' ' + extra : '') + '" ' + act('event.sel', e.id) + ' data-dbl="event.edit" data-dblarg="' + e.id + '">' + esc(v) + '</div>';
          };
          return td(e.date,'mono') + td(e.time,'mono') + td(e.name) + td(e.room) + td(e.mode) + td(e.capacity || '-','mono right') + td(e.status);
        }).join('') +
      '</div>' +
      '<div class="row mt6" style="justify-content:space-between"><div class="dim">' + rows.length + ' record(s) — double-click a row to edit</div>' +
      '<div class="dim">' + esc(sel ? sel.notes : '') + '</div></div>';
  }

  function vEnts() {
    var s = S.get(), cur = currentAd(), act_ = activeMedia();
    var list = '<div class="scroll h300"><div class="grid" style="grid-template-columns:28px 1fr 62px 56px 66px 54px">' +
      ['On','File name','Type','Dwell','Size','Plays'].map(function (c) { return '<div class="th">' + c + '</div>'; }).join('') +
      s.media.map(function (m, i) {
        var cls = (s.selMedia === i ? ' sel' : (m.on ? '' : ' off'));
        return '<div class="td center mono' + cls + '" ' + act('media.toggle', i) + '>' + (m.on ? 'x' : '') + '</div>' +
          '<div class="td mono' + cls + '" ' + act('media.sel', i) + '>' + (cur && cur.name === m.name ? '&gt; ' : '&nbsp;&nbsp;') + esc(m.name) + '</div>' +
          '<div class="td' + cls + '" ' + act('media.sel', i) + '>' + esc(m.kind) + '</div>' +
          '<div class="td mono right' + cls + '" ' + act('media.sel', i) + '>' + m.dwell + 's</div>' +
          '<div class="td mono right' + cls + '" ' + act('media.sel', i) + '>' + esc(m.size) + '</div>' +
          '<div class="td mono right' + cls + '" ' + act('media.sel', i) + '>' + m.plays + '</div>';
      }).join('') + '</div></div>' +
      '<div class="row wrap mt6">' +
        '<div class="btn bold" ' + act('ents.toggle') + '>' + (s.entsRunning ? 'PAUSE ROTATION' : 'START ROTATION') + '</div>' +
        '<div class="btn" ' + act('ents.skip') + '>Skip &gt;&gt;</div>' +
        '<div class="btn" ' + act('media.up') + '>Move Up</div>' +
        '<div class="btn" ' + act('media.down') + '>Move Down</div>' +
        '<div class="btn" ' + act('nav','media') + '>Media Folder...</div>' +
      '</div>';

    var preview = '<div class="disp preview169 hatch">' +
        '<div class="mono" style="font-size:10px;opacity:.65">' + esc(cur ? cur.name : 'NO ACTIVE MEDIA') + '</div>' +
        '<div class="bold" style="font-size:15px;line-height:1.35">' + esc(cur ? cur.caption : 'Enable at least one file in the advertising folder') + '</div>' +
        '<div class="mono" style="font-size:10px;color:var(--w-accent)">advert ' + (act_.length ? (s.entsIndex % act_.length) + 1 : 0) + ' / ' + act_.length + ' · next in ' + s.entsCountdown + 's</div>' +
      '</div>';

    var settings = '<div class="col gap6">' +
      '<div class="row"><div class="lbl" style="width:96px">Default dwell</div><input type="number" min="2" max="60" style="width:56px" value="' + s.entsInterval + '" ' + bind('entsInterval','int') + '><div>seconds</div></div>' +
      '<div class="row"><div class="lbl" style="width:96px">Transition</div><select class="grow" ' + bind('entsTransition') + '>' + opt(CFG.ents.transitions, s.entsTransition) + '</select></div>' +
      '<div class="checkrow" ' + act('ents.ticker') + '>' + chk(s.entsTicker) + '<div>Show event ticker strip</div></div>' +
      '<div class="checkrow" ' + act('ents.music') + '>' + chk(s.entsMusic) + '<div>Keep music playing over adverts</div></div>' +
      '<div class="note">' + act_.length + ' of ' + s.media.length + ' files enabled. Loop length ' +
        act_.reduce(function (a, m) { return a + (m.dwell || s.entsInterval); }, 0) + 's.</div></div>';

    return '<div class="split" style="grid-template-columns:1fr 322px">' +
      panel('Advertising Rotation — ' + esc(s.mediaPath), list) +
      '<div class="col gap8">' + panel('Screen Preview', preview) + panel('Rotation Settings', settings) + '</div></div>';
  }

  function vBingo() {
    var s = S.get(), b = s.bingo;
    var board = '<div class="board90">' ;
    for (var n = 1; n <= CFG.bingo.ballCount; n++) {
      var hit = b.called.indexOf(n) >= 0, cur = b.current === n;
      board += '<div class="cell' + (hit ? ' hit' : '') + (cur ? ' cur' : '') + '">' + n + '</div>';
    }
    board += '</div>';

    var head = '<div class="row mb8" style="align-items:stretch">' +
      '<div class="disp callbox">' +
        '<div class="mono" style="font-size:10px;opacity:.6">CALL</div>' +
        '<div class="n">' + (b.current || '--') + '</div>' +
        '<div style="font-size:10px;color:var(--w-accent);text-align:center;min-height:26px;line-height:1.3">' +
          esc(b.current ? (DATA.nicknames[b.current] || 'Number ' + b.current) : 'ready to call') + '</div>' +
      '</div>' +
      '<div class="col gap6 grow">' +
        '<div class="btn bold grow" style="display:flex;align-items:center;justify-content:center;font-size:15px" ' + act('bingo.call') + '>CALL NEXT NUMBER</div>' +
        '<div class="row">' +
          '<div class="btn grow' + (b.auto ? ' down' : '') + '" ' + act('bingo.auto') + '>Auto ' + (b.auto ? 'ON' : 'OFF') + '</div>' +
          '<div class="btn grow" ' + act('bingo.check') + '>Check Claim</div>' +
          '<div class="btn grow" ' + act('bingo.new') + '>New Game</div>' +
        '</div>' +
        '<div class="mono" style="padding:4px 6px;font-size:10px;background:var(--w-field);color:var(--w-fieldtext);box-shadow:inset 1px 1px 0 var(--w-shadow),inset -1px -1px 0 var(--w-light)">LAST: ' +
          esc(b.called.slice(-6).reverse().join('  ') || 'no numbers called') + '</div>' +
      '</div></div>';

    var controls = '<div class="row wrap mt6" style="gap:12px">' +
      '<div class="row"><div>Pattern</div><select ' + bind('bingo.pattern') + '>' + opt(CFG.bingo.patterns, b.pattern) + '</select></div>' +
      '<div class="row"><div>Prize £</div><input type="number" style="width:72px" value="' + b.prize + '" ' + bind('bingo.prize','int') + '></div>' +
      '<div class="row"><div>Auto speed</div><input type="number" min="2" max="20" style="width:52px" value="' + b.speed + '" ' + bind('bingo.speed','int') + '><div>s</div></div>' +
      '<div class="mono dim">' + b.called.length + ' of ' + CFG.bingo.ballCount + ' called</div></div>';

    var join = '<div class="disp pad center">' +
        '<div class="mono" style="font-size:10px;opacity:.65">' + esc(s.joinDomain) + '</div>' +
        '<div class="big" style="font-size:30px;letter-spacing:3px;margin-top:3px">' + esc(b.code) + '</div></div>' +
      '<div class="row mt6"><div class="btn grow" ' + act('bingo.code') + '>New Code</div>' +
        '<div class="btn grow' + (b.locked ? ' down' : '') + '" ' + act('bingo.lock') + '>' + (b.locked ? 'Locked' : 'Open') + '</div></div>' +
      '<div class="mono mt6">' + CFG.rooms[0].players + ' players in this room</div>';

    var lr = linkedRooms(), totalPlayers = lr.reduce(function (a, r) { return a + r.players; }, 0);
    var roomGrid = '<div class="grid" style="grid-template-columns:24px 1fr 78px 46px">' +
      ['','Room','Code','Plyrs'].map(function (c) { return '<div class="th">' + c + '</div>'; }).join('') +
      rooms().map(function (r) {
        var cls = r.linked ? ' sel' : '';
        return '<div class="td center mono' + cls + '" ' + act('bingo.link', r.name) + '>' + (r.linked ? 'x' : '') + '</div>' +
          '<div class="td' + cls + '" ' + act('bingo.link', r.name) + '>' + esc(r.name) + '</div>' +
          '<div class="td mono' + cls + '">' + esc(r.code) + '</div>' +
          '<div class="td mono right' + cls + '">' + r.players + '</div>';
      }).join('') + '</div>' +
      '<div class="note mt6">' + (lr.length > 1
        ? lr.length + ' rooms linked (' + esc(lr.map(function (r) { return r.name; }).join(', ')) + '). One draw feeds all boards, ' + totalPlayers + ' players competing for ' + money(b.prize) + '.'
        : 'Single room game — tick rooms to run one linked draw across boards.') + '</div>' +
      '<div class="btn bold mt6" ' + act('bingo.linkall') + '>' + (lr.length === CFG.rooms.length ? 'Unlink All Rooms' : 'Link All Rooms') + '</div>';

    return '<div class="split" style="grid-template-columns:1fr 302px">' +
      panel('Game ' + b.game + ' — ' + esc(b.pattern) + ' — Prize ' + money(b.prize), head + board + controls) +
      '<div class="col gap8">' + panel('Player Join', join) + panel('Linked Rooms', roomGrid) + '</div></div>';
  }

  function vKaraoke() {
    var s = S.get(), k = s.karaoke, song = DATA.songs[k.songIndex % DATA.songs.length];
    var queue = '<div style="min-height:176px;background:var(--w-field);color:var(--w-fieldtext);box-shadow:inset 1px 1px 0 var(--w-shadow),inset -1px -1px 0 var(--w-light)">' +
      k.queue.map(function (q, i) {
        var sel = k.selQueue === i;
        return '<div style="padding:4px 6px;cursor:default;box-shadow:inset 0 -1px 0 var(--w-face);' +
          (sel ? 'background:var(--w-sel);color:var(--w-seltext)' : '') + '" ' + act('karaoke.sel', i) + '>' +
          '<div class="row" style="gap:6px"><div class="mono">' + (i + 1) + '</div><div class="bold grow nowrap">' + esc(q.singer) + '</div></div>' +
          '<div class="dim nowrap">' + esc(q.song) + '</div></div>';
      }).join('') + '</div>' +
      '<div class="row mt6"><input type="text" class="grow" placeholder="Singer name" value="' + esc(k.newSinger) + '" ' + bind('karaoke.newSinger') + '>' +
        '<div class="btn" ' + act('karaoke.add') + '>Add</div></div>' +
      '<div class="row mt6"><div class="btn bold grow" ' + act('karaoke.next') + '>Next Singer</div>' +
        '<div class="btn grow" ' + act('karaoke.drop') + '>Remove</div></div>';

    var lines = '';
    for (var o = -2; o <= 2; o++) {
      var i = k.lineIndex + o;
      var text = (i >= 0 && i < song.lines.length) ? song.lines[i] : '';
      lines += '<div class="l n' + Math.abs(o) + '">' + esc(text) + '</div>';
    }
    var engine = '<div class="disp lyric">' + lines + '</div>' +
      '<div class="row wrap mt6">' +
        '<div class="btn bold" ' + act('karaoke.play') + '>' + (k.playing ? 'PAUSE' : 'PLAY') + '</div>' +
        '<div class="btn" ' + act('karaoke.restart') + '>Restart</div>' +
        '<div class="row" style="margin-left:6px"><div>Key</div>' +
          '<div class="btn" style="padding:3px 9px" ' + act('karaoke.pitch', -1) + '>-</div>' +
          '<div class="mono center" style="width:32px">' + (k.pitch > 0 ? '+' : '') + k.pitch + '</div>' +
          '<div class="btn" style="padding:3px 9px" ' + act('karaoke.pitch', 1) + '>+</div></div>' +
        '<div class="row"><div>Tempo</div><input type="range" min="80" max="120" style="width:94px" value="' + k.tempo + '" ' + bind('karaoke.tempo','int') + '>' +
          '<div class="mono" style="width:36px">' + k.tempo + '%</div></div>' +
      '</div>';

    var lib = '<div class="scroll h130"><div class="grid" style="grid-template-columns:1fr 1fr 54px 78px">' +
      ['Title','Artist','Key','Lyrics'].map(function (c) { return '<div class="th">' + c + '</div>'; }).join('') +
      DATA.songs.map(function (sg, i) {
        var cls = i === k.songIndex ? ' sel' : '';
        return ['title','artist','key','lyrics'].map(function (f) {
          return '<div class="td' + cls + (f === 'key' ? ' mono' : '') + '" ' + act('karaoke.load', i) + '>' + esc(sg[f]) + '</div>';
        }).join('');
      }).join('') + '</div></div>';

    return '<div class="split" style="grid-template-columns:272px 1fr">' +
      panel('Singer Queue', queue) +
      '<div class="col gap8">' + panel('Lyric Engine — ' + esc(song.title + ' (' + song.artist + ')'), engine) +
        panel('Instrumental Library — ' + esc(CFG.paths.karaoke), lib) + '</div></div>';
  }

  function vBigd() {
    var s = S.get(), g = s.bigd, b = s.bingo;
    var feed = b.called.slice(-8).reverse().map(function (n, i) {
      return '<div class="nowrap">&lt;STX&gt;CALL|' + pad(b.called.length - i) + '|N' + pad(n) + '|P' +
        esc(b.pattern.slice(0, 2).toUpperCase()) + '|CHK' + ((n * 37) % 256).toString(16).toUpperCase().padStart(2, '0') + '&lt;ETX&gt;</div>';
    }).join('') || '<div>&lt;STX&gt;IDLE|LISTEN|0000&lt;ETX&gt;</div>';

    var left = '<div class="col gap6">' +
      '<div class="row"><div class="lbl" style="width:84px">Source</div><select class="grow" ' + bind('bigd.source') + '>' + opt(CFG.bigd.sources, g.source) + '</select></div>' +
      '<div class="row"><div class="lbl" style="width:84px">Protocol</div><select class="grow" ' + bind('bigd.protocol') + '>' + opt(CFG.bigd.protocols, g.protocol) + '</select></div>' +
      '<div class="row"><div class="lbl" style="width:84px">Status</div>' +
        '<div class="row grow" style="padding:3px 5px;background:var(--w-field);color:var(--w-fieldtext);box-shadow:inset 1px 1px 0 var(--w-shadow),inset -1px -1px 0 var(--w-light)">' +
          '<div class="dot" style="width:9px;height:9px;background:' + (g.connected ? 'var(--w-accent)' : '#8a8a8a') + '"></div>' +
          '<div class="mono">' + (g.connected ? 'ONLINE — ' + b.called.length + ' frames' : 'OFFLINE — no carrier') + '</div></div>' +
        '<div class="btn" ' + act('bigd.connect') + '>' + (g.connected ? 'Disconnect' : 'Connect') + '</div></div>' +
      '<div class="bold">Field mapping</div>' +
      '<div class="grid" style="grid-template-columns:88px 1fr 1fr">' +
        ['Frame','Meaning','Display slot'].map(function (c) { return '<div class="th">' + c + '</div>'; }).join('') +
        CFG.bigd.mapping.map(function (m) {
          return '<div class="td mono">' + esc(m.frame) + '</div><div class="td">' + esc(m.meaning) + '</div>' +
            '<div class="td" style="color:var(--w-accent)">' + esc(m.slot) + '</div>';
        }).join('') + '</div>' +
      '<div class="bold">Raw feed monitor</div><div class="feed">' + feed + '</div></div>';

    var mini = '';
    for (var n = 1; n <= CFG.bingo.ballCount; n++) {
      var hit = b.called.indexOf(n) >= 0, cur = b.current === n;
      mini += '<div style="text-align:center;font-size:9px;padding:2px 0;font-family:\'Courier New\',monospace;' +
        (cur ? 'background:var(--w-accent);color:#fff' : hit ? 'background:rgba(255,255,255,.18);color:var(--w-dispfg)' : 'color:rgba(255,255,255,.28)') + '">' + n + '</div>';
    }
    var right = '<div class="disp pad">' +
        '<div class="row mono" style="justify-content:space-between;font-size:10px;opacity:.65"><div>' + esc(s.venueName) + '</div><div>GAME ' + b.game + ' / ' + esc(b.pattern) + '</div></div>' +
        '<div class="row" style="gap:11px;margin:8px 0">' +
          '<div class="big" style="width:94px;height:94px;flex:none;display:flex;align-items:center;justify-content:center;font-size:42px;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 2px var(--w-accent)">' + (b.current || '--') + '</div>' +
          '<div class="grow" style="min-width:0"><div class="big" style="font-size:16px">' + esc(b.current ? (DATA.nicknames[b.current] || 'Number ' + b.current) : 'awaiting call') + '</div>' +
            '<div class="mono nowrap" style="font-size:11px;margin-top:5px;opacity:.85">PREV: ' + esc(b.called.slice(-6).reverse().join('  ') || '-') + '</div>' +
            '<div class="mono" style="font-size:11px;margin-top:3px;color:var(--w-accent)">PRIZE ' + money(b.prize) + ' · ' + linkedRooms().reduce(function (a, r) { return a + r.players; }, 0) + ' PLAYERS</div></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(15,1fr);gap:1px">' + mini + '</div>' +
        '<div class="mono nowrap" style="margin-top:8px;font-size:10px;color:var(--w-accent);box-shadow:inset 0 1px 0 rgba(255,255,255,.18);padding-top:6px">BiGD ' +
          esc(g.protocol) + ' · ' + esc(g.source) + ' · JOIN AT ' + esc(s.joinDomain) + '</div></div>' +
      '<div class="btn bold mt6" ' + act('bigd.push') + '>Push Layout to All Screens</div>' +
      '<div class="note mt6">Legacy frames are reformatted to the venue layout above and mirrored to ' + s.screenCount + ' screens at ' + esc(s.outRes) + '.</div>';

    return '<div class="cols2">' + panel('BiGD — Equipment Interface', left) + panel('Reformatted Venue Output', right) + '</div>';
  }

  function vGames() {
    var s = S.get();
    var tabs = ['Quiz','Higher or Lower','At The Races'];
    var head = '<div class="tabs">' + tabs.map(function (t) {
      return '<div class="tab' + (s.gameTab === t ? ' active' : '') + '" ' + act('game.tab', t) + '>' + t + '</div>';
    }).join('') + '</div>';
    var body = s.gameTab === 'Higher or Lower' ? gHol() : s.gameTab === 'At The Races' ? gRaces() : gQuiz();
    return head + '<div class="tabbody">' + body + '</div>';
  }

  function gQuiz() {
    var s = S.get(), q = s.quiz, qq = DATA.quiz[q.index % DATA.quiz.length];
    var stage = '<div class="disp" style="padding:14px">' +
      '<div class="mono" style="font-size:10px;opacity:.7">ROUND ' + q.round + ' — QUESTION ' + ((q.index % DATA.quiz.length) + 1) + ' OF ' + DATA.quiz.length + '</div>' +
      '<div class="big" style="font-size:19px;margin:9px 0 12px;line-height:1.3">' + esc(qq.q) + '</div>' +
      '<div class="cols2">' + qq.a.map(function (a, i) {
        var cls = q.revealed ? (i === qq.correct ? ' correct' : (q.picked === i ? ' picked' : '')) : (q.picked === i ? ' picked' : '');
        return '<div class="quizopt' + cls + '" ' + act('quiz.pick', i) + '>' + String.fromCharCode(65 + i) + '.  ' + esc(a) + '</div>';
      }).join('') + '</div>' +
      '<div class="mono" style="margin-top:11px;font-size:11px;color:var(--w-accent);min-height:16px">' +
        (q.revealed ? 'ANSWER: ' + String.fromCharCode(65 + qq.correct) + ' — ' + esc(qq.a[qq.correct])
                    : (q.picked === null ? 'Answers locked at the buzzer' : 'Team answer registered')) + '</div></div>' +
      '<div class="row mt6"><div class="btn bold" ' + act('quiz.reveal') + '>Reveal Answer</div>' +
        '<div class="btn" ' + act('quiz.next') + '>Next Question</div>' +
        '<div class="btn" ' + act('quiz.reset') + '>Reset Round</div></div>';
    var scores = '<div class="groove" style="padding:7px"><div class="bold mb6">Team Scores</div>' +
      q.teams.map(function (t, i) {
        return '<div class="row" style="margin-bottom:4px"><div class="grow nowrap">' + esc(t.name) + '</div>' +
          '<div class="btn" style="padding:1px 7px" ' + act('quiz.score', i + ':-1') + '>-</div>' +
          '<div class="mono center" style="width:26px;background:var(--w-field);color:var(--w-fieldtext);box-shadow:inset 1px 1px 0 var(--w-shadow)">' + t.score + '</div>' +
          '<div class="btn" style="padding:1px 7px" ' + act('quiz.score', i + ':1') + '>+</div></div>';
      }).join('') + '</div>';
    return '<div class="split" style="grid-template-columns:1fr 242px">' + stage + scores + '</div>';
  }

  function gHol() {
    var h = S.get().hol;
    var stage = '<div class="disp center" style="padding:14px">' +
      '<div class="mono" style="font-size:10px;opacity:.7">HIGHER OR LOWER — STREAK ' + h.streak + ' — BEST ' + h.best + '</div>' +
      '<div class="row" style="justify-content:center;gap:22px;margin:14px 0">' +
        '<div><div class="mono" style="font-size:10px;opacity:.7">ON THE BOARD</div><div class="big" style="font-size:52px;line-height:1">' + h.current + '</div></div>' +
        '<div class="big" style="font-size:24px;opacity:.45">vs</div>' +
        '<div><div class="mono" style="font-size:10px;opacity:.7">NEXT</div><div class="big" style="font-size:52px;line-height:1;color:var(--w-accent)">' + (h.revealedNext ? h.next : '?') + '</div></div>' +
      '</div><div class="mono" style="font-size:12px;min-height:18px">' + esc(h.status) + '</div></div>' +
      '<div class="row mt6"><div class="btn bold grow" ' + act('hol.guess','higher') + '>HIGHER</div>' +
        '<div class="btn bold grow" ' + act('hol.guess','lower') + '>LOWER</div>' +
        '<div class="btn" ' + act('hol.reset') + '>Reset</div></div>';
    var side = '<div class="groove" style="padding:7px"><div class="bold mb6">Deck</div>' +
      '<div class="mono" style="font-size:10px;line-height:1.6">Cards 1-13 · drawn ' + h.drawn + ' · streak ' + h.streak + ' · best ' + h.best + '</div>' +
      '<div class="bold" style="margin:9px 0 5px">History</div>' +
      '<div class="log" style="height:130px">' + h.history.slice(-12).reverse().map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div></div>';
    return '<div class="split" style="grid-template-columns:1fr 242px">' + stage + side + '</div>';
  }

  function gRaces() {
    var r = S.get().races;
    var lanes = DATA.runners.map(function (x, i) {
      var win = r.finished && r.winner === i;
      return '<div class="track"><div class="big center" style="width:16px;font-size:12px">' + (i + 1) + '</div>' +
        '<div class="nowrap" style="width:112px;font-size:11px">' + esc(x.name) + '</div>' +
        '<div class="lane"><i style="width:' + Math.round(r.pos[i] || 0) + '%;background:' + (win ? 'var(--w-accent)' : x.color) + '"></i></div>' +
        '<div class="mono right" style="width:38px;font-size:11px">' + esc(x.odds) + '</div></div>';
    }).join('');
    var stage = '<div class="disp" style="padding:12px">' +
      '<div class="row mono" style="justify-content:space-between;font-size:10px;opacity:.7"><div>AT THE RACES — RACE ' + r.num + '</div>' +
        '<div>' + (r.running ? 'UNDER ORDERS' : (r.finished ? 'RESULT' : 'BETTING OPEN')) + '</div></div>' +
      '<div class="col gap6" style="margin-top:9px">' + lanes + '</div>' +
      '<div class="big" style="margin-top:10px;font-size:15px;color:var(--w-accent);min-height:20px">' +
        (r.finished && r.winner !== null ? 'WINNER: ' + (r.winner + 1) + ' ' + esc(DATA.runners[r.winner].name) + ' at ' + esc(DATA.runners[r.winner].odds)
          : (r.running ? '' : 'Place your bets at the tote')) + '</div></div>' +
      '<div class="row mt6"><div class="btn bold wide" ' + act('race.start') + '>Start Race</div>' +
        '<div class="btn wide" ' + act('race.new') + '>New Card</div></div>';
    var tote = '<div class="groove" style="padding:7px"><div class="bold mb6">Tote</div>' +
      DATA.runners.map(function (x, i) {
        return '<div class="row mono" style="justify-content:space-between;font-size:10px;margin-bottom:3px">' +
          '<div class="nowrap">' + (i + 1) + ' ' + esc(x.name) + '</div><div>' + money(x.stake) + '</div></div>';
      }).join('') +
      '<div class="mono" style="margin-top:9px;padding-top:6px;box-shadow:inset 0 1px 0 var(--w-shadow);font-size:10px">POOL ' +
        money(DATA.runners.reduce(function (a, x) { return a + x.stake; }, 0)) + '</div></div>';
    return '<div class="split" style="grid-template-columns:1fr 242px">' + stage + tote + '</div>';
  }

  function vMedia() {
    var s = S.get(), sel = s.media[s.selMedia] || {};
    var tiles = '<div class="tiles">' + s.media.map(function (m, i) {
      return '<div class="tile' + (s.selMedia === i ? ' sel' : '') + '" ' + act('media.sel', i) + '>' +
        '<div class="thumb" style="opacity:' + (m.on ? 1 : .4) + '">' + esc(m.kind + ' · ' + m.size) + '</div>' +
        '<div class="mono nowrap" style="margin-top:3px;font-size:10px">' + esc(m.name) + '</div></div>';
    }).join('') + '</div>';
    var left = '<div class="row mb6"><div>Path</div>' +
        '<input type="text" class="grow mono" value="' + esc(s.mediaPath) + '" ' + bind('mediaPath') + '>' +
        '<div class="btn" ' + act('media.rescan') + '>Rescan</div></div>' + tiles +
      '<div class="row wrap mt8"><div class="btn" ' + act('media.add') + '>Add Media...</div>' +
        '<div class="btn" ' + act('media.remove') + '>Remove</div>' +
        '<div class="btn" ' + act('media.test') + '>Test on Screen</div></div>';
    var props = '<div class="col gap6">' +
      '<div class="row"><div class="lbl" style="width:62px">Name</div><input type="text" class="grow mono" value="' + esc(sel.name || '') + '" ' + bind('media.sel.name') + '></div>' +
      '<div class="row"><div class="lbl" style="width:62px">Caption</div><input type="text" class="grow" value="' + esc(sel.caption || '') + '" ' + bind('media.sel.caption') + '></div>' +
      '<div class="row"><div class="lbl" style="width:62px">Dwell</div><input type="number" min="2" max="60" style="width:58px" value="' + (sel.dwell || 0) + '" ' + bind('media.sel.dwell','int') + '><div>seconds</div></div>' +
      '<div class="row"><div class="lbl" style="width:62px">Type</div><div class="mono">' + esc(sel.kind || '-') + '</div></div>' +
      '<div class="row"><div class="lbl" style="width:62px">Size</div><div class="mono">' + esc(sel.size || '-') + '</div></div>' +
      '<div class="row"><div class="lbl" style="width:62px">Plays</div><div class="mono">' + (sel.plays || 0) + '</div></div>' +
      '<div class="checkrow" ' + act('media.toggle', s.selMedia) + '>' + chk(sel.on) + '<div>Include in Ents rotation</div></div>' +
      '<div class="note">Drop replacement artwork into the advertising folder and press Rescan. Files play in list order during Ents Mode.</div></div>';
    return '<div class="split" style="grid-template-columns:1fr 302px">' +
      panel('Advertising Media Folder', left) + panel('Properties', props) + '</div>';
  }

  function vMusic() {
    var s = S.get(), M = window.WillowMusic, st = M.status();
    var isSpotify = /spotify/i.test(s.musicSource);
    var list = M.trackList();

    var sources = '<div class="row wrap mb8" style="gap:16px">' + CFG.music.sources.map(function (src) {
      var label = src === 'Local folder' ? 'Local files (' + (list.length || 0) + ' loaded)' : src;
      return '<div class="checkrow" ' + act('music.source', src) + '>' +
        '<div class="radio' + (s.musicSource === src ? ' on' : '') + '"><i></i></div><div>' + esc(label) + '</div></div>';
    }).join('') + '</div>';

    /* ---- Spotify link block ---- */
    var spotify = '<div class="row mb6"><div class="lbl" style="width:74px">Client ID</div>' +
        '<input class="grow mono" id="spClient" value="' + esc(M.clientId()) + '" placeholder="32-char ID from developer.spotify.com">' +
        '<div class="btn" ' + act('music.saveclient') + '>Save</div></div>' +
      '<div class="row mb6"><div class="lbl" style="width:74px">Redirect</div>' +
        '<div class="field groove grow mono" style="padding:3px 4px;font-size:10px;min-width:0;overflow:auto;word-break:break-all">' + esc(M.redirectUri()) + '</div></div>' +
      '<div class="row mb6">' +
        '<div class="btn bold grow" ' + act('music.link') + '>' + (M.linked() ? 'Re-authorise Spotify' : 'Link Spotify account') + '</div>' +
        (M.linked() ? '<div class="btn" ' + act('music.unlink') + '>Unlink</div>' : '') + '</div>' +
      '<div class="note">' + (M.linked()
        ? 'Linked' + (st.account ? ' — ' + esc(st.account) : '') + '. Device: ' + (st.ready ? 'ready' : 'starting...') +
          '. Spotify Premium is required for playback inside the console.'
        : 'Register a Spotify app at developer.spotify.com, add the redirect URI above to it, paste the client ID here, then press Link. Premium account required.') + '</div>';

    /* ---- local folder block ---- */
    var local = '<div class="row mb6">' +
        '<div class="btn bold grow" ' + act('music.pickfolder') + '>Load music folder...</div>' +
        '<div class="btn grow" ' + act('music.pickfiles') + '>Load files...</div></div>' +
      '<div class="note">Point this at the venue music folder (' + esc(CFG.paths.music) + ' on the operator PC). Files stay on this machine — nothing is uploaded. Re-pick the folder after a console restart. Files named "Artist - Title.mp3" split automatically.</div>';

    var queue = list.length
      ? '<div class="grid" style="grid-template-columns:26px 1fr 1fr 54px">' +
        ['','Track','Artist','Time'].map(function (c) { return '<div class="th">' + c + '</div>'; }).join('') +
        list.map(function (t, i) {
          var cls = i === s.trackIndex ? ' sel' : '';
          return '<div class="td center mono' + cls + '" ' + act('music.play', i) + '>' + (i === s.trackIndex ? (st.playing ? '>' : '=') : '') + '</div>' +
            '<div class="td' + cls + '" ' + act('music.play', i) + '>' + esc(t.title) + '</div>' +
            '<div class="td' + cls + '" ' + act('music.play', i) + '>' + esc(t.artist) + '</div>' +
            '<div class="td mono right' + cls + '" ' + act('music.play', i) + '>' + esc(t.time) + '</div>';
        }).join('') + '</div>'
      : '<div class="note">No local files loaded. Use "Load music folder..." above, or set a src path on each entry in js/data.js tracks[].</div>';

    var left = sources +
      '<div class="row mb6"><div class="lbl" style="width:74px">Output zone</div><select class="grow" ' + bind('musicZone') + '>' + opt(CFG.music.zones, s.musicZone) + '</select></div>' +
      '<div class="row mb8"><div class="lbl" style="width:74px">Playlist</div><select class="grow" ' + bind('musicPlaylist') + '>' + opt(CFG.music.playlists, s.musicPlaylist) + '</select></div>' +
      (isSpotify ? spotify : local + (list.length ? '<div class="mt8">' + queue + '</div>' : ''));

    var right = '<div class="disp pad">' +
        '<div class="mono" style="font-size:10px;opacity:.7">' + (st.playing ? 'PLAYING' : 'PAUSED') + ' · ' +
          (isSpotify ? 'SPOTIFY' : 'LOCAL') + ' · ' + esc(s.musicZone) + '</div>' +
        '<div class="bold" style="margin-top:4px">' + esc(st.title || '—') + '</div>' +
        '<div class="dim">' + esc(st.artist || 'nothing loaded') + '</div>' +
        '<div class="bar mt6"><i style="width:' + Math.round(st.pos) + '%"></i></div>' +
        '<div class="mono" style="font-size:10px;opacity:.6;margin-top:3px">' + esc(st.time || '') + '</div></div>' +
      '<div class="row mt6"><div class="btn grow" ' + act('music.prev') + '>|&lt;&lt;</div>' +
        '<div class="btn bold" style="flex:2" ' + act('music.toggle') + '>' + (st.playing ? 'PAUSE' : 'PLAY') + '</div>' +
        '<div class="btn grow" ' + act('music.next') + '>&gt;&gt;|</div></div>' +
      '<div class="row mt6"><div class="lbl" style="width:42px">Volume</div>' +
        '<input type="range" min="0" max="100" class="grow" value="' + s.volume + '" ' + bind('volume','int') + '>' +
        '<div class="mono right" style="width:24px">' + s.volume + '</div></div>' +
      '<div class="checkrow mt6" ' + act('music.duck') + '>' + chk(s.duck) + '<div>Duck music on bingo call / mic</div></div>' +
      '<div class="note mt8 mono" style="font-size:10px">' + esc(st.message || '') + '</div>';

    return '<div class="split" style="grid-template-columns:minmax(0,1fr) 302px">' +
      panel('Music Source', left) + panel('Transport', right) + '</div>';
  }

  function vReports() {
    var s = S.get();
    var mult = s.reportPeriod === 'Last 30 days' ? 4 : (s.reportPeriod === 'Quarter to date' ? 12 : 1);
    var rows = DATA.reportRows;
    var takings = rows.reduce(function (a, r) { return a + r.takings; }, 0) * mult;
    var payout = rows.reduce(function (a, r) { return a + r.payout; }, 0) * mult;
    var players = rows.reduce(function (a, r) { return a + r.players; }, 0) * mult;
    var kpis = [
      ['Sessions run', String(rows.length * mult), '+' + (2 * mult) + ' vs prior'],
      ['Players', players.toLocaleString('en-GB'), '+6.4%'],
      ['Takings', money(takings), '+3.1%'],
      ['Margin', Math.round(((takings - payout) / takings) * 100) + '%', money(takings - payout) + ' net']
    ];
    return '<div class="row mb6"><div>Period</div>' +
        '<select ' + bind('reportPeriod') + '>' + opt(['This week','Last 30 days','Quarter to date'], s.reportPeriod) + '</select>' +
        '<div class="btn" ' + act('report.print') + '>Print...</div>' +
        '<div class="btn" ' + act('report.csv') + '>Export CSV</div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px" class="mb8">' + kpis.map(function (k) {
        return '<div class="kpi"><div class="dim">' + k[0] + '</div><div class="v">' + k[1] + '</div>' +
          '<div class="mono" style="font-size:10px;color:var(--w-accent)">' + k[2] + '</div></div>';
      }).join('') + '</div>' +
      '<div class="grid" style="grid-template-columns:92px 1fr 100px 68px 62px 84px 80px">' +
        ['Date','Session','Mode','Players','Rooms','Takings','Payout'].map(function (c) { return '<div class="th">' + c + '</div>'; }).join('') +
        rows.map(function (r) {
          return '<div class="td mono">' + r.date + '</div><div class="td">' + esc(r.session) + '</div><div class="td">' + esc(r.mode) + '</div>' +
            '<div class="td mono right">' + (r.players || '-') + '</div><div class="td mono right">' + r.rooms + '</div>' +
            '<div class="td mono right">' + money(r.takings) + '</div><div class="td mono right">' + (r.payout ? money(r.payout) : '-') + '</div>';
        }).join('') + '</div>' +
      '<div class="row mono mt6" style="justify-content:flex-end;gap:18px"><div>TAKINGS ' + money(takings) + '</div>' +
        '<div>PAYOUT ' + money(payout) + '</div><div>MARGIN ' + Math.round(((takings - payout) / takings) * 100) + '%</div></div>';
  }

  function vSettings() {
    var s = S.get(), tabs = ['Colours','Venue','Display','Advanced'];
    var head = '<div class="tabs">' + tabs.map(function (t) {
      return '<div class="tab' + (s.settingsTab === t ? ' active' : '') + '" ' + act('settings.tab', t) + '>' + t + '</div>';
    }).join('') + '</div>';
    var body = s.settingsTab === 'Venue' ? sVenue() : s.settingsTab === 'Display' ? sDisplay()
      : s.settingsTab === 'Advanced' ? sAdvanced() : sColours();
    return head + '<div class="tabbody">' + body + '</div>';
  }

  function sColours() {
    var s = S.get(), theme = s.theme;
    var presets = '<div class="row wrap mb8">' + Object.keys(CFG.presets).map(function (name) {
      var p = CFG.presets[name];
      return '<div class="tab' + (s.preset === name ? ' active' : '') + '" style="display:flex;align-items:center;gap:6px;padding:5px 9px" ' + act('theme.preset', name) + '>' +
        '<div class="swatches"><i style="background:' + p.title1 + '"></i><i style="background:' + p.face + '"></i><i style="background:' + p.accent + '"></i></div>' +
        '<div>' + name + '</div></div>';
    }).join('') + '</div>';
    var slots = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 16px">' + CFG.themeLabels.map(function (t) {
      var k = t[0];
      return '<div class="row"><div class="grow">' + t[1] + '</div>' +
        '<div class="mono" style="font-size:10px;opacity:.7">' + esc(theme[k] || '') + '</div>' +
        '<input type="color" value="' + esc(theme[k] || '#000000') + '" ' + bind('theme.' + k) + '></div>';
    }).join('') + '</div>';
    var sample = '<div class="bold mb6">Sample</div>' +
      '<div class="out" style="padding:3px;background:var(--w-face)">' +
        '<div style="padding:2px 5px;font-weight:bold;background:linear-gradient(90deg,var(--w-title1),var(--w-title2));color:var(--w-titletext)">Sample Window</div>' +
        '<div style="padding:8px"><div class="mb6">Normal window text</div>' +
          '<div class="mb6" style="padding:2px 5px;background:var(--w-sel);color:var(--w-seltext)">Selected item</div>' +
          '<div class="mb6 groove" style="padding:3px 5px;background:var(--w-field);color:var(--w-fieldtext)">Field text</div>' +
          '<div class="row"><div class="btn">OK</div><div class="btn">Cancel</div></div></div></div>' +
      '<div class="bold" style="margin:12px 0 6px">Screen output sample</div>' +
      '<div class="disp pad center"><div class="big" style="font-size:30px">42</div>' +
        '<div class="mono" style="color:var(--w-accent);font-size:10px;margin-top:3px">ACCENT TEXT</div></div>';
    return '<div class="split" style="grid-template-columns:1fr 292px">' +
      '<div><div class="bold mb6">Scheme presets</div>' + presets +
        '<div class="bold mb6">Individual elements</div>' + slots +
        '<div class="row" style="margin-top:13px"><div class="btn" ' + act('theme.restore') + '>Restore Defaults</div>' +
        '<div class="btn bold" ' + act('theme.save') + '>Apply &amp; Save</div></div></div>' +
      '<div>' + sample + '</div></div>';
  }

  function sVenue() {
    var s = S.get();
    return '<div class="cols2">' +
      '<div class="col gap6">' +
        '<div class="row"><div class="lbl" style="width:100px">Venue name</div><input type="text" class="grow" value="' + esc(s.venueName) + '" ' + bind('venueName') + '></div>' +
        '<div class="row"><div class="lbl" style="width:100px">Licence no.</div><input type="text" class="grow mono" value="' + esc(s.licence) + '" ' + bind('licence') + '></div>' +
        '<div class="row"><div class="lbl" style="width:100px">Join domain</div><input type="text" class="grow mono" value="' + esc(s.joinDomain) + '" ' + bind('joinDomain') + '></div>' +
        '<div class="row"><div class="lbl" style="width:100px">Operators</div><input type="text" class="grow" value="' + esc(s.operatorList) + '" ' + bind('operatorList') + '></div>' +
        '<div class="note">Operator PINs live in js/config.js. Rooms and codes are configured there too.</div>' +
      '</div>' +
      '<div><div class="bold mb6">Rooms &amp; codes</div>' +
        '<div style="background:var(--w-field);color:var(--w-fieldtext)" class="groove">' + CFG.rooms.map(function (r) {
          return '<div class="row" style="justify-content:space-between;padding:3px 6px;box-shadow:inset 0 -1px 0 var(--w-face)">' +
            '<div>' + esc(r.name) + '</div><div class="mono">' + esc(r.code) + '</div></div>';
        }).join('') + '</div></div></div>';
  }

  function sDisplay() {
    var s = S.get();
    return '<div class="col gap8" style="max-width:520px">' +
      '<div class="row"><div class="lbl" style="width:126px">Output resolution</div>' +
        '<select class="grow" ' + bind('outRes') + '>' + opt(CFG.display.resolutions, s.outRes) + '</select></div>' +
      '<div class="row"><div class="lbl" style="width:126px">Screens attached</div>' +
        '<input type="number" min="1" max="8" style="width:58px" value="' + s.screenCount + '" ' + bind('screenCount','int') + '></div>' +
      s.displayFlags.map(function (f, i) {
        return '<div class="checkrow" ' + act('display.flag', i) + '>' + chk(f.on) + '<div>' + esc(f.label) + '</div></div>';
      }).join('') +
      '<div class="note">Screen output opens in its own window (Screens &gt; Open Screen Output) — drag it to the venue display and press F11 for full screen.</div></div>';
  }

  function sAdvanced() {
    var s = S.get();
    return '<div class="col gap8" style="max-width:560px">' +
      '<div class="note">All settings, events, media entries and game state are stored locally on this terminal. Clearing local data resets WILLOW to the values in js/config.js and js/data.js.</div>' +
      '<div class="row"><div class="lbl" style="width:126px">Data store key</div><div class="mono">' + esc(CFG.storageKey) + '</div></div>' +
      '<div class="row"><div class="lbl" style="width:126px">Sync channel</div><div class="mono">' + esc(CFG.channel) + '</div></div>' +
      '<div class="row"><div class="lbl" style="width:126px">Build</div><div class="mono">' + CFG.build + ' / BiGD ' + CFG.bigdBuild + '</div></div>' +
      '<div class="row"><div class="lbl" style="width:126px">Records held</div><div class="mono">' + s.events.length + ' events · ' + s.media.length + ' media files · ' + s.bingo.called.length + ' calls this game</div></div>' +
      '<div class="row" style="margin-top:4px"><div class="btn" ' + act('diag') + '>Diagnostics...</div>' +
        '<div class="btn" ' + act('data.clear') + '>Clear Local Data</div></div></div>';
  }

  function dialogHtml() {
    var d = dialog, body;
    if (d.kind === 'event') {
      var e = d.draft;
      body = '<div class="col gap6">' +
        '<div class="row"><div class="lbl" style="width:76px">Event name</div><input type="text" class="grow" value="' + esc(e.name) + '" data-draft="name"></div>' +
        '<div class="row"><div class="lbl" style="width:76px">Date / time</div><input type="date" value="' + esc(e.date) + '" data-draft="date"><input type="time" value="' + esc(e.time) + '" data-draft="time"></div>' +
        '<div class="row"><div class="lbl" style="width:76px">Room</div><select class="grow" data-draft="room">' + opt(CFG.rooms.map(function (r) { return r.name; }), e.room) + '</select></div>' +
        '<div class="row"><div class="lbl" style="width:76px">Mode</div><select class="grow" data-draft="mode">' + opt(['Ents','Bingo','Karaoke','BiGD','Rich Media'], e.mode) + '</select></div>' +
        '<div class="row"><div class="lbl" style="width:76px">Capacity</div><input type="number" style="width:78px" value="' + (e.capacity || 0) + '" data-draft="capacity" data-type="int">' +
          '<div class="lbl right" style="width:44px">Status</div><select class="grow" data-draft="status">' + opt(['Scheduled','On Sale','Live','Closed'], e.status) + '</select></div>' +
        '<div class="row" style="align-items:flex-start"><div class="lbl" style="width:76px;padding-top:3px">Notes</div>' +
          '<textarea class="grow" rows="3" data-draft="notes">' + esc(e.notes || '') + '</textarea></div></div>';
    } else {
      body = '<div class="row" style="align-items:flex-start;gap:11px"><div class="icon-i">i</div>' +
        '<div style="line-height:1.55;padding-top:3px">' + esc(d.body) + '</div></div>';
    }
    return '<div class="modal"><div class="dialog">' +
      '<div class="hd"><div class="t">' + esc(d.title) + '</div><div class="sysbtn" ' + act('dialog.close') + '>x</div></div>' +
      '<div class="bd">' + body + '<div class="buttons">' +
        (d.kind === 'event' ? '<div class="btn bold" style="padding:4px 18px" ' + act('dialog.ok') + '>OK</div>' : '') +
        '<div class="btn" style="padding:4px 18px" ' + act('dialog.close') + '>' + (d.kind === 'event' ? 'Cancel' : 'OK') + '</div>' +
      '</div></div></div></div>';
  }

  /* ---------------- actions ---------------------------------------- */
  function message(title, body) { dialog = { kind: 'message', title: title, body: body }; render(); }

  function callNumber() {
    var b = S.get().bingo, left = [];
    for (var n = 1; n <= CFG.bingo.ballCount; n++) if (b.called.indexOf(n) < 0) left.push(n);
    if (!left.length) { S.setIn('bingo', { auto: false }); message('Game Complete', 'All ' + CFG.bingo.ballCount + ' numbers called. Start a new game.'); return; }
    var pick = left[Math.floor(Math.random() * left.length)];
    S.setIn('bingo', { called: b.called.concat([pick]), current: pick });
    if (S.get().duck) {
      window.WillowMusic.duck(true);
      setTimeout(function () { window.WillowMusic.duck(false); }, 3000);
    }
    S.log('Call ' + (b.called.length + 1) + ': number ' + pick);
  }

  function entsAdvance() {
    var s = S.get(), list = activeMedia();
    if (!list.length) return;
    var cur = list[s.entsIndex % list.length];
    var nextIdx = (s.entsIndex + 1) % list.length;
    var next = list[nextIdx];
    S.set({
      entsIndex: nextIdx,
      entsCountdown: next.dwell || s.entsInterval,
      media: s.media.map(function (m) { return m.name === cur.name ? Object.assign({}, m, { plays: m.plays + 1 }) : m; })
    });
  }

  function setMode(id) {
    var m = modeDef(id);
    S.set({ mode: id, view: m.view });
    S.log('Mode changed to ' + m.label);
  }

  function openDisplay() {
    try {
      displayWin = window.open('display.html', 'willow-display', 'width=1280,height=720');
      if (displayWin) displayWin.focus();
    } catch (e) { message('Screen Output', 'Could not open the display window — allow pop-ups for this site.'); }
  }

  var ACTIONS = {
    'menu': function (arg) { menuOpen = (menuOpen === arg ? null : arg); render(); },
    'nav': function (arg) { menuOpen = null; S.set({ view: arg }); },
    'mode': function (arg) { menuOpen = null; setMode(arg); },
    'about': function () { menuOpen = null; message('About WILLOW Event System',
      'WILLOW Event System ' + CFG.build + ' with BiGD ' + CFG.bigdBuild + '. Venue event, music and games control. Terminal ' + CFG.terminal + ', licence ' + S.get().licence + '.'); },
    'signoff': function () { S.set({ signedOn: false }); location.href = 'index.html'; },
    'blackout': function () { menuOpen = null; var b = !S.get().blackout; S.set({ blackout: b }); S.log('Blackout ' + (b ? 'on' : 'off')); },
    'display.open': function () { menuOpen = null; openDisplay(); },
    'display.flag': function (arg) {
      var i = Number(arg), s = S.get();
      S.set({ displayFlags: s.displayFlags.map(function (f, j) { return j === i ? Object.assign({}, f, { on: !f.on }) : f; }) });
    },

    'event.sel': function (arg) { S.set({ selEvent: Number(arg) }); },
    'event.new': function () {
      menuOpen = null;
      dialog = { kind: 'event', title: 'New Event', draft: { id: null, name: '', date: new Date().toISOString().slice(0, 10),
        time: '19:00', room: CFG.rooms[0].name, mode: 'Ents', capacity: 120, status: 'Scheduled', notes: '' } };
      render();
    },
    'event.edit': function (arg) {
      var id = arg ? Number(arg) : S.get().selEvent;
      var e = S.get().events.filter(function (x) { return x.id === id; })[0];
      if (!e) return message('Edit Event', 'Select an event in the schedule first.');
      dialog = { kind: 'event', title: 'Event Properties — ' + e.name, draft: Object.assign({}, e) };
      render();
    },
    'event.del': function () {
      var s = S.get(), e = s.events.filter(function (x) { return x.id === s.selEvent; })[0];
      if (!e) return message('Delete Event', 'Select an event first.');
      S.set({ events: s.events.filter(function (x) { return x.id !== s.selEvent; }) });
      S.log('Event deleted: ' + e.name);
    },
    'event.load': function () {
      var s = S.get(), e = s.events.filter(function (x) { return x.id === s.selEvent; })[0];
      if (!e) return message('Load to Screen', 'Select an event first.');
      var map = { 'Ents': 'ents', 'Bingo': 'bingo', 'Karaoke': 'karaoke', 'BiGD': 'bigd', 'Rich Media': 'games' };
      setMode(map[e.mode] || 'ents');
      S.log('Loaded "' + e.name + '" to screens (' + e.room + ')');
    },
    'event.sort': function (arg) {
      var keys = { 'Date':'date','Time':'time','Event':'name','Room':'room','Mode':'mode','Cap.':'capacity','Status':'status' };
      var k = keys[arg] || 'date';
      S.set({ events: S.get().events.slice().sort(function (a, b) {
        return String(a[k]).localeCompare(String(b[k]), undefined, { numeric: true }); }) });
    },

    'ents.toggle': function () { var r = !S.get().entsRunning; S.set({ entsRunning: r }); S.log('Ents rotation ' + (r ? 'started' : 'paused')); },
    'ents.skip': function () { entsAdvance(); },
    'ents.ticker': function () { S.set({ entsTicker: !S.get().entsTicker }); },
    'ents.music': function () { S.set({ entsMusic: !S.get().entsMusic }); },

    'media.sel': function (arg) { S.set({ selMedia: Number(arg) }); },
    'media.toggle': function (arg) {
      var i = Number(arg), s = S.get();
      S.set({ selMedia: i, media: s.media.map(function (m, j) { return j === i ? Object.assign({}, m, { on: !m.on }) : m; }) });
    },
    'media.up': function () { moveMedia(-1); },
    'media.down': function () { moveMedia(1); },
    'media.rescan': function () {
      menuOpen = null; var s = S.get();
      S.log('Media rescan: ' + s.media.length + ' files in ' + s.mediaPath);
      message('Rescan Complete', s.media.length + ' files indexed, ' + activeMedia().length + ' enabled for rotation.');
    },
    'media.add': function () {
      var s = S.get(), n = s.media.length + 1;
      var item = { name: 'NEW_ADVERT_' + pad(n) + '.JPG', kind: 'JPEG', dwell: s.entsInterval, size: '1.0 MB', plays: 0, on: true,
        caption: 'Untitled advert — set a caption in Properties' };
      S.set({ media: s.media.concat([item]), selMedia: s.media.length });
      S.log('Media added: ' + item.name);
    },
    'media.remove': function () {
      var s = S.get(); if (!s.media.length) return;
      var gone = s.media[s.selMedia];
      S.set({ media: s.media.filter(function (m, i) { return i !== s.selMedia; }), selMedia: 0 });
      S.log('Media removed: ' + (gone ? gone.name : ''));
    },
    'media.test': function () {
      var s = S.get(), sel = s.media[s.selMedia] || {};
      var idx = Math.max(0, activeMedia().map(function (m) { return m.name; }).indexOf(sel.name));
      S.set({ mode: 'ents', view: 'ents', entsIndex: idx, entsCountdown: sel.dwell || s.entsInterval });
      openDisplay();
    },

    'bingo.call': function () { callNumber(); },
    'bingo.auto': function () { S.setIn('bingo', { auto: !S.get().bingo.auto }); },
    'bingo.check': function () {
      var b = S.get().bingo;
      message('Check Claim', 'Claim check for ' + b.pattern + ' on game ' + b.game + '. ' + b.called.length +
        ' numbers called: ' + (b.called.join(', ') || 'none') + '.');
    },
    'bingo.new': function () {
      var b = S.get().bingo;
      S.setIn('bingo', { game: b.game + 1, called: [], current: null, auto: false });
      S.log('New game started (game ' + (b.game + 1) + ')');
    },
    'bingo.code': function () {
      var code = CFG.bingo.codePrefix + Math.floor(100 + Math.random() * 900);
      S.setIn('bingo', { code: code }); S.log('Room code reissued: ' + code);
    },
    'bingo.lock': function () { S.setIn('bingo', { locked: !S.get().bingo.locked }); },
    'bingo.link': function (arg) {
      var b = S.get().bingo, has = b.linked.indexOf(arg) >= 0;
      S.setIn('bingo', { linked: has ? b.linked.filter(function (x) { return x !== arg; }) : b.linked.concat([arg]) });
    },
    'bingo.linkall': function () {
      var all = CFG.rooms.map(function (r) { return r.name; });
      var b = S.get().bingo;
      S.setIn('bingo', { linked: b.linked.length === all.length ? [all[0]] : all });
    },

    'karaoke.sel': function (arg) { S.setIn('karaoke', { selQueue: Number(arg) }); },
    'karaoke.add': function () {
      var k = S.get().karaoke; if (!k.newSinger) return;
      S.setIn('karaoke', { queue: k.queue.concat([{ singer: k.newSinger, song: DATA.songs[k.songIndex % DATA.songs.length].title }]), newSinger: '' });
      S.log('Singer added: ' + k.newSinger);
    },
    'karaoke.next': function () { var k = S.get().karaoke; S.setIn('karaoke', { queue: k.queue.slice(1), lineIndex: 0, selQueue: 0 }); },
    'karaoke.drop': function () {
      var k = S.get().karaoke;
      S.setIn('karaoke', { queue: k.queue.filter(function (q, i) { return i !== k.selQueue; }), selQueue: 0 });
    },
    'karaoke.play': function () { S.setIn('karaoke', { playing: !S.get().karaoke.playing }); },
    'karaoke.restart': function () { S.setIn('karaoke', { lineIndex: 0 }); },
    'karaoke.pitch': function (arg) {
      var k = S.get().karaoke;
      S.setIn('karaoke', { pitch: Math.max(-6, Math.min(6, k.pitch + Number(arg))) });
    },
    'karaoke.load': function (arg) { S.setIn('karaoke', { songIndex: Number(arg), lineIndex: 0 }); },

    'bigd.connect': function () {
      var g = S.get().bigd;
      S.setIn('bigd', { connected: !g.connected });
      S.log('BiGD link ' + (g.connected ? 'closed' : 'opened') + ' on ' + g.source);
    },
    'bigd.push': function () {
      var s = S.get();
      S.log('BiGD layout pushed to ' + s.screenCount + ' screens');
      message('Push Layout', 'Reformatted board pushed to ' + s.screenCount + ' screens at ' + s.outRes + '.');
    },

    'game.tab': function (arg) { menuOpen = null; S.set({ gameTab: arg, view: 'games', mode: 'games' }); },
    'quiz.pick': function (arg) { S.setIn('quiz', { picked: Number(arg) }); },
    'quiz.reveal': function () { S.setIn('quiz', { revealed: true }); },
    'quiz.next': function () {
      var q = S.get().quiz, last = q.index + 1 >= DATA.quiz.length;
      S.setIn('quiz', { index: (q.index + 1) % DATA.quiz.length, revealed: false, picked: null, round: last ? q.round + 1 : q.round });
    },
    'quiz.reset': function () { S.setIn('quiz', { index: 0, revealed: false, picked: null }); },
    'quiz.score': function (arg) {
      var parts = arg.split(':'), i = Number(parts[0]), d = Number(parts[1]), q = S.get().quiz;
      S.setIn('quiz', { teams: q.teams.map(function (t, j) {
        return j === i ? Object.assign({}, t, { score: Math.max(0, t.score + d) }) : t; }) });
    },
    'hol.guess': function (arg) {
      var h = S.get().hol;
      var correct = arg === 'higher' ? h.next > h.current : h.next < h.current;
      var streak = correct ? h.streak + 1 : 0;
      var line = h.current + ' -> ' + h.next + '  ' + arg.toUpperCase().slice(0, 2) + '  ' +
        (correct ? 'WIN' : (h.next === h.current ? 'PUSH' : 'OUT'));
      S.setIn('hol', {
        current: h.next, next: 1 + Math.floor(Math.random() * 13), revealedNext: false,
        streak: streak, best: Math.max(h.best, streak), drawn: h.drawn + 1,
        status: correct ? 'CORRECT — streak ' + streak : (h.next === h.current ? 'PUSH — same card' : 'OUT — streak lost'),
        history: h.history.concat([line])
      });
    },
    'hol.reset': function () {
      S.setIn('hol', { current: 1 + Math.floor(Math.random() * 13), next: 1 + Math.floor(Math.random() * 13),
        streak: 0, revealedNext: false, status: 'Deck reshuffled — call it', history: [], drawn: 2 });
    },
    'race.start': function () {
      var r = S.get().races; if (r.running) return;
      S.setIn('races', { running: true, finished: false, winner: null, pos: [0,0,0,0,0,0] });
      S.log('Race ' + r.num + ' started');
    },
    'race.new': function () {
      var r = S.get().races;
      S.setIn('races', { num: r.num + 1, running: false, finished: false, winner: null, pos: [0,0,0,0,0,0] });
    },

    'music.toggle': function () { window.WillowMusic.toggle(); },
    'music.prev': function () { window.WillowMusic.prev(); },
    'music.next': function () { window.WillowMusic.next(); },
    'music.play': function (arg) { S.set({ trackIndex: Number(arg) }); window.WillowMusic.playIndex(Number(arg)); },
    'music.source': function (arg) { S.set({ musicSource: arg }); window.WillowMusic.useSource(arg); S.log('Music source: ' + arg); },
    'music.duck': function () { S.set({ duck: !S.get().duck }); window.WillowMusic.setVolume(); },
    'music.link': function () { window.WillowMusic.linkSpotify(); },
    'music.unlink': function () { window.WillowMusic.unlinkSpotify(); render(); },
    'music.saveclient': function () {
      var f = document.getElementById('spClient');
      window.WillowMusic.setClientId(f ? f.value.trim() : '');
      render();
    },
    'music.pickfolder': function () { filePicker(true); },
    'music.pickfiles': function () { filePicker(false); },

    'report.print': function () { window.print(); },
    'report.csv': function () {
      var s = S.get();
      message('Export CSV', 'WILLOW_REPORT_' + s.reportPeriod.replace(/ /g, '_').toUpperCase() + '.CSV written to ' + CFG.paths.exports + '.');
    },

    'settings.tab': function (arg) { menuOpen = null; S.set({ view: 'settings', settingsTab: arg }); },
    'theme.preset': function (arg) { window.WillowTheme.usePreset(arg); S.log('Colour scheme: ' + arg); },
    'theme.restore': function () { window.WillowTheme.restore(); },
    'theme.save': function () { message('Colour Scheme', 'Scheme "' + S.get().preset + '" applied and saved to this terminal.'); },
    'diag': function () {
      var s = S.get();
      message('Diagnostics', 'Terminal ' + CFG.terminal + ' · build ' + CFG.build + ' · BiGD ' + CFG.bigdBuild + ' · ' +
        s.events.length + ' events · ' + s.media.length + ' media files · scheme "' + s.preset + '" · ' +
        s.screenCount + ' screens at ' + s.outRes + '.');
    },
    'data.clear': function () { S.reset(); location.href = 'index.html'; },

    'dialog.close': function () { dialog = null; render(); },
    'dialog.ok': function () {
      if (!dialog || dialog.kind !== 'event') { dialog = null; return render(); }
      var d = dialog.draft;
      if (!d.name) { dialog.title = 'Event name is required'; return render(); }
      var s = S.get(), events = s.events.slice();
      if (d.id) { events = events.map(function (e) { return e.id === d.id ? Object.assign({}, d) : e; }); S.log('Event updated: ' + d.name); }
      else {
        var id = events.reduce(function (a, e) { return Math.max(a, e.id); }, 0) + 1;
        events.push(Object.assign({}, d, { id: id })); d.id = id; S.log('Event created: ' + d.name);
      }
      events.sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
      dialog = null;
      S.set({ events: events, selEvent: d.id });
    }
  };

  function moveMedia(dir) {
    var s = S.get(), i = s.selMedia, j = i + dir;
    if (i < 0 || j < 0 || j >= s.media.length) return;
    var media = s.media.slice(), t = media[i];
    media[i] = media[j]; media[j] = t;
    S.set({ media: media, selMedia: j });
  }

  /* ---------------- input binding ---------------------------------- */
  function applyBind(path, raw, type) {
    var value = type === 'int' ? (parseInt(raw, 10) || 0) : raw;
    var s = S.get();
    if (path.indexOf('theme.') === 0) return window.WillowTheme.setSlot(path.slice(6), value);
    if (path.indexOf('media.sel.') === 0) {
      var key = path.slice(10);
      return S.set({ media: s.media.map(function (m, i) {
        return i === s.selMedia ? Object.assign({}, m, Object.fromEntries([[key, value]])) : m; }) });
    }
    var dot = path.indexOf('.');
    if (dot > 0) {
      var section = path.slice(0, dot), key2 = path.slice(dot + 1);
      return S.setIn(section, Object.fromEntries([[key2, value]]));
    }
    if (path === 'entsInterval') value = Math.max(2, value);
    if (path === 'screenCount') value = Math.max(1, value);
    S.set(Object.fromEntries([[path, value]]));
  }

  /* ---------------- events ---------------------------------------- */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act]');
    if (!t) { if (menuOpen) { menuOpen = null; render(); } return; }
    var fn = ACTIONS[t.getAttribute('data-act')];
    if (!fn) return;
    ev.preventDefault();
    fn(t.getAttribute('data-arg'));
  });

  document.addEventListener('dblclick', function (ev) {
    var t = ev.target.closest('[data-dbl]');
    if (!t) return;
    var fn = ACTIONS[t.getAttribute('data-dbl')];
    if (fn) fn(t.getAttribute('data-dblarg'));
  });

  document.addEventListener('mouseover', function (ev) {
    if (!menuOpen) return;
    var t = ev.target.closest('[data-menuhover]');
    if (t && t.getAttribute('data-menuhover') !== menuOpen) { menuOpen = t.getAttribute('data-menuhover'); render(); }
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.hasAttribute && el.hasAttribute('data-draft') && dialog) {
      var f = el.getAttribute('data-draft');
      dialog.draft[f] = el.getAttribute('data-type') === 'int' ? (parseInt(el.value, 10) || 0) : el.value;
      return;
    }
    if (el.hasAttribute && el.hasAttribute('data-bind')) {
      applyBind(el.getAttribute('data-bind'), el.value, el.getAttribute('data-type'));
    }
  });

  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (el.type === 'range' && el.hasAttribute('data-bind')) {
      applyBind(el.getAttribute('data-bind'), el.value, el.getAttribute('data-type'));
    }
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { menuOpen = null; dialog = null; render(); return; }
    var tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (ev.key === 'F2')  { ev.preventDefault(); ACTIONS['nav']('events'); }
    if (ev.key === 'F4')  { ev.preventDefault(); ACTIONS['nav']('media'); }
    if (ev.key === 'F5')  { ev.preventDefault(); ACTIONS['nav']('music'); }
    if (ev.key === 'F9')  { ev.preventDefault(); ACTIONS['nav']('reports'); }
    if (ev.key === 'F11') { ev.preventDefault(); ACTIONS['display.open'](); }
    if (ev.key === 'F12') { ev.preventDefault(); ACTIONS['blackout'](); }
    if (ev.key === ' ' && S.get().mode === 'bingo') { ev.preventDefault(); callNumber(); }
  });

  /* ---------------- render loop ------------------------------------ */
  var scrollMemo = 0;
  function render() {
    var v = app.querySelector('.view');
    if (v) scrollMemo = v.scrollTop;
    app.innerHTML = shell();
    var nv = app.querySelector('.view');
    if (nv) nv.scrollTop = scrollMemo;
  }

  /* hidden file input used by Music Control to load real audio files */
  var picker = null;
  function filePicker(folder) {
    if (picker && picker.parentNode) picker.parentNode.removeChild(picker);
    picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    if (folder) picker.setAttribute('webkitdirectory', '');
    else picker.accept = 'audio/*';
    picker.style.display = 'none';
    picker.addEventListener('change', function () { window.WillowMusic.loadFiles(picker.files); });
    document.body.appendChild(picker);
    picker.click();
  }

  function editing() {
    var a = document.activeElement, tag = (a && a.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  var beat = { bingo: 0, karaoke: 0 };
  function tick() {
    var s = S.get(), patch = {};

    if (s.mode === 'ents' && s.entsRunning && !s.blackout) {
      if (s.entsCountdown <= 1) entsAdvance();
      else patch.entsCountdown = s.entsCountdown - 1;
    }
    if (Object.keys(patch).length) S.set(patch);

    if (s.bingo.auto) {
      beat.bingo++;
      if (beat.bingo >= (s.bingo.speed || 6)) { beat.bingo = 0; callNumber(); }
    }
    if (s.karaoke.playing) {
      beat.karaoke++;
      var step = Math.max(1, Math.round(300 / (s.karaoke.tempo || 100)) + 1);
      if (beat.karaoke >= step) {
        beat.karaoke = 0;
        var song = DATA.songs[s.karaoke.songIndex % DATA.songs.length];
        S.setIn('karaoke', { lineIndex: (s.karaoke.lineIndex + 1) % song.lines.length });
      }
    }
    if (s.races.running) {
      var pos = s.races.pos.map(function (p, i) { return p + Math.random() * (7 + DATA.runners[i].form); });
      if (pos.some(function (p) { return p >= 100; })) {
        var winner = pos.indexOf(Math.max.apply(null, pos));
        S.setIn('races', { pos: pos.map(function (p) { return Math.min(100, p); }), running: false, finished: true, winner: winner });
        S.log('Race ' + s.races.num + ' result: ' + DATA.runners[winner].name);
      } else S.setIn('races', { pos: pos });
    }

    if (editing()) {
      var c = document.getElementById('clockCell');
      if (c) c.textContent = clock();
    } else render();
  }

  /* ---------------- boot ------------------------------------------- */
  if (!S.get().signedOn) { location.replace('index.html'); return; }
  render();
  S.subscribe(function () { window.WillowMusic.setVolume(); if (!editing()) render(); });
  window.WillowMusic.subscribe(function (st) {
    var s = S.get(), patch = {};
    if (s.musicPlaying !== st.playing) patch.musicPlaying = st.playing;
    var pos = Math.round(st.pos || 0);
    if (Math.round(s.trackPos || 0) !== pos) patch.trackPos = pos;
    if (Object.keys(patch).length) S.set(patch);
  });
  /* engine already booted before this subscribe — push its state in once */
  (function () {
    var st = window.WillowMusic.status();
    S.set({ musicPlaying: !!st.playing, trackPos: Math.round(st.pos || 0) });
  })();
  window.WillowMusic.subscribe(function () { if (S.get().view === 'music' && !editing()) render(); });
  setInterval(tick, 1000);
})();
