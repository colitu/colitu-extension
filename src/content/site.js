// Content script for colitu.com: lets the website's server map ask the
// extension to connect to a country. Classic script (not a module). It only
// reacts to real user clicks on [data-colitu-connect] elements and hands the
// request to the background, which checks the sender again.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  let lastSent = 0;

  document.documentElement.setAttribute("data-colitu-extension", "1");
  window.dispatchEvent(new CustomEvent("colitu:extension-ready"));

  // detail is a JSON string: objects do not cross Firefox's compartments.
  function report(result) {
    window.dispatchEvent(new CustomEvent("colitu:connect-result", { detail: JSON.stringify(result) }));
  }

  document.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted) return;
      const target = event.target;
      const el = target && typeof target.closest === "function" ? target.closest("[data-colitu-connect]") : null;
      if (!el) return;
      const raw = el.getAttribute("data-colitu-connect") || "";
      if (!/^[a-z]{2}$/i.test(raw)) return;
      const country = raw.toLowerCase();
      const city = (el.getAttribute("data-colitu-city") || "").slice(0, 64);
      event.preventDefault();
      const now = Date.now();
      if (now - lastSent < 3000) return;
      lastSent = now;
      let pending;
      try {
        pending = Promise.resolve(api.runtime.sendMessage({ type: "site-connect", country, city }));
      } catch {
        pending = Promise.reject(new Error("send failed"));
      }
      pending.then(
        (result) => report(result && typeof result === "object" ? result : { ok: false, reason: "error", country, city }),
        () => report({ ok: false, reason: "error", country, city }),
      );
    },
    true,
  );
})();
