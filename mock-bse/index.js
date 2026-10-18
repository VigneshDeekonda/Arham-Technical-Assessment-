const express = require("express");
const app = express();

const DELAY = Number(process.env.PULL_DELAY_SECONDS || 900) * 1000; // 15 min by default
const FAIL_RATE = Number(process.env.FAIL_RATE || 0);               // 0 = never fail

// --- Make 3000 fake trades (same every time, because the seed is fixed) ---
let seed = 42;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const SYMBOLS = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ITC", "SBIN"];

const trades = Array.from({ length: 3000 }, (_, i) => ({
  trade_id: `T${String(i).padStart(6, "0")}`,
  client: `CL${String(1 + Math.floor(rnd() * 40)).padStart(3, "0")}`,
  symbol: SYMBOLS[Math.floor(rnd() * SYMBOLS.length)],
  quantity: 1 + Math.floor(rnd() * 500),
  price: +(100 + rnd() * 3900).toFixed(2),
  timestamp: new Date(Date.UTC(2026, 9, 1, 3, 45) + i * 7000).toISOString(),
}));

let pulls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Wait, then send the trades to the callback URL ---
async function deliver(url, count) {
  await sleep(DELAY);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trades: trades.slice(0, count) }),
      });
      if (r.ok) return;
    } catch {}
    await sleep(5000 * 2 ** attempt); // wait longer after each failed try
  }
}

// --- The endpoint the task asks for ---
app.get("/getTrades", (req, res) => {
  if (Math.random() < FAIL_RATE) return res.status(503).json({ error: "BSE unavailable" });

  const { callback_url } = req.query;
  if (!callback_url) return res.status(400).json({ error: "callback_url required" });

  pulls++;
  deliver(callback_url, Math.min(trades.length, 2000 + pulls * 300)); // no await: runs in background
  res.status(202).json({ status: "accepted", eta_seconds: DELAY / 1000 }); // instant reply
});

app.listen(8001, () => console.log("Mock BSE running on port 8001"));