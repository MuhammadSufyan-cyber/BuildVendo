// Public API (no sign-in): price list, store sign-up with email verification (SRS FR-002).
const express = require("express");
const { z } = require("zod");
const { getDb } = require("../db");
const A = require("../lib/auth");
const mail = require("../lib/mailer");
const { slugify, wrap, validate, httpError, rateLimit } = require("../lib/util");
const { FEATURES } = require("../lib/features");

const router = express.Router();
const RESERVED = ["admin", "api", "platform", "login", "s", "www", "dashboard", "start", "verify", "invite", "reset", "uploads", "pricing"];
const signupLimit = rateLimit({ windowMs: 60_000, max: 6 });

router.get("/packages", wrap(async (_req, res) => {
  const pk = await getDb().collection("packages").find({ archived: { $ne: true } }).toArray();
  pk.sort((a, b) => (a.priceMonthly ?? Infinity) - (b.priceMonthly ?? Infinity));
  const names = Object.fromEntries(FEATURES.map((f) => [f.id, f.name]));
  res.json({ packages: pk.map((p) => ({ key: p.key, name: p.name, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, trialDays: p.trialDays, limits: p.limits,
    featureCount: Object.values(p.flags || {}).filter(Boolean).length, highlights: ["AI-01", "PLT-02", "POS-01", "PAY-10", "ANA-03"].filter((id) => p.flags?.[id]).map((id) => names[id]) })) });
}));

// Used by the web server to find which store a host name belongs to (subdomain or verified custom domain).
router.get("/resolve-host", wrap(async (req, res) => {
  const host = String(req.query.host || "").toLowerCase().replace(/:\d+$/, "");
  const root = (process.env.ROOT_DOMAIN || "localhost").toLowerCase();
  let slug = null;
  if (host.endsWith("." + root)) slug = host.slice(0, -(root.length + 1));
  else {
    const t = await getDb().collection("tenants").findOne({ domains: { $elemMatch: { name: host, verified: true } }, status: { $nin: ["deleted"] } }, { projection: { slug: 1 } });
    if (t) slug = t.slug;
  }
  if (slug && (slug.includes(".") || ["www", "api", "admin"].includes(slug))) slug = null;
  res.set("Cache-Control", "public, max-age=30").json({ slug });
}));

router.get("/check-slug", wrap(async (req, res) => {
  const slug = slugify(req.query.slug || "");
  const taken = RESERVED.includes(slug) || !!(await getDb().collection("tenants").findOne({ slug }));
  res.json({ slug, available: !taken });
}));

const signup = z.object({
  storeName: z.string().min(2).max(60),
  slug: z.string().max(40).optional(),
  ownerName: z.string().min(2).max(80),
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string(),
  requirements: z.string().max(10000).optional(),
});

router.post("/signup", signupLimit, wrap(async (req, res) => {
  const b = validate(signup, req.body);
  const problem = A.passwordProblem(b.password);
  if (problem) throw httpError(400, problem);
  const db = getDb();
  let slug = slugify(b.slug || b.storeName);
  if (RESERVED.includes(slug)) slug += "-store";
  if (await db.collection("tenants").findOne({ slug })) slug += "-" + Math.random().toString(36).slice(2, 6);
  const pkg = await db.collection("packages").findOne({ key: "premium" });
  const days = (pkg && pkg.trialDays) || 14;
  const now = new Date();
  await db.collection("tenants").insertOne({
    slug, name: b.storeName, status: "pending", packageId: "premium", afterTrialPackage: "free", region: "default", createdAt: now,
    trialEndsAt: new Date(now.getTime() + days * 864e5), signupRequirements: b.requirements || null, selfSignup: true,
    settings: { currency: "USD", tagline: "", theme: { primary: "#6b3410", accent: "#f08c00", font: "sans", style: "modern" }, taxRatePct: 0, shippingFlat: 500, freeShippingOver: 0 },
  });
  const u = await db.collection("tenantUsers").insertOne({ tenantId: slug, email: b.email, name: b.ownerName, role: "owner", status: "unverified", passwordHash: await A.hashPassword(b.password), createdAt: now });
  const token = await A.createToken("verify", { userId: String(u.insertedId), tenantId: slug }, 24);
  const url = `${mail.appUrl()}/verify?token=${token}`;
  await mail.send("verify", b.email, { name: b.ownerName, url });
  await db.collection("notifications").insertOne({ tenantId: slug, title: "Welcome!", body: `Your ${days}-day trial of every feature has started.`, createdAt: now, read: false });
  await db.collection("auditLogs").insertOne({ createdAt: now, actor: { id: null, email: b.email, scope: "public", role: null }, tenantId: slug, action: "tenant.signup", target: slug, ip: req.ip });
  // In development without an email service the link is returned so the sign-up flow can be tried.
  const dev = !mail.configured() && process.env.NODE_ENV !== "production";
  res.status(201).json({ slug, emailSent: mail.configured(), trialDays: days, ...(dev ? { devVerifyUrl: url } : {}) });
}));

// The emailed link proves the address and signs the owner in once.
router.post("/verify", signupLimit, wrap(async (req, res) => {
  const { token } = validate(z.object({ token: z.string().min(10) }), req.body);
  const data = await A.consumeToken("verify", token);
  if (!data) throw httpError(400, "This link is invalid or has expired. Request a new one from the sign-in page.");
  const db = getDb();
  const { ObjectId } = require("mongodb");
  await db.collection("tenantUsers").updateOne({ _id: new ObjectId(data.userId) }, { $set: { status: "active", emailVerifiedAt: new Date() } });
  await db.collection("tenants").updateOne({ slug: data.tenantId, status: "pending" }, { $set: { status: "trial" } });
  A.setCookie(res, "tenant", A.sign({ sub: data.userId, scope: "tenant", tenantId: data.tenantId }, 8 * 60), 8 * 60);
  res.json({ ok: true, slug: data.tenantId });
}));

router.post("/resend-verification", signupLimit, wrap(async (req, res) => {
  const b = validate(z.object({ slug: z.string(), email: z.string().email().transform((s) => s.toLowerCase()) }), req.body);
  const u = await getDb().collection("tenantUsers").findOne({ tenantId: b.slug.toLowerCase(), email: b.email, status: "unverified" });
  if (u) {
    const token = await A.createToken("verify", { userId: String(u._id), tenantId: u.tenantId }, 24);
    const url = `${mail.appUrl()}/verify?token=${token}`;
    await mail.send("verify", u.email, { name: u.name, url });
    if (!mail.configured() && process.env.NODE_ENV !== "production") return res.json({ ok: true, devVerifyUrl: url });
  }
  res.json({ ok: true }); // never reveals whether the account exists
}));

module.exports = router;
