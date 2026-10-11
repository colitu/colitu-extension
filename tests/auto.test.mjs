// Automatic server choice and the signup link.
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.chrome ??= { runtime: { getManifest: () => ({ version: "0" }) }, storage: { local: {} } };
const { chooseAuto, measurementState, AUTO_MAX_AGE_MS } = await import("../src/lib/auto.js");
const { registerUrl } = await import("../src/lib/api.js");

const now = Date.UTC(2026, 9, 11, 12);
const srv = (id, country, load = "low") => ({ id, name: id, country, city: "", host: `${id}.example.test`, port: 2083, load });
const rec = (ms, ageMin = 1) => ({ ms, at: now - ageMin * 60000 });

test("the signup link names the browser as its source", () => {
  assert.equal(registerUrl("chrome"), "https://app.colitu.com/register?src=extension:chrome");
  assert.equal(registerUrl("firefox"), "https://app.colitu.com/register?src=extension:firefox");
  assert.equal(registerUrl(), "https://app.colitu.com/register?src=extension:chrome"); // the source tree builds as chrome
  assert.ok(!registerUrl().includes("utm_source"));
});

test("the lowest measured latency wins", () => {
  const servers = [srv("a", "DE"), srv("b", "FI"), srv("c", "SE")];
  const pick = chooseAuto(servers, { a: rec(120), b: rec(45), c: rec(80) }, { now });
  assert.equal(pick.server.id, "b");
  assert.equal(pick.ms, 45);
  assert.equal(pick.best.id, "b");
  assert.deepEqual(pick.chain.map((s) => s.id), ["b", "c", "a"]);
});

test("Russia is never picked automatically, however fast", () => {
  const servers = [srv("ru", "RU"), srv("ru2", "ru"), srv("fi", "FI")];
  const pick = chooseAuto(servers, { ru: rec(5), ru2: rec(6), fi: rec(200) }, { now });
  assert.equal(pick.server.id, "fi");
  assert.ok(!pick.chain.some((s) => s.country.toUpperCase() === "RU"));
  assert.equal(chooseAuto([srv("ru", "RU")], { ru: rec(5) }, { now }), null);
});

test("a server whose last measurement failed is skipped", () => {
  const servers = [srv("a", "DE"), srv("b", "FI")];
  const pick = chooseAuto(servers, { a: rec(null), b: rec(300) }, { now });
  assert.equal(pick.server.id, "b");
  // Failed servers stay at the end of the failover chain, never first.
  assert.deepEqual(pick.chain.map((s) => s.id), ["b", "a"]);
  // Everything failed or unknown: still an answer (by load), failed ones last.
  const fallback = chooseAuto([srv("a", "DE"), srv("b", "FI", "high"), srv("c", "SE")], { a: rec(null), b: rec(null) }, { now });
  assert.equal(fallback.server.id, "c");
  assert.equal(fallback.ms, null);
});

test("measurements older than 6 hours do not count", () => {
  assert.equal(measurementState(rec(50, 6 * 60 + 1), now), "unknown");
  assert.equal(measurementState({ ms: 50, at: now - AUTO_MAX_AGE_MS + 1000 }, now), "ok");
  assert.equal(measurementState(undefined, now), "unknown");
  const pick = chooseAuto([srv("old", "DE"), srv("new", "FI")], { old: rec(10, 400), new: rec(90) }, { now });
  assert.equal(pick.server.id, "new");
});

test("the remembered server stays unless another is 40% and 60 ms faster", () => {
  const servers = [srv("good", "DE"), srv("fast", "FI")];
  const pick = (good, fast) => chooseAuto(servers, { good: rec(good), fast: rec(fast) }, { now, lastGood: "good" }).server.id;
  assert.equal(pick(100, 50), "good"); // 50% faster but only 50 ms
  assert.equal(pick(200, 100), "fast"); // 50% and 100 ms: switches
  assert.equal(pick(300, 200), "good"); // 100 ms but only 33%
  assert.equal(pick(500, 100), "fast");
});

test("the thresholds are inclusive", () => {
  const servers = [srv("good", "DE"), srv("fast", "FI")];
  const id = (good, fast) => chooseAuto(servers, { good: rec(good), fast: rec(fast) }, { now, lastGood: "good" }).server.id;
  assert.equal(id(150, 90), "fast"); // exactly 40% and exactly 60 ms
  assert.equal(id(150, 91), "good");
  assert.equal(id(100, 41), "good"); // 59 ms
});

test("a remembered server that is gone, failed or in Russia does not hold on", () => {
  const servers = [srv("good", "DE"), srv("fast", "FI"), srv("ru", "RU")];
  assert.equal(chooseAuto(servers, { good: rec(null), fast: rec(300) }, { now, lastGood: "good" }).server.id, "fast");
  assert.equal(chooseAuto(servers, { fast: rec(300), ru: rec(1) }, { now, lastGood: "ru" }).server.id, "fast");
  assert.equal(chooseAuto(servers, { fast: rec(300) }, { now, lastGood: "missing" }).server.id, "fast");
});
