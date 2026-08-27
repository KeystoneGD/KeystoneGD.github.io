/* =====================================================================
   WILLOW Event System — STATE STORE
   One localStorage record per terminal, mirrored live to display.html
   through BroadcastChannel (falls back to the storage event).
   ===================================================================== */
(function () {
  var CFG = window.WILLOW_CONFIG, DATA = window.WILLOW_DATA;

  function defaults() {
    return {
      /* terminal / session */
      signedOn: false,
      operator: CFG.operators[0].name,

      /* venue (editable in Settings > Venue) */
      venueName: CFG.venueName,
      licence: CFG.licence,
      joinDomain: CFG.joinDomain,
      operatorList: CFG.operators.map(function (o) { return o.name; }).join(', '),

      /* look */
      theme: Object.assign({}, CFG.presets[CFG.defaultPreset]),
      preset: CFG.defaultPreset,

      /* navigation */
      mode: 'ents',
      view: 'dashboard',
      settingsTab: 'Colours',
      gameTab: 'Quiz',

      /* screens */
      blackout: false,
      outRes: CFG.display.defaultResolution,
      screenCount: CFG.display.screenCount,
      displayFlags: CFG.display.flags.map(function (f) { return Object.assign({}, f); }),

      /* schedule + media */
      events: DATA.events.map(function (e) { return Object.assign({}, e); }),
      media: DATA.media.map(function (m) { return Object.assign({}, m); }),
      selEvent: DATA.events[0].id,
      selMedia: 0,
      eventFilter: '',
      mediaPath: CFG.paths.advertising,

      /* ents rotation */
      entsIndex: 0,
      entsRunning: true,
      entsCountdown: CFG.ents.defaultDwell,
      entsInterval: CFG.ents.defaultDwell,
      entsTransition: CFG.ents.defaultTransition,
      entsTicker: CFG.ents.ticker,
      entsMusic: CFG.ents.musicOverAdverts,

      /* music */
      musicSource: CFG.music.defaultSource,
      musicZone: CFG.music.defaultZone,
      musicPlaylist: CFG.music.defaultPlaylist,
      musicPlaying: false,
      trackIndex: 0,
      trackPos: 0,
      volume: CFG.music.defaultVolume,
      duck: CFG.music.duckOnCall,
      ducked: false,

      /* bingo */
      bingo: {
        game: 1, called: [], current: null,
        pattern: CFG.bingo.defaultPattern, prize: CFG.bingo.defaultPrize,
        speed: CFG.bingo.autoCallSeconds, auto: false,
        code: CFG.rooms[0].code, locked: false,
        linked: CFG.bingo.linkedByDefault.slice()
      },

      /* karaoke */
      karaoke: {
        songIndex: 0, lineIndex: 0, playing: false, pitch: 0, tempo: 100,
        newSinger: '', selQueue: 0,
        queue: DATA.singers.map(function (s) { return Object.assign({}, s); })
      },

      /* BiGD */
      bigd: { source: CFG.bigd.defaultSource, protocol: CFG.bigd.defaultProtocol, connected: true },

      /* rich media games */
      quiz: { round: 1, index: 0, revealed: false, picked: null,
              teams: DATA.teams.map(function (t) { return Object.assign({}, t); }) },
      hol: { current: 7, next: 4, streak: 0, best: 5, drawn: 2, revealedNext: false,
             status: 'Call it — higher or lower?', history: [] },
      races: { num: 3, running: false, finished: false, winner: null, pos: [0,0,0,0,0,0] },

      /* reports */
      reportPeriod: 'This week',

      /* log */
      syslog: [
        '09:02:11  WILLOW service started (build ' + CFG.build + ')',
        '09:02:12  Display driver: ' + CFG.display.screenCount + ' outputs detected',
        '09:02:14  Media scan: ' + DATA.media.length + ' files in ADVERTISING',
        '09:02:14  Music bridge authorised (' + CFG.music.defaultSource + ')',
        '09:02:15  BiGD listener idle on ' + CFG.bigd.defaultSource,
        '09:02:16  Room codes issued: ' + CFG.rooms.length + ' rooms'
      ]
    };
  }

  var state = Object.assign(defaults(), read());
  var listeners = [];
  var bus = ('BroadcastChannel' in window) ? new BroadcastChannel(CFG.channel) : null;
  var writing = false;

  function read() {
    try { return JSON.parse(localStorage.getItem(CFG.storageKey) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function persist() {
    try { localStorage.setItem(CFG.storageKey, JSON.stringify(state)); } catch (e) {}
    if (bus) { try { bus.postMessage({ type: 'state', state: state }); } catch (e) {} }
  }

  function emit() { listeners.forEach(function (fn) { fn(state); }); }

  var Store = {
    get: function () { return state; },

    /* shallow patch, persist, notify */
    set: function (patch) {
      Object.assign(state, patch);
      writing = true; persist(); writing = false;
      emit();
    },

    /* patch a nested section (bingo / karaoke / quiz / hol / races / bigd) */
    setIn: function (key, patch) {
      var next = Object.assign({}, state[key], patch);
      Store.set(Object.fromEntries([[key, next]]));
    },

    /* local-only change (no persist) — used for cursor/menu chrome */
    setLocal: function (patch) { Object.assign(state, patch); emit(); },

    subscribe: function (fn) { listeners.push(fn); return function () {
      listeners = listeners.filter(function (f) { return f !== fn; });
    }; },

    log: function (line) {
      var t = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
      var stamp = p(t.getHours()) + ':' + p(t.getMinutes()) + ':' + p(t.getSeconds());
      Store.set({ syslog: state.syslog.concat([stamp + '  ' + line]).slice(-80) });
    },

    reset: function () {
      try { localStorage.removeItem(CFG.storageKey); } catch (e) {}
      state = defaults();
      persist(); emit();
    },

    defaults: defaults
  };

  /* incoming updates from another tab / window */
  if (bus) {
    bus.onmessage = function (ev) {
      if (!ev.data || ev.data.type !== 'state' || writing) return;
      state = ev.data.state; emit();
    };
  }
  window.addEventListener('storage', function (ev) {
    if (ev.key !== CFG.storageKey || !ev.newValue) return;
    try { state = Object.assign(defaults(), JSON.parse(ev.newValue)); emit(); } catch (e) {}
  });

  window.WillowStore = Store;
})();
