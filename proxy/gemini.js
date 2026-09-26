// Gemini planner + vision. Uses Google's generateContent REST endpoint so we
// don't pull in a heavy SDK. Returns strictly-parsed JSON for the planner.

import "dotenv/config";

const API = "https://generativelanguage.googleapis.com/v1beta/models";

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

async function generate(model, contents, opts = {}) {
  const key = need("GEMINI_API_KEY");
  const body = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      responseMimeType: opts.responseMimeType,
      responseSchema: opts.responseSchema,
    },
  };
  if (!body.generationConfig.responseMimeType) delete body.generationConfig.responseMimeType;
  if (!body.generationConfig.responseSchema) delete body.generationConfig.responseSchema;

  const url = `${API}/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`gemini ${r.status}: ${t.slice(0, 400)}`);
  }
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return text;
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            enum: [
              "OPEN_URL", "SEARCH", "CLICK", "TYPE", "PRESS_ENTER",
              "SCROLL", "GO_BACK", "DOWNLOAD", "READ_PAGE", "DONE",
            ],
          },
          note: { type: "string" },
        },
        required: ["intent"],
      },
    },
  },
  required: ["steps"],
};

export async function plan({ goal, mode, failure, pageUrl, pageTitle, pageText }) {
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  if (mode === "summarize") {
    const prompt = [
      `The user's request was:\n${goal}`,
      `\nFinal page: ${pageTitle || ""} (${pageUrl || ""})`,
      pageText ? `\nPage text excerpt:\n${pageText.slice(0, 6000)}` : "",
      `\nWrite a concise 2-4 sentence summary of what was accomplished and the key finding.`,
    ].join("");
    const text = await generate(model, [{ role: "user", parts: [{ text: prompt }] }], { temperature: 0.3 });
    return { summary: text.trim() };
  }

  const sys = [
    "You are a planner for a browser agent. Break the user's goal into an ORDERED list of PRIMITIVE steps.",
    "Primitives (use exactly these strings):",
    "  OPEN_URL, SEARCH, CLICK, TYPE, PRESS_ENTER, SCROLL, GO_BACK, DOWNLOAD, READ_PAGE, DONE",
    "Rules:",
    "  - Prefer SEARCH over guessing URLs.",
    "  - Do not invent selectors — a downstream reflex chooses concrete elements.",
    "  - End with DONE.",
    "  - Return JSON matching the schema.",
  ].join("\n");

  const userText = mode === "replan"
    ? `Goal: ${goal}\nLast attempt failed: ${failure || "unknown"}\nCurrent page: ${pageTitle || ""} (${pageUrl || ""})\nReplan.`
    : `Goal: ${goal}`;

  const text = await generate(
    model,
    [{ role: "user", parts: [{ text: sys + "\n\n" + userText }] }],
    { responseMimeType: "application/json", responseSchema: PLAN_SCHEMA }
  );

  try {
    const parsed = JSON.parse(text);
    return { steps: Array.isArray(parsed.steps) ? parsed.steps : [] };
  } catch {
    return { steps: [{ intent: "SEARCH", note: goal }, { intent: "DONE" }] };
  }
}

export async function vision({ imageDataUrl, hint }) {
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const m = /^data:([^;]+);base64,(.+)$/.exec(imageDataUrl || "");
  if (!m) throw new Error("imageDataUrl must be base64 data URL");
  const mimeType = m[1];
  const data = m[2];
  const prompt = [
    "Describe this image for a browser agent. Extract any visible text verbatim.",
    "If it depicts a webpage, note the site, controls, and what the user likely wants done.",
    hint ? `User hint: ${hint}` : "",
  ].filter(Boolean).join("\n");

  const text = await generate(model, [
    {
      role: "user",
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data } },
      ],
    },
  ], { temperature: 0.2 });

  return { description: text.trim() };
}
