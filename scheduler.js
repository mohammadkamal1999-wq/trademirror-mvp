// scheduler.js — TradeMirror session accountability
//
// Fires exactly four types of scheduled messages. Nothing more.
//
//   SESSION START   — at session open, once per day
//   SESSION END     — at session close, once per day
//   RULE PROTECTION — when daily trade limit is reached, once per day
//   (outside session / emotional risk / rule violations are handled
//    reactively in interventions.js when charts are submitted)
//
// Design principle: a message only fires when it genuinely matters.
// Intermediate warnings (50%, 80%) were removed because they train
// traders to ignore the bot. Every message must feel significant.
//
// State: sched_start_sent, sched_end_sent, sched_locked_sent on users table.
// All are date strings ("2024-05-30") — auto-reset at midnight.

import {
  getAllActiveUsers, getTodayCount,
  getSchedulerState, setSchedField,
} from "./db.js";

// ─── Session windows (UTC) ────────────────────────────────────────────────────
// Single source of truth — used by scheduler, interventions.js, and /session cmd

export const SESSION_WINDOWS = {
  london:  { start: 7,  end: 12, label: "London (07:00–12:00 UTC)"  },
  newyork: { start: 13, end: 18, label: "New York (13:00–18:00 UTC)" },
  asian:   { start: 0,  end: 5,  label: "Asian (00:00–05:00 UTC)"    },
};

// ─── Scheduler entry point ────────────────────────────────────────────────────

export function startScheduler(bot) {
  const send = (chatId, text) =>
    bot.sendMessage(chatId, text, { parse_mode: "HTML" }).catch(err =>
      console.error(`[scheduler] send failed to ${chatId}:`, err.message)
    );

  async function tick() {
    const now   = new Date();
    const today = now.toISOString().split("T")[0];
    const hour  = now.getUTCHours();
    const min   = now.getUTCMinutes();

    let users;
    try {
      users = await getAllActiveUsers();
    } catch (err) {
      console.error("[scheduler] getAllActiveUsers failed:", err.message);
      return;
    }

    for (const user of users) {
      try {
        await processUser(user, { send, today, hour, min });
      } catch (err) {
        console.error(`[scheduler] error for user ${user.user_id}:`, err.message);
      }
    }
  }

  // Run once on start (catches up if bot restarted mid-session), then every 60s
  tick();
  setInterval(tick, 60_000);
  console.log("⏰  Session scheduler running — checks every 60s");
}

// ─── Per-user tick ────────────────────────────────────────────────────────────

async function processUser(user, { send, today, hour, min }) {
  const { session } = user;
  if (!session || session === "anytime") return;

  const window = SESSION_WINDOWS[session];
  if (!window) return;

  const state = await getSchedulerState(user.user_id);
  if (!state) return;

  // ── SESSION START ─────────────────────────────────────────────────────────
  if (hour === window.start && min === 0 && state.startSent !== today) {
    await setSchedField(user.user_id, "sched_start_sent", today);
    await send(user.chat_id, msgSessionStart(window, user));
  }

  // ── SESSION END ───────────────────────────────────────────────────────────
  if (hour === window.end && min === 0 && state.endSent !== today) {
    const todayCount = await getTodayCount(user.user_id);
    await setSchedField(user.user_id, "sched_end_sent", today);
    await send(user.chat_id, msgSessionEnd(window, todayCount, user));
  }

  // ── RULE PROTECTION — daily trade limit reached ───────────────────────────
  const maxTrades = parseInt(user.max_trades_per_day) || 0;
  if (maxTrades > 0 && state.lockedSent !== today) {
    const todayCount = await getTodayCount(user.user_id);
    if (todayCount >= maxTrades) {
      await setSchedField(user.user_id, "sched_locked_sent", today);
      await send(user.chat_id, msgRuleProtection(maxTrades, user));
    }
  }
}

// ─── Message builders ─────────────────────────────────────────────────────────
// Tone: calm, direct, specific. The trader's own rational voice.
// No emoji storms. No cheerleading. No nagging.

function msgSessionStart(window, user) {
  const lines = [
    `🟢 <b>Your session is starting</b>`,
    ``,
    `${window.label} is now open.`,
    ``,
  ];

  if (user.max_trades_per_day) {
    lines.push(
      `You have <b>${user.max_trades_per_day} trade${user.max_trades_per_day !== "1" ? "s" : ""}</b> today.`,
      `Use them on setups that genuinely meet your criteria.`,
      ``
    );
  }

  if (user.mistake) {
    lines.push(
      `Watch for your pattern today: <i>"${user.mistake}"</i>`,
      ``
    );
  }

  lines.push(`Trade your process.`);
  return lines.join("\n");
}

function msgSessionEnd(window, todayCount, user) {
  const maxTrades = parseInt(user.max_trades_per_day) || 0;
  const lines = [
    `🔴 <b>Your session is over</b>`,
    ``,
    `${window.label} has closed.`,
    ``,
  ];

  if (todayCount > 0) {
    const tradeRef = maxTrades > 0
      ? `${todayCount} of your ${maxTrades} today.`
      : `${todayCount} chart${todayCount !== 1 ? "s" : ""} today.`;
    lines.push(tradeRef, ``);
  }

  lines.push(
    `If you're still watching charts — ask yourself:`,
    `<i>Am I analyzing, or am I looking for one more trade?</i>`,
    ``,
    `The market will be here tomorrow.`
  );

  return lines.join("\n");
}

function msgRuleProtection(maxTrades, user) {
  const lines = [
    `🛑 <b>Daily limit reached</b>`,
    ``,
    `You set a limit of <b>${maxTrades} trade${maxTrades !== 1 ? "s" : ""}</b> per day. You've reached it.`,
    ``,
    `This rule exists because you wrote it when you were thinking clearly.`,
    `The feeling that there's still opportunity is not a reason to override it.`,
    ``,
  ];

  if (user.mistake) {
    lines.push(
      `You told me: <i>"${user.mistake}"</i>`,
      `This is often where that starts.`,
      ``
    );
  }

  lines.push(
    `<b>Close the charts. Your trading day is done.</b>`
  );

  return lines.join("\n");
}

// ─── Utilities (exported for use in bot.js and interventions.js) ──────────────

export function isInSessionWindow(session) {
  const w = SESSION_WINDOWS[session];
  if (!w) return true;
  const h = new Date().getUTCHours();
  return h >= w.start && h < w.end;
}

export function getNextSessionInfo(session) {
  const w = SESSION_WINDOWS[session];
  if (!w) return null;

  const now  = new Date();
  const h    = now.getUTCHours();
  const m    = now.getUTCMinutes();

  if (h >= w.start && h < w.end) {
    const minsLeft = (w.end - h - 1) * 60 + (60 - m);
    return { open: true, minsLeft, label: w.label };
  }

  const minsUntil = h < w.start
    ? (w.start - h - 1) * 60 + (60 - m)
    : (24 - h + w.start - 1) * 60 + (60 - m);

  return { open: false, minsUntil, label: w.label };
}
