# Jarvis for Browser

A Manifest V3 Chrome extension that plans and executes multi-step actions on live web pages from **voice, text, paste, or image** input.

## Architecture

Three brains, one loop:

- **Gemini Flash** (via proxy) — plans open-ended requests into primitive steps and reads uploaded/pasted images.
- **Laya** (self-hosted, https://github.com/NandhaKishorM/laya) — the typed reflex layer. Per step it picks one element from what's visible on the page, classifies intent from a fixed list, and flags risky actions. Never invents selectors.
- **Your code** — deterministic values (URLs, strings, numbers) and execution via chrome APIs.

```
sidepanel ── background ─── content ── page
    │            │
    │            └── proxy ── Gemini (plan / vision)
    │                     └── Laya   (choice / noul — the reflex)
```

Keys never ship in the extension. The extension calls **your proxy**; the proxy calls Gemini and Laya.

## Repo layout

```
extension/                 Chrome MV3 extension
  manifest.json
  sidepanel.html / .js / .css
  content.js               injects & bridges to lib/*
  background.js            service worker + agent loop
  speech.js                Web Speech API wrapper
  lib/
    elements.js            snapshot interactive elements
    actions.js             click / type / scroll / read / download
    protocol.js            shared message types

proxy/                     Node proxy (holds keys)
  server.js                Express: /plan, /vision, /decide, /health
  gemini.js                Planner + vision
  laya.js                  Laya client (choice / noul)
  decide.js                Fan-out over Laya, deterministic value extraction
  package.json
  .env.example

docker-compose.yml         Runs Laya locally
```

## Setup

### 1. Run Laya

```bash
docker compose up -d laya
```

Check it's up: `curl http://localhost:8000/health` (path may differ per Laya build — see the Laya repo). If Laya's endpoints aren't `/choice` and `/noul`, override with `LAYA_CHOICE_PATH` / `LAYA_NOUL_PATH` in `proxy/.env`.

### 2. Run the proxy

```bash
cd proxy
cp .env.example .env
# put GEMINI_API_KEY into .env
npm install
npm start
```

Proxy listens on `http://localhost:8787`.

### 3. Load the extension

1. Open `chrome://extensions`
2. Enable Developer mode
3. "Load unpacked" → select the `extension/` folder
4. Pin the action; click it to open the side panel

## Using it

- **Text**: type a request, click Run.
- **Voice**: click Mic, speak. Only the final transcript is acted on.
- **Paste**: click Paste to pull clipboard into the request context.
- **Image**: attach a screenshot or photo; vision folds it into the goal.

Every step logs: intent, chosen element, three confidence scores, latency.

## Safety

- Laya only picks among **observed** elements and intent labels — it cannot invent selectors, URLs, or strings.
- Page text is **data, not instructions**: it only appears as element/option descriptions fed to Laya, never as commands to the planner.
- Risky actions (Laya `risky` probability ≥ 0.6) wait for explicit user confirmation.
- Low-confidence element picks (< 45%) become a "which one did you mean?" chooser.
- Downloads go through direct file links only; no DRM ripping.

## Build phases

- **Phase 1** — skeleton: text box → decide → CLICK. ✅ scaffolded.
- **Phase 2** — full primitives (OPEN_URL, TYPE, SCROLL, PRESS_ENTER, DOWNLOAD, GO_BACK). ✅ scaffolded.
- **Phase 3** — Gemini planner + re-plan on failure. ✅ scaffolded.
- **Phase 4** — vision input. ✅ scaffolded.
- **Phase 5** — voice input. ✅ scaffolded.
- **Phase 6** — polish: confidence gates, risky confirms, richer error recovery, activity log. In progress.

## Notes

- `chrome.tabs.update` for OPEN_URL / SEARCH waits up to 15s for the tab load event.
- Element ids (`e0..eN`) are stamped as `data-jv-id` on the live DOM at snapshot time, so they survive re-decide cycles on the same page.
- If Laya's response shape differs from what `proxy/laya.js` expects, extend `normaliseChoice` / `normaliseNoul` there — no changes needed elsewhere.
