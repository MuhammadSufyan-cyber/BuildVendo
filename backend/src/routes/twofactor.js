// Two-factor authentication setup (SRS FR-025). Login itself is handled in routes/auth.js.
const express = require("express");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { z } = require("zod");
const { ObjectId } = require("mongodb");
const { getDb } = require("../db");
const A = require("../lib/auth");
const T = require("../lib/totp");
const { encrypt, decrypt } = require("../lib/crypto");
const { wrap, validate, httpError, rateLimit } = require("../lib/util");

const router = express.Router();
const limit = rateLimit({ windowMs: 60_000, max: 12 });
const ISSUER = "BuildVendo";

// Works for either kind of account; the page says which one it is signed in as.
router.use((req, res, next) => A.authenticate(req.query.scope === "platform" ? "platform" : "tenant")(req, res, next));
const coll = (req) => (req.actor.scope === "platform" ? "platformUsers" : "tenantUsers");
const me = (req) => getDb().collection(coll(req)).findOne({ _id: new ObjectId(req.actor.id) });
const hashCode = (c) => crypto.createHash("sha256").update(String(c).toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");

router.get("/status", wrap(async (req, res) => {
  const u = await me(req);
  res.json({ enabled: !!u.twoFactor?.enabled, recoveryCodesLeft: u.twoFactor?.recovery?.length || 0, requiredByPlatform: req.actor.scope === "platform" && process.env.REQUIRE_2FA_PLATFORM === "1" });
}));

router.post("/setup", limit, wrap(async (req, res) => {
  const u = await me(req);
  if (u.twoFactor?.enabled) throw httpError(409, "Two-factor login is already on.");
  const secret = T.newSecret();
  await getDb().collection(coll(req)).updateOne({ _id: u._id }, { $set: { "twoFactor.pendingEnc": encrypt(secret) } });
  const uri = T.otpauthUri(secret, u.email, ISSUER);
  res.json({ secret, otpauth: uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
}));

router.post("/enable", limit, wrap(async (req, res) => {
  const { code } = validate(z.object({ code: z.string() }), req.body);
  const u = await me(req);
  if (!u.twoFactor?.pendingEnc) throw httpError(409, "Start the setup first.");
  const step = T.verify(decrypt(u.twoFactor.pendingEnc), code);
  if (step === null) throw httpError(400, "That code is not right. Check the time on your phone and try the next code.");
  const codes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString("hex").toUpperCase().replace(/^(.{5})(.{5})$/, "$1-$2"));
  await getDb().collection(coll(req)).updateOne({ _id: u._id }, { $set: { twoFactor: { enabled: true, secretEnc: u.twoFactor.pendingEnc, lastStep: step, recovery: codes.map(hashCode), enabledAt: new Date() } } });
  await getDb().collection("auditLogs").insertOne({ createdAt: new Date(), actor: { id: req.actor.id, email: req.actor.email, scope: req.actor.scope, role: req.actor.role }, tenantId: req.actor.tenantId || null, action: "auth.2fa.enabled", target: req.actor.email, ip: req.ip });
  res.json({ ok: true, recoveryCodes: codes }); // shown once
}));

// Turning it off needs the password AND a current code (or recovery code).
router.post("/disable", limit, wrap(async (req, res) => {
  const b = validate(z.object({ password: z.string().max(128), code: z.string() }), req.body);
  const u = await me(req);
  if (!u.twoFactor?.enabled) throw httpError(409, "Two-factor login is not on.");
  if (!(await A.verifyPassword(u.passwordHash, b.password))) throw httpError(401, "Wrong password.");
  const ok = T.verify(decrypt(u.twoFactor.secretEnc), b.code) !== null || u.twoFactor.recovery.includes(hashCode(b.code));
  if (!ok) throw httpError(400, "That code is not right.");
  await getDb().collection(coll(req)).updateOne({ _id: u._id }, { $unset: { twoFactor: "" } });
  await getDb().collection("auditLogs").insertOne({ createdAt: new Date(), actor: { id: req.actor.id, email: req.actor.email, scope: req.actor.scope, role: req.actor.role }, tenantId: req.actor.tenantId || null, action: "auth.2fa.disabled", target: req.actor.email, ip: req.ip });
  res.json({ ok: true });
}));

module.exports = router;
module.exports.hashCode = hashCode;
