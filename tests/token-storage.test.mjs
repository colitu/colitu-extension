// The sign-in tokens live in session memory, not on disk; only the opt-in
// "keep me signed in" leaves the refresh token (never the access token) in
// storage.local, and a browser restart (empty session memory) then still
// finds it.
import assert from "node:assert/strict";
import { test } from "node:test";

const area = (o) => ({
  get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in o).map((x) => [x, structuredClone(o[x])])),
  set: async (v) => Object.assign(o, structuredClone(v)),
  remove: async (k) => [].concat(k).forEach((x) => delete o[x]),
});

let local;
let memory;
function fresh({ session = true } = {}) {
  local = {};
  memory = {};
  // The same chrome object for good (store.js keeps it from import time); only its areas change.
  globalThis.chrome.storage.local = area(local);
  if (session) globalThis.chrome.storage.session = area(memory);
  else delete globalThis.chrome.storage.session;
}

globalThis.chrome = { storage: {} };

fresh();
const store = await import("../src/lib/store.js");
const tokens = { access: "A1", refresh: "R1", accessExp: 123 };
const identity = { email: "a@b.test", deviceId: "dev1" };

test("tokens go to session memory, the rest of the sign-in to disk", async () => {
  fresh();
  await store.save({ auth: { ...identity, ...tokens } });
  assert.deepEqual(local.auth, identity);
  assert.deepEqual(memory.authTokens, tokens);
  const { auth } = await store.load(["auth"]);
  assert.deepEqual(auth, { ...identity, ...tokens });
});

test("a browser restart (empty session memory) leaves no refresh token", async () => {
  fresh();
  await store.save({ auth: { ...identity, ...tokens } });
  for (const k of Object.keys(memory)) delete memory[k];
  const { auth } = await store.load(["auth"]);
  assert.equal(auth.refresh, undefined);
  assert.equal(auth.deviceId, "dev1");
});

test("keepSignedIn: the refresh token (not the access token) survives a restart", async () => {
  fresh();
  local.settings = { keepSignedIn: true };
  await store.save({ auth: { ...identity, ...tokens } });
  assert.deepEqual(local.auth, { ...identity, refresh: "R1" });
  for (const k of Object.keys(memory)) delete memory[k];
  const { auth } = await store.load(["auth"]);
  assert.equal(auth.refresh, "R1");
  assert.equal(auth.access, undefined);
  // A rotation writes the new refresh token to both places.
  await store.save({ auth: { ...auth, access: "A2", refresh: "R2", accessExp: 456 } });
  assert.equal(local.auth.refresh, "R2");
  assert.equal(memory.authTokens.refresh, "R2");
});

test("switching keepSignedIn moves the refresh token on or off the disk", async () => {
  fresh();
  await store.save({ auth: { ...identity, ...tokens } });
  assert.equal(local.auth.refresh, undefined);
  local.settings = { keepSignedIn: true };
  await store.applyKeepSignedIn();
  assert.equal(local.auth.refresh, "R1");
  local.settings = { keepSignedIn: false };
  await store.applyKeepSignedIn();
  assert.equal(local.auth.refresh, undefined);
  assert.equal(memory.authTokens.refresh, "R1");
});

test("tokens written to disk by 1.4.1 and older move to session memory", async () => {
  fresh();
  local.auth = { ...identity, ...tokens };
  // Before the migration (e.g. a popup read) the disk copy still works.
  assert.equal((await store.load(["auth"])).auth.refresh, "R1");
  await store.migrateAuth();
  assert.deepEqual(local.auth, identity);
  assert.deepEqual(memory.authTokens, tokens);
  assert.equal((await store.load(["auth"])).auth.refresh, "R1");
});

test("newer tokens in session memory win over an old disk copy", async () => {
  fresh();
  local.auth = { ...identity, access: "old", refresh: "Rold", accessExp: 1 };
  memory.authTokens = { access: "A9", refresh: "R9", accessExp: 9 };
  await store.migrateAuth();
  assert.deepEqual(local.auth, identity);
  assert.equal(memory.authTokens.refresh, "R9");
});

test("signing out removes the tokens from both places", async () => {
  fresh();
  await store.save({ auth: { ...identity, ...tokens } });
  await store.remove(["auth", "session"]);
  assert.equal(local.auth, undefined);
  assert.equal(memory.authTokens, undefined);
});

test("without storage.session the tokens stay on disk, as before", async () => {
  fresh({ session: false });
  await store.save({ auth: { ...identity, ...tokens } });
  assert.deepEqual(local.auth, { ...identity, ...tokens });
  assert.deepEqual((await store.load(["auth"])).auth, { ...identity, ...tokens });
});
