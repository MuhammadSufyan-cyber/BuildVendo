// Feature flags and package limits (SRS section 11, FR-070/071).
// Resolution order: global kill switch -> tenant override -> package setting -> global default.
const { getDb } = require("../db");
const { FEATURES } = require("./features");

const cache = new Map(); // tenantSlug -> { at, value }
const TTL_MS = 60 * 1000;
const invalidate = () => cache.clear();

async function resolve(tenant) {
  // paid period over (plus 3 days of grace): back to the Free package until the store pays again
  if (tenant.paidUntil && tenant.packageId !== "free" && tenant.status === "active" && new Date(tenant.paidUntil).getTime() + 3 * 864e5 < Date.now()) {
    await getDb().collection("tenants").updateOne({ slug: tenant.slug }, { $set: { packageId: "free", billing: { state: "expired" } } });
    await getDb().collection("notifications").insertOne({ tenantId: tenant.slug, title: "Package expired", body: "Your paid package has ended and your store moved to the Free package. Renew it in Plan & usage to get your features back.", createdAt: new Date(), read: false, from: "platform" });
    tenant.packageId = "free"; tenant.billing = { state: "expired" }; cache.delete(tenant.slug);
  }
  // trial finished: drop to the fallback package (lazily, on first use after the end date)
  if (tenant.status === "trial" && tenant.trialEndsAt && new Date(tenant.trialEndsAt) < new Date()) {
    const fallback = tenant.afterTrialPackage || "free";
    await getDb().collection("tenants").updateOne({ slug: tenant.slug, status: "trial" }, { $set: { status: "active", packageId: fallback } });
    tenant.status = "active"; tenant.packageId = fallback; cache.delete(tenant.slug);
  }
  const hit = cache.get(tenant.slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const db = getDb();
  const [pkg, defs, ov] = await Promise.all([
    db.collection("packages").findOne({ key: tenant.packageId }),
    db.collection("featureDefinitions").find({}).toArray(),
    db.collection("tenantOverrides").findOne({ tenantId: tenant.slug }),
  ]);
  const overrideActive = ov && (!ov.expiresAt || ov.expiresAt > new Date());
  const defMap = Object.fromEntries(defs.map((d) => [d.id, d]));
  const flags = {};
  for (const f of FEATURES) {
    const def = defMap[f.id] || {};
    if (def.killed) { flags[f.id] = false; continue; }
    if (overrideActive && ov.flags && f.id in ov.flags) { flags[f.id] = !!ov.flags[f.id]; continue; }
    if (pkg && pkg.flags && f.id in pkg.flags) { flags[f.id] = !!pkg.flags[f.id]; continue; }
    flags[f.id] = !!def.defaultState;
  }
  const limits = { ...(pkg ? pkg.limits : {}), ...(overrideActive && ov.limits ? ov.limits : {}) };
  const value = { flags, limits, package: pkg };
  cache.set(tenant.slug, { at: Date.now(), value });
  return value;
}

// Server-side enforcement: a disabled feature returns 403 even if called directly.
const requireFlag = (id) => async (req, res, next) => {
  try {
    const { flags } = await resolve(req.tenant);
    if (!flags[id]) return res.status(403).json({ error: `Feature ${id} is not available on your package.`, feature: id, upgrade: true });
    next();
  } catch (e) { next(e); }
};

const monthKey = () => new Date().toISOString().slice(0, 7);

async function usage(tenantSlug) {
  const db = getDb();
  const [products, staff, ordersThisMonth, ai] = await Promise.all([
    db.collection("products").countDocuments({ tenantId: tenantSlug }),
    db.collection("tenantUsers").countDocuments({ tenantId: tenantSlug, status: { $ne: "deleted" } }),
    db.collection("orders").countDocuments({ tenantId: tenantSlug, createdAt: { $gte: new Date(monthKey() + "-01T00:00:00Z") } }),
    db.collection("usageCounters").findOne({ tenantId: tenantSlug, meter: "aiCredits", period: monthKey() }),
  ]);
  return { products, staff, orders: ordersThisMonth, aiCredits: ai ? ai.value : 0 };
}

// limitKey: products | staff | orders | aiCredits  (-1 or null = unlimited)
const enforceLimit = (limitKey, extra = 0) => async (req, res, next) => {
  try {
    const { limits } = await resolve(req.tenant);
    const max = limits[limitKey];
    if (max === undefined || max === null || max < 0) return next();
    const u = await usage(req.tenant.slug);
    if (u[limitKey] + 1 + extra > max) {
      return res.status(402).json({ error: `Limit reached for ${limitKey} (${max}) on your package. Upgrade to add more.`, limit: limitKey, max, upgrade: true });
    }
    next();
  } catch (e) { next(e); }
};

module.exports = { resolve, requireFlag, enforceLimit, usage, invalidate, monthKey };
