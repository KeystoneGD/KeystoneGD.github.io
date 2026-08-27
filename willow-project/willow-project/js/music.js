/* =====================================================================
   WILLOW Event System — MUSIC ENGINE (real playback)
   ---------------------------------------------------------------------
   Two engines behind one transport:

     'Local folder'     HTML5 <audio>. Plays files listed in data.js
                        (tracks[].src) and/or a folder the operator picks
                        in Music Control ("Load music folder...").
     'Spotify (linked)' Spotify Web Playback SDK. Audio comes out of THIS
                        browser as a Spotify device named in config.
                        Requires a Spotify PREMIUM account and a Spotify
                        app registration (client ID + redirect URI) —
                        see README, "Linking Spotify".

   Audio plays in the window that loads this file (the console), so the
   operator PC feed is what reaches the amp. Browsers block audio until
   the operator clicks something — first PLAY press satisfies that.
   ===================================================================== */
(function () {
  var CFG = window.WILLOW_CONFIG, DATA = window.WILLOW_DATA, S = window.WillowStore;
  var SP = (CFG.music && CFG.music.spotify) || {};
  var TOKEN_KEY = 'willow.spotify.token';
  var VERIFIER_KEY = 'willow.spotify.verifier';
  var CLIENT_KEY = 'willow.spotify.client';

  /* ---- shared status shown in the UI ------------------------------ */
  var status = {
    engine: null,        // 'local' | 'spotify' | null
    ready: false,
    playing: false,
    title: '',
    artist: '',
    pos: 0,              // 0-100
    time: '',
    message: 'Idle',
    files: 0,
    account: ''
  };
  var subs = [];
  function emit() { subs.forEach(function (f) { f(status); }); }
  function say(m) { status.message = m; emit(); }

  /* =================================================================
     LOCAL FOLDER ENGINE
     ================================================================= */
  var el = new Audio();
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  var localList = [];      // [{title, artist, url, time}]
  var localIndex = 0;

  function seedLocal() {
    localList = (DATA.tracks || []).filter(function (t) { return t.src; })
      .map(function (t) {
        return { title: t.title, artist: t.artist || '', url: t.src, time: t.time || '' };
      });
  }
  seedLocal();

  function fmt(sec) {
    if (!isFinite(sec)) return '';
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  el.addEventListener('timeupdate', function () {
    if (status.engine !== 'local') return;
    status.pos = el.duration ? (el.currentTime / el.duration) * 100 : 0;
    status.time = fmt(el.currentTime) + ' / ' + fmt(el.duration);
    emit();
  });
  el.addEventListener('ended', function () { if (status.engine === 'local') Music.next(); });
  el.addEventListener('error', function () {
    if (status.engine !== 'local') return;
    say('Cannot play "' + (localList[localIndex] || {}).title + '" — file missing or unsupported codec.');
  });

  function localLoad(i, autoplay) {
    if (!localList.length) { say('No music files loaded. Use "Load music folder..." or set tracks[].src in js/data.js.'); return; }
    localIndex = ((i % localList.length) + localList.length) % localList.length;
    var t = localList[localIndex];
    el.src = t.url;
    el.volume = vol();
    status.title = t.title; status.artist = t.artist; status.pos = 0;
    if (autoplay) {
      el.play().then(function () {
        status.playing = true; say('Playing local file');
      })['catch'](function (e) {
        status.playing = false;
        say('Browser blocked playback (' + e.name + '). Click PLAY on the console once to allow audio.');
      });
    }
    emit();
  }

  /* =================================================================
     SPOTIFY ENGINE (Web Playback SDK + PKCE auth)
     ================================================================= */
  var sp = { player: null, deviceId: null, poll: null };

  function clientId() {
    try { return localStorage.getItem(CLIENT_KEY) || SP.clientId || ''; } catch (e) { return SP.clientId || ''; }
  }
  function setClientId(v) { try { localStorage.setItem(CLIENT_KEY, v || ''); } catch (e) {} }

  function redirectUri() {
    if (SP.redirectUri) return SP.redirectUri;
    return location.origin + location.pathname;   // e.g. https://site/console.html
  }

  function tokens() {
    try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveTokens(t) {
    t.expires = Date.now() + (t.expires_in || 3600) * 1000 - 60000;
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch (e) {}
  }
  function clearTokens() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function b64url(buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function authorise() {
    var id = clientId();
    if (!id) { say('No Spotify client ID. Paste one in Music Control (or set music.spotify.clientId in js/config.js).'); return; }
    var verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
    try { localStorage.setItem(VERIFIER_KEY, verifier); } catch (e) {}
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (hash) {
      var q = new URLSearchParams({
        client_id: id,
        response_type: 'code',
        redirect_uri: redirectUri(),
        code_challenge_method: 'S256',
        code_challenge: b64url(hash),
        scope: (SP.scopes || [
          'streaming', 'user-read-email', 'user-read-private',
          'user-read-playback-state', 'user-modify-playback-state', 'playlist-read-private'
        ]).join(' ')
      });
      location.href = 'https://accounts.spotify.com/authorize?' + q.toString();
    });
  }

  function exchange(code) {
    var verifier = '';
    try { verifier = localStorage.getItem(VERIFIER_KEY) || ''; } catch (e) {}
    return fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri(),
        client_id: clientId(),
        code_verifier: verifier
      })
    }).then(function (r) { return r.json(); }).then(function (t) {
      if (t.access_token) { saveTokens(t); return t; }
      throw new Error(t.error_description || t.error || 'token exchange failed');
    });
  }

  function refresh(t) {
    return fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: t.refresh_token,
        client_id: clientId()
      })
    }).then(function (r) { return r.json(); }).then(function (n) {
      if (!n.access_token) throw new Error(n.error_description || 'refresh failed');
      n.refresh_token = n.refresh_token || t.refresh_token;
      saveTokens(n); return n;
    });
  }

  function accessToken() {
    var t = tokens();
    if (!t) return Promise.reject(new Error('not linked'));
    if (Date.now() < t.expires) return Promise.resolve(t.access_token);
    return refresh(t).then(function (n) { return n.access_token; });
  }

  function api(path, method, body) {
    return accessToken().then(function (tok) {
      return fetch('https://api.spotify.com/v1' + path, {
        method: method || 'GET',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
    }).then(function (r) {
      if (r.status === 204 || r.status === 202) return null;
      return r.text().then(function (txt) {
        var j = txt ? JSON.parse(txt) : null;
        if (!r.ok) throw new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function loadSdk() {
    if (window.Spotify && window.Spotify.Player) return Promise.resolve();
    if (loadSdk._p) return loadSdk._p;
    loadSdk._p = new Promise(function (resolve, reject) {
      window.onSpotifyWebPlaybackSDKReady = function () { resolve(); };
      var s = document.createElement('script');
      s.src = 'https://sdk.scdn.co/spotify-player.js';
      s.onerror = function () { reject(new Error('Spotify SDK failed to load — check the venue firewall.')); };
      document.head.appendChild(s);
    });
    return loadSdk._p;
  }

  function spConnect() {
    if (!tokens()) { say('Spotify not linked. Press "Link Spotify account".'); return Promise.resolve(false); }
    if (sp.player) return Promise.resolve(true);
    say('Starting Spotify player...');
    return loadSdk().then(function () {
      sp.player = new window.Spotify.Player({
        name: SP.deviceName || ('WILLOW Console — ' + CFG.terminal),
        volume: vol(),
        getOAuthToken: function (cb) { accessToken().then(cb)['catch'](function () { cb(''); }); }
      });
      sp.player.addListener('ready', function (e) {
        sp.deviceId = e.device_id;
        status.ready = true;
        say('Spotify device ready — transferring playback');
        api('/me/player', 'PUT', { device_ids: [e.device_id], play: false })['catch'](function () {});
        whoami();
      });
      sp.player.addListener('not_ready', function () { status.ready = false; say('Spotify device went offline'); });
      sp.player.addListener('player_state_changed', function (st) {
        if (!st || status.engine !== 'spotify') return;
        var tr = st.track_window && st.track_window.current_track;
        status.playing = !st.paused;
        if (tr) {
          status.title = tr.name;
          status.artist = tr.artists.map(function (a) { return a.name; }).join(', ');
        }
        status.pos = st.duration ? (st.position / st.duration) * 100 : 0;
        status.time = fmt(st.position / 1000) + ' / ' + fmt(st.duration / 1000);
        emit();
      });
      ['initialization_error', 'authentication_error', 'account_error', 'playback_error'].forEach(function (k) {
        sp.player.addListener(k, function (e) {
          var extra = k === 'account_error' ? ' (Spotify Premium is required for in-browser playback)' : '';
          say('Spotify ' + k.replace('_', ' ') + ': ' + (e && e.message || '') + extra);
        });
      });
      return sp.player.connect();
    })['catch'](function (e) { say(e.message); return false; });
  }

  function whoami() {
    api('/me').then(function (me) {
      if (!me) return;
      status.account = me.display_name + ' (' + (me.product || '?') + ')';
      if (me.product !== 'premium') say('Linked as ' + me.display_name + ' — but this account is not Premium, so in-browser playback will not start.');
      emit();
    })['catch'](function () {});
  }

  function spPlayContext() {
    var uri = playlistUri();
    var body = uri ? { context_uri: uri } : undefined;
    return api('/me/player/play' + (sp.deviceId ? '?device_id=' + sp.deviceId : ''), 'PUT', body)
      .then(function () { status.playing = true; say(uri ? 'Playing playlist' : 'Resumed Spotify'); emit(); })
      ['catch'](function (e) { say('Spotify play failed: ' + e.message); });
  }

  function playlistUri() {
    var s = S.get();
    var map = (SP.playlists || {});
    return map[s.musicPlaylist] || SP.defaultPlaylistUri || '';
  }

  /* =================================================================
     PUBLIC TRANSPORT
     ================================================================= */
  function vol() {
    var s = S.get();
    var v = (s.volume || 0) / 100;
    if (s.duck && s.ducked) v *= 0.25;
    return Math.max(0, Math.min(1, v));
  }

  var Music = {
    status: function () { return status; },
    subscribe: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },
    isLive: function () { return !!status.engine; },
    trackList: function () { return localList; },
    clientId: clientId,
    setClientId: function (v) { setClientId(v); say(v ? 'Client ID saved. Press "Link Spotify account".' : 'Client ID cleared.'); },
    linked: function () { return !!tokens(); },
    redirectUri: redirectUri,

    /* engine selection follows state.musicSource */
    useSource: function (src) {
      var spotify = /spotify/i.test(src || S.get().musicSource);
      if (spotify) {
        status.engine = 'spotify';
        el.pause();
        if (tokens()) spConnect();
        else say('Spotify not linked yet.');
      } else {
        status.engine = 'local';
        if (sp.player) { try { sp.player.pause(); } catch (e) {} }
        say(localList.length ? localList.length + ' local file(s) ready' : 'No local files loaded yet.');
      }
      emit();
    },

    toggle: function () {
      if (status.engine === 'spotify') {
        return spConnect().then(function () {
          if (!sp.player) return;
          if (status.playing) { sp.player.pause(); status.playing = false; say('Paused'); emit(); }
          else spPlayContext();
        });
      }
      if (!el.src) { localLoad(localIndex, true); return; }
      if (el.paused) {
        el.play().then(function () { status.playing = true; say('Playing local file'); emit(); })
          ['catch'](function (e) { say('Playback blocked: ' + e.name); });
      } else { el.pause(); status.playing = false; say('Paused'); emit(); }
    },

    next: function () {
      if (status.engine === 'spotify') { if (sp.player) sp.player.nextTrack(); return; }
      localLoad(localIndex + 1, true);
      S.set({ trackIndex: localIndex });
    },

    prev: function () {
      if (status.engine === 'spotify') { if (sp.player) sp.player.previousTrack(); return; }
      localLoad(localIndex - 1, true);
      S.set({ trackIndex: localIndex });
    },

    playIndex: function (i) {
      if (status.engine === 'spotify') { Music.toggle(); return; }
      localLoad(i, true);
    },

    setVolume: function () {
      el.volume = vol();
      if (sp.player) { try { sp.player.setVolume(vol()); } catch (e) {} }
    },

    /* bingo call / mic ducking — call with true to dip, false to restore */
    duck: function (on) { S.set({ ducked: !!on }); Music.setVolume(); },

    /* operator picks a folder of audio files */
    loadFiles: function (fileList) {
      var files = Array.prototype.slice.call(fileList || []).filter(function (f) {
        return /\.(mp3|m4a|aac|ogg|oga|wav|flac|webm)$/i.test(f.name);
      });
      if (!files.length) { say('No playable audio files in that folder.'); return; }
      files.sort(function (a, b) { return a.name.localeCompare(b.name); });
      localList = files.map(function (f) {
        var name = f.name.replace(/\.[^.]+$/, '');
        var parts = name.split(/\s+-\s+/);
        return {
          title: parts[1] || parts[0],
          artist: parts[1] ? parts[0] : 'Local file',
          url: URL.createObjectURL(f), time: ''
        };
      });
      status.files = localList.length;
      localIndex = 0;
      S.set({ musicSource: 'Local folder', trackIndex: 0 });
      status.engine = 'local';
      say(localList.length + ' file(s) loaded from folder');
      localLoad(0, false);
    },

    linkSpotify: authorise,
    unlinkSpotify: function () {
      clearTokens();
      if (sp.player) { try { sp.player.disconnect(); } catch (e) {} sp.player = null; sp.deviceId = null; }
      status.ready = false; status.account = '';
      say('Spotify unlinked.');
    },

    /* re-issue the playlist context after the operator changes playlist */
    reload: function () { if (status.engine === 'spotify' && status.playing) spPlayContext(); }
  };

  /* ---- boot: finish PKCE redirect if we came back from Spotify ---- */
  (function boot() {
    var q = new URLSearchParams(location.search);
    if (q.get('error')) { say('Spotify authorisation refused: ' + q.get('error')); }
    if (q.get('code')) {
      say('Completing Spotify sign-in...');
      exchange(q.get('code')).then(function () {
        history.replaceState({}, '', location.pathname);
        S.log('Spotify account linked');
        Music.useSource('Spotify (linked)');
      })['catch'](function (e) {
        history.replaceState({}, '', location.pathname);
        say('Spotify sign-in failed: ' + e.message);
      });
    }
    Music.useSource(S.get().musicSource);
    Music.setVolume();
  })();

  window.WillowMusic = Music;
})();
