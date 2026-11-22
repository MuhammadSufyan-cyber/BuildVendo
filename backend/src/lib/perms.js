// RBAC (SRS section 10). Permissions are "resource.action" strings.
const PLATFORM_ROLES = {
  super_admin: ["*"],
  support: ["platform.tenants.view", "platform.tenants.impersonate", "platform.broadcast.send", "platform.tickets.manage"],
  billing: ["platform.tenants.view", "platform.billing.view", "platform.billing.manage", "platform.analytics.view"],
};

const TENANT_PERMISSIONS = [
  "products.read", "products.write", "inventory.adjust", "orders.read", "orders.create_pos", "orders.refund", "pos.operate",
  "customers.read", "customers.export", "discounts.manage", "reports.view", "theme.edit", "aibuilder.use",
  "staff.manage", "roles.manage", "settings.manage", "plan.billing.manage", "audit.view", "account.manage_self",
];

const TENANT_ROLES = {
  owner: ["*"],
  manager: ["products.read", "products.write", "inventory.adjust", "orders.read", "orders.create_pos", "orders.refund", "pos.operate",
    "customers.read", "customers.export", "discounts.manage", "reports.view", "theme.edit", "aibuilder.use", "audit.view", "account.manage_self"],
  cashier: ["products.read", "orders.read", "orders.create_pos", "pos.operate", "customers.read", "account.manage_self"],
  staff: ["products.read", "products.write", "inventory.adjust", "orders.read", "customers.read", "account.manage_self"],
};

function can(perms, needed) {
  return perms.includes("*") || perms.includes(needed);
}

module.exports = { PLATFORM_ROLES, TENANT_ROLES, TENANT_PERMISSIONS, can };
