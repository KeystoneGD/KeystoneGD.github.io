// Shared across index.html, orders.html and backend.html: the Supabase client, auth/venue session
// handling, and the rowStore/app_state helpers every page's inline script builds on. Load this before
// the page's own <script> block.

// The local Supabase API runs on the same server that serves these pages (the Chromebook), so it's
// reached through whatever hostname/IP the till used to open the page - "localhost" on the Chromebook
// itself, its LAN IP from every other device. config.js is written by scripts/start.sh.
const NIPOS_CONFIG = window.NIPOS_CONFIG || {};
const SUPABASE_URL = location.protocol + "//" + location.hostname + ":" + (NIPOS_CONFIG.apiPort || 54321);
const SUPABASE_ANON_KEY = NIPOS_CONFIG.anonKey;
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
  processRefunds: "Process Refunds",
  sendAnnouncements: "Send Announcements",
  notifySpecificUsers: "Notify Specific Users",
  viewActivityLogs: "View Activity Logs",
  approveRequests: "Manager approval"
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
  teal:   { label: "Teal",   color: "#0e7f8f", ink: "#ffffff" }, // a touch darker than #0f8394 so white text passes AA
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
  note: '<path d="M5 4.5h14v15H5z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'
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

// --- Times and money: 24-hour UK format and £, whatever the device's own locale - unless $YSTEM picks
// other formats (Master settings "formats": currency symbol, date style, 12 or 24-hour).
function fmtCfg() { return typeof systemSettings !== "undefined" && systemSettings.formats && systemSettings.formats.enabled ? systemSettings.formats : {}; }
function fmtLocale() { const d = fmtCfg().dateStyle; return d === "us" ? "en-US" : d === "iso" ? "sv-SE" : "en-GB"; }
function fmtClock(ts) { const h12 = !!fmtCfg().hour12; return new Date(ts).toLocaleTimeString(fmtLocale() === "sv-SE" ? "en-GB" : fmtLocale(), { hour: h12 ? "numeric" : "2-digit", minute: "2-digit", hour12: h12 }); }
// The night the clocks go back, 01:00-01:59 happens twice. Those times say which: 01:43 (1) is the
// first time round (summer time), 01:43 (2) the second. Lists are always in true time order anyway.
function clockRepeat(ts) {
  const wall = t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
  if (wall(ts - 3600000) === wall(ts)) return 2;
  if (wall(ts + 3600000) === wall(ts)) return 1;
  return 0;
}
function fmtTime(ts) { const r = clockRepeat(ts); return fmtClock(ts) + (r ? ` (${r})` : ""); }
function fmtDayTime(ts) {
  const d = new Date(ts);
  if (fmtCfg().dateStyle === "iso") return d.toLocaleDateString("sv-SE") + " · " + fmtTime(ts);
  return d.toLocaleDateString(fmtLocale(), { weekday: "short", day: "numeric", month: "short" }) + " · " + fmtTime(ts);
}
function fmtDateTime(ts) { const d = new Date(ts); return d.toLocaleDateString(fmtLocale()) + ", " + fmtTime(ts); }
function moneySymbol() { return fmtCfg().currency || "£"; }
function minutesAgo(ts) {
  const m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  return m < 1 ? "just now" : m === 1 ? "1 min ago" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

// Every request to the database gives up after 15 seconds without a reply. A request that never gets
// an answer (a dropped connection on venue Wi-Fi) used to wait for ever, and everything queued behind
// it (the outbox, the activity log) stopped with it while the till still said "Sale logged".
const REQUEST_TIMEOUT_MS = 15000;
function fetchWithTimeout(input, init) {
  const ctl = new AbortController(), opts = { ...(init || {}) };
  if (opts.signal) { if (opts.signal.aborted) ctl.abort(); else opts.signal.addEventListener("abort", () => ctl.abort(), { once: true }); }
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  return fetch(input, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(timer));
}
function connectAuthClient() {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
    global: { fetch: fetchWithTimeout }
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

// $YSTEM signs in by typing "$YSTEM" where the PIN goes, then its password. The password is the real
// sign-in, so the well-known name on its own gets nobody anywhere. Backend only.
const SYSTEM_SIGN_IN = "$YSTEM";
const SYSTEM_EMAIL = "system@nipos.local";
// Extra $YSTEM sign-ins: each has its own password (set with nipos_setup_system_login in the SQL Editor).
const SYSTEM_LOGIN_IDS = ["07466707188"];
function isSystemSignIn(code) { const c = String(code || "").trim(); return c.toUpperCase() === SYSTEM_SIGN_IN || SYSTEM_LOGIN_IDS.includes(c); }
function systemEmailFor(code) { const c = String(code || "").trim(); return SYSTEM_LOGIN_IDS.includes(c) ? "system-" + c + "@nipos.local" : SYSTEM_EMAIL; }
async function signInSystem(password, code) {
  const { error } = await supabaseClient.auth.signInWithPassword({ email: systemEmailFor(code), password });
  if (error) return { error: /rate|too many/i.test(error.message || "") ? "Too many tries. Wait a few minutes and try again." : "That password isn't right." };
  return { ok: true };
}

// When this device last signed someone in, so a "sign everyone out" sent while it was closed or asleep
// still signs it out when it wakes.
const LS_SIGNED_IN_AT = "nipos.signedInAt";
function markSignedIn() { try { localStorage.setItem(LS_SIGNED_IN_AT, String(Date.now())); } catch (e) {} }
function signedInAt() { try { return Number(localStorage.getItem(LS_SIGNED_IN_AT)) || 0; } catch (e) { return 0; } }

async function signInWithPin(pin) {
  if (isSystemSignIn(pin)) return { error: "This account only signs in to Backend" };
  const email = "pin" + pin + "@nipos.local";
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password: pin });
  if (error) return { error: "Incorrect PIN" };
  markSignedIn();
  return { ok: true };
}

async function signOutAuth() {
  await logActivity("Signed out", activityScreenName(), undefined, true);
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

// A stop belongs to one venue: the same drink can be on stop at one venue and selling at another.
function stopRowId(name) { return currentVenueId + ":" + name; }

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
  if (effectiveThemeKey() === "classic") setTheme(getTheme() === "light" ? "dark" : "light");
  else {
    try { localStorage.setItem(LS_THEME_MODE, getThemeMode() === "dark" ? "normal" : "dark"); } catch (e) {}
    applyTheme();
  }
}
// What the switch would change to next, for its label: { icon, label }.
function themeSwitchInfo() {
  if (effectiveThemeKey() === "classic") {
    return getTheme() !== "light" ? { icon: "sun", label: "Light theme" } : { icon: "moon", label: "Dark theme" };
  }
  return getThemeMode() === "dark" ? { icon: "sun", label: "Normal colours" } : { icon: "moon", label: "Dark mode" };
}

let lastVenueIdentity = null; // re-applied when the theme changes, since venue colours come from the theme
function applyTheme() {
  const html = document.documentElement;
  const themeKey = effectiveThemeKey();
  const t = MASTER_THEMES[themeKey];
  let styleEl = document.getElementById("masterThemeVars");
  if (themeKey === "classic" || !t) {
    html.dataset.theme = getTheme();
    delete html.dataset.master;
    if (styleEl) styleEl.remove();
    VENUE_ACCENT_KEYS.forEach(k => Object.assign(VENUE_ACCENTS[k], CLASSIC_VENUE_ACCENTS[k]));
  } else {
    const v = t[getThemeMode()];
    html.dataset.theme = v.scheme; // keeps each page's light/dark-only rules (status shades etc.) in step
    html.dataset.master = themeKey;
    if (!styleEl) { styleEl = document.createElement("style"); styleEl.id = "masterThemeVars"; }
    document.head.appendChild(styleEl); // last in <head>, so it wins over each page's own :root colours
    styleEl.textContent = "html:root:root{" + Object.entries(v.tokens).map(([k, c]) => k + ":" + c).join(";") + "}";
    VENUE_ACCENT_KEYS.forEach((k, i) => {
      const [label, color, ink] = t.venues[i];
      Object.assign(VENUE_ACCENTS[k], { label, color, ink });
    });
  }
  applyExtraVenueColours(themeKey);
  const bg = getComputedStyle(html).getPropertyValue("--bg").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute("content", bg);
  if (lastVenueIdentity) applyVenueIdentity(lastVenueIdentity.venue, lastVenueIdentity.staffName);
  try { document.dispatchEvent(new CustomEvent("nipos:themechange")); } catch (e) {}
}
function initTheme() { applyTheme(); }

// --- Till layout: also one setting for every till, chosen by $YSTEM next to the master theme. Each
// layout has a phone and a tablet version; the till picks by screen width (see index.html).
const POS_LAYOUTS = {
  classic: { name: "Current layout", about: "The menu as one long list, categories down the side." },
  tiles:   { name: "Big tiles", about: "Groups across the top, then big drink buttons. Tap a button to add it." },
  colour:  { name: "Colour-coded tiles", about: "Big buttons in each group's own colour, groups down the left." },
  list:    { name: "Restyled list", about: "Groups and categories down the left, drinks as rows with a + button." },
  pubtill: { name: "Pub till (WRS-style)", about: "Receipt and big total on the left, colour buttons, function keys along the bottom." },
  dock:    { name: "Dock", about: "Categories at the bottom within thumb reach, tonight's top 12, and last order again." }
};
const LS_POS_LAYOUT = "starlightTill.posLayout.v1";
let globalLayoutKey = "classic"; // the layout for everyone (Master settings)
try { const k = localStorage.getItem(LS_POS_LAYOUT); if (k && POS_LAYOUTS[k]) globalLayoutKey = k; } catch (e) {}
let posLayoutKey = globalLayoutKey; // the layout this till actually shows (a person's own layout wins)
document.documentElement.dataset.layout = posLayoutKey;
function getPosLayout() { return globalLayoutKey; }
function setPosLayoutLocal(key) {
  if (!POS_LAYOUTS[key] || key === globalLayoutKey) return;
  globalLayoutKey = key;
  try { localStorage.setItem(LS_POS_LAYOUT, key); } catch (e) {}
  refreshEffectiveLayout();
}
function refreshEffectiveLayout() {
  const own = personalSetting("layout");
  const key = own && POS_LAYOUTS[own] ? own : globalLayoutKey;
  if (key === posLayoutKey) return;
  posLayoutKey = key;
  document.documentElement.dataset.layout = key;
  try { document.dispatchEvent(new CustomEvent("nipos:layoutchange")); } catch (e) {}
}

function setMasterThemeLocal(key) {
  if (!MASTER_THEMES[key] || key === masterThemeKey) return;
  masterThemeKey = key;
  try { localStorage.setItem(LS_MASTER_THEME, key); } catch (e) {}
  applyTheme();
}
// --- Master settings: one record holding every optional feature's switch and configuration, set by
// $YSTEM (Backend > Master settings). Every feature is off until $YSTEM turns it on, so a feature
// that's being set up never changes what staff see. featureOn("maintenance") etc.
let systemSettings = {};
function featureOn(key) { const f = systemSettings[key]; return !!(f && f.enabled); }
function featureConfig(key) { return systemSettings[key] || {}; }

// Browser tab names. {venue} / {kitchen} is filled in; with no name yet (before sign-in) the
// trailing " - " goes. Master settings > Browser tab names can change each one.
const TAB_TITLES = {
  pos: "NIPOS - {venue}",
  orders: "NIPOS Order Screen - {venue}",
  kitchen: "NIPOS Kitchen View - {kitchen}",
  display: "NIPOS - Customer View",
  backend: "NIPOS Back Office - {venue}"
};
let tabTitleNow = null;
function tabTitle(kind, name) {
  const own = featureOn("tabTitles") ? ((featureConfig("tabTitles").titles || {})[kind] || "").trim() : "";
  const tpl = own || TAB_TITLES[kind] || "NIPOS";
  const out = tpl.replace(/\{(venue|kitchen|name)\}/gi, name || "").replace(/\s*[-–·|:]\s*$/, "").replace(/\s{2,}/g, " ").trim();
  return out || "NIPOS";
}
function setTabTitle(kind, name) {
  tabTitleNow = [kind, name];
  try { document.title = tabTitle(kind, name); } catch (e) {}
}
try { document.addEventListener("nipos:settingschange", () => { if (tabTitleNow) setTabTitle(tabTitleNow[0], tabTitleNow[1]); }); } catch (e) {}

// --- Push notifications on this device. $YSTEM can reset them for everyone (Master settings), which
// clears every saved device and asks each device to accept again; staff can also switch them off or
// on for their device from the till menu. Both are remembered per device in localStorage.
const LS_PUSH_ACCEPTED = "nipos.pushAcceptedAt", LS_PUSH_OFF = "nipos.pushOffAt";
function lsNumber(key) { try { return Number(localStorage.getItem(key)) || 0; } catch (e) { return 0; } }
function lsSetNumber(key, n) { try { if (n) localStorage.setItem(key, String(n)); else localStorage.removeItem(key); } catch (e) {} }
// The last reset seen is kept here too, so a device that signs in before Master settings has loaded
// still knows about it.
function pushResetAt() {
  const r = systemSettings.notifyReset, ts = (r && Number(r.ts)) || 0;
  if (ts > lsNumber("nipos.pushResetSeen")) lsSetNumber("nipos.pushResetSeen", ts);
  return Math.max(ts, lsNumber("nipos.pushResetSeen"));
}
// "unsupported", "blocked" (browser said no), "off" (switched off here), "ask" (never allowed),
// "reset" (allowed, but $YSTEM reset notifications since) or "on".
function pushState() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const accepted = lsNumber(LS_PUSH_ACCEPTED), off = lsNumber(LS_PUSH_OFF), reset = pushResetAt();
  if (off && off >= accepted && off >= reset) return "off";
  if (Notification.permission !== "granted") return "ask";
  return accepted < reset ? "reset" : "on";
}
function pushWanted() { return pushState() === "on"; }
// Never earlier than the last reset, in case this device's clock is behind the Backend's.
function pushNow() { return Math.max(Date.now(), pushResetAt() + 1); }
function markPushAccepted() { lsSetNumber(LS_PUSH_ACCEPTED, pushNow()); lsSetNumber(LS_PUSH_OFF, 0); }
function pushRowId(endpoint) { return "px" + btoa(endpoint).replace(/[^a-zA-Z0-9]/g, "").slice(0, 60); }
// Switch off here: forget this device's push registration in the browser and in the database.
async function disablePushHere() {
  lsSetNumber(LS_PUSH_OFF, Math.max(pushNow(), lsNumber(LS_PUSH_ACCEPTED) + 1));
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    if (typeof supabaseClient !== "undefined" && supabaseClient) { try { await supabaseClient.from("push_subscriptions").delete().eq("id", pushRowId(sub.endpoint)); } catch (e) {} }
    await sub.unsubscribe();
  } catch (e) {}
}

// Per-person layout and theme (feature "personal"): set when someone signs in on this device.
let signedInUserId = null, signedInUserName = null;
function personalSetting(field) {
  if (!signedInUserId || !featureOn("personal")) return null;
  const mine = (featureConfig("personal").users || {})[signedInUserId];
  return mine ? mine[field] || null : null;
}
function effectiveThemeKey() {
  const own = personalSetting("theme");
  return own && MASTER_THEMES[own] ? own : masterThemeKey;
}
// Pages call this whenever who's signed in changes (null when signed out).
function setSignedInUser(user) {
  signedInUserName = user ? user.name : null;
  const id = user ? user.id : null;
  if (id === signedInUserId) return;
  signedInUserId = id;
  applyTheme(); refreshEffectiveLayout(); renderMaintenanceWatermark();
}

// Extra venue colours (feature "venueColours"): each has a shade per theme; the text colour on it is
// worked out so it always reads (WCAG AA 4.5:1).
function hexLuminance(hex) {
  const c = String(hex || "").replace("#", "");
  if (c.length !== 6) return 0;
  const ch = [0, 2, 4].map(i => { const v = parseInt(c.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrastRatio(a, b) { const x = hexLuminance(a), y = hexLuminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function inkFor(hex) { return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#141414") ? "#ffffff" : "#141414"; }
function extraVenueColours() { return featureOn("venueColours") ? (featureConfig("venueColours").colours || []) : []; }
function applyExtraVenueColours(themeKey) {
  Object.keys(VENUE_ACCENTS).forEach(k => { if (!VENUE_ACCENT_KEYS.includes(k)) delete VENUE_ACCENTS[k]; });
  extraVenueColours().forEach(c => {
    const color = (c.shades && (c.shades[themeKey] || c.shades.classic)) || "#3d4a57";
    VENUE_ACCENTS[c.key] = { label: c.label, color, ink: inkFor(color) };
  });
}

// Maintenance Mode (feature "maintenance"): only the chosen people (and $YSTEM) can use the app; every
// sale made meanwhile is a test sale; a watermark runs across every screen.
function maintenanceLocksOut(user) {
  if (!featureOn("maintenance") || !user || user.system) return false;
  return !(featureConfig("maintenance").allowedUserIds || []).includes(user.id);
}
// Training mode for one person (feature "training"): their sales are tests, like Maintenance Mode,
// while everyone else works normally.
function trainingFor(userId) { const id = userId === undefined ? signedInUserId : userId; return !!id && featureOn("training") && (featureConfig("training").userIds || []).includes(id); }
function renderMaintenanceWatermark() {
  let el = document.getElementById("maintenanceWatermark");
  const text = featureOn("maintenance") ? "MAINTENANCE MODE - TESTING" : trainingFor() ? "TRAINING MODE - PRACTICE SALES" : null;
  if (!text) { if (el) el.remove(); return; }
  if (el && el.dataset.text !== text) { el.remove(); el = null; }
  if (!el) {
    el = document.createElement("div");
    el.id = "maintenanceWatermark"; el.className = "maint-watermark"; el.setAttribute("aria-hidden", "true"); el.dataset.text = text;
    el.innerHTML = Array.from({ length: 14 }, () => `<span>${text}</span>`).join("");
    document.body.appendChild(el);
  }
}
function maintenanceLockScreen(show, onSignOut) {
  let el = document.getElementById("maintenanceLock");
  if (!show) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "maintenanceLock"; el.className = "maint-lock";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "maintLockTitle");
    el.innerHTML = `<div class="maint-card"><h2 id="maintLockTitle">Maintenance in progress</h2><p>The system is being tested right now, so it's locked for everyone except the people testing it. It'll open again as soon as testing is finished.</p><button type="button" class="btn btn-solid" id="maintLockSignOut">Sign out</button></div>`;
    document.body.appendChild(el);
  }
  el.querySelector("#maintLockSignOut").onclick = onSignOut || null;
  el.hidden = false;
}

// Message on every till (feature "announcements"): shown under the venue band on the till and order
// screen. Posted from Master settings, or by anyone with Send announcements.
function currentAnnouncement(venueId) {
  if (!featureOn("announcements")) return null;
  const posts = systemSettings.announcementPosts || {};
  return (venueId && posts[venueId]) || posts["*"] || null;
}
function renderAnnouncement(venueId) {
  checkEveryonePopup(venueId);
  let el = document.getElementById("niposAnnouncement");
  const a = currentAnnouncement(venueId);
  if (!a) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "niposAnnouncement"; el.className = "nipos-announcement"; el.setAttribute("role", "status");
    const band = document.querySelector(".venue-band:not(.mobile-band)");
    if (band) band.insertAdjacentElement("afterend", el); else document.body.prepend(el);
  }
  el.innerHTML = `${icon("bell")}<span><strong>${esc(a.text)}</strong>${a.by ? ` <span class="by">· ${esc(a.by)}</span>` : ""}</span>`;
}
async function postAnnouncement(venueId, text, style) {
  try {
    const { data, error } = await supabaseClient.rpc("nipos_set_announcement", { p_venue: venueId || null, p_text: text || "", p_style: style === "popup" ? "popup" : "banner" });
    if (error) return "error";
    if (data === "ok") await syncMasterTheme();
    return data;
  } catch (e) { return "error"; }
}

// Urgent "Notify everyone" pop-ups: beep and pop up once on every till, order screen and Backend at
// that venue (not on the sender's own screen). Only for 30 minutes after they're sent, so a till
// opened the next day doesn't pop up yesterday's news.
const POPUP_FRESH_MS = 30 * 60 * 1000;
function checkEveryonePopup(venueId) {
  if (!featureOn("announcements") || !signedInUserId) return;
  const pops = systemSettings.announcementPopups || {};
  const list = [venueId && pops[venueId], pops["*"]].filter(p => p && p.text && Date.now() - (p.ts || 0) < POPUP_FRESH_MS && p.byId !== signedInUserId);
  if (!list.length) return;
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem("nipos.seenPopups") || "[]"); } catch (e) {}
  const next = list.sort((a, b) => b.ts - a.ts).find(p => !seen.includes(p.id || String(p.ts)));
  if (!next) return;
  seen.push(next.id || String(next.ts));
  try { localStorage.setItem("nipos.seenPopups", JSON.stringify(seen.slice(-50))); } catch (e) {}
  if (typeof playChime === "function") { try { playChime(); } catch (e) {} }
  if (navigator.vibrate) { try { navigator.vibrate([300, 150, 300]); } catch (e) {} }
  showPrivateMessage({ fromName: next.by, message: next.text, ts: next.ts, title: `Urgent notice from ${next.by || "the manager"}` });
}

// Who can send what. Notify everyone by banner: Send Announcements or Notify Specific Users.
// By pop-up, and Notify someone: Notify Specific Users. $YSTEM can do all of it.
function notifyAbilities(user) {
  const p = (user && user.perms) || {}, sys = !!(user && user.system);
  const everyone = featureOn("announcements") && (sys || !!p.sendAnnouncements || !!p.notifySpecificUsers);
  return { everyone, popup: everyone && (sys || !!p.notifySpecificUsers), someone: featureOn("privateMessages") && (sys || !!p.notifySpecificUsers), allVenues: sys || !!p.globalAdmin };
}
function canNotify(user) { const a = notifyAbilities(user); return a.everyone || a.someone; }

// The Notify pop-up, shared by the till's menu, the order screen and Backend's menu.
// opts: { user, venue: {id,name}, venues: [{id,name}], fetchStaff: async () => [...], toast: fn }
let notifyOpts = null, notifyTab = "everyone";
function notifyModalEl() {
  let el = document.getElementById("notifyModal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "notifyModal"; el.className = "modal-overlay notify-overlay"; el.hidden = true;
  el.innerHTML = `<div class="modal-card notify-card" role="dialog" aria-modal="true" aria-labelledby="nfyTitle">
    <h3 id="nfyTitle">Notify</h3>
    <div class="nfy-tabs" role="tablist" aria-label="Who to notify">
      <button type="button" role="tab" id="nfyTabEveryone" data-nfy-tab="everyone">Everyone</button>
      <button type="button" role="tab" id="nfyTabSomeone" data-nfy-tab="someone">Someone</button>
    </div>
    <p class="nfy-intro" id="nfyIntro"></p>
    <label class="field" for="nfyWho" id="nfyWhoLabel">Where</label>
    <select id="nfyWho"></select>
    <fieldset class="nfy-how" id="nfyHow"><legend>How</legend>
      <label><input type="radio" name="nfyHow" value="banner" checked> <span><strong>Banner</strong><small>Stays at the top of every screen until it's taken down</small></span></label>
      <label><input type="radio" name="nfyHow" value="popup"> <span><strong>Pop-up</strong><small>Beeps and pops up on every screen. For urgent things.</small></span></label>
    </fieldset>
    <label class="field" for="nfyText">Message</label>
    <textarea id="nfyText" rows="3" maxlength="280"></textarea>
    <p class="send-error nfy-error" id="nfyError" role="alert" hidden></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="nfyCancel" type="button">Cancel</button>
      <button class="btn btn-ghost" id="nfyClear" type="button" hidden>Take the banner down</button>
      <button class="btn btn-accent" id="nfyGo" type="button">Send</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  el.querySelectorAll("[data-nfy-tab]").forEach(b => b.addEventListener("click", () => { notifyTab = b.dataset.nfyTab; renderNotifyModal(); }));
  el.querySelectorAll('input[name="nfyHow"]').forEach(r => r.addEventListener("change", renderNotifyClear));
  el.querySelector("#nfyWho").addEventListener("change", renderNotifyClear);
  el.querySelector("#nfyCancel").addEventListener("click", () => { el.hidden = true; });
  el.addEventListener("keydown", e => { if (e.key === "Escape") el.hidden = true; });
  el.querySelector("#nfyClear").addEventListener("click", () => sendNotify(true));
  el.querySelector("#nfyGo").addEventListener("click", () => sendNotify(false));
  return el;
}
function notifyHow() { const r = document.querySelector('input[name="nfyHow"]:checked'); return r ? r.value : "banner"; }
function renderNotifyClear() {
  const el = notifyModalEl();
  if (notifyTab !== "everyone") { el.querySelector("#nfyClear").hidden = true; return; }
  const key = el.querySelector("#nfyWho").value || "*", up = (systemSettings.announcementPosts || {})[key];
  el.querySelector("#nfyClear").hidden = !(up && notifyHow() === "banner");
  if (notifyHow() === "banner" && up && !el.querySelector("#nfyText").value) el.querySelector("#nfyText").value = up.text;
}
async function renderNotifyModal() {
  const el = notifyModalEl(), o = notifyOpts, a = notifyAbilities(o.user);
  if (notifyTab === "everyone" && !a.everyone) notifyTab = "someone";
  if (notifyTab === "someone" && !a.someone) notifyTab = "everyone";
  el.querySelector(".nfy-tabs").hidden = !(a.everyone && a.someone);
  el.querySelectorAll("[data-nfy-tab]").forEach(b => { const on = b.dataset.nfyTab === notifyTab; b.setAttribute("aria-selected", on ? "true" : "false"); b.classList.toggle("active", on); });
  el.querySelector("#nfyError").hidden = true;
  const who = el.querySelector("#nfyWho");
  if (notifyTab === "everyone") {
    el.querySelector("#nfyTitle").textContent = "Notify everyone";
    el.querySelector("#nfyIntro").textContent = "Everyone signed in to the tills, order screens and Backend sees it.";
    el.querySelector("#nfyWhoLabel").textContent = "Where";
    const venues = (o.venues && o.venues.length ? o.venues : [o.venue]).filter(Boolean);
    who.innerHTML = venues.map(v => `<option value="${esc(v.id)}">${esc(v.name)} only</option>`).join("") + (a.allVenues ? `<option value="">Every venue</option>` : "");
    if (o.venue && venues.some(v => v.id === o.venue.id)) who.value = o.venue.id;
    el.querySelector("#nfyHow").hidden = !a.popup;
    if (!a.popup) el.querySelector('input[name="nfyHow"][value="banner"]').checked = true;
    el.querySelector("#nfyGo").textContent = "Send";
    renderNotifyClear();
  } else {
    el.querySelector("#nfyTitle").textContent = "Notify someone";
    el.querySelector("#nfyIntro").textContent = "Beeps and pops up on their screen, wherever they're signed in.";
    el.querySelector("#nfyWhoLabel").textContent = "Who";
    el.querySelector("#nfyHow").hidden = true;
    el.querySelector("#nfyClear").hidden = true;
    el.querySelector("#nfyGo").textContent = "Send";
    who.innerHTML = `<option value="">Loading…</option>`;
    const staff = ((o.fetchStaff ? await o.fetchStaff() : []) || []).filter(x => x.id !== (o.user && o.user.id) && x.perms && x.perms.active !== false && !x.system).sort((x, y) => String(x.name).localeCompare(String(y.name)));
    if (notifyTab !== "someone") return;
    who.innerHTML = staff.length ? staff.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("") : `<option value="">Nobody else works here yet</option>`;
  }
}
function notifyToast(msg) {
  let el = document.getElementById("nfyToast");
  if (!el) { el = document.createElement("div"); el.id = "nfyToast"; el.className = "nfy-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add("show");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2600);
}
async function openNotifyDialog(opts, tab) {
  notifyOpts = opts;
  if (tab) notifyTab = tab;
  const el = notifyModalEl();
  el.querySelector("#nfyText").value = "";
  el.querySelector('input[name="nfyHow"][value="banner"]').checked = true;
  el.hidden = false;
  await renderNotifyModal();
  el.querySelector("#nfyText").focus();
}
async function sendNotify(takeDown) {
  const el = notifyModalEl(), o = notifyOpts, err = el.querySelector("#nfyError");
  const text = takeDown ? "" : el.querySelector("#nfyText").value.trim(), who = el.querySelector("#nfyWho");
  const fail = m => { err.textContent = m; err.hidden = false; };
  if (!takeDown && !text) return fail("Type a message first.");
  const go = el.querySelector("#nfyGo"); go.disabled = true;
  try {
    if (notifyTab === "everyone") {
      const how = takeDown ? "banner" : notifyHow();
      const res = await postAnnouncement(who.value || null, text, how);
      if (res !== "ok") return fail(res === "no_permission" ? "You don't have permission to do that." : res === "off" ? "Notify everyone is switched off in Master settings." : "Couldn't send that. Try again.");
      el.hidden = true;
      if (o.venue) renderAnnouncement(o.venue.id);
      (o.toast || notifyToast)(takeDown ? "Banner taken down" : how === "popup" ? "Pop-up sent to every screen" : "Banner is up on every screen");
      logActivity(takeDown ? "Took a banner down" : how === "popup" ? "Sent an urgent pop-up to everyone" : "Put a banner up for everyone", text, who.value || null);
    } else {
      if (!who.value) return fail("Pick someone first.");
      await sendPrivateMessage(who.value, o.user, text);
      el.hidden = true;
      (o.toast || notifyToast)("Sent to " + who.selectedOptions[0].textContent);
      logActivity("Sent a private message", "To " + who.selectedOptions[0].textContent);
    }
  } finally { go.disabled = false; }
}

// Private messages (feature "privateMessages"): beep and pop up on the person's screen, wherever
// they're signed in, plus a push notification if they've turned those on.
async function sendPrivateMessage(toUserId, fromUser, text) {
  const notif = { id: "n" + Date.now() + Math.random().toString(36).slice(2, 6), ts: Date.now(), toUserId, fromUserId: fromUser ? fromUser.id : null, fromName: fromUser ? fromUser.name : "Someone", message: text, kind: "message", urgent: true };
  await saveNotification(notif);
  try {
    await fetch(SUPABASE_URL + "/functions/v1/send-push", { method: "POST", headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
      body: JSON.stringify({ toUserId, fromUserId: notif.fromUserId, title: `Message from ${notif.fromName}`, body: text, urgent: true }) });
  } catch (e) {}
  return notif;
}
function showPrivateMessage(n) {
  let el = document.getElementById("privateMessageBox");
  if (!el) {
    el = document.createElement("div");
    el.id = "privateMessageBox"; el.className = "pm-overlay";
    el.setAttribute("role", "alertdialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "pmTitle"); el.setAttribute("aria-describedby", "pmText");
    el.innerHTML = `<div class="pm-card"><h2 id="pmTitle"></h2><p id="pmText"></p><div class="pm-time" id="pmTime"></div><button type="button" class="btn btn-accent btn-block" id="pmOk">Got it</button></div>`;
    document.body.appendChild(el);
    el.querySelector("#pmOk").addEventListener("click", () => { el.hidden = true; });
  }
  el.querySelector("#pmTitle").textContent = n.title || `Message from ${n.fromName || "someone"}`;
  logNotificationReceived(n.title || "Private message", n.message, n.fromName);
  el.querySelector("#pmText").textContent = n.message;
  el.querySelector("#pmTime").textContent = fmtTime(n.ts);
  el.hidden = false;
  el.querySelector("#pmOk").focus();
}

// Manager approval (feature "managerApproval", and opening hours): someone with Manager approval (or a
// Global Admin) types their PIN on this screen to allow it. Resolves to that person, or null.
// staff: the people who can be asked (this venue's staff).
function askManagerApproval(title, why, staff) {
  return new Promise(resolve => {
    let el = document.getElementById("approvalModal");
    if (!el) {
      el = document.createElement("div");
      el.id = "approvalModal"; el.className = "modal-overlay notify-overlay"; el.hidden = true; el.dataset.noLog = "";
      el.innerHTML = `<div class="modal-card notify-card" role="dialog" aria-modal="true" aria-labelledby="apTitle" data-no-log><h3 id="apTitle"></h3><p class="nfy-intro" id="apWhy"></p>
        <label class="field" for="apPin">Manager's PIN</label><input type="password" id="apPin" inputmode="numeric" autocomplete="off" data-no-log>
        <p class="send-error nfy-error" id="apErr" role="alert" hidden></p>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" id="apCancel">Cancel</button><button type="button" class="btn btn-accent" id="apOk">Allow it</button></div></div>`;
      document.body.appendChild(el);
    }
    const pin = el.querySelector("#apPin"), err = el.querySelector("#apErr");
    el.querySelector("#apTitle").textContent = title || "Needs a manager";
    el.querySelector("#apWhy").textContent = why || "";
    pin.value = ""; err.hidden = true;
    const done = v => { el.hidden = true; el.querySelector("#apOk").onclick = el.querySelector("#apCancel").onclick = null; pin.onkeydown = null; resolve(v); };
    // The PIN is checked by the database (nipos_check_approval_pin): staff can't read anyone's PIN.
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true; err.hidden = true;
      let res = null;
      try { const r = await supabaseClient.rpc("nipos_check_approval_pin", { p_pin: pin.value.trim(), p_venue: currentVenueId }); res = r.error ? { error: "offline" } : r.data; } catch (e) { res = { error: "offline" }; }
      checking = false;
      const who = res && res.id ? { id: res.id, name: res.name } : null;
      if (!who) {
        err.textContent = res && res.error === "locked" ? "Too many wrong PINs. Wait 5 minutes and try again." : res && res.error === "offline" ? "Couldn't check the PIN. Check the connection and try again." : "That PIN isn't a manager's. Try again.";
        err.hidden = false; pin.select(); return;
      }
      logActivity("Manager approved", `${title}${why ? ": " + why : ""} (by ${who.name})`);
      done(who);
    };
    el.querySelector("#apOk").onclick = check;
    el.querySelector("#apCancel").onclick = () => done(null);
    pin.onkeydown = e => { if (e.key === "Enter") check(); if (e.key === "Escape") done(null); };
    el.hidden = false; pin.focus();
  });
}
async function fetchStaffForVenue(venueId) {
  if (!supabaseClient || !venueId) return [];
  try { const { data } = await supabaseClient.from("staff_users").select("id,data"); return (data || []).map(r => ({ id: r.id, ...r.data })).filter(u => (u.venueIds || []).includes(venueId) || (u.perms && u.perms.globalAdmin && !u.system)); } catch (e) { return []; }
}
function approvalRules() { return featureOn("managerApproval") ? featureConfig("managerApproval") : null; }

// Editable reasons (feature "reasons"): Report a problem, refund and void reasons.
const DEFAULT_REASONS = { problem: ["Out of stock", "Wrong item", "Damaged/spilled", "Other"], refund: ["Customer didn't like it", "Wrong item", "Took too long", "Spilled", "Other"], void: ["Customer changed their mind", "Rung up by mistake", "Customer left", "Other"] };
function reasonList(kind) { const c = featureOn("reasons") ? (featureConfig("reasons")[kind] || []) : []; return c.length ? c : DEFAULT_REASONS[kind]; }
function askReason(title, kind) {
  return new Promise(resolve => {
    let el = document.getElementById("reasonModal");
    if (!el) {
      el = document.createElement("div");
      el.id = "reasonModal"; el.className = "modal-overlay notify-overlay"; el.hidden = true;
      el.innerHTML = `<div class="modal-card notify-card" role="dialog" aria-modal="true" aria-labelledby="rsTitle"><h3 id="rsTitle"></h3><div class="su-choices" id="rsList" role="group" aria-label="Reasons"></div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" id="rsCancel">Cancel</button></div></div>`;
      document.body.appendChild(el);
    }
    el.querySelector("#rsTitle").textContent = title;
    el.querySelector("#rsList").innerHTML = reasonList(kind).map(r => `<button type="button" class="btn btn-ghost btn-block" data-reason="${esc(r)}">${esc(r)}</button>`).join("");
    const done = v => { el.hidden = true; resolve(v); };
    el.querySelectorAll("[data-reason]").forEach(b => { b.onclick = () => done(b.dataset.reason); });
    el.querySelector("#rsCancel").onclick = () => done(null);
    el.onkeydown = e => { if (e.key === "Escape") done(null); };
    el.hidden = false; el.querySelector("[data-reason]").focus();
  });
}

// Opening hours (feature "openingHours"): per venue, per day. Outside them, taking an order needs a
// manager. A day's close earlier than its open runs past midnight.
function openingHoursFor(venueId) { const c = featureOn("openingHours") ? featureConfig("openingHours") : null; return c && c.venues ? c.venues[venueId] || null : null; }
function isOpenNow(venueId, at) {
  const hours = openingHoursFor(venueId);
  if (!hours) return true;
  const d = new Date(at || Date.now()), mins = d.getHours() * 60 + d.getMinutes();
  const toM = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const day = hours[d.getDay()], prev = hours[(d.getDay() + 6) % 7];
  if (prev && !prev.closed && toM(prev.close) <= toM(prev.open) && mins < toM(prev.close)) return true; // yesterday's late night
  if (!day || day.closed) return false;
  const o = toM(day.open), c = toM(day.close);
  return c > o ? mins >= o && mins < c : mins >= o;
}

// Session timeouts by role (feature "sessionTimeouts"): signs someone out after this many minutes
// without touching the screen. Managers (Backend access or Global Admin) and everyone else separately.
let lastActivityAt = Date.now(), idleTimer = null;
["pointerdown", "keydown", "touchstart"].forEach(e => document.addEventListener(e, () => { lastActivityAt = Date.now(); }, { passive: true, capture: true }));
function idleLimitMinutes(user) {
  if (!featureOn("sessionTimeouts") || !user || user.system) return 0;
  const c = featureConfig("sessionTimeouts"), manager = user.perms && (user.perms.globalAdmin || user.perms.backendAccess);
  return Number(manager ? c.managerMinutes : c.staffMinutes) || 0;
}
function startIdleWatch(getUser, onTimeout) {
  clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    const user = getUser(), limit = idleLimitMinutes(user);
    if (!limit || !user) return;
    if (Date.now() - lastActivityAt > limit * 60000) { lastActivityAt = Date.now(); logActivity("Signed out for being idle", `${limit} minutes`); onTimeout(); }
  }, 20000);
}

// Alert settings (feature "alertSettings"): per event, on or off, who gets it (a permission) and the
// sound. Events: newOrder, problem, serviceCall, refund.
const ALERT_EVENTS = [["newOrder", "New order (order screen)"], ["problem", "Problem reported"], ["serviceCall", "Call for service"], ["refund", "Refund requested"]];
function alertRule(event) { return featureOn("alertSettings") ? ((featureConfig("alertSettings").events || {})[event] || {}) : {}; }
function alertAllowed(event, user) {
  const r = alertRule(event);
  if (r.on === false) return false;
  if (r.perm && !(user && user.perms && (user.perms[r.perm] || user.perms.globalAdmin))) return false;
  return true;
}
function alertSound(event, user) { const r = alertRule(event); return r.sound || (user && user.notificationSound) || null; }

// Device health (feature "deviceHealth"): every page reports in once a minute.
const NIPOS_VERSION = "20261022n";
function deviceId() {
  let id = null; try { id = localStorage.getItem("nipos.deviceId"); } catch (e) {}
  if (!id) { id = "dev" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); try { localStorage.setItem("nipos.deviceId", id); } catch (e) {} }
  return id;
}
let deviceTimer = null;
function startDeviceReports(getInfo) {
  const send = async () => {
    if (!featureOn("deviceHealth") || !supabaseClient || !signedInUserId) return;
    const info = getInfo() || {}, ua = navigator.userAgent;
    const kind = /iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document) ? "Tablet" : /iPhone|Android.*Mobile/i.test(ua) ? "Phone" : "Computer";
    try { await supabaseClient.from("devices").upsert({ id: deviceId(), ts: Date.now(), venue_id: currentVenueId || null, data: { who: signedInUserName || "", userId: signedInUserId, screen: activityScreenName(), venue: info.venue || "", version: NIPOS_VERSION, kind, waiting: outbox.length, waitingSales: outbox.filter(o => o.table === "sales").length, browser: /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser", standalone: !!(window.matchMedia && matchMedia("(display-mode: standalone)").matches) || !!navigator.standalone, online: navigator.onLine } }); } catch (e) {}
  };
  clearInterval(deviceTimer); deviceTimer = setInterval(send, 15000); setTimeout(send, 3000);
  startCommandWatch();
}
// Backend can refresh or sign out one device, or sign one person out everywhere (device_commands);
// and if someone's account is switched off (or deleted) while they're signed in, they're signed out.
const handledCommands = new Set(), commandsSince = Date.now();
let commandTimer = null, accountChecks = 0;
function startCommandWatch() {
  if (commandTimer) return;
  commandTimer = setInterval(async () => {
    if (!supabaseClient || !signedInUserId || document.visibilityState === "hidden") return;
    try {
      const { data } = await supabaseClient.from("device_commands").select("id,ts,target_type,target_id,action")
        .gt("ts", commandsSince).or(`and(target_type.eq.device,target_id.eq.${deviceId()}),and(target_type.eq.user,target_id.eq.${signedInUserId})`).order("ts");
      for (const c of data || []) {
        if (handledCommands.has(c.id)) continue;
        handledCommands.add(c.id);
        const fn = remoteHandlers[c.action];
        if (fn) { if (c.action === "signout") notifyToast("You were signed out from Backend."); fn(); }
      }
    } catch (e) {}
    if (++accountChecks % 3 === 0) { // every 15 seconds
      try {
        const { data, error } = await supabaseClient.from("staff_users").select("data").eq("id", signedInUserId).maybeSingle();
        if (!error && (!data || (data.data && data.data.perms && data.data.perms.active === false)) && remoteHandlers.signout) {
          notifyToast("This account has been switched off, so it was signed out.");
          remoteHandlers.signout();
        }
      } catch (e) {}
    }
  }, 5000);
}
// Before a Z Read: tills at this venue (this one included) with sales still waiting to save. Those
// sales aren't in the database yet, so they'd be missing from the Z Read.
async function salesWaitingAt(venueId) {
  const out = [], mine = outbox.filter(o => o.table === "sales" && o.rec.venue_id === venueId).length;
  if (mine) out.push(`This device: ${mine} sale${mine === 1 ? "" : "s"}`);
  try {
    const { data } = await supabaseClient.from("devices").select("id,ts,venue_id,data").eq("venue_id", venueId).gt("ts", Date.now() - 6 * 3600000);
    (data || []).forEach(r => { const n = Number(r.data && r.data.waitingSales) || 0; if (n && r.id !== deviceId()) out.push(`${r.data.screen || "Till"}${r.data.who ? " (" + r.data.who + ")" : ""}: ${n} sale${n === 1 ? "" : "s"}${Date.now() - r.ts > 45000 ? ", offline since " + fmtTime(r.ts) : ""}`); });
  } catch (e) {}
  return out;
}
async function sendDeviceCommand(targetType, targetId, action) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient.from("device_commands").insert({ id: "cmd" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), target_type: targetType, target_id: targetId, action, data: { by: signedInUserName || "" } });
    return !error;
  } catch (e) { return false; }
}

// Allergen and diet tags (feature "dietTags"): the tags items can have; "filter" ones get a till filter.
const DEFAULT_DIET_TAGS = [{ code: "V", name: "Vegetarian", filter: true }, { code: "VG", name: "Vegan", filter: true }, { code: "GF", name: "Gluten free", filter: true }, { code: "DF", name: "Dairy free", filter: true }, { code: "N", name: "Contains nuts", filter: false }];
function dietTagList() { return (featureConfig("dietTags").tags || DEFAULT_DIET_TAGS).filter(t => t && t.code); }

// Scheduled stops (feature "scheduledStops"): a stop can have an end time (row.until), after which
// the item is back on sale everywhere by itself. Putting something on stop asks how long for.
function stopActive(row) { return !row || !row.until || row.until > Date.now(); }
function nextTimeOfDay(hhmm) {
  const [h, m] = String(hhmm || "23:59").split(":").map(Number), d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}
// Resolves to: null = no end, a timestamp = until then, false = cancelled. Without the feature it's null.
function askStopUntil(what) {
  if (!featureOn("scheduledStops")) return Promise.resolve(null);
  const close = featureConfig("scheduledStops").closeTime || "02:00";
  return new Promise(resolve => {
    let el = document.getElementById("stopUntilModal");
    if (!el) {
      el = document.createElement("div");
      el.id = "stopUntilModal"; el.className = "modal-overlay notify-overlay"; el.hidden = true;
      el.innerHTML = `<div class="modal-card notify-card" role="dialog" aria-modal="true" aria-labelledby="suTitle"><h3 id="suTitle">How long for?</h3><p class="nfy-intro" id="suWhat"></p>
        <div class="su-choices" role="group" aria-label="How long">
          <button type="button" class="btn btn-ghost btn-block" data-su="none">Until someone puts it back</button>
          <button type="button" class="btn btn-ghost btn-block" data-su="60">For 1 hour</button>
          <button type="button" class="btn btn-ghost btn-block" data-su="120">For 2 hours</button>
          <button type="button" class="btn btn-ghost btn-block" data-su="close"></button>
        </div>
        <label class="field" for="suTime">Or until a set time</label>
        <div style="display:flex;gap:8px;"><input type="time" id="suTime" style="flex:1;min-height:44px;"><button type="button" class="btn btn-solid" data-su="time">Set</button></div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-su="cancel">Cancel</button></div></div>`;
      document.body.appendChild(el);
    }
    el.querySelector("#suWhat").textContent = `${what} goes on stop. It comes back on sale by itself at the time you pick.`;
    el.querySelector('[data-su="close"]').textContent = `Until closing (${close})`;
    const done = v => { el.hidden = true; el.querySelectorAll("[data-su]").forEach(b => { b.onclick = null; }); resolve(v); };
    el.querySelectorAll("[data-su]").forEach(b => { b.onclick = () => {
      const k = b.dataset.su;
      if (k === "cancel") return done(false);
      if (k === "none") return done(null);
      if (k === "close") return done(nextTimeOfDay(close));
      if (k === "time") { const t = el.querySelector("#suTime").value; if (!t) { el.querySelector("#suTime").focus(); return; } return done(nextTimeOfDay(t)); }
      done(Date.now() + Number(k) * 60000);
    }; });
    el.onkeydown = e => { if (e.key === "Escape") done(false); };
    el.hidden = false;
    el.querySelector('[data-su="none"]').focus();
  });
}
function untilText(ts) { if (!ts) return ""; const d = new Date(ts), today = new Date().toDateString() === d.toDateString(); return `until ${today ? "" : d.toLocaleDateString("en-GB", { weekday: "short" }) + " "}${fmtTime(ts)}`; }

// Call for service: pops up on the person's screen with the beep (and still sends the push
// notification, which the sender's page does). Older calls without a kind are spotted by their text.
function isServiceCall(n) { return n && (n.kind === "service" || (n.urgent && n.message === "needs you at the bar")); }
function showServiceCall(n, sound) {
  if (sound && typeof playNotificationSound === "function" && typeof audioCtx !== "undefined") { try { playNotificationSound(audioCtx, sound); } catch (e) {} }
  else if (typeof playChime === "function") { try { playChime(); } catch (e) {} }
  if (navigator.vibrate) { try { navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {} }
  if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
    try { new Notification("Service call", { body: `${n.fromName || "Someone"} needs you at the bar`, requireInteraction: true, tag: "service-" + n.id }); } catch (e) {}
  }
  showPrivateMessage({ ...n, title: "Service call", message: `${n.fromName || "Someone"} needs you at the bar` });
}

// Refresh or sign out tills (feature "remote"): $YSTEM adds a command and every till, order screen and
// Backend runs each new one once. A refresh only counts while the page is open; a sign-out counts for
// anyone who signed in before it was sent - so a till that was closed or asleep at the time still
// signs out the moment it comes back.
const remoteHandlers = {};
function onRemoteCommand(action, fn) { remoteHandlers[action] = fn; }
const pageOpenedAt = Date.now();
function runRemoteCommands(venueId) {
  if (!featureOn("remote")) return;
  let done = [];
  try { done = JSON.parse(sessionStorage.getItem("nipos.remoteDone") || "[]"); } catch (e) {}
  (featureConfig("remote").commands || []).forEach(c => {
    if (!c || done.includes(c.id)) return;
    if (c.action === "signout" ? c.ts < signedInAt() : c.ts < pageOpenedAt - 5000) return;
    if (c.venueId && c.venueId !== venueId) return;
    // A handler returns false when it can't act yet (e.g. the page hasn't worked out who's signed in);
    // the command is then tried again next time instead of being marked done.
    if (!remoteHandlers[c.action] || remoteHandlers[c.action](c) === false) return;
    done.push(c.id);
    try { sessionStorage.setItem("nipos.remoteDone", JSON.stringify(done.slice(-50))); } catch (e) {}
  });
}

// Activity log (feature "activityLog"): who did what, and when. $YSTEM and staff with View Activity
// Logs can read it. Nothing is written while the feature is off. Each entry gets a type, used by the
// filters in Backend.
const ACTIVITY_TYPES = [
  { key: "signin", name: "Signing in and out" },
  { key: "money", name: "Sales and money", hint: "Discounts given, walk-outs, cleared orders, tips, Z Reads, removed sales" },
  { key: "refund", name: "Refunds" },
  { key: "orders", name: "Orders", hint: "Accepted, delivered, problems, service calls" },
  { key: "stops", name: "Stops" },
  { key: "menu", name: "Products and categories" },
  { key: "deals", name: "Discounts and deals" },
  { key: "staff", name: "Staff" },
  { key: "venues", name: "Venues and settings" },
  { key: "messages", name: "Notify and messages" },
  { key: "master", name: "Master settings" },
  { key: "taps", name: "Every button pressed", hint: "Every button, tile, tab, menu, tick box and drop-down" },
  { key: "notifications", name: "Notifications received" },
  { key: "other", name: "Everything else" }
];
function activityType(action) {
  const a = String(action || "").toLowerCase();
  if (/^signed (in|out)/.test(a)) return "signin";
  if (/refund/.test(a)) return "refund";
  if (/stop|back on sale/.test(a)) return "stops";
  if (/master settings|master theme|till layout|removed sales|exported data/.test(a)) return /removed sales/.test(a) ? "money" : "master";
  if (/discount given|without paying|cleared an order|tip|gratuity|z read|x read|end of shift/.test(a)) return "money";
  if (/deal|offer|discount/.test(a)) return "deals";
  if (/accepted|delivered|problem|service|order/.test(a)) return "orders";
  if (/product|category|categories|catalogue|mixer/.test(a)) return "menu";
  if (/staff/.test(a)) return "staff";
  if (/venue|settings|test data/.test(a)) return "venues";
  if (/banner|pop-up|message/.test(a)) return "messages";
  return "other";
}
function activityScreenName(page) {
  const p = page || location.pathname.split("/").pop() || "index.html";
  return /orders/.test(p) ? "Order screen" : /backend/.test(p) ? "Backend" : "Till";
}
// Entries are queued and sent together every few seconds (one request, not one per tap). Anything
// that has to land before the person is signed out (signing out itself) passes now = true.
let activityQueue = [], activityFlushing = null;
// Backend works across the whole site, so its entries belong to "NIPOS Backend", not a venue; the venue
// a Backend change was for (if just one) is kept alongside as data.venueId.
function activityRow(action, detail, venueId, type) {
  const ts = Date.now(), page = location.pathname.split("/").pop() || "index.html", backend = /backend/.test(page);
  const venue = venueId === undefined ? (currentVenueId || null) : venueId;
  const data = { action, type: type || activityType(action), detail: String(detail || "").slice(0, 300), by: signedInUserName || "", page };
  if (backend && venue && type !== "taps") data.venueId = venue;
  return { id: "a" + ts + Math.random().toString(36).slice(2, 8), ts, venue_id: backend ? null : venue, user_id: signedInUserId, data };
}
// If a send got through but its reply was lost, the resend fails as a duplicate; then the rows are
// sent one at a time and the ones already saved are skipped, instead of jamming the queue. Rows can only be
// saved by the account that's signed in; if this browser's sign-in changed under this screen (another
// tab signed in as someone else), rows in the old name can never save, so they're dropped and the
// screen says so instead of retrying them for ever.
async function flushActivity() {
  if (activityFlushing) await activityFlushing;
  if (!activityQueue.length || !supabaseClient) return;
  const batch = activityQueue.splice(0, 200);
  let failed = false;
  activityFlushing = (async () => {
    let error = null;
    try { ({ error } = await supabaseClient.from("activity_log").insert(batch)); } catch (e) { error = e; }
    if (error && error.code === "23505") {
      const left = [];
      for (const r of batch) {
        let e1 = null; try { ({ error: e1 } = await supabaseClient.from("activity_log").insert([r])); } catch (e) { e1 = e; }
        if (e1 && e1.code !== "23505") left.push(r);
      }
      if (!left.length) return;
      batch.length = 0; batch.push(...left); error = { code: "retry" };
    }
    if (!error) return;
    failed = true;
    let keep = batch.filter(r => r.user_id === signedInUserId);
    if (error.code === "42501") {
      let uid = null; try { const { data } = await supabaseClient.auth.getSession(); uid = data && data.session ? data.session.user.id : null; } catch (e) {}
      keep = keep.filter(r => r.user_id === uid);
      if (uid !== signedInUserId) showSessionMismatch();
    }
    if (activityQueue.length < 2000) activityQueue.unshift(...keep);
  })();
  await activityFlushing; activityFlushing = null;
  if (!failed && activityQueue.length) return flushActivity(); // after a failure the 3-second timer tries again
}
function showSessionMismatch() {
  if (typeof document === "undefined" || !document.body || document.getElementById("sessionNote")) return;
  const el = document.createElement("div"); el.id = "sessionNote"; el.className = "outbox-note"; el.setAttribute("role", "alert");
  el.textContent = "Someone signed in as a different person in another tab of this browser. Reload this screen and sign in again. Use a separate browser or device for each screen.";
  document.body.appendChild(el);
}
async function logActivity(action, detail, venueId, now) {
  if (!featureOn("activityLog") || !supabaseClient || !signedInUserId) return;
  activityQueue.push(activityRow(action, detail, venueId));
  if (now) await flushActivity();
}
setInterval(() => { if (activityQueue.length) flushActivity(); }, 3000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushActivity(); });

// Full logs (Activity log option "Every tap", on unless $YSTEM turns it off): every button, tile, tab,
// menu item, tick box and drop-down someone presses, with where it was. PIN pads, sign-in screens and
// password boxes are never logged, and nothing anyone types is.
function fullActivityLogging() { return featureOn("activityLog") && featureConfig("activityLog").everyTap !== false; }
function tapLabel(el) {
  const clean = t => String(t || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (el.matches("input[type=checkbox],input[type=radio]")) {
    const lab = el.closest("label") || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
    return `${clean(lab ? lab.textContent : el.getAttribute("aria-label") || el.name || el.id)} ${el.checked ? "(ticked)" : "(unticked)"}`;
  }
  if (el.tagName === "SELECT") {
    const lab = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    return `${clean(lab ? lab.textContent : el.getAttribute("aria-label") || el.id)}: ${clean(el.selectedOptions[0] ? el.selectedOptions[0].textContent : el.value)}`;
  }
  return clean(el.getAttribute("aria-label")) || clean(el.textContent) || clean(el.title) || el.id || el.className || "button";
}
function tapWhere(el) {
  const box = el.closest("[role=dialog],[role=alertdialog],.modal-card,.sheet,.drawer,.pm-card,.page.active,.pos-menu,header,.sidebar,.cartbar");
  if (!box) return "";
  const h = box.querySelector("h1,h2,h3,legend");
  const name = h ? h.textContent.replace(/\s+/g, " ").trim().slice(0, 50) : box.id || "";
  return name;
}
function tapIsPrivate(el) {
  return !!el.closest("#loginGate,#systemGate,#lockedScreen,[data-no-log]") || el.matches("input[type=password]");
}
function logTap(el, verb) {
  if (!fullActivityLogging() || !signedInUserId || tapIsPrivate(el)) return;
  const where = tapWhere(el), label = tapLabel(el);
  if (!label) return;
  activityQueue.push(activityRow(verb || "Pressed", where && where !== label ? `${label} · ${where}` : label, undefined, "taps"));
}
document.addEventListener("click", e => {
  const el = e.target.closest && e.target.closest("button,a[href],[role=button],[role=tab],[role=menuitem],summary,input[type=checkbox],input[type=radio],.pm-tile,.pm-rowi,.pm-dtile");
  if (!el || el.disabled) return;
  if (el.matches("input[type=checkbox],input[type=radio]")) return; // logged on change, with the new state
  logTap(el);
}, true);
document.addEventListener("change", e => {
  const el = e.target;
  if (el && el.matches && el.matches("input[type=checkbox],input[type=radio],select")) logTap(el, el.tagName === "SELECT" ? "Picked" : "Ticked");
}, true);
// Notifications and pop-ups someone gets, logged against them.
function logNotificationReceived(kind, text, from) {
  if (!fullActivityLogging() || !signedInUserId) return;
  activityQueue.push(activityRow("Got a notification", `${kind}${from ? " from " + from : ""}: ${text || ""}`, undefined, "notifications"));
}

// Every page follows the master theme, till layout and Master settings: read on load, every 15
// seconds, and whenever the tab comes back.
async function syncMasterTheme() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from("system_theme").select("theme,layout,settings").eq("id", "current").maybeSingle();
    if (error || !data) return;
    if (data.theme) setMasterThemeLocal(data.theme);
    if (data.layout) setPosLayoutLocal(data.layout);
    const next = data.settings || {};
    if (JSON.stringify(next) !== JSON.stringify(systemSettings)) {
      systemSettings = next;
      applyTheme(); refreshEffectiveLayout(); renderMaintenanceWatermark();
      if (featureOn("maintenance")) maintenanceMode = true;
      try { document.dispatchEvent(new CustomEvent("nipos:settingschange")); } catch (e) {}
    }
    runRemoteCommands(currentVenueId);
  } catch (e) {}
}
// Login screen branding (feature "loginBranding"): a logo, the app name and a short message on every
// sign-in screen. Kept on the device too, so it shows before the settings have loaded.
function applyLoginBranding() {
  let b = null;
  try {
    if (typeof systemSettings !== "undefined" && systemSettings && Object.keys(systemSettings).length) {
      b = systemSettings.loginBranding && systemSettings.loginBranding.enabled ? systemSettings.loginBranding : null;
      localStorage.setItem("nipos.loginBranding", JSON.stringify(b));
    } else b = JSON.parse(localStorage.getItem("nipos.loginBranding") || "null");
  } catch (e) {}
  document.querySelectorAll("#loginGate .login-card").forEach(card => {
    let el = card.querySelector(".login-brand");
    if (!b) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.className = "login-brand"; card.prepend(el); }
    el.innerHTML = `${b.logo ? `<img src="${esc(b.logo)}" alt="">` : ""}${b.appName ? `<div class="lb-name">${esc(b.appName)}</div>` : ""}${b.message ? `<p class="lb-msg">${esc(b.message)}</p>` : ""}`;
  });
}
try { document.addEventListener("DOMContentLoaded", applyLoginBranding); document.addEventListener("nipos:settingschange", applyLoginBranding); } catch (e) {}
let masterThemeTimer = null;
function startMasterThemeSync() {
  if (masterThemeTimer) return;
  syncMasterTheme();
  masterThemeTimer = setInterval(syncMasterTheme, 15000);
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
function maintenanceModeOn() { return maintenanceMode || featureOn("maintenance"); }

// Each venue configures its own Discord webhooks in Backend (Venues section), no more one hardcoded
// channel for every site. Silently no-ops if the current venue hasn't set one, or Maintenance Mode
// is on (so testing never pages real staff or spams a real channel).
// Discord settings (feature "discordSettings"): which events go to Discord. kind: orders | refunds | stops | zreads.
function discordOn(kind) { return !kind || !featureOn("discordSettings") || (featureConfig("discordSettings").events || {})[kind] !== false; }
// Posts without a file go through the database queue (discord_queue + the discord-relay function), which
// sends them in order, batched and paced, and retries, so a busy night with many tills doesn't lose any.
// If the queue can't be reached, the till posts directly as before.
let discordNudgeAt = 0;
async function postDiscordEmbed(webhook, embed, file, kind){
  if (!webhook || maintenanceMode || !discordOn(kind)) return;
  if (!file && supabaseClient) {
    let queued = false;
    try { const { error } = await supabaseClient.from("discord_queue").insert({ id: "dq" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), ts: Date.now(), webhook, embed }); queued = !error; } catch (e) {}
    if (queued) {
      if (Date.now() - discordNudgeAt > 3000) { discordNudgeAt = Date.now(); try { supabaseClient.functions.invoke("discord-relay", { body: {} }).catch(() => {}); } catch (e) {} }
      return;
    }
  }
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
// Master settings > Report header details: venue name, address and contact details on Z Reads and
// shift reports, and a footer line.
function reportHeaderFor(venueId) {
  if (!featureOn("reportHeader")) return null;
  const h = (featureConfig("reportHeader").venues || {})[venueId];
  return h && (h.name || h.address || h.phone || h.email || h.footer) ? h : null;
}
function reportHeaderHTML(venueId) {
  const h = reportHeaderFor(venueId);
  if (!h || !(h.name || h.address || h.phone || h.email)) return "";
  return `<div class="rh">${h.name ? `<strong>${esc(h.name)}</strong><br>` : ""}${h.address ? esc(h.address).replace(/\n/g, "<br>") + "<br>" : ""}${[h.phone, h.email].filter(Boolean).map(esc).join(" · ")}</div>`;
}
function reportFooterHTML(venueId) { const h = reportHeaderFor(venueId); return h && h.footer ? `<div class="rf">${esc(h.footer)}</div>` : ""; }

// Master settings > Bigger text: scales the till and order screen up, for everyone or just some
// venues / people.
function applyBigText(user, venueId) {
  const cfg = featureOn("bigText") ? featureConfig("bigText") : null;
  const venues = (cfg && cfg.venueIds) || [], people = (cfg && cfg.userIds) || [];
  const on = !!cfg && ((!venues.length && !people.length) || (venueId && venues.includes(venueId)) || (user && people.includes(user.id)));
  const scale = on ? Math.min(1.6, Math.max(1.05, Number(cfg.scale) || 1.2)) : 1;
  document.documentElement.style.zoom = scale === 1 ? "" : String(scale);
}

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
    .rh{border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:16px;font-size:13px;line-height:1.5;}
    .rh strong{font-size:16px;}
    .rf{margin-top:24px;color:#444;font-size:12.5px;text-align:center;}
  </style></head><body>${reportHeaderHTML(currentVenueId)}<h1>${title}</h1><p class="sub">${subtitle}</p><table>${rowsHtml}</table>${txnHtml}${reportFooterHTML(currentVenueId)}</body></html>`;
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
    }, { blob: new Blob([reportHtml], { type: "text/html" }), name: `z-read-${closedAt}.html` }, "zreads");
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
// Before a refund: the reason (feature "reasons") and, over the limit, a manager (feature
// "managerApproval"). Resolves to { reason, approvedBy } or null if someone cancelled.
async function refundPreChecks(pence, venueId) {
  let reason = null, approvedBy = null;
  if (featureOn("reasons")) { reason = await askReason("Why the refund?", "refund"); if (!reason) return null; }
  const rules = approvalRules(), limit = rules ? Math.round(Number(rules.refundOver) * 100) : 0;
  if (limit > 0 && pence > limit) {
    const who = await askManagerApproval("Big refund", `${poundsText(pence)} is over the ${poundsText(limit)} limit.`, await fetchStaffForVenue(venueId || currentVenueId));
    if (!who) return null;
    approvedBy = who.name;
  }
  return { reason, approvedBy };
}
async function refundSaleLine(saleId, itemIdx, extra) {
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
  if (signedInUserId) { refundRow.byId = signedInUserId; refundRow.by = signedInUserName || null; } // takings per person
  if (extra && extra.reason) refundRow.reason = extra.reason;
  if (extra && extra.approvedBy) refundRow.approvedBy = extra.approvedBy;
  if (maintenanceMode) refundRow.isTest = true;
  await refundsTable.save(refundRow);
  logActivity("Refund", `${item.qty}× ${item.name}, ${poundsText(refundRow.pence)} by ${refundRow.method}${fresh.table ? ", table " + fresh.table : ""}${refundRow.reason ? ", reason: " + refundRow.reason : ""}${refundRow.approvedBy ? ", approved by " + refundRow.approvedBy : ""}`);
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
  }, null, "refunds");
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- Kitchen screen (feature "kitchenScreen"): the bar (orders.html) and the kitchen (/kitchen) each
// accept and finish their own part of an order: drinks at the bar, food in the kitchen. The order as a
// whole is only "ready to take out" once every part it has is ready, so the bar finishing the drinks
// never clears the food off the kitchen's screen (or the other way round). Each part keeps its own
// barAccepted / barReady / kitchenAccepted / kitchenReady; the till's Open Orders can still finish the
// whole order in one go.
const STATION_NAMES = { bar: "Drinks", kitchen: "Food" };
function lineIsFood(line, isFood) { return typeof line.food === "boolean" ? line.food : !!(isFood && isFood(line.name)); }
function orderStations(o, isFood) {
  const items = (o && o.items) || [], s = [];
  if (items.some(i => !lineIsFood(i, isFood))) s.push("bar");
  if (items.some(i => lineIsFood(i, isFood))) s.push("kitchen");
  return s.length ? s : ["bar"];
}
// Orders accepted or finished before the bar and kitchen were split fall back to the whole order.
function stationAccepted(o, st) { return !!o[st + "Accepted"] || !!o[st + "Ready"] || !!o.ready || (!o.stationsUsed && !!o.accepted); }
function stationReady(o, st) { return !!o[st + "Ready"] || !!o.ready; }
function stationStageText(o, st) { return stationReady(o, st) ? "ready" : stationAccepted(o, st) ? "in progress" : "not started"; }
// The order as one part sees it, for orderStage() and buildOrderCard().
function orderForStation(o, st) {
  return { ...o, accepted: stationAccepted(o, st), ready: stationReady(o, st), acceptedBy: o[st + "AcceptedBy"] || (o.stationsUsed ? null : o.acceptedBy) };
}
// "Drinks: ready · Food: in progress", for the parts other than `except` (all of them on the till).
function stationsNote(o, stations, except) {
  if (stations.length < 2 || o.ready) return "";
  return stations.filter(s => s !== except).map(s => `${STATION_NAMES[s]}: ${stationStageText(o, s)}`).join(" · ");
}
async function markStation(o, st, what, stations, byName) {
  const now = Date.now(), patch = { stationsUsed: true, [st + what]: true };
  if (!o.stationsUsed && o.accepted) stations.forEach(s => { patch[s + "Accepted"] = true; });
  if (what === "Accepted") Object.assign(patch, { [st + "AcceptedBy"]: byName || null, [st + "AcceptedAt"]: now, accepted: true, acceptedBy: o.acceptedBy || byName || null, acceptedAt: o.acceptedAt || now });
  else { patch[st + "Accepted"] = true; patch[st + "ReadyAt"] = now; }
  let fresh = await mergeOpenOrder(o.id, patch);
  // Both parts can finish at the same moment, so it's the merged row that decides.
  if (fresh && what === "Ready" && !fresh.ready && stations.every(s => stationReady(fresh, s))) fresh = (await mergeOpenOrder(o.id, { ready: true })) || fresh;
  return fresh;
}
// Self-healing: if a reply was lost, an order can end up with every part ready but not itself marked
// ready, and then no screen would offer to finish it. Any till or screen that sees one fixes it.
const healedOrders = new Map();
function healReadyOrders(list, isFood) {
  if (!featureOn("kitchenScreen") || !Array.isArray(list)) return;
  list.forEach(o => {
    if (!o || o.ready || o.delivered || !o.stationsUsed || Date.now() - (healedOrders.get(o.id) || 0) < 30000) return;
    if (!orderStations(o, isFood).every(s => stationReady(o, s))) return;
    healedOrders.set(o.id, Date.now());
    mergeOpenOrder(o.id, { ready: true });
  });
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
// Master settings > Late-order warning: an order still new or in progress after this many minutes
// gets a "Late" badge and moves up, just under problems.
function lateAfterMinutes() { if (!featureOn("lateOrders")) return null; const m = Number(featureConfig("lateOrders").minutes); return m > 0 ? m : 10; }
function orderIsLate(o) {
  const m = lateAfterMinutes(), st = orderStage(o);
  return !!m && (st === "new" || st === "progress") && Date.now() - o.ts > m * 60000;
}
function sortOrdersByPriority(list) {
  const rank = o => orderIsLate(o) ? 0.5 : ({ refund: 0, refunding: 0, problem: 0, ready: 1, new: 2, progress: 3 })[orderStage(o)];
  return list.slice().sort((a, b) => (rank(a) - rank(b)) || (a.ts - b.ts));
}
function orderLabel(o) { return o.table ? "Table " + o.table : "No table"; }
function poundsText(pence) { const neg = pence < 0; return (neg ? "-" : "") + moneySymbol() + (Math.abs(pence) / 100).toFixed(2); }
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
// onReady, onDeliver, onFlag, onAccept (customer took the substitute), onRequestRefund, onRefund,
// partsNote (how the order's other parts are getting on), readyNote (text once this part is ready),
// venueName / venueColor (a kitchen cooking for several venues),
// tillView (the till's Open Orders: no Accept or Ready, only Delivered once it's ready),
// alreadyRefunded / onCloseRefunded (the flagged item was refunded already) }
function buildOrderCard(o, opts) {
  const subItem = o.items.find(i => i.substituted);
  const state = orderStage(o), refund = state === "refund" || state === "refunding";
  const known = typeof opts.refundPence === "number";
  // Once an order is ready, the order screen (no onDeliver) hands it over: only the till that takes it
  // out can mark it delivered, and nothing else can be done to it here - like a refund in progress.
  const handedToTill = state === "ready" && !opts.onDeliver;
  const card = document.createElement("article");
  card.className = "oc oc-state-" + (state === "refund" ? "problem" : state === "refunding" ? "refund" : state) + (opts.isNext ? " oc-next" : "");
  card.setAttribute("aria-label", `${orderLabel(o)}${orderIsLate(o) ? ", late" : ""}, ${{ refund: "needs refund", refunding: "refund in progress", problem: "problem", ready: "ready to take out", progress: "in progress", new: "new order" }[state]}`);
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
    <div class="oc-top">${opts.isNext ? `<span class="state-badge next">Next</span>` : ""}${badge}${orderIsLate(o) ? `<span class="state-badge late">${icon("clock")}Late</span>` : ""}<span class="oc-time">${fmtTime(o.ts)} · ${minutesAgo(o.ts)}</span></div>
    <div class="oc-head"><h3 class="oc-table">${esc(orderLabel(o))}</h3>${opts.venueName ? `<span class="tag oc-venue"><span class="venue-swatch" style="background:${opts.venueColor || "currentColor"}"></span>${esc(opts.venueName)}</span>` : ""}<span class="tag">${o.method === "cash" ? "Cash" : "Card"}</span></div>
    <div class="oc-items">${items}</div>
    ${o.notes ? `<div class="note-box">${icon("note")}<span>${esc(o.notes)}</span></div>` : ""}
    ${flagText}
    ${opts.partsNote ? `<div class="oc-muted oc-line">${icon("clock")} ${esc(opts.partsNote)}</div>` : ""}
    ${opts.tillView && !o.flagged && !o.ready ? `<div class="oc-muted oc-line">${icon("clock")} ${o.accepted ? "Being made. You can deliver it once it's ready." : "Waiting for the bar to accept it."}</div>` : ""}
    ${handedToTill ? `<div class="oc-ready">${icon("lock")}<span>${opts.readyNote ? esc(opts.readyNote) : "<strong>Waiting to be delivered.</strong> Only table service staff can mark it delivered"}</span></div>` : ""}
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
  if (o.flagged && opts.alreadyRefunded && opts.onCloseRefunded) {
    // The item was refunded already (e.g. from Past Orders): there's nothing left to refund.
    add(primary, "Already refunded, close it", opts.onCloseRefunded);
  } else if (refund) {
    // Nothing here closes or removes the order: it only goes once the refund has actually been given.
    // And while someone else is mid-refund, nobody else gets a Refund button.
    if (opts.canRefund && !refundLockedByOther(o, opts.myId)) refundButton();
  } else if (o.flagged) {
    if (o.flagIntent === "substitute" && o.flagSubstitute) add("btn btn-solid", `Customer took ${o.flagSubstitute}`, opts.onAccept);
    else add("btn btn-solid", "Customer is happy, carry on", opts.onAccept);
    if (opts.canRefund) refundButton();
    else add("btn btn-danger", "Customer wants a refund", opts.onRequestRefund);
  } else if (handedToTill) {
    // Locked on the order screen.
  } else {
    if (opts.onFlag) add("btn btn-ghost", "Report a problem", opts.onFlag);
    if (o.ready) add(primary, o.table ? `Delivered to table ${o.table}` : "Delivered", opts.onDeliver);
    else if (opts.tillView) { /* the till waits until the order screen marks it ready */ }
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
// --- Outbox: a save that doesn't reach the database (Wi-Fi drop, timeout) is kept on this device and
// retried every few seconds until it does, instead of being lost while the screen says it was logged.
// Saves are upserts by id, so sending one twice is harmless. A warning shows while anything is waiting.
const LS_OUTBOX = "nipos.outbox.v1";
let outbox = [];
try { outbox = JSON.parse(localStorage.getItem(LS_OUTBOX) || "[]"); } catch (e) { outbox = []; }
function saveOutbox() { try { localStorage.setItem(LS_OUTBOX, JSON.stringify(outbox)); } catch (e) {} renderOutboxNote(); }
async function upsertRow(table, rec) {
  try { const { error } = await supabaseClient.from(table).upsert(rec); return !error; } catch (e) { return false; }
}
async function deleteRow(table, id) {
  try { const { error } = await supabaseClient.from(table).delete().eq("id", id); return !error; } catch (e) { return false; }
}
function queueOutbox(table, rec, op) {
  outbox = outbox.filter(o => !(o.table === table && o.rec.id === rec.id)).concat([{ table, rec, op: op || "upsert", at: Date.now() }]);
  saveOutbox();
}
let outboxBusy = false;
async function flushOutbox() {
  if (outboxBusy || !outbox.length || !supabaseClient) return;
  outboxBusy = true;
  try {
    for (const o of outbox.slice()) {
      if (!(o.op === "delete" ? await deleteRow(o.table, o.rec.id) : await upsertRow(o.table, o.rec))) break; // still offline: try again later, in order
      outbox = outbox.filter(x => x !== o);
      saveOutbox();
    }
  } finally { outboxBusy = false; }
}
function renderOutboxNote() {
  if (typeof document === "undefined" || !document.body) return;
  let el = document.getElementById("outboxNote");
  if (!outbox.length) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement("div"); el.id = "outboxNote"; el.className = "outbox-note"; el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  const sales = outbox.filter(o => o.table === "sales").length;
  el.textContent = `${outbox.length} change${outbox.length === 1 ? "" : "s"}${sales ? ` (${sales} sale${sales === 1 ? "" : "s"})` : ""} waiting to save. Keep this screen open and online.`;
  el.hidden = false;
}
setInterval(flushOutbox, 5000);
try { window.addEventListener("online", flushOutbox); document.addEventListener("DOMContentLoaded", () => { renderOutboxNote(); flushOutbox(); }); } catch (e) {}

function rowStore(table, limit) {
  limit = limit || 1000;
  return {
    async save(row) {
      if (!supabaseClient || !currentVenueId) return;
      const rec = { id: row.id, ts: row.ts, venue_id: currentVenueId, data: row };
      if (outbox.some(o => o.table === table)) { queueOutbox(table, rec); flushOutbox(); return; } // keep the order
      if (!(await upsertRow(table, rec))) queueOutbox(table, rec);
    },
    // A delete that doesn't get through (e.g. Delivered on a dropped connection) waits in the outbox
    // too, instead of the order popping back up on every screen.
    async remove(id) {
      if (!supabaseClient) return;
      if (outbox.some(o => o.table === table && o.rec.id === id)) { outbox = outbox.filter(o => !(o.table === table && o.rec.id === id)); saveOutbox(); }
      if (!(await deleteRow(table, id))) queueOutbox(table, { id }, "delete");
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
        // A scheduled stop (Master settings "scheduledStops") stops counting once its time is up.
        // ...and a row this device has deleted (but not yet got through) stays gone here.
        const gone = new Set(outbox.filter(o => o.op === "delete" && o.table === table).map(o => o.rec.id));
        return data.map(r => r.data).filter(row => !row.isTest && !gone.has(row.id) && (table !== "stops" || stopActive(row)));
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
