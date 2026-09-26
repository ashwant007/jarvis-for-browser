// Laya client — the "typed reflex" layer. Same primitives JEV exposes
// (choice / noul), self-hosted via github.com/NandhaKishorM/laya.
//
// This module keeps the endpoint paths configurable via env so the proxy
// works with whatever routes your Laya build ships.

import "dotenv/config";

const BASE = process.env.LAYA_URL || "http://localhost:8000";
const CHOICE_PATH = process.env.LAYA_CHOICE_PATH || "/choice";
const NOUL_PATH = process.env.LAYA_NOUL_PATH || "/noul";

async function post(path, body) {
  const url = BASE.replace(/\/+$/, "") + path;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`laya ${path} ${r.status}: ${t.slice(0, 300)}`);
  }
  return r.json();
}

// Normalise the response into { top: {label, p}, all: [{label, p}] }.
// Handles a few likely shapes: {label, p, distribution}, {choice, probs},
// or {labels:[...], probs:[...]}.
function normaliseChoice(res, labels) {
  if (res && Array.isArray(res.distribution)) {
    const all = res.distribution.map((x) => ({
      label: x.label ?? x.name ?? x.id,
      p: Number(x.p ?? x.probability ?? x.score ?? 0),
    }));
    const top = all.reduce((a, b) => (b.p > a.p ? b : a), all[0]);
    return { top, all };
  }
  if (res && Array.isArray(res.probs) && Array.isArray(res.labels || labels)) {
    const L = res.labels || labels;
    const all = L.map((label, i) => ({ label, p: Number(res.probs[i] || 0) }));
    const top = all.reduce((a, b) => (b.p > a.p ? b : a), all[0]);
    return { top, all };
  }
  if (res && res.label != null) {
    const all = [{ label: res.label, p: Number(res.p ?? res.probability ?? 1) }];
    return { top: all[0], all };
  }
  return { top: { label: labels?.[0], p: 0 }, all: [] };
}

function normaliseNoul(res) {
  if (res == null) return { p: 0 };
  if (typeof res.p === "number") return { p: res.p };
  if (typeof res.probability === "number") return { p: res.probability };
  if (typeof res.yes === "number") return { p: res.yes };
  if (typeof res === "number") return { p: res };
  return { p: 0 };
}

export async function choice({ text, labels }) {
  const res = await post(CHOICE_PATH, { text, labels });
  return normaliseChoice(res, labels);
}

export async function noul({ text, question }) {
  const res = await post(NOUL_PATH, { text, question });
  return normaliseNoul(res);
}
