// Shared across index.html, orders.html and backend.html: the Supabase client, auth/venue session
// handling, and the rowStore/app_state helpers every page's inline script builds on. Load this before
// the page's own <script> block.

const SUPABASE_URL = "https://djegigghjeisoyecxeyo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqZWdpZ2doamVpc295ZWN4ZXlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxNjE1NTcsImV4cCI6MjEwNDczNzU1N30.X40pprKgeeu3bQ_STG9sCUZg4763ot8ZJFeJ8VFXvdM";
const MANAGE_STAFF_URL = SUPABASE_URL + "/functions/v1/manage-staff";

const LS_CURRENT_VENUE = "starlightTill.venueId.v1";

const PERM_LABELS = {
  globalAdmin: "Global Admin (all venues)",
  active: "Account Active",
  placeOrders: "Place Orders",
  productsOnStop: "Products on Stop",
  recoveryTool: "Recovery Tool",
  callToService: "Call to Service",
  clearHistory: "Clear History on Orders",
  xzRead: "X and Z Read",
  endOfDay: "Access End of Day",
  backendAccess: "Backend Access",
  orderScreen: "Order Screen",
  viewOpenOrders: "View Open Orders",
  processRefunds: "Process Refunds"
};

let supabaseClient = null;
let currentVenueId = null;
try { currentVenueId = localStorage.getItem(LS_CURRENT_VENUE); } catch (e) {}

// --- Venue accent: every screen is tinted with the signed-in venue's own colour, so a till left on
// the wrong venue is obvious from across the room. Amber/green/red are kept out of this palette
// because they already mean "main action", "ready" and "problem". A Global Admin can pick one per
// venue in Backend > Venues (stored as venue.accent); until then venues take the palette in the
// order they were created, so each venue still gets its own colour.
const VENUE_ACCENTS = {
  violet: { label: "Violet", color: "#7a5af0", ink: "#ffffff" },
  teal:   { label: "Teal",   color: "#0f8394", ink: "#ffffff" },
  pink:   { label: "Pink",   color: "#cf3a84", ink: "#ffffff" },
  blue:   { label: "Blue",   color: "#2f6fe0", ink: "#ffffff" },
  plum:   { label: "Plum",   color: "#9b3fb5", ink: "#ffffff" }
};
const VENUE_ACCENT_KEYS = Object.keys(VENUE_ACCENTS);
let venueCreationOrder = null; // venue ids oldest-first, for the default accent
async function loadVenueCreationOrder() {
  if (venueCreationOrder || !supabaseClient) return venueCreationOrder || [];
  try {
    const { data } = await supabaseClient.from("venues").select("id,ts").order("ts", { ascending: true });
    venueCreationOrder = (data || []).map(r => r.id);
  } catch (e) { venueCreationOrder = []; }
  return venueCreationOrder;
}
function venueAccentKey(venue) {
  if (!venue) return null;
  if (venue.accent && VENUE_ACCENTS[venue.accent]) return venue.accent;
  const idx = (venueCreationOrder || []).indexOf(venue.id);
  return VENUE_ACCENT_KEYS[(idx === -1 ? 0 : idx) % VENUE_ACCENT_KEYS.length];
}
// Sets --venue / --venue-ink for the page and fills any [data-venue-name] / [data-staff-name]
// slots. Pass null to clear (signed out).
async function applyVenueIdentity(venue, staffName) {
  lastVenueIdentity = venue ? { venue, staffName } : null;
  if (venue) await loadVenueCreationOrder();
  const accent = venue ? VENUE_ACCENTS[venueAccentKey(venue)] : null;
  const root = document.documentElement.style;
  if (accent) { root.setProperty("--venue", accent.color); root.setProperty("--venue-ink", accent.ink); }
  else { root.removeProperty("--venue"); root.removeProperty("--venue-ink"); }
  document.querySelectorAll("[data-venue-name]").forEach(el => { el.textContent = venue ? venue.name : ""; });
  document.querySelectorAll("[data-staff-name]").forEach(el => { el.textContent = staffName || ""; });
  document.querySelectorAll("[data-venue-identity]").forEach(el => { el.hidden = !venue; });
}

// --- Icons: one line-icon set (24px grid, 2px stroke, round joins) used everywhere instead of emoji
// or text glyphs, so buttons look the same on every device. Decorative only: every icon sits next to
// a visible label or inside a button with an aria-label.
const ICON_PATHS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  stop: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  note: '<path d="M5 4.5h14v15H5z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>'
};
function icon(name) {
  return `<svg class="ic" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ""}</svg>`;
}
// <span data-icon="search"></span> placeholders in static markup get their SVG filled in here.
function hydrateIcons(root) {
  (root || document).querySelectorAll("[data-icon]").forEach(el => {
    if (el.dataset.iconDone) return;
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
    el.dataset.iconDone = "1";
  });
}

// --- Times: always 24-hour, UK format, whatever the device's own locale is set to.
function fmtTime(ts) { return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }); }
function fmtDayTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + " · " + fmtTime(ts);
}
function fmtDateTime(ts) { return new Date(ts).toLocaleString("en-GB", { hour12: false }); }
function minutesAgo(ts) {
  const m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  return m < 1 ? "just now" : m === 1 ? "1 min ago" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

function connectAuthClient() {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  // The SDK's own auto-refresh timer only runs while the tab is visible - most mobile/tablet browsers
  // (and desktop ones after a while) freeze JS timers in a backgrounded tab, so a till left on another
  // tab for a shift can come back with a token that's sat expired for hours. Explicitly pausing/resuming
  // the SDK's refresh loop on visibility change (Supabase's own recommended pattern) is what actually
  // keeps that in sync, rather than each page's own poll loops each guessing at when to refresh.
  try {
    document.addEventListener("visibilitychange", () => {
      if (!supabaseClient) return;
      if (document.visibilityState === "visible") supabaseClient.auth.startAutoRefresh();
      else supabaseClient.auth.stopAutoRefresh();
    });
  } catch (e) {}
  startMasterThemeSync();
  return supabaseClient;
}

function setCurrentVenueId(id) {
  currentVenueId = id;
  try { localStorage.setItem(LS_CURRENT_VENUE, id); } catch (e) {}
}
function clearCurrentVenueId() {
  currentVenueId = null;
  try { localStorage.removeItem(LS_CURRENT_VENUE); } catch (e) {}
}

// Reads the current session and proactively refreshes it if the access token is expired or about to
// be (within 60s). Several call sites (the till's poll loop, the service modal's 1s refresh, Backend's
// dashboard) can all notice the same expiring token within the same second - without de-duping, each
// would fire its own refreshSession() call using the same still-valid refresh token, and Supabase's
// token rotation only lets the first of those succeed: every other concurrent call gets back "Refresh
// Token Not Used"/"Already Used" and, having no token left to retry with, is stuck permanently - which
// is what eventually surfaces elsewhere as "Invalid session". Routing every caller through the one
// in-flight refresh (rather than each starting its own) closes that race.
let refreshInFlight = null;
async function getSession() {
  try {
    const { data } = await supabaseClient.auth.getSession();
    let session = data.session || null;
    if (session && session.expires_at && session.expires_at * 1000 < Date.now() + 60000) {
      if (!refreshInFlight) {
        refreshInFlight = supabaseClient.auth.refreshSession().finally(() => { refreshInFlight = null; });
      }
      const { data: refreshed, error } = await refreshInFlight;
      session = (!error && refreshed.session) ? refreshed.session : null;
      // A refresh token that's actually been rotated/revoked out from under this tab (by another
      // device signed into the same account, or a previous refresh this tab already lost the race on)
      // will never succeed on retry - every future call would just keep hitting the same dead token
      // and failing. Drop it locally (no point calling the revoke endpoint for a token that's already
      // invalid) so the app cleanly falls back to "signed out" instead of quietly failing forever.
      if (error && /refresh_token/i.test(error.code || error.message || "")) {
        try { await supabaseClient.auth.signOut({ scope: "local" }); } catch (e) {}
      }
    }
    return session;
  } catch (e) { return null; }
}

async function signInWithPin(pin) {
  const email = "pin" + pin + "@nipos.local";
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password: pin });
  if (error) return { error: "Incorrect PIN" };
  return { ok: true };
}

async function signOutAuth() {
  try { await supabaseClient.auth.signOut(); } catch (e) {}
  clearCurrentVenueId();
}

// The caller's own staff_users row ({ id, name, pin, perms, venueIds }), or null if signed out.
async function fetchMyStaffRow() {
  const session = await getSession();
  if (!session) return null;
  try {
    const { data, error } = await supabaseClient.from("staff_users").select("id,data").eq("id", session.user.id).maybeSingle();
    if (error || !data) return null;
    return { id: data.id, ...data.data };
  } catch (e) { return null; }
}

// Venues a staff member can operate in: every venue for a Global Admin, otherwise just their venueIds.
// Closed venues (Backend > Venues > "Venue Open" off) are excluded by default so staff can't
// accidentally sign in or subscribe to notifications for a venue that isn't running right now -
// pass includeClosed=true for Backend's own venue management, which still needs to see everything.
async function fetchMyVenues(staffRow, includeClosed) {
  if (!staffRow) return [];
  try {
    let rows;
    if (staffRow.perms && staffRow.perms.globalAdmin) {
      const { data } = await supabaseClient.from("venues").select("id,data").order("ts", { ascending: true });
      rows = data || [];
    } else {
      const ids = staffRow.venueIds || [];
      if (!ids.length) return [];
      const { data } = await supabaseClient.from("venues").select("id,data").in("id", ids);
      rows = data || [];
    }
    const venues = rows.map(r => ({ id: r.id, ...r.data }));
    return includeClosed ? venues : venues.filter(v => v.active !== false);
  } catch (e) { return []; }
}

async function callManageStaff(action, payload) {
  const session = await getSession();
  if (!session) return { error: "Not signed in" };
  try {
    const res = await fetch(MANAGE_STAFF_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY, "Authorization": "Bearer " + session.access_token },
      body: JSON.stringify({ action, ...payload })
    });
    return await res.json();
  } catch (e) { return { error: "Network error" }; }
}

function makeSupabaseDb(client) {
  return { doc(path) { return {
    async set(body) {
      if (!currentVenueId) return;
      await client.from("app_state").upsert({ key: currentVenueId + ":" + path, value: body.value });
    },
    async get() {
      if (!currentVenueId) return { exists: false, data: () => ({}) };
      const { data } = await client.from("app_state").select("value").eq("key", currentVenueId + ":" + path).maybeSingle();
      return { exists: !!data, data: () => ({ value: data ? data.value : undefined }) };
    }
  }; } };
}

// --- Themes, shared by every page ---
// The master theme is one setting for every device, chosen by $YSTEM in Backend > Master themes and
// stored in the system_theme table. Each master theme has a normal and a dark version; the switch on
// each device picks between them (NIPOS Classic keeps its original dark/light switch). Status colours
// (green ready, red problem, yellow in progress) never change with the theme. Every colour below was
// checked for WCAG AA: text 4.5:1, focus rings 3:1.
const LS_THEME = "starlightTill.theme.v1";              // NIPOS Classic: "dark" (default) or "light"
const LS_THEME_MODE = "starlightTill.themeMode.v1";     // any other master theme: "normal" (default) or "dark"
const LS_MASTER_THEME = "starlightTill.masterTheme.v1"; // last master theme seen, so a page opens in it straight away
const MASTER_THEMES = {
  classic: { name: "NIPOS Classic" },
  "neon-nights": { name: "Neon Nights",
    venues: [["Purple", "#7B2CBF", "#FFFFFF"], ["Electric blue", "#1F6FD6", "#FFFFFF"], ["Magenta", "#B0179B", "#FFFFFF"], ["Indigo", "#4B3FD1", "#FFFFFF"], ["Plum", "#8E2C8E", "#FFFFFF"]],
    normal: { scheme: "dark", tokens: { "--bg": "#1A1A2E", "--surface": "#2E2E4A", "--surface-2": "#3A3A54", "--border": "#55556B", "--text": "#E0E0E0", "--text-muted": "#A7A7B1", "--accent": "#008080", "--accent-ink": "#FFFFFF", "--accent-soft": "rgba(0,128,128,0.16)", "--accent-text": "#00A9A9", "--sel-bg": "#E0E0E0", "--sel-ink": "#1A1A2E", "--focus": "#9E5AD9" } },
    dark: { scheme: "dark", tokens: { "--bg": "#121212", "--surface": "#1E1E1E", "--surface-2": "#2D2D2D", "--border": "#4D4D4D", "--text": "#F5F5F5", "--text-muted": "#A3A3A3", "--accent": "#008080", "--accent-ink": "#FFFFFF", "--accent-soft": "rgba(0,128,128,0.16)", "--accent-text": "#009797", "--sel-bg": "#F5F5F5", "--sel-ink": "#121212", "--focus": "#8E3FD3" } }
  },
  "classic-pub": { name: "Classic Pub",
    venues: [["Burgundy", "#800020", "#FFFFFF"], ["Deep teal", "#1F5F5B", "#FFFFFF"], ["Plum", "#5E2750", "#FFFFFF"], ["Navy", "#1F3A5F", "#FFFFFF"], ["Slate", "#3E4A5C", "#FFFFFF"]],
    normal: { scheme: "light", tokens: { "--bg": "#F5F5DC", "--surface": "#E0D8C0", "--surface-2": "#D5CCB5", "--border": "#BFB29F", "--text": "#4A2C2A", "--text-muted": "#64544C", "--accent": "#5C4033", "--accent-ink": "#FFFFFF", "--accent-soft": "rgba(92,64,51,0.12)", "--accent-text": "#5C4033", "--sel-bg": "#4A2C2A", "--sel-ink": "#F5F5DC", "--focus": "#9A7417" } },
    dark: { scheme: "dark", tokens: { "--bg": "#1C1C1C", "--surface": "#2F2F2F", "--surface-2": "#3B3B3B", "--border": "#565656", "--text": "#E0E0E0", "--text-muted": "#A5A5A5", "--accent": "#644638", "--accent-ink": "#FFFFFF", "--accent-soft": "rgba(100,70,56,0.16)", "--accent-text": "#B58D7B", "--sel-bg": "#E0E0E0", "--sel-ink": "#1C1C1C", "--focus": "#DAA520" } }
  },
  "modern-loft": { name: "Modern Loft",
    venues: [["Plum", "#8E3A8E", "#FFFFFF"], ["Teal", "#00796B", "#FFFFFF"], ["Rose", "#AD1457", "#FFFFFF"], ["Ocean", "#0277BD", "#FFFFFF"], ["Slate", "#546E7A", "#FFFFFF"]],
    normal: { scheme: "light", tokens: { "--bg": "#F0F2F5", "--surface": "#FFFFFF", "--surface-2": "#EFEFEF", "--border": "#CECECE", "--text": "#212121", "--text-muted": "#6C6C6C", "--accent": "#3F51B5", "--accent-ink": "#FFFFFF", "--accent-soft": "rgba(63,81,181,0.12)", "--accent-text": "#3F51B5", "--sel-bg": "#212121", "--sel-ink": "#F0F2F5", "--focus": "#3F51B5" } },
    dark: { scheme: "dark", tokens: { "--bg": "#1A202C", "--surface": "#2D3748", "--surface-2": "#3A4354", "--border": "#555E6D", "--text": "#E2E8F0", "--text-muted": "#AAB1BA", "--accent": "#3F51B5", "--accent-ink": "#FFFFFF", "--accent-soft": "rgba(63,81,181,0.16)", "--accent-text": "#919CD9", "--sel-bg": "#E2E8F0", "--sel-ink": "#1A202C", "--focus": "#6B7ACB" } }
  },
  "electric-night": { name: "Electric Night",
    venues: [["Indigo", "#5856D6", "#FFFFFF"], ["Cyan", "#00C2CB", "#141414"], ["Pink", "#D63384", "#FFFFFF"], ["Slate", "#5A6A80", "#FFFFFF"], ["Orchid", "#B054DE", "#141414"]],
    normal: { scheme: "dark", tokens: { "--bg": "#1C1C1E", "--surface": "#2C2C2E", "--surface-2": "#3A3A3C", "--border": "#58585A", "--text": "#F2F2F7", "--text-muted": "#A7A7AB", "--accent": "#007AFF", "--accent-ink": "#141414", "--accent-soft": "rgba(0,122,255,0.16)", "--accent-text": "#3395FF", "--sel-bg": "#F2F2F7", "--sel-ink": "#1C1C1E", "--focus": "#007AFF" } },
    dark: { scheme: "dark", tokens: { "--bg": "#121212", "--surface": "#1E1E1E", "--surface-2": "#2C2C2C", "--border": "#494949", "--text": "#E0E0E0", "--text-muted": "#969696", "--accent": "#007AFF", "--accent-ink": "#141414", "--accent-soft": "rgba(0,122,255,0.16)", "--accent-text": "#1283FF", "--sel-bg": "#E0E0E0", "--sel-ink": "#121212", "--focus": "#007AFF" } }
  },
  "lounge-sunset": { name: "Lounge Sunset",
    venues: [["Violet", "#7A5AF0", "#FFFFFF"], ["Deep teal", "#0F8192", "#FFFFFF"], ["Orange", "#FF9500", "#141414"], ["Indigo", "#4F5BD5", "#FFFFFF"], ["Plum", "#9B3FB5", "#FFFFFF"]],
    normal: { scheme: "dark", tokens: { "--bg": "#2C2C3A", "--surface": "#3A3A4C", "--surface-2": "#474656", "--border": "#62616A", "--text": "#F0EAD6", "--text-muted": "#B8B5B1", "--accent": "#E8A0B4", "--accent-ink": "#141414", "--accent-soft": "rgba(232,160,180,0.16)", "--accent-text": "#E8A0B4", "--sel-bg": "#F0EAD6", "--sel-ink": "#2C2C3A", "--focus": "#FF9500" } },
    dark: { scheme: "dark", tokens: { "--bg": "#1A1A24", "--surface": "#282836", "--surface-2": "#353541", "--border": "#525058", "--text": "#E8E0D0", "--text-muted": "#A39E99", "--accent": "#E8A0B4", "--accent-ink": "#141414", "--accent-soft": "rgba(232,160,180,0.16)", "--accent-text": "#E8A0B4", "--sel-bg": "#E8E0D0", "--sel-ink": "#1A1A24", "--focus": "#FF9500" } }
  },
  "coastal-breeze": { name: "Coastal Breeze",
    venues: [["Lavender", "#6E5BD6", "#FFFFFF"], ["Ocean", "#0A6ED1", "#FFFFFF"], ["Sand", "#B08D57", "#141414"], ["Navy", "#1F3A93", "#FFFFFF"], ["Driftwood", "#6D5D4B", "#FFFFFF"]],
    normal: { scheme: "light", tokens: { "--bg": "#F2F2F7", "--surface": "#FFFFFF", "--surface-2": "#EFEFEF", "--border": "#CDCDCE", "--text": "#1C1C1E", "--text-muted": "#6C6C6E", "--accent": "#00BFB7", "--accent-ink": "#141414", "--accent-soft": "rgba(0,191,183,0.12)", "--accent-text": "#007A75", "--sel-bg": "#1C1C1E", "--sel-ink": "#F2F2F7", "--focus": "#009C95" } },
    dark: { scheme: "dark", tokens: { "--bg": "#1C1C1E", "--surface": "#2C2C2E", "--surface-2": "#3A3A3C", "--border": "#58585A", "--text": "#F2F2F7", "--text-muted": "#A7A7AB", "--accent": "#00C7BE", "--accent-ink": "#141414", "--accent-soft": "rgba(0,199,190,0.16)", "--accent-text": "#00C7BE", "--sel-bg": "#F2F2F7", "--sel-ink": "#1C1C1E", "--focus": "#00C7BE" } }
  }
};
// Shown in Backend's theme picker for Classic, which uses each page's own built-in colours.
const CLASSIC_PREVIEW = { bg: "#0c1826", surface: "#13212f", text: "#eef4f8", accent: "#f0a13a", accentInk: "#2b1a02" };
const CLASSIC_VENUE_ACCENTS = JSON.parse(JSON.stringify(VENUE_ACCENTS));

let masterThemeKey = "classic";
try { const k = localStorage.getItem(LS_MASTER_THEME); if (k && MASTER_THEMES[k]) masterThemeKey = k; } catch (e) {}
function getMasterTheme() { return masterThemeKey; }

function getTheme() { try { return localStorage.getItem(LS_THEME) || "dark"; } catch (e) { return "dark"; } }
function getThemeMode() { try { return localStorage.getItem(LS_THEME_MODE) === "dark" ? "dark" : "normal"; } catch (e) { return "normal"; } }
function setTheme(theme) {
  try { localStorage.setItem(LS_THEME, theme); } catch (e) {}
  applyTheme();
}
// The device switch: Classic flips dark/light, any other theme flips normal/dark mode.
function toggleTheme() {
  if (masterThemeKey === "classic") setTheme(getTheme() === "light" ? "dark" : "light");
  else {
    try { localStorage.setItem(LS_THEME_MODE, getThemeMode() === "dark" ? "normal" : "dark"); } catch (e) {}
    applyTheme();
  }
}
// What the switch would change to next, for its label: { icon, label }.
function themeSwitchInfo() {
  if (masterThemeKey === "classic") {
    return getTheme() !== "light" ? { icon: "sun", label: "Light theme" } : { icon: "moon", label: "Dark theme" };
  }
  return getThemeMode() === "dark" ? { icon: "sun", label: "Normal colours" } : { icon: "moon", label: "Dark mode" };
}

let lastVenueIdentity = null; // re-applied when the theme changes, since venue colours come from the theme
function applyTheme() {
  const html = document.documentElement;
  const t = MASTER_THEMES[masterThemeKey];
  let styleEl = document.getElementById("masterThemeVars");
  if (masterThemeKey === "classic" || !t) {
    html.dataset.theme = getTheme();
    delete html.dataset.master;
    if (styleEl) styleEl.remove();
    VENUE_ACCENT_KEYS.forEach(k => Object.assign(VENUE_ACCENTS[k], CLASSIC_VENUE_ACCENTS[k]));
  } else {
    const v = t[getThemeMode()];
    html.dataset.theme = v.scheme; // keeps each page's light/dark-only rules (status shades etc.) in step
    html.dataset.master = masterThemeKey;
    if (!styleEl) { styleEl = document.createElement("style"); styleEl.id = "masterThemeVars"; }
    document.head.appendChild(styleEl); // last in <head>, so it wins over each page's own :root colours
    styleEl.textContent = "html:root:root{" + Object.entries(v.tokens).map(([k, c]) => k + ":" + c).join(";") + "}";
    VENUE_ACCENT_KEYS.forEach((k, i) => {
      const [label, color, ink] = t.venues[i];
      Object.assign(VENUE_ACCENTS[k], { label, color, ink });
    });
  }
  const bg = getComputedStyle(html).getPropertyValue("--bg").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute("content", bg);
  if (lastVenueIdentity) applyVenueIdentity(lastVenueIdentity.venue, lastVenueIdentity.staffName);
  try { document.dispatchEvent(new CustomEvent("nipos:themechange")); } catch (e) {}
}
function initTheme() { applyTheme(); }

function setMasterThemeLocal(key) {
  if (!MASTER_THEMES[key] || key === masterThemeKey) return;
  masterThemeKey = key;
  try { localStorage.setItem(LS_MASTER_THEME, key); } catch (e) {}
  applyTheme();
}
// Every page follows the master theme: read on load, every minute, and whenever the tab comes back.
async function syncMasterTheme() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from("system_theme").select("theme").eq("id", "current").maybeSingle();
    if (!error && data && data.theme) setMasterThemeLocal(data.theme);
  } catch (e) {}
}
let masterThemeTimer = null;
function startMasterThemeSync() {
  if (masterThemeTimer) return;
  syncMasterTheme();
  masterThemeTimer = setInterval(syncMasterTheme, 60000);
  try { document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncMasterTheme(); }); } catch (e) {}
}

// --- Sales range aggregation, shared by index.html's X/Z-Read and the Backend dashboard ---
// rowStore's fetchAll() caps at a fixed row limit, fine for "today" but not for a week/month of a busy
// venue. These query Supabase directly with an explicit range instead.
async function fetchSalesInRange(startMs, endMs, venueIds) {
  if (!supabaseClient) return [];
  const ids = (venueIds && venueIds.length) ? venueIds : (currentVenueId ? [currentVenueId] : []);
  if (!ids.length) return [];
  try {
    const { data, error } = await supabaseClient.from("sales").select("data,venue_id")
      .in("venue_id", ids).gte("ts", startMs).lte("ts", endMs).order("ts", { ascending: true }).limit(50000);
    if (error) return [];
    return data.map(r => ({ ...r.data, venueId: r.venue_id })).filter(s => !s.isTest);
  } catch (e) { return []; }
}
async function fetchRefundsInRange(startMs, endMs, venueIds) {
  if (!supabaseClient) return [];
  const ids = (venueIds && venueIds.length) ? venueIds : (currentVenueId ? [currentVenueId] : []);
  if (!ids.length) return [];
  try {
    const { data, error } = await supabaseClient.from("refunds").select("data,venue_id")
      .in("venue_id", ids).gte("ts", startMs).lte("ts", endMs).limit(50000);
    if (error) return [];
    return data.map(r => ({ ...r.data, venueId: r.venue_id })).filter(r => !r.isTest);
  } catch (e) { return []; }
}

// --- Maintenance Mode: lets an admin test the app without spamming real Discord channels or
// polluting real takings. Every page that reads app_settings should set this after each fetch.
let maintenanceMode = false;
function maintenanceModeOn() { return maintenanceMode; }

// Each venue configures its own Discord webhooks in Backend (Venues section), no more one hardcoded
// channel for every site. Silently no-ops if the current venue hasn't set one, or Maintenance Mode
// is on (so testing never pages real staff or spams a real channel).
async function postDiscordEmbed(webhook, embed, file){
  if (!webhook || maintenanceMode) return;
  const opts = file ? (() => {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ embeds: [embed] }));
    form.append("files[0]", file.blob, file.name);
    return { method: "POST", body: form };
  })() : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ embeds: [embed] }) };
  // Discord's per-webhook limit is 5 requests/2s. On a busy night with several tills, that's
  // enough to get briefly rate-limited - retry a couple of times using the Retry-After it sends
  // back, rather than silently dropping the notification.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(webhook, opts);
      if (res.status !== 429) return;
      const retryAfter = parseFloat(res.headers.get("Retry-After")) || 1;
      await new Promise(r => setTimeout(r, retryAfter * 1000));
    } catch (e) { return; }
  }
}

// Printable Z Report / receipt HTML, shared by the till and Backend's Z Reads page.
function buildReceiptHTML(title, subtitle, rows, transactions){
  const rowsHtml = rows.map(([l,v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join("");
  const txnHtml = (transactions && transactions.length) ? `
    <h2>Every Transaction</h2>
    <table class="txns">
      <thead><tr><th>Time</th><th>Table</th><th>Items</th><th>Discount</th><th>Method</th><th>Total</th></tr></thead>
      <tbody>
        ${transactions.slice().reverse().map(sale => {
          const time = fmtTime(sale.ts);
          const itemsText = sale.items.map(i => `${i.qty}× ${i.name}`).join(", ");
          const method = sale.method === "cash" ? "Cash" : "Card";
          if (sale.isRefund) {
            return `<tr style="color:#c53c2c;"><td>${time}</td><td>-</td><td>${itemsText} <strong>REFUND</strong></td><td>-</td><td>${method}</td><td>−£${(sale.total/100).toFixed(2)}</td></tr>`;
          }
          const discountText = sale.discountAmount ? `${sale.discountLabel} −£${(sale.discountAmount/100).toFixed(2)}` : "-";
          return `<tr><td>${time}</td><td>${sale.table || "-"}</td><td>${itemsText}</td><td>${discountText}</td><td>${method}</td><td>£${(sale.total/100).toFixed(2)}</td></tr>`;
        }).join("")}
      </tbody>
    </table>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:820px;margin:24px auto;color:#111;background:#fff;padding:0 16px;}
    h1{font-size:20px;margin:0 0 2px;}
    h2{font-size:15px;margin:28px 0 10px;}
    .sub{color:#666;font-size:12px;margin:0 0 20px;}
    table{width:100%;border-collapse:collapse;}
    td{padding:9px 0;border-bottom:1px solid #ddd;font-size:14px;}
    td:last-child{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;}
    table.txns th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#666;padding:6px 8px;border-bottom:2px solid #111;}
    table.txns td{padding:8px;font-size:12.5px;vertical-align:top;}
    table.txns tr:nth-child(even){background:#f7f7f7;}
    @media print{ table.txns tr{page-break-inside:avoid;} }
  </style></head><body><h1>${title}</h1><p class="sub">${subtitle}</p><table>${rowsHtml}</table>${txnHtml}</body></html>`;
}
function openReportTab(title, subtitle, rows, transactions){
  const win = window.open("", "_blank");
  if (!win) { alert("Allow pop-ups to open the report"); return; }
  win.document.write(buildReceiptHTML(title, subtitle, rows, transactions));
  win.document.close();
  setTimeout(() => { try { win.focus(); win.print(); } catch(e){} }, 350);
}
function zReportTitle(venueName, closedAt, closedByName){
  const date = new Date(closedAt).toLocaleDateString("en-GB");
  return `Z-READ - ${venueName} - ${date} - By ${closedByName || "Unknown"}`;
}
function zReportRows(s){
  return [
    ["Cash", "£" + (s.cashTotal/100).toFixed(2)], ["Card", "£" + (s.cardTotal/100).toFixed(2)], ["Takings", "£" + (s.grandTotal/100).toFixed(2)],
    ["Tips", "£" + ((s.gratuityTotal||0)/100).toFixed(2)], ["Discounts given", "£" + (s.discountTotal/100).toFixed(2)],
    ["Refunds given", "£" + (s.refundTotal/100).toFixed(2)],
    ["Abandoned (not counted)", "£" + ((s.abandonedTotal||0)/100).toFixed(2)], ["Transactions", String(s.txCount)]
  ];
}

function mergeRefundsIntoTransactions(transactions, refundRows){
  const refundEntries = (refundRows || []).map(r => ({ ts: r.ts, isRefund: true, items: [{ qty: r.qty, name: r.itemName }], method: r.method, total: r.pence }));
  return transactions.concat(refundEntries).sort((a, b) => b.ts - a.ts);
}

// --- Shift boundary: Z Read used to hard-delete sales/refunds/gratuities, which meant a closed
// shift's numbers vanished from the Dashboard's Week/Month view. Now Z Read just advances this
// per-venue marker instead - the event-log tables keep every row forever, and the till's "current
// shift" views (X/Z Read, Past Orders) filter to ts >= shiftStart while Week/Month keeps querying
// the full range regardless of how many shifts have closed since.
async function getShiftStart(venueId) {
  if (!supabaseClient || !venueId) return 0;
  try {
    const { data } = await supabaseClient.from("app_state").select("value").eq("key", venueId + ":shiftStart").maybeSingle();
    return (data && data.value) || 0;
  } catch (e) { return 0; }
}
async function setShiftStart(venueId, ts) {
  if (!supabaseClient || !venueId) return;
  try { await supabaseClient.from("app_state").upsert({ key: venueId + ":shiftStart", value: ts }); } catch (e) {}
}

// Closes out a venue's current shift: sums everything since the last shift boundary, archives it
// as a Z report, advances the boundary, and logs to the venue's zread webhook - usable from the
// till (which also resets its own local cart/history state) or Backend (which just needs the
// summary back to refresh its own views). Never deletes the underlying sales/refunds rows.
async function performZRead(venue, closedByName) {
  const shiftStart = await getShiftStart(venue.id);
  const closedAt = Date.now();
  const [sales, refunds] = await Promise.all([
    fetchSalesInRange(shiftStart, closedAt, [venue.id]),
    fetchRefundsInRange(shiftStart, closedAt, [venue.id])
  ]);
  let gratuities = [], abandoned = [];
  try {
    const [gRes, aRes] = await Promise.all([
      supabaseClient.from("gratuities").select("data").eq("venue_id", venue.id).gte("ts", shiftStart).lte("ts", closedAt),
      supabaseClient.from("abandoned").select("data").eq("venue_id", venue.id).gte("ts", shiftStart).lte("ts", closedAt)
    ]);
    gratuities = (gRes.data || []).map(r => r.data).filter(g => !g.isTest);
    abandoned = (aRes.data || []).map(r => r.data).filter(a => !a.isTest);
  } catch (e) {}
  const summary = computeSalesSummary(sales, refunds);
  const gratuityTotal = gratuities.reduce((s, g) => s + g.amount, 0);
  const abandonedTotal = abandoned.reduce((s, x) => s + x.total, 0);
  const closedBy = closedByName || "Unknown";
  const fullSummary = { ...summary, gratuityTotal, abandonedTotal, closedBy };
  const transactions = mergeRefundsIntoTransactions(sales, refunds);
  const zId = "z" + closedAt;
  try {
    const { error } = await supabaseClient.from("z_reports").upsert({ id: zId, closed_at: closedAt, venue_id: venue.id, summary: fullSummary, transactions });
    // Don't advance the shift boundary if the archive write itself failed - otherwise these sales
    // would count toward neither this Z Read nor the next one.
    if (error) return { error: error.message };
  } catch (e) { return { error: "Network error" }; }
  await setShiftStart(venue.id, closedAt);
  const title = zReportTitle(venue.name, closedAt, closedBy);
  if (venue.discordWebhooks && venue.discordWebhooks.zread) {
    const reportHtml = buildReceiptHTML(title, fmtDateTime(closedAt), zReportRows(fullSummary), transactions);
    postDiscordEmbed(venue.discordWebhooks.zread, {
      title,
      color: 0xfecf46,
      fields: [
        { name: "Venue", value: venue.name, inline: true },
        { name: "Cash", value: "£" + (fullSummary.cashTotal / 100).toFixed(2), inline: true },
        { name: "Card", value: "£" + (fullSummary.cardTotal / 100).toFixed(2), inline: true },
        { name: "Takings", value: "£" + (fullSummary.grandTotal / 100).toFixed(2), inline: true },
        { name: "Refunds", value: "£" + (fullSummary.refundTotal / 100).toFixed(2), inline: true },
        { name: "Transactions", value: String(fullSummary.txCount), inline: true },
        { name: "Closed by", value: closedByName || "Unknown", inline: true }
      ],
      timestamp: new Date(closedAt).toISOString()
    }, { blob: new Blob([reportHtml], { type: "text/html" }), name: `z-read-${closedAt}.html` });
  }
  return { zId, closedAt, summary: fullSummary, transactions, sales, refunds, gratuities, abandoned };
}

function computeSalesSummary(sales, refunds) {
  refunds = refunds || [];
  const refundCash = refunds.filter(r => (r.method || "card") === "cash").reduce((s, r) => s + r.pence, 0);
  const refundCard = refunds.filter(r => (r.method || "card") === "card").reduce((s, r) => s + r.pence, 0);
  const cashTotal = sales.filter(s => (s.method || "card") === "cash").reduce((s, x) => s + x.total, 0) - refundCash;
  const cardTotal = sales.filter(s => (s.method || "card") === "card").reduce((s, x) => s + x.total, 0) - refundCard;
  const grandTotal = cashTotal + cardTotal;
  const discountTotal = sales.reduce((s, x) => s + (x.discountAmount || 0), 0);
  const txCount = sales.length;
  return { cashTotal, cardTotal, grandTotal, discountTotal, refundTotal: refundCash + refundCard, txCount, avgOrderPence: txCount ? Math.round(grandTotal / txCount) : 0 };
}

function computeBestSellers(sales, limit, refunds) {
  const itemStats = {};
  sales.forEach(sale => {
    (sale.items || []).forEach(i => {
      if (!itemStats[i.name]) itemStats[i.name] = { name: i.name, qty: 0, revenue: 0 };
      itemStats[i.name].qty += i.qty;
      itemStats[i.name].revenue += i.pence * i.qty;
    });
  });
  (refunds || []).forEach(r => {
    if (!itemStats[r.itemName]) itemStats[r.itemName] = { name: r.itemName, qty: 0, revenue: 0 };
    itemStats[r.itemName].qty -= r.qty;
    itemStats[r.itemName].revenue -= r.pence;
  });
  return Object.values(itemStats).sort((a, b) => b.qty - a.qty).slice(0, limit || 15);
}

// bucket: "hour" (0-23, for a single-day range) or "day" (YYYY-MM-DD, for anything longer)
function computeSalesTrend(sales, bucket, refunds) {
  const buckets = {};
  sales.forEach(sale => {
    const d = new Date(sale.ts);
    const key = bucket === "hour" ? String(d.getHours()).padStart(2, "0") + ":00" : d.toISOString().slice(0, 10);
    buckets[key] = (buckets[key] || 0) + sale.total;
  });
  (refunds || []).forEach(r => {
    const d = new Date(r.ts);
    const key = bucket === "hour" ? String(d.getHours()).padStart(2, "0") + ":00" : d.toISOString().slice(0, 10);
    buckets[key] = (buckets[key] || 0) - r.pence;
  });
  return Object.entries(buckets).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([label, totalPence]) => ({ label, totalPence }));
}

function computeVenueBreakdown(sales, venues) {
  const byVenue = {};
  sales.forEach(sale => {
    const id = sale.venueId;
    if (!byVenue[id]) byVenue[id] = { venueId: id, total: 0, txCount: 0 };
    byVenue[id].total += sale.total;
    byVenue[id].txCount += 1;
  });
  return Object.values(byVenue).map(row => ({ ...row, name: (venues.find(v => v.id === row.venueId) || {}).name || row.venueId }))
    .sort((a, b) => b.total - a.total);
}

// Atomically merges `patch` into an open_orders row's data at the database level (Postgres jsonb `||`
// inside one UPDATE), so two devices toggling different fields on the same order (e.g. one marks it
// ready while another flags it) at the exact same moment can never have one clobber the other - unlike
// a client-side fetch-then-write, which only narrows that race, this closes it completely.
async function mergeOpenOrder(id, patch) {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient.rpc("merge_open_order", { p_id: id, p_patch: patch });
    if (error) return null;
    return data;
  } catch (e) { return null; }
}

// --- Refunds, shared by the till's Past Orders and the order screen's flagged-order card. A refund
// is always a whole line (e.g. 3× Peroni Pint) at what the customer actually paid for it, so any
// discount on the sale is taken off proportionally.
function refundAmountFor(sale, item) {
  const ratio = sale.base > 0 ? Math.max(0, (sale.base - (sale.discountAmount || 0)) / sale.base) : 1;
  return Math.round(item.pence * item.qty * ratio);
}
// The sale an open order came from (orders keep the sale's ts, not its id).
async function fetchSaleForOrder(order) {
  if (!supabaseClient || !order || !order.saleTs) return null;
  try {
    const { data } = await supabaseClient.from("sales").select("data").eq("venue_id", currentVenueId).eq("ts", order.saleTs).limit(1);
    return data && data[0] ? data[0].data : null;
  } catch (e) { return null; }
}
// Marks one line of a sale refunded and logs the refund row. Re-reads the sale first so two devices
// refunding different lines of the same sale can't overwrite each other. Returns { refundRow, sale }
// or { error }.
async function refundSaleLine(saleId, itemIdx) {
  const sales = rowStore("sales"), refundsTable = rowStore("refunds");
  let already = false;
  const fresh = await sales.mutate(saleId, s => {
    const it = s.items[itemIdx];
    if (!it || it.refunded) { already = true; return; }
    it.refunded = true;
  });
  if (!fresh) return { error: "Couldn't reach the database, nothing was refunded. Try again." };
  if (already) return { error: "That item has already been refunded." };
  const item = fresh.items[itemIdx];
  const refundRow = { id: "r" + Date.now() + Math.random().toString(36).slice(2, 6), ts: Date.now(), saleTs: fresh.ts, itemName: item.name, qty: item.qty, pence: refundAmountFor(fresh, item), method: fresh.method || "card" };
  if (maintenanceMode) refundRow.isTest = true;
  await refundsTable.save(refundRow);
  return { refundRow, sale: fresh };
}
function logRefundToDiscordFor(venue, byName, refundRow, sale) {
  postDiscordEmbed(venue && venue.discordWebhooks && venue.discordWebhooks.order, {
    title: `REFUND - TABLE ${(sale && sale.table) || "N/A"}`,
    color: 0xff7a68,
    fields: [
      { name: "Item", value: `${refundRow.qty}x ${refundRow.itemName}`, inline: true },
      { name: "Amount", value: "£" + (refundRow.pence / 100).toFixed(2), inline: true },
      { name: "Method", value: refundRow.method === "cash" ? "Cash" : "Card", inline: true },
      { name: "By", value: byName || "Unknown", inline: true }
    ],
    timestamp: new Date(refundRow.ts).toISOString()
  });
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- Open order cards, shared by the order screen and the till's Open Orders list.
// Lifecycle: New order -> In progress (accepted on the order screen, yellow) -> Ready to take out
// (green) -> Delivered. The list is "who needs you first": problems, then orders ready to take out,
// then new orders waiting to be accepted, then orders in progress - each group oldest first, so the
// longest-waiting table is never buried under newer ones.
function orderStage(o) {
  if (needsRefund(o)) return refundUnderway(o) ? "refunding" : "refund";
  if (o.flagged) return "problem";
  if (o.ready) return "ready";
  return o.accepted ? "progress" : "new";
}
function sortOrdersByPriority(list) {
  const rank = o => ({ refund: 0, refunding: 0, problem: 0, ready: 1, new: 2, progress: 3 })[orderStage(o)];
  return list.slice().sort((a, b) => (rank(a) - rank(b)) || (a.ts - b.ts));
}
function orderLabel(o) { return o.table ? "Table " + o.table : "No table"; }
function poundsText(pence) { return "£" + (pence / 100).toFixed(2); }
// A flagged order needs a refund if whoever reported it chose "Refund it", or someone later said the
// customer wants their money back. Only staff with Process Refunds can then close it - by refunding.
function needsRefund(o) { return !!(o && o.flagged && (o.flagIntent === "refund" || o.refundRequested)); }
async function requestRefundForOrder(o, byName) {
  return await mergeOpenOrder(o.id, { refundRequested: true, refundRequestedBy: byName || null, refundRequestedAt: Date.now() });
}
// "Needs refund" (red) until someone with refund access opens the refund screen; then "Refund in
// progress" (yellow) for everyone else. Going Back off that screen puts it back to "Needs refund".
// While one person has the refund screen open, nobody else can start a second refund on the same
// order. If their device dies mid-refund the lock lapses after 10 minutes so the order can't get stuck.
const REFUND_LOCK_MS = 10 * 60 * 1000;
function refundUnderway(o) { return !!(o && o.refundInProgress && Date.now() - (o.refundInProgressAt || 0) < REFUND_LOCK_MS); }
function refundLockedByOther(o, myId) { return refundUnderway(o) && !!o.refundInProgressById && o.refundInProgressById !== myId; }
async function setRefundInProgress(o, on, byName, byId) {
  return await mergeOpenOrder(o.id, on
    ? { refundRequested: true, refundInProgress: true, refundInProgressBy: byName || null, refundInProgressById: byId || null, refundInProgressAt: Date.now() }
    : { refundInProgress: false, refundInProgressBy: null, refundInProgressById: null, refundInProgressAt: null });
}
// Re-reads the order straight from the database (not this screen's last poll) and, if nobody else is
// refunding it, claims it. Returns { order } or { error }.
async function claimRefund(o, byName, byId) {
  try {
    const { data } = await supabaseClient.from("open_orders").select("data").eq("id", o.id).maybeSingle();
    if (!data) return { error: "This order has already been closed." };
    if (refundLockedByOther(data.data, byId)) return { error: `${data.data.refundInProgressBy || "Someone"} is already refunding this.` };
  } catch (e) { return { error: "Couldn't reach the database. Try again." }; }
  const fresh = await setRefundInProgress(o, true, byName, byId);
  return fresh ? { order: fresh } : { error: "Couldn't reach the database. Try again." };
}
// opts: { isNext, myId, canRefund, refundPence (number | null while loading | undefined if no sale), onAcceptOrder,
// onReady, onDeliver, onFlag, onAccept (customer took the substitute), onRequestRefund, onRefund }
function buildOrderCard(o, opts) {
  const subItem = o.items.find(i => i.substituted);
  const state = orderStage(o), refund = state === "refund" || state === "refunding";
  const known = typeof opts.refundPence === "number";
  const card = document.createElement("article");
  card.className = "oc oc-state-" + (state === "refund" ? "problem" : state === "refunding" ? "refund" : state) + (opts.isNext ? " oc-next" : "");
  card.setAttribute("aria-label", `${orderLabel(o)}, ${{ refund: "needs refund", refunding: "refund in progress", problem: "problem", ready: "ready to take out", progress: "in progress", new: "new order" }[state]}`);
  const badge = state === "refund" ? `<span class="state-badge problem">${icon("alert")}Needs refund</span>`
    : state === "refunding" ? `<span class="state-badge progress">${icon("clock")}Refund in progress</span>`
    : state === "problem" ? `<span class="state-badge problem">${icon("alert")}Problem</span>`
    : state === "ready" ? `<span class="state-badge ready">${icon("check")}Ready to take out</span>`
    : state === "progress" ? `<span class="state-badge progress">${icon("clock")}In progress</span>`
    : `<span class="state-badge">${icon("bell")}New order</span>`;
  const items = o.items.map(i => i.substituted
    ? `${i.qty}× ${esc(i.name)} <span class="oc-muted">(free, instead of ${esc(i.subFor)})</span>`
    : `${i.qty}× ${esc(i.name)}`).join("<br>");
  const what = `<strong>${esc(o.flagItem)}: ${esc((o.flagReason || "").toLowerCase())}.</strong>`;
  const flagText = !o.flagged ? ""
    : refund
      ? (state === "refunding"
        ? `<div class="oc-progress">${icon("clock")}<span><strong>Refund in progress</strong> · ${esc(o.flagItem)}${known ? ", " + poundsText(opts.refundPence) : ""}${o.refundInProgressBy ? ` · by ${esc(o.refundInProgressBy)}` : ""}</span></div>`
        : `<div class="oc-problem">${icon("alert")}<span><strong>Needs refund</strong> · ${esc(o.flagItem)}${known ? ", " + poundsText(opts.refundPence) : ""}</span></div>`)
      : `<div class="oc-problem">${icon("alert")}<span>${what}${o.flagIntent === "substitute" && o.flagSubstitute ? ` Offer ${esc(o.flagSubstitute)} instead, free.` : ""}</span></div>`;
  card.innerHTML = `
    <div class="oc-top">${opts.isNext ? `<span class="state-badge next">Next</span>` : ""}${badge}<span class="oc-time">${fmtTime(o.ts)} · ${minutesAgo(o.ts)}</span></div>
    <div class="oc-head"><h3 class="oc-table">${esc(orderLabel(o))}</h3><span class="tag">${o.method === "cash" ? "Cash" : "Card"}</span></div>
    <div class="oc-items">${items}</div>
    ${o.notes ? `<div class="note-box">${icon("note")}<span>${esc(o.notes)}</span></div>` : ""}
    ${flagText}
    ${!o.flagged && subItem ? `<div class="oc-muted oc-line">${icon("check")} Customer took ${esc(subItem.name)} instead of ${esc(subItem.subFor)}</div>` : ""}
    ${o.placedBy ? `<div class="oc-muted oc-line">Taken by ${esc(o.placedBy)}${o.accepted && o.acceptedBy ? ` · accepted by ${esc(o.acceptedBy)}` : ""}</div>` : ""}
    <div class="oc-actions"></div>`;
  const actions = card.querySelector(".oc-actions");
  const primary = opts.isNext ? "btn btn-accent" : "btn btn-solid";
  const add = (cls, label, fn, disabled) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = cls; b.textContent = label; b.disabled = !!disabled;
    if (fn) b.addEventListener("click", fn);
    actions.appendChild(b);
    return b;
  };
  // refundPence: number = ready; null = still looking the sale up; undefined = sale not found here
  const refundButton = () => {
    if (opts.refundPence === undefined) add("btn btn-danger-solid", "Refund from Past Orders", opts.onRefund);
    else add("btn btn-danger-solid", known ? `Refund ${poundsText(opts.refundPence)}` : "Working out refund…", known ? opts.onRefund : null, !known);
  };
  if (refund) {
    // Nothing here closes or removes the order: it only goes once the refund has actually been given.
    // And while someone else is mid-refund, nobody else gets a Refund button.
    if (opts.canRefund && !refundLockedByOther(o, opts.myId)) refundButton();
  } else if (o.flagged) {
    if (o.flagIntent === "substitute" && o.flagSubstitute) add("btn btn-solid", `Customer took ${o.flagSubstitute}`, opts.onAccept);
    else add("btn btn-solid", "Customer is happy, carry on", opts.onAccept);
    if (opts.canRefund) refundButton();
    else add("btn btn-danger", "Customer wants a refund", opts.onRequestRefund);
  } else {
    if (opts.onFlag) add("btn btn-ghost", "Report a problem", opts.onFlag);
    if (o.ready) add(primary, o.table ? `Delivered to table ${o.table}` : "Delivered", opts.onDeliver);
    else if (!o.accepted && opts.onAcceptOrder) add(primary, "Accept order", opts.onAcceptOrder);
    else add(primary, "Ready to take out", opts.onReady);
  }
  return card;
}

// --- Refund screen: full-screen, laid out like the till's payment screen, so the customer can see
// what's coming back to them. Resolves true once the refund is logged, false if they go back.
// opts: { order, sale, item, pence, onConfirm: async () => ({ error } | { refundRow }) }
function openRefundScreen(opts) {
  let el = document.getElementById("refundScreen");
  if (!el) {
    el = document.createElement("div");
    el.id = "refundScreen"; el.className = "rf"; el.hidden = true;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "rfTitle");
    el.innerHTML = `
      <div class="rf-head">
        <button class="icon-btn" type="button" id="rfBack" aria-label="Back, don't refund">${icon("back")}</button>
        <h2 id="rfTitle"></h2>
      </div>
      <div class="rf-body">
        <div class="rf-label">Refund to customer</div>
        <div class="rf-amount tabular" id="rfAmount"></div>
        <div class="rf-lines" id="rfLines"></div>
        <div class="rf-howto" id="rfHowto"></div>
        <div class="rf-error" id="rfError" role="alert" hidden></div>
      </div>
      <div class="rf-foot">
        <button class="btn btn-ghost" type="button" id="rfCancel">Back</button>
        <button class="btn btn-danger-solid" type="button" id="rfConfirm"></button>
      </div>`;
    document.body.appendChild(el);
  }
  const { order, sale, item, pence } = opts;
  const amount = poundsText(pence), cash = (sale.method || "card") === "cash";
  el.querySelector("#rfTitle").textContent = `Refund · ${orderLabel(order)}`;
  el.querySelector("#rfAmount").textContent = amount;
  el.querySelector("#rfLines").innerHTML = `<div>${item.qty} × ${esc(item.name)}</div><div class="oc-muted">${esc(order.flagReason || "")}${order.flagReason ? " · " : ""}paid by ${cash ? "cash" : "card"}${pence < item.pence * item.qty ? ` · discount on the order taken off (full price ${poundsText(item.pence * item.qty)})` : ""}</div>`;
  el.querySelector("#rfHowto").innerHTML = cash
    ? `Give the customer <strong>${amount}</strong> back in cash from the till, then log the refund.`
    : `On the card machine choose <strong>Refund</strong>, key in <strong>${amount}</strong> and have the customer tap the same card. Once it's approved, log the refund.`;
  const err = el.querySelector("#rfError"); err.hidden = true;
  const confirm = el.querySelector("#rfConfirm");
  confirm.textContent = cash ? `Cash given back, log ${amount} refund` : `Refund approved, log ${amount} refund`;
  confirm.disabled = false;
  el.hidden = false;
  el.querySelector("#rfCancel").focus();
  return new Promise(resolve => {
    const close = v => { el.hidden = true; el.querySelector("#rfBack").onclick = el.querySelector("#rfCancel").onclick = confirm.onclick = null; resolve(v); };
    el.querySelector("#rfBack").onclick = el.querySelector("#rfCancel").onclick = () => close(false);
    confirm.onclick = async () => {
      confirm.disabled = true; confirm.textContent = "Logging refund…";
      const res = await opts.onConfirm();
      if (res && res.error) {
        err.textContent = res.error; err.hidden = false;
        confirm.disabled = false; confirm.textContent = cash ? `Cash given back, log ${amount} refund` : `Refund approved, log ${amount} refund`;
        return;
      }
      close(true);
    };
  });
}

// Every shared log is a table of independent rows, one per event, addressed by its own id. A device
// only ever writes its own row, so two devices can never clobber each other. Rows are also scoped to
// the currently selected venue so one venue's data is never mixed with another's.
function rowStore(table, limit) {
  limit = limit || 1000;
  return {
    async save(row) {
      if (!supabaseClient || !currentVenueId) return;
      try { await supabaseClient.from(table).upsert({ id: row.id, ts: row.ts, venue_id: currentVenueId, data: row }); } catch (e) {}
    },
    async remove(id) {
      if (!supabaseClient) return;
      try { await supabaseClient.from(table).delete().eq("id", id); } catch (e) {}
    },
    // Fetches the row fresh right before applying `mutator` and saving it, so a field another device
    // set in the meantime (e.g. someone else flagging this same order) isn't clobbered by a stale copy.
    async mutate(id, mutator) {
      if (!supabaseClient) return null;
      try {
        const { data, error } = await supabaseClient.from(table).select("data").eq("id", id).maybeSingle();
        if (error || !data) return null;
        const fresh = data.data;
        mutator(fresh);
        await this.save(fresh);
        return fresh;
      } catch (e) { return null; }
    },
    async fetchAll() {
      if (!supabaseClient || !currentVenueId) return null;
      try {
        const { data, error } = await supabaseClient.from(table).select("data").eq("venue_id", currentVenueId).order("ts", { ascending: false }).limit(limit);
        if (error) return null;
        // Maintenance Mode's test rows are invisible everywhere except the Backend Test Data view
        // (countTest/clearTest below) - harmless no-op filter for tables that never set isTest.
        return data.map(r => r.data).filter(row => !row.isTest);
      } catch (e) { return null; }
    },
    async clear() {
      if (!supabaseClient || !currentVenueId) return;
      try { await supabaseClient.from(table).delete().eq("venue_id", currentVenueId); } catch (e) {}
    },
    // Maintenance Mode support: count/clear rows tagged isTest for the current venue.
    async countTest() {
      if (!supabaseClient || !currentVenueId) return 0;
      try {
        const { count } = await supabaseClient.from(table).select("id", { count: "exact", head: true }).eq("venue_id", currentVenueId).eq("data->>isTest", "true");
        return count || 0;
      } catch (e) { return 0; }
    },
    async clearTest() {
      if (!supabaseClient || !currentVenueId) return;
      try { await supabaseClient.from(table).delete().eq("venue_id", currentVenueId).eq("data->>isTest", "true"); } catch (e) {}
    }
  };
}

// --- Personal notifications ("needs you at the bar", order flagged, ...): addressed to a *user*, not
// scoped to a venue. Unlike every other rowStore table, the point of these is that the recipient can be
// signed into a completely different venue than the sender (that's the whole "notify me for other
// venues" feature) - so, unlike rowStore.fetchAll(), this can't filter by currentVenueId, or the
// recipient's own poll loop would never see rows written under the sender's venue. venue_id is still
// stored (useful context, and every row needs one), it's just no longer part of who can see the row -
// RLS on this table grants access by to_user_id/from_user_id instead of venue membership.
async function saveNotification(row) {
  if (!supabaseClient || !currentVenueId) return;
  try { await supabaseClient.from("notifications").upsert({ id: row.id, ts: row.ts, venue_id: currentVenueId, data: row }); } catch (e) {}
}
// A "quiet" notice is a message bar only on the recipient's screen - no sound, no system notification,
// no push. Used for low-stakes updates like "your order is in progress".
async function sendQuietNotice(toUserId, fromUserId, fromName, message) {
  if (!toUserId) return null;
  const notif = { id: "n" + Date.now() + Math.random().toString(36).slice(2, 6), ts: Date.now(), toUserId, fromUserId, fromName: fromName || "Someone", message, quiet: true };
  await saveNotification(notif);
  return notif;
}
async function fetchMyNotifications(userId, limit) {
  if (!supabaseClient || !userId) return null;
  try {
    const { data, error } = await supabaseClient.from("notifications").select("data")
      .in("to_user_id", [userId, "all"]).order("ts", { ascending: false }).limit(limit || 200);
    if (error) return null;
    return data.map(r => r.data);
  } catch (e) { return null; }
}

// --- Staff groups (Bar Staff, Table Service, ...): global, not venue-scoped, so not a rowStore table ---
async function fetchAllGroups() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient.from("staff_groups").select("id,data").order("ts", { ascending: true });
    if (error || !data) return [];
    return data.map(r => ({ id: r.id, ...r.data }));
  } catch (e) { return []; }
}
async function saveGroup(id, name) {
  if (!supabaseClient) return { error: "Not connected" };
  try {
    const { error } = await supabaseClient.from("staff_groups").upsert({ id, ts: Date.now(), data: { name } });
    return error ? { error: error.message } : { ok: true };
  } catch (e) { return { error: "Network error" }; }
}
async function removeGroup(id) {
  if (!supabaseClient) return;
  try { await supabaseClient.from("staff_groups").delete().eq("id", id); } catch (e) {}
}

// --- Online presence: a heartbeat row per signed-in staff member ---
const PRESENCE_ONLINE_WINDOW_MS = 90 * 1000;
async function sendHeartbeat(userId, name) {
  if (!supabaseClient || !currentVenueId || !userId) return;
  try { await supabaseClient.from("presence").upsert({ id: userId, ts: Date.now(), venue_id: currentVenueId, data: { name } }); } catch (e) {}
}
async function clearHeartbeat(userId) {
  if (!supabaseClient || !userId) return;
  try { await supabaseClient.from("presence").delete().eq("id", userId); } catch (e) {}
}
// Accounts meant for quiet admin/dev access. Never shown in staff-facing pickers, lists, or presence.
const HIDDEN_ACCOUNT_NAMES = new Set(["maintenance", "administrator", "developer"]);
function isHiddenAccount(name) { return HIDDEN_ACCOUNT_NAMES.has((name || "").trim().toLowerCase()); }

async function fetchOnlineUserIds() {
  if (!supabaseClient || !currentVenueId) return new Set();
  try {
    const cutoff = Date.now() - PRESENCE_ONLINE_WINDOW_MS;
    const { data, error } = await supabaseClient.from("presence").select("id").eq("venue_id", currentVenueId).gte("ts", cutoff);
    if (error || !data) return new Set();
    return new Set(data.map(r => r.id));
  } catch (e) { return new Set(); }
}
// Which venue (if any) each of the given user ids is currently active in, regardless of venue. Used
// to show someone who's signed up for another venue's notifications but is actually logged in
// elsewhere right now.
async function fetchPresenceMap(userIds) {
  if (!supabaseClient || !userIds.length) return new Map();
  try {
    const cutoff = Date.now() - PRESENCE_ONLINE_WINDOW_MS;
    const { data, error } = await supabaseClient.from("presence").select("id,venue_id").in("id", userIds).gte("ts", cutoff);
    if (error || !data) return new Map();
    return new Map(data.map(r => [r.id, r.venue_id]));
  } catch (e) { return new Map(); }
}

// Every venue, for pickers like "notify me about these venues" where seeing the full list matters
// more than membership.
// Used for the "notify me for these venues" picker - closed venues aren't worth subscribing to.
async function fetchAllVenues() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient.from("venues").select("id,data").order("ts", { ascending: true });
    if (error || !data) return [];
    return data.map(r => ({ id: r.id, ...r.data })).filter(v => v.active !== false);
  } catch (e) { return []; }
}
// Staff subscribed to a venue's service notifications without necessarily being assigned to it. Goes
// through the Edge Function (not a direct query) because RLS on staff_users only lets you see people
// who share a venue with you, and these subscribers might not - the function returns just id/name,
// never pin/perms, regardless of who's asking.
async function fetchNotifySubscribers(venueId) {
  const res = await callManageStaff("listNotifySubscribers", { venueId });
  return res.subscribers || [];
}
async function setMyNotifyVenues(venueIds) {
  return await callManageStaff("setNotifyVenues", { venueIds });
}
// Global Admin only. Wipes every row scoped to this venue (sales, orders, catalogue, z reports, ...)
// across every table, then the venue itself - irreversible, so the caller must confirm first.
async function deleteVenue(venueId) {
  return await callManageStaff("deleteVenue", { venueId });
}
// Plain fields like this don't touch auth, so they're a direct self-update rather than a trip through
// the Edge Function - the same RLS rule that lets you edit your own venues/groups covers this too.
async function setMyNotificationSound(sound) {
  const session = await getSession();
  if (!session) return { error: "Not signed in" };
  try {
    const { data } = await supabaseClient.from("staff_users").select("data").eq("id", session.user.id).maybeSingle();
    if (!data) return { error: "Account not found" };
    const { error } = await supabaseClient.from("staff_users").update({ data: { ...data.data, notificationSound: sound } }).eq("id", session.user.id);
    return error ? { error: error.message } : { ok: true };
  } catch (e) { return { error: "Network error" }; }
}

// --- Notification sounds ---
// A handful of built-in synthesized tones, always available with zero setup, plus whatever real
// audio files a Global Admin has uploaded in Backend (Settings > Notification Sounds). A "sound
// choice" string is either a preset id below or a Storage path like "1699999999-doorbell.mp3".
const CHIME_PRESETS = {
  classic: "Classic (triple beep)",
  soft: "Soft bell",
  double: "Two-tone ding",
  urgent: "Urgent buzz",
  chirp: "Chirp"
};
function playChimePreset(audioCtx, preset) {
  if (!audioCtx) return;
  try {
    const tone = (freq, start, dur, type, peak) => {
      const t0 = audioCtx.currentTime + start;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
      gain.gain.setValueAtTime(peak, t0 + dur * 0.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    };
    if (preset === "soft") { tone(660, 0, 0.35, "sine", 0.5); }
    else if (preset === "double") { tone(880, 0, 0.16, "sine", 0.6); tone(1320, 0.16, 0.22, "sine", 0.6); }
    else if (preset === "urgent") { tone(700, 0, 0.09, "sawtooth", 0.7); tone(700, 0.12, 0.09, "sawtooth", 0.7); tone(700, 0.24, 0.09, "sawtooth", 0.7); }
    else if (preset === "chirp") { tone(1200, 0, 0.06, "sine", 0.6); tone(1800, 0.07, 0.08, "sine", 0.6); }
    else { for (let i = 0; i < 3; i++) tone(1500, i * 0.18, 0.14, "square", 0.8); } // classic, and the fallback for anything unrecognized
  } catch (e) {}
}
const NOTIFICATION_SOUNDS_BUCKET = "notification-sounds";
function notificationSoundUrl(path) {
  return supabaseClient.storage.from(NOTIFICATION_SOUNDS_BUCKET).getPublicUrl(path).data.publicUrl;
}
async function fetchNotificationSounds() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient.storage.from(NOTIFICATION_SOUNDS_BUCKET).list("", { sortBy: { column: "name", order: "asc" } });
    if (error || !data) return [];
    return data.filter(f => f.id).map(f => ({ path: f.name, label: f.name.replace(/^\d+-/, "").replace(/\.[a-z0-9]+$/i, "") }));
  } catch (e) { return []; }
}
async function uploadNotificationSound(file) {
  if (!supabaseClient) return { error: "Not connected" };
  const path = Date.now() + "-" + file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  try {
    const { error } = await supabaseClient.storage.from(NOTIFICATION_SOUNDS_BUCKET).upload(path, file, { contentType: file.type || "audio/mpeg" });
    return error ? { error: error.message } : { ok: true, path };
  } catch (e) { return { error: "Upload failed" }; }
}
async function deleteNotificationSound(path) {
  if (!supabaseClient) return;
  try { await supabaseClient.storage.from(NOTIFICATION_SOUNDS_BUCKET).remove([path]); } catch (e) {}
}
// Plays whichever kind of sound choice this is: a built-in preset (synthesized, needs the page's
// audioCtx) or an uploaded file (played through a plain <audio> element instead).
function playNotificationSound(audioCtx, soundChoice) {
  if (!soundChoice || CHIME_PRESETS[soundChoice]) { playChimePreset(audioCtx, soundChoice || "classic"); return; }
  try { new Audio(notificationSoundUrl(soundChoice)).play().catch(() => {}); } catch (e) {}
}
