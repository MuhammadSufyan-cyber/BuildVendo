// Stripe webhook for the PLATFORM account (tenant subscriptions). Needs the raw body for signature checking,
// so this router is mounted BEFORE express.json() in app.js.
const express = require("express");
const { getDb } = require("../db");
const F = require("../lib/flags");
const mail = require("../lib/mailer");
const { platformStripe } = require("../lib/stripe");
const { wrap } = require("../lib/util");

const router = express.Router();

async function log(action, tenantId, extra) {
  await getDb().collection("auditLogs").insertOne({ createdAt: new Date(), actor: { id: null, email: "stripe", scope: "stripe", role: null }, tenantId, action, target: extra?.target || null, after: extra?.after || null, ip: null });
}

router.post("/stripe", express.raw({ type: "application/json", limit: "1mb" }), wrap(async (req, res) => {
  const stripe = platformStripe(), secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return res.status(501).json({ error: "Stripe webhooks are not configured." });
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret); }
  catch { return res.status(400).json({ error: "Invalid signature." }); }

  const db = getDb();
  try { await db.collection("stripeEvents").insertOne({ _id: event.id, type: event.type, at: new Date() }); }
  catch (e) { if (e.code === 11000) return res.json({ received: true, duplicate: true }); throw e; } // idempotent: replays do nothing

  const obj = event.data.object;
  if (event.type === "checkout.session.completed" && obj.mode === "subscription") {
    const { tenantId, packageId } = obj.metadata || {};
    if (tenantId && packageId) {
      await db.collection("tenants").updateOne({ slug: tenantId }, { $set: { packageId, status: "active", stripeCustomerId: obj.customer, stripeSubscriptionId: obj.subscription, trialEndsAt: null, billing: { state: "active" } } });
      F.invalidate();
      await log("billing.subscribed", tenantId, { target: packageId });
      const owner = await db.collection("tenantUsers").findOne({ tenantId, role: "owner", status: "active" });
      const pkg = await db.collection("packages").findOne({ key: packageId });
      if (owner) mail.send("receipt", owner.email, { name: owner.name, plan: pkg ? pkg.name : packageId }).catch(() => {});
    }
  } else if (event.type === "customer.subscription.deleted") {
    const t = await db.collection("tenants").findOneAndUpdate({ stripeSubscriptionId: obj.id }, { $set: { packageId: "free", billing: { state: "cancelled" } }, $unset: { stripeSubscriptionId: "" } });
    if (t) { F.invalidate(); await log("billing.cancelled", t.slug); }
  } else if (event.type === "invoice.payment_failed") {
    const t = await db.collection("tenants").findOneAndUpdate({ stripeCustomerId: obj.customer }, { $set: { billing: { state: "past_due", paymentFailedAt: new Date() } } });
    if (t) {
      await db.collection("notifications").insertOne({ tenantId: t.slug, title: "Payment failed", body: "We could not charge your card for your package. Please update your payment method in Plan & usage. Stripe will retry automatically.", createdAt: new Date(), read: false, from: "platform" });
      await log("billing.paymentFailed", t.slug);
    }
  } else if (event.type === "invoice.paid") {
    await db.collection("tenants").updateOne({ stripeCustomerId: obj.customer }, { $set: { billing: { state: "active" } } });
  }
  res.json({ received: true });
}));

module.exports = router;
