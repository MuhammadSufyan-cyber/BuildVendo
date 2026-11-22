const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { getDb } = require("./db");

const app = express();
const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:3000";

app.disable("x-powered-by");
// How many proxies sit in front of the API. 1 locally; 2 on Render behind the Vercel website (so real visitor addresses are used for rate limits and the IP allow-list).
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 1);
app.use(cors({ origin: allowedOrigin, credentials: true }));
// Stripe needs the raw request body to check its signature, so this is mounted before the JSON parser.
app.use("/api/webhooks", require("./routes/webhooks"));
// bodies are small, except image uploads (base64)
app.use((req, res, next) => express.json({ limit: req.path === "/api/admin/uploads" ? "6mb" : "1mb" })(req, res, next));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.get("/api/health", async (_req, res) => {
  let db = "down";
  try { await getDb().command({ ping: 1 }); db = "up"; } catch { /* reported below */ }
  res.json({ status: db === "up" ? "ok" : "degraded", service: "ecommerce-platform-api", database: db });
});

app.use("/api/public", require("./routes/public"));
app.use("/api/auth/2fa", require("./routes/twofactor"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/platform", require("./routes/platform"));
app.use("/api/admin/builder", require("./routes/builder"));
app.use("/api/admin/payments", require("./routes/payments"));
app.use("/api/admin/billing", require("./routes/billing"));
app.use("/api/admin/domains", require("./routes/domains"));
app.use("/api/admin/webhooks", require("./routes/outbound"));
app.use("/api/admin/blog", require("./routes/blog"));
app.use("/api/admin/returns", require("./routes/returns"));
app.use("/api/admin/uploads", require("./routes/uploads"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/store", require("./routes/store"));

// Uploaded images are public files: served as images only, never executed.
app.use("/uploads", express.static(require("./routes/uploads").UPLOAD_DIR, { index: false, dotfiles: "deny", maxAge: "7d", setHeaders: (res) => { res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox"); } }));

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

// Central error handler: never leaks stack traces or database details.
app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && "body" in error) return response.status(400).json({ error: "Request body must be valid JSON." });
  if (error.status && error.status < 500) return response.status(error.status).json({ error: error.message, ...(error.suspended ? { suspended: true } : {}), ...(error.upgrade ? { upgrade: true } : {}) });
  if (error.code === 11000) return response.status(409).json({ error: "That value already exists." });
  if (error.status === 503) return response.status(503).json({ error: error.message, suspended: !!error.suspended });
  console.error(error);
  return response.status(500).json({ error: "An unexpected server error occurred." });
});

module.exports = app;
