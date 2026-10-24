# NIPOS Local

A self-hosted copy of the NIPOS till system that runs entirely on one Chromebook. The Chromebook
runs the database, logins, API and web pages itself, and the tills, order screens and Backend on
other devices connect to it over the venue's Wi-Fi. It needs no cloud project, and orders keep
working when the internet goes down.

The pages are the same as the hosted NIPOS (`index.html` till, `orders.html` order screen,
`backend.html` admin). The changes are:

- **Local database.** They talk to a local Supabase stack (Docker) instead of the cloud project.
  The API address is worked out from whichever address the device used to open the page.
- **Works offline.** The Supabase library, Chart.js and the fonts are bundled in `web/vendor/`
  instead of loading from CDNs.
- **Its own keys.** Every server gets its own API and push-notification keys. Nothing is hardcoded.

## What you need

- A Chromebook with **8 GB RAM** and **Linux development environment** support (x86 or ARM).
- About **10 GB of free disk** for Linux. Give it 20 GB+ when you turn Linux on so sales history
  has room to grow.
- **Internet for the first setup only**, which downloads Docker and the Supabase images.

## First-time setup

1. Turn on Linux: **Settings → About ChromeOS → Developers → Linux development environment →
   Turn on.** Pick a disk size of 20 GB or more.
2. Open the **Terminal** app and run:
   ```bash
   sudo apt-get update && sudo apt-get install -y git
   git clone https://github.com/KeystoneGD/KeystoneGD.github.io.git
   cd KeystoneGD.github.io/NIPOS-LOCAL
   scripts/setup.sh
   ```
   The first run takes 10–20 minutes while it downloads everything.
3. Create your first Global Admin (pick your own PIN, 6+ digits):
   ```bash
   scripts/create-admin.sh 123456 "Your Name"
   ```
4. On the Chromebook, open <http://localhost:8080/backend.html>, sign in with that PIN, and set up
   venues, staff, groups and the catalogue as usual. Do this step while you still have internet.
   The first time each Edge Function runs (adding staff, sending a push), it downloads its
   libraries and keeps them for later.

## Day to day

| Task | Command (in the Linux Terminal, inside `NIPOS-LOCAL`) |
|---|---|
| Start everything (after every restart of the Chromebook) | `scripts/start.sh` |
| Stop everything | `scripts/stop.sh` |
| Back up all data | `scripts/backup.sh` |
| Restore a backup (replaces all current data) | `scripts/restore.sh backups/nipos-….sql` |
| Add another Global Admin | `scripts/create-admin.sh <PIN> "Name"` |
| Create $YSTEM, or change its password | `scripts/create-system.sh` |
| Create an extra $YSTEM sign-in (e.g. 07466707188) | `scripts/create-system.sh 07466707188` |
| Update to the latest NIPOS (pages and database) | `git pull`, then `scripts/start.sh` |
| Bring the pages up to date with the hosted NIPOS | `python3 scripts/update-from-nipos.py ../NIPOS` (see below) |

ChromeOS doesn't start Linux on its own, so after the Chromebook restarts, open the Terminal
and run `scripts/start.sh`. Stopping or restarting never loses data, because it lives in Docker volumes.

**Back up regularly.** This Chromebook holds the only copy of the data. `scripts/backup.sh` writes
a file into `backups/`. Copy it off the device using the Files app (**Linux files → KeystoneGD.github.io → NIPOS-LOCAL →
backups**) to Google Drive or a USB stick.

## Connecting the tills

Linux on a Chromebook runs in its own private network, so other devices can't reach it until you
forward the ports:

1. **Settings → About ChromeOS → Developers → Linux development environment → Port forwarding**
   - Add **8080** (TCP), the web pages.
   - Add **54321** (TCP), the API.
   - Switch both on.
2. Find the Chromebook's Wi-Fi address: **Settings → Network → (your Wi-Fi) → Network/IP address**,
   e.g. `192.168.1.50`.
3. On each till or tablet, open `http://192.168.1.50:8080/`, using the Wi-Fi address from step 2.
   Use `/orders.html` for the order screen and `/backend.html` for Backend.

Tips:
- Give the Chromebook a **fixed IP** (a DHCP reservation in the router) so the address never changes.
- Stop it sleeping: **Settings → Device → Power → While charging: Keep display on**, and turn off
  **Sleep when cover is closed**. Keep it plugged in. If it sleeps, every till loses its connection.
- The tills and the Chromebook must be on the same Wi-Fi network.

## $YSTEM and Master settings

Master settings (themes, till layouts and every optional feature) is only for the hidden $YSTEM
account. Create it once with `scripts/create-system.sh` (it asks for a password, 10+ characters).
In Backend, type `$YSTEM` in the PIN box, then that password. An extra $YSTEM sign-in with its own
password, such as `07466707188`, is made with `scripts/create-system.sh 07466707188`.

Every optional feature in Master settings starts switched off, so nothing changes until you turn it on.

## Customer display

A screen facing the customer can show a till's order and total: open `http://<Chromebook IP>:8080/display.html`
on it, sign in with any PIN once, pick the venue and type the 4-number code shown in that till's
Settings (Customer display). Switch on **Customer display** in Master settings first.

## Keeping it up to date

This folder lives next to the hosted NIPOS in the KeystoneGD.github.io repository. To bring the
pages here up to date after a change to the hosted NIPOS, run from this folder:

```bash
python3 scripts/update-from-nipos.py ../NIPOS
```

It copies the pages and points them at this server instead of the internet; it stops without
changing anything if a page has changed in a way it doesn't recognise. Database changes need a new
migration too (see Layout, below).

## What works differently from the hosted version

- **Push notifications (alerts when the page is closed)** only work on the Chromebook itself.
  Browsers allow push only on HTTPS or `localhost`, and the other devices connect over plain
  `http://` on the local network. In-app sounds, banners and notifications while the page is
  open work everywhere.
- **Discord messages** (stops, orders, Z reads) only send while the Chromebook has internet.
  Everything else keeps working offline.
- **"Install app" / home-screen install** from other devices needs HTTPS too, so on the tills use
  the browser instead (a bookmark or kiosk mode).
- **Supabase Studio** (a database admin UI) is at <http://localhost:54323> on the Chromebook.
- **Daily summary by email** isn't available: it needs the internet and a mail service.
- **Backup and restore** in Master settings works here too, alongside `scripts/backup.sh`.

## Layout

```
web/                    the NIPOS pages, served on port 8080
  vendor/               bundled supabase-js, Chart.js and fonts (no CDN needed)
  config.js             written by start.sh with this server's API key (not in git)
supabase/
  config.toml           local stack config, trimmed to what NIPOS uses to save memory
  migrations/           the full NIPOS schema, RLS policies and storage bucket
  functions/            manage-staff and send-push Edge Functions
scripts/                setup / start / stop / create-admin / create-system / backup / restore,
                        and update-from-nipos.py (copies the hosted pages in)
```

Database changes go in a new file in `supabase/migrations/`. `scripts/start.sh` applies any new ones
each time it runs (`supabase migration up --local`), which keeps existing data. Don't use `supabase db reset`
for this, because it wipes everything.
