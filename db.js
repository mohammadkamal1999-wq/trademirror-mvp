// db.js — TradeMirror behavioral memory
//
// We store three things:
//   1. User profile  — who they are, what their mistake is, their trigger, their session
//   2. Submissions   — every chart they send (timestamp, instrument, direction, gap since last)
//   3. Interventions — every time we interrupted them (so we don't repeat ourselves)
//
// We do NOT store: P&L, broker data, trade outcomes.
// Everything we know comes from behavioral signals alone.

import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let _db = null;

export async function getDb() {
  if (_db) return _db;

  _db = await open({
    filename: path.join(__dirname, "trademirror.db"),
    driver: sqlite3.Database,
  });

  await _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id      TEXT PRIMARY KEY,
      chat_id      TEXT NOT NULL,
      first_name   TEXT DEFAULT '',
      plan         TEXT DEFAULT 'free',
      step         TEXT DEFAULT 'new',
      mistake      TEXT DEFAULT '',
      trigger      TEXT DEFAULT '',
      session      TEXT DEFAULT 'anytime',
      created_at   TEXT DEFAULT (datetime('now')),
      last_seen    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT NOT NULL,
      instrument   TEXT DEFAULT '',
      direction    TEXT DEFAULT '',
      caption      TEXT DEFAULT '',
      assessment   TEXT DEFAULT '',
      violated     TEXT DEFAULT '[]',
      gap_mins     INTEGER DEFAULT 0,
      ts           TEXT DEFAULT (datetime('now')),
      day          TEXT DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS interventions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT NOT NULL,
      type         TEXT NOT NULL,
      ts           TEXT DEFAULT (datetime('now')),
      day          TEXT DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS rules (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT NOT NULL,
      text         TEXT NOT NULL,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sub_user_day ON submissions(user_id, day);
    CREATE INDEX IF NOT EXISTS idx_int_user_day ON interventions(user_id, day);
  `);
  try {
    await _db.exec(`
      ALTER TABLE users ADD COLUMN sched_start_sent TEXT DEFAULT '';
    `);
  } catch {}

  try {
    await _db.exec(`
      ALTER TABLE users ADD COLUMN sched_end_sent TEXT DEFAULT '';
    `);
  } catch {}

  try {
    await _db.exec(`
      ALTER TABLE users ADD COLUMN sched_locked_sent TEXT DEFAULT '';
    `);
  } catch {}
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function getUser(userId) {
  const db = await getDb();
  return db.get("SELECT * FROM users WHERE user_id = ?", [userId]);
}

export async function upsertUser(userId, chatId, firstName) {
  const db = await getDb();
  await db.run(`
    INSERT INTO users (user_id, chat_id, first_name)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      chat_id   = excluded.chat_id,
      last_seen = datetime('now')
  `, [userId, chatId, firstName || ""]);
}

export async function setUserField(userId, field, value) {
  const db = await getDb();
  await db.run(`UPDATE users SET ${field} = ? WHERE user_id = ?`, [value, userId]);
}

// ─── Submissions ──────────────────────────────────────────────────────────────

export async function saveSubmission(userId, data) {
  const db = await getDb();

  // Calculate gap since last submission
  const last = await db.get(
    "SELECT ts FROM submissions WHERE user_id = ? ORDER BY ts DESC LIMIT 1",
    [userId]
  );
  const gapMins = last
    ? Math.round((Date.now() - new Date(last.ts)) / 60000)
    : 0;

  await db.run(`
    INSERT INTO submissions (user_id, instrument, direction, caption, assessment, violated, gap_mins)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    userId,
    data.instrument || "",
    data.direction  || "",
    data.caption    || "",
    data.assessment || "",
    JSON.stringify(data.violated || []),
    gapMins,
  ]);
}

// All submissions in the last N minutes (rolling session window)
export async function getRecentSubmissions(userId, withinMins = 90) {
  const db = await getDb();
  const cutoff = new Date(Date.now() - withinMins * 60000).toISOString();
  return db.all(
    "SELECT * FROM submissions WHERE user_id = ? AND ts > ? ORDER BY ts ASC",
    [userId, cutoff]
  );
}

// Today's submissions
export async function getTodayCount(userId) {
  const db = await getDb();
  const today = new Date().toISOString().split("T")[0];
  const row = await db.get(
    "SELECT COUNT(*) as n FROM submissions WHERE user_id = ? AND day = ?",
    [userId, today]
  );
  return row?.n || 0;
}

// All-time count — tells us how much history we have
export async function getTotalCount(userId) {
  const db = await getDb();
  const row = await db.get(
    "SELECT COUNT(*) as n FROM submissions WHERE user_id = ?",
    [userId]
  );
  return row?.n || 0;
}

// Returns all users who completed onboarding
export async function getAllActiveUsers() {
  const db = await getDb();
  return db.all(
    "SELECT * FROM users WHERE step = 'done'"
  );
}

// Read scheduler state
export async function getSchedulerState(userId) {
  const db = await getDb();
  const row = await db.get(
    "SELECT sched_start_sent, sched_end_sent, sched_locked_sent FROM users WHERE user_id = ?",
    [userId]
  );

  if (!row) return null;

  return {
    startSent: row.sched_start_sent || "",
    endSent: row.sched_end_sent || "",
    lockedSent: row.sched_locked_sent || "",
  };
}

// Write scheduler state
export async function setSchedField(userId, field, value) {
  const db = await getDb();

  await db.run(
    `UPDATE users SET ${field} = ? WHERE user_id = ?`,
    [value, userId]
  );
}

// ─── Interventions ────────────────────────────────────────────────────────────

// Was this intervention type already sent today? Prevents repeating ourselves.
export async function alreadySentToday(userId, type) {
  const db = await getDb();
  const today = new Date().toISOString().split("T")[0];
  const row = await db.get(
    "SELECT id FROM interventions WHERE user_id = ? AND type = ? AND day = ?",
    [userId, type, today]
  );
  return !!row;
}

export async function logIntervention(userId, type) {
  const db = await getDb();
  await db.run(
    "INSERT INTO interventions (user_id, type) VALUES (?, ?)",
    [userId, type]
  );
}

// How many interventions fired today?
export async function getTodayInterventionCount(userId) {
  const db = await getDb();
  const today = new Date().toISOString().split("T")[0];
  const row = await db.get(
    "SELECT COUNT(*) as n FROM interventions WHERE user_id = ? AND day = ?",
    [userId, today]
  );
  return row?.n || 0;
}

// ─── Rules ────────────────────────────────────────────────────────────────────

export async function getRules(userId) {
  const db = await getDb();
  return db.all(
    "SELECT id, text FROM rules WHERE user_id = ? ORDER BY id ASC",
    [userId]
  );
}

export async function addRule(userId, text) {
  const db = await getDb();
  await db.run("INSERT INTO rules (user_id, text) VALUES (?, ?)", [userId, text]);
}

export async function deleteRule(userId, ruleId) {
  const db = await getDb();
  await db.run("DELETE FROM rules WHERE user_id = ? AND id = ?", [userId, ruleId]);
}

// ─── Plan limits ──────────────────────────────────────────────────────────────

export const LIMITS = {
  free:  { daily: 3,   rules: 5   },
  pro:   { daily: 20,  rules: 999 },
  elite: { daily: 999, rules: 999 },
};
