import { useEffect, useState } from "react";

export default function App() {
  const [trades, setTrades] = useState([]);
  const [fresh, setFresh] = useState(new Set());
  const [status, setStatus] = useState({ state: "idle" });

  useEffect(() => {
    // Load everything already saved in the database
    const load = () =>
      fetch("/api/trades").then((r) => r.json()).then(setTrades);

    const es = new EventSource("/api/stream");
    es.onopen = load; // runs on first open AND after every reconnect

    // New trades pushed by the backend
    es.addEventListener("trades", (e) => {
      const incoming = JSON.parse(e.data);
      setTrades((prev) => {
        const have = new Set(prev.map((t) => t.trade_id));
        const added = incoming.filter((t) => !have.has(t.trade_id)).reverse();
        return [...added, ...prev];
      });
      setFresh(new Set(incoming.map((t) => t.trade_id)));
    });

    // Pull status: idle / running / failed
    es.addEventListener("status", (e) => setStatus(JSON.parse(e.data)));

    return () => es.close();
  }, []);

  const startPull = () => fetch("/api/pull", { method: "POST" });

  const label =
    status.state === "running" ? "Pull in progress…"
    : status.state === "failed" ? `Pull failed: ${status.error}. Click Start pull to retry`
    : "Idle";

  return (
    <div>
      <h2>Trades ({trades.length})</h2>
      <button onClick={startPull} disabled={status.state === "running"}>
        Start pull
      </button>
      <span style={{ marginLeft: 12 }}>{label}</span>

      <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["ID", "Client", "Symbol", "Qty", "Price", "Time"].map((h) => (
              <th key={h} align="left">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.trade_id}
                style={{ background: fresh.has(t.trade_id) ? "#e6ffe6" : "none" }}>
              <td>{t.trade_id}</td>
              <td>{t.client}</td>
              <td>{t.symbol}</td>
              <td>{t.quantity}</td>
              <td>{t.price}</td>
              <td>{t.timestamp}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}