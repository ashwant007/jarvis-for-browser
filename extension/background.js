// Service worker: the agent loop lives here.
//
// Reads: PROXY_URL from chrome.storage (default http://localhost:8787)
//        MAX_STEPS from chrome.storage (default 20)
// Talks to: content script (SNAPSHOT/EXECUTE), side panel (LOG/STATUS/asks),
// and the proxy (/plan, /vision, /decide).

const DEFAULT_PROXY = "http://localhost:8787";
const DEFAULT_MAX_STEPS = 20;

const INTENTS = [
  "OPEN_URL", "SEARCH", "CLICK", "TYPE", "PRESS_ENTER",
  "SCROLL", "GO_BACK", "DOWNLOAD", "READ_PAGE", "DONE",
];

const RISK_THRESHOLD = 0.6;
const CONFIDENCE_GATE = 0.45; // if top choice below this, ask user

const state = {
  running: false,
  stopRequested: false,
  awaits: new Map(),
  awaitSeq: 0,
};

chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

chrome.action?.onClicked.addListener(async (tab) => {
  if (tab?.id != null) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "RUN_TASK") {
    startTask(msg.payload).catch((e) =>
      panelSend("STATUS", { text: "error: " + e.message, kind: "err", done: true })
    );
    return; // no async response needed
  }
  if (msg.type === "STOP_TASK") {
    state.stopRequested = true;
    return;
  }
  if (msg.type === "USER_CONFIRM" || msg.type === "USER_CHOOSE") {
    const pending = state.awaits.get(msg.id);
    if (pending) {
      state.awaits.delete(msg.id);
      pending.resolve(msg);
    }
    return;
  }
});

function panelSend(type, payload) {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {});
}
function log(text, meta, kind) { panelSend("LOG", { text, meta, kind }); }

async function getConfig() {
  const c = await chrome.storage.local.get(["proxyUrl", "maxSteps"]);
  return {
    proxyUrl: c.proxyUrl || DEFAULT_PROXY,
    maxSteps: c.maxSteps || DEFAULT_MAX_STEPS,
  };
}

async function proxyPost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`proxy ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error("no active tab");
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch {
    // ignore — likely already injected or restricted URL
  }
}

async function snapshotTab() {
  const tab = await activeTab();
  await ensureContentScript(tab.id);
  const res = await chrome.tabs.sendMessage(tab.id, { type: "SNAPSHOT" }).catch((e) => ({ ok: false, error: String(e) }));
  if (!res || !res.ok) throw new Error("snapshot failed: " + (res?.error || "no response"));
  return { tab, snapshot: res.data };
}

async function execAction(tabId, action) {
  const res = await chrome.tabs.sendMessage(tabId, { type: "EXECUTE", action });
  if (!res || !res.ok) throw new Error("exec failed: " + (res?.error || "no response"));
  return res;
}

function askConfirm(text) {
  return new Promise((resolve) => {
    const id = "c" + (++state.awaitSeq);
    state.awaits.set(id, { resolve });
    panelSend("ASK_CONFIRM", { id, text });
  }).then((m) => !!m.ok);
}

function askChoose(options) {
  return new Promise((resolve) => {
    const id = "ch" + (++state.awaitSeq);
    state.awaits.set(id, { resolve });
    panelSend("ASK_CHOOSE", { id, options });
  }).then((m) => m.elementId);
}

// ---------- agent loop ----------

async function startTask({ text, pastedText, imageDataUrl }) {
  if (state.running) { log("already running", null, "err"); return; }
  state.running = true;
  state.stopRequested = false;
  const cfg = await getConfig();

  try {
    // 1. Vision (optional) → structured description folded into goal.
    let visionText = "";
    if (imageDataUrl) {
      panelSend("STATUS", { text: "vision…", kind: "busy" });
      const v = await proxyPost(cfg.proxyUrl + "/vision", { imageDataUrl, hint: text });
      visionText = v.description || "";
      log("vision: " + visionText.slice(0, 180));
    }

    const goal = [text, pastedText, visionText].filter(Boolean).join("\n\n");
    if (!goal) throw new Error("empty request");

    // 2. Plan.
    panelSend("STATUS", { text: "planning…", kind: "busy" });
    const planResp = await proxyPost(cfg.proxyUrl + "/plan", { goal });
    let plan = Array.isArray(planResp.steps) ? planResp.steps : [];
    log("plan: " + plan.map((s) => s.intent).join(" → "), null, "ok");

    // 3. Execute step-by-step. We treat the plan as a hint, not a script:
    //    every step is re-decided against the live page state.
    let step = 0;
    let lastPageText = null;
    while (step < cfg.maxSteps) {
      if (state.stopRequested) { log("stopped", null, "err"); break; }
      step++;

      let snap;
      try { snap = await snapshotTab(); }
      catch (e) { log("snapshot: " + e.message, null, "err"); break; }

      const stepHint = plan[step - 1] || null;
      panelSend("STATUS", { text: `step ${step}: deciding…`, kind: "busy" });

      const t0 = Date.now();
      const decision = await proxyPost(cfg.proxyUrl + "/decide", {
        goal,
        pageUrl: snap.snapshot.url,
        pageTitle: snap.snapshot.title,
        scrollY: snap.snapshot.scrollY,
        scrollMax: snap.snapshot.scrollMax,
        elements: snap.snapshot.elements,
        stepHint,
        history: [],
        intents: INTENTS,
      });
      const dt = Date.now() - t0;

      const { intent, intentP, elementId, elementP, submit, risky, riskyP, typeText, url, scrollDir, reason } = decision;
      log(`step ${step}: ${intent}`, `intent ${(intentP*100|0)}% · elem ${(elementP*100|0)}% · risky ${(riskyP*100|0)}% · ${dt}ms`);

      if (intent === "DONE") {
        panelSend("STATUS", { text: "done", kind: "ok", done: true });
        panelSend("DONE", {});
        // Summarize with planner.
        try {
          const summary = await proxyPost(cfg.proxyUrl + "/plan", {
            goal, mode: "summarize",
            pageText: lastPageText, pageUrl: snap.snapshot.url, pageTitle: snap.snapshot.title,
          });
          if (summary && summary.summary) log("summary: " + summary.summary, null, "ok");
        } catch {}
        break;
      }

      // Confidence gate — for element-targeting intents only.
      const needsElement = ["CLICK", "TYPE", "DOWNLOAD"].includes(intent);
      if (needsElement && (elementP < CONFIDENCE_GATE || !elementId)) {
        const options = (decision.topElements || []).slice(0, 5).map((o) => {
          const el = snap.snapshot.elements.find((e) => e.id === o.id);
          return { id: o.id, label: el?.label || o.id, p: o.p };
        });
        if (options.length === 0) { log("no target element", null, "err"); break; }
        const chosen = await askChoose(options);
        decision.elementId = chosen;
      }

      // Risky gate.
      if (riskyP >= RISK_THRESHOLD) {
        const ok = await askConfirm(`Risky: ${intent}${reason ? " — " + reason : ""}. Proceed?`);
        if (!ok) { log("user cancelled", null, "err"); break; }
      }

      try {
        await runIntent(snap.tab, snap.snapshot, decision);
        if (intent === "READ_PAGE") {
          // capture page text for eventual summary
          const r = await execAction(snap.tab.id, { intent: "READ_PAGE" });
          lastPageText = r.text;
        }
      } catch (e) {
        log("exec: " + e.message, null, "err");
        // Ask planner to re-plan given the failure.
        try {
          const rp = await proxyPost(cfg.proxyUrl + "/plan", {
            goal, mode: "replan",
            failure: e.message,
            pageUrl: snap.snapshot.url,
            pageTitle: snap.snapshot.title,
          });
          if (Array.isArray(rp.steps) && rp.steps.length) {
            plan = rp.steps;
            step = 0;
            log("re-planned: " + rp.steps.map((s) => s.intent).join(" → "));
            continue;
          }
        } catch {}
        break;
      }

      // Small pause for page reaction.
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (e) {
    panelSend("STATUS", { text: "error: " + e.message, kind: "err", done: true });
  } finally {
    state.running = false;
  }
}

async function runIntent(tab, snapshot, d) {
  switch (d.intent) {
    case "OPEN_URL": {
      if (!d.url) throw new Error("OPEN_URL without url");
      await chrome.tabs.update(tab.id, { url: d.url });
      // wait for load
      await new Promise((res) => {
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            res();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); res(); }, 15000);
      });
      return;
    }
    case "SEARCH": {
      const q = d.typeText || d.query || "";
      const url = "https://www.google.com/search?q=" + encodeURIComponent(q);
      await chrome.tabs.update(tab.id, { url });
      return;
    }
    case "GO_BACK":
      await chrome.tabs.goBack(tab.id).catch(() => {});
      return;
    case "SCROLL":
      await execAction(tab.id, { intent: "SCROLL", direction: d.scrollDir || "down" });
      return;
    case "PRESS_ENTER":
      await execAction(tab.id, { intent: "PRESS_ENTER", jvId: d.elementId });
      return;
    case "CLICK":
      await execAction(tab.id, { intent: "CLICK", jvId: d.elementId });
      return;
    case "TYPE":
      await execAction(tab.id, { intent: "TYPE", jvId: d.elementId, text: d.typeText || "", submit: !!d.submit });
      return;
    case "READ_PAGE":
      // handled after return
      return;
    case "DOWNLOAD": {
      const r = await execAction(tab.id, { intent: "DOWNLOAD", jvId: d.elementId });
      if (!r.url) throw new Error("no download url");
      await chrome.downloads.download({ url: r.url });
      return;
    }
    default:
      throw new Error("unknown intent: " + d.intent);
  }
}
