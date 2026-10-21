import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  try {
    const { toUserId, fromUserId, title, body, urgent } = await req.json();
    if (!toUserId || !body) {
      return new Response(JSON.stringify({ error: "toUserId and body required" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: secrets } = await supabase.from("app_secrets").select("key, value").in("key", ["vapid_public_key", "vapid_private_key", "vapid_subject"]);
    const secretMap: Record<string, string> = Object.fromEntries((secrets || []).map((s: any) => [s.key, s.value]));
    if (!secretMap.vapid_public_key || !secretMap.vapid_private_key) {
      return new Response(JSON.stringify({ error: "VAPID keys not configured" }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }
    webpush.setVapidDetails(secretMap.vapid_subject || "mailto:admin@example.com", secretMap.vapid_public_key, secretMap.vapid_private_key);

    let query = supabase.from("push_subscriptions").select("id, subscription, user_id");
    if (toUserId !== "all") query = query.eq("user_id", toUserId);
    const { data: subs, error } = await query;
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

    const targets = (subs || []).filter((s: any) => s.user_id !== fromUserId);
    const payload = JSON.stringify({ title, body, urgent: !!urgent });

    let sent = 0, failed = 0;
    await Promise.all(targets.map(async (s: any) => {
      try {
        await webpush.sendNotification(s.subscription, payload);
        sent++;
      } catch (e: any) {
        failed++;
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
    }));

    return new Response(JSON.stringify({ sent, failed, targeted: targets.length }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
