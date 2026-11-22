// Tenant-scoped data access layer (SRS FR-003).
// Application code for tenant data MUST go through scoped(); it injects tenantId into every
// filter and insert, and refuses to run without a tenant context.
const { getDb } = require("../db");

function stripTenant(update) {
  // never allow a caller to rewrite tenantId
  const u = { ...update };
  for (const op of ["$set", "$setOnInsert", "$inc", "$unset"]) {
    if (u[op] && "tenantId" in u[op]) {
      u[op] = { ...u[op] };
      delete u[op].tenantId;
    }
  }
  return u;
}

function scoped(tenantId) {
  if (!tenantId || typeof tenantId !== "string") throw new Error("Tenant context required");
  const col = (name) => {
    const c = () => getDb().collection(name);
    return {
      find: (filter = {}, opts) => c().find({ ...filter, tenantId }, opts),
      findOne: (filter = {}, opts) => c().findOne({ ...filter, tenantId }, opts),
      count: (filter = {}) => c().countDocuments({ ...filter, tenantId }),
      insertOne: (doc) => c().insertOne({ ...doc, tenantId }),
      insertMany: (docs) => c().insertMany(docs.map((d) => ({ ...d, tenantId }))),
      updateOne: (filter, update, opts) => c().updateOne({ ...filter, tenantId }, stripTenant(update), opts),
      updateMany: (filter, update, opts) => c().updateMany({ ...filter, tenantId }, stripTenant(update), opts),
      findOneAndUpdate: (filter, update, opts) => c().findOneAndUpdate({ ...filter, tenantId }, stripTenant(update), { returnDocument: "after", ...opts }),
      deleteOne: (filter) => c().deleteOne({ ...filter, tenantId }),
      deleteMany: (filter) => c().deleteMany({ ...filter, tenantId }),
      aggregate: (pipeline) => c().aggregate([{ $match: { tenantId } }, ...pipeline]),
    };
  };
  return {
    tenantId,
    col,
    products: col("products"),
    orders: col("orders"),
    customers: col("customers"),
    discounts: col("discounts"),
    users: col("tenantUsers"),
    roles: col("roles"),
    usage: col("usageCounters"),
    specs: col("storeSpecs"),
    jobs: col("generationJobs"),
    tickets: col("tickets"),
    notifications: col("notifications"),
    audit: col("auditLogs"),
    counters: col("counters"),
  };
}

module.exports = { scoped };
