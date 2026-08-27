// =====================================================================
// WILLOW Event System — patron relay Edge Function
// ---------------------------------------------------------------------
// Implements the contract at the top of js/net.js:
//
//   GET  <endpoint>            -> { venue:{...}, feed:[...] }
//   POST <endpoint>  {op:'push',  item:{...}}
//   POST <endpoint>  {op:'patch', id, patch:{...}}
//   POST <endpoint>  {op:'venue', venue:{...}}
//   POST <endpoint>  {op:'clear'}
//
// Deploy (Supabase CLI, from willow-project/):
//   supabase functions deploy willow-relay --no-verify-jwt
//
// --no-verify-jwt matters: patrons are anonymous, so the anon key in the
// site config must be enough to reach this function.
//
// Or paste this file into Dashboard > Edge Functions > Deploy new
// function, named exactly "willow-relay", and turn OFF "Verify JWT".
//
// Endpoint to put in js/config.js > interact.endpoint:
//   https://<project-ref>.supabase.co/functions/v1/willow-relay/room/main
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_ITEMS = 60;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Service role stays server-side; browsers only ever send the anon key.
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

// .../willow-relay/room/main  ->  "main"
function roomOf(url: string): string {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  const i = parts.indexOf('room');
  const room = i >= 0 ? parts[i + 1] : parts[parts.length - 1];
  return (room && room !== 'willow-relay' ? room : 'main').slice(0, 64);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const room = roomOf(req.url);

  try {
    if (req.method === 'GET') {
      const { data, error } = await db.rpc('willow_get', { p_room: room });
      if (error) throw error;
      return json(data ?? { venue: {}, feed: [] });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => null);
      if (!body || typeof body.op !== 'string') return json({ error: 'missing op' }, 400);

      switch (body.op) {
        case 'push': {
          if (!body.item || typeof body.item !== 'object') return json({ error: 'missing item' }, 400);
          const { error } = await db.rpc('willow_push', {
            p_room: room, p_item: body.item, p_max: MAX_ITEMS,
          });
          if (error) throw error;
          return json({ ok: true });
        }
        case 'patch': {
          if (!body.id) return json({ error: 'missing id' }, 400);
          const { error } = await db.rpc('willow_patch', {
            p_room: room, p_id: String(body.id), p_patch: body.patch ?? {},
          });
          if (error) throw error;
          return json({ ok: true });
        }
        case 'venue': {
          const { error } = await db.rpc('willow_venue', {
            p_room: room, p_venue: body.venue ?? {},
          });
          if (error) throw error;
          return json({ ok: true });
        }
        case 'clear': {
          const { error } = await db.rpc('willow_clear', { p_room: room });
          if (error) throw error;
          return json({ ok: true });
        }
        default:
          return json({ error: 'unknown op: ' + body.op }, 400);
      }
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
