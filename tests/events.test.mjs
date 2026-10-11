// Anonymous connection events: JSON shape, queue cap, reason mapping, sending rules.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const stored = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in stored).map((k) => [k, stored[k]])),
      set: async (values) => Object.assign(stored, JSON.parse(JSON.stringify(values))),
      remove: async (keys) => [].concat(keys).forEach((k) => delete stored[k]),
    },
  },
  runtime: { getManifest: () => ({ version: "1.3.0" }) },
};

const ev = await import("../src/lib/events.js");

const N1 = "0f6d5f0e-1a2b-4c3d-8e9f-a0b1c2d3e4f5";
const N2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = Date.UTC(2026, 9, 11, 12);

beforeEach(() => {
  for (const k of Object.keys(stored)) delete stored[k];
});

test("connect, drop, probe and choice have the shape the API expects", () => {
  assert.deepEqual(ev.sanitize({ kind: "connect", node_id: N1.toUpperCase(), outcome: "ok", ms: 840.6, first_try: true, mode: "auto", extra: "x" }), {
    kind: "connect", node_id: N1, protocol: "webproxy", outcome: "ok", ms: 841, first_try: true, mode: "auto",
  });
  assert.deepEqual(ev.sanitize({ kind: "connect", node_id: N1, outcome: "fail", reason: "tls", ms: 4000, mode: "manual" }), {
    kind: "connect", node_id: N1, protocol: "webproxy", outcome: "fail", reason: "tls", ms: 4000, first_try: false, mode: "manual",
  });
  // An unknown reason becomes "other"; a successful connect carries none.
  assert.equal(ev.sanitize({ kind: "connect", node_id: N1, outcome: "fail", reason: "weird" }).reason, "other");
  assert.equal("reason" in ev.sanitize({ kind: "connect", node_id: N1, outcome: "ok", reason: "tls" }), false);
  assert.deepEqual(ev.sanitize({ kind: "drop", node_id: N1, reason: "refused", minutes: 12.4 }), {
    kind: "drop", node_id: N1, protocol: "webproxy", reason: "refused", minutes: 12,
  });
  assert.deepEqual(ev.sanitize({ kind: "probe", node_id: N1, outcome: "ok", ms: 55 }), { kind: "probe", node_id: N1, protocol: "webproxy", outcome: "ok", ms: 55 });
  assert.deepEqual(ev.sanitize({ kind: "probe", node_id: N1, outcome: "fail", reason: "timeout", ms: 4000 }), { kind: "probe", node_id: N1, protocol: "webproxy", outcome: "fail", reason: "timeout" });
  assert.deepEqual(ev.sanitize({ kind: "choice", node_id: N1, ms: 60, best_node_id: N2, best_ms: 40 }), {
    kind: "choice", node_id: N1, ms: 60, best_node_id: N2, best_ms: 40, mode: "auto",
  });
});

test("events that cannot be sent are dropped", () => {
  assert.equal(ev.sanitize({ kind: "connect", node_id: "not-a-uuid", outcome: "ok" }), null);
  assert.equal(ev.sanitize({ kind: "connect", outcome: "ok" }), null);
  assert.equal(ev.sanitize({ kind: "mystery", node_id: N1 }), null);
  assert.equal(ev.sanitize({ kind: "choice", node_id: N1, ms: 60 }), null);
  assert.equal(ev.sanitize(null), null);
});

test("no event carries anything but the allowed fields", () => {
  const allowed = new Set(["kind", "node_id", "protocol", "outcome", "reason", "ms", "first_try", "mode", "minutes", "best_node_id", "best_ms"]);
  for (const e of [
    { kind: "connect", node_id: N1, outcome: "ok", ms: 1, ip: "1.2.3.4", url: "https://x", email: "a@b" },
    { kind: "drop", node_id: N1, host: "example.com" },
    { kind: "probe", node_id: N1, outcome: "ok", ms: 1, token: "t" },
  ]) {
    for (const key of Object.keys(ev.sanitize(e))) assert.ok(allowed.has(key), key);
  }
});

test("the queue keeps the newest 500 events", () => {
  let queue = [];
  for (let i = 0; i < 520; i++) queue = ev.addToQueue(queue, { kind: "drop", node_id: N1, reason: "other", minutes: i });
  assert.equal(queue.length, 500);
  assert.equal(queue[0].minutes, 20);
  assert.equal(queue.at(-1).minutes, 519);
});

test("a probe replaces the earlier queued probe of the same server", () => {
  let queue = [];
  queue = ev.addToQueue(queue, { kind: "probe", node_id: N1, outcome: "ok", ms: 50 });
  queue = ev.addToQueue(queue, { kind: "probe", node_id: N2, outcome: "ok", ms: 70 });
  queue = ev.addToQueue(queue, { kind: "probe", node_id: N1, outcome: "ok", ms: 55 });
  assert.deepEqual(queue.map((e) => [e.node_id, e.ms]), [[N2, 70], [N1, 55]]);
});

test("proxy errors map to reasons (Chrome and Firefox names)", () => {
  const cases = {
    ERR_CONNECTION_TIMED_OUT: "timeout", NS_ERROR_NET_TIMEOUT: "timeout", timeout: "timeout",
    ERR_CONNECTION_RESET: "reset", ERR_EMPTY_RESPONSE: "reset", NS_ERROR_NET_RESET: "reset",
    ERR_PROXY_CERTIFICATE_INVALID: "tls", ERR_SSL_PROTOCOL_ERROR: "tls", SEC_ERROR_UNKNOWN_ISSUER: "tls",
    ERR_NAME_NOT_RESOLVED: "dns", NS_ERROR_UNKNOWN_PROXY_HOST: "dns",
    ERR_PROXY_CONNECTION_FAILED: "refused", ERR_CONNECTION_REFUSED: "refused", NS_ERROR_PROXY_CONNECTION_REFUSED: "refused",
    "The proxy server is refusing connections": "refused",
    ERR_PROXY_AUTH_UNSUPPORTED: "auth", NS_ERROR_PROXY_AUTHENTICATION_FAILED: "auth",
    ERR_ACCESS_DENIED: "blocked", NS_ERROR_PROXY_FORBIDDEN: "blocked",
    ERR_INTERNET_DISCONNECTED: "other", "": "other",
  };
  for (const [error, reason] of Object.entries(cases)) assert.equal(ev.mapReason(error), reason, error);
  assert.equal(ev.mapReason({ code: "NETWORK", message: "timeout" }), "timeout");
  assert.equal(ev.mapReason(undefined), "other");
  for (const r of Object.values(cases)) assert.ok(ev.REASONS.includes(r));
});

test("only proxy-level errors count as the proxy failing", () => {
  assert.equal(ev.isProxyFailure("net::ERR_PROXY_CONNECTION_FAILED"), true);
  assert.equal(ev.isProxyFailure("The proxy server is refusing connections"), true);
  assert.equal(ev.isProxyFailure("net::ERR_TUNNEL_CONNECTION_FAILED"), false);
  assert.equal(ev.isProxyFailure("net::ERR_CONNECTION_TIMED_OUT"), false);
});

test("the report body", () => {
  const events = Array.from({ length: 450 }, () => ev.sanitize({ kind: "drop", node_id: N1, reason: "other", minutes: 1 }));
  const body = ev.buildPayload({ platform: "firefox", appVersion: "1.3.0", networkToken: "tok", events });
  assert.deepEqual(Object.keys(body), ["platform", "app_version", "network_token", "network_type", "events"]);
  assert.equal(body.platform, "firefox");
  assert.equal(body.app_version, "1.3.0");
  assert.equal(body.network_token, "tok");
  assert.equal(body.network_type, "");
  assert.equal(body.events.length, 300);
  assert.equal(ev.buildPayload({ platform: "chrome", appVersion: "1", events: [] }).network_token, "");
});

const queueOf = (n) => Array.from({ length: n }, (_, i) => ev.sanitize({ kind: "drop", node_id: N1, reason: "other", minutes: i }));
const send = (post, extra = {}) => ev.flush({ enabled: true, post, platform: "chrome", appVersion: "1.3.0", networkToken: "tok", now: NOW, ...extra });
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

test("nothing is queued while the switch is off", async () => {
  await ev.record({ kind: "drop", node_id: N1, reason: "other", minutes: 1 }, false);
  assert.equal((await ev.queued()).length, 0);
  await ev.record({ kind: "drop", node_id: N1, reason: "other", minutes: 1 }, true);
  assert.equal((await ev.queued()).length, 1);
});

test("202 clears what was sent (300 at a time), the rest waits for the next hour", async () => {
  stored.acQueue = queueOf(350);
  const bodies = [];
  assert.equal(await send(async (b) => bodies.push(b)), "sent");
  assert.equal(bodies[0].events.length, 300);
  assert.equal(stored.acQueue.length, 50);
  assert.equal(stored.acQueue[0].minutes, 300);
  assert.equal(await send(async (b) => bodies.push(b), { now: NOW + 30 * 60000 }), "wait");
  assert.equal(bodies.length, 1);
  assert.equal(await send(async (b) => bodies.push(b), { now: NOW + 61 * 60000 }), "sent");
  assert.equal(stored.acQueue.length, 0);
});

test("429, 5xx and network errors keep the queue", async () => {
  for (const status of [429, 500, 503, 0]) {
    stored.acQueue = queueOf(5);
    delete stored.acSentAt;
    assert.equal(await send(async () => { throw httpError(status); }), "kept", String(status));
    assert.equal(stored.acQueue.length, 5);
    assert.equal(stored.acSentAt, undefined);
  }
});

test("400 drops the rejected events", async () => {
  stored.acQueue = queueOf(5);
  assert.equal(await send(async () => { throw httpError(400); }), "dropped");
  assert.equal(stored.acQueue.length, 0);
});

test("an empty queue sends nothing; turning the switch off clears the queue", async () => {
  let calls = 0;
  assert.equal(await send(async () => calls++), "empty");
  stored.acQueue = queueOf(3);
  stored.acSentAt = NOW;
  assert.equal(await send(async () => calls++, { enabled: false }), "disabled");
  assert.equal(stored.acQueue, undefined);
  assert.equal(stored.acSentAt, undefined);
  assert.equal(calls, 0);
  stored.acQueue = queueOf(3);
  await ev.clear();
  assert.equal((await ev.queued()).length, 0);
});

test("the network token is read only when a report goes out", async () => {
  let reads = 0;
  const token = async () => (reads++, "tok-from-api");
  await send(async () => {}, { networkToken: token }); // empty queue
  assert.equal(reads, 0);
  stored.acQueue = queueOf(1);
  const bodies = [];
  await send(async (b) => bodies.push(b), { networkToken: token });
  assert.equal(reads, 1);
  assert.equal(bodies[0].network_token, "tok-from-api");
});
