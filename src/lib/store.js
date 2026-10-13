// Thin wrapper over extension storage (local: survives restarts).
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
// The refresh token stays in storage.local: the extension is a signed-in
// device like the apps, and the user expects it to stay signed in across
// browser restarts. It is rotated on every use (a stolen, already-used copy
// ends the whole session: AUTH_REFRESH_REUSED), bound to this device id,
// revoked on sign-out, and only Colitu's own pages can read the storage
// (no content scripts, no external messaging).
const TICKET = "sessionTicket";
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
  return data;
}

export async function save(values) {
  if (values && values.session && typeof values.session === "object") {
    const { ticket, ...rest } = values.session;
    await writeTicket(ticket);
    return ext.storage.local.set({ ...values, session: rest });
  }
  return ext.storage.local.set(values);
}

export async function remove(keys) {
  if (wants(keys, "session")) await writeTicket("");
  return ext.storage.local.remove(keys);
}

export const DEFAULT_SETTINGS = Object.freeze({
  webrtc: true,
  // Off by default: a direct .ru/.su/.рф request shows those sites (and the
  // ISP) the real IP address; users who need it turn it on in settings.
  ruDirect: false,
  autoConnect: true,
  // Kill switch: when the connection drops by itself (plan ended, signed
  // out, device limit), block browser traffic instead of letting it out
  // directly. Off by default.
  killSwitch: false,
  // Split tunneling: "off", "bypass" (listed sites skip Colitu) or "only"
  // (only listed sites use Colitu); splitList is the user's text.
  split: "off",
  splitList: "",
  language: "auto",
  // Anonymous connection statistics (events.js). Chrome: on, with the
  // explanation in settings. Firefox: off until the user turns it on (it is
  // an optional "technicalAndInteraction" data-collection permission there).
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
