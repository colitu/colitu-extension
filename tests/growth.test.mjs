// Growth cards: invite card eligibility/snooze, review card after 3 days, share URLs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as g from "../src/lib/growth.js";

const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 9, 19, 12).getTime();

test("share URLs encode the link and the text", () => {
  const link = "https://colitu.com/r/AB12?x=1&y=2";
  const body = "Colitu VPN: fast & private. 7 days of Premium:";
  assert.equal(g.telegramUrl(link, body), `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(body)}`);
  assert.ok(!decodeURIComponent(g.telegramUrl(link, body).split("&text=")[1]).includes(link), "telegram text has no link");
  const wa = new URL(g.whatsappUrl(body, link));
  assert.equal(wa.origin + wa.pathname, "https://wa.me/");
  assert.equal(wa.searchParams.get("text"), `${body} ${link}`);
});

test("review pages: Firefox gets AMO, everything else the Chrome Web Store", () => {
  assert.equal(g.reviewUrl("firefox"), "https://addons.mozilla.org/firefox/addon/colitu-vpn/reviews/");
  assert.match(g.reviewUrl("chrome"), /^https:\/\/chromewebstore\.google\.com\/detail\/colitu-vpn\/kkmmfmnfmipceknpfognjhjdklnflipf\/reviews$/);
});

test("the invite card needs a first connection and is snoozed for 14 days", () => {
  let x = g.normalize(null);
  assert.equal(g.inviteCardVisible(x, true, NOW), false);
  x = g.noteConnected(x, NOW);
  assert.equal(g.inviteCardVisible(x, true, NOW), true);
  assert.equal(g.inviteCardVisible(x, false, NOW), false, "no referral programme");
  x = g.dismissInvite(x, NOW);
  assert.equal(g.inviteCardVisible(x, true, NOW + 13 * DAY), false);
  assert.equal(g.inviteCardVisible(x, true, NOW + 14 * DAY + 1), true);
});

test("days of use are distinct and capped; the review card shows after 3 and never beside the invite card", () => {
  let x = g.noteConnected(null, NOW);
  x = g.noteConnected(x, NOW + 3600000); // same day
  assert.equal(x.days.length, 1);
  x = g.noteConnected(x, NOW + DAY);
  assert.equal(g.reviewCardVisible(x, false, NOW + DAY), false);
  x = g.noteConnected(x, NOW + 2 * DAY);
  x = g.noteConnected(x, NOW + 3 * DAY);
  assert.equal(x.days.length, 3);
  assert.equal(g.reviewCardVisible(x, false, NOW), true);
  assert.equal(g.reviewCardVisible(x, true, NOW), false, "invite card wins");
  assert.equal(g.reviewCardVisible(g.dismissReview(x), false, NOW), false);
});

test("broken storage values are ignored", () => {
  for (const bad of [null, "x", 5, { days: "no", connected: "yes", inviteDismissedAt: -1, reviewDismissed: 1 }, { days: ["not a day", 7] }]) {
    assert.deepEqual(g.normalize(bad), { connected: false, days: [], inviteDismissedAt: 0, reviewDismissed: false });
  }
});

test("the popup wires the cards and the strings carry no reward wording for reviews", async () => {
  const html = readFileSync(new URL("../src/popup/popup.html", import.meta.url), "utf8");
  for (const id of ["invite-card", "review-card", "card-share-telegram", "card-share-whatsapp", "btn-share-telegram", "btn-share-whatsapp"]) assert.match(html, new RegExp(`id="${id}"`));
  const { dictionaries } = await import("../src/lib/i18n.js");
  for (const [lang, d] of Object.entries(dictionaries)) {
    assert.doesNotMatch(`${d.reviewTitle} ${d.reviewHint} ${d.reviewOpen} ${d.reviewRate}`, /premium|gün|дн|day|free|ücretsiz|бесплат/i, lang);
  }
});
