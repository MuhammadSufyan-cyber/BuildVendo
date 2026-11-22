// Store blog (STO-04): write posts in the dashboard, shown on the storefront. Body is plain text (never HTML), so it cannot carry scripts.
const express = require("express");
const { z } = require("zod");
const { ObjectId } = require("mongodb");
const A = require("../lib/auth");
const F = require("../lib/flags");
const { scoped } = require("../lib/repo");
const { audit, slugify, wrap, validate, httpError } = require("../lib/util");

const router = express.Router();
router.use(A.authenticate("tenant"));
router.use((req, res, next) => {
  if (req.tenant.status === "deleted" || (req.tenant.status === "suspended" && req.method !== "GET")) return res.status(403).json({ error: "This store is not available." });
  req.R = scoped(req.actor.tenantId);
  next();
});
router.use(A.requirePerm("products.write"), F.requireFlag("STO-04"));
const oid = (id) => { if (!ObjectId.isValid(id)) throw httpError(400, "Invalid id."); return new ObjectId(id); };
const img = z.string().max(300).regex(/^(https:\/\/|\/uploads\/)[^\s"<>]+$/).or(z.literal(""));
const postSchema = z.object({
  title: z.string().min(2).max(140), excerpt: z.string().max(300).default(""), body: z.string().min(1).max(20000),
  image: img.default(""), status: z.enum(["draft", "published"]).default("draft"),
});

router.get("/", wrap(async (req, res) => res.json({ posts: await req.R.col("posts").find({}, { projection: { body: 0 } }).sort({ createdAt: -1 }).limit(200).toArray() })));

router.get("/:id", wrap(async (req, res) => {
  const p = await req.R.col("posts").findOne({ _id: oid(req.params.id) });
  if (!p) throw httpError(404, "Post not found.");
  res.json({ post: p });
}));

router.post("/", wrap(async (req, res) => {
  const b = validate(postSchema, req.body);
  let slug = slugify(b.title);
  if (await req.R.col("posts").findOne({ slug })) slug += "-" + Math.random().toString(36).slice(2, 6);
  const now = new Date();
  const r = await req.R.col("posts").insertOne({ ...b, slug, author: req.actor.name, createdAt: now, publishedAt: b.status === "published" ? now : null });
  await audit(req, "blog.create", slug);
  res.status(201).json({ id: r.insertedId, slug });
}));

router.put("/:id", wrap(async (req, res) => {
  const b = validate(postSchema.partial(), req.body);
  const cur = await req.R.col("posts").findOne({ _id: oid(req.params.id) });
  if (!cur) throw httpError(404, "Post not found.");
  const set = { ...b, updatedAt: new Date() };
  if (b.status === "published" && !cur.publishedAt) set.publishedAt = new Date();
  await req.R.col("posts").updateOne({ _id: cur._id }, { $set: set });
  await audit(req, "blog.update", cur.slug);
  res.json({ ok: true });
}));

router.delete("/:id", wrap(async (req, res) => {
  const r = await req.R.col("posts").deleteOne({ _id: oid(req.params.id) });
  if (!r.deletedCount) throw httpError(404, "Post not found.");
  await audit(req, "blog.delete", req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
