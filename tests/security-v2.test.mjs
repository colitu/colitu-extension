// Security test 2026-10-12 v2: EXT-02 (no local server hosts), EXT-03 (the
// proxy ticket never on disk), EXT-01 (the blocking proxy is HTTPS).
import assert from "node:assert/strict";
import { test } from "node:test";

const local = {};
const memory = {};
const area = (o) => ({
  get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in o).map((x) => [x, structuredClone(o[x])])),
  set: async (v) => Object.assign(o, structuredClone(v)),
  remove: async (k) => [].concat(k).forEach((x) => delete o[x]),
});
globalThis.chrome = {
  storage: { local: area(local), session: area(memory) },
  runtime: { getManifest: () => ({ version: "1.4.1" }) },
};

const api = await import("../src/lib/api.js");
const store = await import("../src/lib/store.js");
const { blockPacScript } = await import("../src/lib/routing.js");

test("EXT-02: local, private and link-local server hosts are refused", () => {
  for (const host of [
    "localhost", "router", "nas.local", "box.lan", "printer.home.arpa", "srv.internal", "x.localhost",
    "127.0.0.1", "127.1", "0x7f.0.0.1", "0177.0.0.1", "2130706433", "0.0.0.0",
    "10.0.0.1", "172.16.5.4", "172.31.255.255", "192.168.1.1", "100.64.0.1",
    "169.254.169.254", "192.0.0.8", "192.0.2.10", "198.18.0.1", "198.51.100.7", "203.0.113.9",
    "224.0.0.1", "255.255.255.255", "999.1.1.1",
  ]) {
    assert.equal(api.isLocalHost(host), true, host);
  }
  for (const host of ["fi.example.test", "node.example.com", "8.8.8.8", "172.32.0.1", "100.128.0.1", "1.1.1.1"]) {
    assert.equal(api.isLocalHost(host), false, host);
  }
  const good = { id: "fi", host: "fi.example.test", port: 2083 };
  const list = api.sanitizeServers([good, { ...good, id: "lan", host: "192.168.0.10" }, { ...good, id: "lo", host: "localhost" }]);
  assert.deepEqual(list.map((s) => s.id), ["fi"]);
});

test("EXT-03: the ticket goes to session memory, the rest of the session to disk", async () => {
  await store.save({ session: { ticket: "v1.t.s", servers: [], expiresAt: 1 } });
  assert.equal(local.session.ticket, undefined, "no ticket on disk");
  assert.equal(memory.sessionTicket, "v1.t.s");
  const { session } = await store.load(["session"]);
  assert.equal(session.ticket, "v1.t.s");
  assert.equal(session.expiresAt, 1);

  // A browser restart empties session memory: no ticket until a new one.
  delete memory.sessionTicket;
  assert.equal((await store.load(["session"])).session.ticket, "");

  // A ticket an older version wrote to disk is moved off it.
  local.session = { ticket: "old.ticket", servers: [] };
  assert.equal((await store.load(["session"])).session.ticket, "old.ticket");
  assert.equal(local.session.ticket, undefined);
  assert.equal(memory.sessionTicket, "old.ticket");

  // Removing the session removes the ticket too.
  await store.remove(["session"]);
  assert.equal(memory.sessionTicket, undefined);
  assert.equal(local.session, undefined);
});

test("EXT-01: the kill switch sends traffic to an HTTPS proxy, never a plain one", () => {
  const pac = blockPacScript();
  assert.match(pac, /'HTTPS 127\.0\.0\.1:9'/);
  assert.doesNotMatch(pac, /'PROXY /);
});

test("E3-04: the disk ticket of 1.4.0 is moved once, before other reads", async () => {
  local.session = { ticket: "old.ticket", servers: [], refreshAt: 5 };
  await store.migrateTicket();
  assert.equal(local.session.ticket, undefined);
  assert.equal(local.session.refreshAt, 5);
  assert.equal(memory.sessionTicket, "old.ticket");
  await store.migrateTicket(); // nothing left to move
  assert.equal(memory.sessionTicket, "old.ticket");
});
