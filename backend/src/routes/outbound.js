// Webhook management for a store (PLT-05).
const express = require("express");
const crypto = require("crypto");
const { z } = require("zod");
const { ObjectId } = require("mongodb");
const { getDb } = require("../db");
const A = require("../lib/auth");
const F = require("../lib/flags");
const { encrypt } = require("../lib/crypto");
const W = require("../lib/webhooks");
const { audit, wrap, validate, httpError } = require("../lib/util");

const router = express.Router();
router.use(A.authenticate("tenant"));
router.use((req, res, next) => {
  if (req.tenant.status === "deleted" || (req.tenant.status === "suspended" && req.method !== "GET")) return res.status(403).json({ error: "This store is not available." });
  next();
});
router.use(A.requirePerm("settings.manage"), F.requireFlag("PLT-05"));
const col = () => getDb().collection("webhooks");
const oid = (id) => { if (!ObjectId.isValid(id)) throw httpError(400, "Invalid id."); return new ObjectId(id); };

router.get("/", wrap(async (req, res) => {
  const hooks = await col().find({ tenantId: req.tenant.slug }, { projection: { secretEnc: 0 } }).toArray();
  res.json({ webhooks: hooks, events: W.EVENTS.filter((e) => e !== "ping") });
}));

router.post("/", wrap(async (req, res) => {
  const b = validate(z.object({ url: z.string().max(500), events: z.array(z.enum(W.EVENTS)).min(1) }), req.body);
  try { await W.checkUrl(b.url); } catch (e) { throw httpError(400, e.message); }
  if ((await col().countDocuments({ tenantId: req.tenant.slug })) >= 10) throw httpError(400, "You can have at most 10 webhooks.");
  const secret = "whsec_" + crypto.randomBytes(24).toString("hex");
  const r = await col().insertOne({ tenantId: req.tenant.slug, url: b.url, events: b.events, secretEnc: encrypt(secret), active: true, createdAt: new Date() });
  await audit(req, "webhook.create", b.url);
  res.status(201).json({ id: r.insertedId, secret }); // the signing secret is shown only now
}));

router.post("/:id/test", wrap(async (req, res) => {
  const h = await col().findOne({ _id: oid(req.params.id), tenantId: req.tenant.slug });
  if (!h) throw httpError(404, "Webhook not found.");
  res.json(await W.deliver(h, "ping", { message: "Test event from your store" }));
}));

router.patch("/:id", wrap(async (req, res) => {
  const { active } = validate(z.object({ active: z.boolean() }), req.body);
  const r = await col().updateOne({ _id: oid(req.params.id), tenantId: req.tenant.slug }, { $set: { active } });
  if (!r.matchedCount) throw httpError(404, "Webhook not found.");
  res.json({ ok: true });
}));

router.delete("/:id", wrap(async (req, res) => {
  await col().deleteOne({ _id: oid(req.params.id), tenantId: req.tenant.slug });
  await audit(req, "webhook.delete", req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
