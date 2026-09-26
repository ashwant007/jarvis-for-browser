// Content script: bridges background <-> in-page snapshot/exec helpers.
// The helpers themselves live in lib/elements.js and lib/actions.js which we
// inject into MAIN world so they can touch the page's own DOM state.

(function () {
  const MSG = {
    SNAPSHOT: "SNAPSHOT",
    EXECUTE: "EXECUTE",
  };

  function injectOnce(file) {
    if (document.querySelector(`script[data-jarvis="${file}"]`)) return;
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL(file);
    s.dataset.jarvis = file;
    (document.head || document.documentElement).appendChild(s);
  }

  injectOnce("lib/elements.js");
  injectOnce("lib/actions.js");

  // Bridge via postMessage between the content script (isolated world)
  // and the MAIN world where __jarvisSnapshot / __jarvisExecute live.
  const pending = new Map();
  let seq = 0;

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__jarvis !== "resp") return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    p.resolve(d.payload);
  });

  function callMain(kind, arg) {
    return new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, { resolve });
      window.postMessage({ __jarvis: "req", id, kind, arg }, "*");
    });
  }

  // Inject the tiny bridge into MAIN world too.
  const bridge = document.createElement("script");
  bridge.dataset.jarvis = "bridge";
  bridge.textContent = `
    (function () {
      window.addEventListener("message", async (ev) => {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.__jarvis !== "req") return;
        try {
          let payload;
          if (d.kind === "SNAPSHOT") payload = { ok: true, data: window.__jarvisSnapshot && window.__jarvisSnapshot() };
          else if (d.kind === "EXECUTE") payload = await window.__jarvisExecute(d.arg);
          else payload = { ok: false, error: "unknown kind " + d.kind };
          window.postMessage({ __jarvis: "resp", id: d.id, payload }, "*");
        } catch (e) {
          window.postMessage({ __jarvis: "resp", id: d.id, payload: { ok: false, error: String(e && e.message || e) } }, "*");
        }
      });
    })();
  `;
  (document.head || document.documentElement).appendChild(bridge);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === MSG.SNAPSHOT) {
      callMain("SNAPSHOT").then((r) => sendResponse(r));
      return true;
    }
    if (msg.type === MSG.EXECUTE) {
      callMain("EXECUTE", msg.action).then((r) => sendResponse(r));
      return true;
    }
  });
})();
