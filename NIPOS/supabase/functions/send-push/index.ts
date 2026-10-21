import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Sends a phone/browser push to every device a person has turned alerts on for (or "all").
// Each failure's reason is returned and logged, so a broken push can be diagnosed.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
// Apple's push service refuses a subject that isn't a real https address or e-mail (".local" won't do).
const DEFAULT_SUBJECT = "https://keystonegd.github.io/NIPOS/";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  try {
    const { toUserId, fromUserId, title, body, urgent } = await req.json();
    if (!toUserId || !body) return json({ error: "toUserId and body required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: secrets } = await supabase.from("app_secrets").select("key, value").in("key", ["vapid_public_key", "vapid_private_key", "vapid_subject"]);
    const s: Record<string, string> = Object.fromEntries((secrets || []).map((r: any) => [r.key, r.value]));
    if (!s.vapid_public_key || !s.vapid_private_key) return json({ error: "VAPID keys not configured" }, 500);
    const subject = /^(https:\/\/|mailto:[^@\s]+@[^@\s]+\.(?!local$)[a-z]{2,}$)/i.test(s.vapid_subject || "") ? s.vapid_subject : DEFAULT_SUBJECT;
    webpush.setVapidDetails(subject, s.vapid_public_key, s.vapid_private_key);

    let query = supabase.from("push_subscriptions").select("id, subscription, user_id");
    if (toUserId !== "all") query = query.eq("user_id", toUserId);
    const { data: subs, error } = await query;
    if (error) return json({ error: error.message }, 500);

    const targets = (subs || []).filter((r: any) => r.user_id !== fromUserId);
    const payload = JSON.stringify({ title, body, urgent: !!urgent });
    const options = { TTL: urgent ? 300 : 3600, urgency: urgent ? "high" : "normal" } as any;

    let sent = 0;
    const errors: { service: string; status?: number; reason: string }[] = [];
    await Promise.all(targets.map(async (r: any) => {
      try { await webpush.sendNotification(r.subscription, payload, options); sent++; }
      catch (e: any) {
        const service = (() => { try { return new URL(r.subscription.endpoint).host; } catch { return "?"; } })();
        errors.push({ service, status: e?.statusCode, reason: String(e?.body || e?.message || e).slice(0, 200) });
        if (e && (e.statusCode === 404 || e.statusCode === 410)) await supabase.from("push_subscriptions").delete().eq("id", r.id); // that device turned alerts off
      }
    }));
    if (errors.length) console.log("send-push failures", JSON.stringify(errors));
    return json({ sent, failed: errors.length, targeted: targets.length, errors });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
