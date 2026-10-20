// colitu.com server map -> extension: server choice and the injected content script.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { pickSiteServer } from "../src/lib/site.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const servers = [
  { id: "1", name: "Almanya", country: "DE", city: "Frankfurt" },
  { id: "2", name: "Almanya", country: "DE", city: "Nürnberg" },
  { id: "3", name: "Finlandiya", country: "FI", city: "Helsinki" },
];

test("pickSiteServer prefers the city, else the first server of the country", () => {
  assert.equal(pickSiteServer(servers, "de", "nürnberg").id, "2");
  assert.equal(pickSiteServer(servers, "DE", "  FRANKFURT ").id, "1");
  assert.equal(pickSiteServer(servers, "de", "Berlin").id, "1");
  assert.equal(pickSiteServer(servers, "de", "").id, "1");
  assert.equal(pickSiteServer(servers, "fi", "Nürnberg").id, "3");
});

test("pickSiteServer returns null when nothing matches", () => {
  assert.equal(pickSiteServer(servers, "us", ""), null);
  assert.equal(pickSiteServer([], "de", ""), null);
  assert.equal(pickSiteServer(undefined, "de", ""), null);
  assert.equal(pickSiteServer(servers, "", ""), null);
});

test("both manifests inject the site script only on colitu.com", () => {
  execFileSync(process.execPath, [join(root, "scripts", "build.mjs")], { cwd: root, stdio: "ignore" });
  for (const target of ["chrome", "firefox"]) {
    const manifest = JSON.parse(readFileSync(join(root, "dist", target, "manifest.json"), "utf8"));
    assert.equal(manifest.content_scripts.length, 1, target);
    const cs = manifest.content_scripts[0];
    assert.deepEqual(cs.matches, ["https://colitu.com/*", "https://www.colitu.com/*"], target);
    assert.deepEqual(cs.js, ["content/site.js"], target);
    assert.equal(cs.run_at, "document_idle", target);
    assert.ok(readFileSync(join(root, "dist", target, "content", "site.js"), "utf8").includes("site-connect"), target);
  }
});
