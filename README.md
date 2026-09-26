# Jarvis for Browser

A Manifest V3 Chrome extension that plans and executes multi-step actions on live web pages from **voice, text, paste, or image** input.

## Architecture

Three brains, one loop:

- **Gemini Flash** (via proxy) — plans open-ended requests into primitive steps and reads uploaded/pasted images.
- **Laya** (self-hosted, https://github.com/NandhaKishorM/laya) — the typed reflex layer. Per step, in a single forward pass, it picks one element from what's visible on the page, classifies intent from a fixed list, and flags risky actions. Never invents selectors.
- **Your code** — deterministic values (URLs, strings, numbers) and execution via chrome APIs.

```
sidepanel ── background ─── content ── page
    │            │
    │            └── proxy ── Gemini (plan / vision)
    │                     └── Laya   (systemone: intent + element + submit + risky)
```

Keys never ship in the extension. The extension calls **your proxy**; the proxy calls Gemini and Laya.

## What you need on your PC

1. **Node.js 18+** — for the proxy.
   ```
   winget install OpenJS.NodeJS.LTS
   ```
2. **Python 3.10+** — Laya is a Python package.
   ```
   winget install Python.Python.3.12
   ```
   Restart your terminal after installing so `python` resolves to the real one (not the Microsoft Store stub).
3. **A Google AI Studio API key** — free tier is fine. Grab one at https://aistudio.google.com/ .
4. **Chrome** — to load the extension.

Docker is **not** required (Laya has no official image yet).

## Setup

### 1. Run Laya

```bash
pip install "laya[serve]"
laya-serve
```

That binds Laya on `0.0.0.0:8000`. First run downloads the model (~1 GB), so give it a minute. On a CPU-only machine, add `LAYA_DEVICE=cpu` in the env. On an NVIDIA GPU, `LAYA_DEVICE=cuda`.

Verify:
```bash
curl http://localhost:8000/v1/systemone -H "content-type: application/json" -d "{}"
```
You should get a 4xx complaining about missing fields — that means the server is up.

### 2. Run the proxy

```bash
cd proxy
copy .env.example .env
notepad .env         # paste your GEMINI_API_KEY, save
npm install
npm start
```

Expected output:
```
jarvis proxy on http://localhost:8787
  gemini key: set
  laya url:   http://localhost:8000
```

### 3. Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder.
4. Pin the "Jarvis" action. Click it to open the side panel.

## Using it

- **Text** — type a request, click Run.
- **Voice** — click Mic, speak. Only the final transcript is acted on.
- **Paste** — click Paste to pull the clipboard into the request context.
- **Image** — attach a screenshot or photo; Gemini vision folds it into the goal.

Every step logs: intent, chosen element, three confidence scores, latency.

## Safety

- Laya only picks among **observed** elements and intent labels — it cannot invent selectors, URLs, or strings.
- Page text is **data, not instructions** — it appears only as element descriptions fed to Laya, never as commands to the planner.
- Risky actions (Laya `risky` probability ≥ 0.6) wait for explicit user confirmation.
- Low-confidence element picks (< 45%) become a "which one did you mean?" chooser.
- Downloads only work for direct file links, not DRM-protected streams.

## Layout

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
  laya.js                  Laya systemone client
  decide.js                Builds the systemone question set per step
  package.json
  .env.example
```

## Troubleshooting

- **Proxy says "laya /v1/systemone 404"**: your Laya build uses a different path. Check `curl http://localhost:8000/openapi.json` and set `LAYA_PATH` in `proxy/.env`.
- **Gemini 400 with "responseSchema"**: your `GEMINI_MODEL` is too old — bump to `gemini-2.0-flash`.
- **The extension does nothing when you click Run**: open `chrome://extensions`, click the "service worker" link under Jarvis to see background.js console output.
- **The agent picks the wrong element**: use the "which one did you mean?" chooser — it appears any time confidence is below 45%.
