// Store admin portal for online payments that are confirmed by hand: bank / wallet transfers and gateway links (PAY-04, PAY-06).
const express = require("express");
const { z } = require("zod");
const { ObjectId } = require("mongodb");
const { getDb } = require("../db");
const A = require("../lib/auth");
const F = require("../lib/flags");
const { scoped } = require("../lib/repo");
const { storeConfig, withIds, defaultStoreConfig } = require("../lib/payconfig");
const { sendPrivateImage } = require("../lib/files");
const mail = require("../lib/mailer");
const W = require("../lib/webhooks");
const { audit, wrap, validate, httpError } = require("../lib/util");

const router = express.Router();
router.use(A.authenticate("tenant"));
router.use((req, res, next) => {
  if (req.tenant.status === "deleted" || (req.tenant.status === "suspended" && req.method !== "GET")) return res.status(403).json({ error: "This store is not available." });
  req.R = scoped(req.actor.tenantId);
  next();
});
const oid = (id) => { if (!ObjectId.isValid(id)) throw httpError(400, "Invalid id."); return new ObjectId(id); };
const manualOrGateway = { "payments.0.method": { $in: ["manual", "gateway"] } };
const money = (o) => new Intl.NumberFormat("en", { style: "currency", currency: o.currency }).format(o.total / 100);

// ----- payment methods the store offers -----
router.get("/config", A.requirePerm("settings.manage"), wrap(async (req, res) => {
  const { flags } = await F.resolve(req.tenant);
  res.json({ config: req.tenant.paymentConfig || defaultStoreConfig(), available: { manual: !!flags["PAY-04"], gateway: !!flags["PAY-06"] }, cod: !!flags["PAY-03"] });
}));

router.put("/config", A.requirePerm("settings.manage"), wrap(async (req, res) => {
  const b = validate(storeConfig, req.body);
  const { flags } = await F.resolve(req.tenant);
  if (b.manual.enabled) {
    if (!flags["PAY-04"]) throw httpError(403, "Bank or wallet transfer is not available on your package (PAY-04).", { upgrade: true });
    if (!b.manual.methods.length) throw httpError(400, "Add at least one bank or wallet account before turning transfers on.");
    if (b.manual.methods.some((m) => !m.accountNumber.trim())) throw httpError(400, "Every account needs an account or wallet number.");
  }
  if (b.gateway.enabled) {
    if (!flags["PAY-06"]) throw httpError(403, "A payment gateway link is not available on your package (PAY-06).", { upgrade: true });
    if (!b.gateway.url) throw httpError(400, "Enter the payment page link before turning the gateway on.");
  }
  b.manual.methods = withIds(b.manual.methods);
  await getDb().collection("tenants").updateOne({ slug: req.tenant.slug }, { $set: { paymentConfig: b } });
  await audit(req, "payments.config", req.tenant.slug, { after: { manual: b.manual.enabled, gateway: b.gateway.enabled, methods: b.manual.methods.length } });
  res.json({ ok: true, config: b });
}));

// ----- the verification queue -----
router.get("/queue", A.requirePerm("orders.refund"), wrap(async (req, res) => {
  const f = req.query.filter;
  const q = { status: "pending", ...manualOrGateway };
  if (f === "submitted") q["payments.0.status"] = "submitted";
  else if (f === "awaiting") q["payments.0.status"] = { $in: ["awaiting", "rejected"] };
  const orders = await req.R.orders.find(q).sort({ createdAt: -1 }).limit(200).toArray();
  const counts = {
    submitted: await req.R.orders.count({ status: "pending", ...manualOrGateway, "payments.0.status": "submitted" }),
    awaiting: await req.R.orders.count({ status: "pending", ...manualOrGateway, "payments.0.status": { $in: ["awaiting", "rejected"] } }),
  };
  res.json({
    counts,
    orders: orders.map((o) => ({ _id: o._id, number: o.number, createdAt: o.createdAt, total: o.total, currency: o.currency, customer: o.customer, method: o.payments[0].method, payment: { status: o.payments[0].status, rejectReason: o.payments[0].rejectReason || null,
      proof: o.payments[0].proof ? { reference: o.payments[0].proof.reference || "", methodLabel: o.payments[0].proof.methodLabel || "", submittedAt: o.payments[0].proof.submittedAt, imageUrl: o.payments[0].proof.imageKey ? `/api/admin/payments/proof/${o.payments[0].proof.imageKey}` : null } : null } })),
  });
}));

// Proof screenshots are private: only staff who can approve payments may open them, and only for their own store.
router.get("/proof/:scope/:file", A.requirePerm("orders.refund"), wrap(async (req, res) => {
  if (req.params.scope !== req.tenant.slug) throw httpError(404, "File not found.");
  sendPrivateImage(res, `${req.params.scope}/${req.params.file}`);
}));

async function loadPending(req) {
  const o = await req.R.orders.findOne({ _id: oid(req.params.id), status: "pending", ...manualOrGateway });
  if (!o) throw httpError(404, "That order is not waiting for payment confirmation.");
  return o;
}

router.post("/:id/approve", A.requirePerm("orders.refund"), wrap(async (req, res) => {
  const o = await loadPending(req);
  const { note } = validate(z.object({ note: z.string().max(300).optional() }), req.body || {});
  await req.R.orders.updateOne({ _id: o._id }, { $set: { status: "paid", "payments.0.status": "paid", "payments.0.ref": o.payments[0].proof?.reference || "confirmed by store", "payments.0.confirmedBy": req.actor.email, "payments.0.confirmedAt": new Date() },
    $push: { timeline: { at: new Date(), status: "paid", note: note || "Payment confirmed by the store", by: req.actor.email } } });
  await audit(req, "payment.approved", o.number, { after: { total: o.total } });
  await require("../lib/loyalty").award(req.R, req.tenant, { ...o, status: "paid" });
  W.emit(req.actor.tenantId, "order.paid", { number: o.number, status: "paid", total: o.total, currency: o.currency, customer: o.customer });
  if (o.customer?.email) mail.send("order", o.customer.email, { store: req.tenant.name, order: o, money: money(o) }).catch(() => {});
  res.json({ ok: true });
}));

router.post("/:id/reject", A.requirePerm("orders.refund"), wrap(async (req, res) => {
  const o = await loadPending(req);
  const { reason } = validate(z.object({ reason: z.string().min(3).max(300) }), req.body);
  await req.R.orders.updateOne({ _id: o._id }, { $set: { "payments.0.status": "rejected", "payments.0.rejectReason": reason, "payments.0.proof.status": "rejected" },
    $push: { timeline: { at: new Date(), status: "pending", note: `Payment not accepted: ${reason}`, by: req.actor.email } } });
  await audit(req, "payment.rejected", o.number, { reason });
  if (o.customer?.email) mail.send("proofRejected", o.customer.email, { store: req.tenant.name, number: o.number, reason, url: `${mail.appUrl()}/s/${req.tenant.slug}/order?number=${o.number}&t=${o.payToken}` }).catch(() => {});
  res.json({ ok: true });
}));

module.exports = router;
