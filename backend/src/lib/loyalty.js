// Loyalty points (MKT-06): shoppers earn points on paid orders and spend them as a discount at checkout.
const F = require("./flags");

const DEFAULTS = { enabled: false, earnRate: 1, pointValueCents: 1, minRedeem: 100 };

// earnRate = points earned per 1.00 of currency spent; pointValueCents = what one point is worth when spent.
function config(tenant, flags) {
  const l = { ...DEFAULTS, ...((tenant.settings && tenant.settings.loyalty) || {}) };
  return { ...l, enabled: !!(flags["MKT-06"] && l.enabled) };
}

// Points are earned once per order, when it becomes paid. Safe to call more than once.
async function award(R, tenant, order) {
  try {
    const { flags } = await F.resolve(tenant);
    const c = config(tenant, flags);
    if (!c.enabled || !order.customer || !order.customer.email) return 0;
    const claim = await R.orders.updateOne({ _id: order._id, loyaltyAwarded: { $ne: true } }, { $set: { loyaltyAwarded: true } });
    if (!claim.modifiedCount) return 0;
    const base = Math.max(0, order.subtotal - (order.discount || 0) - (order.pointsDiscount || 0)); // money actually paid for goods
    const points = Math.floor((base / 100) * c.earnRate);
    if (points > 0) {
      await R.customers.updateOne({ email: order.customer.email }, { $inc: { points } });
      await R.orders.updateOne({ _id: order._id }, { $set: { pointsEarned: points } });
    }
    return points;
  } catch { return 0; } // loyalty must never break an order
}

// An order that used points was cancelled: give the points back (once).
async function refund(R, order) {
  if (!order.pointsUsed || order.pointsRefunded || !order.customer || !order.customer.email) return;
  const claim = await R.orders.updateOne({ _id: order._id, pointsRefunded: { $ne: true } }, { $set: { pointsRefunded: true } });
  if (claim.modifiedCount) await R.customers.updateOne({ email: order.customer.email }, { $inc: { points: order.pointsUsed } });
}

module.exports = { config, award, refund };
