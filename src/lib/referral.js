// Invite card (GET /referral). Only numbers and the invite link are kept;
// invitees are never named by the API and nothing else is read.

import { isColituUrl } from "./api.js";

export const CACHE_MS = 10 * 60 * 1000;

const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(Math.floor(Number(v)), 1e6) : 0);

// parseReferral: the API answer -> the card for the popup, or null when the
// feature is off (enabled=false), the answer is broken or the link is not an
// https colitu.com address.
export function parseReferral(answer) {
  const d = answer && answer.data;
  if (!d || typeof d !== "object" || d.enabled === false) return null;
  const link = typeof d.link === "string" ? d.link.trim() : "";
  if (!link || !isColituUrl(link)) return null;
  return {
    link,
    inviteeDays: num(d.invitee_days),
    rewardDays: num(d.reward_days),
    invited: num(d.invited),
    valid: num(d.rewarded),
    daysEarned: num(d.days_earned),
  };
}
