const { getDb } = require("../db");

// Immutable audit log (FR-017). There is deliberately no update or delete helper.
async function audit(req, action, target, extra = {}) {
  const a = req.actor || {};
  await getDb().collection("auditLogs").insertOne({
    createdAt: new Date(),
    actor: { id: a.id || null, email: a.email || null, scope: a.scope || null, role: a.role || null },
    tenantId: extra.tenantId || a.tenantId || null,
    action, target: target || null,
    reason: extra.reason || a.impersonationReason || null,
    impersonatedBy: a.impersonatedBy || null,
    before: extra.before || null, after: extra.after || null,
    ip: req.ip,
  });
}

const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";

// Tiny in-memory rate limiter (SEC-09). Production: use Redis / Vercel KV.
function rateLimit({ windowMs, max, key }) {
  const hits = new Map();
  return (req, res, next) => {
    const k = (key ? key(req) : req.ip) + ":" + req.path;
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: "Too many requests. Please slow down." });
    arr.push(now);
    hits.set(k, arr);
    next();
  };
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const e = new Error(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    e.status = 400;
    throw e;
  }
  return r.data;
}

const httpError = (status, message, extra) => Object.assign(new Error(message), { status }, extra || {});

async function nextNumber(tenantId, key) {
  const r = await getDb().collection("counters").findOneAndUpdate(
    { tenantId, key }, { $inc: { value: 1 } }, { upsert: true, returnDocument: "after" });
  return r.value;
}

// Packages in price order; custom-priced (null) packages such as Enterprise go last.
const byPrice = (a, b) => (a.priceMonthly ?? Infinity) - (b.priceMonthly ?? Infinity);

module.exports = { byPrice, audit, slugify, rateLimit, wrap, validate, httpError, nextNumber };
