// Feature-flag catalog (SRS section 11). [id, name, minPlan] where minPlan: 0 Free,1 Basic,2 Pro,3 Premium,4 Enterprise
const catalog = [
  ["Catalog", [
    ["CAT-01", "Simple products and images", 0], ["CAT-02", "Product variants (size, colour)", 1], ["CAT-03", "Collections and categories", 0],
    ["CAT-04", "Bulk CSV import and export", 1], ["CAT-05", "Product bundles", 2], ["CAT-06", "Digital products (downloads)", 2],
    ["CAT-07", "Subscription products", 3], ["CAT-08", "Pre-orders", 2], ["CAT-09", "Backorders", 2], ["CAT-10", "Gift cards", 2],
    ["CAT-11", "Product reviews", 1], ["CAT-12", "Reviews with photos", 2]]],
  ["Inventory", [
    ["INV-01", "Stock tracking", 0], ["INV-02", "Low-stock alerts", 1], ["INV-03", "Barcode and SKU management", 1],
    ["INV-04", "Multi-location inventory", 2], ["INV-05", "Stock transfers between locations", 2], ["INV-06", "Suppliers and purchase orders", 3]]],
  ["Checkout and payments", [
    ["PAY-01", "Guest checkout", 0], ["PAY-02", "One-page checkout", 1], ["PAY-03", "Cash on delivery", 0], ["PAY-04", "One payment gateway", 0],
    ["PAY-05", "Multiple payment gateways", 2], ["PAY-06", "Local payment gateways", 1], ["PAY-07", "Saved cards", 2],
    ["PAY-08", "Apple Pay and Google Pay", 2], ["PAY-09", "Buy now, pay later", 3], ["PAY-10", "Multi-currency", 2],
    ["PAY-11", "Automatic tax calculation", 2], ["PAY-12", "Abandoned-cart recovery (email)", 2], ["PAY-13", "Abandoned-cart recovery (SMS, WhatsApp)", 3]]],
  ["Orders and shipping", [
    ["ORD-01", "Order management", 0], ["ORD-02", "Refunds", 1], ["ORD-03", "Returns portal", 2], ["ORD-04", "Partial fulfilment", 2],
    ["ORD-05", "Draft orders", 2], ["ORD-06", "Flat-rate and zone shipping", 0], ["ORD-07", "Live carrier rates", 2],
    ["ORD-08", "Shipping label printing", 2], ["ORD-09", "Order tracking page", 1], ["ORD-10", "Multi-warehouse routing", 3]]],
  ["Point of sale (cashier)", [
    ["POS-01", "POS checkout screen", 2], ["POS-02", "Receipt and barcode printing", 2], ["POS-03", "Cash drawer support", 2],
    ["POS-04", "Shift and till reports", 2], ["POS-05", "Split payments", 2], ["POS-06", "Offline mode with sync", 3], ["POS-07", "Online and POS inventory sync", 2]]],
  ["Customers and marketing", [
    ["MKT-01", "Customer accounts", 0], ["MKT-02", "Discount codes", 1], ["MKT-03", "Automatic discounts", 2], ["MKT-04", "Flash sales", 2],
    ["MKT-05", "Upsell and cross-sell", 2], ["MKT-06", "Loyalty points", 3], ["MKT-07", "Referral programme", 3], ["MKT-08", "Customer segments", 2],
    ["MKT-09", "Email campaigns", 2], ["MKT-10", "Popups and banners", 2], ["MKT-11", "SEO tools", 1], ["MKT-12", "Google and Meta pixels", 1],
    ["MKT-13", "Product feeds (Google, Meta)", 2], ["MKT-14", "Wishlist", 1]]],
  ["Storefront", [
    ["STO-01", "Basic themes", 0], ["STO-02", "Premium themes", 2], ["STO-03", "Drag-and-drop page builder", 2], ["STO-04", "Blog", 1],
    ["STO-05", "Multi-language and RTL", 2], ["STO-06", "Progressive web app (PWA)", 3], ["STO-07", "AI search and recommendations", 3], ["STO-08", "Custom CSS", 2]]],
  ["AI", [
    ["AI-01", "AI Store Builder", 3], ["AI-02", "AI product descriptions", 2], ["AI-03", "AI customer-support chatbot", 3], ["AI-04", "AI sales insights and forecasting", 3]]],
  ["Platform", [
    ["PLT-01", "Platform subdomain", 1], ["PLT-02", "Custom domain", 3], ["PLT-03", "White-label branding", 3], ["PLT-04", "Public API", 3],
    ["PLT-05", "Webhooks", 3], ["PLT-06", "Template and theme marketplace", 2], ["PLT-07", "Multi-vendor marketplace", 3], ["PLT-08", "B2B wholesale pricing", 3],
    ["PLT-09", "Dedicated database", 4], ["PLT-10", "SLA and priority support", 4], ["PLT-11", "Custom integrations", 4]]],
  ["Security", [
    ["SEC-01", "Two-factor authentication (2FA)", 1], ["SEC-02", "Audit log", 2], ["SEC-03", "Custom roles", 2], ["SEC-04", "IP allow-list", 3],
    ["SEC-05", "Single sign-on (SSO)", 4], ["SEC-06", "GDPR tools (export, delete)", 1], ["SEC-07", "Automated backups", 1],
    ["SEC-08", "Fraud detection", 3], ["SEC-09", "Rate limiting and bot protection", 1]]],
  ["Analytics", [
    ["ANA-01", "Basic dashboard", 1], ["ANA-02", "Sales, customer and inventory reports", 1], ["ANA-03", "Cohort and funnel analysis", 3], ["ANA-04", "Scheduled and exportable reports", 2]]],
  ["Tenant operations", [
    ["OPS-01", "Onboarding wizard", 1], ["OPS-02", "Email and SMS templates", 1], ["OPS-03", "Support tickets to platform", 1],
    ["OPS-04", "Data export on cancellation", 1], ["OPS-05", "Status page", 1]]],
];

const PLAN_ORDER = ["free","basic","pro","premium","enterprise"];
const FEATURES = [];
for (const [module, items] of catalog) for (const [id, name, minPlan] of items) FEATURES.push({ id, module, name, minPlan });

function flagsForPlan(planIndex) {
  const flags = {};
  for (const f of FEATURES) flags[f.id] = planIndex >= f.minPlan;
  return flags;
}

module.exports = { FEATURES, PLAN_ORDER, flagsForPlan };
