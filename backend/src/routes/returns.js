// Returns portal, store side (ORD-03): review return requests, approve or reject, and refund (fully or partly).
const express = require("express");
const { z } = require("zod");
const { ObjectId } = require("mongodb");
const A = require("../lib/auth");
const F = require("../lib/flags");
const { scoped } = require("../lib/repo");
const { restock } = require("../lib/orders");
const mail = require("../lib/mailer");
const { audit, wrap, validate, httpError } = require("../lib/util");

const router = express.Router();
router.use(A.authenticate("tenant"));
router.use((req, res, next) => {
  if (req.tenant.status === "deleted" || (req.tenant.status === "suspended" && req.method !== "GET")) return res.status(403).json({ error: "This store is not available." });
  req.R = scoped(req.actor.tenantId);
  next();
});
router.use(A.requirePerm("orders.refund"), F.requireFlag("ORD-03"));
const oid = (id) => { if (!ObjectId.isValid(id)) throw httpError(400, "Invalid id."); return new ObjectId(id); };
const col = (req) => req.R.col("returns");

router.get("/", wrap(async (req, res) => {
  const q = req.query.status ? { status: String(req.query.status) } : {};
  const list = await col(req).find(q).sort({ createdAt: -1 }).limit(200).toArray();
  const counts = {};
  for (const s of ["requested", "approved", "rejected", "refunded"]) counts[s] = await col(req).count({ status: s });
  res.json({ returns: list, counts });
}));

async function pending(req, allowed) {
  const r = await col(req).findOne({ _id: oid(req.params.id) });
  if (!r) throw httpError(404, "Return not found.");
  if (!allowed.includes(r.status)) throw httpError(409, `This return is already ${r.status}.`);
  return r;
}
const tell = (req, r, note) => r.customerEmail && mail.send("returnUpdate", r.customerEmail, { store: req.tenant.name, number: r.orderNumber, status: r.status, note: note || "" }).catch(() => {});

router.post("/:id/approve", wrap(async (req, res) => {
  const r = await pending(req, ["requested"]);
  const { note } = validate(z.object({ note: z.string().max(300).optional() }), req.body || {});
  await col(req).updateOne({ _id: r._id }, { $set: { status: "approved", decidedBy: req.actor.email, decidedAt: new Date(), note: note || "" } });
  await audit(req, "return.approved", r.orderNumber);
  tell(req, { ...r, status: "approved" }, note);
  res.json({ ok: true });
}));

router.post("/:id/reject", wrap(async (req, res) => {
  const r = await pending(req, ["requested", "approved"]);
  const { reason } = validate(z.object({ reason: z.string().min(3).max(300) }), req.body);
  await col(req).updateOne({ _id: r._id }, { $set: { status: "rejected", decidedBy: req.actor.email, decidedAt: new Date(), note: reason } });
  await audit(req, "return.rejected", r.orderNumber, { reason });
  tell(req, { ...r, status: "rejected" }, reason);
  res.json({ ok: true });
}));

// Refund the returned items. The amount can be lowered (for example a restocking fee) but never raised.
router.post("/:id/refund", wrap(async (req, res) => {
  if (!(await F.resolve(req.tenant)).flags["ORD-02"]) throw httpError(403, "Refunds are not available on your package (ORD-02).", { upgrade: true });
  const r = await pending(req, ["approved", "requested"]);
  const b = validate(z.object({ amountCents: z.number().int().min(0).optional(), restock: z.boolean().default(true) }), req.body || {});
  const order = await req.R.orders.findOne({ _id: r.orderId });
  if (!order || !["paid", "fulfilled"].includes(order.status)) throw httpError(409, "The order is not in a state that can be refunded.");
  const returned = r.items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const amount = Math.min(b.amountCents ?? returned, returned);
  const already = order.refundedTotal || 0;
  if (already + amount > order.total) throw httpError(409, "That would refund more than the order total.");
  const full = already + amount >= order.total;
  await req.R.orders.updateOne({ _id: order._id }, { $set: { refundedTotal: already + amount, ...(full ? { status: "refunded", "payments.0.status": "refunded" } : {}) },
    $push: { timeline: { at: new Date(), status: full ? "refunded" : order.status, note: `${full ? "Refund" : "Partial refund"} of ${(amount / 100).toFixed(2)} ${order.currency} for a return`, by: req.actor.email } } });
  if (b.restock) await restock(req.R, r.items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })));
  await col(req).updateOne({ _id: r._id }, { $set: { status: "refunded", refundAmount: amount, decidedBy: req.actor.email, decidedAt: new Date() } });
  await audit(req, "return.refunded", r.orderNumber, { after: { amount } });
  tell(req, { ...r, status: "refunded" }, `Refund of ${(amount / 100).toFixed(2)} ${order.currency}`);
  res.json({ ok: true, amountCents: amount, orderRefunded: full });
}));

module.exports = router;
