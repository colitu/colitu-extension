// NPS survey and the invite card.
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

const survey = await import("../src/lib/survey.js");
const { parseReferral } = await import("../src/lib/referral.js");

const NOW = Date.UTC(2026, 9, 11, 12);
const DAY = 24 * 3600 * 1000;

beforeEach(() => {
  for (const k of Object.keys(stored)) delete stored[k];
});

test("request bodies", () => {
  assert.deepEqual(survey.answerBody(9, "chrome"), { kind: "nps", score: 9, dismissed: false, platform: "chrome" });
  assert.deepEqual(survey.answerBody("0", "firefox"), { kind: "nps", score: 0, dismissed: false, platform: "firefox" });
  assert.deepEqual(survey.dismissBody("firefox"), { kind: "nps", dismissed: true, platform: "firefox" });
  for (const bad of [-1, 11, 5.5, "x", null, undefined]) assert.throws(() => survey.answerBody(bad, "chrome"), RangeError, String(bad));
});

test("only the nps kind is shown; other kinds are ignored", () => {
  assert.equal(survey.parseSurvey({ survey: { kind: "nps" } }), "nps");
  for (const other of ["csat", "pmf", "churn"]) assert.equal(survey.parseSurvey({ survey: { kind: other, conversation_id: "x" } }), null);
  for (const none of [{ survey: null }, {}, null, undefined, { survey: "nps" }]) assert.equal(survey.parseSurvey(none), null);
});

test("the API is asked at most once a day", async () => {
  let calls = 0;
  const fetchSurvey = async () => (calls++, { survey: { kind: "nps" } });
  assert.equal(await survey.pending({ fetchSurvey, now: NOW }), "nps");
  assert.equal(await survey.pending({ fetchSurvey, now: NOW + 3600000 }), "nps"); // still pending: from storage
  assert.equal(calls, 1);
  await survey.settle();
  assert.equal(await survey.pending({ fetchSurvey, now: NOW + 3600000 }), null);
  assert.equal(calls, 1);
  assert.equal(await survey.pending({ fetchSurvey, now: NOW + DAY + 1 }), "nps");
  assert.equal(calls, 2);
});

test("a csat or failed answer shows nothing; a failed check is retried in an hour", async () => {
  assert.equal(await survey.pending({ fetchSurvey: async () => ({ survey: { kind: "csat" } }), now: NOW }), null);
  delete stored.survey;
  let calls = 0;
  const failing = async () => {
    calls++;
    throw Object.assign(new Error("404"), { status: 404 });
  };
  assert.equal(await survey.pending({ fetchSurvey: failing, now: NOW }), null);
  assert.equal(await survey.pending({ fetchSurvey: failing, now: NOW + 30 * 60000 }), null);
  assert.equal(calls, 1);
  assert.equal(await survey.pending({ fetchSurvey: failing, now: NOW + 61 * 60000 }), null);
  assert.equal(calls, 2);
});

test("answering and closing post the right body", async () => {
  const bodies = [];
  const post = async (b) => bodies.push(b);
  await survey.answer({ score: 8, platform: "chrome", post });
  await survey.dismiss({ platform: "firefox", post });
  assert.deepEqual(bodies, [
    { kind: "nps", score: 8, dismissed: false, platform: "chrome" },
    { kind: "nps", dismissed: true, platform: "firefox" },
  ]);
});

test("a network failure keeps the survey pending, a 4xx closes it", async () => {
  stored.survey = { checkedAt: NOW, pending: "nps" };
  await assert.rejects(survey.answer({ score: 5, platform: "chrome", post: async () => { throw Object.assign(new Error("x"), { status: 0 }); } }));
  assert.equal(stored.survey.pending, "nps");
  await assert.rejects(survey.dismiss({ platform: "chrome", post: async () => { throw Object.assign(new Error("x"), { status: 503 }); } }));
  assert.equal(stored.survey.pending, "nps");
  await survey.answer({ score: 5, platform: "chrome", post: async () => { throw Object.assign(new Error("x"), { status: 400 }); } });
  assert.equal(stored.survey.pending, null);
});

test("invite card: numbers and link only; hidden when off", () => {
  const card = parseReferral({ data: { code: "AB12", link: "https://colitu.com/r/AB12", enabled: true, invitee_days: 7, reward_days: 14, monthly_cap: 5, invited: 4, pending: 1, rewarded: 2, rejected: 1, days_earned: 28, rewarded_this_month: 2, recent: [{ status: "pending" }] } });
  assert.deepEqual(card, { link: "https://colitu.com/r/AB12", inviteeDays: 7, rewardDays: 14, invited: 4, valid: 2, daysEarned: 28 });
  assert.equal(parseReferral({ data: { code: "AB12", link: "https://colitu.com/r/AB12", enabled: false } }), null);
  assert.equal(parseReferral({ data: { link: "https://evil.example/r/x", enabled: true } }), null);
  assert.equal(parseReferral({ data: { link: "javascript:alert(1)", enabled: true } }), null);
  assert.equal(parseReferral({}), null);
  assert.equal(parseReferral(null), null);
});
