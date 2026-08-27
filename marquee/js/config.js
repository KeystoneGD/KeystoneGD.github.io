/* =====================================================================
   WILLOW Event System — SITE CONFIGURATION
   ---------------------------------------------------------------------
   This is the only file a venue normally needs to edit.
   Everything below is read at boot; saved operator changes (made in
   Settings) are stored per-terminal in localStorage and win over these
   defaults. Clearing local data (Settings > Advanced) restores them.
   ===================================================================== */

window.WILLOW_CONFIG = {

  /* ---- build / storage ------------------------------------------- */
  build: '4.2.117',
  bigdBuild: '2.9',
  terminal: 'WLW-TERM-01',
  storageKey: 'willow.state.v1',       // localStorage key
  channel: 'willow-bus',               // BroadcastChannel name (console -> display)

  /* ---- venue ----------------------------------------------------- */
  venueName: 'Marquee Test Server',
  licence: 'GB/OPS/44827-1',
  joinDomain: 'keystonegd.github.io/marquee/interact',

  /* ---- operators. PINs are for terminal sign-on only ------------- */
  operators: [
    { name: 'D. Whitaker', pin: '1234' },
    { name: 'S. Mbeki',    pin: '1234' },
    { name: 'J. Corrigan', pin: '1234' }
  ],

  /* ---- rooms / boards -------------------------------------------- */
  rooms: [
    { name: 'Main Hall',      code: 'WLW341', players: 64 },
    { name: 'Lounge Bar',     code: 'WLW872', players: 31 },
    { name: 'Sports Room',    code: 'WLW118', players: 18 },
    { name: 'Function Suite', code: 'WLW506', players: 0 }
  ],

  /* ---- media / music paths (shown in the UI) --------------------- */
  paths: {
    advertising: '\\\\WILLOW\\MEDIA\\ADVERTISING',
    karaoke:     '\\\\WILLOW\\MEDIA\\KARAOKE',
    music:       '\\\\WILLOW\\MEDIA\\MUSIC',
    exports:     '\\\\WILLOW\\EXPORT'
  },

  /* ---- screens --------------------------------------------------- */
  display: {
    resolutions: ['1920 x 1080 (16:9)', '1366 x 768 (16:9)', '3840 x 2160 (16:9)', '1280 x 1024 (5:4 legacy)'],
    defaultResolution: '1920 x 1080 (16:9)',
    screenCount: 4,
    flags: [
      { label: 'Mirror screen 1 to all outputs',       on: true },
      { label: 'Show clock on idle screens',           on: true },
      { label: 'Burn-in protection (shift 1px / 5 min)', on: true },
      { label: 'Overlay room code during games',       on: true }
    ]
  },

  /* ---- ents mode ------------------------------------------------- */
  ents: {
    defaultDwell: 12,
    transitions: ['Cut', 'Cross fade', 'Wipe left', 'Push up'],
    defaultTransition: 'Cross fade',
    ticker: true,
    musicOverAdverts: true
  },

  /* ---- bingo ----------------------------------------------------- */
  bingo: {
    ballCount: 90,
    patterns: ['One Line', 'Two Lines', 'Full House', 'Four Corners'],
    defaultPattern: 'One Line',
    defaultPrize: 250,
    autoCallSeconds: 6,
    codePrefix: 'WLW',
    linkedByDefault: ['Main Hall', 'Lounge Bar']
  },

  /* ---- BiGD (equipment interface) -------------------------------- */
  bigd: {
    sources: [
      'Maxim 8000 (RS-232 / COM3)',
      'Legacy board controller (9600 8N1)',
      'Willow Net Bridge (TCP 4001)',
      'Manual entry (operator)'
    ],
    protocols: ['WILLOW-1 ASCII', 'Packed BCD frame', 'Generic CSV frame'],
    defaultSource: 'Maxim 8000 (RS-232 / COM3)',
    defaultProtocol: 'WILLOW-1 ASCII',
    mapping: [
      { frame: 'CALL|nn',   meaning: 'Current called number',  slot: 'Hero digit' },
      { frame: 'PATT|xx',   meaning: 'Winning pattern in play', slot: 'Header strip' },
      { frame: 'PRZE|nnnn', meaning: 'Prize value (pence)',     slot: 'Accent line' },
      { frame: 'PLYR|nnn',  meaning: 'Cards in play',           slot: 'Accent line' },
      { frame: 'CLAM|room', meaning: 'Claim raised in room',    slot: 'Full screen flash' }
    ]
  },

  /* ---- music ----------------------------------------------------- */
  music: {
    sources: ['Spotify (linked)', 'Local folder'],
    defaultSource: 'Spotify (linked)',
    zones: ['Foyer Amp (Zone 1)', 'Main Room (Zone 2)', 'Bar / Games (Zone 3)', 'All Zones'],
    defaultZone: 'All Zones',
    playlists: ['Friday Warmup', 'Bingo Interval Beds', 'Karaoke Fillers', 'Close Down'],
    defaultPlaylist: 'Friday Warmup',
    defaultVolume: 62,
    duckOnCall: true,

    /* ---- REAL PLAYBACK -------------------------------------------
       Local folder: either set a src on each entry in js/data.js
       tracks[] (relative path, e.g. 'media/music/bed01.mp3'), or use
       "Load music folder..." in Music Control to pick the venue folder
       off the operator PC at the start of a session.

       Spotify: audio comes out of the CONSOLE browser as a Spotify
       device. Requirements:
         1. A Spotify PREMIUM account.
         2. An app at https://developer.spotify.com/dashboard.
         3. That app's Redirect URI set to the console URL exactly,
            e.g. https://your-site/console.html  (Spotify only accepts
            https, or http://127.0.0.1 for local testing).
         4. The app's Client ID pasted below (or into the Client ID box
            in Music Control, which saves per terminal).
       ------------------------------------------------------------- */
    spotify: {
      clientId: '',                       // <-- paste your Spotify app client ID
      redirectUri: '',                    // blank = current console URL
      deviceName: 'MARQUEE Console',
      scopes: [
        'streaming', 'user-read-email', 'user-read-private',
        'user-read-playback-state', 'user-modify-playback-state', 'playlist-read-private'
      ],
      /* map each playlist name above to a Spotify playlist/album URI */
      playlists: {
        'Friday Warmup':        '',
        'Bingo Interval Beds':  '',
        'Karaoke Fillers':      '',
        'Close Down':           ''
      },
      defaultPlaylistUri: ''              // used when the map entry is blank
    }
  },

  /* ---- colour schemes. "Custom" is created when an operator edits
         an individual element in Settings > Colours ---------------- */
  presets: {
    'Classic Grey':   {face:'#d4d0c8',light:'#ffffff',shadow:'#808080',dark:'#0a0a0a',text:'#000000',title1:'#0a246a',title2:'#a6caf0',titletext:'#ffffff',sel:'#0a246a',seltext:'#ffffff',field:'#ffffff',fieldtext:'#000000',accent:'#008080',dispbg:'#0d1218',dispfg:'#f2efe6',desk:'#3a6ea5'},
    'Willow Green':   {face:'#cfd8c8',light:'#f2f6ee',shadow:'#77836e',dark:'#0d1209',text:'#12180e',title1:'#1f4d2e',title2:'#7fae8c',titletext:'#ffffff',sel:'#1f4d2e',seltext:'#ffffff',field:'#fbfdf8',fieldtext:'#12180e',accent:'#3f7a4f',dispbg:'#0b1a10',dispfg:'#eaf3e6',desk:'#2f4a37'},
    'Midnight Blue':  {face:'#c8ccd4',light:'#f0f2f7',shadow:'#6d7482',dark:'#080b12',text:'#0b0f18',title1:'#08234a',title2:'#5a8fd6',titletext:'#ffffff',sel:'#08234a',seltext:'#ffffff',field:'#ffffff',fieldtext:'#0b0f18',accent:'#2f6fb0',dispbg:'#060b16',dispfg:'#e8eefc',desk:'#20344f'},
    'Burgundy Club':  {face:'#d8ccc8',light:'#f7efec',shadow:'#8a7570',dark:'#160c0a',text:'#1a0f0d',title1:'#5c1526',title2:'#c98a97',titletext:'#ffffff',sel:'#5c1526',seltext:'#ffffff',field:'#fffaf8',fieldtext:'#1a0f0d',accent:'#a3213c',dispbg:'#170a0e',dispfg:'#f7e9ec',desk:'#4a2a2f'},
    'Amber CRT':      {face:'#2b2a25',light:'#6b6a5e',shadow:'#100f0c',dark:'#000000',text:'#ffb000',title1:'#4a3400',title2:'#a87400',titletext:'#ffd27f',sel:'#6b4a00',seltext:'#ffd27f',field:'#1a1913',fieldtext:'#ffb000',accent:'#ff8c00',dispbg:'#0b0a06',dispfg:'#ffb000',desk:'#141310'},
    'High Contrast':  {face:'#000000',light:'#ffffff',shadow:'#808080',dark:'#ffffff',text:'#ffffff',title1:'#000080',title2:'#0000c0',titletext:'#ffff00',sel:'#008080',seltext:'#000000',field:'#000000',fieldtext:'#ffff00',accent:'#00ff00',dispbg:'#000000',dispfg:'#ffffff',desk:'#000000'}
  },
  defaultPreset: 'Classic Grey',

  /* ---- which colour slots appear in Settings > Colours ------------ */
  themeLabels: [
    ['face','Window face'], ['light','Bevel highlight'], ['shadow','Bevel shadow'], ['dark','Bevel outline'],
    ['text','Window text'], ['title1','Title bar left'], ['title2','Title bar right'], ['titletext','Title bar text'],
    ['sel','Selection'], ['seltext','Selection text'], ['field','Field background'], ['fieldtext','Field text'],
    ['accent','Accent'], ['dispbg','Screen background'], ['dispfg','Screen text'], ['desk','Desktop backdrop']
  ],

  /* ---- modes shown in Mode Control / menus ----------------------- */
  modes: [
    { id: 'ents',    label: 'Ents Mode',        sub: 'Rolling adverts',    view: 'ents',    chip: '#2a6f8a' },
    { id: 'bingo',   label: 'Bingo Mode',       sub: 'Linked random game', view: 'bingo',   chip: '#a3213c' },
    { id: 'karaoke', label: 'Karaoke Mode',     sub: 'Lyric engine',       view: 'karaoke', chip: '#5c2a8a' },
    { id: 'bigd',    label: 'BiGD',             sub: 'Equipment display',  view: 'bigd',    chip: '#2a8a56' },
    { id: 'games',   label: 'Rich Media Games', sub: 'Quiz / HoL / Races', view: 'games',   chip: '#8a4a2a' },
    { id: 'interact',label: 'Interactions',      sub: 'Shoutouts / photos', view: 'interact',chip: '#2a5f8a' }
  ],

  /* ---- patron site (interact.html) -------------------------------
     Patrons open  <your-site>/interact.html  (host it at /interact with
     a rewrite if you want the short address). See README, "Patron site".
     transport 'local' = same browser only (testing / venue tablets on
     one profile). transport 'rest' = real phones; set endpoint.        */
  interact: {
    transport: 'rest',                  // 'local' | 'rest'
    endpoint: 'https://uzqdrfnawrqcvtamscrp.supabase.co/functions/v1/willow-relay/room/main',
    headers: {                          // anon / publishable key only — never the secret key
      apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6cWRyZm5hd3JxY3Z0YW1zY3JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NTcxMzMsImV4cCI6MjEwMzQzMzEzM30.LoEpxMO5LFhwEibzh7A0cBTIfw1OrSdLsJF6bpgiD0o'
    },
    pollSeconds: 3,
    path: 'interact.html',              // shown to patrons as the join address
    storageKey: 'willow.interact.v1',
    channel: 'willow-interact',
    maxItems: 60,
    photoMaxPx: 900,
    photoQuality: 0.7,
    salesOpenByDefault: false,
    shoutoutsOpen: true,
    photosOpen: true,
    autoApproveShoutouts: false         // true = straight to screen, no moderation
  }
};
