# Patron relay — Supabase

GitHub Pages serves static files only, so it cannot pass messages between a
patron's phone and the operator console. This folder is the relay that does.

Nothing here is served to the browser — it lives in the repo for safekeeping.
Harmless to upload to Pages, but you can also keep it out of the deployed site.

## Install

**1. Schema.** Supabase Dashboard ▸ SQL Editor ▸ paste all of `schema.sql` ▸ Run.
Creates `willow_rooms` and five functions. Safe to re-run.

**2. Function.** Dashboard ▸ Edge Functions ▸ Deploy new function, name it
exactly `willow-relay`, paste `functions/willow-relay/index.ts`, and **turn off
"Verify JWT"**. With the CLI instead:

```
supabase functions deploy willow-relay --no-verify-jwt
```

Verify-JWT must be off — patrons are anonymous, so the site's anon key has to
be enough to reach the function.

**3. Point the site at it.** In `js/config.js` ▸ `interact`:

```
    transport: 'rest',
    endpoint: 'https://<project-ref>.supabase.co/functions/v1/willow-relay/room/main',
    headers: { apikey: '<your-anon-key>' },
```

`<project-ref>` is in your Supabase URL. `main` is the room id — any string;
use a different one per venue if you run two off one project.

Use the **anon** key, never the service role key. The anon key ends up visible
in your Pages source, which is fine: it only gets a request past Supabase's
gateway. The privileged key lives in the function's environment, which the
browser cannot see.

## Check it works

```
curl https://<project-ref>.supabase.co/functions/v1/willow-relay/room/main \
  -H "apikey: <your-anon-key>"
```

Expect `{"venue":{},"feed":[]}`. A 401 means Verify JWT is still on. Then open
the console and the patron site on two different devices — a shoutout sent from
the phone should appear in the Interactions queue within a few seconds
(`interact.pollSeconds`, default 3).

## What it stores

One row per room: the `venue` snapshot the console publishes (called numbers,
sales open, pattern, prize) and a `feed` array of patron traffic — joins, cards,
shoutouts, photos, claims, operator drops and bans. The feed is capped at the
newest 60 items in Postgres.

Photos arrive as JPEG data URLs already downscaled on the phone
(`interact.photoMaxPx`, default 900px), roughly 40–80 KB each — well inside the
free tier for a normal night, but it is the one thing that grows quickly if you
raise that limit.

Array mutations happen inside Postgres rather than read-modify-write in JS, so
several phones submitting at the same moment cannot clobber each other.

The commented-out `pg_cron` job at the bottom of `schema.sql` clears rooms
untouched for a week. Enable pg_cron first if you want it.
