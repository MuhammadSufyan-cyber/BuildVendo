// Public storefront API: /api/store/:slug/... (FR-041, 048). Tenant is resolved from the slug.
const express = require("express");
const { z } = require("zod");
const { getDb } = require("../db");
const A = require("../lib/auth");
const F = require("../lib/flags");
const { scoped } = require("../lib/repo");
const { wrap, validate, httpError, rateLimit } = require("../lib/util");
const { priceCart, placeOrder, reconcileAwaiting } = require("../lib/orders");
const { tenantStripe } = require("../lib/stripe");

const router = express.Router({ mergeParams: true });
const checkoutLimit = rateLimit({ windowMs: 60_000, max: 20 });
const authLimit = rateLimit({ windowMs: 60_000, max: 15 });

router.use("/:slug", wrap(async (req, res, next) => {
  const t = await getDb().collection("tenants").findOne({ slug: String(req.params.slug).toLowerCase() });
  if (!t || t.status === "deleted") throw httpError(404, "Store not found.");
  if (t.status === "suspended") throw Object.assign(httpError(503, "This store is temporarily unavailable."), { suspended: true });
  if (t.status === "pending") throw Object.assign(httpError(503, "This store is not open yet."), { suspended: true });
  req.tenant = t; req.R = scoped(t.slug);
  req.flags = (await F.resolve(t)).flags;
  next();
}));

const cookieName = (slug) => `${A.COOKIES.customer}_${slug}`;
async function currentCustomer(req) {
  const c = A.verify(req.cookies?.[cookieName(req.tenant.slug)]);
  if (!c || c.scope !== "customer" || c.tenantId !== req.tenant.slug) return null;
  const { ObjectId } = require("mongodb");
  return req.R.customers.findOne({ _id: new ObjectId(c.sub) }, { projection: { passwordHash: 0 } });
}
const publicProduct = (p) => ({ id: String(p._id), slug: p.slug, title: p.title, description: p.description, category: p.category, price: p.price, emoji: p.emoji, images: p.images,
  tags: p.tags, variants: p.variants.map((v) => ({ id: v.id, title: v.title, price: v.price, inStock: v.stock > 0, stock: Math.min(v.stock, 20) })), inStock: p.variants.some((v) => v.stock > 0) });

// Which ways of paying this store currently offers.
function payOptions(req) {
  const pc = req.tenant.paymentConfig || {};
  const manualOn = !!(req.flags["PAY-04"] && pc.manual && pc.manual.enabled && pc.manual.methods && pc.manual.methods.length);
  const gatewayOn = !!(req.flags["PAY-06"] && pc.gateway && pc.gateway.enabled && pc.gateway.url);
  const stripeOn = !!(req.flags["PAY-04"] && tenantStripe(req.tenant));
  // the pretend "test card" exists only in development, and only while a store has no real way of paying
  const testCard = process.env.NODE_ENV !== "production" && !!req.flags["PAY-04"] && !manualOn && !gatewayOn && !stripeOn;
  return { manualOn, gatewayOn, stripeOn, testCard, pc };
}

router.get("/:slug/info", wrap(async (req, res) => {
  const s = req.tenant.settings || {};
  const po = payOptions(req);
  const cats = await req.R.products.aggregate([{ $match: { status: "active" } }, { $group: { _id: "$category", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray();
  res.json({ slug: req.tenant.slug, name: req.tenant.name, tagline: s.tagline || "", currency: s.currency || "USD", theme: s.theme, pages: s.pages || null,
    shippingFlat: s.shippingFlat || 0, freeShippingOver: s.freeShippingOver || 0, taxRatePct: s.taxRatePct || 0,
    customCss: req.flags["STO-08"] ? s.customCss || "" : "",
    logoUrl: s.logoUrl || "", bannerUrl: s.bannerUrl || "",
    categories: cats.map((c) => ({ name: c._id, count: c.n, image: (s.categoryImages || {})[c._id] || "" })),
    features: { guestCheckout: !!req.flags["PAY-01"], cod: !!req.flags["PAY-03"], card: po.stripeOn || po.testCard, testCard: po.testCard, manual: po.manualOn ? { label: "Bank or wallet transfer", methods: po.pc.manual.methods.map((m) => ({ id: m.id, type: m.type, label: m.label })) } : null, gateway: po.gatewayOn ? { label: po.pc.gateway.label || "Pay online" } : null, discounts: !!req.flags["MKT-02"], reviews: !!req.flags["CAT-11"],
      wishlist: !!req.flags["MKT-14"], loyalty: (() => { const l = require("../lib/loyalty").config(req.tenant, req.flags); return l.enabled ? { earnRate: l.earnRate, pointValueCents: l.pointValueCents, minRedeem: l.minRedeem } : null; })(), returns: !!req.flags["ORD-03"], gdpr: !!req.flags["SEC-06"], tracking: !!req.flags["ORD-09"], blog: !!req.flags["STO-04"], whiteLabel: !!req.flags["PLT-03"] } });
}));

router.get("/:slug/products", wrap(async (req, res) => {
  const q = { status: "active" };
  if (req.query.category) q.category = String(req.query.category);
  if (req.query.q) q.title = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const sort = { price_asc: { price: 1 }, price_desc: { price: -1 }, newest: { createdAt: -1 } }[req.query.sort] || { createdAt: -1 };
  const ps = await req.R.products.find(q).sort(sort).limit(100).toArray();
  res.json({ products: ps.map(publicProduct) });
}));
router.get("/:slug/products/:ps", wrap(async (req, res) => {
  const p = await req.R.products.findOne({ slug: req.params.ps, status: "active" });
  if (!p) throw httpError(404, "Product not found.");
  let reviews = [];
  if (req.flags["CAT-11"]) reviews = await req.R.col("reviews").find({ productId: String(p._id) }).sort({ createdAt: -1 }).limit(20).toArray();
  res.json({ product: publicProduct(p), reviews: reviews.map((r) => ({ name: r.name, rating: r.rating, text: r.text, at: r.createdAt })) });
}));
router.post("/:slug/products/:ps/reviews", wrap(async (req, res) => {
  if (!req.flags["CAT-11"]) throw httpError(403, "Reviews are not enabled for this store.");
  const cust = await currentCustomer(req); if (!cust) throw httpError(401, "Sign in to write a review.");
  const b = validate(z.object({ rating: z.number().int().min(1).max(5), text: z.string().max(1000).default("") }), req.body);
  const p = await req.R.products.findOne({ slug: req.params.ps });
  if (!p) throw httpError(404, "Product not found.");
  await req.R.col("reviews").insertOne({ productId: String(p._id), name: cust.name, customerId: String(cust._id), rating: b.rating, text: b.text, createdAt: new Date() });
  res.status(201).json({ ok: true });
}));

const cartSchema = z.object({ items: z.array(z.object({ productId: z.string(), variantId: z.string().optional(), qty: z.number().int().min(1).max(99) })).min(1).max(50), code: z.string().max(30).optional(), country: z.string().max(60).optional(), redeemPoints: z.number().int().min(0).max(1000000).optional() });

// Loyalty points the shopper wants to spend (MKT-06). Only signed-in customers, never more than they have.
async function redeemFor(req, wanted) {
  if (!wanted) return { redeem: null, cust: null };
  const cfg = require("../lib/loyalty").config(req.tenant, req.flags);
  if (!cfg.enabled) throw httpError(403, "Loyalty points are not available in this store.");
  const cust = await currentCustomer(req);
  if (!cust) throw httpError(401, "Sign in to use your points.");
  const have = cust.points || 0;
  if (wanted > have) throw httpError(400, `You only have ${have} points.`);
  if (wanted < cfg.minRedeem) throw httpError(400, `The minimum is ${cfg.minRedeem} points.`);
  return { redeem: { points: wanted, valueCents: cfg.pointValueCents }, cust };
}
router.post("/:slug/cart/quote", wrap(async (req, res) => {
  const b = validate(cartSchema, req.body);
  if (b.code && !req.flags["MKT-02"]) b.code = undefined;
  const { redeem } = await redeemFor(req, b.redeemPoints);
  const q = await priceCart(req.R, req.tenant, b.items, b.code, b.country, redeem);
  const { discountId, ...pub } = q;
  res.json(pub);
}));

router.post("/:slug/checkout", checkoutLimit, wrap(async (req, res) => {
  const b = validate(cartSchema.extend({
    customer: z.object({ name: z.string().min(2).max(80), email: z.string().email().transform((s) => s.toLowerCase()), phone: z.string().max(30).optional() }),
    address: z.object({ line1: z.string().min(3).max(200), city: z.string().min(2).max(80), postal: z.string().max(20).optional(), country: z.string().min(2).max(60) }),
    paymentMethod: z.enum(["cod", "card", "manual", "gateway"]),
  }), req.body);
  const cust = await currentCustomer(req);
  if (!cust && !req.flags["PAY-01"]) throw httpError(401, "Please sign in to check out.");
  if (b.paymentMethod === "cod" && !req.flags["PAY-03"]) throw httpError(403, "Cash on delivery is not available.");
  const po = payOptions(req);
  if (b.paymentMethod === "card" && !(po.stripeOn || po.testCard)) throw httpError(403, "Card payment is not available.");
  if (b.paymentMethod === "manual" && !po.manualOn) throw httpError(403, "Bank or wallet transfer is not available.");
  if (b.paymentMethod === "gateway" && !po.gatewayOn) throw httpError(403, "Online payment is not available.");
  if (b.code && !req.flags["MKT-02"]) b.code = undefined;
  // order limit for the package (orders per month)
  const { limits } = await F.resolve(req.tenant); const use = await F.usage(req.tenant.slug);
  if (limits.orders >= 0 && use.orders >= limits.orders) throw httpError(409, "This store cannot take new orders right now.");
  const email = (cust ? cust.email : b.customer.email);
  let customerDoc = await req.R.customers.findOne({ email });
  if (!customerDoc) await req.R.customers.insertOne({ email, name: b.customer.name, phone: b.customer.phone || null, addresses: [b.address], createdAt: new Date() });
  await reconcileAwaiting(req.R, req.tenant);
  const stripe = b.paymentMethod === "card" ? tenantStripe(req.tenant) : null; // the store has its own Stripe account connected
  const { redeem, cust: redeemCust } = await redeemFor(req, b.redeemPoints);
  const order = await placeOrder({ R: req.R, tenant: req.tenant, redeem, customerId: redeemCust && redeemCust._id, items: b.items, customer: { name: b.customer.name, email, phone: b.customer.phone }, address: b.address, paymentMethod: b.paymentMethod, code: b.code, channel: "web", awaitPayment: !!stripe || ["manual", "gateway"].includes(b.paymentMethod) });
  if (stripe) {
    try {
      const app = process.env.FRONTEND_URL || "http://localhost:3000";
      const session = await stripe.checkout.sessions.create({
        mode: "payment", customer_email: email, expires_at: Math.floor(Date.now() / 1000) + 31 * 60, metadata: { order: order.number, store: req.tenant.slug },
        line_items: [{ quantity: 1, price_data: { currency: order.currency.toLowerCase(), unit_amount: order.total, product_data: { name: `${req.tenant.name} order #${order.number}`, description: order.lines.map((l) => `${l.qty} x ${l.title}`).join(", ").slice(0, 500) } } }],
        success_url: `${app}/s/${req.tenant.slug}/order?number=${order.number}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${app}/s/${req.tenant.slug}/cart?cancelled=1`,
      });
      await req.R.orders.updateOne({ _id: order._id }, { $set: { stripeSessionId: session.id } });
      return res.status(201).json({ order: { number: order.number, status: order.status, total: order.total, currency: order.currency, lines: order.lines, payments: order.payments }, redirectUrl: session.url });
    } catch (e) {
      console.error("[stripe] could not start checkout:", e.message);
      await require("../lib/orders").restock(req.R, order.lines);
      await req.R.orders.updateOne({ _id: order._id }, { $set: { status: "cancelled", "payments.0.status": "failed" } });
      throw httpError(502, "The payment provider could not start the payment. Please try again or choose another payment method.");
    }
  }
  require("../lib/mailer").send("order", email, { store: req.tenant.name, order, money: new Intl.NumberFormat("en", { style: "currency", currency: order.currency }).format(order.total / 100) }).catch(() => {});
  res.status(201).json({ order: { number: order.number, status: order.status, total: order.total, currency: order.currency, lines: order.lines, payments: order.payments }, ...(order.payToken ? { payToken: order.payToken } : {}) });
}));

// Shopper returns from Stripe: verify the payment with Stripe itself, never trust the URL alone.
router.get("/:slug/orders/confirm", wrap(async (req, res) => {
  const o = await req.R.orders.findOne({ number: String(req.query.number || ""), stripeSessionId: String(req.query.session_id || "") });
  if (!o) throw httpError(404, "Order not found.");
  if (o.status === "pending" && o.payments[0].status === "awaiting") {
    const stripe = tenantStripe(req.tenant);
    if (!stripe) throw httpError(409, "Payments are not connected.");
    const s = await stripe.checkout.sessions.retrieve(o.stripeSessionId);
    if (s.payment_status === "paid" && s.metadata?.order === o.number) {
      await req.R.orders.updateOne({ _id: o._id }, { $set: { status: "paid", "payments.0.status": "paid", "payments.0.ref": s.payment_intent || s.id }, $push: { timeline: { at: new Date(), status: "paid", note: "Payment confirmed by Stripe" } } });
      o.status = "paid";
      require("../lib/mailer").send("order", o.customer.email, { store: req.tenant.name, order: o, money: new Intl.NumberFormat("en", { style: "currency", currency: o.currency }).format(o.total / 100) }).catch(() => {});
    }
  }
  res.json({ order: { number: o.number, status: o.status, total: o.total, currency: o.currency, lines: o.lines } });
}));

// The order page after checkout: payment instructions for transfers / gateway links. Needs the secret token from checkout.
router.get("/:slug/orders/pay", wrap(async (req, res) => {
  const o = await req.R.orders.findOne({ number: String(req.query.number || ""), payToken: String(req.query.t || "") });
  if (!o || !["manual", "gateway"].includes(o.payments[0].method)) throw httpError(404, "Order not found.");
  const pc = req.tenant.paymentConfig || {}, p = o.payments[0];
  const instructions = p.method === "manual"
    ? { type: "manual", note: pc.manual?.instructions || "", methods: (pc.manual?.methods || []).map((m) => ({ id: m.id, type: m.type, label: m.label, accountName: m.accountName, accountNumber: m.accountNumber, details: m.details })) }
    : { type: "gateway", label: pc.gateway?.label || "Pay online", note: pc.gateway?.instructions || "", payUrl: pc.gateway?.url ? require("../lib/payconfig").gatewayUrl(pc.gateway.url, o) : null };
  res.json({ order: { number: o.number, status: o.status, total: o.total, currency: o.currency, lines: o.lines }, payment: { method: p.method, status: p.status, rejectReason: p.rejectReason || null, proof: p.proof ? { reference: p.proof.reference || "", submittedAt: p.proof.submittedAt, hasImage: !!p.proof.imageKey, status: p.proof.status } : null }, instructions });
}));

// The buyer sends a transaction reference and/or a screenshot. The store admin then approves or rejects it.
router.post("/:slug/orders/proof", rateLimit({ windowMs: 60_000, max: 12 }), wrap(async (req, res) => {
  const b = validate(z.object({ number: z.string().max(20), token: z.string().max(64), reference: z.string().max(120).default(""), methodId: z.string().max(40).optional(), image: z.string().max(3_000_000).optional() }), req.body);
  const o = await req.R.orders.findOne({ number: b.number, payToken: b.token, status: "pending" });
  if (!o || !["manual", "gateway"].includes(o.payments[0].method)) throw httpError(404, "Order not found or already settled.");
  if (!b.reference.trim() && !b.image) throw httpError(400, "Please enter the transaction reference or attach a screenshot.");
  let imageKey = null;
  if (b.image) imageKey = require("../lib/files").savePrivateImage(req.tenant.slug, b.image, 2 * 1024 * 1024);
  const method = (req.tenant.paymentConfig?.manual?.methods || []).find((m) => m.id === b.methodId);
  await req.R.orders.updateOne({ _id: o._id }, { $set: { "payments.0.status": "submitted", "payments.0.rejectReason": null, "payments.0.proof": { reference: b.reference.trim(), imageKey, methodId: b.methodId || null, methodLabel: method ? method.label : "", submittedAt: new Date(), status: "submitted" } },
    $push: { timeline: { at: new Date(), status: "pending", note: "Customer sent payment proof" } } });
  await req.R.notifications.insertOne({ title: "Payment proof received", body: `Order #${o.number} (${new Intl.NumberFormat("en", { style: "currency", currency: o.currency }).format(o.total / 100)}) is waiting for you to confirm the payment. Open Payments.`, createdAt: new Date(), read: false, from: "system" });
  res.json({ ok: true });
}));

// Blog (STO-04): published posts only
router.get("/:slug/blog", wrap(async (req, res) => {
  if (!req.flags["STO-04"]) throw httpError(404, "This store has no blog.");
  const posts = await req.R.col("posts").find({ status: "published" }, { projection: { body: 0 } }).sort({ publishedAt: -1 }).limit(50).toArray();
  res.json({ posts: posts.map((p) => ({ title: p.title, slug: p.slug, excerpt: p.excerpt, image: p.image, publishedAt: p.publishedAt, author: p.author })) });
}));
router.get("/:slug/blog/:post", wrap(async (req, res) => {
  if (!req.flags["STO-04"]) throw httpError(404, "This store has no blog.");
  const p = await req.R.col("posts").findOne({ slug: req.params.post, status: "published" });
  if (!p) throw httpError(404, "Post not found.");
  res.json({ post: { title: p.title, slug: p.slug, excerpt: p.excerpt, body: p.body, image: p.image, publishedAt: p.publishedAt, author: p.author } });
}));

// Returns (ORD-03). The buyer proves who they are with the order number and the email used at checkout.
const RETURN_DAYS = 30;
router.get("/:slug/returns/order", rateLimit({ windowMs: 60_000, max: 20 }), wrap(async (req, res) => {
  if (!req.flags["ORD-03"]) throw httpError(403, "Returns are not available in this store.");
  const o = await req.R.orders.findOne({ number: String(req.query.number || ""), "customer.email": String(req.query.email || "").toLowerCase() });
  if (!o) throw httpError(404, "No order matches that number and email.");
  const existing = await req.R.col("returns").findOne({ orderNumber: o.number }, { sort: { createdAt: -1 } });
  const eligible = ["paid", "fulfilled"].includes(o.status) && Date.now() - new Date(o.createdAt).getTime() < RETURN_DAYS * 864e5;
  res.json({ order: { number: o.number, status: o.status, currency: o.currency, lines: o.lines.map((l) => ({ variantId: l.variantId, title: l.title, variantTitle: l.variantTitle, qty: l.qty, unitPrice: l.unitPrice })) }, eligible, windowDays: RETURN_DAYS,
    existing: existing ? { status: existing.status, reason: existing.reason, note: existing.note || "", refundAmount: existing.refundAmount ?? null, createdAt: existing.createdAt } : null });
}));
router.post("/:slug/returns", rateLimit({ windowMs: 60_000, max: 6 }), wrap(async (req, res) => {
  if (!req.flags["ORD-03"]) throw httpError(403, "Returns are not available in this store.");
  const b = validate(z.object({ number: z.string().max(20), email: z.string().email().transform((s) => s.toLowerCase()), reason: z.string().min(3).max(500), items: z.array(z.object({ variantId: z.string(), qty: z.number().int().min(1).max(99) })).max(50).optional() }), req.body);
  const o = await req.R.orders.findOne({ number: b.number, "customer.email": b.email });
  if (!o) throw httpError(404, "No order matches that number and email.");
  if (!["paid", "fulfilled"].includes(o.status)) throw httpError(409, "Only paid orders can be returned.");
  if (Date.now() - new Date(o.createdAt).getTime() >= RETURN_DAYS * 864e5) throw httpError(409, `The ${RETURN_DAYS}-day return period for this order has ended.`);
  if (await req.R.col("returns").findOne({ orderNumber: o.number, status: { $in: ["requested", "approved"] } })) throw httpError(409, "There is already an open return for this order.");
  const picked = b.items && b.items.length ? b.items : o.lines.map((l) => ({ variantId: l.variantId, qty: l.qty }));
  const items = picked.map((p) => {
    const line = o.lines.find((l) => l.variantId === p.variantId);
    if (!line) throw httpError(400, "That item is not in this order.");
    if (p.qty > line.qty) throw httpError(400, `You can return at most ${line.qty} of ${line.title}.`);
    return { productId: line.productId, variantId: line.variantId, title: line.title, variantTitle: line.variantTitle, qty: p.qty, unitPrice: line.unitPrice };
  });
  await req.R.col("returns").insertOne({ tenantId: req.tenant.slug, orderId: o._id, orderNumber: o.number, customerEmail: b.email, customerName: o.customer?.name || "", items, reason: b.reason, status: "requested", currency: o.currency, createdAt: new Date() });
  await req.R.notifications.insertOne({ title: "Return requested", body: `Order #${o.number}: ${b.reason.slice(0, 120)}`, createdAt: new Date(), read: false, from: "system" });
  res.status(201).json({ ok: true });
}));

router.get("/:slug/orders/track", wrap(async (req, res) => {
  if (!req.flags["ORD-09"]) throw httpError(403, "Order tracking is not enabled.");
  const o = await req.R.orders.findOne({ number: String(req.query.number || ""), "customer.email": String(req.query.email || "").toLowerCase() });
  if (!o) throw httpError(404, "No order matches that number and email.");
  res.json({ order: { number: o.number, status: o.status, total: o.total, currency: o.currency, timeline: o.timeline.map((t) => ({ at: t.at, status: t.status })), lines: o.lines } });
}));

// ----- customer accounts (FR-048) -----
router.post("/:slug/auth/register", authLimit, wrap(async (req, res) => {
  const b = validate(z.object({ name: z.string().min(2).max(80), email: z.string().email().transform((s) => s.toLowerCase()), password: z.string() }), req.body);
  const problem = A.passwordProblem(b.password); if (problem) throw httpError(400, problem);
  let c = await req.R.customers.findOne({ email: b.email });
  if (c && c.passwordHash) throw httpError(409, "An account with that email already exists.");
  const hash = await A.hashPassword(b.password);
  if (c) await req.R.customers.updateOne({ _id: c._id }, { $set: { passwordHash: hash, name: b.name } });
  else c = { _id: (await req.R.customers.insertOne({ email: b.email, name: b.name, addresses: [], passwordHash: hash, createdAt: new Date() })).insertedId };
  A.setCookie(res, "customer", A.sign({ sub: String(c._id), scope: "customer", tenantId: req.tenant.slug }, 24 * 60), 24 * 60, cookieName(req.tenant.slug));
  res.status(201).json({ ok: true });
}));
router.post("/:slug/auth/login", authLimit, wrap(async (req, res) => {
  const b = validate(z.object({ email: z.string().email().transform((s) => s.toLowerCase()), password: z.string().max(128) }), req.body);
  const c = await req.R.customers.findOne({ email: b.email });
  if (!c || !c.passwordHash) throw httpError(401, "Invalid email or password.");
  if (c.lockUntil && c.lockUntil > new Date()) throw httpError(423, "Too many failed attempts. Try again in 15 minutes.");
  if (!(await A.verifyPassword(c.passwordHash, b.password))) { await A.registerFailure("customers", c); throw httpError(401, "Invalid email or password."); }
  await A.clearFailures("customers", c);
  A.setCookie(res, "customer", A.sign({ sub: String(c._id), scope: "customer", tenantId: req.tenant.slug }, 24 * 60), 24 * 60, cookieName(req.tenant.slug));
  res.json({ ok: true });
}));
router.post("/:slug/auth/logout", (req, res) => { A.clearCookie(res, cookieName(req.params.slug)); res.json({ ok: true }); });
router.get("/:slug/auth/me", wrap(async (req, res) => {
  const c = await currentCustomer(req);
  res.json({ customer: c ? { name: c.name, email: c.email, points: c.points || 0 } : null });
}));
router.get("/:slug/account/orders", wrap(async (req, res) => {
  const c = await currentCustomer(req); if (!c) throw httpError(401, "Not signed in.");
  const os = await req.R.orders.find({ "customer.email": c.email }).sort({ createdAt: -1 }).limit(100).toArray();
  res.json({ orders: os.map((o) => ({ number: o.number, status: o.status, total: o.total, currency: o.currency, createdAt: o.createdAt, lines: o.lines })) });
}));
// GDPR (SEC-06): a customer can download or erase their own data.
router.get("/:slug/account/export", wrap(async (req, res) => {
  if (!req.flags["SEC-06"]) throw httpError(403, "Not available.");
  const c = await currentCustomer(req); if (!c) throw httpError(401, "Not signed in.");
  const full = await req.R.customers.findOne({ _id: c._id });
  res.setHeader("Content-Disposition", "attachment; filename=\"my-data.json\"");
  res.json(await require("../lib/gdpr").exportCustomer(req.R, full));
}));
router.delete("/:slug/account", wrap(async (req, res) => {
  if (!req.flags["SEC-06"]) throw httpError(403, "Not available.");
  const c = await currentCustomer(req); if (!c) throw httpError(401, "Not signed in.");
  await require("../lib/gdpr").anonymizeCustomer(req.R, await req.R.customers.findOne({ _id: c._id }));
  A.clearCookie(res, cookieName(req.params.slug));
  res.json({ ok: true });
}));

router.post("/:slug/wishlist", wrap(async (req, res) => {
  if (!req.flags["MKT-14"]) throw httpError(403, "Wishlist is not enabled.");
  const c = await currentCustomer(req); if (!c) throw httpError(401, "Sign in to use your wishlist.");
  const { productId } = validate(z.object({ productId: z.string() }), req.body);
  const has = (c.wishlist || []).includes(productId);
  await req.R.customers.updateOne({ _id: c._id }, has ? { $pull: { wishlist: productId } } : { $addToSet: { wishlist: productId } });
  res.json({ wished: !has });
}));
router.get("/:slug/wishlist", wrap(async (req, res) => {
  const c = await currentCustomer(req); if (!c) return res.json({ ids: [] });
  res.json({ ids: c.wishlist || [] });
}));

module.exports = router;
