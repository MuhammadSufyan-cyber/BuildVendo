// Outgoing webhooks (PLT-05): a store registers a URL and receives signed JSON when events happen (order.created, ...).
// Deliveries run in the background with a few retries. On Vercel this should move to a queue (Inngest/QStash).
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const { getDb } = require("../db");
const { decrypt } = require("./crypto");

const EVENTS = ["order.created", "order.paid", "order.fulfilled", "order.cancelled", "order.refunded", "product.created", "product.updated", "ping"];
const dev = () => process.env.NODE_ENV !== "production";

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  if (l.startsWith("::ffff:")) return isPrivate(l.slice(7));
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe8") || l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb");
}

// SSRF guard: only https to public addresses (plain http to localhost is allowed in development only).
async function checkUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("That is not a valid URL."); }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.username || url.password) throw new Error("The URL must not contain a user name or password.");
  if (url.protocol !== "https:" && !(dev() && local && url.protocol === "http:")) throw new Error("The webhook URL must start with https://");
  if (dev() && local) return url;
  const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error("We could not find that address.");
  if (addrs.some((a) => isPrivate(a.address))) throw new Error("That address is not allowed (it points inside a private network).");
  return url;
}

const sign = (secret, body) => "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deliver(hook, event, data) {
  const secret = decrypt(hook.secretEnc);
  const body = JSON.stringify({ id: "evt_" + crypto.randomBytes(8).toString("hex"), event, created: new Date().toISOString(), data });
  let status = null, error = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = await checkUrl(hook.url); // re-checked on every attempt (defends against DNS tricks)
      const r = await fetch(url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/json", "x-webhook-event": event, "x-webhook-signature": sign(secret, body), "user-agent": "BuildVendo-Webhooks/1.0" }, body });
      status = r.status; error = null;
      if (r.status >= 200 && r.status < 300) break;
      error = `HTTP ${r.status}`;
    } catch (e) { error = e.message; }
    if (attempt < 2) await sleep(attempt === 0 ? 1000 : 4000);
  }
  await getDb().collection("webhooks").updateOne({ _id: hook._id }, { $set: { lastDelivery: { at: new Date(), event, status, ok: !error, error } } });
  return { ok: !error, status, error };
}

// Fire and forget: never slows down or breaks the request that caused the event.
function emit(tenantId, event, data) {
  require("./bg").bg((async () => {
    try {
      const hooks = await getDb().collection("webhooks").find({ tenantId, active: true, events: event }).toArray();
      await Promise.all(hooks.map((h) => deliver(h, event, data).catch(() => {}))); // finish all deliveries inside the background task
    } catch { /* ignore */ }
  })());
}

module.exports = { emit, deliver, checkUrl, sign, EVENTS };
