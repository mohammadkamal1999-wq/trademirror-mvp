// bot.js — TradeMirror MVP
//
// This is the entire product in one file.
//
// What it does differently from every other trading tool:
//   Old tools:  Trader asks → tool responds
//   TradeMirror: Tool watches → intervenes when patterns emerge
//
// The flow for every chart submission:
//   1. Check daily limit (free: 3/day)
//   2. Run behavioral pattern detection BEFORE analysis
//   3. If a pattern fires → send intervention, pause, continue
//   4. Run Claude Vision analysis with behavioral context baked in
//   5. Save to behavioral memory
//   6. Send assessment with reflection question

import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
dotenv.config();

import {
  getUser, upsertUser, setUserField,
  saveSubmission, getRecentSubmissions, getTodayCount, getTotalCount,
  getTodayInterventionCount, getRules, addRule, deleteRule,
  LIMITS,
} from "./db.js";

import { checkForIntervention, SESSION_LABELS } from "./interventions.js";
import { analyzeChart, formatAssessment, downloadImage, parseCaption } from "./ai.js";

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const pause = ms => new Promise(r => setTimeout(r, ms));
const html  = (chatId, text, extra = {}) =>
  bot.sendMessage(chatId, text, { parse_mode: "HTML", ...extra });

// ── Privileged access ─────────────────────────────────────────────────────────
// Admin and beta users bypass ALL daily limits (analyses + rules).
// Set ADMIN_USER_ID and BETA_USER_IDS in your .env file.
// Get your Telegram ID by messaging @userinfobot on Telegram.

const ADMIN_ID = process.env.ADMIN_USER_ID?.trim() || "";
const BETA_IDS = (process.env.BETA_USER_IDS || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

function isPrivileged(userId) {
  return ADMIN_ID && userId === ADMIN_ID || BETA_IDS.includes(userId);
}

// ─────────────────────────────────────────────────────────────────────────────
// /start — entry point + onboarding router
// ─────────────────────────────────────────────────────────────────────────────

bot.onText(/\/start/, async (msg) => {
  const userId   = String(msg.from.id);
  const chatId   = String(msg.chat.id);
  const name     = msg.from.first_name || "trader";

  await upsertUser(userId, chatId, name);
  const user = await getUser(userId);

  if (user.step === "done") {
    await html(chatId,
      `Welcome back, ${name}.\n\n` +
      `Send me a chart whenever you're ready.\n\n` +
      `Type /help if you need anything.`
    );
    return;
  }

  // Fresh user — start onboarding
  await setUserField(userId, "step", "awaiting_mistake");

  await html(chatId,
    `Hey ${name}. I'm <b>TradeMirror</b>.\n\n` +
    `I'm not a chart analyzer.\n` +
    `I'm not a journal.\n\n` +
    `I watch how you trade — and I interrupt you when you're about to repeat the mistake you always make.\n\n` +
    `Before I can do that, I need to understand one thing.\n\n` +
    `<b>What's the one trading mistake you keep making that you can't seem to stop?</b>\n\n` +
    `Don't overthink it. Just tell me in your own words.`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Text message router — handles onboarding steps
// ─────────────────────────────────────────────────────────────────────────────

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const userId = String(msg.from.id);
  const chatId = String(msg.chat.id);
  const text   = msg.text.trim();

  await upsertUser(userId, chatId, msg.from.first_name || "");
  const user = await getUser(userId);
  if (!user) return;

  // ── Step 1: receive their stated mistake ──────────────────────────────────
  if (user.step === "awaiting_mistake") {
    await setUserField(userId, "mistake", text);
    await setUserField(userId, "step", "awaiting_trigger");

    await html(chatId,
      `Got it.\n\n<i>"${text}"</i>\n\n` +
      `Now — when this happens, what's usually going on right before it? What triggers it?`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "😤 Frustration after a loss",    callback_data: "trigger:frustration" }],
            [{ text: "🔥 Excitement — market moving",  callback_data: "trigger:excitement"  }],
            [{ text: "😴 Boredom — nothing happening", callback_data: "trigger:boredom"     }],
            [{ text: "😰 FOMO — I missed a move",      callback_data: "trigger:fomo"        }],
          ],
        },
      }
    );
    return;
  }

  // ── Post-onboarding: nudge to send a chart ────────────────────────────────
  if (user.step === "done") {
    await html(chatId, `Send me a chart screenshot and I'll assess it.\n\nType /help for commands.`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Callback query handler — onboarding button taps
// ─────────────────────────────────────────────────────────────────────────────

bot.on("callback_query", async (query) => {
  const userId = String(query.from.id);
  const chatId = String(query.message.chat.id);
  const data   = query.data;

  await bot.answerCallbackQuery(query.id);
  const user = await getUser(userId);
  if (!user) return;

  // ── Trigger selection ─────────────────────────────────────────────────────
  if (data.startsWith("trigger:") && user.step === "awaiting_trigger") {
    const trigger = data.split(":")[1];
    await setUserField(userId, "trigger", trigger);
    await setUserField(userId, "step", "awaiting_session");

    const labels = {
      frustration: "Frustration after a loss",
      excitement:  "Excitement when the market is moving",
      boredom:     "Boredom when nothing is happening",
      fomo:        "FOMO when you've missed a move",
    };

    await html(chatId,
      `${labels[trigger]}. That's one of the most common ones.\n\n` +
      `Last question: <b>when do you do most of your trading?</b>`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🇬🇧 London  (07:00–12:00 UTC)", callback_data: "session:london"  }],
            [{ text: "🇺🇸 New York (13:00–18:00 UTC)", callback_data: "session:newyork" }],
            [{ text: "🌏 Asian   (00:00–05:00 UTC)",  callback_data: "session:asian"   }],
            [{ text: "📅 No fixed session",            callback_data: "session:anytime" }],
          ],
        },
      }
    );
    return;
  }

  // ── Session selection — completes onboarding ──────────────────────────────
  if (data.startsWith("session:") && user.step === "awaiting_session") {
    const session = data.split(":")[1];
    await setUserField(userId, "session", session);
    await setUserField(userId, "step", "done");

    const sessionLabel = SESSION_LABELS[session];

    await html(chatId,
      `Here's what I know about you:\n\n` +
      `🔁 <b>Pattern:</b> <i>${user.mistake}</i>\n` +
      `⚡ <b>Trigger:</b> <i>${TRIGGER_LABELS[user.trigger]}</i>\n` +
      `⏰ <b>Session:</b> <i>${sessionLabel}</i>\n\n` +
      `I'm going to watch for this.\n` +
      `When I see the pattern starting, I'll interrupt you.\n\n` +
      `<b>You may not like it when I do. That's the point.</b>\n\n` +
      `Send me a chart when you're ready.`
    );

    await pause(1500);

    await html(chatId,
      `<b>Commands to know:</b>\n\n` +
      `/setrule [text] — add a personal rule I'll check every analysis\n` +
      `/rules — view your rules\n` +
      `/stats — today's discipline score\n` +
      `/profile — your behavioral profile\n` +
      `/plan — current plan\n` +
      `/help — all commands`
    );

    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Photo handler — the core product loop
// ─────────────────────────────────────────────────────────────────────────────

bot.on("photo", async (msg) => {
  const userId  = String(msg.from.id);
  const chatId  = String(msg.chat.id);
  const caption = msg.caption || "";

  await upsertUser(userId, chatId, msg.from.first_name || "");
  const user = await getUser(userId);

  // Must complete onboarding first
  if (!user || user.step !== "done") {
    await html(chatId,
      `Let's finish setting up your profile first — it makes the interventions much more accurate.\n\n` +
      `/start`
    );
    return;
  }

  // ── Daily limit check ─────────────────────────────────────────────────────
  const todayCount = await getTodayCount(userId);
  const limit      = LIMITS[user.plan]?.daily ?? 3;

  if (todayCount >= limit && !isPrivileged(userId)) {
    if (user.plan === "free") {
      await html(chatId,
        `You've used all ${limit} free analyses for today.\n\n` +
        `<b>Upgrade to Pro ($4.99/month)</b> for 20 analyses/day, proactive behavioral alerts, and your weekly pattern review.\n\n` +
        `That's less than one bad trade costs you.\n\n` +
        `/plan`
      );
    } else {
      await html(chatId, `Daily limit reached (${limit}). Resets at midnight UTC.`);
    }
    return;
  }

  // ── Behavioral intervention check ─────────────────────────────────────────
  // This runs BEFORE the analysis. This is the product.
  const intervention = await checkForIntervention(user);
  if (intervention) {
    await html(chatId, intervention);
    await pause(1200); // Let it land before the analysis follows
  }

  // ── Analysis ──────────────────────────────────────────────────────────────
  await bot.sendChatAction(chatId, "typing");

  try {
    const photos    = msg.photo;
    const fileId    = photos[photos.length - 1].file_id;
    const fileLink  = await bot.getFileLink(fileId);
    const imageB64  = await downloadImage(fileLink);

    const { instrument, direction } = parseCaption(caption);
    const rules    = await getRules(userId);
    const recent   = await getRecentSubmissions(userId, 240); // 4-hour session window
    const sessionN = recent.length + 1; // +1 for this submission

    const result = await analyzeChart({
      imageBase64: imageB64,
      caption,
      rules,
      user,
      sessionCount: sessionN,
    });

    await saveSubmission(userId, {
      instrument,
      direction,
      caption,
      assessment: result.raw || "",
      violated:   result.violated || [],
    });

    await html(chatId, formatAssessment(result, caption));

    // ── Soft upgrade nudge after final free analysis ──────────────────────
    if (user.plan === "free" && todayCount + 1 >= limit && !isPrivileged(userId)) {
      await pause(1000);
      await html(chatId,
        `<i>That was your last free analysis today.</i>\n\n` +
        `Pro gives you 20/day and I'll start alerting you proactively — before you even send the chart — when your behavioral patterns shift.\n\n` +
        `/plan`
      );
    }

  } catch (err) {
    console.error("Photo error:", err);
    await html(chatId, "⚠️ Something went wrong. Please try again.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

bot.onText(/\/help/, async (msg) => {
  await html(msg.chat.id,
    `<b>TradeMirror — Commands</b>\n\n` +
    `📸 <b>Send a chart</b> — get an assessment + reflection question\n\n` +
    `📋 <b>Rules</b>\n` +
    `/setrule [text] — add a rule\n` +
    `/rules — view your rules\n` +
    `/delrule [number] — remove a rule\n\n` +
    `📊 <b>Behavior</b>\n` +
    `/stats — today's discipline score\n` +
    `/profile — your behavioral profile\n\n` +
    `⚙️ <b>Account</b>\n` +
    `/plan — your plan + upgrade\n` +
    `/start — redo onboarding`
  );
});

bot.onText(/\/setrule (.+)/, async (msg, match) => {
  const userId = String(msg.from.id);
  const user   = await getUser(userId);
  const rules  = await getRules(userId);
  const limit  = LIMITS[user?.plan || "free"].rules;

  if (rules.length >= limit && !isPrivileged(userId)) {
    await html(msg.chat.id,
      `You've hit the rule limit for your plan (${limit} rules).\n\n` +
      `Upgrade to Pro for unlimited rules. /plan`
    );
    return;
  }

  const ruleText = match[1].trim();
  await addRule(userId, ruleText);
  await html(msg.chat.id, `✅ Rule saved:\n<i>"${ruleText}"</i>\n\nChecked on every analysis from now on.`);
});

bot.onText(/\/rules/, async (msg) => {
  const userId = String(msg.from.id);
  const rules  = await getRules(userId);

  if (rules.length === 0) {
    await html(msg.chat.id,
      `No rules set yet.\n\n` +
      `Add your first:\n<code>/setrule Only trade London session</code>`
    );
    return;
  }

  const list = rules.map((r, i) => `${i + 1}. ${r.text}`).join("\n");
  await html(msg.chat.id,
    `<b>Your Rules:</b>\n\n${list}\n\n` +
    `Remove one: /delrule [number]`
  );
});

bot.onText(/\/delrule (\d+)/, async (msg, match) => {
  const userId = String(msg.from.id);
  const rules  = await getRules(userId);
  const idx    = parseInt(match[1]) - 1;

  if (idx < 0 || idx >= rules.length) {
    await html(msg.chat.id, `Rule not found. Check /rules for the list.`);
    return;
  }

  const rule = rules[idx];
  await deleteRule(userId, rule.id);
  await html(msg.chat.id, `🗑️ Removed: <i>"${rule.text}"</i>`);
});

bot.onText(/\/stats/, async (msg) => {
  const userId = String(msg.from.id);
  const chatId = msg.chat.id;

  const [todayCount, interventions, rules, total] = await Promise.all([
    getTodayCount(userId),
    getTodayInterventionCount(userId),
    getRules(userId),
    getTotalCount(userId),
  ]);

  const user  = await getUser(userId);
  const limit = isPrivileged(userId) ? 999 : LIMITS[user?.plan || "free"].daily;

  // Score: start at 100, penalize rule violations and interventions fired
  const recentSubs  = await getRecentSubmissions(userId, 24 * 60);
  let violations = 0;
  recentSubs.forEach(s => {
    try { violations += JSON.parse(s.violated || "[]").length; } catch {}
  });

  const score = Math.max(0, 100 - violations * 15 - interventions * 10);
  const filled = Math.round(score / 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);

  await html(chatId,
    `<b>Today's Discipline Score</b>\n\n` +
    `[${bar}] <b>${score}/100</b>\n\n` +
    `Charts today: ${todayCount} / ${limit === 999 ? "∞" : limit}\n` +
    `Rule violations flagged: ${violations}\n` +
    `Interventions fired: ${interventions}\n` +
    `Total analyses all-time: ${total}\n\n` +
    (score >= 80 ? `<i>Clean session.</i>` :
     score >= 50 ? `<i>Watch your patterns today.</i>` :
                   `<i>Your behavioral patterns are active. Consider stopping.</i>`)
  );
});

bot.onText(/\/profile/, async (msg) => {
  const userId = String(msg.from.id);
  const user   = await getUser(userId);
  const chatId = msg.chat.id;

  if (!user || user.step !== "done") {
    await html(chatId, `Complete your setup first: /start`);
    return;
  }

  const [rules, total] = await Promise.all([
    getRules(userId),
    getTotalCount(userId),
  ]);

  await html(chatId,
    `<b>Your Behavioral Profile</b>\n\n` +
    `🔁 Pattern: <i>${user.mistake || "Not set"}</i>\n` +
    `⚡ Trigger: <i>${TRIGGER_LABELS[user.trigger] || "Not set"}</i>\n` +
    `⏰ Session: <i>${SESSION_LABELS[user.session] || "Not set"}</i>\n\n` +
    `Rules set: ${rules.length}\n` +
    `Total analyses: ${total}\n` +
    `Plan: <b>${(user.plan || "free").toUpperCase()}</b>\n\n` +
    `To update your profile: /start`
  );
});

bot.onText(/\/plan/, async (msg) => {
  const userId = String(msg.from.id);
  const user   = await getUser(userId);
  const plan   = user?.plan || "free";
  const chatId = msg.chat.id;

  await html(chatId,
    `<b>TradeMirror Plans</b>\n\n` +
    (plan !== "free" ? `You're on <b>${plan.toUpperCase()}</b> ✓\n\n` : "") +
    `<b>Free — Mirror</b>\n` +
    `• 3 chart analyses/day\n` +
    `• 5 personal rules\n` +
    `• Rule checking on every analysis\n` +
    `• Reflection question every time\n\n` +
    `<b>Pro — $4.99/month</b>\n` +
    `• 20 analyses/day\n` +
    `• Unlimited personal rules\n` +
    `• Proactive behavioral alerts\n` +
    `  (overtrading, revenge trading, outside session)\n` +
    `• Weekly behavioral review\n` +
    `• Discipline score tracking\n\n` +
    `<b>Elite — $9.99/month</b>\n` +
    `• Unlimited analyses\n` +
    `• Everything in Pro\n` +
    `• Advanced pattern detection\n` +
    `• Monthly performance debrief\n\n` +
    `👉 Upgrade: <a href="${process.env.UPGRADE_URL || "https://trademirror.ai/upgrade"}">trademirror.ai/upgrade</a>`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Dev-only helpers
// ─────────────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV === "development") {
  // Set plan: /setplan pro
  bot.onText(/\/setplan (\w+)/, async (msg, match) => {
    const userId = String(msg.from.id);
    const plan   = match[1];
    if (!["free","pro","elite"].includes(plan)) return;
    const { setUserField } = await import("./db.js");
    await setUserField(userId, "plan", plan);
    await html(msg.chat.id, `✅ Plan set to ${plan}`);
  });

  // Reset onboarding: /reset
  bot.onText(/\/reset/, async (msg) => {
    const userId = String(msg.from.id);
    const { setUserField } = await import("./db.js");
    await setUserField(userId, "step", "new");
    await setUserField(userId, "mistake", "");
    await setUserField(userId, "trigger", "");
    await html(msg.chat.id, `♻️ Onboarding reset. /start`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants + startup
// ─────────────────────────────────────────────────────────────────────────────

const TRIGGER_LABELS = {
  frustration: "Frustration after a loss",
  excitement:  "Excitement from fast moves",
  boredom:     "Boredom in slow markets",
  fomo:        "FOMO from missed moves",
};

import { getDb } from "./db.js";
getDb().then(() => {
  console.log("🪞  TradeMirror MVP is running");
  console.log("    Behavioral intervention system active");
  console.log("    Waiting for traders...");
});
