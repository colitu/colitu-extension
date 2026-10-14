// E4-01: when no ticket can be fetched after a restart, traffic stays held
// back (never direct), the badge says "connecting" instead of a country, and
// the ticket is asked for again with a backoff (15 s, 30 s, 1 min, 2 min,
// then every 5 min) instead of only every 30 minutes.
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

// Long timers (the retry timer, request timeouts) never fire in this test:
// the retries are driven through the alarm, as after a worker restart.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (fn, ms, ...args) => (ms >= 10e3 ? { fake: true } : realSetTimeout(fn, ms, ...args));
globalThis.clearTimeout = (id) => (id && id.fake ? undefined : realClearTimeout(id));

const servers = [{ id: "fi", name: "Helsinki", country: "fi", city: "Helsinki", host: "fi.example.test", port: 2083, load: "low" }];
const rules = { servers: ["fi.example.test"], bypass: [], bypassNets: [], only: [], onlyNets: [], mode: "all", ruDirect: false, api: ["api.colitu.com"] };
const jwt = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url")}.y`;
const local = {
  auth: { access: jwt, refresh: "r", accessExp: Date.now() + 600e3, deviceId: "dev1", email: "a@b.test" },
  connection: { on: true, serverId: "fi", current: { id: "fi", name: "Helsinki", country: "fi", city: "Helsinki" }, chain: [{ host: "fi.example.test", port: 2083 }], rules, since: 1 },
  session: { servers, expiresAt: Date.now() + 3600e3, refreshAt: Date.now() + 3600e3, plan: null, fetchedAt: 1 },
  settings: { autoConnect: true, stats: false },
};
const memory = {};
const area = (o) => ({
  get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in o).map((x) => [x, structuredClone(o[x])])),
  set: async (v) => Object.assign(o, structuredClone(v)),
  remove: async (k) => [].concat(k).forEach((x) => delete o[x]),
});
const ev = () => ({ addListener() {} });
let onStartup;
let onAlarm;
let onMessage;
let proxyValue = null;
let badge = "";
let badgeTitle = "";
const alarms = new Map();
globalThis.chrome = {
  storage: { local: area(local), session: area(memory) },
  runtime: {
    getManifest: () => ({ version: "1.4.1" }),
    getURL: (p) => `chrome-extension://x/${p}`,
    onMessage: { addListener: (f) => (onMessage = f) },
    onStartup: { addListener: (f) => (onStartup = f) },
    onInstalled: ev(),
  },
  webRequest: { onAuthRequired: ev() },
  proxy: {
    onProxyError: ev(),
    settings: {
      get: async () => ({ levelOfControl: "controllable_by_this_extension" }),
      set: async ({ value }) => (proxyValue = value),
      clear: async () => (proxyValue = null),
    },
  },
  alarms: {
    onAlarm: { addListener: (f) => (onAlarm = f) },
    create: (name, info) => alarms.set(name, info),
    clear: async (name) => alarms.delete(name),
    get: async () => null,
  },
  action: {
    setIcon: async () => {},
    setBadgeText: async ({ text }) => (badge = text),
    setBadgeBackgroundColor: async () => {},
    setTitle: async ({ title }) => (badgeTitle = title),
  },
  extension: { isAllowedIncognitoAccess: async () => false },
  privacy: { network: { webRTCIPHandlingPolicy: { set: async () => {}, clear: async () => {} } } },
  i18n: { getUILanguage: () => "en" },
  tabs: { create() {} },
};

function pac(host) {
  if (!proxyValue) return "DIRECT (no proxy setting)";
  const ctx = vm.createContext({});
  vm.runInContext(proxyValue.pacScript.data, ctx);
  return vm.runInContext(`FindProxyForURL("https://x/", ${JSON.stringify(host)})`, ctx);
}

let apiUp = false;
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.hostname !== "api.colitu.com" || !apiUp) throw new Error("offline");
  if (u.pathname.endsWith("/webproxy/session")) {
    return new Response(JSON.stringify({ ticket: "v1.new", expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), refresh_after: 3600, servers, plan: null }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
};

const settle = (ms = 60) => new Promise((r) => realSetTimeout(r, ms));
const send = (msg) => new Promise((res) => onMessage(msg, {}, res));
const nextWait = () => {
  const a = alarms.get("colitu-ticket");
  return a ? Math.round((a.when - Date.now()) / 1000) : null;
};

await import("../src/background.js");
await settle();

test("held back after a restart: badge and popup say connecting, nothing goes direct", async () => {
  assert.equal(pac("example.com"), "HTTPS 127.0.0.1:9");
  assert.equal(badge, "…");
  assert.match(badgeTitle, /connecting/);
  const state = (await send({ cmd: "state" })).value;
  assert.equal(state.connection.on, true);
  assert.equal(state.holding, true);
});

test("no ticket: retries back off 15 s, 30 s, 1, 2, 5, 5 min (alarm at least 30 s)", async () => {
  onStartup();
  await settle(150);
  const waits = [nextWait()];
  for (let i = 0; i < 5; i++) {
    onAlarm({ name: "colitu-ticket" });
    await settle(150);
    waits.push(nextWait());
    assert.equal(pac("example.com"), "HTTPS 127.0.0.1:9", "still held back, never direct");
    assert.equal(badge, "…");
  }
  // The first step is a 15 s timer; the alarm behind it waits 30 s.
  assert.deepEqual(waits.map((w) => Math.round(w / 5) * 5), [30, 30, 60, 120, 300, 300]);
});

test("the API is back: the next try restores the chain and stops retrying", async () => {
  apiUp = true;
  onAlarm({ name: "colitu-ticket" });
  await settle(200);
  assert.equal(memory.sessionTicket, "v1.new");
  assert.equal(pac("example.com"), "HTTPS fi.example.test:2083");
  assert.equal(badge, "FI");
  assert.equal(alarms.has("colitu-ticket"), false);
  const state = (await send({ cmd: "state" })).value;
  assert.equal(state.holding, false);
});
