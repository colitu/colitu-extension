// E3-01: the proxy ticket lives in session memory only, so a browser
// restart or an extension update starts with a connection that is "on" and
// no ticket. Traffic must be held back (never direct), the API must be
// reached directly to fetch a new ticket (never through a node that would
// ask for the ticket being fetched), and the proxy chain must come back.
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

const servers = [{ id: "fi", name: "Helsinki", country: "fi", city: "Helsinki", host: "fi.example.test", port: 2083, load: "low" }];
const rules = {
  servers: ["fi.example.test"],
  bypass: [],
  bypassNets: [],
  only: [],
  onlyNets: [],
  mode: "all",
  ruDirect: false,
  api: ["api.colitu.com"],
};
const jwt = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url")}.y`;

// The disk as a browser restart leaves it: connected, a session without a
// ticket (1.4.1 never writes one there), session memory empty.
const local = {
  auth: { access: jwt, refresh: "r", accessExp: Date.now() + 600e3, deviceId: "dev1", email: "a@b.test" },
  connection: { on: true, serverId: "fi", current: { id: "fi", name: "Helsinki", country: "fi", city: "Helsinki" }, chain: [{ host: "fi.example.test", port: 2083 }], rules, since: 1 },
  session: { servers, expiresAt: Date.now() + 3600e3, refreshAt: Date.now() + 3600e3, plan: null, fetchedAt: 1 },
  settings: { autoConnect: true },
};
const memory = {};
const area = (o) => ({
  get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in o).map((x) => [x, structuredClone(o[x])])),
  set: async (v) => Object.assign(o, structuredClone(v)),
  remove: async (k) => [].concat(k).forEach((x) => delete o[x]),
});
const ev = () => ({ addListener() {} });
let onStartup;
let onAuthRequired;
let proxyValue = null;
globalThis.chrome = {
  storage: { local: area(local), session: area(memory) },
  runtime: {
    getManifest: () => ({ version: "1.4.1" }),
    getURL: (p) => `chrome-extension://x/${p}`,
    onMessage: ev(),
    onStartup: { addListener: (f) => (onStartup = f) },
    onInstalled: ev(),
  },
  webRequest: { onAuthRequired: { addListener: (f) => (onAuthRequired = f) } },
  proxy: {
    onProxyError: ev(),
    settings: {
      get: async () => ({ levelOfControl: "controllable_by_this_extension" }),
      set: async ({ value }) => (proxyValue = value),
      clear: async () => (proxyValue = null),
    },
  },
  alarms: { onAlarm: ev(), create() {}, clear() {}, get: async () => null },
  action: { setIcon: async () => {}, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
  extension: { isAllowedIncognitoAccess: async () => false },
  privacy: { network: { webRTCIPHandlingPolicy: { set: async () => {}, clear: async () => {} } } },
  i18n: { getUILanguage: () => "en" },
  tabs: { create() {} },
};

// What the browser would do with a URL under the PAC script it holds now.
function pac(host) {
  if (!proxyValue) return "DIRECT (no proxy setting)";
  const ctx = vm.createContext({});
  vm.runInContext(proxyValue.pacScript.data, ctx);
  return vm.runInContext(`FindProxyForURL("https://x/", ${JSON.stringify(host)})`, ctx);
}

// The API is reachable only directly: through a node it would need the
// ticket it is about to hand out.
const apiRoutes = [];
let sessionAnswers = 0;
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.hostname !== "api.colitu.com") throw new Error("offline"); // pings
  apiRoutes.push(pac(u.hostname));
  const path = u.pathname.replace("/api/v1", "");
  if (path === "/webproxy/session") {
    sessionAnswers++;
    return new Response(JSON.stringify({ ticket: "v1.new", expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), refresh_after: 3600, servers, plan: null }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
};

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

await import("../src/background.js");
await settle();

test("after a restart without a ticket, traffic is held back at once", () => {
  assert.equal(proxyValue && proxyValue.mode, "pac_script");
  assert.equal(proxyValue.pacScript.mandatory, true);
  assert.equal(pac("example.com"), "HTTPS 127.0.0.1:9", "held back, never direct, never ticketless to a node");
  assert.equal(pac("api.colitu.com"), "DIRECT", "the API is reachable to fetch a new ticket");
  assert.equal(pac("192.168.1.1"), "DIRECT", "local addresses as with the kill switch");
});

test("startup fetches a ticket directly and puts the proxy chain back", async () => {
  onStartup();
  await settle(150);
  assert.ok(sessionAnswers >= 1);
  assert.ok(apiRoutes.length > 0);
  assert.ok(apiRoutes.every((r) => r === "DIRECT" || r.endsWith("; DIRECT")), `API routes: ${apiRoutes}`);
  assert.equal(apiRoutes[0], "DIRECT", "the ticket request itself went direct");
  assert.equal(memory.sessionTicket, "v1.new");
  assert.equal(local.session.ticket, undefined, "the ticket never sits on disk");
  assert.equal(pac("example.com"), "HTTPS fi.example.test:2083");
});

test("a proxy asking for credentials without a ticket never waits on itself", async () => {
  delete memory.sessionTicket; // as if the browser had restarted again
  sessionAnswers = 0;
  const answer = await Promise.race([
    new Promise((resolve) => onAuthRequired({ isProxy: true, challenger: { host: "fi.example.test", port: 2083 }, requestId: "r1" }, resolve)),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 1000)),
  ]);
  assert.deepEqual(answer, { cancel: true }, "answered at once, no self-wait");
  // Held back meanwhile; the new ticket brings the chain back.
  await settle(150);
  assert.equal(sessionAnswers, 1);
  assert.equal(memory.sessionTicket, "v1.new");
  assert.equal(pac("example.com"), "HTTPS fi.example.test:2083");
});

test("Firefox: a connection without a ticket holds traffic back, the API goes direct", async () => {
  const { remember, safeDecision, unreachable } = await import("../src/lib/proxy.js");
  remember(rules, [{ host: "fi.example.test", port: 2083 }], "");
  assert.deepEqual(safeDecision("https://example.com/"), unreachable());
  assert.deepEqual(safeDecision("https://api.colitu.com/api/v1/webproxy/session"), { type: "direct" });
  assert.deepEqual(safeDecision("http://192.168.1.1/"), { type: "direct" });
  remember(rules, [{ host: "fi.example.test", port: 2083 }], "v1.new");
  assert.equal(safeDecision("https://example.com/")[0].host, "fi.example.test");
});
