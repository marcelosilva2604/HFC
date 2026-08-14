/* Client-side crypto (WebCrypto only).
 *
 * From the preceptor's password we derive two independent keys:
 *  - authKey: sent to the server as proof of password knowledge
 *    (the server stores only a peppered hash of it, never the password)
 *  - encKey: never leaves the browser; encrypts/decrypts the preceptor's
 *    bundle (signature, rubrica and stamp images + schedule)
 */

const PBKDF2_ITERATIONS = 310000;

function bufToB64(buf) {
  let s = '';
  new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKeys(password, saltB64) {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: b64ToBuf(saltB64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material, 512);
  const bytes = new Uint8Array(bits);
  const authKey = bufToB64(bytes.slice(0, 32));
  const encKeyRaw = bytes.slice(32, 64);
  const encKey = await crypto.subtle.importKey(
    'raw', encKeyRaw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { authKey, encKey };
}

function newSalt() {
  return bufToB64(crypto.getRandomValues(new Uint8Array(16)));
}

async function encryptBundle(encKey, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encKey, data);
  return { iv: bufToB64(iv), data: bufToB64(cipher) };
}

async function decryptBundle(encKey, payload) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(payload.iv) }, encKey, b64ToBuf(payload.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
