// Vercel entry point: the whole Express API runs as one serverless function.
// (Locally and on a normal server, src/server.js is used instead.)
const app = require("../src/app");
const { connect } = require("../src/db");

let ready = null;

// Runs once per warm function instance: connect to MongoDB and create the packages/Super Admin on a brand-new database.
async function init() {
  const db = await connect();
  if (!(await db.collection("packages").countDocuments())) await require("../src/seed").seed();
}

module.exports = async (req, res) => {
  try {
    await (ready ||= init());
  } catch (e) {
    ready = null; // try again on the next request
    console.error("[api] startup failed:", e.message);
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ error: "The service is starting or the database is unreachable. Please try again." }));
  }
  return app(req, res);
};
