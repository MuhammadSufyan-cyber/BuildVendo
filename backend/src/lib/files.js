// Images live in MongoDB (collection "files"), not on a server disk, so they survive redeploys and work on serverless hosts.
//  - public images (product photos, logo, banner) are served at /uploads/<store>/<file> to everyone;
//  - private images (payment screenshots) are served only to authorised staff through their own routes.
const crypto = require("crypto");
const { Binary } = require("mongodb");
const { getDb } = require("../db");
const { httpError } = require("./util");

// Identify the real type from the first bytes. Never trust the file name or the browser. SVG is refused (script risk).
function sniff(buf) {
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 6 && buf.slice(0, 4).toString() === "GIF8") return "gif";
  if (buf.length > 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "webp";
  return null;
}

const MIME = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const KEY = /^[a-z0-9-]{1,60}\/[a-f0-9]{24}\.(png|jpg|gif|webp)$/;
const mb = (bytes) => (bytes / 1048576).toFixed(1).replace(/\.0$/, "");

function parseImage(dataUrl, maxBytes) {
  const m = String(dataUrl || "").match(/^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw httpError(400, "Please choose an image file.");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > maxBytes) throw httpError(413, `That image is too large. The maximum is ${mb(maxBytes)} MB.`);
  const ext = sniff(buf);
  if (!ext) throw httpError(400, "Only PNG, JPG, GIF or WEBP images are allowed.");
  return { buf, ext };
}

// Stores an already validated image and returns its key "<scope>/<random>.<ext>".
async function saveBuffer({ scope, tenantId, visibility, buf, ext, by }) {
  const key = `${scope}/${crypto.randomBytes(12).toString("hex")}.${ext}`;
  await getDb().collection("files").insertOne({ _id: key, tenantId, visibility, ext, size: buf.length, data: new Binary(buf), createdAt: new Date(), by: by || null });
  return key;
}

// Payment proofs: private, tied to the store.
async function savePrivateImage(scope, dataUrl, maxBytes = 2 * 1024 * 1024) {
  const { buf, ext } = parseImage(dataUrl, maxBytes);
  return saveBuffer({ scope, tenantId: scope, visibility: "private", buf, ext });
}

async function sendImage(res, key, visibility) {
  if (!KEY.test(key)) throw httpError(404, "File not found.");
  const f = await getDb().collection("files").findOne({ _id: key, visibility });
  if (!f) throw httpError(404, "File not found.");
  res.setHeader("Content-Type", MIME[f.ext]);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", visibility === "public" ? "public, max-age=604800, immutable" : "private, max-age=300");
  res.status(200).end(Buffer.from(f.data.buffer));
}
const sendPublicImage = (res, key) => sendImage(res, key, "public");
const sendPrivateImage = (res, key) => sendImage(res, key, "private");

module.exports = { sniff, parseImage, saveBuffer, savePrivateImage, sendPublicImage, sendPrivateImage };
