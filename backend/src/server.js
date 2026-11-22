require("dotenv").config();
const app = require("./app");
const { connect, close } = require("./db");
const { seed } = require("./seed");

const port = Number(process.env.PORT) || 5000;

(async () => {
  const db = await connect();
  if (!(await db.collection("packages").countDocuments())) await seed(); // first run
  const server = app.listen(port, () => console.log(`[api] listening on http://localhost:${port}`));
  const stop = async () => { server.close(); await close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
})().catch((e) => {
  console.error("[api] failed to start:", e.message);
  process.exit(1);
});
