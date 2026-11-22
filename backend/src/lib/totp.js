// Time-based one-time passwords (RFC 6238) for authenticator apps (Google Authenticator, Authy, 1Password...).
const crypto = require("crypto");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = "", out = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
function base32Decode(str) {
  let bits = "";
  for (const c of str.replace(/=+$/, "").toUpperCase()) { const v = ALPHABET.indexOf(c); if (v < 0) throw new Error("bad base32"); bits += v.toString(2).padStart(5, "0"); }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secretBuf, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secretBuf).update(msg).digest();
  const o = h[19] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

const newSecret = () => base32Encode(crypto.randomBytes(20));
const currentStep = (now = Date.now()) => Math.floor(now / 30000);

// Returns the matching time step (so a code can be used only once), or null. Accepts one step either side for clock drift.
function verify(secretB32, token, now = Date.now()) {
  const t = String(token || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(t)) return null;
  const secret = base32Decode(secretB32), step = currentStep(now);
  for (const d of [0, -1, 1]) {
    const expected = Buffer.from(hotp(secret, step + d));
    if (crypto.timingSafeEqual(expected, Buffer.from(t))) return step + d;
  }
  return null;
}

const otpauthUri = (secret, account, issuer) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

module.exports = { newSecret, verify, otpauthUri, hotp, base32Decode, currentStep };
