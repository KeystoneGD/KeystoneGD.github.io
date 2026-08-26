/* Palace Bingo — host credentials.
 *
 * This file holds NO username and NO password. It holds a salt and a short token that
 * only the right credentials can decrypt. Replace the null below with the blob that
 * set-password.html gives you, then commit this file.
 *
 *   1. Open set-password.html on your published site (or over http://localhost — the
 *      browser's crypto API refuses to run from a file:// page).
 *   2. Type the username and password you want.
 *   3. Copy the generated block over the line below and push.
 *
 * Until you do, the host console will say the door has no lock fitted and refuse to open.
 * Changing your mind later is the same three steps — generate again, paste again, push.
 */

export const CREDENTIALS = null;

/* Example of what a filled-in file looks like (these values are made up and will not work):
 *
 * export const CREDENTIALS = {
 *   v: 1,
 *   iterations: 310000,
 *   salt: "Yk9sQmVIdGZ2S2NqTmxSZw==",
 *   iv: "M2hQZWtXcnRZdXNL",
 *   token: "bVNkR3JxWnhQd0xtQ2ZUdUJhSGtOZDgxOWZBcQ=="
 * };
 */
