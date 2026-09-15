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
          const time = new Date(sale.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
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
  const date = new Date(closedAt).toLocaleDateString();
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
    const reportHtml = buildReceiptHTML(title, new Date(closedAt).toLocaleString(), zReportRows(fullSummary), transactions);
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
