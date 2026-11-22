// Super Admin API (SRS sections 5, 6, 7). Only platform roles can use it; every write is audit-logged.
const express = require("express");
const { z } = require("zod");
const { ObjectId } = require("mongodb");
const { getDb } = require("../db");
const A = require("../lib/auth");
const F = require("../lib/flags");
const { FEATURES, flagsForPlan } = require("../lib/features");
const { byPrice, audit, slugify, wrap, validate, httpError } = require("../lib/util");

const router = express.Router();
router.use(A.authenticate("platform"));

// ---------- overview / analytics (FR-013) ----------
router.get("/overview", A.requirePerm("platform.analytics.view"), wrap(async (req, res) => {
  const db = getDb();
  const [tenants, packages, revenue, orders, ai] = await Promise.all([
    db.collection("tenants").find({ status: { $ne: "deleted" } }).toArray(),
    db.collection("packages").find({}).toArray(),
    db.collection("orders").aggregate([{ $match: { status: { $nin: ["cancelled"] } } }, { $group: { _id: "$tenantId", gmv: { $sum: "$total" }, orders: { $sum: 1 } } }]).toArray(),
    db.collection("orders").countDocuments({}),
    db.collection("usageCounters").aggregate([{ $match: { meter: "aiCredits", period: F.monthKey() } }, { $group: { _id: null, v: { $sum: "$value" } } }]).toArray(),
  ]);
  const price = Object.fromEntries(packages.map((p) => [p.key, p.priceMonthly || 0]));
  const byPackage = {}, byStatus = {};
  let mrr = 0;
  for (const t of tenants) {
    byPackage[t.packageId] = (byPackage[t.packageId] || 0) + 1;
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    if (t.status === "active") mrr += price[t.packageId] || 0;
  }
  res.json({
    tenants: tenants.length, byPackage, byStatus, mrr, orders,
    gmv: revenue.reduce((s, r) => s + r.gmv, 0), aiCreditsUsed: ai[0]?.v || 0,
    gmvByTenant: Object.fromEntries(revenue.map((r) => [r._id, r.gmv])),
  });
}));

// ---------- tenants (FR-001, 010, 012) ----------
router.get("/tenants", A.requirePerm("platform.tenants.view"), wrap(async (req, res) => {
  const db = getDb();
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.query.package) q.packageId = req.query.package;
  if (req.query.q) q.$or = [{ name: new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }, { slug: new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }];
  const tenants = await db.collection("tenants").find(q).sort({ createdAt: -1 }).limit(500).toArray();
  const stats = await db.collection("orders").aggregate([{ $group: { _id: "$tenantId", gmv: { $sum: "$total" }, orders: { $sum: 1 }, last: { $max: "$createdAt" } } }]).toArray();
  const map = Object.fromEntries(stats.map((s) => [s._id, s]));
  const prods = await db.collection("products").aggregate([{ $group: { _id: "$tenantId", n: { $sum: 1 } } }]).toArray();
  const pm = Object.fromEntries(prods.map((s) => [s._id, s.n]));
  res.json({ tenants: tenants.map((t) => ({ ...t, gmv: map[t.slug]?.gmv || 0, orders: map[t.slug]?.orders || 0, lastOrderAt: map[t.slug]?.last || null, products: pm[t.slug] || 0 })) });
}));

const createTenant = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().optional(),
  packageId: z.string(),
  ownerEmail: z.string().email().transform((s) => s.toLowerCase()),
  ownerName: z.string().min(2).max(80),
});
router.post("/tenants", A.requirePerm("platform.tenants.create"), wrap(async (req, res) => {
  const b = validate(createTenant, req.body);
  const db = getDb();
  const pkg = await db.collection("packages").findOne({ key: b.packageId, archived: { $ne: true } });
  if (!pkg) throw httpError(400, "Unknown or archived package.");
  const slug = slugify(b.slug || b.name);
  if (["admin", "api", "platform", "login", "s", "www", "dashboard"].includes(slug)) throw httpError(400, "That Tenant ID is reserved.");
  if (await db.collection("tenants").findOne({ slug })) throw httpError(409, "Tenant ID already in use.");
  const now = new Date();
  await db.collection("tenants").insertOne({
    slug, name: b.name, status: pkg.trialDays ? "trial" : "active", packageId: pkg.key, region: "default", createdAt: now,
    trialEndsAt: pkg.trialDays ? new Date(now.getTime() + pkg.trialDays * 864e5) : null,
    settings: { currency: "USD", tagline: "", theme: { primary: "#6b3410", accent: "#f08c00", font: "sans", style: "modern" }, taxRatePct: 0, shippingFlat: 500, freeShippingOver: 0 },
  });
  const owner = await db.collection("tenantUsers").insertOne({ tenantId: slug, email: b.ownerEmail, name: b.ownerName, role: "owner", status: "invited", createdAt: now });
  const token = await A.createToken("invite", { scope: "tenant", userId: String(owner.insertedId), tenantId: slug }, 72);
  await db.collection("notifications").insertOne({ tenantId: slug, title: "Welcome!", body: "Your store is ready. Use the onboarding checklist to set it up.", createdAt: now, read: false });
  await audit(req, "tenant.create", slug, { tenantId: slug, after: { name: b.name, packageId: b.packageId } });
  F.invalidate();
  const inviteUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/invite?token=${token}`;
  await require("../lib/mailer").send("invite", b.ownerEmail, { name: b.ownerName, store: b.name, url: inviteUrl });
  // The link is also returned once so the Super Admin can pass it on by hand.
  res.status(201).json({ slug, inviteUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/invite?token=${token}`, inviteExpiresHours: 72 });
}));

router.get("/tenants/:slug", A.requirePerm("platform.tenants.view"), wrap(async (req, res) => {
  const db = getDb();
  const t = await db.collection("tenants").findOne({ slug: req.params.slug });
  if (!t) throw httpError(404, "Tenant not found.");
  const [users, overrides, eff, use] = await Promise.all([
    db.collection("tenantUsers").find({ tenantId: t.slug }, { projection: { passwordHash: 0, failures: 0 } }).toArray(),
    db.collection("tenantOverrides").findOne({ tenantId: t.slug }),
    F.resolve(t), F.usage(t.slug),
  ]);
  res.json({ tenant: t, users, overrides, effective: { flags: eff.flags, limits: eff.limits }, usage: use });
}));

const patchTenant = z.object({ status: z.enum(["active", "trial", "suspended"]).optional(), packageId: z.string().optional(), name: z.string().min(2).optional() });
router.patch("/tenants/:slug", A.requirePerm("platform.tenants.suspend"), wrap(async (req, res) => {
  const b = validate(patchTenant, req.body);
  const db = getDb();
  const t = await db.collection("tenants").findOne({ slug: req.params.slug });
  if (!t || t.status === "deleted") throw httpError(404, "Tenant not found.");
  if (b.packageId && !(await db.collection("packages").findOne({ key: b.packageId }))) throw httpError(400, "Unknown package.");
  await db.collection("tenants").updateOne({ slug: t.slug }, { $set: { ...b, updatedAt: new Date() } });
  await audit(req, "tenant.update", t.slug, { tenantId: t.slug, before: { status: t.status, packageId: t.packageId }, after: b });
  F.invalidate();
  res.json({ ok: true });
}));

router.delete("/tenants/:slug", A.requirePerm("platform.tenants.delete"), wrap(async (req, res) => {
  const db = getDb();
  const t = await db.collection("tenants").findOne({ slug: req.params.slug });
  if (!t) throw httpError(404, "Tenant not found.");
  // soft delete; a scheduled job would purge after 30 days (FR-012)
  await db.collection("tenants").updateOne({ slug: t.slug }, { $set: { status: "deleted", deletedAt: new Date(), purgeAfter: new Date(Date.now() + 30 * 864e5) } });
  await audit(req, "tenant.delete", t.slug, { tenantId: t.slug });
  F.invalidate();
  res.json({ ok: true, purgeAfterDays: 30 });
}));

// Per-tenant overrides with optional expiry (FR-034)
const overrideSchema = z.object({
  flags: z.record(z.string(), z.boolean()).default({}),
  limits: z.record(z.string(), z.number()).default({}),
  expiresAt: z.string().datetime().nullable().optional(),
  reason: z.string().max(300).optional(),
});
router.put("/tenants/:slug/overrides", A.requirePerm("platform.flags.manage"), wrap(async (req, res) => {
  const b = validate(overrideSchema, req.body);
  const known = new Set(FEATURES.map((f) => f.id));
  for (const k of Object.keys(b.flags)) if (!known.has(k)) throw httpError(400, `Unknown feature ${k}`);
  const db = getDb();
  if (!(await db.collection("tenants").findOne({ slug: req.params.slug }))) throw httpError(404, "Tenant not found.");
  await db.collection("tenantOverrides").updateOne({ tenantId: req.params.slug },
    { $set: { tenantId: req.params.slug, flags: b.flags, limits: b.limits, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null, reason: b.reason || null, updatedAt: new Date() } }, { upsert: true });
  await audit(req, "tenant.overrides", req.params.slug, { tenantId: req.params.slug, after: b, reason: b.reason });
  F.invalidate();
  res.json({ ok: true });
}));

// Impersonation: time-limited (30 min), reason required, tagged in every audit entry (FR-011)
router.post("/tenants/:slug/impersonate", A.requirePerm("platform.tenants.impersonate"), wrap(async (req, res) => {
  const { reason } = validate(z.object({ reason: z.string().min(5).max(300) }), req.body);
  const db = getDb();
  const t = await db.collection("tenants").findOne({ slug: req.params.slug });
  if (!t || t.status === "deleted") throw httpError(404, "Tenant not found.");
  const owner = await db.collection("tenantUsers").findOne({ tenantId: t.slug, role: "owner", status: "active" });
  if (!owner) throw httpError(409, "This tenant has no active owner yet (invitation not accepted).");
  A.setCookie(res, "tenant", A.sign({ sub: String(owner._id), scope: "tenant", tenantId: t.slug, imp: req.actor.id, reason }, 30), 30);
  await audit(req, "tenant.impersonate", t.slug, { tenantId: t.slug, reason });
  res.json({ ok: true, expiresInMinutes: 30 });
}));

// Reset a tenant admin: sends a new invite link, never a password (section 6.2)
router.post("/tenants/:slug/users/:id/reset", A.requirePerm("platform.tenants.suspend"), wrap(async (req, res) => {
  const db = getDb();
  const u = await db.collection("tenantUsers").findOne({ _id: new ObjectId(req.params.id), tenantId: req.params.slug });
  if (!u) throw httpError(404, "User not found.");
  const token = await A.createToken("reset", { scope: "tenant", userId: String(u._id), tenantId: u.tenantId }, 24);
  await audit(req, "tenantUser.resetLink", u.email, { tenantId: u.tenantId });
  res.json({ resetUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/reset?token=${token}` });
}));

router.patch("/tenants/:slug/users/:id", A.requirePerm("platform.tenants.suspend"), wrap(async (req, res) => {
  const { status } = validate(z.object({ status: z.enum(["active", "suspended"]) }), req.body);
  const r = await getDb().collection("tenantUsers").updateOne({ _id: new ObjectId(req.params.id), tenantId: req.params.slug }, { $set: { status } });
  if (!r.matchedCount) throw httpError(404, "User not found.");
  await audit(req, "tenantUser.status", req.params.id, { tenantId: req.params.slug, after: { status } });
  res.json({ ok: true });
}));

// ---------- packages (FR-030..037) ----------
router.get("/packages", wrap(async (req, res) => {
  res.json({ packages: await getDb().collection("packages").find({}).toArray().then((a) => a.sort(byPrice)) });
}));
const pkgSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{2,30}$/), name: z.string().min(2), priceMonthly: z.number().nullable(), priceYearly: z.number().nullable(),
  trialDays: z.number().int().min(0).max(90).default(0), limits: z.record(z.string(), z.number()).default({}),
  flags: z.record(z.string(), z.boolean()).default({}), archived: z.boolean().optional(), cloneFrom: z.string().optional(),
});
router.post("/packages", A.requirePerm("platform.packages.manage"), wrap(async (req, res) => {
  const b = validate(pkgSchema, req.body);
  const db = getDb();
  if (await db.collection("packages").findOne({ key: b.key })) throw httpError(409, "Package key already exists.");
  let { flags, limits } = b;
  if (b.cloneFrom) {
    const src = await db.collection("packages").findOne({ key: b.cloneFrom });
    if (!src) throw httpError(400, "cloneFrom package not found.");
    flags = { ...src.flags, ...flags }; limits = { ...src.limits, ...limits };
  }
  const { cloneFrom, ...rest } = b;
  await db.collection("packages").insertOne({ ...rest, flags, limits, archived: false, createdAt: new Date() });
  await audit(req, "package.create", b.key, { after: { name: b.name } });
  res.status(201).json({ ok: true });
}));
router.patch("/packages/:key", A.requirePerm("platform.packages.manage"), wrap(async (req, res) => {
  const b = validate(pkgSchema.partial().omit({ key: true, cloneFrom: true }), req.body);
  const r = await getDb().collection("packages").updateOne({ key: req.params.key }, { $set: { ...b, updatedAt: new Date() } });
  if (!r.matchedCount) throw httpError(404, "Package not found.");
  await audit(req, "package.update", req.params.key, { after: Object.keys(b) });
  F.invalidate();
  res.json({ ok: true });
}));

// ---------- feature flags (section 11) ----------
router.get("/features", A.requirePerm("platform.flags.manage"), wrap(async (req, res) => {
  const defs = await getDb().collection("featureDefinitions").find({}).toArray();
  const pk = await getDb().collection("packages").find({}).toArray().then((a) => a.sort(byPrice));
  res.json({ features: defs.sort((a, b) => a.id.localeCompare(b.id)), packages: pk.map((p) => ({ key: p.key, name: p.name, flags: p.flags })) });
}));
// Global kill switch / default
router.patch("/features/:id", A.requirePerm("platform.flags.manage"), wrap(async (req, res) => {
  const b = validate(z.object({ killed: z.boolean().optional(), defaultState: z.boolean().optional() }), req.body);
  const r = await getDb().collection("featureDefinitions").updateOne({ id: req.params.id }, { $set: b });
  if (!r.matchedCount) throw httpError(404, "Unknown feature.");
  await audit(req, "feature.global", req.params.id, { after: b });
  F.invalidate();
  res.json({ ok: true });
}));
// Toggle one feature for one package
router.put("/packages/:key/flags/:id", A.requirePerm("platform.flags.manage"), wrap(async (req, res) => {
  const { enabled } = validate(z.object({ enabled: z.boolean() }), req.body);
  if (!FEATURES.find((f) => f.id === req.params.id)) throw httpError(404, "Unknown feature.");
  const r = await getDb().collection("packages").updateOne({ key: req.params.key }, { $set: { [`flags.${req.params.id}`]: enabled } });
  if (!r.matchedCount) throw httpError(404, "Package not found.");
  await audit(req, "package.flag", `${req.params.key}:${req.params.id}`, { after: { enabled } });
  F.invalidate();
  res.json({ ok: true });
}));

// ---------- admins oversight, broadcasts, tickets, audit ----------
router.get("/admins", A.requirePerm("platform.admins.manage"), wrap(async (req, res) => {
  const users = await getDb().collection("tenantUsers").find({}, { projection: { passwordHash: 0, failures: 0 } }).sort({ createdAt: -1 }).limit(500).toArray();
  res.json({ users });
}));

router.post("/broadcasts", A.requirePerm("platform.broadcast.send"), wrap(async (req, res) => {
  const b = validate(z.object({ title: z.string().min(2).max(120), body: z.string().min(2).max(2000), packages: z.array(z.string()).optional(), tenants: z.array(z.string()).optional() }), req.body);
  const db = getDb();
  const q = { status: { $in: ["active", "trial"] } };
  if (b.packages?.length) q.packageId = { $in: b.packages };
  if (b.tenants?.length) q.slug = { $in: b.tenants };
  const targets = await db.collection("tenants").find(q).project({ slug: 1 }).toArray();
  if (targets.length) await db.collection("notifications").insertMany(targets.map((t) => ({ tenantId: t.slug, title: b.title, body: b.body, createdAt: new Date(), read: false, from: "platform" })));
  await db.collection("broadcasts").insertOne({ ...b, sentBy: req.actor.email, recipients: targets.length, createdAt: new Date() });
  await audit(req, "broadcast.send", b.title, { after: { recipients: targets.length } });
  res.json({ ok: true, recipients: targets.length });
}));
router.get("/broadcasts", A.requirePerm("platform.broadcast.send"), wrap(async (req, res) => {
  res.json({ broadcasts: await getDb().collection("broadcasts").find({}).sort({ createdAt: -1 }).limit(100).toArray() });
}));

router.get("/tickets", A.requirePerm("platform.tickets.manage"), wrap(async (req, res) => {
  const q = req.query.status ? { status: req.query.status } : {};
  res.json({ tickets: await getDb().collection("tickets").find(q).sort({ createdAt: -1 }).limit(200).toArray() });
}));
router.patch("/tickets/:id", A.requirePerm("platform.tickets.manage"), wrap(async (req, res) => {
  const b = validate(z.object({ status: z.enum(["open", "pending", "closed"]).optional(), reply: z.string().max(4000).optional() }), req.body);
  const upd = {};
  if (b.status) upd.$set = { status: b.status, updatedAt: new Date() };
  if (b.reply) upd.$push = { messages: { from: "platform", by: req.actor.email, body: b.reply, at: new Date() } };
  if (!Object.keys(upd).length) throw httpError(400, "Nothing to update.");
  const r = await getDb().collection("tickets").updateOne({ _id: new ObjectId(req.params.id) }, upd);
  if (!r.matchedCount) throw httpError(404, "Ticket not found.");
  res.json({ ok: true });
}));

router.get("/audit", A.requirePerm("platform.audit.view"), wrap(async (req, res) => {
  const q = {};
  if (req.query.tenant) q.tenantId = req.query.tenant;
  if (req.query.action) q.action = new RegExp("^" + String(req.query.action).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  res.json({ logs: await getDb().collection("auditLogs").find(q).sort({ createdAt: -1 }).limit(300).toArray() });
}));

// ---------- payments from stores (bank / wallet transfers) ----------
const { platformConfig, withIds } = require("../lib/payconfig");
const { sendPrivateImage } = require("../lib/files");
const mailer = require("../lib/mailer");

router.get("/payment-settings", A.requirePerm("platform.billing.view"), wrap(async (req, res) => {
  res.json((await getDb().collection("platformSettings").findOne({ _id: "payments" })) || { methods: [], instructions: "" });
}));
router.put("/payment-settings", A.requirePerm("platform.billing.manage"), wrap(async (req, res) => {
  const b = validate(platformConfig, req.body);
  if (b.methods.some((m) => !m.accountNumber.trim())) throw httpError(400, "Every account needs an account or wallet number.");
  b.methods = withIds(b.methods);
  await getDb().collection("platformSettings").updateOne({ _id: "payments" }, { $set: { ...b, updatedAt: new Date() } }, { upsert: true });
  await audit(req, "billing.paymentSettings", String(b.methods.length));
  res.json({ ok: true });
}));

router.get("/billing-requests", A.requirePerm("platform.billing.view"), wrap(async (req, res) => {
  const status = ["pending", "approved", "rejected", "cancelled"].includes(req.query.status) ? req.query.status : null;
  const col = getDb().collection("billingRequests");
  const list = await col.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).toArray();
  res.json({ pendingCount: await col.countDocuments({ status: "pending" }),
    requests: list.map((r) => ({ ...r, proof: { reference: r.proof?.reference || "", submittedAt: r.proof?.submittedAt, imageUrl: r.proof?.imageKey ? `/api/platform/billing-requests/proof/${r.proof.imageKey}` : null } })) });
}));
router.get("/billing-requests/proof/:scope/:file", A.requirePerm("platform.billing.view"), wrap(async (req, res) => sendPrivateImage(res, `${req.params.scope}/${req.params.file}`)));

router.post("/billing-requests/:id/approve", A.requirePerm("platform.billing.manage"), wrap(async (req, res) => {
  const db = getDb();
  if (!ObjectId.isValid(req.params.id)) throw httpError(400, "Invalid id.");
  const r = await db.collection("billingRequests").findOne({ _id: new ObjectId(req.params.id), status: "pending" });
  if (!r) throw httpError(404, "No pending request found.");
  const t = await db.collection("tenants").findOne({ slug: r.tenantId });
  if (!t || t.status === "deleted") throw httpError(409, "That store no longer exists.");
  // renewing the same package extends from the current end date; otherwise it starts now
  const now = Date.now(), cur = t.paidUntil ? new Date(t.paidUntil).getTime() : 0;
  const base = t.packageId === r.packageId && cur > now ? cur : now;
  const paidUntil = new Date(base + (r.interval === "year" ? 365 : 30) * 864e5);
  await db.collection("tenants").updateOne({ slug: t.slug }, { $set: { packageId: r.packageId, status: t.status === "suspended" ? "suspended" : "active", trialEndsAt: null, paidUntil, billing: { state: "active" } } });
  await db.collection("billingRequests").updateOne({ _id: r._id }, { $set: { status: "approved", decidedBy: req.actor.email, decidedAt: new Date(), paidUntil } });
  F.invalidate();
  await db.collection("notifications").insertOne({ tenantId: t.slug, title: "Payment approved", body: `Your ${r.packageName} package is active until ${paidUntil.toDateString()}.`, createdAt: new Date(), read: false, from: "platform" });
  const owner = await db.collection("tenantUsers").findOne({ tenantId: t.slug, role: "owner", status: "active" });
  if (owner) mailer.send("billingApproved", owner.email, { name: owner.name, plan: r.packageName, until: paidUntil.toDateString() }).catch(() => {});
  await audit(req, "billing.approved", t.slug, { tenantId: t.slug, after: { packageId: r.packageId, paidUntil } });
  res.json({ ok: true, paidUntil });
}));

router.post("/billing-requests/:id/reject", A.requirePerm("platform.billing.manage"), wrap(async (req, res) => {
  const { reason } = validate(z.object({ reason: z.string().min(3).max(300) }), req.body);
  const db = getDb();
  if (!ObjectId.isValid(req.params.id)) throw httpError(400, "Invalid id.");
  const r = await db.collection("billingRequests").findOne({ _id: new ObjectId(req.params.id), status: "pending" });
  if (!r) throw httpError(404, "No pending request found.");
  await db.collection("billingRequests").updateOne({ _id: r._id }, { $set: { status: "rejected", rejectReason: reason, decidedBy: req.actor.email, decidedAt: new Date() } });
  await db.collection("notifications").insertOne({ tenantId: r.tenantId, title: "Payment not accepted", body: `Your payment for the ${r.packageName} package could not be confirmed: ${reason}`, createdAt: new Date(), read: false, from: "platform" });
  const owner = await db.collection("tenantUsers").findOne({ tenantId: r.tenantId, role: "owner", status: "active" });
  if (owner) mailer.send("billingRejected", owner.email, { name: owner.name, plan: r.packageName, reason }).catch(() => {});
  await audit(req, "billing.rejected", r.tenantId, { tenantId: r.tenantId, reason });
  res.json({ ok: true });
}));

// Development helper: restore the demo store to its starting state (never available in production).
if (process.env.NODE_ENV !== "production") {
  router.post("/dev/reset-demo", A.requirePerm("platform.tenants.delete"), wrap(async (req, res) => {
    const { seed, resetDemo } = require("../seed");
    await resetDemo(); await seed(); F.invalidate();
    res.json({ ok: true });
  }));
}

module.exports = router;
