// Jarvis proxy — the ONLY component that holds API keys.
// Extension calls this on localhost; this calls Gemini + Laya.

import "dotenv/config";
import express from "express";
import cors from "cors";
import { plan, vision } from "./gemini.js";
import { decide } from "./decide.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    gemini: !!process.env.GEMINI_API_KEY,
    laya: process.env.LAYA_URL || "http://localhost:8000",
  });
});

app.post("/plan", async (req, res) => {
  try {
    const out = await plan(req.body || {});
    res.json(out);
  } catch (e) {
    console.error("plan:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/vision", async (req, res) => {
  try {
    const out = await vision(req.body || {});
    res.json(out);
  } catch (e) {
    console.error("vision:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/decide", async (req, res) => {
  try {
    const out = await decide(req.body || {});
    res.json(out);
  } catch (e) {
    console.error("decide:", e.message);
    res.status(500).json({ error: e.message });
  }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`jarvis proxy on http://localhost:${port}`);
  console.log(`  gemini key: ${process.env.GEMINI_API_KEY ? "set" : "MISSING"}`);
  console.log(`  laya url:   ${process.env.LAYA_URL || "http://localhost:8000"}`);
});
