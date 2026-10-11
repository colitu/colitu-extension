// In-app NPS survey (GET/POST /client/survey). The popup asks the background,
// which checks the API at most once a day; only the "nps" kind is shown and
// answered, any other kind the API may hand out is ignored.

import { load, save } from "./store.js";

export const CHECK_INTERVAL_MS = 24 * 3600 * 1000;
// After a failed check, try again in an hour.
const RETRY_MS = 3600 * 1000;

// parseSurvey: the API answer -> "nps" or null.
export function parseSurvey(data) {
  return data && data.survey && typeof data.survey === "object" && data.survey.kind === "nps" ? "nps" : null;
}

export function isDue(checkedAt, now = Date.now()) {
  return typeof checkedAt !== "number" || checkedAt > now || now - checkedAt >= CHECK_INTERVAL_MS;
}

// Request bodies of POST /client/survey.
export function answerBody(score, platform) {
  const n = typeof score === "string" && score.trim() !== "" ? Number(score) : score;
  if (!Number.isInteger(n) || n < 0 || n > 10) throw new RangeError("score must be 0-10");
  return { kind: "nps", score: n, dismissed: false, platform };
}

export function dismissBody(platform) {
  return { kind: "nps", dismissed: true, platform };
}

let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

// pending returns "nps" when a survey should be shown now. `fetchSurvey()`
// returns the raw API answer and may throw (an older panel, offline).
export function pending({ fetchSurvey, now = Date.now() }) {
  return serial(async () => {
    const { survey } = await load(["survey"]);
    const state = survey && typeof survey === "object" ? survey : {};
    if (!isDue(state.checkedAt, now)) return state.pending === "nps" ? "nps" : null;
    try {
      const kind = parseSurvey(await fetchSurvey());
      await save({ survey: { checkedAt: now, pending: kind } });
      return kind;
    } catch {
      await save({ survey: { checkedAt: now - CHECK_INTERVAL_MS + RETRY_MS, pending: null } });
      return null;
    }
  });
}

// settle clears the pending survey after it was answered or closed.
export function settle() {
  return serial(async () => {
    const { survey } = await load(["survey"]);
    await save({ survey: { ...(survey || {}), pending: null } });
  });
}

// answer / dismiss POST the result. A 4xx means the survey is gone for good;
// anything else keeps it pending so the user can try again.
async function send(body, post) {
  try {
    await post(body);
  } catch (err) {
    if (!(err && err.status >= 400 && err.status < 500 && err.status !== 429)) throw err;
  }
  await settle();
}

export function answer({ score, platform, post }) {
  return send(answerBody(score, platform), post);
}

export function dismiss({ platform, post }) {
  return send(dismissBody(platform), post);
}
