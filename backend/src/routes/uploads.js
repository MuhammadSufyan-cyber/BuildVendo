// Image uploads for products and branding. Files are stored on disk in backend/uploads/<tenant>/ (development).
// On Vercel or another host without a persistent disk, swap saveFile() for Vercel Blob or Cloudinary.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { z } = require("zod");
const { getDb } = require("../db");
const A = require("../lib/auth");
const F = require("../lib/flags");
const { audit, wrap, validate, httpError, rateLimit } = require("../lib/util");

const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");
const MAX_BYTES = 3 * 1024 * 1024;

// Identify the real file type from its first bytes; never trust the file name or the browser's claim. SVG is refused (script risk).
function sniffOld(buf) {
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 6 && buf.slice(0, 4).toString() === "GIF8") return "gif";
  if (buf.length > 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "webp";
  return null;
}

const router = express.Router();
router.use(A.authenticate("tenant"));
router.use((req, res, next) => {
  if (req.tenant.status === "deleted" || req.tenant.status === "suspended") return res.status(403).json({ error: "This store is not available." });
  next();
});

router.post("/", A.requirePerm("products.write"), rateLimit({ windowMs: 60_000, max: 30, key: (r) => r.actor.id }), wrap(async (req, res) => {
  const { data } = validate(z.object({ data: z.string().max(5_000_000) }), req.body);
  const m = data.match(/^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw httpError(400, "Please choose an image file.");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > MAX_BYTES) throw httpError(413, "That image is too large. The maximum is 3 MB.");
  const ext = require("../lib/files").sniff(buf);
  if (!ext) throw httpError(400, "Only PNG, JPG, GIF or WEBP images are allowed.");

  const { limits } = await F.resolve(req.tenant);
  const used = await getDb().collection("uploads").aggregate([{ $match: { tenantId: req.tenant.slug } }, { $group: { _id: null, bytes: { $sum: "$size" } } }]).toArray();
  const usedMB = (used[0]?.bytes || 0) / 1048576;
  if (limits.storageMB >= 0 && usedMB + buf.length / 1048576 > limits.storageMB) throw httpError(402, `Storage limit reached (${limits.storageMB} MB). Delete images or upgrade your package.`, { upgrade: true });

  const dir = path.join(UPLOAD_DIR, req.tenant.slug);
  fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(12).toString("hex") + "." + ext;
  fs.writeFileSync(path.join(dir, name), buf);
  await getDb().collection("uploads").insertOne({ tenantId: req.tenant.slug, file: name, size: buf.length, createdAt: new Date(), by: req.actor.email });
  await audit(req, "upload.image", name);
  res.status(201).json({ url: `/uploads/${req.tenant.slug}/${name}` });
}));

module.exports = router;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
