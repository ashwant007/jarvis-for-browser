// Laya client — the "typed reflex" layer, self-hosted via
// github.com/NandhaKishorM/laya.
//
// Laya's real API is ONE combined request per decision cycle: you POST
// {state, questions} where `questions` is a dict of {name: {type, ...}} and
// the response answers all of them in a single forward pass. This module
// exposes that as `systemone(state, questions)`.

import "dotenv/config";

const BASE = process.env.LAYA_URL || "http://localhost:8000";
const PATH = process.env.LAYA_PATH || "/v1/systemone";
const API_KEY = process.env.LAYA_API_KEY || "";

async function post(path, body) {
  const url = BASE.replace(/\/+$/, "") + path;
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`laya ${path} ${r.status}: ${t.slice(0, 300)}`);
  }
  return r.json();
}

// state: { body: string } — the free-text context Laya reads
// questions: { name: { type: "choice"|"noul"|"score", instructions: string,
//                      criteria?: {label: description} | [label,...] } }
export async function systemone({ state, questions }) {
  return post(PATH, { state, questions });
}

// Helpers: pull the answer for a named question out of the response, with
// tolerance for a few plausible response shapes.
export function readChoice(response, name) {
  const a =
    response?.answers?.[name] ??
    response?.[name] ??
    null;
  if (!a) return { top: { label: null, p: 0 }, all: [] };

  // Distribution shapes we handle:
  //   {label, p, distribution: [{label, p}, ...]}
  //   {choice: "x", probs: {label: p, ...}}
  //   {label, probability}
  if (Array.isArray(a.distribution)) {
    const all = a.distribution.map((x) => ({
      label: x.label ?? x.name,
      p: Number(x.p ?? x.probability ?? x.score ?? 0),
    }));
    const top = all.reduce((x, y) => (y.p > x.p ? y : x), all[0]);
    return { top, all };
  }
  if (a.probs && typeof a.probs === "object") {
    const all = Object.entries(a.probs).map(([label, p]) => ({ label, p: Number(p) }));
    const top = all.reduce((x, y) => (y.p > x.p ? y : x), all[0]);
    return { top, all };
  }
  if (a.label != null) {
    return { top: { label: a.label, p: Number(a.p ?? a.probability ?? 1) }, all: [{ label: a.label, p: 1 }] };
  }
  if (a.choice != null) {
    return { top: { label: a.choice, p: Number(a.p ?? 1) }, all: [{ label: a.choice, p: 1 }] };
  }
  return { top: { label: null, p: 0 }, all: [] };
}

export function readNoul(response, name) {
  const a =
    response?.answers?.[name] ??
    response?.[name] ??
    null;
  if (!a) return { p: 0 };
  if (typeof a === "number") return { p: a };
  if (typeof a.p === "number") return { p: a.p };
  if (typeof a.probability === "number") return { p: a.probability };
  if (typeof a.yes === "number") return { p: a.yes };
  if (typeof a.answer === "boolean") return { p: a.answer ? 1 : 0 };
  return { p: 0 };
}
