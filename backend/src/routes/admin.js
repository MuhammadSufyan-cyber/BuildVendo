// Tenant dashboard API (SRS sections 9-11). Tenant comes from the signed session, never from the request body.
const express = require("express");
const { z } = require("zod");
const { ObjectId } = require("mongodb");
const { getDb } = require("../db");
const A = require("../lib/auth");
const F = require("../lib/flags");
const { scoped } = require("../lib/repo");
const { TENANT_ROLES, TENANT_PERMISSIONS } = require("../lib/perms");
const { byPrice, audit, slugify, wrap, validate, httpError } = require("../lib/util");
const { placeOrder, restock } = require("../lib/orders");

const router = express.Router();
router.use(A.authenticate("tenant"));
router.use((req, res, next) => {
  if (req.tenant.status === "deleted") return res.status(403).json({ error: "This store was deleted." });
  if (req.tenant.status === "suspended" && req.method !== "GET") return res.status(403).json({ error: "This store is suspended. Contact support." });
  req.R = scoped(req.actor.tenantId);
  next();
});
const P = A.requirePerm, FL = F.requireFlag;
const oid = (id) => { if (!ObjectId.isValid(id)) throw httpError(400, "Invalid id."); return new ObjectId(id); };
// Custom CSS is injected into the storefront only. Strip anything that could run code or load other pages.
const cleanCss = (css) => String(css)
  .replace(/[<>]/g, "")
  .replace(/@import[^;]*;?/gi, "")
  .replace(/expression\s*\(/gi, "")
  .replace(/javascript:/gi, "")
  .replace(/behavior\s*:/gi, "")
  .replace(/-moz-binding\s*:/gi, "")
  .replace(/url\s*\(\s*["']?\s*(?!https:|data:image\/)[^)]*\)/gi, "none"); // only https or inline-image urls survive
// Store pictures (logo, banner, category images): an uploaded file or an https link. Empty string = remove.
const imgUrl = z.string().max(300).regex(/^(https:\/\/|\/uploads\/)[^\s"<>]+$/, "Pictures must be uploaded files or https links.").or(z.literal(""));
const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`).join(",")).join("\n");

// ---------- overview ----------
router.get("/overview", wrap(async (req, res) => {
  const R = req.R, since = new Date(Date.now() - 30 * 864e5);
  const [eff, use, recent, month, lowStock, notes, byStatus] = await Promise.all([
    F.resolve(req.tenant), F.usage(req.tenant.slug),
    R.orders.find({}).sort({ createdAt: -1 }).limit(6).toArray(),
    R.orders.aggregate([{ $match: { createdAt: { $gte: since }, status: { $nin: ["cancelled", "refunded"] } } }, { $group: { _id: null, revenue: { $sum: "$total" }, orders: { $sum: 1 } } }]).toArray(),
    R.products.aggregate([{ $unwind: "$variants" }, { $match: { "variants.stock": { $lte: 5 } } }, { $limit: 8 }, { $project: { title: 1, variant: "$variants.title", stock: "$variants.stock" } }]).toArray(),
    R.notifications.count({ read: false }),
    R.orders.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
  ]);
  res.json({ tenant: { slug: req.tenant.slug, name: req.tenant.name, status: req.tenant.status, packageId: req.tenant.packageId, trialEndsAt: req.tenant.trialEndsAt },
    package: { key: eff.package?.key, name: eff.package?.name }, limits: eff.limits, usage: use,
    last30: { revenue: month[0]?.revenue || 0, orders: month[0]?.orders || 0 }, recentOrders: recent, lowStock, unreadNotifications: notes,
    ordersByStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.n])), currency: req.tenant.settings?.currency || "USD" });
}));

router.get("/features", wrap(async (req, res) => {
  const [eff, use, packages] = await Promise.all([F.resolve(req.tenant), F.usage(req.tenant.slug), getDb().collection("packages").find({ archived: { $ne: true } }).toArray().then((a) => a.sort(byPrice))]);
  res.json({ billing: { stripe: !!require("../lib/stripe").platformStripe(), state: req.tenant.billing?.state || "none", hasSubscription: !!req.tenant.stripeSubscriptionId, paidUntil: req.tenant.paidUntil || null, trialEndsAt: req.tenant.trialEndsAt || null }, flags: eff.flags, limits: eff.limits, usage: use, package: eff.package?.key, packages: packages.map((p) => ({ key: p.key, name: p.name, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, limits: p.limits })) });
}));

// ---------- products (FR-040) ----------
const variantSchema = z.object({ id: z.string().optional(), sku: z.string().max(40).optional(), title: z.string().min(1).max(60), price: z.number().int().min(0), stock: z.number().int().min(0) });
const productSchema = z.object({
  title: z.string().min(2).max(120), description: z.string().max(5000).default(""), category: z.string().max(60).default("General"),
  price: z.number().int().min(0), emoji: z.string().max(8).optional(), images: z.array(z.string().regex(/^(https:\/\/|\/uploads\/)[^\s"<>]+$/, "Image must be an uploaded file or an https link.")).max(10).default([]),
  status: z.enum(["active", "draft"]).default("active"), tags: z.array(z.string().max(30)).max(20).default([]),
  variants: z.array(variantSchema).min(1).max(100).optional(), stock: z.number().int().min(0).optional(),
  seoTitle: z.string().max(120).optional(), seoDescription: z.string().max(300).optional(),
});
async function buildProduct(req, b, slug) {
  const { flags } = await F.resolve(req.tenant);
  let variants = b.variants;
  if (variants && variants.length > 1 && !flags["CAT-02"]) throw httpError(403, "Product variants are not available on your package (CAT-02).");
  if (!variants) variants = [{ title: "Default", price: b.price, stock: b.stock ?? 0 }];
  variants = variants.map((v, i) => ({ id: v.id || `${slug}-${i + 1}-${Math.random().toString(36).slice(2, 6)}`, sku: v.sku || `${slug.slice(0, 6).toUpperCase()}-${i + 1}`, title: v.title, price: v.price, stock: v.stock }));
  const { variants: _v, stock: _s, ...rest } = b;
  return { ...rest, variants };
}
router.get("/products", P("products.read"), wrap(async (req, res) => {
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.query.category) q.category = req.query.category;
  if (req.query.q) q.title = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  res.json({ products: await req.R.products.find(q).sort({ createdAt: -1 }).limit(500).toArray() });
}));
router.post("/products", P("products.write"), F.enforceLimit("products"), wrap(async (req, res) => {
  const b = validate(productSchema, req.body);
  let slug = slugify(b.title);
  if (await req.R.products.findOne({ slug })) slug += "-" + Math.random().toString(36).slice(2, 6);
  const doc = { ...(await buildProduct(req, b, slug)), slug, createdAt: new Date() };
  const r = await req.R.products.insertOne(doc);
  await audit(req, "product.create", slug);
  require("../lib/webhooks").emit(req.actor.tenantId, "product.created", { id: String(r.insertedId), slug, title: b.title, price: b.price });
  res.status(201).json({ id: r.insertedId, slug });
}));
router.put("/products/:id", P("products.write"), wrap(async (req, res) => {
  const b = validate(productSchema.partial(), req.body);
  const cur = await req.R.products.findOne({ _id: oid(req.params.id) });
  if (!cur) throw httpError(404, "Product not found.");
  const upd = { ...b, updatedAt: new Date() };
  if (b.variants) upd.variants = (await buildProduct(req, { ...cur, ...b, price: b.price ?? cur.price }, cur.slug)).variants;
  delete upd.stock;
  await req.R.products.updateOne({ _id: cur._id }, { $set: upd });
  await audit(req, "product.update", cur.slug);
  require("../lib/webhooks").emit(req.actor.tenantId, "product.updated", { id: String(cur._id), slug: cur.slug, title: b.title || cur.title });
  res.json({ ok: true });
}));
router.delete("/products/:id", P("products.write"), wrap(async (req, res) => {
  const r = await req.R.products.deleteOne({ _id: oid(req.params.id) });
  if (!r.deletedCount) throw httpError(404, "Product not found.");
  await audit(req, "product.delete", req.params.id);
  res.json({ ok: true });
}));
// bulk CSV import / export (CAT-04): the browser parses the CSV and sends rows as JSON
router.post("/products/import", P("products.write"), FL("CAT-04"), wrap(async (req, res) => {
  const { rows } = validate(z.object({ rows: z.array(z.object({ title: z.string().min(2), category: z.string().optional(), price: z.coerce.number().min(0), stock: z.coerce.number().int().min(0).optional(), description: z.string().optional() })).min(1).max(1000) }), req.body);
  const eff = await F.resolve(req.tenant); const max = eff.limits.products;
  const have = await req.R.products.count();
  if (max >= 0 && have + rows.length > max) throw httpError(402, `Import would exceed your product limit (${max}).`);
  let created = 0;
  for (const r of rows) {
    let slug = slugify(r.title); if (await req.R.products.findOne({ slug })) slug += "-" + Math.random().toString(36).slice(2, 6);
    const price = Math.round(r.price * 100);
    await req.R.products.insertOne({ title: r.title, slug, description: r.description || "", category: r.category || "General", price, images: [], status: "active", tags: [], createdAt: new Date(),
      variants: [{ id: `${slug}-1`, sku: slug.slice(0, 6).toUpperCase() + "-1", title: "Default", price, stock: r.stock || 0 }] });
    created++;
  }
  await audit(req, "product.import", String(created));
  res.json({ created });
}));
router.get("/products/export", P("products.read"), FL("CAT-04"), wrap(async (req, res) => {
  const ps = await req.R.products.find({}).toArray();
  res.type("text/csv").send(csv([["title", "category", "price", "stock", "status"], ...ps.map((p) => [p.title, p.category, (p.price / 100).toFixed(2), p.variants.reduce((s, v) => s + v.stock, 0), p.status])]));
}));
router.post("/inventory/adjust", P("inventory.adjust"), wrap(async (req, res) => {
  const b = validate(z.object({ productId: z.string(), variantId: z.string(), delta: z.number().int().min(-100000).max(100000), reason: z.string().max(200).optional() }), req.body);
  const filter = { _id: oid(b.productId), variants: { $elemMatch: { id: b.variantId, ...(b.delta < 0 ? { stock: { $gte: -b.delta } } : {}) } } };
  const r = await req.R.products.updateOne(filter, { $inc: { "variants.$.stock": b.delta } });
  if (!r.modifiedCount) throw httpError(409, "Cannot adjust: stock would go below zero, or the item was not found.");
  await audit(req, "inventory.adjust", `${b.productId}:${b.variantId}`, { after: { delta: b.delta }, reason: b.reason });
  res.json({ ok: true });
}));

// ---------- orders (FR-042, 047) ----------
const NEXT = { pending: ["paid", "cancelled"], paid: ["fulfilled", "cancelled", "refunded"], fulfilled: ["refunded"], cancelled: [], refunded: [] };
router.get("/orders", P("orders.read"), wrap(async (req, res) => {
  const q = {}; if (req.query.status) q.status = req.query.status; if (req.query.channel) q.channel = req.query.channel;
  res.json({ orders: await req.R.orders.find(q).sort({ createdAt: -1 }).limit(300).toArray() });
}));
router.get("/orders/:id", P("orders.read"), wrap(async (req, res) => {
  const o = await req.R.orders.findOne({ _id: oid(req.params.id) });
  if (!o) throw httpError(404, "Order not found.");
  res.json({ order: o, allowed: NEXT[o.status] });
}));
router.post("/orders/:id/status", P("orders.read"), wrap(async (req, res) => {
  const { status, note, restock: rs } = validate(z.object({ status: z.enum(["paid", "fulfilled", "cancelled", "refunded"]), note: z.string().max(300).optional(), restock: z.boolean().optional() }), req.body);
  if (status === "refunded") {
    if (!require("../lib/perms").can(req.actor.perms, "orders.refund")) throw httpError(403, "Missing permission: orders.refund");
    if (!(await F.resolve(req.tenant)).flags["ORD-02"]) throw httpError(403, "Refunds are not available on your package (ORD-02).");
  } else if (!require("../lib/perms").can(req.actor.perms, "orders.refund") && req.actor.role === "cashier") {
    throw httpError(403, "Cashiers cannot change order status.");
  }
  const o = await req.R.orders.findOne({ _id: oid(req.params.id) });
  if (!o) throw httpError(404, "Order not found.");
  if (!NEXT[o.status].includes(status)) throw httpError(409, `Cannot move an order from ${o.status} to ${status}.`);
  const set = { status, updatedAt: new Date() };
  if (status === "paid") set["payments.0.status"] = "paid";
  if (status === "refunded") set["payments.0.status"] = "refunded";
  await req.R.orders.updateOne({ _id: o._id }, { $set: set, $push: { timeline: { at: new Date(), status, note: note || null, by: req.actor.email } } });
  if (status === "cancelled" || (status === "refunded" && rs)) await restock(req.R, o.lines);
  if (status === "cancelled") await require("../lib/loyalty").refund(req.R, o);
  if (status === "paid") await require("../lib/loyalty").award(req.R, req.tenant, { ...o, status: "paid" });
  await audit(req, `order.${status}`, o.number, { before: { status: o.status }, after: { status } });
  require("../lib/webhooks").emit(req.actor.tenantId, `order.${status}`, { number: o.number, status, total: o.total, currency: o.currency, customer: o.customer });
  res.json({ ok: true });
}));

// ---------- customers ----------
router.get("/customers", P("customers.read"), wrap(async (req, res) => {
  const cs = await req.R.customers.find({}, { projection: { name: 1, email: 1, phone: 1, createdAt: 1, deletedAt: 1, points: 1, hasAccount: { $cond: [{ $ifNull: ["$passwordHash", false] }, true, false] } } }).sort({ createdAt: -1 }).limit(500).toArray();
  const stats = await req.R.orders.aggregate([{ $match: { status: { $nin: ["cancelled"] } } }, { $group: { _id: "$customer.email", orders: { $sum: 1 }, spent: { $sum: "$total" } } }]).toArray();
  const m = Object.fromEntries(stats.map((s) => [s._id, s]));
  res.json({ customers: cs.map((c) => ({ ...c, orders: m[c.email]?.orders || 0, spent: m[c.email]?.spent || 0 })) });
}));
router.get("/customers/export", P("customers.export"), wrap(async (req, res) => {
  const cs = await req.R.customers.find({}).toArray();
  await audit(req, "customers.export", String(cs.length));
  res.type("text/csv").send(csv([["name", "email", "joined"], ...cs.map((c) => [c.name, c.email, c.createdAt?.toISOString?.() || ""])]));
}));

// ---------- discounts (MKT-02) ----------
const discSchema = z.object({ code: z.string().min(3).max(30).transform((s) => s.toUpperCase().replace(/[^A-Z0-9_-]/g, "")), type: z.enum(["percent", "fixed"]), value: z.number().int().min(1), minSubtotal: z.number().int().min(0).default(0), maxUses: z.number().int().min(1).optional(), auto: z.boolean().default(false), active: z.boolean().default(true), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional() });
router.get("/discounts", P("discounts.manage"), FL("MKT-02"), wrap(async (req, res) => res.json({ discounts: await req.R.discounts.find({}).sort({ createdAt: -1 }).toArray() })));
router.post("/discounts", P("discounts.manage"), FL("MKT-02"), wrap(async (req, res) => {
  const b = validate(discSchema, req.body);
  if (b.type === "percent" && b.value > 100) throw httpError(400, "Percent discount cannot exceed 100.");
  if (await req.R.discounts.findOne({ code: b.code })) throw httpError(409, "Code already exists.");
  if (b.auto && !(await F.resolve(req.tenant)).flags["MKT-03"]) throw httpError(403, "Automatic discounts are not available on your package (MKT-03).", { upgrade: true });
  await req.R.discounts.insertOne({ ...b, startsAt: b.startsAt && new Date(b.startsAt), endsAt: b.endsAt && new Date(b.endsAt), used: 0, createdAt: new Date() });
  await audit(req, "discount.create", b.code);
  res.status(201).json({ ok: true });
}));
router.patch("/discounts/:id", P("discounts.manage"), FL("MKT-02"), wrap(async (req, res) => {
  const b = validate(z.object({ active: z.boolean() }), req.body);
  await req.R.discounts.updateOne({ _id: oid(req.params.id) }, { $set: b });
  res.json({ ok: true });
}));
router.delete("/discounts/:id", P("discounts.manage"), FL("MKT-02"), wrap(async (req, res) => { await req.R.discounts.deleteOne({ _id: oid(req.params.id) }); res.json({ ok: true }); }));

// ---------- staff + roles (FR-028, 072) ----------
router.get("/staff", P("staff.manage"), wrap(async (req, res) => {
  res.json({ staff: await req.R.users.find({ status: { $ne: "deleted" } }, { projection: { passwordHash: 0, failures: 0 } }).toArray() });
}));
router.get("/roles", P("staff.manage"), wrap(async (req, res) => {
  const custom = await req.R.roles.find({}).toArray();
  res.json({ builtIn: Object.entries(TENANT_ROLES).map(([name, permissions]) => ({ name, permissions })), custom, allPermissions: TENANT_PERMISSIONS });
}));
async function roleAllowed(req, role) {
  if (role === "owner") return false;
  if (TENANT_ROLES[role]) return true;
  return !!(await req.R.roles.findOne({ name: role }));
}
router.post("/staff", P("staff.manage"), F.enforceLimit("staff"), wrap(async (req, res) => {
  const b = validate(z.object({ email: z.string().email().transform((s) => s.toLowerCase()), name: z.string().min(2).max(80), role: z.string() }), req.body);
  if (!(await roleAllowed(req, b.role))) throw httpError(400, "Invalid role.");
  if (await req.R.users.findOne({ email: b.email })) throw httpError(409, "That email already has an account here.");
  const r = await req.R.users.insertOne({ email: b.email, name: b.name, role: b.role, status: "invited", createdAt: new Date() });
  const token = await A.createToken("invite", { scope: "tenant", userId: String(r.insertedId), tenantId: req.actor.tenantId }, 72);
  const inviteUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/invite?token=${token}`;
  await require("../lib/mailer").send("invite", b.email, { name: b.name, store: req.tenant.name, url: inviteUrl });
  await audit(req, "staff.invite", b.email, { after: { role: b.role } });
  res.status(201).json({ inviteUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/invite?token=${token}`, inviteExpiresHours: 72 });
}));
router.patch("/staff/:id", P("staff.manage"), wrap(async (req, res) => {
  const b = validate(z.object({ role: z.string().optional(), status: z.enum(["active", "suspended", "deleted"]).optional() }), req.body);
  const u = await req.R.users.findOne({ _id: oid(req.params.id) });
  if (!u) throw httpError(404, "User not found.");
  if (u.role === "owner") throw httpError(403, "The owner account cannot be changed here.");
  if (b.role && !(await roleAllowed(req, b.role))) throw httpError(400, "Invalid role.");
  await req.R.users.updateOne({ _id: u._id }, { $set: b });
  await audit(req, "staff.update", u.email, { before: { role: u.role, status: u.status }, after: b });
  res.json({ ok: true });
}));
router.post("/roles", P("roles.manage"), FL("SEC-03"), wrap(async (req, res) => {
  const b = validate(z.object({ name: z.string().min(2).max(30).regex(/^[a-z0-9_-]+$/), permissions: z.array(z.enum(TENANT_PERMISSIONS)).min(1) }), req.body);
  if (TENANT_ROLES[b.name]) throw httpError(409, "That name is a built-in role.");
  if (await req.R.roles.findOne({ name: b.name })) throw httpError(409, "Role already exists.");
  await req.R.roles.insertOne({ ...b, createdAt: new Date() });
  await audit(req, "role.create", b.name);
  res.status(201).json({ ok: true });
}));
router.delete("/roles/:name", P("roles.manage"), FL("SEC-03"), wrap(async (req, res) => {
  if (await req.R.users.findOne({ role: req.params.name, status: { $ne: "deleted" } })) throw httpError(409, "Role is in use.");
  await req.R.roles.deleteOne({ name: req.params.name });
  res.json({ ok: true });
}));

// ---------- settings, plan, notifications, tickets, audit ----------
router.get("/settings", P("account.manage_self"), wrap(async (req, res) => res.json({ name: req.tenant.name, settings: req.tenant.settings || {}, slug: req.tenant.slug })));
router.patch("/settings", wrap(async (req, res, next) => {
  const b = validate(z.object({
    name: z.string().min(2).max(80).optional(), tagline: z.string().max(160).optional(), currency: z.string().length(3).optional(),
    customCss: z.string().max(10000).optional(),
    loyalty: z.object({ enabled: z.boolean(), earnRate: z.number().min(0).max(100), pointValueCents: z.number().int().min(1).max(10000), minRedeem: z.number().int().min(1).max(100000) }).optional(),
    shippingZones: z.array(z.object({ name: z.string().min(1).max(60), countries: z.array(z.string().min(2).max(60)).min(1).max(80), rate: z.number().int().min(0).max(100000000), freeOver: z.number().int().min(0).max(100000000).default(0) })).max(20).optional(),
    logoUrl: imgUrl.optional(), bannerUrl: imgUrl.optional(),
    categoryImages: z.record(z.string().max(60), imgUrl).refine((o) => Object.keys(o).length <= 40, "Too many category images.").optional(),
    taxRatePct: z.number().min(0).max(50).optional(), shippingFlat: z.number().int().min(0).optional(), freeShippingOver: z.number().int().min(0).optional(),
    theme: z.object({ primary: z.string().regex(/^#[0-9a-fA-F]{6}$/), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/), font: z.enum(["sans", "serif", "mono"]), style: z.enum(["modern", "classic", "bold", "minimal"]), mode: z.enum(["light", "dark"]).optional() }).optional(),
  }), req.body);
  const need = b.theme && Object.keys(b).length === 1 ? "theme.edit" : "settings.manage";
  if (!require("../lib/perms").can(req.actor.perms, need) && !require("../lib/perms").can(req.actor.perms, "settings.manage")) throw httpError(403, `Missing permission: ${need}`);
  if (b.loyalty && !(await F.resolve(req.tenant)).flags["MKT-06"]) throw httpError(403, "Loyalty points are not available on your package (MKT-06).", { upgrade: true });
  if (b.customCss !== undefined) {
    if (!(await F.resolve(req.tenant)).flags["STO-08"]) throw httpError(403, "Custom CSS is not available on your package (STO-08).", { upgrade: true });
    b.customCss = cleanCss(b.customCss);
  }
  const { name, ...rest } = b; const set = {};
  for (const [k, v] of Object.entries(rest)) set[`settings.${k}`] = v;
  if (name) set.name = name;
  await getDb().collection("tenants").updateOne({ slug: req.tenant.slug }, { $set: set });
  await audit(req, "settings.update", req.tenant.slug, { after: b });
  res.json({ ok: true });
}));
router.post("/plan/change", P("plan.billing.manage"), wrap(async (req, res) => {
  // Manual package change is only for development without Stripe; with Stripe configured, billing goes through /billing/checkout.
  if (process.env.ALLOW_INSTANT_PLAN_CHANGE !== "1") throw httpError(409, "Package changes are activated after your payment is approved. Use Plan & usage to send your payment.");
  const { packageId } = validate(z.object({ packageId: z.string() }), req.body);
  const pkg = await getDb().collection("packages").findOne({ key: packageId, archived: { $ne: true } });
  if (!pkg) throw httpError(400, "Unknown package.");
  await getDb().collection("tenants").updateOne({ slug: req.tenant.slug }, { $set: { packageId, status: req.tenant.status === "trial" ? "trial" : "active" } });
  await audit(req, "plan.change", packageId, { before: { packageId: req.tenant.packageId }, after: { packageId } });
  F.invalidate();
  // NOTE: Stripe Billing is not connected yet, so the change is applied immediately without payment.
  res.json({ ok: true, billing: "manual-dev-mode" });
}));
router.get("/notifications", wrap(async (req, res) => res.json({ notifications: await req.R.notifications.find({}).sort({ createdAt: -1 }).limit(50).toArray() })));
router.post("/notifications/read", wrap(async (req, res) => { await req.R.notifications.updateMany({ read: false }, { $set: { read: true } }); res.json({ ok: true }); }));
router.get("/tickets", FL("OPS-03"), wrap(async (req, res) => res.json({ tickets: await req.R.tickets.find({}).sort({ createdAt: -1 }).toArray() })));
router.post("/tickets", FL("OPS-03"), wrap(async (req, res) => {
  const b = validate(z.object({ subject: z.string().min(3).max(120), body: z.string().min(3).max(4000) }), req.body);
  await req.R.tickets.insertOne({ subject: b.subject, status: "open", tenantName: req.tenant.name, from: req.actor.email, messages: [{ from: "tenant", by: req.actor.email, body: b.body, at: new Date() }], createdAt: new Date() });
  res.status(201).json({ ok: true });
}));
router.get("/audit", P("audit.view"), FL("SEC-02"), wrap(async (req, res) => res.json({ logs: await req.R.audit.find({}).sort({ createdAt: -1 }).limit(300).toArray() })));
router.get("/data-export", wrap(async (req, res, next) => {
  if (req.actor.role !== "owner") throw httpError(403, "Only the owner can export all data.");
  const R = req.R;
  const [products, orders, customers] = await Promise.all([R.products.find({}).toArray(), R.orders.find({}).toArray(), R.customers.find({}, { projection: { passwordHash: 0 } }).toArray()]);
  await audit(req, "tenant.dataExport", req.tenant.slug);
  res.setHeader("Content-Disposition", `attachment; filename="${req.tenant.slug}-export.json"`);
  res.json({ exportedAt: new Date(), tenant: req.tenant.slug, products, orders, customers });
}));

// ---------- IP allow-list (SEC-04) ----------
const yourIp = (req) => String(req.ip || "").replace(/^::ffff:/, "");
router.get("/security/ip-allowlist", P("settings.manage"), FL("SEC-04"), wrap(async (req, res) => res.json({ ips: req.tenant.ipAllowList || [], yourIp: yourIp(req) })));
router.put("/security/ip-allowlist", P("settings.manage"), FL("SEC-04"), wrap(async (req, res) => {
  const { ips } = validate(z.object({ ips: z.array(z.string().max(45)).max(50) }), req.body);
  const net = require("net");
  for (const ip of ips) if (!net.isIP(ip)) throw httpError(400, `"${ip}" is not a valid IP address.`);
  // never let the owner lock themselves out
  if (ips.length && !ips.includes(yourIp(req)) && !req.actor.impersonatedBy) throw httpError(400, `Your current address (${yourIp(req)}) must be in the list, otherwise you would lock yourself out.`);
  await getDb().collection("tenants").updateOne({ slug: req.tenant.slug }, { $set: { ipAllowList: ips } });
  await audit(req, "security.ipAllowlist", String(ips.length));
  res.json({ ok: true });
}));

// ---------- GDPR (SEC-06): delete (anonymise) a customer ----------
router.delete("/customers/:id", P("customers.export"), FL("SEC-06"), wrap(async (req, res) => {
  const c = await req.R.customers.findOne({ _id: oid(req.params.id) });
  if (!c) throw httpError(404, "Customer not found.");
  await require("../lib/gdpr").anonymizeCustomer(req.R, c);
  await audit(req, "customer.anonymized", String(c._id));
  res.json({ ok: true });
}));

// ---------- reports (ANA-02) ----------
router.get("/reports/sales", P("reports.view"), FL("ANA-02"), wrap(async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = new Date(Date.now() - days * 864e5);
  const match = { createdAt: { $gte: since }, status: { $nin: ["cancelled", "refunded"] } };
  const [daily, top, channel] = await Promise.all([
    req.R.orders.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, revenue: { $sum: "$total" }, orders: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
    req.R.orders.aggregate([{ $match: match }, { $unwind: "$lines" }, { $group: { _id: "$lines.title", qty: { $sum: "$lines.qty" }, revenue: { $sum: "$lines.total" } } }, { $sort: { revenue: -1 } }, { $limit: 10 }]).toArray(),
    req.R.orders.aggregate([{ $match: match }, { $group: { _id: "$channel", revenue: { $sum: "$total" }, orders: { $sum: 1 } } }]).toArray(),
  ]);
  res.json({ days, daily, top, channel });
}));

// ---------- POS (FR-045) ----------
router.post("/pos/orders", P("orders.create_pos"), FL("POS-01"), F.enforceLimit("orders"), wrap(async (req, res) => {
  const b = validate(z.object({ items: z.array(z.object({ productId: z.string(), variantId: z.string().optional(), qty: z.number().int().min(1).max(99) })).min(1), paymentMethod: z.enum(["cash", "card"]), discountCode: z.string().optional(), customerEmail: z.string().email().optional() }), req.body);
  const order = await placeOrder({ R: req.R, tenant: req.tenant, items: b.items, customer: b.customerEmail ? { email: b.customerEmail.toLowerCase() } : { name: "Walk-in" }, paymentMethod: b.paymentMethod, code: b.discountCode, channel: "pos", cashier: req.actor.email });
  await audit(req, "pos.sale", order.number, { after: { total: order.total } });
  res.status(201).json({ order });
}));

module.exports = router;
