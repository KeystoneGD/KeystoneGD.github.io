import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Sends the Discord posts the tills queue in discord_queue, so a busy night never loses one.
// Posts for the same webhook go out in order, up to 10 to a message, spaced to stay under Discord's
// limit (5 per 2 seconds per webhook); on a 429 it waits the time Discord asks and carries on.
// Rows are claimed atomically (discord_claim), so tills nudging it at the same time never double-post.
// Called by the tills after queueing (signed in) and by pg_cron every minute (x-cron-secret).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const WEBHOOK_RE = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    const { data } = await admin.from("app_secrets").select("value").eq("key", "cron_secret").maybeSingle();
    if (!data || data.value !== cron) return json({ error: "forbidden" }, 403);
  } else {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await admin.auth.getUser(jwt);
    if (!who?.user) return json({ error: "forbidden" }, 403);
  }

  const { data: rows, error } = await admin.rpc("discord_claim", { p_limit: 200 });
  if (error) return json({ error: error.message }, 500);
  const byHook = new Map<string, any[]>();
  for (const r of rows || []) {
    if (!WEBHOOK_RE.test(r.webhook)) { await admin.from("discord_queue").update({ sent_at: new Date().toISOString(), last_error: "not a Discord webhook" }).eq("id", r.id); continue; }
    if (!byHook.has(r.webhook)) byHook.set(r.webhook, []);
    byHook.get(r.webhook)!.push(r);
  }

  let sent = 0, failed = 0;
  await Promise.all([...byHook.entries()].map(async ([hook, list]) => {
    list.sort((a, b) => a.ts - b.ts);
    for (let i = 0; i < list.length; i += 10) {
      const chunk = list.slice(i, i + 10), ids = chunk.map(r => r.id);
      let ok = false, lastError = "";
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        try {
          const res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ embeds: chunk.map(r => r.embed) }) });
          if (res.ok) { ok = true; break; }
          if (res.status === 429) {
            const body = await res.json().catch(() => ({}));
            const wait = Math.min(10, Number(body.retry_after) || parseFloat(res.headers.get("Retry-After") || "1") || 1);
            await sleep(wait * 1000 + 100); lastError = "rate limited"; continue;
          }
          lastError = `${res.status} ${(await res.text()).slice(0, 200)}`;
          if (res.status >= 400 && res.status < 500) break; // a bad webhook won't get better
        } catch (e) { lastError = String(e).slice(0, 200); }
        await sleep(1000);
      }
      if (ok) { sent += chunk.length; await admin.from("discord_queue").update({ sent_at: new Date().toISOString(), last_error: null }).in("id", ids); }
      else { failed += chunk.length; await admin.rpc("discord_failed", { p_ids: ids, p_error: lastError }); }
      await sleep(450); // stay under 5 requests per 2 seconds per webhook
    }
  }));
  await admin.from("discord_queue").delete().lt("sent_at", new Date(Date.now() - 3 * 864e5).toISOString());
  return json({ ok: true, sent, failed });
});
