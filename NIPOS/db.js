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

async function getSession() {
  try {
    const { data } = await supabaseClient.auth.getSession();
    return data.session || null;
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

// The caller's own staff_users row — { id, name, pin, perms, venueIds } — or null if signed out.
async function fetchMyStaffRow() {
  const session = await getSession();
  if (!session) return null;
  try {
    const { data, error } = await supabaseClient.from("staff_users").select("id,data").eq("id", session.user.id).maybeSingle();
    if (error || !data) return null;
    return { id: data.id, ...data.data };
  } catch (e) { return null; }
}

// Venues a staff member can operate in — every venue for a Global Admin, otherwise just their venueIds.
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

// Every shared log is a table of independent rows, one per event, addressed by its own id — a device
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
