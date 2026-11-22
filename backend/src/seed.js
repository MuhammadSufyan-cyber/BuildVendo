// Seeds packages, the feature catalog, a Super Admin and a demo tenant.
// Passwords are generated randomly and written ONLY to backend/.seed-credentials.txt (git-ignored).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getDb } = require("./db");
const { FEATURES, PLAN_ORDER, flagsForPlan } = require("./lib/features");
const { hashPassword } = require("./lib/auth");

const PACKAGES = [
  // Prices are in PKR per month / per year. Edit them freely in Super Admin -> Packages after the first start.
  { key: "free", name: "Free", priceMonthly: 0, priceYearly: 0, trialDays: 0, limits: { products: 7, staff: 1, orders: 30, storageMB: 200, aiCredits: 0, domains: 0, apiCalls: 0, transactionFeePct: 2 } },
  { key: "basic", name: "Starter", priceMonthly: 5000, priceYearly: 50000, trialDays: 14, limits: { products: 100, staff: 2, orders: 300, storageMB: 2048, aiCredits: 0, domains: 0, apiCalls: 0, transactionFeePct: 1 } },
  { key: "pro", name: "Pro", priceMonthly: 15000, priceYearly: 150000, trialDays: 14, limits: { products: 2000, staff: 5, orders: 3000, storageMB: 10240, aiCredits: 50, domains: 0, apiCalls: 0, transactionFeePct: 0.5 } },
  { key: "premium", name: "Premium", priceMonthly: 40000, priceYearly: 400000, trialDays: 14, limits: { products: 20000, staff: 20, orders: 30000, storageMB: 51200, aiCredits: 500, domains: 3, apiCalls: 100000, transactionFeePct: 0 } },
  { key: "enterprise", name: "Enterprise", priceMonthly: null, priceYearly: null, trialDays: 0, limits: { products: -1, staff: -1, orders: -1, storageMB: -1, aiCredits: -1, domains: -1, apiCalls: -1, transactionFeePct: 0 } },
];

const rand = () => crypto.randomBytes(12).toString("base64url") + "Aa1!";

const DEMO_PRODUCTS = [
  ["Classic White Tee", "Apparel", 1999, "👕", [["S", 20], ["M", 30], ["L", 25]]],
  ["Denim Jacket", "Apparel", 6999, "🧥", [["M", 10], ["L", 8]]],
  ["Running Sneakers", "Footwear", 8999, "👟", [["40", 12], ["42", 15], ["44", 9]]],
  ["Leather Wallet", "Accessories", 3499, "👛", [["One size", 40]]],
  ["Canvas Backpack", "Accessories", 4999, "🎒", [["One size", 22]]],
  ["Wireless Earbuds", "Electronics", 5999, "🎧", [["Black", 35], ["White", 20]]],
  ["Smart Watch", "Electronics", 12999, "⌚", [["Black", 14]]],
  ["Ceramic Mug", "Home", 1299, "☕", [["350ml", 60]]],
  ["Scented Candle", "Home", 1599, "🕯️", [["Lavender", 45], ["Vanilla", 40]]],
  ["Yoga Mat", "Fitness", 2999, "🧘", [["Standard", 28]]],
  ["Sunglasses", "Accessories", 2499, "🕶️", [["One size", 33]]],
  ["Desk Lamp", "Home", 3999, "💡", [["White", 18]]],
];

async function resetDemo() {
  const db = getDb();
  for (const c of ["tenants", "products", "orders", "discounts", "storeSpecs", "generationJobs", "usageCounters", "counters", "auditLogs", "notifications", "tickets", "reviews", "tenantOverrides", "uploads", "billingRequests", "posts", "returns", "files"]) {
    await db.collection(c).deleteMany(c === "tenants" ? { slug: "demo" } : { tenantId: "demo" });
  }
  await db.collection("customers").deleteMany({ tenantId: "demo", passwordHash: { $exists: false } });
  await db.collection("tenants").deleteMany({ slug: { $regex: "^smoketest-" } }); // stores created by the smoke test
  // remove data left behind by any store that no longer exists
  const live = (await db.collection("tenants").find({}).project({ slug: 1 }).toArray()).map((t) => t.slug);
  live.push("demo"); // the demo store is recreated right after this, so its accounts must survive (passwords stay stable)
  for (const c of ["products", "orders", "customers", "discounts", "tenantUsers", "roles", "tenantOverrides", "usageCounters", "counters", "storeSpecs", "generationJobs", "auditLogs", "notifications", "tickets", "reviews", "uploads", "billingRequests", "webhooks", "posts", "returns", "files"]) {
    await db.collection(c).deleteMany({ tenantId: { $nin: live, $ne: null } });
  }
  // uploaded files of the demo store and of throwaway test stores
  const uploads = path.join(__dirname, "..", "uploads");
  const privateDir = path.join(__dirname, "..", "private-uploads"); // payment proofs
  if (fs.existsSync(privateDir)) for (const d of fs.readdirSync(privateDir)) if (d === "demo" || d.startsWith("smoketest-")) fs.rmSync(path.join(privateDir, d), { recursive: true, force: true });
  if (fs.existsSync(uploads)) for (const d of fs.readdirSync(uploads)) if (d === "demo" || d.startsWith("smoketest-")) fs.rmSync(path.join(uploads, d), { recursive: true, force: true });
  console.log("[seed] demo store data reset");
}

async function seed() {
  const db = getDb();
  const creds = [];
  const now = new Date();

  // packages
  for (const [i, p] of PACKAGES.entries()) {
    await db.collection("packages").updateOne({ key: p.key }, {
      $set: { ...p, flags: flagsForPlan(i), archived: false, updatedAt: now }, $setOnInsert: { createdAt: now },
    }, { upsert: true });
  }
  // feature definitions
  for (const f of FEATURES) {
    await db.collection("featureDefinitions").updateOne({ id: f.id }, {
      $set: { id: f.id, module: f.module, name: f.name, minPlan: f.minPlan, minPlanKey: PLAN_ORDER[f.minPlan] },
      $setOnInsert: { defaultState: false, killed: false },
    }, { upsert: true });
  }

  // super admin
  // On a real server set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (12+ characters) so you know the login.
  // Without them a random password is generated and written to backend/.seed-credentials.txt (development only).
  if (!(await db.collection("platformUsers").findOne({ role: "super_admin" }))) {
    const envPw = process.env.SEED_ADMIN_PASSWORD;
    if (envPw && envPw.length < 12) throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters.");
    if (process.env.NODE_ENV === "production" && !envPw) throw new Error("Set SEED_ADMIN_PASSWORD (and SEED_ADMIN_EMAIL) before the first start in production, otherwise nobody could sign in.");
    const email = (process.env.SEED_ADMIN_EMAIL || "admin@platform.local").trim().toLowerCase();
    const pw = envPw || rand();
    await db.collection("platformUsers").insertOne({ email, name: "Super Admin", role: "super_admin", status: "active", passwordHash: await hashPassword(pw), createdAt: now });
    if (!envPw) creds.push(["Super Admin panel", email, pw, "/login?scope=platform"]); // chosen passwords are never written anywhere
    else console.log(`[seed] Super Admin created: ${email}`);
  }

  // demo store and test accounts: development only (in production only when SEED_DEMO=1)
  const withDemo = process.env.NODE_ENV !== "production" || process.env.SEED_DEMO === "1";
  if (process.argv.includes("--reset-demo")) await resetDemo();
  if (withDemo && !(await db.collection("tenants").findOne({ slug: "demo" }))) {
    await db.collection("tenants").insertOne({
      slug: "demo", name: "Demo Store", status: "active", packageId: "premium", region: "default", createdAt: now,
      settings: { currency: "USD", tagline: "Everything you need, delivered.", theme: { primary: "#6b3410", accent: "#f08c00", font: "sans", style: "modern" }, taxRatePct: 0, shippingFlat: 500, freeShippingOver: 10000 },
    });
    for (const [title, category, price, emoji, variants] of DEMO_PRODUCTS) {
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      await db.collection("products").insertOne({
        tenantId: "demo", title, slug, description: `${title}: quality you can rely on. A sample product for the demo store.`,
        category, price, emoji, images: [], status: "active", tags: [category.toLowerCase()], createdAt: now,
        variants: variants.map(([vt, stock], i) => ({ id: `${slug}-${i + 1}`, sku: `${slug.slice(0, 6).toUpperCase()}-${i + 1}`, title: vt, price, stock })),
      });
    }
    await db.collection("discounts").insertOne({ tenantId: "demo", code: "WELCOME10", type: "percent", value: 10, minSubtotal: 0, active: true, used: 0, createdAt: now });
  }

  // demo accounts: created whenever missing (also after a password-pepper rotation)
  if (withDemo && await db.collection("tenants").findOne({ slug: "demo" })) {
    const users = [["owner", "owner@demo.local", "Demo Owner"], ["manager", "manager@demo.local", "Demo Manager"], ["cashier", "cashier@demo.local", "Demo Cashier"]];
    for (const [role, email, name] of users) {
      if (await db.collection("tenantUsers").findOne({ tenantId: "demo", email })) continue;
      const pw = rand();
      await db.collection("tenantUsers").insertOne({ tenantId: "demo", email, name, role, status: "active", passwordHash: await hashPassword(pw), createdAt: now });
      creds.push([`Demo tenant ${role}`, email, pw, "/login?scope=tenant&tenant=demo"]);
    }
    if (!(await db.collection("customers").findOne({ tenantId: "demo", email: "shopper@demo.local" }))) {
      const cpw = rand();
      await db.collection("customers").insertOne({ tenantId: "demo", email: "shopper@demo.local", name: "Demo Shopper", addresses: [], passwordHash: await hashPassword(cpw), createdAt: now });
      creds.push(["Demo shopper (customer)", "shopper@demo.local", cpw, "/s/demo/account"]);
    }
  }

  if (creds.length) {
    const file = path.join(__dirname, "..", ".seed-credentials.txt");
    const header = "TEST ACCOUNTS CREATED BY THE SEED SCRIPT (development only; change or delete these before going live)\n\n";
    const body = creds.map(([who, email, pw, where]) => `${who}\n  login: ${email}\n  password: ${pw}\n  page: ${where}\n`).join("\n");
    // append so that earlier accounts are never lost
    if (fs.existsSync(file)) fs.appendFileSync(file, "\n" + body); else fs.writeFileSync(file, header + body);
    console.log(`[seed] created ${creds.length} test accounts -> see backend/.seed-credentials.txt`);
  }
  return creds.length;
}

module.exports = { seed, resetDemo, PACKAGES };

if (require.main === module) {
  require("dotenv").config();
  const { connect, close } = require("./db");
  connect().then(seed).then(() => close()).catch((e) => { console.error(e); process.exit(1); });
}
