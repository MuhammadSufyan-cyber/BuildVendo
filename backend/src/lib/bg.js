// Background work that must still finish after the response has been sent (emails, webhooks, AI builder jobs).
// On Vercel the function would be frozen right after responding, so the work is registered with waitUntil.
// Everywhere else (your computer, a normal server) the promise simply keeps running.
function bg(promise) {
  if (promise && typeof promise.then === "function") {
    promise = promise.catch(() => {}); // background work must never crash the request
    if (process.env.VERCEL) {
      try { require("@vercel/functions").waitUntil(promise); } catch { /* helper unavailable: run normally */ }
    }
  }
  return promise;
}

module.exports = { bg };
