// Custom domains for a store (PLT-02): the owner adds a domain, proves ownership with a DNS TXT record, then it serves the store.
const express = require("express");
const dns = require("dns").promises;
const crypto = require("crypto");
const { z } = require("zod");
const { getDb } = require("../db");
const A = require("../lib/auth");
const F = require("../lib/flags");
const { audit, wrap, validate, httpError } = require("../lib/util");

const router = express.Router();
router.use(A.authenticate("tenant"));
router.use((req, res, next) => {
  if (req.tenant.status === "deleted" || (req.tenant.status === "suspended" && req.method !== "GET")) return res.status(403).json({ error: "This store is not available." });
  next();
});
router.use(A.requirePerm("settings.manage"), F.requireFlag("PLT-02"));

const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const root = () => (process.env.ROOT_DOMAIN || "localhost").toLowerCase();

router.get("/", wrap(async (req, res) => {
  const { limits } = await F.resolve(req.tenant);
  res.json({ domains: req.tenant.domains || [], max: limits.domains ?? 0, rootDomain: root(), subdomain: `${req.tenant.slug}.${root()}` });
}));

router.post("/", wrap(async (req, res) => {
  const { domain } = validate(z.object({ domain: z.string().transform((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")) }), req.body);
  if (!HOST.test(domain)) throw httpError(400, "That does not look like a domain name, for example shop.example.com.");
  if (domain === root() || domain.endsWith("." + root())) throw httpError(400, "That domain belongs to the platform.");
  const { limits } = await F.resolve(req.tenant);
  const have = (req.tenant.domains || []).length;
  if (limits.domains >= 0 && have >= limits.domains) throw httpError(402, `Your package allows ${limits.domains} custom domain(s). Upgrade to add more.`, { upgrade: true });
  if (await getDb().collection("tenants").findOne({ "domains.name": domain })) throw httpError(409, "That domain is already connected to a store.");
  const token = "commerce-verify=" + crypto.randomBytes(16).toString("hex");
  await getDb().collection("tenants").updateOne({ slug: req.tenant.slug }, { $push: { domains: { name: domain, token, verified: false, addedAt: new Date() } } });
  await audit(req, "domain.add", domain);
  res.status(201).json({ ok: true, instructions: { txtHost: `_commerce-verify.${domain}`, txtValue: token, cname: `${req.tenant.slug}.${root()}` } });
}));

// DNS check: the TXT record at _commerce-verify.<domain> must equal the token.
router.post("/:domain/verify", wrap(async (req, res) => {
  const d = (req.tenant.domains || []).find((x) => x.name === req.params.domain);
  if (!d) throw httpError(404, "Domain not found.");
  let records = [];
  try { records = (await dns.resolveTxt(`_commerce-verify.${d.name}`)).map((r) => r.join("")); } catch { /* not found yet */ }
  if (!records.includes(d.token)) throw httpError(409, "We could not find the DNS record yet. DNS changes can take up to a few hours; try again later.");
  await getDb().collection("tenants").updateOne({ slug: req.tenant.slug, "domains.name": d.name }, { $set: { "domains.$.verified": true, "domains.$.verifiedAt": new Date() } });
  await audit(req, "domain.verified", d.name);
  res.json({ ok: true });
}));

router.delete("/:domain", wrap(async (req, res) => {
  await getDb().collection("tenants").updateOne({ slug: req.tenant.slug }, { $pull: { domains: { name: req.params.domain } } });
  await audit(req, "domain.remove", req.params.domain);
  res.json({ ok: true });
}));

module.exports = router;
