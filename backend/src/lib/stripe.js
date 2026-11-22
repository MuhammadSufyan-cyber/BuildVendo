const Stripe = require("stripe");
const { decrypt } = require("./crypto");

let platform = null;
// The platform's own Stripe account (used to charge tenants for their package).
const platformStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!platform) platform = new Stripe(process.env.STRIPE_SECRET_KEY);
  return platform;
};
// A store's own Stripe account (used to charge that store's shoppers), key provided by the store owner.
const tenantStripe = (tenant) => (tenant.stripe && tenant.stripe.keyEnc ? new Stripe(decrypt(tenant.stripe.keyEnc)) : null);

module.exports = { platformStripe, tenantStripe, Stripe };
