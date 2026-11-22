const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const argon2 = require("@node-rs/argon2");
const { getDb } = require("../db");
const { PLATFORM_ROLES, TENANT_ROLES, can } = require("./perms");

const COOKIES = { platform: "ps", tenant: "ts", customer: "cs" };
const SECRET = () => process.env.JWT_SECRET || "dev-secret-change-me";
const PEPPER = () => process.env.PASSWORD_PEPPER || "dev-pepper-change-me";

// Passwords: HMAC with a server-side pepper, then Argon2id (SRS 6.2). Nobody can read a password back.
const pepper = (pw) => crypto.createHmac("sha256", PEPPER()).update(pw).digest("base64");
const hashPassword = (pw) => argon2.hash(pepper(pw), { algorithm: argon2.Algorithm.Argon2id });
const verifyPassword = async (hash, pw) => {
  try { return await argon2.verify(hash, pepper(pw)); } catch { return false; }
};

function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 12) return "Password must be at least 12 characters.";
  if (pw.length > 128) return "Password must be at most 128 characters.";
  const common = ["password1234", "123456789012", "qwertyuiop12", "administrator1"];
  if (common.some((c) => pw.toLowerCase().includes(c))) return "That password is too common.";
  return null;
}

const sign = (claims, minutes = 60 * 8) => jwt.sign(claims, SECRET(), { expiresIn: `${minutes}m` });
const verify = (t) => { try { return jwt.verify(t, SECRET()); } catch { return null; } };

function setCookie(res, scope, token, minutes, name) {
  res.cookie(name || COOKIES[scope], token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: minutes * 60 * 1000, path: "/",
  });
}
const clearCookie = (res, name) => res.clearCookie(name, { path: "/" });

// One-time tokens (invites, resets): only the SHA-256 hash is stored.
async function createToken(kind, data, hours) {
  const raw = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  await getDb().collection("tokens").insertOne({ hash, kind, data, expiresAt: new Date(Date.now() + hours * 3600 * 1000) });
  return raw;
}
async function consumeToken(kind, raw) {
  const hash = crypto.createHash("sha256").update(String(raw)).digest("hex");
  const doc = await getDb().collection("tokens").findOneAndDelete({ hash, kind, expiresAt: { $gt: new Date() } });
  return doc ? doc.data : null;
}

// ---- Lockout (FR-024): 5 failures in 15 minutes ----
async function checkLock(coll, user) {
  return user && user.lockUntil && user.lockUntil > new Date();
}
async function registerFailure(coll, user) {
  const now = Date.now();
  const recent = (user.failures || []).filter((t) => now - t < 15 * 60 * 1000);
  recent.push(now);
  const set = { failures: recent };
  if (recent.length >= 5) set.lockUntil = new Date(now + 15 * 60 * 1000);
  await getDb().collection(coll).updateOne({ _id: user._id }, { $set: set });
}
const clearFailures = (coll, user) => getDb().collection(coll).updateOne({ _id: user._id }, { $set: { failures: [] }, $unset: { lockUntil: "" } });

// ---- Middleware ----
// Loads the signed-in actor for the given scope; sets req.actor.
function authenticate(scope) {
  return async (req, res, next) => {
    const claims = verify(req.cookies?.[COOKIES[scope]]);
    // a "kind" claim marks a half-finished login (password OK, 2FA code pending): never valid as a session
    if (!claims || claims.kind || claims.scope !== scope) return res.status(401).json({ error: "Not signed in." });
    try {
      const db = getDb();
      const { ObjectId } = require("mongodb");
      if (scope === "platform") {
        const u = await db.collection("platformUsers").findOne({ _id: new ObjectId(claims.sub) });
        if (!u || u.status !== "active") return res.status(401).json({ error: "Account is not active." });
        const tf = !!(u.twoFactor && u.twoFactor.enabled);
        // Platform staff must use 2FA when REQUIRE_2FA_PLATFORM=1 (recommended in production)
        if (process.env.REQUIRE_2FA_PLATFORM === "1" && !tf && !/^\/api\/auth\/(2fa|me|logout)/.test(req.originalUrl)) return res.status(403).json({ error: "Two-factor login must be set up before you can continue.", twoFactorSetupRequired: true });
        req.actor = { id: String(u._id), email: u.email, name: u.name, scope, role: u.role, perms: PLATFORM_ROLES[u.role] || [], twoFactor: tf };
      } else {
        const u = await db.collection("tenantUsers").findOne({ _id: new ObjectId(claims.sub), tenantId: claims.tenantId });
        if (!u || u.status !== "active") return res.status(401).json({ error: "Account is not active." });
        const tenant = await db.collection("tenants").findOne({ slug: claims.tenantId });
        if (!tenant) return res.status(401).json({ error: "Tenant not found." });
        let perms = TENANT_ROLES[u.role];
        if (!perms) {
          const role = await db.collection("roles").findOne({ tenantId: claims.tenantId, name: u.role });
          perms = role ? role.permissions : [];
        }
        // IP allow-list (SEC-04): only listed network addresses may use this store's dashboard. Platform impersonation is exempt.
        if (!claims.imp && Array.isArray(tenant.ipAllowList) && tenant.ipAllowList.length) {
          const f = await require("./flags").resolve(tenant);
          const ip = String(req.ip || "").replace(/^::ffff:/, "");
          if (f.flags["SEC-04"] && !tenant.ipAllowList.includes(ip)) return res.status(403).json({ error: "Your network address is not allowed to use this dashboard.", ipBlocked: true });
        }
        req.tenant = tenant;
        req.actor = { id: String(u._id), email: u.email, name: u.name, scope, role: u.role, perms, tenantId: claims.tenantId, twoFactor: !!(u.twoFactor && u.twoFactor.enabled),
          impersonatedBy: claims.imp || null, impersonationReason: claims.reason || null };
      }
      next();
    } catch (e) { next(e); }
  };
}

const requirePerm = (needed) => (req, res, next) => {
  if (!can(req.actor.perms, needed)) return res.status(403).json({ error: `Missing permission: ${needed}` });
  next();
};

module.exports = { COOKIES, hashPassword, verifyPassword, passwordProblem, sign, verify, setCookie, clearCookie,
  createToken, consumeToken, checkLock, registerFailure, clearFailures, authenticate, requirePerm };
