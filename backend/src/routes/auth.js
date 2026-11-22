const express = require("express");
const { z } = require("zod");
const { ObjectId } = require("mongodb");
const { getDb } = require("../db");
const A = require("../lib/auth");
const { wrap, validate, httpError, rateLimit } = require("../lib/util");

const router = express.Router();
const loginLimit = rateLimit({ windowMs: 60_000, max: 15 });

const loginSchema = z.object({
  scope: z.enum(["platform", "tenant"]),
  tenantSlug: z.string().optional(),
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128),
});

router.post("/login", loginLimit, wrap(async (req, res) => {
  const b = validate(loginSchema, req.body);
  const db = getDb();
  const coll = b.scope === "platform" ? "platformUsers" : "tenantUsers";
  const q = b.scope === "platform" ? { email: b.email } : { tenantId: String(b.tenantSlug || "").toLowerCase(), email: b.email };
  const user = await db.collection(coll).findOne(q);
  const generic = httpError(401, "Invalid ID or password.");
  if (!user || !user.passwordHash) throw generic;
  if (await A.checkLock(coll, user)) throw httpError(423, "Too many failed attempts. Try again in 15 minutes.");
  if (!(await A.verifyPassword(user.passwordHash, b.password))) { await A.registerFailure(coll, user); throw generic; }
  if (user.status === "unverified") throw httpError(403, "Please confirm your email first. Check your inbox for the confirmation link.");
  if (user.status !== "active") throw httpError(403, "This account is not active.");
  if (b.scope === "tenant") {
    const t = await db.collection("tenants").findOne({ slug: q.tenantId });
    if (!t || t.status === "deleted") throw generic;
  }
  await A.clearFailures(coll, user);
  const claims = { sub: String(user._id), scope: b.scope, ...(b.scope === "tenant" ? { tenantId: q.tenantId } : {}) };
  if (user.twoFactor && user.twoFactor.enabled) return res.json({ twoFactorRequired: true, challenge: A.sign({ ...claims, kind: "2fa" }, 5) }); // second step below
  A.setCookie(res, b.scope, A.sign(claims, 8 * 60), 8 * 60);
  await db.collection(coll).updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  res.json({ ok: true, user: { email: user.email, name: user.name, role: user.role } });
}));

// Second step of a 2FA login: authenticator code (usable once) or a recovery code.
router.post("/login/2fa", loginLimit, wrap(async (req, res) => {
  const b = validate(z.object({ challenge: z.string().min(10), code: z.string().min(6).max(20) }), req.body);
  const claims = A.verify(b.challenge);
  if (!claims || claims.kind !== "2fa") throw httpError(401, "This sign-in expired. Please start again.");
  const T = require("../lib/totp"), { decrypt } = require("../lib/crypto"), { hashCode } = require("./twofactor");
  const coll = claims.scope === "platform" ? "platformUsers" : "tenantUsers";
  const user = await getDb().collection(coll).findOne({ _id: new ObjectId(claims.sub) });
  if (!user || user.status !== "active" || !(user.twoFactor && user.twoFactor.enabled)) throw httpError(401, "This sign-in expired. Please start again.");
  if (await A.checkLock(coll, user)) throw httpError(423, "Too many failed attempts. Try again in 15 minutes.");
  const step = T.verify(decrypt(user.twoFactor.secretEnc), b.code);
  const rec = hashCode(b.code);
  if (step !== null && step > (user.twoFactor.lastStep || 0)) {
    await getDb().collection(coll).updateOne({ _id: user._id }, { $set: { "twoFactor.lastStep": step, lastLoginAt: new Date() } });
  } else if (user.twoFactor.recovery.includes(rec)) {
    await getDb().collection(coll).updateOne({ _id: user._id }, { $pull: { "twoFactor.recovery": rec }, $set: { lastLoginAt: new Date() } }); // each recovery code works once
  } else { await A.registerFailure(coll, user); throw httpError(401, "That code is not right."); }
  await A.clearFailures(coll, user);
  const { kind, iat, exp, ...session } = claims;
  A.setCookie(res, claims.scope, A.sign(session, 8 * 60), 8 * 60);
  res.json({ ok: true, user: { email: user.email, name: user.name, role: user.role } });
}));

router.post("/logout", (req, res) => {
  const scope = req.body?.scope;
  if (scope && A.COOKIES[scope]) A.clearCookie(res, A.COOKIES[scope]);
  res.json({ ok: true });
});

router.get("/me", wrap(async (req, res, next) => {
  const scope = req.query.scope === "platform" ? "platform" : "tenant";
  await A.authenticate(scope)(req, res, () => {
    const a = req.actor;
    res.json({ user: { id: a.id, email: a.email, name: a.name, role: a.role, scope: a.scope, perms: a.perms, twoFactor: !!a.twoFactor, tenantId: a.tenantId || null,
      tenantName: req.tenant?.name || null, impersonatedBy: a.impersonatedBy, impersonationReason: a.impersonationReason } });
  });
}));

// Accept an invitation: the invited person sets their own password.
router.post("/invite/accept", loginLimit, wrap(async (req, res) => {
  const { token, password } = validate(z.object({ token: z.string().min(10), password: z.string() }), req.body);
  const problem = A.passwordProblem(password);
  if (problem) throw httpError(400, problem);
  const data = await A.consumeToken("invite", token);
  if (!data) throw httpError(400, "This invitation is invalid or has expired.");
  const coll = data.scope === "platform" ? "platformUsers" : "tenantUsers";
  await getDb().collection(coll).updateOne({ _id: new ObjectId(data.userId) },
    { $set: { passwordHash: await A.hashPassword(password), status: "active", failures: [] }, $unset: { lockUntil: "" } });
  res.json({ ok: true, scope: data.scope, tenantId: data.tenantId || null });
}));

// Forgot password: always answers OK. No email provider is configured yet, so in development the
// reset link is printed in the backend console instead of being emailed.
router.post("/password/forgot", loginLimit, wrap(async (req, res) => {
  const b = validate(loginSchema.omit({ password: true }), req.body);
  const coll = b.scope === "platform" ? "platformUsers" : "tenantUsers";
  const q = b.scope === "platform" ? { email: b.email } : { tenantId: String(b.tenantSlug || "").toLowerCase(), email: b.email };
  const user = await getDb().collection(coll).findOne(q);
  if (user) {
    const token = await A.createToken("reset", { scope: b.scope, userId: String(user._id), tenantId: q.tenantId }, 0.5);
    await require("../lib/mailer").send("reset", b.email, { url: `${require("../lib/mailer").appUrl()}/reset?token=${token}` });
  }
  res.json({ ok: true });
}));

router.post("/password/reset", loginLimit, wrap(async (req, res) => {
  const { token, password } = validate(z.object({ token: z.string().min(10), password: z.string() }), req.body);
  const problem = A.passwordProblem(password);
  if (problem) throw httpError(400, problem);
  const data = await A.consumeToken("reset", token);
  if (!data) throw httpError(400, "This reset link is invalid or has expired.");
  const coll = data.scope === "platform" ? "platformUsers" : "tenantUsers";
  await getDb().collection(coll).updateOne({ _id: new ObjectId(data.userId) },
    { $set: { passwordHash: await A.hashPassword(password), failures: [] }, $unset: { lockUntil: "" } });
  res.json({ ok: true });
}));

module.exports = router;
