// Thin wrapper over extension storage (local: survives restarts; session: memory only).
import { ext, TARGET } from "./target.js";
import { migrateSplit, SPLIT_MODES } from "./routing.js";

// The proxy ticket of the session is kept apart from the rest of it: in
// storage.session (memory only, gone when the browser closes; it outlives a
// suspended service worker), never on disk. A copied browser profile or a
// disk backup therefore holds no ticket that works on the proxies. After a
// browser restart the extension asks the API for a new one (startup and
// proxyCredentials in background.js); until then proxied requests fail
// instead of going out directly.
//
// The sign-in tokens (access + refresh) are kept the same way, under
// "authTokens" in storage.session, and not in storage.local: a copied browser
// profile or a disk backup then holds no token that can be refreshed. What
// stays on disk is the rest of "auth" (e-mail, device id, app version).
//
// Trade-off: storage.session is emptied when the browser closes, so by
// default a browser restart asks the user to sign in again (the refresh token
// is gone; background.js refreshSession ends in the SESSION_EXPIRED sign-out,
// and the device slot is reused through the stored device key). The opt-in
// setting "keepSignedIn" ("Stay signed in after the browser restarts") also
// keeps the refresh token (never the access token) on disk, as 1.4.1 and
// older did, for users who accept that. Either way the refresh token is
// rotated on every use (a stolen, already-used copy ends the whole session:
// AUTH_REFRESH_REUSED), bound to this device id, revoked on sign-out, and only
// Colitu's own pages can read the storage (no content scripts, no external
// messaging). Where storage.session does not exist or fails (very old
// browsers) the tokens stay in storage.local, so signing in still works.
const TICKET = "sessionTicket";
const AUTH_TOKENS = "authTokens";
const TOKEN_FIELDS = ["access", "refresh", "accessExp"];
let ticketMemory = ""; // when storage.session is missing (very old browsers)

function sessionArea() {
  return ext.storage && ext.storage.session;
}

async function readTicket() {
  const area = sessionArea();
  if (!area) return ticketMemory;
  try {
    const got = await area.get(TICKET);
    return (got && typeof got[TICKET] === "string" && got[TICKET]) || "";
  } catch {
    return "";
  }
}

async function writeTicket(ticket) {
  const value = typeof ticket === "string" ? ticket : "";
  ticketMemory = value;
  const area = sessionArea();
  if (!area) return;
  try {
    if (value) await area.set({ [TICKET]: value });
    else await area.remove(TICKET);
  } catch {
    // The memory copy above still serves this worker.
  }
}

// --- sign-in tokens ----------------------------------------------------------

async function keepSignedIn() {
  try {
    const { settings } = await ext.storage.local.get(["settings"]);
    return Boolean(settings && settings.keepSignedIn);
  } catch {
    return false;
  }
}

async function readTokens() {
  const area = sessionArea();
  if (!area) return null;
  try {
    const got = await area.get(AUTH_TOKENS);
    const tokens = got && got[AUTH_TOKENS];
    return tokens && typeof tokens === "object" && !Array.isArray(tokens) ? tokens : null;
  } catch {
    return null;
  }
}

function splitAuth(auth) {
  const tokens = {};
  const rest = {};
  for (const [key, value] of Object.entries(auth)) (TOKEN_FIELDS.includes(key) ? tokens : rest)[key] = value;
  return { tokens, rest };
}

// diskAuth: what of [auth] goes to storage.local. The tokens go to session
// memory; only the refresh token may also stay on disk, when the user chose
// to stay signed in. If session memory cannot be written, everything stays on
// disk (as before) so the sign-in is not lost.
async function diskAuth(auth) {
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return auth;
  const area = sessionArea();
  if (!area) return auth;
  const { tokens, rest } = splitAuth(auth);
  try {
    if (Object.keys(tokens).length) await area.set({ [AUTH_TOKENS]: tokens });
    else await area.remove(AUTH_TOKENS);
  } catch {
    return auth;
  }
  if (tokens.refresh && (await keepSignedIn())) rest.refresh = tokens.refresh;
  return rest;
}

// withTokens: the stored "auth" with the tokens of session memory put back.
// Without them (browser restarted) a refresh token left on disk (stay signed
// in, or written by 1.4.1 and older) is what the caller gets; it never comes
// with an access token, so the first call refreshes.
async function withTokens(auth) {
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return auth;
  const tokens = await readTokens();
  return tokens ? { ...auth, ...tokens } : auth;
}

// migrateAuth moves tokens that 1.4.1 and older kept on disk to session
// memory (the refresh token stays on disk only with "keepSignedIn"). The
// background calls it once at start, before anything else reads or writes
// the session, like migrateTicket.
export async function migrateAuth() {
  const { auth } = await ext.storage.local.get(["auth"]);
  if (!auth || typeof auth !== "object" || !sessionArea()) return;
  if (!TOKEN_FIELDS.some((k) => k in auth)) return;
  // Session memory may already hold newer tokens (an extension update keeps
  // it): those win, the disk copy is only cleaned.
  const merged = await withTokens(auth);
  const disk = await diskAuth(merged);
  if (disk !== merged) await ext.storage.local.set({ auth: disk });
}

// applyKeepSignedIn rewrites the stored sign-in after the setting changed:
// on puts the refresh token on disk, off removes it from there.
export async function applyKeepSignedIn() {
  const { auth } = await load(["auth"]);
  if (auth && typeof auth === "object") await save({ auth });
}

const wants = (keys, key) => keys === null || keys === undefined || [].concat(keys).includes(key);

// migrateTicket moves a ticket that 1.4.0 kept on disk to session memory.
// The background calls it once at start, before any other read or write of
// the session, so it cannot race a session refresh.
export async function migrateTicket() {
  const { session } = await ext.storage.local.get(["session"]);
  if (!session || typeof session !== "object" || !session.ticket) return;
  const { ticket, ...rest } = session;
  await writeTicket(ticket);
  await ext.storage.local.set({ session: rest });
}

export async function load(keys) {
  const data = await ext.storage.local.get(keys);
  if (wants(keys, "session") && data && data.session && typeof data.session === "object") {
    const { ticket: stored, ...rest } = data.session;
    if (stored) {
      // Written by 1.4.0 or older: move the ticket off the disk.
      await writeTicket(stored);
      await ext.storage.local.set({ session: rest });
    }
    data.session = { ...rest, ticket: stored || (await readTicket()) };
  }
  if (wants(keys, "auth") && data) data.auth = await withTokens(data.auth);
  return data;
}

export async function save(values) {
  if (values && values.auth && typeof values.auth === "object") {
    values = { ...values, auth: await diskAuth(values.auth) };
  }
  if (values && values.session && typeof values.session === "object") {
    const { ticket, ...rest } = values.session;
    await writeTicket(ticket);
    return ext.storage.local.set({ ...values, session: rest });
  }
  return ext.storage.local.set(values);
}

export async function remove(keys) {
  if (wants(keys, "session")) await writeTicket("");
  if (wants(keys, "auth")) {
    const area = sessionArea();
    if (area) await area.remove(AUTH_TOKENS).catch(() => {});
  }
  return ext.storage.local.remove(keys);
}

export const DEFAULT_SETTINGS = Object.freeze({
  webrtc: true,
  // Off by default: a direct .ru/.su/.рф request shows those sites (and the
  // ISP) the real IP address; users who need it turn it on in settings.
  ruDirect: false,
  autoConnect: true,
  // Keep the refresh token on disk, so a browser restart does not ask to sign
  // in again (see the comment at the top). Off: tokens live in session memory only.
  keepSignedIn: false,
  // Kill switch: when the connection drops by itself (plan ended, signed
  // out, device limit), block browser traffic instead of letting it out
  // directly. Off by default.
  killSwitch: false,
  // Split tunneling: "off", "bypass" (listed sites skip Colitu) or "only"
  // (only listed sites use Colitu); splitList is the user's text.
  split: "off",
  splitList: "",
  language: "auto",
  // Usage statistics (events.js). Chrome: on, with the
  // explanation in settings. Firefox: off until the user turns it on (it is
  // optional data-collection permissions there, events.STATS_DATA_COLLECTION).
  stats: TARGET === "chrome",
});

export async function settings() {
  const { settings: stored } = await load(["settings"]);
  const merged = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  // 1.0.0 kept a mode and two site lists; read them as split tunneling.
  if (stored && stored.split === undefined) Object.assign(merged, migrateSplit(stored));
  if (!SPLIT_MODES.includes(merged.split)) merged.split = "off";
  delete merged.mode;
  delete merged.bypass;
  delete merged.only;
  return merged;
}
