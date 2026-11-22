// Image uploads for products, logo, banner and blog posts. Stored in MongoDB (see lib/files.js) and served at /uploads/<store>/<file>.
const express = require("express");
const { z } = require("zod");
const { getDb } = require("../db");
const A = require("../lib/auth");
const F = require("../lib/flags");
const { parseImage, saveBuffer } = require("../lib/files");
const { audit, wrap, validate, httpError, rateLimit } = require("../lib/util");

// Vercel functions accept request bodies up to 4.5 MB; a 2.5 MB image becomes about 3.4 MB of base64 text.
const MAX_BYTES = 2.5 * 1024 * 1024;

const router = express.Router();
router.use(A.authenticate("tenant"));
router.use((req, res, next) => {
  if (req.tenant.status === "deleted" || req.tenant.status === "suspended") return res.status(403).json({ error: "This store is not available." });
  next();
});

router.post("/", A.requirePerm("products.write"), rateLimit({ windowMs: 60_000, max: 30, key: (r) => r.actor.id }), wrap(async (req, res) => {
  const { data } = validate(z.object({ data: z.string().max(4_300_000) }), req.body);
  const { buf, ext } = parseImage(data, MAX_BYTES);

  const { limits } = await F.resolve(req.tenant);
  const used = await getDb().collection("uploads").aggregate([{ $match: { tenantId: req.tenant.slug } }, { $group: { _id: null, bytes: { $sum: "$size" } } }]).toArray();
  const usedMB = (used[0]?.bytes || 0) / 1048576;
  if (limits.storageMB >= 0 && usedMB + buf.length / 1048576 > limits.storageMB) throw httpError(402, `Storage limit reached (${limits.storageMB} MB). Delete images or upgrade your package.`, { upgrade: true });

  const key = await saveBuffer({ scope: req.tenant.slug, tenantId: req.tenant.slug, visibility: "public", buf, ext, by: req.actor.email });
  await getDb().collection("uploads").insertOne({ tenantId: req.tenant.slug, file: key.split("/")[1], size: buf.length, createdAt: new Date(), by: req.actor.email });
  await audit(req, "upload.image", key);
  res.status(201).json({ url: `/uploads/${key}` });
}));

module.exports = router;
