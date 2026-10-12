// Server names in the extension language (lib/servernames.js).
import assert from "node:assert/strict";
import { test } from "node:test";

const { cityName, displayName, routeName, countryCodeFor } = await import("../src/lib/servernames.js");

test("display names: country and suffix in the chosen language", () => {
  assert.equal(displayName("Letonya (Köprü)", "en"), "Latvia (Bridge)");
  assert.equal(displayName("Letonya (Köprü)", "ru"), "Латвия (Мост)");
  assert.equal(displayName("Letonya (Köprü)", "tr"), "Letonya (Köprü)");
  assert.equal(displayName("ALMANYA", "en"), "Germany");
  assert.equal(displayName("LV (Test)", "ru", "LV"), "Латвия (Test)");
  assert.equal(countryCodeFor("İngiltere"), "GB");
});

test("cities: case- and diacritic-insensitive, aliases too", () => {
  assert.equal(cityName("Londra", "en"), "London");
  assert.equal(cityName("LONDRA", "ru"), "Лондон");
  assert.equal(cityName("Varsova", "en"), "Warsaw");
  assert.equal(cityName("Almatı", "ru"), "Алматы");
  assert.equal(cityName("Sao Paulo", "tr"), "São Paulo");
  assert.equal(cityName("İstanbul", "en"), "Istanbul");
  assert.equal(cityName("Лондон", "tr"), "Londra");
});

test("unknown text stays exactly as the panel sent it", () => {
  for (const lang of ["en", "ru", "tr"]) {
    assert.equal(displayName("Codex staging Docker node", lang), "Codex staging Docker node");
    assert.equal(cityName("Codex staging Docker node", lang), "Codex staging Docker node");
  }
  assert.equal(cityName("", "en"), "");
  assert.equal(cityName(undefined, "en"), "");
});

test("route names: each end", () => {
  assert.equal(routeName("Varşova → Frankfurt", "en"), "Warsaw → Frankfurt");
});
