// Creates a public demo storefront (slug "demo", prices in PKR) with sample products and one discount code.
// It creates NO user accounts. Safe to run twice: it does nothing if the store already exists.
// Usage (PowerShell, from the backend folder):
//   $env:DB_NAME = "buildvendo"; node scripts/create-demo-store.js
require("dotenv").config();
const { connect, close, getDb } = require("../src/db");

// price = rupees x 100 (the app stores money in the smallest unit)
const PRODUCTS = [
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

(async () => {
  await connect();
  const db = getDb();
  console.log(`[demo] database: ${db.databaseName}`);
  if (await db.collection("tenants").findOne({ slug: "demo" })) { console.log("[demo] the demo store already exists. Nothing to do."); return; }
  const now = new Date();
  await db.collection("tenants").insertOne({
    slug: "demo", name: "Demo Store", status: "active", packageId: "premium", region: "default", createdAt: now,
    settings: { currency: "PKR", tagline: "Everything you need, delivered.", theme: { primary: "#0d4a62", accent: "#ff7a59", font: "sans", style: "modern" }, taxRatePct: 0, shippingFlat: 20000, freeShippingOver: 500000 },
  });
  for (const [title, category, price, emoji, variants] of PRODUCTS) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    await db.collection("products").insertOne({
      tenantId: "demo", title, slug, description: `${title}: quality you can rely on. A sample product for the demo store.`,
      category, price: price * 100, emoji, images: [], status: "active", tags: [category.toLowerCase()], createdAt: now,
      variants: variants.map(([vt, stock], i) => ({ id: `${slug}-${i + 1}`, sku: `${slug.slice(0, 6).toUpperCase()}-${i + 1}`, title: vt, price: price * 100, stock })),
    });
  }
  await db.collection("discounts").insertOne({ tenantId: "demo", code: "WELCOME10", type: "percent", value: 10, minSubtotal: 0, active: true, used: 0, createdAt: now });
  console.log(`[demo] created the demo store with ${PRODUCTS.length} products and the code WELCOME10.`);
})().then(() => close()).catch((e) => { console.error(e); process.exit(1); });
