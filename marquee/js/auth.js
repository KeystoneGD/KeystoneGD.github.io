/* Marquee Event System — the operator door.

   WHAT THIS DOES: your username and password are never in these files. What ships is a
   salt and a short encrypted token. Signing in runs PBKDF2-HMAC-SHA256 over
   "username\0password" with that salt (310,000 rounds by default) to derive an AES-GCM
   key, then tries to decrypt the token. Right credentials, it decrypts. Wrong ones, it
   doesn't. Nobody reading the source learns anything except that a password exists.

   WHAT THIS IS NOT: server-side authentication. GitHub Pages has no server, so the check
   happens in the visitor's own browser and a determined person can run offline guesses
   against the stored token. 310,000 rounds makes each guess slow, so a long unusual
   password holds up well and a dictionary word does not. Choose accordingly.

   And the thing that actually protects a game in progress: signing in only unlocks the
   caller console on that person's own screen. Rooms live in the host's browser, so
   someone who forced their way past this door still cannot touch a room you are running
   — they can only open an empty one of their own. */

const TOKEN = "marquee-operator-v1";
export const DEFAULT_ITERATIONS = 310000;

export function cryptoAvailable() {
  return !!(window.crypto && window.crypto.subtle);
}

function b64(bytes) {
  let s = "";
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
}

function unb64(str) {
  const s = atob(str);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

async function deriveKey(user, pass, salt, iterations) {
  const material = new TextEncoder().encode(
    String(user).trim().toLowerCase() + "\u0000" + String(pass)
  );
  const base = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/* Used by set-password.html to produce the blob you paste into credentials.js. */
export async function makeCredentials(user, pass, iterations) {
  const iters = iterations || DEFAULT_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(user, pass, salt, iters);
  const token = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(TOKEN)
  );
  return { v: 1, iterations: iters, salt: b64(salt), iv: b64(iv), token: b64(token) };
}

/* Returns true only if these credentials decrypt the stored token. */
export async function checkCredentials(user, pass, cred) {
  if (!cred || !cred.salt || !cred.iv || !cred.token) return false;
  try {
    const key = await deriveKey(user, pass, unb64(cred.salt), cred.iterations || DEFAULT_ITERATIONS);
    const out = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(cred.iv) }, key, unb64(cred.token)
    );
    return new TextDecoder().decode(out) === TOKEN;
  } catch (e) {
    return false;                                  // wrong key throws; that IS the wrong answer
  }
}

/* A signed-in host stays signed in for the browser session only — never on disk. */
export const session = {
  open() { try { sessionStorage.setItem("marquee.operator", "1"); } catch (e) {} },
  isOpen() { try { return sessionStorage.getItem("marquee.operator") === "1"; } catch (e) { return false; } },
  close() { try { sessionStorage.removeItem("marquee.operator"); } catch (e) {} },
};
