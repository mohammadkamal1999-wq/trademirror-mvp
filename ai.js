
import dotenv from 'dotenv';
dotenv.config();

// ai.js — TradeMirror Claude integration
//
// One job: take a chart image + behavioral context → return structured assessment
//
// The prompt is the product. Every word is intentional.
// The reflection question at the end is the most important output.

import Anthropic from "@anthropic-ai/sdk";
import fetch from "node-fetch";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Chart analysis ───────────────────────────────────────────────────────────

export async function analyzeChart({ imageBase64, caption, rules, user, sessionCount }) {
  const rulesBlock = rules.length > 0
    ? `TRADER'S RULES — check every chart against these:\n${rules.map((r, i) => `${i + 1}. ${r.text}`).join("\n")}`
    : `TRADER'S RULES: None set. Use general trading principles.`;

  const contextBlock = [
    caption ? `Setup context: "${caption}"` : `No setup context provided.`,
    user.mistake ? `Their stated pattern: "${user.mistake}"` : null,
    user.trigger ? `Their trigger: "${TRIGGER_LABELS[user.trigger] || user.trigger}"` : null,
    sessionCount > 1 ? `Charts sent this session: ${sessionCount}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `You are TradeMirror — a behavioral intervention system for traders.

Your role is NOT to be encouraging. It is to be accurate and to protect their account.
You are the honest voice they don't have in the room.

CONTEXT:
${contextBlock}

${rulesBlock}

Analyze the chart and respond in EXACTLY this format — no extra text, no preamble:

ASSESSMENT_START
FOR: [point 1]|[point 2]|[point 3 max — genuine technical reasons only]
AGAINST: [point 1]|[point 2]|[point 3 max — be honest about real risks]
MISSING: [point 1]|[point 2 max — what you can't see: HTF bias, news, session]
RULES_VIOLATED: [exact rule text]|[exact rule text] or NONE
REFLECTION: [One specific, uncomfortable question. Use their actual setup details. Reference their stated pattern if it fits. This is the most important line you write.]
ASSESSMENT_END

Rules for the REFLECTION:
- Make it specific to THIS chart. Never generic.
- Bad: "Are you sure about this?" 
- Good: "This is the third NQ long you've sent in 40 minutes — are you chasing a move you already missed?"
- If they have a stated pattern, weave it in when it fits.
- The question should create a moment of pause. Not guilt — clarity.

If the image is not a trading chart:
ASSESSMENT_START
NOT_A_CHART
ASSESSMENT_END`;

  const response = await claude.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: imageBase64 },
        },
        { type: "text", text: prompt },
      ],
    }],
  });

  return parseResponse(response.content[0].text);
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseResponse(raw) {
  const match = raw.match(/ASSESSMENT_START\n([\s\S]*?)\nASSESSMENT_END/);
  if (!match) return { error: true };

  const body = match[1].trim();
  if (body === "NOT_A_CHART") return { notAChart: true };

  const getList = (label) => {
    const m = body.match(new RegExp(`^${label}: (.+)$`, "m"));
    return m ? m[1].split("|").map(s => s.trim()).filter(Boolean) : [];
  };
  const getLine = (label) => {
    const m = body.match(new RegExp(`^${label}: (.+)$`, "m"));
    return m ? m[1].trim() : "";
  };

  return {
    for:       getList("FOR"),
    against:   getList("AGAINST"),
    missing:   getList("MISSING"),
    violated:  getList("RULES_VIOLATED").filter(r => r !== "NONE"),
    reflection: getLine("REFLECTION"),
    raw,
  };
}

// ─── Telegram message formatter ───────────────────────────────────────────────

export function formatAssessment(result, caption) {
  if (result.error)    return "⚠️ Couldn't parse the analysis. Please try again.";
  if (result.notAChart) return "❌ That doesn't look like a trading chart. Send me a screenshot.";

  const lines = ["📊 <b>TRADE ASSESSMENT</b>"];
  if (caption) lines.push(`<i>${caption}</i>`);
  lines.push("");

  if (result.for.length)     { lines.push("✅ <b>For:</b>");      result.for.forEach(p     => lines.push(`• ${p}`)); }
  if (result.against.length) { lines.push(""); lines.push("⚠️ <b>Against:</b>"); result.against.forEach(p => lines.push(`• ${p}`)); }
  if (result.missing.length) { lines.push(""); lines.push("❓ <b>Missing:</b>"); result.missing.forEach(p => lines.push(`• ${p}`)); }
  if (result.violated.length){ lines.push(""); lines.push("🚨 <b>Rule violated:</b>"); result.violated.forEach(r => lines.push(`• ${r}`)); }
  if (result.reflection)     { lines.push(""); lines.push(`🪞 ${result.reflection}`); }

  return lines.join("\n");
}

// ─── Image download ───────────────────────────────────────────────────────────

export async function downloadImage(url) {
  const res = await fetch(url);
  const buf = await res.buffer();
  return buf.toString("base64");
}

// ─── Caption parser — extract instrument + direction ─────────────────────────

export function parseCaption(caption) {
  if (!caption) return { instrument: "", direction: "" };
  const text = caption.toLowerCase();
  const instruments = ["nq","es","ym","rty","eurusd","gbpusd","usdjpy",
    "audusd","xauusd","gold","btc","eth","cl","spy","qqq","mnq","mes"];
  const instrument = instruments.find(i => text.includes(i)) || "";
  const direction  = text.match(/\b(long|buy|bull)\b/) ? "long"
    : text.match(/\b(short|sell|bear)\b/) ? "short" : "";
  return { instrument, direction };
}

const TRIGGER_LABELS = {
  frustration: "frustration after a loss",
  excitement:  "excitement from a fast move",
  boredom:     "boredom in slow markets",
  fomo:        "FOMO from a missed move",
};
