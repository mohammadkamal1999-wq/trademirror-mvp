// interventions.js — TradeMirror pattern detection
//
// Three rules that govern every intervention:
//
//   1. SPECIFIC, not generic.
//      Bad:  "You seem to be overtrading."
//      Good: "This is your 5th chart in 80 minutes. Your average is 2–3."
//
//   2. QUESTION, not verdict.
//      Bad:  "Don't take this trade."
//      Good: "Is this in your plan, or are you hunting?"
//
//   3. ONCE per pattern per day.
//      Send it. Note it. Don't nag.

import {
  getRecentSubmissions,
  alreadySentToday,
  logIntervention,
} from "./db.js";

// ─── Main detector ────────────────────────────────────────────────────────────
//
// Returns the intervention message to send, or null if nothing fires.
// Checks three patterns in priority order.

export async function checkForIntervention(user) {
  // ── 1. OVERTRADING: 4+ charts in the last 90 minutes ─────────────────────
  const recent90 = await getRecentSubmissions(user.user_id, 90);
  if (recent90.length >= 4 && !(await alreadySentToday(user.user_id, "overtrading"))) {
    await logIntervention(user.user_id, "overtrading");
    return buildOvertradingMsg(user, recent90.length);
  }

  // ── 2. REVENGE WINDOW: chart sent within 25 min of a very fast sequence ──
  // We detect a possible stop-out by looking for a submission with gap < 4 min
  // followed by another chart within 25 min. This is the revenge trading signal.
  const recent30 = await getRecentSubmissions(user.user_id, 30);
  const fastSequence = recent30.find(s => s.gap_mins > 0 && s.gap_mins <= 4);
  if (fastSequence && recent30.length >= 2 && !(await alreadySentToday(user.user_id, "revenge"))) {
    const minsAgo = Math.round((Date.now() - new Date(fastSequence.ts)) / 60000);
    if (minsAgo <= 25) {
      await logIntervention(user.user_id, "revenge");
      return buildRevengeMsg(user, minsAgo);
    }
  }

  // ── 3. OUTSIDE SESSION: chart sent outside stated trading window ──────────
  if (user.session && user.session !== "anytime") {
    const inSession = isInSession(user.session);
    if (!inSession && !(await alreadySentToday(user.user_id, "outside_session"))) {
      await logIntervention(user.user_id, "outside_session");
      return buildOutsideSessionMsg(user);
    }
  }

  return null; // No pattern detected — proceed to analysis
}

// ─── Message builders ─────────────────────────────────────────────────────────

function buildOvertradingMsg(user, count) {
  const lines = [
    `🔴 <b>Pattern detected</b>`,
    ``,
    `You've sent ${count} charts in the last 90 minutes.`,
  ];

  if (user.mistake) {
    lines.push(`You told me your pattern is: <i>"${user.mistake}"</i>`);
    lines.push(`This is what it looks like when it starts.`);
  }

  lines.push(``);
  lines.push(`Before you send this one — are you trading your plan, or are you hunting for something to fix?`);

  return lines.join("\n");
}

function buildRevengeMsg(user, minsAgo) {
  const lines = [
    `⚠️ <b>Revenge window active</b>`,
    ``,
    `You had a rapid sequence of charts ${minsAgo} minutes ago.`,
    `That pattern shows up when a trade just went wrong.`,
  ];

  if (user.mistake && user.trigger === "frustration") {
    lines.push(``);
    lines.push(`You told me frustration is your trigger and <i>"${user.mistake}"</i> is what follows.`);
  } else if (user.mistake) {
    lines.push(``);
    lines.push(`You told me your hardest pattern is: <i>"${user.mistake}"</i>`);
  }

  lines.push(``);
  lines.push(`Is this a fresh setup from your plan — or are you trying to get something back?`);

  return lines.join("\n");
}

function buildOutsideSessionMsg(user) {
  const label = SESSION_LABELS[user.session] || user.session;
  return [
    `⏰ <b>Outside your session</b>`,
    ``,
    `You told me you trade <b>${label}</b>.`,
    `You're looking at charts outside that window right now.`,
    ``,
    `What's drawing you to this setup?`,
  ].join("\n");
}

// ─── Session time check ───────────────────────────────────────────────────────

function isInSession(session) {
  const hour = new Date().getUTCHours();
  const windows = {
    london:  [7,  12],
    newyork: [13, 18],
    asian:   [0,  5 ],
  };
  const w = windows[session];
  return w ? (hour >= w[0] && hour < w[1]) : true;
}

export const SESSION_LABELS = {
  london:  "London (07:00–12:00 UTC)",
  newyork: "New York (13:00–18:00 UTC)",
  asian:   "Asian (00:00–05:00 UTC)",
  anytime: "No fixed session",
};
