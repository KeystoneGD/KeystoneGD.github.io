import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const PIN_RE = /^[0-9]{6,}$/;
const emailFor = (pin: string) => `pin${pin}@nipos.local`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const callerJwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerJwt) return json({ error: "Missing Authorization" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: callerAuth, error: callerErr } = await admin.auth.getUser(callerJwt);
  if (callerErr || !callerAuth?.user) return json({ error: "Invalid session" }, 401);
  const callerId = callerAuth.user.id;

  const { data: callerRow } = await admin.from("staff_users").select("data").eq("id", callerId).maybeSingle();
  const callerPerms = callerRow?.data?.perms || {};
  const callerVenueIds: string[] = callerRow?.data?.venueIds || [];
  const isGlobalAdmin = !!callerPerms.globalAdmin;
  const hasBackendAccess = !!callerPerms.backendAccess;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const action = body?.action;

  if (action === "create") {
    const { pin, name, perms, venueIds, groupIds } = body;
    if (typeof pin !== "string" || !PIN_RE.test(pin)) return json({ error: "PIN must be 6+ digits" }, 400);
    if (typeof name !== "string" || !name.trim()) return json({ error: "Name required" }, 400);
    const targetVenueIds: string[] = Array.isArray(venueIds) ? venueIds : [];
    const targetGroupIds: string[] = Array.isArray(groupIds) ? groupIds : [];
    const authorized = isGlobalAdmin || (hasBackendAccess && targetVenueIds.length > 0 && targetVenueIds.every(v => callerVenueIds.includes(v)));
    if (!authorized) return json({ error: "Not authorized to add staff to these venues" }, 403);

    const safePerms = { ...(perms || {}) };
    if (!isGlobalAdmin) safePerms.globalAdmin = false; // only a global admin may grant global admin

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: emailFor(pin), password: pin, email_confirm: true
    });
    if (createErr || !created?.user) {
      const msg = /already/i.test(createErr?.message || "") ? "That PIN is already in use" : (createErr?.message || "Could not create account");
      return json({ error: msg }, 400);
    }

    const { error: rowErr } = await admin.from("staff_users").insert({
      id: created.user.id,
      ts: Date.now(),
      data: { name: name.trim(), pin, perms: safePerms, venueIds: targetVenueIds, groupIds: targetGroupIds, notifyVenueIds: [] }
    });
    if (rowErr) {
      await admin.auth.admin.deleteUser(created.user.id); // roll back the orphaned auth account
      return json({ error: rowErr.message }, 400);
    }
    return json({ ok: true, id: created.user.id });
  }

  if (action === "changePin" || action === "delete") {
    const { userId } = body;
    if (typeof userId !== "string") return json({ error: "userId required" }, 400);
    const { data: targetRow } = await admin.from("staff_users").select("data").eq("id", userId).maybeSingle();
    if (!targetRow) return json({ error: "User not found" }, 404);
    // The hidden $YSTEM accounts are only ever changed from the database side (scripts/create-system.sh).
    if (targetRow.data?.system) return json({ error: "This account can't be changed from Backend" }, 403);
    const targetVenueIds: string[] = targetRow.data?.venueIds || [];
    const authorized = isGlobalAdmin || (hasBackendAccess && targetVenueIds.some(v => callerVenueIds.includes(v)));
    if (!authorized) return json({ error: "Not authorized to manage this user" }, 403);

    if (action === "changePin") {
      const { newPin } = body;
      if (typeof newPin !== "string" || !PIN_RE.test(newPin)) return json({ error: "PIN must be 6+ digits" }, 400);
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, { email: emailFor(newPin), password: newPin, email_confirm: true });
      if (updErr) return json({ error: /already/i.test(updErr.message) ? "That PIN is already in use" : updErr.message }, 400);
      await admin.from("staff_users").update({ data: { ...targetRow.data, pin: newPin } }).eq("id", userId);
      return json({ ok: true });
    }

    // delete
    await admin.auth.admin.deleteUser(userId);
    await admin.from("staff_users").delete().eq("id", userId);
    return json({ ok: true });
  }

  if (action === "setNotifyVenues") {
    // Any signed-in user may set their own notification subscriptions - no elevated permission needed.
    const { venueIds } = body;
    if (!Array.isArray(venueIds)) return json({ error: "venueIds must be an array" }, 400);
    if (!callerRow) return json({ error: "Account not found" }, 404);
    const { error } = await admin.from("staff_users").update({ data: { ...callerRow.data, notifyVenueIds: venueIds } }).eq("id", callerId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === "listNotifySubscribers") {
    // Returns just id/name for staff subscribed to this venue's notifications - never pin/perms, since
    // the caller may not otherwise be able to see these people at all (they might not share a venue).
    const { venueId } = body;
    if (typeof venueId !== "string") return json({ error: "venueId required" }, 400);
    const { data, error } = await admin.from("staff_users").select("id,data");
    if (error) return json({ error: error.message }, 400);
    const subscribers = (data || [])
      .filter(r => Array.isArray(r.data?.notifyVenueIds) && r.data.notifyVenueIds.includes(venueId))
      .map(r => ({ id: r.id, name: r.data.name }));
    return json({ ok: true, subscribers });
  }

  if (action === "deleteVenue") {
    // Global Admin only: wipes every row scoped to this venue across every table, then the venue itself,
    // then strips the venue id out of every staff member's venueIds/notifyVenueIds so nothing dangles.
    if (!isGlobalAdmin) return json({ error: "Only a Global Admin can delete a venue" }, 403);
    const { venueId } = body;
    if (typeof venueId !== "string" || !venueId) return json({ error: "venueId required" }, 400);
    const { data: venueRow } = await admin.from("venues").select("id").eq("id", venueId).maybeSingle();
    if (!venueRow) return json({ error: "Venue not found" }, 404);

    const venueTables = [
      "sales", "abandoned", "gratuities", "refunds", "notifications", "open_orders",
      "stops", "mixer_overrides", "custom_discounts", "categories", "catalogue_items",
      "z_reports", "presence", "push_subscriptions", "stock_counts", "tabs", "clock_events"
    ];
    for (const table of venueTables) {
      await admin.from(table).delete().eq("venue_id", venueId);
    }
    await admin.from("app_state").delete().like("key", `${venueId}:%`);

    const { data: allStaff } = await admin.from("staff_users").select("id,data");
    for (const u of allStaff || []) {
      const venueIds: string[] = u.data?.venueIds || [];
      const notifyVenueIds: string[] = u.data?.notifyVenueIds || [];
      if (!venueIds.includes(venueId) && !notifyVenueIds.includes(venueId)) continue;
      await admin.from("staff_users").update({
        data: {
          ...u.data,
          venueIds: venueIds.filter(v => v !== venueId),
          notifyVenueIds: notifyVenueIds.filter(v => v !== venueId)
        }
      }).eq("id", u.id);
    }

    await admin.from("venues").delete().eq("id", venueId);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
