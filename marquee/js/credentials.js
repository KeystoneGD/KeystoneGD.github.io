/* Marquee Event System — who can open the console.
 *
 * No name and no password live in this file. Each operator is a record holding a random
 * salt and a short token that only their own password can decrypt.
 *
 *   1. Open set-password.html on your published site (or over http://localhost — the
 *      browser's crypto API will not run from a file:// page).
 *   2. Create the first admin.
 *   3. Paste what it gives you over this whole file and push.
 *
 * After that the admin can add more operators from the console's Users pane and download
 * a fresh copy of this file to commit. Roles are "admin", "caller" and "checker".
 */

export const USERS = [];

/* The first version of this system held a single unnamed admin here. If you have one,
 * leave it — it still works, and it counts as an admin. */
export const CREDENTIALS = null;
