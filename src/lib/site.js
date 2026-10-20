// Server choice for the "Connect to this server" button on colitu.com's map.

// pickSiteServer: a server in `country` (case-insensitive code), preferring
// one in `city` (case-insensitive, trimmed); else the first one in that
// country; null when there is none.
export function pickSiteServer(servers, country, city) {
  if (!Array.isArray(servers)) return null;
  const cc = String(country ?? "").trim().toLowerCase();
  if (!cc) return null;
  const inCountry = servers.filter((s) => s && String(s.country ?? "").trim().toLowerCase() === cc);
  if (!inCountry.length) return null;
  const wanted = String(city ?? "").trim().toLowerCase();
  if (wanted) {
    const match = inCountry.find((s) => String(s.city ?? "").trim().toLowerCase() === wanted);
    if (match) return match;
  }
  return inCountry[0];
}
