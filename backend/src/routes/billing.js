// Tenant billing (the platform charging stores for their package) and a store's own payment-gateway settings.
const express = require("express");
const { z } = require("zod");
const { getDb } = require("../db");
const A = require("../lib/auth");
const F = require("../lib/flags");
const { encrypt } = require("../lib/crypto");
const { platformStripe, Stripe } = require("../lib/stripe");
const mail = require("../lib/mailer");
const { audit, wrap, validate, httpError } = require("../lib/util");

const router = express.Router();
router.use(A.authenticate("tenant"));
router.use((req, res, next) => {
  if (req.tenant.status === "deleted" || (req.tenant.status === "suspended" && req.method !== "GET")) return res.status(403).json({ error: "This store is not available." });
  next();
});
const app = () => process.env.FRONTEND_URL || "http://localhost:3000";
const PLATFORM_CURRENCY = (process.env.PLATFORM_CURRENCY || "PKR").toUpperCase(); // currency of package prices

router.get("/status", A.requirePerm("plan.billing.manage"), wrap(async (req, res) => {
  const t = req.tenant;
  res.json({ stripeConfigured: !!platformStripe(), hasSubscription: !!t.stripeSubscriptionId, state: (t.billing && t.billing.state) || "none", paymentFailedAt: t.billing?.paymentFailedAt || null });
}));

// Start or change a paid subscription.
router.post("/checkout", A.requirePerm("plan.billing.manage"), wrap(async (req, res) => {
  const b = validate(z.object({ packageId: z.string(), interval: z.enum(["month", "year"]).default("month") }), req.body);
  const stripe = platformStripe();
  if (!stripe) throw httpError(501, "Online billing is not set up on this platform yet.");
  const db = getDb(), t = req.tenant;
  const pkg = await db.collection("packages").findOne({ key: b.packageId, archived: { $ne: true } });
  if (!pkg) throw httpError(400, "Unknown package.");
  const price = b.interval === "year" ? pkg.priceYearly : pkg.priceMonthly;
  if (price == null) throw httpError(400, "This package is priced individually. Please contact sales.");

  if (price === 0) { // moving to a free package: cancel the paid subscription at the end of the period
    if (t.stripeSubscriptionId) await stripe.subscriptions.update(t.stripeSubscriptionId, { cancel_at_period_end: true });
    else await db.collection("tenants").updateOne({ slug: t.slug }, { $set: { packageId: pkg.key, status: "active" } });
    await audit(req, "plan.downgrade", pkg.key); F.invalidate();
    return res.json({ ok: true, changed: !t.stripeSubscriptionId, scheduled: !!t.stripeSubscriptionId });
  }
  const recurring = { interval: b.interval };
  const cents = Math.round(price * 100);

  if (t.stripeSubscriptionId) { // existing subscription: switch plan with proration (FR-033)
    const sub = await stripe.subscriptions.retrieve(t.stripeSubscriptionId);
    const item = sub.items.data[0];
    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false, proration_behavior: "create_prorations", metadata: { tenantId: t.slug, packageId: pkg.key },
      items: [{ id: item.id, price_data: { currency: PLATFORM_CURRENCY.toLowerCase(), unit_amount: cents, recurring, product: typeof item.price.product === "string" ? item.price.product : item.price.product.id } }] });
    await db.collection("tenants").updateOne({ slug: t.slug }, { $set: { packageId: pkg.key, status: "active" } });
    await audit(req, "plan.change", pkg.key, { before: { packageId: t.packageId }, after: { packageId: pkg.key } }); F.invalidate();
    return res.json({ ok: true, changed: true });
  }
  let customer = t.stripeCustomerId;
  if (!customer) { customer = (await stripe.customers.create({ email: req.actor.email, name: t.name, metadata: { tenantId: t.slug } })).id; await db.collection("tenants").updateOne({ slug: t.slug }, { $set: { stripeCustomerId: customer } }); }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription", customer, metadata: { tenantId: t.slug, packageId: pkg.key }, subscription_data: { metadata: { tenantId: t.slug, packageId: pkg.key } },
    line_items: [{ quantity: 1, price_data: { currency: PLATFORM_CURRENCY.toLowerCase(), unit_amount: cents, recurring, product_data: { name: `${pkg.name} package` } } }],
    success_url: `${app()}/dashboard/plan?paid=1`, cancel_url: `${app()}/dashboard/plan?cancelled=1`,
  });
  await audit(req, "plan.checkoutStarted", pkg.key);
  res.json({ url: session.url });
}));

router.post("/portal", A.requirePerm("plan.billing.manage"), wrap(async (req, res) => {
  const stripe = platformStripe();
  if (!stripe) throw httpError(501, "Online billing is not set up on this platform yet.");
  if (!req.tenant.stripeCustomerId) throw httpError(409, "You have no paid subscription yet.");
  const s = await stripe.billingPortal.sessions.create({ customer: req.tenant.stripeCustomerId, return_url: `${app()}/dashboard/plan` });
  res.json({ url: s.url });
}));

// ----- the store's own Stripe account for taking shopper payments (PAY-04) -----
router.get("/payments", A.requirePerm("settings.manage"), wrap(async (req, res) => {
  const s = req.tenant.stripe;
  res.json({ connected: !!(s && s.keyEnc), mode: s?.mode || null, last4: s?.last4 || null, account: s?.account || null, connectedAt: s?.connectedAt || null });
}));
router.put("/payments", A.requirePerm("settings.manage"), F.requireFlag("PAY-04"), wrap(async (req, res) => {
  const { secretKey } = validate(z.object({ secretKey: z.string().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]{16,}$/, "That does not look like a Stripe secret key (it starts with sk_test_ or sk_live_).") }), req.body);
  let account;
  try { account = await new Stripe(secretKey).accounts.retrieve(); } catch { throw httpError(400, "Stripe rejected this key. Check that you copied the whole secret key."); }
  await getDb().collection("tenants").updateOne({ slug: req.tenant.slug }, { $set: { stripe: { keyEnc: encrypt(secretKey), mode: secretKey.includes("_live_") ? "live" : "test", last4: secretKey.slice(-4), account: account.business_profile?.name || account.id, connectedAt: new Date() } } });
  await audit(req, "payments.stripeConnected", secretKey.includes("_live_") ? "live" : "test");
  res.json({ ok: true });
}));
router.delete("/payments", A.requirePerm("settings.manage"), wrap(async (req, res) => {
  await getDb().collection("tenants").updateOne({ slug: req.tenant.slug }, { $unset: { stripe: "" } });
  await audit(req, "payments.stripeDisconnected", req.tenant.slug);
  res.json({ ok: true });
}));

// ----- paying the platform by bank / wallet transfer, approved by the Super Admin -----
const { savePrivateImage } = require("../lib/files");
router.get("/platform-info", A.requirePerm("plan.billing.manage"), wrap(async (req, res) => {
  const db = getDb(), t = req.tenant;
  const settings = (await db.collection("platformSettings").findOne({ _id: "payments" })) || { methods: [], instructions: "" };
  const history = await db.collection("billingRequests").find({ tenantId: t.slug }).sort({ createdAt: -1 }).limit(10).project({ "proof.imageKey": 0 }).toArray();
  res.json({ methods: settings.methods, instructions: settings.instructions, paidUntil: t.paidUntil || null, history, pending: history.find((h) => h.status === "pending") || null });
}));

router.post("/request", A.requirePerm("plan.billing.manage"), wrap(async (req, res) => {
  const b = validate(z.object({ packageId: z.string(), interval: z.enum(["month", "year"]).default("month"), reference: z.string().max(120).default(""), image: z.string().max(3_000_000).optional() }), req.body);
  const db = getDb(), t = req.tenant;
  const pkg = await db.collection("packages").findOne({ key: b.packageId, archived: { $ne: true } });
  if (!pkg) throw httpError(400, "Unknown package.");
  const price = b.interval === "year" ? pkg.priceYearly : pkg.priceMonthly;
  if (price == null) throw httpError(400, "This package is priced individually. Please contact the platform team.");
  if (price === 0) throw httpError(400, "The Free package needs no payment.");
  if (!b.reference.trim() && !b.image) throw httpError(400, "Please enter the transaction reference or attach a screenshot of your payment.");
  if (await db.collection("billingRequests").findOne({ tenantId: t.slug, status: "pending" })) throw httpError(409, "You already have a payment waiting for approval.");
  const imageKey = b.image ? savePrivateImage(t.slug, b.image, 2 * 1024 * 1024) : null;
  await db.collection("billingRequests").insertOne({ tenantId: t.slug, tenantName: t.name, packageId: pkg.key, packageName: pkg.name, interval: b.interval, amount: price, currency: PLATFORM_CURRENCY, status: "pending",
    proof: { reference: b.reference.trim(), imageKey, submittedAt: new Date() }, requestedBy: req.actor.email, createdAt: new Date() });
  await audit(req, "billing.requested", pkg.key, { after: { interval: b.interval, amount: price } });
  res.status(201).json({ ok: true });
}));

router.delete("/request/:id", A.requirePerm("plan.billing.manage"), wrap(async (req, res) => {
  const { ObjectId } = require("mongodb");
  if (!ObjectId.isValid(req.params.id)) throw httpError(400, "Invalid id.");
  const r = await getDb().collection("billingRequests").updateOne({ _id: new ObjectId(req.params.id), tenantId: req.tenant.slug, status: "pending" }, { $set: { status: "cancelled", decidedAt: new Date() } });
  if (!r.matchedCount) throw httpError(404, "No pending request found.");
  res.json({ ok: true });
}));

module.exports = router;
