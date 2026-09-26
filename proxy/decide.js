// The /decide endpoint. ONE call to Laya per step (Laya's systemone answers
// several questions in one forward pass). We ask:
//   intent  — choice among the primitive intents
//   element — choice among visible element ids (labelled by their page text)
//   submit  — noul: should we submit after typing?
//   risky   — noul: is this action irreversible/dangerous?
//
// Concrete values (typeText, url, scrollDir) are parsed by code, not the
// model — Laya must never invent a string.

import { systemone, readChoice, readNoul } from "./laya.js";

const ELEMENT_INTENTS = new Set(["CLICK", "TYPE", "DOWNLOAD"]);

function stateBody({ goal, pageUrl, pageTitle, scrollY, scrollMax, elements, stepHint }) {
  const lines = [
    `USER GOAL: ${goal}`,
    `PAGE: ${pageTitle || ""} — ${pageUrl || ""}`,
    `SCROLL: ${scrollY}/${scrollMax}`,
    stepHint?.intent ? `NEXT STEP (hint): ${stepHint.intent}${stepHint.note ? " — " + stepHint.note : ""}` : "",
    "VISIBLE ELEMENTS:",
    ...elements.map((e) => `${e.id} [${e.role}] ${e.label}${e.href ? " (" + e.href + ")" : ""}`),
  ];
  return lines.filter(Boolean).join("\n");
}

function intentCriteria(intents) {
  const notes = {
    OPEN_URL: "navigate to a specific URL",
    SEARCH: "run a web search",
    CLICK: "click a specific element",
    TYPE: "type text into a field",
    PRESS_ENTER: "press the Enter key",
    SCROLL: "scroll the page",
    GO_BACK: "go back in browser history",
    DOWNLOAD: "download a file from a link",
    READ_PAGE: "read the page content",
    DONE: "the goal is complete",
  };
  const out = {};
  for (const i of intents) out[i] = notes[i] || i;
  return out;
}

function elementCriteria(elements) {
  const out = {};
  for (const e of elements) {
    out[e.id] = `[${e.role}] ${e.label}${e.href ? " (" + e.href + ")" : ""}`.slice(0, 200);
  }
  return out;
}

function extractValues(goal) {
  const out = {};
  const urlMatch = goal.match(/https?:\/\/[^\s"'<>]+/);
  if (urlMatch) out.url = urlMatch[0];

  const typeMatch =
    goal.match(/(?:type|enter|search for|search)\s+["']([^"']+)["']/i) ||
    goal.match(/(?:type|enter)\s+(.+?)(?:\s+into\s+|\s+in\s+|$)/i);
  if (typeMatch) out.typeText = typeMatch[1].trim();

  if (/scroll\s+up/i.test(goal)) out.scrollDir = "up";
  else if (/scroll/i.test(goal)) out.scrollDir = "down";
  return out;
}

export async function decide(req) {
  const { intents, elements, goal } = req;
  const body = stateBody(req);

  const questions = {
    intent: {
      type: "choice",
      instructions: "Which primitive action best advances the goal on the current page?",
      criteria: intentCriteria(intents),
    },
    risky: {
      type: "noul",
      instructions:
        "Is the proposed action risky — does it buy something, delete data, send a message, post publicly, or otherwise cause an irreversible effect?",
    },
  };

  if (elements.length > 0) {
    questions.element = {
      type: "choice",
      instructions:
        "If the chosen action targets a specific element on this page, which element id best matches the goal? Pick the single best.",
      criteria: elementCriteria(elements),
    };
  }

  questions.submit = {
    type: "noul",
    instructions: "If we are typing into a field, should we submit / press Enter afterwards?",
  };

  const response = await systemone({ state: { body }, questions });

  const intentAns = readChoice(response, "intent");
  const intent = intentAns.top.label || "DONE";
  const intentP = intentAns.top.p;

  let elementId = null, elementP = 0, topElements = [];
  if (ELEMENT_INTENTS.has(intent) && elements.length > 0) {
    const elAns = readChoice(response, "element");
    elementId = elAns.top.label;
    elementP = elAns.top.p;
    topElements = (elAns.all || []).slice().sort((a, b) => b.p - a.p).map((x) => ({ id: x.label, p: x.p }));
  }

  const submitAns = readNoul(response, "submit");
  const riskyAns = readNoul(response, "risky");
  const values = extractValues(goal);

  return {
    intent,
    intentP,
    elementId,
    elementP,
    topElements,
    submit: submitAns.p >= 0.5,
    submitP: submitAns.p,
    risky: riskyAns.p >= 0.6,
    riskyP: riskyAns.p,
    typeText: values.typeText || null,
    url: values.url || null,
    scrollDir: values.scrollDir || null,
    reason: null,
  };
}
