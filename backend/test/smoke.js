// End-to-end smoke test against a RUNNING backend (npm run dev --workspace backend).
// Usage: node test/smoke.js   (reads the seeded test accounts from backend/.seed-credentials.txt)
const fs = require("fs");
const path = require("path");
const BASE = process.env.API || "http://localhost:5000";

function creds() {
  const txt = fs.readFileSync(path.join(__dirname, "..", ".seed-credentials.txt"), "utf8");
  const out = {};
  for (const block of txt.split(/\n\n/)) {
    const who = block.split("\n")[0].trim();
    const email = (block.match(/login: (.+)/) || [])[1];
    const pw = (block.match(/password: (.+)/) || [])[1];
    if (email && pw) out[who] = { email: email.trim(), pw: pw.trim() };
  }
  return out;
}

class Client {
  constructor() { this.jar = {}; }
  async req(method, url, body) {
    const res = await fetch(BASE + url, { method, headers: { "content-type": "application/json", cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; "), ...(this.headers || {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) this.jar[k] = v; else delete this.jar[k]; }
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
  get(u) { return this.req("GET", u); } post(u, b) { return this.req("POST", u, b || {}); }
  put(u, b) { return this.req("PUT", u, b); } patch(u, b) { return this.req("PATCH", u, b); } del(u) { return this.req("DELETE", u); }
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS", name); } else { fail++; console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); }
}

(async () => {
  const C = creds();
  const sa = C["Super Admin panel"], owner = C["Demo tenant owner"], cashier = C["Demo tenant cashier"], shopper = C["Demo shopper (customer)"];
  const suffix = Math.random().toString(36).slice(2, 7);
  const strong = "Test-" + Math.random().toString(36).slice(2) + "Zz9!";

  console.log("\n[1] Health and auth");
  const anon = new Client();
  check("health ok", (await anon.get("/api/health")).data.database === "up");
  check("unauthenticated platform API is blocked", (await anon.get("/api/platform/tenants")).status === 401);
  check("wrong password rejected", (await new Client().post("/api/auth/login", { scope: "platform", email: sa.email, password: "wrong-password-123" })).status === 401);
  const P = new Client();
  check("super admin signs in", (await P.post("/api/auth/login", { scope: "platform", email: sa.email, password: sa.pw })).status === 200);
  const me = await P.get("/api/auth/me?scope=platform");
  check("me returns role without password data", me.data.user.role === "super_admin" && !JSON.stringify(me.data).includes("assword"));

  console.log("\n[2] Platform: overview, packages, flags");
  const ov = await P.get("/api/platform/overview");
  check("overview shows demo tenant", ov.status === 200 && ov.data.tenants >= 1);
  const pk = await P.get("/api/platform/packages");
  check("5 default packages", pk.data.packages.length >= 5);
  const feats = await P.get("/api/platform/features");
  check("103 features in catalog", feats.data.features.length === 103, feats.data.features.length);

  console.log("\n[3] Create tenant on FREE package, accept invite");
  const slug = "smoketest-" + suffix;
  const ct = await P.post("/api/platform/tenants", { name: "Test Shop " + suffix, slug, packageId: "free", ownerName: "Test Owner", ownerEmail: `owner-${suffix}@example.com` });
  check("tenant created with invite link", ct.status === 201 && ct.data.inviteUrl.includes("token="), ct.data);
  const token = new URL(ct.data.inviteUrl).searchParams.get("token");
  const O2 = new Client();
  check("weak password rejected on invite", (await O2.post("/api/auth/invite/accept", { token, password: "short" })).status === 400);
  check("invite accepted with strong password", (await O2.post("/api/auth/invite/accept", { token, password: strong })).status === 200);
  check("invite token is single use", (await new Client().post("/api/auth/invite/accept", { token, password: strong })).status === 400);
  check("new owner signs in", (await O2.post("/api/auth/login", { scope: "tenant", tenantSlug: slug, email: `owner-${suffix}@example.com`, password: strong })).status === 200);
  check("duplicate tenant id rejected", (await P.post("/api/platform/tenants", { name: "Dup", slug, packageId: "free", ownerName: "X Y", ownerEmail: "dup@example.com" })).status === 409);

  console.log("\n[4] Package limits and feature flags (Free package)");
  let created = 0, blocked = null;
  for (let i = 0; i < 9; i++) {
    const r = await O2.post("/api/admin/products", { title: "Item number " + i, price: 1000, stock: 5 });
    if (r.status === 201) created++; else { blocked = r; break; }
  }
  check("product limit of 7 enforced on the Free package", created === 7 && blocked && blocked.status === 402, { created, blocked: blocked && blocked.status });
  check("discounts blocked on Free (feature flag, server side)", (await O2.get("/api/admin/discounts")).status === 403);
  check("AI builder blocked on Free", (await O2.post("/api/admin/builder/jobs", { requirements: "I sell clothes online in Karachi" })).status === 403);
  check("staff limit of 1 enforced", (await O2.post("/api/admin/staff", { email: "s@example.com", name: "Staff One", role: "staff" })).status === 402);

  console.log("\n[5] Per-tenant override then upgrade");
  check("override CAT-02 + discounts on for this tenant", (await P.put(`/api/platform/tenants/${slug}/overrides`, { flags: { "MKT-02": true }, limits: { products: 30 }, reason: "smoke test" })).status === 200);
  check("override needs unknown-feature check", (await P.put(`/api/platform/tenants/${slug}/overrides`, { flags: { "NOPE-99": true } })).status === 400);
  // flag cache is invalidated in-process; allow immediate effect
  check("discounts now allowed", (await O2.get("/api/admin/discounts")).status === 200);
  check("variants still blocked on Free (CAT-02 not in package)", (await O2.post("/api/admin/products", { title: "Variant item", price: 1000, variants: [{ title: "S", price: 1000, stock: 1 }, { title: "M", price: 1000, stock: 1 }] })).status === 403);
  check("raised product limit lets one more through", (await O2.post("/api/admin/products", { title: "Extra item", price: 1000, stock: 5 })).status === 201);

  console.log("\n[6] Tenant isolation");
  const D = new Client();
  await D.post("/api/auth/login", { scope: "tenant", tenantSlug: "demo", email: owner.email, password: owner.pw });
  const demoProducts = (await D.get("/api/admin/products")).data.products;
  const myProducts = (await O2.get("/api/admin/products")).data.products;
  check("demo sees only its own products", demoProducts.length === 12 && demoProducts.every((p) => p.tenantId === "demo"), demoProducts.length);
  check("test tenant sees only its own products", myProducts.every((p) => p.tenantId === slug));
  const foreign = demoProducts[0]._id;
  check("cannot read another tenant's product by id", (await O2.put(`/api/admin/products/${foreign}`, { title: "Hacked title" })).status === 404);
  check("cannot delete another tenant's product", (await O2.del(`/api/admin/products/${foreign}`)).status === 404);
  check("demo product unchanged", (await D.get("/api/admin/products")).data.products.find((p) => p._id === foreign).title !== "Hacked title");
  check("tenant cookie cannot reach platform API", (await O2.get("/api/platform/tenants")).status === 401);
  const tamper = await O2.post("/api/admin/products", { title: "Tamper try", price: 100, stock: 1, tenantId: "demo" });
  const tampered = (await D.get("/api/admin/products")).data.products.find((p) => p.title === "Tamper try");
  check("tenantId in request body is ignored", !tampered);

  console.log("\n[7] RBAC");
  const K = new Client();
  await K.post("/api/auth/login", { scope: "tenant", tenantSlug: "demo", email: cashier.email, password: cashier.pw });
  check("cashier can list orders", (await K.get("/api/admin/orders")).status === 200);
  check("cashier cannot create products", (await K.post("/api/admin/products", { title: "Nope item", price: 100 })).status === 403);
  check("cashier cannot see staff", (await K.get("/api/admin/staff")).status === 403);
  check("cashier cannot view reports", (await K.get("/api/admin/reports/sales")).status === 403);
  const posProduct = demoProducts.find((p) => p.title === "Ceramic Mug");
  const posSale = await K.post("/api/admin/pos/orders", { items: [{ productId: posProduct._id, variantId: posProduct.variants[0].id, qty: 1 }], paymentMethod: "cash" });
  check("cashier can ring up a POS sale", posSale.status === 201 && posSale.data.order.channel === "pos", posSale.data);

  console.log("\n[8] Storefront checkout, discounts, overselling");
  const S = new Client();
  const info = await S.get("/api/store/demo/info");
  check("storefront info public", info.status === 200 && info.data.name === "Demo Store");
  const sp = (await S.get("/api/store/demo/products")).data.products;
  const mug = sp.find((p) => p.title === "Scented Candle");
  const quote = await S.post("/api/store/demo/cart/quote", { items: [{ productId: mug.id, variantId: mug.variants[0].id, qty: 2 }], code: "WELCOME10" });
  check("quote applies 10% discount server side", quote.status === 200 && quote.data.discount === Math.round(quote.data.subtotal * 0.1), quote.data);
  check("client cannot choose price (priced from DB)", quote.data.lines[0].unitPrice === 1599);
  check("bad code rejected", (await S.post("/api/store/demo/cart/quote", { items: [{ productId: mug.id, variantId: mug.variants[0].id, qty: 1 }], code: "FAKE" })).status === 400);
  const order = await S.post("/api/store/demo/checkout", { items: [{ productId: mug.id, variantId: mug.variants[0].id, qty: 1 }], customer: { name: "Guest Buyer", email: "guest@example.com" }, address: { line1: "12 Main Street", city: "Karachi", country: "PK" }, paymentMethod: "cod" });
  check("guest COD checkout creates pending order", order.status === 201 && order.data.order.status === "pending", order.data);
  const track = await S.get(`/api/store/demo/orders/track?number=${order.data.order.number}&email=guest@example.com`);
  check("order tracking works with number+email", track.status === 200);
  check("tracking refuses wrong email", (await S.get(`/api/store/demo/orders/track?number=${order.data.order.number}&email=x@example.com`)).status === 404);

  // oversell test: Desk Lamp has 18; make a product with 10 and race 15 buyers
  const mk = await D.post("/api/admin/products", { title: "Race Item " + suffix, price: 1000, stock: 10 });
  const raceP = (await S.get("/api/store/demo/products")).data.products.find((p) => p.title === "Race Item " + suffix);
  const results = await Promise.all(Array.from({ length: 15 }, (_, i) => new Client().post("/api/store/demo/checkout", { items: [{ productId: raceP.id, variantId: raceP.variants[0].id, qty: 1 }], customer: { name: "Racer " + i, email: `racer${i}@example.com` }, address: { line1: "1 Race Road", city: "Lahore", country: "PK" }, paymentMethod: "card" })));
  const ok = results.filter((r) => r.status === 201).length;
  const after = (await D.get("/api/admin/products")).data.products.find((p) => p.title === "Race Item " + suffix);
  check("15 buyers for 10 units sell exactly 10", ok === 10 && after.variants[0].stock === 0, { ok, stock: after.variants[0].stock, statuses: results.map((r) => r.status).join(",") });

  console.log("\n[9] Order lifecycle");
  const oid = (await D.get("/api/admin/orders")).data.orders.find((o) => o.number === order.data.order.number)._id;
  check("illegal transition rejected (pending -> refunded)", (await D.post(`/api/admin/orders/${oid}/status`, { status: "refunded" })).status === 409);
  check("pending -> paid", (await D.post(`/api/admin/orders/${oid}/status`, { status: "paid" })).status === 200);
  check("paid -> fulfilled", (await D.post(`/api/admin/orders/${oid}/status`, { status: "fulfilled" })).status === 200);
  check("fulfilled -> refunded with restock", (await D.post(`/api/admin/orders/${oid}/status`, { status: "refunded", restock: true })).status === 200);

  console.log("\n[10] Customer account");
  const U = new Client();
  check("customer signs in", (await U.post("/api/store/demo/auth/login", shopper)).status === 200 || (await U.post("/api/store/demo/auth/login", { email: shopper.email, password: shopper.pw })).status === 200);
  check("customer sees own orders only", (await U.get("/api/store/demo/account/orders")).status === 200);
  check("customer cookie cannot reach admin API", (await U.get("/api/admin/orders")).status === 401);

  console.log("\n[11] Impersonation and audit");
  check("impersonation requires a reason", (await P.post(`/api/platform/tenants/demo/impersonate`, { reason: "x" })).status === 400);
  const IMP = new Client(); IMP.jar = {};
  const imp = await P.post(`/api/platform/tenants/demo/impersonate`, { reason: "Smoke test support check" });
  check("impersonation starts", imp.status === 200);
  IMP.jar.ts = P.jar.ts;
  const impMe = await IMP.get("/api/auth/me?scope=tenant");
  check("session is tagged as impersonated with reason", impMe.data.user.impersonatedBy && impMe.data.user.impersonationReason === "Smoke test support check", impMe.data);
  const audit = await P.get("/api/platform/audit?action=tenant.impersonate");
  check("impersonation is in the audit log", audit.data.logs.length >= 1);
  const tAudit = await D.get("/api/admin/audit");
  check("tenant can see its own audit log", tAudit.status === 200);

  console.log("\n[12] Suspend + kill switch");
  check("suspend test tenant", (await P.patch(`/api/platform/tenants/${slug}`, { status: "suspended" })).status === 200);
  check("suspended storefront returns 503", (await anon.get(`/api/store/${slug}/info`)).status === 503);
  check("suspended admin is read-only", (await O2.post("/api/admin/products", { title: "After suspend", price: 100 })).status === 403);
  check("restore", (await P.patch(`/api/platform/tenants/${slug}`, { status: "active" })).status === 200);
  check("kill switch PAY-03 (COD)", (await P.patch("/api/platform/features/PAY-03", { killed: true })).status === 200);
  const cod = await S.post("/api/store/demo/checkout", { items: [{ productId: mug.id, variantId: mug.variants[0].id, qty: 1 }], customer: { name: "Guest Buyer", email: "guest@example.com" }, address: { line1: "12 Main Street", city: "Karachi", country: "PK" }, paymentMethod: "cod" });
  check("COD refused after kill switch", cod.status === 403, cod.data);
  await P.patch("/api/platform/features/PAY-03", { killed: false });

  console.log("\n[13] AI Store Builder");
  const job = await D.post("/api/admin/builder/jobs", { requirements: "I want an online shop called Sunrise Bakery that sells fresh cakes and coffee in Lahore, prices in PKR, with discounts and a blog." });
  check("job accepted (async)", job.status === 202, job.data);
  let j; for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); j = (await D.get(`/api/admin/builder/jobs/${job.data.jobId}`)).data.job; if (["done", "failed"].includes(j.state)) break; }
  check("job finishes", j.state === "done", j);
  const spec = (await D.get(`/api/admin/builder/specs/${j.version}`)).data.spec.spec;
  check("spec valid: name, currency, categories", spec.storeName === "Sunrise Bakery" && spec.currency === "PKR" && spec.categories.length >= 3, spec.storeName + spec.currency);
  const rev = await D.post("/api/admin/builder/revise", { message: "Make it dark and use a purple colour" });
  let j2; for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); j2 = (await D.get(`/api/admin/builder/jobs/${rev.data.jobId}`)).data.job; if (["done", "failed"].includes(j2.state)) break; }
  const spec2 = (await D.get(`/api/admin/builder/specs/${j2.version}`)).data.spec.spec;
  check("revision creates version 2 with dark purple theme", j2.version === j.version + 1 && spec2.theme.mode === "dark" && spec2.theme.primary === "#7c3aed", spec2.theme);
  check("short requirements rejected", (await D.post("/api/admin/builder/jobs", { requirements: "shop" })).status === 400);
  check("publish applies spec to store", (await D.post(`/api/admin/builder/specs/${j2.version}/publish`)).status === 200);
  const pub = (await S.get("/api/store/demo/info")).data;
  check("storefront now uses published name and theme", pub.name === "Sunrise Bakery" && pub.theme.mode === "dark", pub.name);
  const rb = await D.post(`/api/admin/builder/specs/${j.version}/publish`);
  check("rollback to version 1", rb.status === 200 && (await S.get("/api/store/demo/info")).data.theme.mode === "light");

  console.log("\n[14] Public sign-up, email verification, builder auto-start");
  const pubList = await new Client().get("/api/public/packages");
  check("public price list without sign-in", pubList.status === 200 && pubList.data.packages.length >= 5 && !JSON.stringify(pubList.data).includes("flags"), pubList.status);
  const NEW = new Client();
  const sEmail = `signup-${suffix}@example.com`, sPass = "Signup-" + Math.random().toString(36).slice(2) + "Qq1!";
  check("weak password refused at sign-up", (await NEW.post("/api/public/signup", { storeName: "smoketest " + suffix, ownerName: "New Owner", email: sEmail, password: "short" })).status === 400);
  const su = await NEW.post("/api/public/signup", { storeName: "smoketest " + suffix, ownerName: "New Owner", email: sEmail, password: sPass, requirements: "I want an online shop called Blue Door Books that sells novels and notebooks in Karachi. Prices in PKR with reviews and discounts." });
  check("sign-up creates a pending store", su.status === 201 && su.data.slug.startsWith("smoketest-"), su.data);
  const newSlug = su.data.slug;
  check("cannot sign in before confirming email", (await NEW.post("/api/auth/login", { scope: "tenant", tenantSlug: newSlug, email: sEmail, password: sPass })).status === 403);
  check("storefront is closed until confirmed", (await anon.get(`/api/store/${newSlug}/info`)).status === 503);
  const vtoken = su.data.devVerifyUrl && new URL(su.data.devVerifyUrl).searchParams.get("token");
  check("verification link provided (dev, no SMTP)", !!vtoken);
  check("bad verification token refused", (await new Client().post("/api/public/verify", { token: "x".repeat(30) })).status === 400);
  const ver = await NEW.post("/api/public/verify", { token: vtoken });
  check("email confirmation signs the owner in", ver.status === 200 && (await NEW.get("/api/auth/me?scope=tenant")).status === 200);
  check("verification link works only once", (await new Client().post("/api/public/verify", { token: vtoken })).status === 400);
  check("store is open and on a 14-day trial", (await anon.get(`/api/store/${newSlug}/info`)).status === 200 && (await NEW.get("/api/admin/overview")).data.tenant.status === "trial");
  check("trial includes the AI builder", (await NEW.get("/api/admin/features")).data.flags["AI-01"] === true);
  const auto = await NEW.post("/api/admin/builder/auto-start");
  check("builder starts by itself from sign-up text", auto.status === 202, auto.data);
  let aj; for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); aj = (await NEW.get(`/api/admin/builder/jobs/${auto.data.jobId}`)).data.job; if (["done", "failed"].includes(aj.state)) break; }
  const aspec = aj.state === "done" ? (await NEW.get(`/api/admin/builder/specs/${aj.version}`)).data.spec.spec : {};
  check("auto-built store matches the typed requirements", aspec.storeName === "Blue Door Books" && aspec.currency === "PKR", aspec.storeName);
  check("auto-start runs only once", (await NEW.post("/api/admin/builder/auto-start")).data.none === true);
  // trial expiry drops the store to the Free package
  const { MongoClient } = require("mongodb"); require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
  const mc = new MongoClient(process.env.MONGODB_URI || ""); try { await mc.connect(); await mc.db(process.env.DB_NAME || "ecommerce_platform").collection("tenants").updateOne({ slug: newSlug }, { $set: { trialEndsAt: new Date(Date.now() - 1000) } }); await mc.close(); } catch { /* local test db: skip */ }
  const trialEnd = (await NEW.get("/api/admin/features")).data;
  check("expired trial falls back to the Free package", trialEnd.package === "free" && trialEnd.flags["AI-01"] === false, trialEnd.package);

  console.log("\n[15] Image uploads and custom domains");
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const up = await D.post("/api/admin/uploads", { data: PNG });
  check("owner uploads a real PNG", up.status === 201 && /^\/uploads\/demo\/[a-f0-9]+\.png$/.test(up.data.url), up.data);
  const served = await fetch(BASE + up.data.url);
  check("uploaded image is served as an image, never executable", served.status === 200 && served.headers.get("content-type") === "image/png" && served.headers.get("x-content-type-options") === "nosniff");
  check("text pretending to be an image is refused", (await D.post("/api/admin/uploads", { data: "data:image/png;base64," + Buffer.from("<script>alert(1)</script>").toString("base64") })).status === 400);
  check("SVG (script risk) is refused", (await D.post("/api/admin/uploads", { data: "data:image/svg+xml;base64," + Buffer.from("<svg onload=alert(1)/>").toString("base64") })).status === 400);
  check("cashier cannot upload", (await K.post("/api/admin/uploads", { data: PNG })).status === 403);
  check("anonymous cannot upload", (await anon.post("/api/admin/uploads", { data: PNG })).status === 401);
  check("another tenant's files are not writable by path tricks", (await fetch(BASE + "/uploads/..%2F..%2F.env")).status !== 200);
  check("product accepts an uploaded photo", (await D.post("/api/admin/products", { title: "Photo item " + suffix, price: 1000, stock: 1, images: [up.data.url] })).status === 201);
  check("product refuses javascript: image links", (await D.post("/api/admin/products", { title: "Bad image " + suffix, price: 1000, images: ["javascript:alert(1)"] })).status === 400);

  const dom = await D.post("/api/admin/domains", { domain: "shop.example-test.com" });
  check("owner adds a custom domain with DNS instructions", dom.status === 201 && dom.data.instructions.txtHost === "_commerce-verify.shop.example-test.com" && dom.data.instructions.txtValue.startsWith("commerce-verify="), dom.data);
  check("domain cannot be verified without the DNS record", (await D.post("/api/admin/domains/shop.example-test.com/verify")).status === 409);
  check("unverified domain does not serve the store", (await anon.get("/api/public/resolve-host?host=shop.example-test.com")).data.slug === null);
  check("platform's own domain cannot be claimed", (await D.post("/api/admin/domains", { domain: "evil.localhost" })).status === 400);
  const mc2 = new MongoClient(process.env.MONGODB_URI || ""); try { await mc2.connect(); await mc2.db(process.env.DB_NAME || "ecommerce_platform").collection("tenants").updateOne({ slug: "demo", "domains.name": "shop.example-test.com" }, { $set: { "domains.$.verified": true } }); await mc2.close(); } catch { /* local test db: skip */ }
  check("verified domain resolves to the store", (await anon.get("/api/public/resolve-host?host=shop.example-test.com")).data.slug === "demo");
  check("store subdomain resolves to the store", (await anon.get("/api/public/resolve-host?host=demo.localhost")).data.slug === "demo");
  check("unknown host resolves to nothing", (await anon.get("/api/public/resolve-host?host=nope.example.org")).data.slug === null);
  check("Free package cannot add domains", (await O2.post("/api/admin/domains", { domain: "free.example-test.com" })).status === 403);
  check("domain can be removed", (await D.del("/api/admin/domains/shop.example-test.com")).status === 200);

  console.log("\n[16] Two-factor login (authenticator app)");
  const TOTP = require("../src/lib/totp");
  const tcode = (secret, delta = 0) => TOTP.hotp(TOTP.base32Decode(secret), TOTP.currentStep() + delta);
  const TF = new Client();
  const tfEmail = `owner-${suffix}@example.com`; // the Free test store owner created in section 3
  await TF.post("/api/auth/login", { scope: "tenant", tenantSlug: slug, email: tfEmail, password: strong });
  check("2FA is off by default", (await TF.get("/api/auth/2fa/status?scope=tenant")).data.enabled === false);
  const setup = await TF.post("/api/auth/2fa/setup?scope=tenant");
  check("setup returns a secret and a QR code", setup.status === 200 && /^[A-Z2-7]{32}$/.test(setup.data.secret) && setup.data.qr.startsWith("data:image/png"), setup.status);
  check("enabling with a wrong code fails", (await TF.post("/api/auth/2fa/enable?scope=tenant", { code: "000000" })).status === 400 || tcode(setup.data.secret) === "000000");
  const s0 = TOTP.currentStep();
  const en = await TF.post("/api/auth/2fa/enable?scope=tenant", { code: TOTP.hotp(TOTP.base32Decode(setup.data.secret), s0) });
  check("enabling with the right code returns 10 recovery codes", en.status === 200 && en.data.recoveryCodes.length === 10, en.data);
  const L = new Client();
  const l1 = await L.post("/api/auth/login", { scope: "tenant", tenantSlug: slug, email: tfEmail, password: strong });
  check("password alone no longer signs in", l1.data.twoFactorRequired === true && !L.jar.ts && !!l1.data.challenge, l1.data);
  const HACK = new Client(); HACK.jar = { ts: l1.data.challenge };
  check("half-finished login token is useless as a session cookie", (await HACK.get("/api/admin/overview")).status === 401);
  check("wrong code is refused", (await L.post("/api/auth/login/2fa", { challenge: l1.data.challenge, code: "123456" })).status === 401 || tcode(setup.data.secret) === "123456");
  check("code that was already used (replay) is refused", (await L.post("/api/auth/login/2fa", { challenge: l1.data.challenge, code: TOTP.hotp(TOTP.base32Decode(setup.data.secret), s0) })).status === 401);
  const ok2 = await L.post("/api/auth/login/2fa", { challenge: l1.data.challenge, code: TOTP.hotp(TOTP.base32Decode(setup.data.secret), s0 + 1) });
  check("fresh code signs in", ok2.status === 200 && (await L.get("/api/admin/overview")).status === 200, ok2.data);
  check("garbage challenge is refused", (await anon.post("/api/auth/login/2fa", { challenge: "x".repeat(40), code: "123456" })).status === 401);
  const rc = en.data.recoveryCodes[0];
  const R1 = new Client(); const l2 = await R1.post("/api/auth/login", { scope: "tenant", tenantSlug: slug, email: tfEmail, password: strong });
  check("recovery code signs in", (await R1.post("/api/auth/login/2fa", { challenge: l2.data.challenge, code: rc })).status === 200);
  const R2 = new Client(); const l3 = await R2.post("/api/auth/login", { scope: "tenant", tenantSlug: slug, email: tfEmail, password: strong });
  check("recovery code works only once", (await R2.post("/api/auth/login/2fa", { challenge: l3.data.challenge, code: rc })).status === 401);
  check("turning 2FA off needs the password", (await L.post("/api/auth/2fa/disable?scope=tenant", { password: "wrong-password-123", code: TOTP.hotp(TOTP.base32Decode(setup.data.secret), s0 + 1) })).status === 401);
  check("turning 2FA off with password and code works", (await L.post("/api/auth/2fa/disable?scope=tenant", { password: strong, code: TOTP.hotp(TOTP.base32Decode(setup.data.secret), s0 + 1) })).status === 200);
  const l4 = await new Client().post("/api/auth/login", { scope: "tenant", tenantSlug: slug, email: tfEmail, password: strong });
  check("after disabling, password login works again", l4.status === 200 && !l4.data.twoFactorRequired);

  console.log("\n[17] Custom CSS, automatic discounts, IP allow-list, GDPR, webhooks");
  // -- custom CSS
  const hostile = "@import url(http://evil.test/x.css); .a{color:red} .b{background:url(javascript:alert(1))} </style><script>alert(1)</script>";
  check("owner saves custom CSS", (await D.patch("/api/admin/settings", { customCss: hostile })).status === 200);
  const css = (await anon.get("/api/store/demo/info")).data.customCss;
  check("hostile CSS is cleaned, safe CSS is kept", css.includes("color:red") && !css.includes("<") && !css.includes("@import") && !/javascript/i.test(css), css);
  check("Free package cannot use custom CSS", (await O2.patch("/api/admin/settings", { customCss: "a{color:red}" })).status === 403);
  // -- automatic discount
  const q0 = { items: [{ productId: mug.id, variantId: mug.variants[0].id, qty: 1 }] };
  check("no automatic discount before one exists", (await S.post("/api/store/demo/cart/quote", q0)).data.discount === 0);
  const ad = await D.post("/api/admin/discounts", { code: "AUTO5", type: "percent", value: 5, minSubtotal: 0, auto: true });
  check("owner creates an automatic discount", ad.status === 201, ad.data);
  const q1 = await S.post("/api/store/demo/cart/quote", q0);
  check("automatic discount applies without a code", q1.data.discount === Math.round(q1.data.subtotal * 0.05) && q1.data.discountCode === "AUTO5", q1.data);
  const adId = (await D.get("/api/admin/discounts")).data.discounts.find((d) => d.code === "AUTO5")._id;
  await D.patch(`/api/admin/discounts/${adId}`, { active: false });
  check("paused automatic discount stops applying", (await S.post("/api/store/demo/cart/quote", q0)).data.discount === 0);
  // -- IP allow-list (a proxy header lets the test pretend to be another address)
  const ipInfo = (await D.get("/api/admin/security/ip-allowlist")).data;
  check("allow-list reports the caller's own address", typeof ipInfo.yourIp === "string" && ipInfo.yourIp.length > 2, ipInfo);
  check("cannot save a list that excludes yourself", (await D.put("/api/admin/security/ip-allowlist", { ips: ["10.9.9.9"] })).status === 400);
  check("invalid IP is refused", (await D.put("/api/admin/security/ip-allowlist", { ips: ["not-an-ip"] })).status === 400);
  check("owner saves a list containing their address", (await D.put("/api/admin/security/ip-allowlist", { ips: [ipInfo.yourIp, "203.0.113.9"] })).status === 200);
  const ALT = new Client(); ALT.jar = { ...D.jar }; ALT.headers = { "x-forwarded-for": "203.0.113.50" };
  const ipBlockedRes = await ALT.get("/api/admin/overview");
  check("a signed-in session from an unlisted address is blocked", ipBlockedRes.status === 403 && ipBlockedRes.data.ipBlocked === true, ipBlockedRes);
  ALT.headers = { "x-forwarded-for": "203.0.113.9" };
  check("the same session from a listed address works", (await ALT.get("/api/admin/overview")).status === 200);
  check("owner clears the list", (await D.put("/api/admin/security/ip-allowlist", { ips: [] })).status === 200);
  check("Free package has no IP allow-list", (await O2.get("/api/admin/security/ip-allowlist")).status === 403);
  // -- GDPR
  const gEmail = `gdpr-${suffix}@example.com`, gPass = "Gdpr-" + Math.random().toString(36).slice(2) + "Zz9!";
  const G = new Client();
  check("shopper registers", (await G.post("/api/store/demo/auth/register", { name: "Gina Data", email: gEmail, password: gPass })).status === 201);
  const exp = await G.get("/api/store/demo/account/export");
  check("shopper downloads all their data", exp.status === 200 && exp.data.profile.email === gEmail && !JSON.stringify(exp.data).includes("passwordHash"), exp.status);
  check("anonymous cannot export", (await anon.get("/api/store/demo/account/export")).status === 401);
  check("shopper erases their account", (await G.del("/api/store/demo/account")).status === 200);
  check("erased account can no longer sign in", (await new Client().post("/api/store/demo/auth/login", { email: gEmail, password: gPass })).status === 401);
  const custList = (await D.get("/api/admin/customers")).data.customers;
  check("erased customer is anonymised, not left in the store's list", !custList.some((c) => c.email === gEmail) && custList.some((c) => c.name === "Deleted customer"));
  const guest = custList.find((c) => c.email === "guest@example.com");
  check("owner can erase a guest customer", guest && (await D.del(`/api/admin/customers/${guest._id}`)).status === 200);
  check("guest orders keep totals but lose personal details", (await D.get("/api/admin/orders")).data.orders.filter((o) => o.customer?.name === "Deleted customer").every((o) => o.customer.email.endsWith("@anonymized.invalid") && o.shippingAddress === null));
  check("cashier cannot erase customers", (await K.del(`/api/admin/customers/${custList[0]._id}`)).status === 403);
  // -- webhooks
  const http = require("http"), crypto = require("crypto");
  const received = [];
  const srv = http.createServer((rq, rs) => { let b = ""; rq.on("data", (c) => (b += c)); rq.on("end", () => { received.push({ headers: rq.headers, body: b }); rs.writeHead(200); rs.end("ok"); }); });
  await new Promise((r) => srv.listen(0, r));
  const hookUrl = `http://localhost:${srv.address().port}/hook`;
  check("webhook with a private-network address is refused", (await D.post("/api/admin/webhooks", { url: "https://10.0.0.5/x", events: ["order.created"] })).status === 400);
  check("plain http to a public address is refused", (await D.post("/api/admin/webhooks", { url: "http://example.com/x", events: ["order.created"] })).status === 400);
  check("URL with embedded password is refused", (await D.post("/api/admin/webhooks", { url: "https://user:pw@example.com/x", events: ["order.created"] })).status === 400);
  check("Free package has no webhooks", (await O2.get("/api/admin/webhooks")).status === 403);
  const wh = await D.post("/api/admin/webhooks", { url: hookUrl, events: ["order.created", "ping"] });
  check("owner registers a webhook and gets a signing secret once", wh.status === 201 && wh.data.secret.startsWith("whsec_"), wh.data);
  check("secret is never listed again", !JSON.stringify((await D.get("/api/admin/webhooks")).data).includes("whsec_"));
  const pingRes = await D.post(`/api/admin/webhooks/${wh.data.id}/test`);
  check("test event is delivered", pingRes.data.ok === true && received.length === 1, pingRes.data);
  const sale = await K.post("/api/admin/pos/orders", { items: [{ productId: posProduct._id, variantId: posProduct.variants[0].id, qty: 1 }], paymentMethod: "cash" });
  for (let i = 0; i < 20 && received.length < 2; i++) await new Promise((r) => setTimeout(r, 250));
  const got = received.find((r) => r.headers["x-webhook-event"] === "order.created");
  check("order.created is delivered after a sale", sale.status === 201 && !!got, received.length);
  const expectSig = got && "sha256=" + crypto.createHmac("sha256", wh.data.secret).update(got.body).digest("hex");
  check("delivery carries a valid HMAC signature", got && got.headers["x-webhook-signature"] === expectSig);
  check("payload has the order number", got && JSON.parse(got.body).data.number === sale.data.order.number);
  check("webhook can be deleted", (await D.del(`/api/admin/webhooks/${wh.data.id}`)).status === 200);
  srv.close();

  console.log("\n[18] Online payments confirmed by an admin: transfers and gateway links (store level)");
  const mcP = new MongoClient(process.env.MONGODB_URI || ""); await mcP.connect(); const dbP = mcP.db(process.env.DB_NAME || "ecommerce_platform");
  const BUY = () => { const c = new Client(); c.headers = { "x-forwarded-for": "198.51.100." + (10 + Math.floor(Math.random() * 200)) }; return c; };
  const cust = { name: "Pay Tester", email: "paytest@example.com" }, addr = { line1: "1 Test Road", city: "Lahore", country: "PK" };
  const buyItem = [{ productId: mug.id, variantId: mug.variants[0].id, qty: 1 }];
  check("config starts empty", (await D.get("/api/admin/payments/config")).data.config.manual.enabled === false);
  check("turning transfers on needs an account", (await D.put("/api/admin/payments/config", { manual: { enabled: true, methods: [], instructions: "" }, gateway: { enabled: false, label: "Pay online", url: "", instructions: "" } })).status === 400);
  check("gateway link must be https", (await D.put("/api/admin/payments/config", { manual: { enabled: false, methods: [], instructions: "" }, gateway: { enabled: true, label: "Pay online", url: "http://pay.example.com/x", instructions: "" } })).status === 400);
  const cfg = { manual: { enabled: true, instructions: "Send the exact amount.", methods: [{ type: "jazzcash", label: "JazzCash", accountName: "Demo Store", accountNumber: "0300-1234567", details: "" }, { type: "bank", label: "Bank Alfalah", accountName: "Demo Store", accountNumber: "PK00ALFH0000000000000000", details: "Main branch" }] },
    gateway: { enabled: true, label: "Pay with card or wallet", url: "https://pay.example.com/checkout?order={order}&amount={amount}&cur={currency}", instructions: "You will return here after paying." } };
  check("owner saves transfer accounts and a gateway link", (await D.put("/api/admin/payments/config", cfg)).status === 200);
  check("Free package cannot add a gateway link", (await O2.put("/api/admin/payments/config", { manual: { enabled: false, methods: [], instructions: "" }, gateway: { enabled: true, label: "x", url: "https://pay.example.com/x", instructions: "" } })).status === 403);
  check("cashier cannot change payment settings", (await K.put("/api/admin/payments/config", cfg)).status === 403);
  const pinfo = (await anon.get("/api/store/demo/info")).data;
  check("storefront offers transfer and gateway, hides account numbers, drops the fake test card", pinfo.features.manual.methods.length === 2 && !JSON.stringify(pinfo).includes("0300-1234567") && pinfo.features.gateway.label === "Pay with card or wallet" && pinfo.features.card === false, pinfo.features);

  const m1 = await BUY().post("/api/store/demo/checkout", { items: buyItem, customer: cust, address: addr, paymentMethod: "manual" });
  check("manual order is created waiting for payment, stock reserved", m1.status === 201 && m1.data.order.status === "pending" && m1.data.payments === undefined && !!m1.data.payToken && m1.data.order.payments[0].status === "awaiting", m1.data);
  const tok = m1.data.payToken, num = m1.data.order.number;
  const payPage = await anon.get(`/api/store/demo/orders/pay?number=${num}&t=${tok}`);
  check("order page shows the account details to the buyer", payPage.status === 200 && payPage.data.instructions.methods.some((m) => m.accountNumber === "0300-1234567"), payPage.data);
  check("wrong token cannot read payment details", (await anon.get(`/api/store/demo/orders/pay?number=${num}&t=${"0".repeat(32)}`)).status === 404);
  check("proof needs a reference or screenshot", (await anon.post("/api/store/demo/orders/proof", { number: num, token: tok })).status === 400);
  check("proof with the wrong token is refused", (await anon.post("/api/store/demo/orders/proof", { number: num, token: "f".repeat(32), reference: "TX1" })).status === 404);
  check("fake screenshot (not an image) is refused", (await anon.post("/api/store/demo/orders/proof", { number: num, token: tok, image: "data:image/png;base64," + Buffer.from("not an image at all").toString("base64") })).status === 400);
  const sent = await anon.post("/api/store/demo/orders/proof", { number: num, token: tok, reference: "JC-889900", methodId: pinfo.features.manual.methods[0].id, image: PNG });
  check("buyer sends reference and screenshot", sent.status === 200, sent.data);
  const q = (await D.get("/api/admin/payments/queue?filter=submitted")).data;
  const qo = q.orders.find((o) => o.number === num);
  check("admin queue shows the order with the proof", !!qo && qo.payment.proof.reference === "JC-889900" && !!qo.payment.proof.imageUrl && q.counts.submitted >= 1, qo);
  const pf = await fetch(BASE + qo.payment.proof.imageUrl, { headers: { cookie: Object.entries(D.jar).map(([k, v]) => `${k}=${v}`).join("; ") } });
  check("staff can open the screenshot", pf.status === 200 && pf.headers.get("content-type") === "image/png" && pf.headers.get("x-content-type-options") === "nosniff");
  check("anonymous cannot open the screenshot", (await fetch(BASE + qo.payment.proof.imageUrl)).status === 401);
  check("cashier cannot open the screenshot", (await fetch(BASE + qo.payment.proof.imageUrl, { headers: { cookie: Object.entries(K.jar).map(([k, v]) => `${k}=${v}`).join("; ") } })).status === 403);
  check("the screenshot is not publicly served", (await fetch(BASE + "/uploads/" + qo.payment.proof.imageUrl.split("/proof/")[1])).status === 404);
  check("cashier cannot approve payments", (await K.post(`/api/admin/payments/${qo._id}/approve`, {})).status === 403);
  check("another store cannot see this queue or approve", (await O2.post(`/api/admin/payments/${qo._id}/approve`, {})).status === 404 || (await O2.post(`/api/admin/payments/${qo._id}/approve`, {})).status === 403);
  check("reject needs a reason", (await D.post(`/api/admin/payments/${qo._id}/reject`, {})).status === 400);
  check("admin rejects the payment with a reason", (await D.post(`/api/admin/payments/${qo._id}/reject`, { reason: "Amount does not match" })).status === 200);
  const afterRej = await anon.get(`/api/store/demo/orders/pay?number=${num}&t=${tok}`);
  check("buyer sees why it was rejected and can try again", afterRej.data.payment.status === "rejected" && afterRej.data.payment.rejectReason === "Amount does not match");
  check("buyer resubmits proof", (await anon.post("/api/store/demo/orders/proof", { number: num, token: tok, reference: "JC-889911" })).status === 200);
  check("admin approves the payment", (await D.post(`/api/admin/payments/${qo._id}/approve`, { note: "Seen in my wallet" })).status === 200);
  const paidOrder = (await D.get(`/api/admin/orders/${qo._id}`)).data.order;
  check("order is now paid and the timeline explains why", paidOrder.status === "paid" && paidOrder.payments[0].status === "paid" && paidOrder.timeline.some((t) => /wallet/i.test(t.note || "")), paidOrder.status);
  check("a settled order cannot be approved twice", (await D.post(`/api/admin/payments/${qo._id}/approve`, {})).status === 404);
  check("buyer cannot send proof for a paid order", (await anon.post("/api/store/demo/orders/proof", { number: num, token: tok, reference: "late" })).status === 404);

  const g1 = await BUY().post("/api/store/demo/checkout", { items: buyItem, customer: cust, address: addr, paymentMethod: "gateway" });
  const gp = await anon.get(`/api/store/demo/orders/pay?number=${g1.data.order.number}&t=${g1.data.payToken}`);
  check("gateway order gets a pay link with order number, amount and currency filled in", g1.status === 201 && gp.data.instructions.payUrl === `https://pay.example.com/checkout?order=${g1.data.order.number}&amount=${(g1.data.order.total / 100).toFixed(2)}&cur=${g1.data.order.currency}`, gp.data.instructions);
  check("manual payment refused when the store has not turned it off... then off", (await D.put("/api/admin/payments/config", { ...cfg, manual: { ...cfg.manual, enabled: false } })).status === 200);
  check("turned-off method cannot be used", (await BUY().post("/api/store/demo/checkout", { items: buyItem, customer: cust, address: addr, paymentMethod: "manual" })).status === 403);
  await D.put("/api/admin/payments/config", cfg);
  // unpaid orders expire after 48 hours and release the stock
  const stale = await BUY().post("/api/store/demo/checkout", { items: buyItem, customer: cust, address: addr, paymentMethod: "manual" });
  const stockBefore = (await D.get("/api/admin/products")).data.products.find((p) => p.title === "Scented Candle").variants[0].stock;
  await dbP.collection("orders").updateOne({ tenantId: "demo", number: stale.data.order.number }, { $set: { createdAt: new Date(Date.now() - 49 * 3600 * 1000) } });
  await BUY().post("/api/store/demo/checkout", { items: buyItem, customer: cust, address: addr, paymentMethod: "gateway" }); // any checkout triggers the cleanup
  const staleNow = (await D.get("/api/admin/orders")).data.orders.find((o) => o.number === stale.data.order.number);
  const stockAfter = (await D.get("/api/admin/products")).data.products.find((p) => p.title === "Scented Candle").variants[0].stock;
  check("order unpaid after 48 hours is cancelled and stock released", staleNow.status === "cancelled" && stockAfter === stockBefore, { s: staleNow.status, stockBefore, stockAfter });

  console.log("\n[19] Package payments to the platform (Super Admin portal)");
  const oldSettings = (await P.get("/api/platform/payment-settings")).data;
  const ps = { methods: [{ type: "bank", label: "Platform Bank", accountName: "Platform Ltd", accountNumber: "PK11PLAT0000000000000001", details: "" }, { type: "easypaisa", label: "Easypaisa", accountName: "Platform Ltd", accountNumber: "0345-0000000", details: "" }], instructions: "Pay in PKR at the day's rate." };
  check("Super Admin saves the platform's payment accounts", (await P.put("/api/platform/payment-settings", ps)).status === 200);
  check("an account needs a number", (await P.put("/api/platform/payment-settings", { methods: [{ type: "bank", label: "Bad", accountName: "x", accountNumber: " ", details: "" }], instructions: "" })).status === 400);
  const pi = await O2.get("/api/admin/billing/platform-info");
  check("a store sees where to pay", pi.status === 200 && pi.data.methods.some((m) => m.accountNumber === "PK11PLAT0000000000000001") && pi.data.instructions.includes("PKR"), pi.data);
  check("Free package needs no payment", (await O2.post("/api/admin/billing/request", { packageId: "free", reference: "x" })).status === 400);
  check("a request needs proof", (await O2.post("/api/admin/billing/request", { packageId: "basic", interval: "month" })).status === 400);
  check("enterprise is priced by contract", (await O2.post("/api/admin/billing/request", { packageId: "enterprise", reference: "x" })).status === 400);
  check("instant plan change is switched off", (await O2.post("/api/admin/plan/change", { packageId: "premium" })).status === 409);
  check("store sends payment proof for Basic", (await O2.post("/api/admin/billing/request", { packageId: "basic", interval: "month", reference: "TXN-001", image: PNG })).status === 201);
  check("only one open request at a time", (await O2.post("/api/admin/billing/request", { packageId: "pro", interval: "month", reference: "TXN-002" })).status === 409);
  const reqs = (await P.get("/api/platform/billing-requests?status=pending")).data;
  const myReq = reqs.requests.find((r) => r.tenantId === slug);
  check("Super Admin sees the request with the proof", !!myReq && myReq.amount === 5000 && myReq.proof.reference === "TXN-001" && !!myReq.proof.imageUrl && reqs.pendingCount >= 1, myReq);
  check("Super Admin can open the screenshot, others cannot", (await fetch(BASE + myReq.proof.imageUrl, { headers: { cookie: Object.entries(P.jar).map(([k, v]) => `${k}=${v}`).join("; ") } })).status === 200 && (await fetch(BASE + myReq.proof.imageUrl)).status === 401);
  check("a store cannot approve its own payment", (await O2.post(`/api/platform/billing-requests/${myReq._id}/approve`, {})).status === 401);
  check("reject needs a reason", (await P.post(`/api/platform/billing-requests/${myReq._id}/reject`, {})).status === 400);
  check("Super Admin rejects it", (await P.post(`/api/platform/billing-requests/${myReq._id}/reject`, { reason: "Transaction not found" })).status === 200);
  check("store sees the rejection and the package is unchanged", (await O2.get("/api/admin/billing/platform-info")).data.history[0].status === "rejected" && (await O2.get("/api/admin/features")).data.package === "free");
  check("store sends the payment again", (await O2.post("/api/admin/billing/request", { packageId: "basic", interval: "month", reference: "TXN-003" })).status === 201);
  const myReq2 = (await P.get("/api/platform/billing-requests?status=pending")).data.requests.find((r) => r.tenantId === slug);
  const ap = await P.post(`/api/platform/billing-requests/${myReq2._id}/approve`, {});
  const days = (new Date(ap.data.paidUntil) - Date.now()) / 864e5;
  check("approval activates Starter for 30 days", ap.status === 200 && days > 29 && days <= 30.1, days);
  check("store now has the Basic package", (await O2.get("/api/admin/features")).data.package === "basic");
  check("an approved request cannot be approved twice", (await P.post(`/api/platform/billing-requests/${myReq2._id}/approve`, {})).status === 404);
  await O2.post("/api/admin/billing/request", { packageId: "basic", interval: "month", reference: "TXN-004" });
  const myReq3 = (await P.get("/api/platform/billing-requests?status=pending")).data.requests.find((r) => r.tenantId === slug);
  const ap3 = await P.post(`/api/platform/billing-requests/${myReq3._id}/approve`, {});
  check("renewing extends from the current end date (about 60 days)", ((new Date(ap3.data.paidUntil) - Date.now()) / 864e5) > 59);
  await dbP.collection("tenants").updateOne({ slug }, { $set: { paidUntil: new Date(Date.now() - 5 * 864e5) } });
  check("package expires after the 3-day grace period", (await O2.get("/api/admin/features")).data.package === "free");
  check("the store is told it expired", (await O2.get("/api/admin/notifications")).data.notifications.some((n) => n.title === "Package expired"));
  await P.put("/api/platform/payment-settings", { methods: oldSettings.methods || [], instructions: oldSettings.instructions || "" }); // put back whatever was there before this test
  await mcP.close();

  console.log("\n[20] Store pictures, blog, returns, shipping zones, loyalty points");
  // -- pictures
  const pics = await D.patch("/api/admin/settings", { logoUrl: up.data.url, bannerUrl: up.data.url, categoryImages: { Apparel: up.data.url } });
  check("owner saves logo, banner and a category picture", pics.status === 200, pics.data);
  const picInfo = (await anon.get("/api/store/demo/info")).data;
  check("storefront gets the logo, banner and category image", picInfo.logoUrl === up.data.url && picInfo.bannerUrl === up.data.url && picInfo.categories.find((c) => c.name === "Apparel").image === up.data.url, picInfo.logoUrl);
  check("picture link must be an upload or https", (await D.patch("/api/admin/settings", { logoUrl: "javascript:alert(1)" })).status === 400 && (await D.patch("/api/admin/settings", { bannerUrl: "http://insecure.example.com/a.png" })).status === 400);
  check("pictures can be removed", (await D.patch("/api/admin/settings", { logoUrl: "" })).status === 200 && (await anon.get("/api/store/demo/info")).data.logoUrl === "");
  // -- blog
  check("Free package has no blog", (await O2.get("/api/admin/blog")).status === 403);
  check("cashier cannot write blog posts", (await K.post("/api/admin/blog", { title: "Nope post", body: "x" })).status === 403);
  const bp = await D.post("/api/admin/blog", { title: "Our first post " + suffix, excerpt: "Hello", body: "First paragraph.\n\nSecond <script>alert(1)</script> paragraph.", status: "draft" });
  check("owner writes a draft post", bp.status === 201 && !!bp.data.slug, bp.data);
  check("draft is not public", !(await anon.get("/api/store/demo/blog")).data.posts.some((p) => p.slug === bp.data.slug) && (await anon.get(`/api/store/demo/blog/${bp.data.slug}`)).status === 404);
  check("owner publishes it", (await D.put(`/api/admin/blog/${bp.data.id}`, { status: "published" })).status === 200);
  const blogList = (await anon.get("/api/store/demo/blog")).data.posts;
  check("published post is listed (without the full text)", blogList.some((p) => p.slug === bp.data.slug) && !JSON.stringify(blogList).includes("First paragraph"));
  const post = await anon.get(`/api/store/demo/blog/${bp.data.slug}`);
  check("post page returns the text as plain data", post.status === 200 && post.data.post.body.includes("<script>"), post.status);
  check("bad picture link on a post is refused", (await D.post("/api/admin/blog", { title: "Bad pic", body: "x", image: "javascript:x" })).status === 400);
  check("owner deletes the post", (await D.del(`/api/admin/blog/${bp.data.id}`)).status === 200 && (await anon.get(`/api/store/demo/blog/${bp.data.slug}`)).status === 404);
  // -- returns
  const rEmail = `ret-${suffix}@example.com`;
  const sale1 = await K.post("/api/admin/pos/orders", { items: [{ productId: posProduct._id, variantId: posProduct.variants[0].id, qty: 3 }], paymentMethod: "cash", customerEmail: rEmail });
  const stockBeforeRet = (await D.get("/api/admin/products")).data.products.find((p) => p._id === posProduct._id).variants[0].stock;
  check("a paid order exists for the return test", sale1.status === 201 && sale1.data.order.status === "paid");
  const rnum = sale1.data.order.number;
  check("Free package has no returns portal", (await O2.get("/api/admin/returns")).status === 403);
  check("wrong email cannot look up the order", (await anon.get(`/api/store/demo/returns/order?number=${rnum}&email=wrong@example.com`)).status === 404);
  const lookup = await anon.get(`/api/store/demo/returns/order?number=${rnum}&email=${rEmail}`);
  check("buyer sees the order is eligible", lookup.status === 200 && lookup.data.eligible === true && lookup.data.order.lines.length === 1, lookup.data);
  const vId = lookup.data.order.lines[0].variantId;
  check("cannot return more than was bought", (await anon.post("/api/store/demo/returns", { number: rnum, email: rEmail, reason: "too many", items: [{ variantId: vId, qty: 9 }] })).status === 400);
  check("cannot return an item that is not in the order", (await anon.post("/api/store/demo/returns", { number: rnum, email: rEmail, reason: "nope", items: [{ variantId: "nothing", qty: 1 }] })).status === 400);
  check("buyer requests a return of 2 of 3", (await anon.post("/api/store/demo/returns", { number: rnum, email: rEmail, reason: "Handle is chipped", items: [{ variantId: vId, qty: 2 }] })).status === 201);
  check("only one open return per order", (await anon.post("/api/store/demo/returns", { number: rnum, email: rEmail, reason: "again" })).status === 409);
  const rl = (await D.get("/api/admin/returns?status=requested")).data;
  const ret = rl.returns.find((r) => r.orderNumber === rnum);
  check("store sees the request", !!ret && ret.items[0].qty === 2 && rl.counts.requested >= 1, ret);
  check("cashier cannot handle returns", (await K.post(`/api/admin/returns/${ret._id}/approve`, {})).status === 403);
  check("store approves the return", (await D.post(`/api/admin/returns/${ret._id}/approve`, { note: "Send it back" })).status === 200);
  const unit = posProduct.variants[0].price;
  const rf = await D.post(`/api/admin/returns/${ret._id}/refund`, { amountCents: 99999999 }); // asks for far more than the items are worth
  check("a refund is capped at the value of the returned items", rf.status === 200 && rf.data.amountCents === unit * 2 && rf.data.orderRefunded === false, rf.data);
  const refunded = await dbP2(rnum);
  async function dbP2(n) { return (await D.get("/api/admin/orders")).data.orders.find((o) => o.number === n); }
  check("partial refund recorded: order stays paid, amount is the 2 returned items", refunded.status === "paid" && refunded.refundedTotal === unit * 2, { status: refunded.status, refundedTotal: refunded.refundedTotal, expected: unit * 2 });
  const stockAfterRet = (await D.get("/api/admin/products")).data.products.find((p) => p._id === posProduct._id).variants[0].stock;
  check("returned items went back into stock", stockAfterRet === stockBeforeRet + 2, { stockBeforeRet, stockAfterRet });
  check("a refunded return cannot be refunded twice", (await D.post(`/api/admin/returns/${ret._id}/refund`, {})).status === 409);
  check("buyer sees the refund status", (await anon.get(`/api/store/demo/returns/order?number=${rnum}&email=${rEmail}`)).data.existing.status === "refunded");
  const sale2 = await K.post("/api/admin/pos/orders", { items: [{ productId: posProduct._id, variantId: posProduct.variants[0].id, qty: 1 }], paymentMethod: "cash", customerEmail: rEmail });
  await anon.post("/api/store/demo/returns", { number: sale2.data.order.number, email: rEmail, reason: "Changed my mind" });
  const ret2 = (await D.get("/api/admin/returns?status=requested")).data.returns.find((r) => r.orderNumber === sale2.data.order.number);
  check("reject needs a reason", (await D.post(`/api/admin/returns/${ret2._id}/reject`, {})).status === 400);
  check("store rejects a return with a reason", (await D.post(`/api/admin/returns/${ret2._id}/reject`, { reason: "Outside our policy" })).status === 200);
  check("buyer sees why it was rejected", (await anon.get(`/api/store/demo/returns/order?number=${sale2.data.order.number}&email=${rEmail}`)).data.existing.note === "Outside our policy");
  // -- shipping zones
  check("invalid zone (negative fee) is refused", (await D.patch("/api/admin/settings", { shippingZones: [{ name: "Bad", countries: ["PK"], rate: -5 }] })).status === 400);
  check("owner saves shipping zones", (await D.patch("/api/admin/settings", { shippingZones: [{ name: "Pakistan", countries: ["Pakistan", "PK"], rate: 300, freeOver: 0 }, { name: "Gulf", countries: ["UAE"], rate: 1500, freeOver: 20000 }] })).status === 200);
  const qz = async (country, qty = 1) => (await S.post("/api/store/demo/cart/quote", { items: [{ productId: mug.id, variantId: mug.variants[0].id, qty }], ...(country ? { country } : {}) })).data;
  check("Pakistan pays its own rate (case does not matter)", (await qz("Pakistan")).shipping === 300 && (await qz("pk")).shipping === 300);
  check("UAE pays the Gulf rate", (await qz("UAE")).shipping === 1500);
  check("free shipping over the zone's amount", (await qz("UAE", 15)).shipping === 0);
  const flat = (await anon.get("/api/store/demo/info")).data.shippingFlat;
  check("unknown country and no country use the default fee", (await qz("Atlantis")).shipping === flat && (await qz(null)).shipping === flat, flat);
  const zOrder = await BUY().post("/api/store/demo/checkout", { items: [{ productId: mug.id, variantId: mug.variants[0].id, qty: 1 }], customer: { name: "Zed", email: "zed@example.com" }, address: { line1: "1 Road", city: "Karachi", country: "Pakistan" }, paymentMethod: "cod" });
  check("the order is charged the zone's shipping", zOrder.status === 201 && (await D.get("/api/admin/orders")).data.orders.find((o) => o.number === zOrder.data.order.number).shipping === 300, zOrder.data);
  // -- loyalty
  check("Free package has no loyalty points", (await O2.patch("/api/admin/settings", { loyalty: { enabled: true, earnRate: 1, pointValueCents: 1, minRedeem: 100 } })).status === 403);
  check("owner turns on loyalty points", (await D.patch("/api/admin/settings", { loyalty: { enabled: true, earnRate: 1, pointValueCents: 1, minRedeem: 100 } })).status === 200);
  check("storefront announces the loyalty rules", (await anon.get("/api/store/demo/info")).data.features.loyalty.minRedeem === 100);
  const lEmail = `loy-${suffix}@example.com`, lPass = "Loyal-" + Math.random().toString(36).slice(2) + "Qq1!";
  const LC = new Client();
  await LC.post("/api/store/demo/auth/register", { name: "Lola Loyal", email: lEmail, password: lPass });
  const q7 = { items: [{ productId: mug.id, variantId: mug.variants[0].id, qty: 7 }] };
  check("anonymous cannot spend points", (await anon.post("/api/store/demo/cart/quote", { ...q7, redeemPoints: 100 })).status === 401);
  check("cannot spend points you do not have", (await LC.post("/api/store/demo/cart/quote", { ...q7, redeemPoints: 100 })).status === 400);
  const lo1 = await LC.post("/api/store/demo/checkout", { ...q7, customer: { name: "Lola Loyal", email: lEmail }, address: { line1: "1 Road", city: "Lahore", country: "Pakistan" }, paymentMethod: "cod" });
  check("an unpaid order earns no points yet", lo1.status === 201 && (await LC.get("/api/store/demo/auth/me")).data.customer.points === 0);
  const lo1id = (await D.get("/api/admin/orders")).data.orders.find((o) => o.number === lo1.data.order.number)._id;
  await D.post(`/api/admin/orders/${lo1id}/status`, { status: "paid" });
  const expectedPts = Math.floor((7 * mug.variants[0].price) / 100);
  check("points are earned when the order is paid", (await LC.get("/api/store/demo/auth/me")).data.customer.points === expectedPts, expectedPts);
  const qp = await LC.post("/api/store/demo/cart/quote", { ...q7, redeemPoints: 100 });
  check("quote applies points as money off", qp.status === 200 && qp.data.pointsUsed === 100 && qp.data.pointsDiscount === 100, qp.data);
  check("below the minimum is refused", (await LC.post("/api/store/demo/cart/quote", { ...q7, redeemPoints: 50 })).status === 400);
  check("more than the balance is refused", (await LC.post("/api/store/demo/cart/quote", { ...q7, redeemPoints: expectedPts + 1 })).status === 400);
  const lo2 = await LC.post("/api/store/demo/checkout", { ...q7, redeemPoints: 100, customer: { name: "Lola Loyal", email: lEmail }, address: { line1: "1 Road", city: "Lahore", country: "Pakistan" }, paymentMethod: "cod" });
  const ptsAfterSpend = (await LC.get("/api/store/demo/auth/me")).data.customer.points;
  check("order spends the points and costs less", lo2.status === 201 && lo2.data.order.total === qp.data.total - qp.data.shipping + 300 &&ptsAfterSpend === expectedPts - 100, { orderTotal: lo2.data.order?.total, quoteTotal: qp.data.total, flat, ptsAfterSpend, expectedAfter: expectedPts - 100 });
  const lo2id = (await D.get("/api/admin/orders")).data.orders.find((o) => o.number === lo2.data.order.number)._id;
  check("cancelling that order gives the points back", (await D.post(`/api/admin/orders/${lo2id}/status`, { status: "cancelled" })).status === 200 && (await LC.get("/api/store/demo/auth/me")).data.customer.points === expectedPts);
  check("points show in the store's customer list", (await D.get("/api/admin/customers")).data.customers.find((c) => c.email === lEmail).points === expectedPts);
  await LC.del("/api/store/demo/account"); // erase this test shopper so the reset can remove it

  // restore the demo store so tests leave no mess behind (development-only endpoint)
  const reset = await P.post("/api/platform/dev/reset-demo");
  console.log(reset.status === 200 ? "\n(demo store restored to its starting state)" : "\n(could not reset demo store)");
  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("Test crashed:", e); process.exit(2); });
