// Tests the Stripe webhook handler with correctly SIGNED fake events. No real Stripe account or network needed.
// Usage: node test/stripe-webhook.js   (uses the database in backend/.env)
process.env.STRIPE_SECRET_KEY = ("sk_" + "test_" + "0".repeat(24)) /* dummy value, built in code so it is not mistaken for a real key */;
process.env.STRIPE_WEBHOOK_SECRET = ("whsec_" + "unit_test_secret");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
process.env.STRIPE_SECRET_KEY = ("sk_" + "test_" + "0".repeat(24)) /* dummy value, built in code so it is not mistaken for a real key */;
process.env.STRIPE_WEBHOOK_SECRET = ("whsec_" + "unit_test_secret");

const { Stripe } = require("../src/lib/stripe");
const { connect, getDb, close } = require("../src/db");

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  PASS", n); } else { fail++; console.log("  FAIL", n, x !== undefined ? JSON.stringify(x) : ""); } };

(async () => {
  await connect();
  const app = require("../src/app");
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const slug = "smoketest-hook";
  const db = getDb();
  await db.collection("tenants").deleteMany({ slug });
  await db.collection("tenants").insertOne({ slug, name: "Hook Test", status: "active", packageId: "basic", createdAt: new Date(), settings: {} });

  const post = async (event, sig) => {
    const payload = JSON.stringify(event);
    const header = sig ?? stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const r = await fetch(base + "/api/webhooks/stripe", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const id = () => "evt_test_" + Math.random().toString(36).slice(2);
  const tenant = () => db.collection("tenants").findOne({ slug });

  console.log("\n[Stripe webhook]");
  const upgrade = { id: id(), object: "event", type: "checkout.session.completed", data: { object: { object: "checkout.session", mode: "subscription", customer: "cus_test_1", subscription: "sub_test_1", metadata: { tenantId: slug, packageId: "premium" } } } };
  check("forged signature is rejected", (await post(upgrade, "t=1,v1=deadbeef")).status === 400);
  check("missing signature is rejected", (await post(upgrade, "")).status === 400);
  check("tenant unchanged after forged request", (await tenant()).packageId === "basic");
  check("signed checkout event is accepted", (await post(upgrade)).status === 200);
  let t = await tenant();
  check("tenant upgraded to premium and linked to Stripe", t.packageId === "premium" && t.stripeSubscriptionId === "sub_test_1" && t.billing.state === "active", t);
  const dup = await post(upgrade);
  check("replayed event is ignored (idempotent)", dup.status === 200 && dup.data.duplicate === true, dup.data);
  const failed = { id: id(), object: "event", type: "invoice.payment_failed", data: { object: { object: "invoice", customer: "cus_test_1" } } };
  check("payment failure accepted", (await post(failed)).status === 200);
  t = await tenant();
  check("tenant marked past_due", t.billing.state === "past_due");
  check("tenant notified of failed payment", !!(await db.collection("notifications").findOne({ tenantId: slug, title: "Payment failed" })));
  check("successful invoice clears past_due", (await post({ id: id(), object: "event", type: "invoice.paid", data: { object: { object: "invoice", customer: "cus_test_1" } } })).status === 200 && (await tenant()).billing.state === "active");
  const cancelled = { id: id(), object: "event", type: "customer.subscription.deleted", data: { object: { object: "subscription", id: "sub_test_1" } } };
  check("cancellation accepted", (await post(cancelled)).status === 200);
  t = await tenant();
  check("cancelled subscription drops tenant to free", t.packageId === "free" && !t.stripeSubscriptionId, t.packageId);
  check("billing actions are audit logged", (await db.collection("auditLogs").countDocuments({ tenantId: slug, "actor.scope": "stripe" })) >= 3);

  // cleanup
  await db.collection("tenants").deleteMany({ slug });
  await db.collection("notifications").deleteMany({ tenantId: slug });
  await db.collection("auditLogs").deleteMany({ tenantId: slug });
  await db.collection("tenantUsers").deleteMany({ tenantId: slug });
  server.close(); await close();
  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("crashed:", e); process.exit(2); });
