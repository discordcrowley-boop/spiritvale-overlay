const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const MAX_SESSIONS = 400;

function logPath() {
  return path.join(app.getPath("userData"), "overlay-sessions.json");
}

function readLog() {
  try {
    const data = JSON.parse(fs.readFileSync(logPath(), "utf8"));
    return Array.isArray(data.sessions) ? data.sessions : [];
  } catch {
    return [];
  }
}

function writeLog(sessions) {
  fs.mkdirSync(path.dirname(logPath()), { recursive: true });
  fs.writeFileSync(
    logPath(),
    JSON.stringify({ sessions, updatedAt: new Date().toISOString() }, null, 2),
  );
}

function dateKey(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "unknown";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function meaningful(snap = {}) {
  const farm = snap.farm || {};
  const gold = Number(farm.gold) || 0;
  const xp = Number(farm.xp) || 0;
  const damage = Number(snap.totalDamage) || 0;
  const elapsed = Number(snap.elapsedMs) || 0;
  return gold > 0 || xp > 0 || damage > 0 || elapsed >= 20_000;
}

function summarizeSnapshot(snap = {}, reason = "stop") {
  const farm = snap.farm || {};
  const startedAt = snap.startedAt
    ? new Date(snap.startedAt).toISOString()
    : new Date(Date.now() - (Number(snap.elapsedMs) || 0)).toISOString();
  const endedAt = new Date().toISOString();
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    reason,
    mode: snap.mode || "live",
    startedAt,
    endedAt,
    date: dateKey(endedAt),
    elapsedMs: Math.max(0, Number(snap.elapsedMs) || 0),
    totalDamage: Math.max(0, Math.round(Number(snap.totalDamage) || 0)),
    totalDps: Math.max(0, Math.round(Number(snap.totalDps) || 0)),
    totalHealing: Math.max(0, Math.round(Number(snap.totalHealing) || 0)),
    gold: Math.max(0, Math.round(Number(farm.gold) || 0)),
    goldPerHour: Math.max(0, Math.round(Number(farm.goldPerHour) || 0)),
    xp: Math.max(0, Math.round(Number(farm.xp) || 0)),
    xpPerHour: Math.max(0, Math.round(Number(farm.xpPerHour) || 0)),
    kills: Math.max(0, Math.round(Number(farm.kills) || 0)),
    drops: Array.isArray(farm.drops) ? farm.drops.length : 0,
  };
}

function recordSession(snap, reason = "stop") {
  if (!meaningful(snap)) return null;
  const entry = summarizeSnapshot(snap, reason);
  const sessions = [entry, ...readLog()].slice(0, MAX_SESSIONS);
  writeLog(sessions);
  return entry;
}

function listSessionsByDate() {
  const sessions = readLog();
  const byDate = new Map();
  for (const row of sessions) {
    const key = row.date || dateKey(row.endedAt || row.startedAt);
    if (!byDate.has(key)) {
      byDate.set(key, {
        date: key,
        sessions: [],
        totals: {
          gold: 0,
          xp: 0,
          damage: 0,
          kills: 0,
          elapsedMs: 0,
          count: 0,
        },
      });
    }
    const bucket = byDate.get(key);
    bucket.sessions.push(row);
    bucket.totals.gold += Number(row.gold) || 0;
    bucket.totals.xp += Number(row.xp) || 0;
    bucket.totals.damage += Number(row.totalDamage) || 0;
    bucket.totals.kills += Number(row.kills) || 0;
    bucket.totals.elapsedMs += Number(row.elapsedMs) || 0;
    bucket.totals.count += 1;
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

function clearSessions() {
  writeLog([]);
  return [];
}

module.exports = {
  recordSession,
  listSessionsByDate,
  clearSessions,
  meaningful,
};
