const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

let client = null;
let db = null;
let memServer = null;
let mode = "none";

// One cached client per process (important on serverless: avoids exhausting Atlas connections).
async function connect() {
  if (db) return db;
  let uri = (process.env.MONGODB_URI || "").trim();
  if (!uri || uri.includes("<username>") || uri.includes("<password>")) {
    const { MongoMemoryServer } = require("mongodb-memory-server");
    const dbPath = path.join(__dirname, "..", ".data");
    fs.mkdirSync(dbPath, { recursive: true });
    memServer = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: "wiredTiger" } });
    uri = memServer.getUri();
    mode = "local-test";
    console.log("[db] MONGODB_URI is empty -> using a local TEST database stored in backend/.data");
  } else {
    mode = "atlas";
  }
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, maxPoolSize: Number(process.env.DB_POOL) || 10 });
  await client.connect();
  db = client.db(process.env.DB_NAME || "ecommerce_platform");
  await ensureIndexes(db);
  console.log(`[db] connected (${mode}) database=${db.databaseName}`);
  return db;
}

// Every index on tenant data starts with tenantId (SRS 4.2).
async function ensureIndexes(d) {
  const ix = (c, spec, opt) => d.collection(c).createIndex(spec, opt);
  await Promise.all([
    ix("tenants", { slug: 1 }, { unique: true }),
    ix("tenants", { status: 1, packageId: 1 }),
    ix("packages", { key: 1 }, { unique: true }),
    ix("platformUsers", { email: 1 }, { unique: true }),
    ix("tenantUsers", { tenantId: 1, email: 1 }, { unique: true }),
    ix("roles", { tenantId: 1, name: 1 }, { unique: true }),
    ix("products", { tenantId: 1, slug: 1 }, { unique: true }),
    ix("products", { tenantId: 1, status: 1, category: 1 }),
    ix("customers", { tenantId: 1, email: 1 }, { unique: true }),
    ix("orders", { tenantId: 1, number: 1 }, { unique: true }),
    ix("orders", { tenantId: 1, status: 1, createdAt: -1 }),
    ix("discounts", { tenantId: 1, code: 1 }, { unique: true }),
    ix("usageCounters", { tenantId: 1, meter: 1, period: 1 }, { unique: true }),
    ix("storeSpecs", { tenantId: 1, version: 1 }, { unique: true }),
    ix("generationJobs", { tenantId: 1, createdAt: -1 }),
    ix("auditLogs", { tenantId: 1, createdAt: -1 }),
    ix("auditLogs", { "actor.id": 1, createdAt: -1 }),
    ix("tickets", { tenantId: 1, status: 1 }),
    ix("posts", { tenantId: 1, slug: 1 }, { unique: true }),
    ix("posts", { tenantId: 1, status: 1, publishedAt: -1 }),
    ix("notifications", { tenantId: 1, createdAt: -1 }),
    ix("tokens", { expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

function getDb() {
  if (!db) throw new Error("Database not connected");
  return db;
}

async function close() {
  if (client) await client.close();
  if (memServer) await memServer.stop();
  client = db = memServer = null;
}

module.exports = { connect, getDb, close, getMode: () => mode };
