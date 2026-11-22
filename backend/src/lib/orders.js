// Pricing and order placement shared by the storefront checkout and the POS (FR-041..044).
const { httpError, nextNumber } = require("./util");

// Quote a cart. Prices always come from the database, never from the client.
async function priceCart(R, tenant, items, code, country, redeem) {
  if (!Array.isArray(items) || !items.length) throw httpError(400, "Your cart is empty.");
  if (items.length > 50) throw httpError(400, "Too many items.");
  const ids = [...new Set(items.map((i) => String(i.productId)))];
  const { ObjectId } = require("mongodb");
  const products = await R.products.find({ _id: { $in: ids.filter((i) => ObjectId.isValid(i)).map((i) => new ObjectId(i)) }, status: "active" }).toArray();
  const byId = Object.fromEntries(products.map((p) => [String(p._id), p]));
  const lines = [];
  for (const it of items) {
    const qty = Math.floor(Number(it.qty));
    if (!(qty >= 1 && qty <= 99)) throw httpError(400, "Invalid quantity.");
    const p = byId[String(it.productId)];
    if (!p) throw httpError(400, "A product in your cart is no longer available.");
    const v = p.variants.find((x) => x.id === it.variantId) || (p.variants.length === 1 ? p.variants[0] : null);
    if (!v) throw httpError(400, `Choose an option for ${p.title}.`);
    if (v.stock < qty) throw httpError(409, `Only ${v.stock} left of ${p.title} (${v.title}).`);
    lines.push({ productId: String(p._id), variantId: v.id, title: p.title, variantTitle: v.title, sku: v.sku, emoji: p.emoji || null, unitPrice: v.price, qty, total: v.price * qty });
  }
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  let discount = 0, discountDoc = null;
  if (code) {
    discountDoc = await R.discounts.findOne({ code: String(code).trim().toUpperCase(), active: true });
    const now = new Date();
    const ok = discountDoc && (!discountDoc.startsAt || discountDoc.startsAt <= now) && (!discountDoc.endsAt || discountDoc.endsAt >= now) &&
      subtotal >= (discountDoc.minSubtotal || 0) && (!discountDoc.maxUses || discountDoc.used < discountDoc.maxUses);
    if (!ok) throw httpError(400, "That discount code is not valid for this order.");
    discount = discountDoc.type === "percent" ? Math.round((subtotal * discountDoc.value) / 100) : Math.min(subtotal, discountDoc.value);
  }
  if (!code) { // automatic discounts (MKT-03): the best matching rule applies without a code
    const { flags } = await require("./flags").resolve(tenant);
    if (flags["MKT-03"]) {
      const now = new Date(); let best = null, bestAmt = 0;
      for (const d of await R.discounts.find({ auto: true, active: true }).toArray()) {
        if ((d.startsAt && d.startsAt > now) || (d.endsAt && d.endsAt < now) || subtotal < (d.minSubtotal || 0) || (d.maxUses && d.used >= d.maxUses)) continue;
        const amt = d.type === "percent" ? Math.round((subtotal * d.value) / 100) : Math.min(subtotal, d.value);
        if (amt > bestAmt) { best = d; bestAmt = amt; }
      }
      if (best) { discountDoc = best; discount = bestAmt; }
    }
  }
  const s = tenant.settings || {};
  const after = subtotal - discount;
  // loyalty points spent as money off the goods (never more than the goods cost)
  let pointsUsed = 0, pointsDiscount = 0;
  if (redeem && redeem.points > 0 && redeem.valueCents > 0) { pointsUsed = Math.min(redeem.points, Math.floor(after / redeem.valueCents)); pointsDiscount = pointsUsed * redeem.valueCents; }
  const afterPoints = after - pointsDiscount;
  // shipping zones (ORD-06): the first zone listing the destination country wins; otherwise the store's default rate applies
  const want = String(country || "").trim().toLowerCase();
  const zone = want ? (s.shippingZones || []).find((z) => (z.countries || []).some((c) => String(c).trim().toLowerCase() === want)) : null;
  const rate = zone ? zone.rate : (s.shippingFlat || 0);
  const freeOver = zone ? (zone.freeOver || 0) : (s.freeShippingOver || 0);
  const shipping = freeOver && after >= freeOver ? 0 : rate;
  const tax = Math.round((afterPoints * (s.taxRatePct || 0)) / 100);
  return { lines, subtotal, discount, pointsUsed, pointsDiscount, discountCode: discountDoc ? discountDoc.code : null, discountId: discountDoc ? discountDoc._id : null, shipping, tax, total: afterPoints + shipping + tax, currency: s.currency || "USD" };
}

// Atomic stock decrement: 100 concurrent orders for 10 units sell exactly 10 (FR-043).
async function reserveStock(R, lines) {
  const done = [];
  for (const l of lines) {
    const r = await R.products.updateOne(
      { _id: new (require("mongodb").ObjectId)(l.productId), variants: { $elemMatch: { id: l.variantId, stock: { $gte: l.qty } } } },
      { $inc: { "variants.$.stock": -l.qty } });
    if (!r.modifiedCount) {
      await restock(R, done);
      throw httpError(409, `Sorry, ${l.title} just sold out.`);
    }
    done.push(l);
  }
}
async function restock(R, lines) {
  const { ObjectId } = require("mongodb");
  for (const l of lines) await R.products.updateOne({ _id: new ObjectId(l.productId), "variants.id": l.variantId }, { $inc: { "variants.$.stock": l.qty } });
}

async function placeOrder({ R, tenant, items, customer, address, paymentMethod, code, channel, cashier, awaitPayment, redeem, customerId }) {
  const q = await priceCart(R, tenant, items, code, address && address.country, redeem);
  await reserveStock(R, q.lines);
  if (q.pointsUsed > 0) { // take the points atomically; if the balance changed meanwhile, undo the stock reservation
    const sp = await R.customers.updateOne({ _id: customerId, points: { $gte: q.pointsUsed } }, { $inc: { points: -q.pointsUsed } });
    if (!sp.modifiedCount) { await restock(R, q.lines); throw httpError(409, "You do not have enough points for that."); }
  }
  const now = new Date();
  const paid = paymentMethod !== "cod" && !awaitPayment;
  const number = String(1000 + (await nextNumber(R.tenantId, "orders")));
  const order = {
    number, channel: channel || "web", status: paid ? "paid" : "pending",
    customer: customer || null, shippingAddress: address || null, lines: q.lines,
    subtotal: q.subtotal, discount: q.discount, discountCode: q.discountCode, pointsUsed: q.pointsUsed, pointsDiscount: q.pointsDiscount, shipping: channel === "pos" ? 0 : q.shipping, tax: q.tax,
    total: channel === "pos" ? q.total - q.shipping : q.total, currency: q.currency,
    payments: [{ method: paymentMethod, amount: channel === "pos" ? q.total - q.shipping : q.total, status: paid ? "paid" : awaitPayment ? "awaiting" : "due",
      ref: paid ? (paymentMethod === "cash" ? "cash" : "test_" + Math.random().toString(36).slice(2, 10)) : null,
      note: paymentMethod === "card" ? "Test gateway (no real charge). Connect Stripe to take real payments." : undefined }],
    cashier: cashier || null,
    ...(["manual", "gateway"].includes(paymentMethod) ? { payToken: require("crypto").randomBytes(16).toString("hex") } : {}), // lets the buyer (and only the buyer) send payment proof
    timeline: [{ at: now, status: paid ? "paid" : "pending", note: "Order placed" }], createdAt: now,
  };
  await R.orders.insertOne(order);
  if (q.discountId) await R.discounts.updateOne({ _id: q.discountId }, { $inc: { used: 1 } });
  const W = require("./webhooks"), summary = { number: order.number, status: order.status, total: order.total, currency: order.currency, channel: order.channel, customer: order.customer, lines: order.lines };
  W.emit(R.tenantId, "order.created", summary);
  if (paid) { W.emit(R.tenantId, "order.paid", summary); await require("./loyalty").award(R, tenant, order); }
  return order;
}

// Orders waiting for a card payment that never finished: confirm with Stripe, or cancel and release the stock.
async function reconcileAwaiting(R, tenant) {
  // transfers / gateway links nobody paid within 48 hours: cancel and release the stock (orders with proof submitted wait for the admin)
  const stale = await R.orders.find({ status: "pending", "payments.0.method": { $in: ["manual", "gateway"] }, "payments.0.status": { $in: ["awaiting", "rejected"] }, createdAt: { $lt: new Date(Date.now() - 48 * 3600 * 1000) } }).limit(20).toArray();
  for (const o of stale) { await R.orders.updateOne({ _id: o._id }, { $set: { status: "cancelled", "payments.0.status": "expired" }, $push: { timeline: { at: new Date(), status: "cancelled", note: "No payment received in 48 hours" } } }); await restock(R, o.lines); await require("./loyalty").refund(R, o); }
  const old = await R.orders.find({ status: "pending", "payments.0.method": "card", "payments.0.status": "awaiting", createdAt: { $lt: new Date(Date.now() - 35 * 60 * 1000) } }).limit(20).toArray();
  if (!old.length) return 0;
  const { tenantStripe } = require("./stripe");
  const stripe = tenantStripe(tenant);
  for (const o of old) {
    let paid = false;
    if (stripe && o.stripeSessionId) { try { paid = (await stripe.checkout.sessions.retrieve(o.stripeSessionId)).payment_status === "paid"; } catch { continue; } }
    if (paid) await R.orders.updateOne({ _id: o._id }, { $set: { status: "paid", "payments.0.status": "paid" }, $push: { timeline: { at: new Date(), status: "paid", note: "Payment confirmed by Stripe" } } });
    else { await R.orders.updateOne({ _id: o._id }, { $set: { status: "cancelled", "payments.0.status": "expired" }, $push: { timeline: { at: new Date(), status: "cancelled", note: "Payment not completed in time" } } }); await restock(R, o.lines); await require("./loyalty").refund(R, o); }
  }
  return old.length;
}

module.exports = { priceCart, reserveStock, restock, placeOrder, reconcileAwaiting };
