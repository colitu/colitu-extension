// Automatic server choice ("Automatic (fastest)").
//
// Latency is measured by the background (background.js, measureLatency): one
// timed no-cors HEAD request per server to the same host and port the proxy
// uses. The proxy hosts are always routed DIRECT by the extension's own
// rules (routing.js route()), so the measurement never goes through the
// proxy, also while it is on. This file only decides, from stored
// measurements, which server wins; it has no browser APIs so it is testable.

export const AUTO_MAX_AGE_MS = 6 * 3600 * 1000; // a measurement is used for 6 hours
export const AUTO_RECHECK_MS = 30 * 60 * 1000; // re-measure every 30 minutes
export const AUTO_EXCLUDED = ["RU"]; // never picked automatically (still selectable by hand)
// A remembered "last good" server is kept unless another one is at least this
// much faster, both relatively and in milliseconds.
export const SWITCH_RATIO = 0.4;
export const SWITCH_MIN_MS = 60;
export const AUTO_CHAIN = 3; // chosen server + failover servers in the PAC chain

const excluded = (s) => AUTO_EXCLUDED.includes(String(s.country || "").toUpperCase());

// record: latency[id] = { ms: number | null, at: timestamp }. null = the last
// measurement failed. Returns "ok", "failed" or "unknown" (none or too old).
export function measurementState(record, now) {
  if (!record || typeof record.at !== "number" || record.at > now + 60000 || now - record.at > AUTO_MAX_AGE_MS) return "unknown";
  return typeof record.ms === "number" && record.ms >= 0 ? "ok" : "failed";
}

const LOAD_RANK = { low: 0, medium: 1, high: 2 };

// chooseAuto: { server, ms, best, bestMs, chain } or null when nothing may be
// picked (no servers outside the excluded countries).
//   1. servers with a fresh successful measurement, lowest latency first;
//   2. otherwise servers with no fresh measurement (by load);
//   3. otherwise servers whose last measurement failed (by load) - the
//      network may simply be down, and the error will say so.
// lastGood (a server id) wins over the fastest one unless the fastest is
// >= 40% and >= 60 ms faster.
export function chooseAuto(servers, latency, { now = Date.now(), lastGood = null } = {}) {
  const pool = (servers || []).filter((s) => !excluded(s));
  if (!pool.length) return null;
  const rec = latency || {};
  const state = (s) => measurementState(rec[s.id], now);
  const ok = pool.filter((s) => state(s) === "ok").sort((a, b) => rec[a.id].ms - rec[b.id].ms || String(a.id).localeCompare(String(b.id)));
  const byLoad = (a, b) => (LOAD_RANK[a.load] ?? 0) - (LOAD_RANK[b.load] ?? 0) || String(a.id).localeCompare(String(b.id));
  const unknown = pool.filter((s) => state(s) === "unknown").sort(byLoad);
  const failed = pool.filter((s) => state(s) === "failed").sort(byLoad);

  let server;
  let best = null;
  if (ok.length) {
    best = ok[0];
    server = best;
    const good = lastGood ? ok.find((s) => s.id === lastGood) : null;
    if (good && good !== best) {
      const slower = rec[good.id].ms;
      const faster = rec[best.id].ms;
      const clearlyFaster = slower - faster >= SWITCH_MIN_MS && faster <= slower * (1 - SWITCH_RATIO);
      if (!clearlyFaster) server = good;
    }
  } else {
    server = unknown[0] || failed[0];
  }
  const rest = [...ok, ...unknown, ...failed].filter((s) => s !== server);
  return {
    server,
    ms: ok.includes(server) ? rec[server.id].ms : null,
    best,
    bestMs: best ? rec[best.id].ms : null,
    chain: [server, ...rest].slice(0, AUTO_CHAIN),
  };
}
