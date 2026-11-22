// Validation and shaping of payment settings (a store's methods for shoppers, and the platform's methods for stores).
const { z } = require("zod");

const method = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,30}$/).optional(),
  type: z.enum(["bank", "jazzcash", "easypaisa", "other"]),
  label: z.string().min(2).max(60),
  accountName: z.string().max(80).default(""),
  accountNumber: z.string().max(60).default(""), // account / IBAN / wallet number
  details: z.string().max(400).default(""),        // branch, notes
});

const httpsUrl = z.string().max(500).refine((u) => {
  try { const x = new URL(u.replace(/\{[a-z]+\}/g, "x")); return x.protocol === "https:" && !x.username && !x.password; } catch { return false; }
}, "The payment page link must be a valid https:// address without a user name or password.");

const storeConfig = z.object({
  manual: z.object({ enabled: z.boolean(), methods: z.array(method).max(6), instructions: z.string().max(600).default("") }),
  gateway: z.object({ enabled: z.boolean(), label: z.string().max(60).default("Pay online"), url: httpsUrl.or(z.literal("")), instructions: z.string().max(600).default("") }),
});

const platformConfig = z.object({ methods: z.array(method).max(8), instructions: z.string().max(800).default("") });

const withIds = (methods) => methods.map((m, i) => ({ ...m, id: m.id || `m${i + 1}-${Math.random().toString(36).slice(2, 6)}` }));

// Fill {order}, {amount}, {currency} in a store's gateway link.
function gatewayUrl(template, order) {
  return template.replace(/\{order\}/g, encodeURIComponent(order.number)).replace(/\{amount\}/g, encodeURIComponent((order.total / 100).toFixed(2))).replace(/\{currency\}/g, encodeURIComponent(order.currency));
}

const defaultStoreConfig = () => ({ manual: { enabled: false, methods: [], instructions: "" }, gateway: { enabled: false, label: "Pay online", url: "", instructions: "" } });

module.exports = { storeConfig, platformConfig, withIds, gatewayUrl, defaultStoreConfig };
