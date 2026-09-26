// The /decide endpoint. Fan-out over Laya to answer four questions per step:
//   1) which intent (choice)
//   2) which element to target (choice, iff intent needs one)
//   3) submit after typing? (noul)
//   4) is this risky? (noul)
//
// Also parses concrete values (typeText, url, scrollDir) deterministically
// from the goal — code owns exact strings, never the model.

import { choice, noul } from "./laya.js";

const ELEMENT_INTENTS = new Set(["CLICK", "TYPE", "DOWNLOAD"]);

function contextText({ goal, pageUrl, pageTitle, scrollY, scrollMax, elements, stepHint }) {
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

// Very small deterministic extractor for values the model must NOT invent.
function extractValues(goal, intent, elements) {
  const out = {};
  // URL
  const urlMatch = goal.match(/https?:\/\/[^\s"'<>]+/);
  if (urlMatch) out.url = urlMatch[0];

  // "type X" / 'search for "X"' patterns
  const typeMatch = goal.match(/(?:type|enter|search for|search)\s+["']([^"']+)["']/i) ||
                    goal.match(/(?:type|enter)\s+(.+?)(?:\s+into\s+|\s+in\s+|$)/i);
  if (typeMatch) out.typeText = typeMatch[1].trim();

  // Scroll direction
  if (/scroll\s+up/i.test(goal)) out.scrollDir = "up";
  else if (/scroll/i.test(goal)) out.scrollDir = "down";

  return out;
}

export async function decide(req) {
  const { intents, elements, goal } = req;

  // 1. Intent choice
  const ctx = contextText(req);
  const intentRes = await choice({
    text: ctx + "\n\nQUESTION: Which primitive action best advances the goal on the current page?",
    labels: intents,
  });

  const intent = intentRes.top.label;
  const intentP = intentRes.top.p;

  const needsElement = ELEMENT_INTENTS.has(intent);

  // 2. Element choice — only when the intent needs one.
  let elementId = null, elementP = 0, topElements = [];
  if (needsElement && elements.length > 0) {
    const ids = elements.map((e) => e.id);
    const elemRes = await choice({
      text: ctx + `\n\nQUESTION: For intent ${intent}, which element id best matches the goal?`,
      labels: ids,
    });
    elementId = elemRes.top.label;
    elementP = elemRes.top.p;
    topElements = (elemRes.all || [])
      .slice()
      .sort((a, b) => b.p - a.p)
      .map((x) => ({ id: x.label, p: x.p }));
  }

  // 3+4. Nouls in parallel
  const [submitR, riskyR] = await Promise.all([
    intent === "TYPE"
      ? noul({ text: ctx, question: "After typing, should we submit the form / press Enter?" })
      : Promise.resolve({ p: 0 }),
    noul({
      text: ctx + `\n\nProposed action: ${intent}${elementId ? " on " + elementId : ""}`,
      question: "Is this action risky (buys something, deletes, sends a message, posts publicly, or is otherwise irreversible)?",
    }),
  ]);

  const values = extractValues(goal, intent, elements);

  return {
    intent,
    intentP,
    elementId,
    elementP,
    topElements,
    submit: submitR.p >= 0.5,
    submitP: submitR.p,
    risky: riskyR.p >= 0.6,
    riskyP: riskyR.p,
    typeText: values.typeText || null,
    url: values.url || null,
    scrollDir: values.scrollDir || null,
    reason: null,
  };
}
