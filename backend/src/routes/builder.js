// AI Store Builder API (SRS section 8): async jobs, draft preview, chat revisions, versioning, rollback.
const express = require("express");
const { z } = require("zod");
const { getDb } = require("../db");
const A = require("../lib/auth");
const F = require("../lib/flags");
const { scoped } = require("../lib/repo");
const { audit, slugify, wrap, validate, httpError, rateLimit } = require("../lib/util");
const { generateSpec } = require("../builder/generate");
const { bg } = require("../lib/bg");

const router = express.Router();
router.use(A.authenticate("tenant"));
router.use((req, res, next) => {
  if (req.tenant.status === "deleted" || (req.tenant.status === "suspended" && req.method !== "GET")) return res.status(403).json({ error: "This store is not available." });
  req.R = scoped(req.actor.tenantId);
  next();
});
router.use(A.requirePerm("aibuilder.use"), F.requireFlag("AI-01"));
const MAX_VERSIONS = 20;

async function addUsage(tenantId, credits) {
  await getDb().collection("usageCounters").updateOne({ tenantId, meter: "aiCredits", period: F.monthKey() }, { $inc: { value: credits } }, { upsert: true });
}

// Runs in the background. On Vercel this would be an Inngest/QStash job (serverless time limits).
async function runJob(R, tenant, jobId, input) {
  const set = (s) => R.jobs.updateOne({ _id: jobId }, { $set: s });
  try {
    await set({ state: "running", progress: 10, step: "Reading your requirements" });
    const latest = await R.specs.find({}).sort({ version: -1 }).limit(1).toArray();
    await set({ progress: 40, step: input.instruction ? "Applying your changes" : "Designing the store" });
    const started = Date.now();
    const { spec, source, note } = await generateSpec({ requirements: input.requirements, current: input.instruction ? latest[0]?.spec : null, instruction: input.instruction, section: input.section });
    await set({ progress: 85, step: "Validating the specification" });
    const version = (latest[0]?.version || 0) + 1;
    await R.specs.insertOne({ version, spec, status: "draft", jobId: String(jobId), createdAt: new Date() });
    // keep only the last 20 versions
    const old = await R.specs.find({}).sort({ version: -1 }).skip(MAX_VERSIONS).toArray();
    for (const o of old) if (o.status !== "published") await R.specs.deleteOne({ _id: o._id });
    await addUsage(R.tenantId, 1);
    await set({ state: "done", progress: 100, step: "Draft ready", version, source, note: note || null, durationMs: Date.now() - started, finishedAt: new Date(), credits: 1 });
  } catch (e) {
    console.error("[builder] job failed:", e.message);
    await set({ state: "failed", error: "Generation failed. Please try again or simplify your requirements.", finishedAt: new Date() });
  }
}

const reqSchema = z.object({ requirements: z.string().min(20, "Describe your store in at least 20 characters.").max(10000) });
router.post("/jobs", rateLimit({ windowMs: 60_000, max: 6, key: (r) => r.actor.id }), F.enforceLimit("aiCredits"), wrap(async (req, res) => {
  const b = validate(reqSchema, req.body);
  const r = await req.R.jobs.insertOne({ state: "queued", progress: 0, input: { requirements: b.requirements }, createdAt: new Date(), by: req.actor.email });
  bg(runJob(req.R, req.tenant, r.insertedId, { requirements: b.requirements }));
  await audit(req, "builder.generate", String(r.insertedId));
  res.status(202).json({ jobId: r.insertedId });
}));

// A visitor who typed their requirements on the home page and then signed up: start building automatically.
router.post("/auto-start", F.enforceLimit("aiCredits"), wrap(async (req, res) => {
  const text = req.tenant.signupRequirements;
  if (!text || text.length < 20) return res.json({ none: true });
  await getDb().collection("tenants").updateOne({ slug: req.tenant.slug }, { $unset: { signupRequirements: "" } });
  const r = await req.R.jobs.insertOne({ state: "queued", progress: 0, input: { requirements: text }, createdAt: new Date(), by: req.actor.email });
  bg(runJob(req.R, req.tenant, r.insertedId, { requirements: text }));
  await audit(req, "builder.generate", String(r.insertedId));
  res.status(202).json({ jobId: r.insertedId });
}));

router.post("/revise", rateLimit({ windowMs: 60_000, max: 10, key: (r) => r.actor.id }), F.enforceLimit("aiCredits"), wrap(async (req, res) => {
  const b = validate(z.object({ message: z.string().min(3).max(2000), section: z.string().max(30).optional() }), req.body);
  const first = await req.R.jobs.find({ "input.instruction": { $exists: false } }).sort({ createdAt: 1 }).limit(1).toArray();
  if (!first[0]) throw httpError(409, "Generate a first draft before requesting changes.");
  const r = await req.R.jobs.insertOne({ state: "queued", progress: 0, input: { requirements: first[0].input.requirements, instruction: b.message, section: b.section || null }, createdAt: new Date(), by: req.actor.email });
  bg(runJob(req.R, req.tenant, r.insertedId, { requirements: first[0].input.requirements, instruction: b.message, section: b.section }));
  await audit(req, "builder.revise", String(r.insertedId));
  res.status(202).json({ jobId: r.insertedId });
}));

router.get("/jobs", wrap(async (req, res) => res.json({ jobs: await req.R.jobs.find({}).sort({ createdAt: -1 }).limit(30).toArray() })));
router.get("/jobs/:id", wrap(async (req, res) => {
  const { ObjectId } = require("mongodb");
  if (!ObjectId.isValid(req.params.id)) throw httpError(400, "Invalid id.");
  const j = await req.R.jobs.findOne({ _id: new ObjectId(req.params.id) });
  if (!j) throw httpError(404, "Job not found.");
  res.json({ job: j });
}));
router.get("/specs", wrap(async (req, res) => res.json({ specs: await req.R.specs.find({}).sort({ version: -1 }).limit(MAX_VERSIONS).toArray() })));
router.get("/specs/:version", wrap(async (req, res) => {
  const s = await req.R.specs.findOne({ version: Number(req.params.version) });
  if (!s) throw httpError(404, "Version not found.");
  res.json({ spec: s });
}));

// Publish (or roll back to) a version: applies the configuration to the live store.
router.post("/specs/:version/publish", wrap(async (req, res) => {
  const s = await req.R.specs.findOne({ version: Number(req.params.version) });
  if (!s) throw httpError(404, "Version not found.");
  const sp = s.spec, R = req.R, db = getDb();
  const eff = await F.resolve(req.tenant);
  await db.collection("tenants").updateOne({ slug: req.tenant.slug }, { $set: {
    name: sp.storeName, "settings.currency": sp.currency, "settings.tagline": sp.tagline, "settings.theme": sp.theme, "settings.pages": sp.pages,
    "settings.categories": sp.categories, "settings.emailTemplates": sp.emailTemplates, "settings.language": sp.language } });
  let added = 0;
  const have = await R.products.count();
  if (have < 3) {
    const max = eff.limits.products;
    for (const p of sp.sampleProducts) {
      if (max >= 0 && have + added >= max) break;
      let slug = slugify(p.title); if (await R.products.findOne({ slug })) slug += "-" + Math.random().toString(36).slice(2, 6);
      await R.products.insertOne({ title: p.title, slug, description: p.description, category: p.category, price: p.price, emoji: p.emoji || "🛍️", images: [], status: "active", tags: [], createdAt: new Date(),
        variants: [{ id: `${slug}-1`, sku: slug.slice(0, 6).toUpperCase() + "-1", title: "Default", price: p.price, stock: 25 }] });
      added++;
    }
  }
  const available = sp.flags.filter((f) => eff.flags[f]), needUpgrade = sp.flags.filter((f) => f in eff.flags && !eff.flags[f]);
  await R.specs.updateMany({ status: "published" }, { $set: { status: "superseded" } });
  await R.specs.updateOne({ _id: s._id }, { $set: { status: "published", publishedAt: new Date() } });
  await audit(req, "builder.publish", `v${s.version}`, { after: { productsAdded: added } });
  res.json({ ok: true, version: s.version, productsAdded: added, featuresAvailable: available, featuresNeedingUpgrade: needUpgrade });
}));

module.exports = router;
