// Image handling shared by public uploads and private payment-proof files.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { httpError } = require("./util");

// Identify the real type from the first bytes. Never trust the file name or the browser. SVG is refused (script risk).
function sniff(buf) {
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 6 && buf.slice(0, 4).toString() === "GIF8") return "gif";
  if (buf.length > 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "webp";
  return null;
}

function parseImage(dataUrl, maxBytes) {
  const m = String(dataUrl || "").match(/^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw httpError(400, "Please choose an image file.");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > maxBytes) throw httpError(413, `That image is too large. The maximum is ${Math.round(maxBytes / 1048576)} MB.`);
  const ext = sniff(buf);
  if (!ext) throw httpError(400, "Only PNG, JPG, GIF or WEBP images are allowed.");
  return { buf, ext };
}

// Payment proofs (bank screenshots) are NOT public: they live outside the static folder and are served only to authorised staff.
const PRIVATE_DIR = path.join(__dirname, "..", "..", "private-uploads");
const KEY = /^[a-z0-9-]{1,60}\/[a-f0-9]{24}\.(png|jpg|gif|webp)$/;

function savePrivateImage(scope, dataUrl, maxBytes = 2 * 1024 * 1024) {
  const { buf, ext } = parseImage(dataUrl, maxBytes);
  const dir = path.join(PRIVATE_DIR, scope);
  fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(12).toString("hex") + "." + ext;
  fs.writeFileSync(path.join(dir, name), buf);
  return `${scope}/${name}`;
}

function sendPrivateImage(res, key) {
  if (!KEY.test(key)) throw httpError(404, "File not found.");
  const file = path.join(PRIVATE_DIR, key);
  if (!file.startsWith(PRIVATE_DIR) || !fs.existsSync(file)) throw httpError(404, "File not found.");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.sendFile(file);
}

module.exports = { sniff, parseImage, savePrivateImage, sendPrivateImage, PRIVATE_DIR };
