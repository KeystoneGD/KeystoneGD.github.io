// NIPOS daily summary (Master settings feature "dailySummary"): each night's takings for every venue,
// emailed through Resend. Called every hour by pg_cron (with the cron secret) and sends once a day at
// the chosen UK time; $YSTEM can also send one straight away from Master settings ("Send one now").
// Needs app_secrets rows resend_api_key and resend_from (see master_themes.sql, "Daily summary").
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const money = (p: number) => "£" + (p / 100).toFixed(2);
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// UK wall-clock parts for a moment.
function ukParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { date: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour) % 24, minute: Number(o.minute) };
}
// The UTC moment of 06:00 UK time on a UK date.
function ukSixAm(date: string) {
  const guess = new Date(date + "T06:00:00Z");
  const { hour } = ukParts(guess);
  return new Date(guess.getTime() - (hour - 6) * 3600e3);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: secretRows } = await admin.from("app_secrets").select("key, value").in("key", ["resend_api_key", "resend_from", "cron_secret", "daily_summary_last"]);
  const secrets: Record<string, string> = Object.fromEntries((secretRows || []).map((r: any) => [r.key, r.value]));
  const body = await req.json().catch(() => ({}));

  // Who's asking: the hourly cron job, or $YSTEM pressing "Send one now".
  let test = false;
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    if (!secrets.cron_secret || cron !== secrets.cron_secret) return json({ error: "forbidden" }, 403);
  } else {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: "forbidden" }, 403);
    const { data: row } = await admin.from("staff_users").select("data").eq("id", u.user.id).maybeSingle();
    if (!row?.data?.system) return json({ error: "forbidden" }, 403);
    test = !!body.test;
  }

  const { data: theme } = await admin.from("system_theme").select("settings").eq("id", "current").maybeSingle();
  const cfg = theme?.settings?.dailySummary || {};
  if (!cfg.enabled && !test) return json({ skipped: "off" });
  const recipients: string[] = (cfg.recipients || []).filter((x: string) => /.+@.+\..+/.test(x));
  if (!recipients.length) return json({ error: "no_recipients" });
  if (!secrets.resend_api_key || !secrets.resend_from) return json({ error: "no_key" });

  const now = new Date(), uk = ukParts(now);
  if (!test) {
    const [h] = String(cfg.time || "09:00").split(":").map(Number);
    if (uk.hour !== h) return json({ skipped: "not_time" });
    if (secrets.daily_summary_last === uk.date) return json({ skipped: "already_sent" });
  }
  // The night being summed: 06:00 yesterday to 06:00 today (UK).
  const end = ukSixAm(uk.date), start = new Date(end.getTime() - 864e5);
  const [{ data: venues }, { data: sales }, { data: refunds }, { data: tips }] = await Promise.all([
    admin.from("venues").select("id, data"),
    admin.from("sales").select("venue_id, data").gte("ts", start.getTime()).lt("ts", end.getTime()).limit(100000),
    admin.from("refunds").select("venue_id, data").gte("ts", start.getTime()).lt("ts", end.getTime()).limit(100000),
    admin.from("gratuities").select("venue_id, data").gte("ts", start.getTime()).lt("ts", end.getTime()).limit(100000),
  ]);
  const rows = (venues || []).filter((v: any) => v.data?.active !== false).map((v: any) => {
    const s = (sales || []).filter((x: any) => x.venue_id === v.id && !x.data?.isTest);
    const r = (refunds || []).filter((x: any) => x.venue_id === v.id && !x.data?.isTest);
    const t = (tips || []).filter((x: any) => x.venue_id === v.id && !x.data?.isTest);
    const sum = (a: any[], f: (x: any) => number) => a.reduce((n, x) => n + (f(x) || 0), 0);
    const card = sum(s.filter((x: any) => x.data.method !== "cash"), x => x.data.total), cash = sum(s.filter((x: any) => x.data.method === "cash"), x => x.data.total);
    const ref = sum(r, x => x.data.pence);
    return { name: v.data?.name || v.id, orders: s.filter((x: any) => !x.data.splitPart || x.data.splitPart === 1).length, card, cash, refunds: ref, tips: sum(t, x => x.data.amount), takings: card + cash - ref };
  });
  const total = rows.reduce((n, r) => n + r.takings, 0);
  const night = new Date(start.getTime() + 12 * 3600e3).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
  const html = `<div style="font-family:system-ui,sans-serif;color:#111;max-width:640px;">
    <h2 style="margin:0 0 4px;">Takings for ${esc(night)}</h2>
    <p style="margin:0 0 16px;color:#555;">6am to 6am. Total across all venues: <strong>${money(total)}</strong></p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <tr style="text-align:left;border-bottom:2px solid #111;"><th style="padding:6px;">Venue</th><th style="padding:6px;">Takings</th><th style="padding:6px;">Card</th><th style="padding:6px;">Cash</th><th style="padding:6px;">Refunds</th><th style="padding:6px;">Tips</th><th style="padding:6px;">Orders</th></tr>
      ${rows.map(r => `<tr style="border-bottom:1px solid #ddd;"><td style="padding:6px;">${esc(r.name)}</td><td style="padding:6px;"><strong>${money(r.takings)}</strong></td><td style="padding:6px;">${money(r.card)}</td><td style="padding:6px;">${money(r.cash)}</td><td style="padding:6px;">${money(r.refunds)}</td><td style="padding:6px;">${money(r.tips)}</td><td style="padding:6px;">${r.orders}</td></tr>`).join("")}
    </table>
    <p style="color:#777;font-size:12px;margin-top:16px;">Sent by NIPOS. Change who gets this in Backend › Master settings › Daily summary by email.</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + secrets.resend_api_key },
    body: JSON.stringify({ from: secrets.resend_from, to: recipients, subject: `${test ? "[Test] " : ""}Takings for ${night}: ${money(total)}`, html }),
  });
  if (!res.ok) return json({ error: "resend_" + res.status, detail: (await res.text()).slice(0, 300) });
  if (!test) await admin.from("app_secrets").upsert({ key: "daily_summary_last", value: uk.date });
  return json({ sent: recipients.length, total });
});
