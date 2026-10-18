const express = require("express");
const Database = require("better-sqlite3");

const BSE = process.env.BSE_URL || "http://localhost:8001";
const SELF = process.env.SELF_URL || "http://localhost:8000";
const DEADLINE = (Number(process.env.PULL_DELAY_SECONDS || 900) + 120) * 1000;

// ---------- Database: a notebook with two tables ----------
const db = new Database("trades.db");
db.exec(`
  create table if not exists trades(trade_id text primary key, client text, symbol text,
    quantity int, price real, timestamp text);
  create table if not exists jobs(id integer primary key autoincrement,
    status text, started_at integer, error text);
`);

const app = express();
app.use(express.json({ limit: "10mb" })); // default 100kb is too small for 3000 trades

// ---------- Live updates (SSE): the list of open browsers ----------
const clients = new Set();
const publish = (event, data) => {
  for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

// ---------- Status: is a pull running, failed, or idle? ----------
function status() {
  const job = db.prepare("select * from jobs order by id desc limit 1").get();
  if (!job) return { state: "idle" };
  if (job.status === "running" && Date.now() - job.started_at > DEADLINE) {
    db.prepare("update jobs set status='failed', error=? where id=?")
      .run("timed out waiting for BSE", job.id);
    return { state: "failed", error: "timed out waiting for BSE" };
  }
  const state = job.status === "running" ? "running" : job.status === "failed" ? "failed" : "idle";
  return { state, error: job.error };
}

// ---------- 1. Dashboard loads saved trades instantly ----------
app.get("/api/trades", (req, res) =>
  res.json(db.prepare("select * from trades order by timestamp desc").all()));

// ---------- 2. Start a pull ----------
app.post("/api/pull", async (req, res) => {
  if (status().state === "running") return res.status(202).json({ status: "already_running" });

  const { lastInsertRowid: id } =
    db.prepare("insert into jobs(status, started_at) values('running', ?)").run(Date.now());
  try {
    const cb = encodeURIComponent(`${SELF}/webhook/trades/${id}`);
    const r = await fetch(`${BSE}/getTrades?callback_url=${cb}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`BSE returned ${r.status}`);
  } catch (e) {
    db.prepare("update jobs set status='failed', error=? where id=?")
      .run(`could not start pull: ${e.message}`, id);
    publish("status", status());
    return res.status(502).json({ status: "failed" });
  }
  publish("status", status());
  res.status(202).json({ status: "started" });
});

// ---------- 3. The mock calls this when data is ready (webhook) ----------
app.post("/webhook/trades/:id", (req, res) => {
  const insert = db.prepare(
    "insert or ignore into trades values(@trade_id,@client,@symbol,@quantity,@price,@timestamp)");
  const fresh = [];
  db.transaction((list) => {
    for (const t of list) if (insert.run(t).changes) fresh.push(t); // only truly new trades
  })(req.body.trades);

  db.prepare("update jobs set status='done' where id=?").run(req.params.id);
  publish("trades", fresh);
  publish("status", status());
  res.json({ inserted: fresh.length });
});

// ---------- 4. Live push to browsers (SSE) ----------
app.get("/api/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
            Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write(`event: status\ndata: ${JSON.stringify(status())}\n\n`);
  clients.add(res);
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 15000); // keep-alive only, not polling
  req.on("close", () => { clearInterval(keepAlive); clients.delete(res); });
});

app.listen(8000, () => console.log("Backend running on port 8000"));