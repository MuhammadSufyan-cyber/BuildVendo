// GDPR helpers (SEC-06): export everything held about a customer, and anonymise them on request.
// Orders are kept (accounting law) but stripped of personal details.
const ANON_NAME = "Deleted customer";

async function exportCustomer(R, customer) {
  const [orders, reviews] = await Promise.all([
    R.orders.find({ "customer.email": customer.email }).toArray(),
    R.col("reviews").find({ customerId: String(customer._id) }).toArray(),
  ]);
  const { passwordHash, failures, lockUntil, ...profile } = customer;
  return { exportedAt: new Date(), profile, orders: orders.map(({ _id, tenantId, ...o }) => o), reviews: reviews.map(({ _id, tenantId, ...r }) => r) };
}

async function anonymizeCustomer(R, customer) {
  const anon = `deleted-${customer._id}@anonymized.invalid`;
  await R.orders.updateMany({ "customer.email": customer.email }, { $set: { "customer.name": ANON_NAME, "customer.email": anon, "customer.phone": null, shippingAddress: null } });
  await R.col("reviews").updateMany({ customerId: String(customer._id) }, { $set: { name: ANON_NAME } });
  await R.customers.updateOne({ _id: customer._id }, { $set: { name: ANON_NAME, email: anon, phone: null, addresses: [], wishlist: [], deletedAt: new Date() }, $unset: { passwordHash: "", failures: "", lockUntil: "" } });
  return anon;
}

module.exports = { exportCustomer, anonymizeCustomer };
