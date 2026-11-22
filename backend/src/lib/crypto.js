// Encrypts secrets stored in the database (for example a store's own Stripe key) with AES-256-GCM.
// Set ENCRYPTION_KEY in .env (any long random string). Without it, a key derived from JWT_SECRET is used.
const crypto = require("crypto");

const key = () => crypto.createHash("sha256").update(process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "dev-key").digest();

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

function decrypt(blob) {
  const [iv, tag, enc] = String(blob).split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt };
