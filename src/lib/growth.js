// Growth cards in the popup: the invite card (after the first connection, 14
// days snooze) and the store review card (after 3 days of use). Only counters
// and timestamps are kept, in storage.local under "growth". No reward is ever
// tied to a review.

export const STORAGE_KEY = "growth";
export const INVITE_SNOOZE_MS = 14 * 24 * 3600 * 1000;
export const REVIEW_DAYS = 3;

export const REVIEW_URLS = {
  firefox: "https://addons.mozilla.org/firefox/addon/colitu-vpn/reviews/",
  chrome: "https://chromewebstore.google.com/detail/colitu-vpn/kkmmfmnfmipceknpfognjhjdklnflipf/reviews",
};

const ts = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

// normalize: whatever is in storage -> a well-formed record.
export function normalize(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))].slice(0, REVIEW_DAYS) : [];
  return {
    connected: r.connected === true,
    days,
    inviteDismissedAt: ts(r.inviteDismissedAt),
    reviewDismissed: r.reviewDismissed === true,
  };
}

// dayKey: the local calendar day, "YYYY-MM-DD".
export function dayKey(now) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// noteConnected: the proxy is on right now. Sets the one-way "connected once"
// flag and counts the day (at most REVIEW_DAYS are kept; that is all we need).
export function noteConnected(g, now) {
  const next = normalize(g);
  next.connected = true;
  const key = dayKey(now);
  if (next.days.length < REVIEW_DAYS && !next.days.includes(key)) next.days.push(key);
  return next;
}

export function dismissInvite(g, now) {
  return { ...normalize(g), inviteDismissedAt: ts(now) || 1 };
}

export function dismissReview(g) {
  return { ...normalize(g), reviewDismissed: true };
}

// inviteCardVisible: connected at least once, the referral card is available
// and it was not snoozed in the last 14 days.
export function inviteCardVisible(g, hasInvite, now) {
  const x = normalize(g);
  if (!hasInvite || !x.connected) return false;
  return !(x.inviteDismissedAt && now - x.inviteDismissedAt < INVITE_SNOOZE_MS);
}

// reviewCardVisible: used on 3 different days, not dismissed, and never next
// to the invite card (the invite card wins while it is shown).
export function reviewCardVisible(g, inviteShown, now) {
  const x = normalize(g);
  void now;
  return !inviteShown && !x.reviewDismissed && x.days.length >= REVIEW_DAYS;
}

export function reviewUrl(target) {
  return target === "firefox" ? REVIEW_URLS.firefox : REVIEW_URLS.chrome;
}

// shareText: the translated body (ends before the link) plus the link.
export function shareText(body, link) {
  return `${body} ${link}`;
}

export function telegramUrl(link, body) {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(body)}`;
}

export function whatsappUrl(body, link) {
  return `https://wa.me/?text=${encodeURIComponent(shareText(body, link))}`;
}
