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
  orderScreen: "Order Screen"
};

let supabaseClient = null;
let currentVenueId = null;
try { currentVenueId = localStorage.getItem(LS_CURRENT_VENUE); } catch (e) {}

function connectAuthClient() {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
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
// be (within 60s). A background tab can miss the SDK's own timer-based auto-refresh (mobile browsers
// suspend JS timers while backgrounded), leaving a stale token cached that the server then rejects.
async function getSession() {
  try {
    const { data } = await supabaseClient.auth.getSession();
    let session = data.session || null;
    if (session && session.expires_at && session.expires_at * 1000 < Date.now() + 60000) {
      const { data: refreshed, error } = await supabaseClient.auth.refreshSession();
      session = (!error && refreshed.session) ? refreshed.session : null;
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
async function fetchMyVenues(staffRow) {
  if (!staffRow) return [];
  try {
    if (staffRow.perms && staffRow.perms.globalAdmin) {
      const { data } = await supabaseClient.from("venues").select("id,data").order("ts", { ascending: true });
      return (data || []).map(r => ({ id: r.id, ...r.data }));
    }
    const ids = staffRow.venueIds || [];
    if (!ids.length) return [];
    const { data } = await supabaseClient.from("venues").select("id,data").in("id", ids);
    return (data || []).map(r => ({ id: r.id, ...r.data }));
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

// --- Theme (light/dark), shared by every page ---
const LS_THEME = "starlightTill.theme.v1";
function getTheme() { try { return localStorage.getItem(LS_THEME) || "dark"; } catch (e) { return "dark"; } }
function setTheme(theme) {
  try { localStorage.setItem(LS_THEME, theme); } catch (e) {}
  document.documentElement.dataset.theme = theme;
}
function initTheme() { document.documentElement.dataset.theme = getTheme(); }

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
    return data.map(r => ({ ...r.data, venueId: r.venue_id }));
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
    return data.map(r => ({ ...r.data, venueId: r.venue_id }));
  } catch (e) { return []; }
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

function computeBestSellers(sales, limit) {
  const itemStats = {};
  sales.forEach(sale => {
    (sale.items || []).forEach(i => {
      if (!itemStats[i.name]) itemStats[i.name] = { name: i.name, qty: 0, revenue: 0 };
      itemStats[i.name].qty += i.qty;
      itemStats[i.name].revenue += i.pence * i.qty;
    });
  });
  return Object.values(itemStats).sort((a, b) => b.qty - a.qty).slice(0, limit || 15);
}

// bucket: "hour" (0-23, for a single-day range) or "day" (YYYY-MM-DD, for anything longer)
function computeSalesTrend(sales, bucket) {
  const buckets = {};
  sales.forEach(sale => {
    const d = new Date(sale.ts);
    const key = bucket === "hour" ? String(d.getHours()).padStart(2, "0") + ":00" : d.toISOString().slice(0, 10);
    buckets[key] = (buckets[key] || 0) + sale.total;
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
    async fetchAll() {
      if (!supabaseClient || !currentVenueId) return null;
      try {
        const { data, error } = await supabaseClient.from(table).select("data").eq("venue_id", currentVenueId).order("ts", { ascending: false }).limit(limit);
        if (error) return null;
        return data.map(r => r.data);
      } catch (e) { return null; }
    },
    async clear() {
      if (!supabaseClient || !currentVenueId) return;
      try { await supabaseClient.from(table).delete().eq("venue_id", currentVenueId); } catch (e) {}
    }
  };
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
async function fetchAllVenues() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient.from("venues").select("id,data").order("ts", { ascending: true });
    if (error || !data) return [];
    return data.map(r => ({ id: r.id, ...r.data }));
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
