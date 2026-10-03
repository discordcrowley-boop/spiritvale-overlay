/** Shared actor-name helpers for the live worker and ATT/DPS tests. */

export function isPlaceholderName(name) {
  const n = String(name || "").trim();
  if (!n) return true;
  if (/^actor\s+-?\d+$/i.test(n)) return true;
  if (/^unidentified(\s*\(\d+\))?$/i.test(n)) return true;
  if (/^resolving/i.test(n)) return true;
  if (/^(player|unknown)$/i.test(n)) return true;
  return false;
}

/** Parse `Unidentified (44190)` → 44190 */
export function actorIdFromLabel(name) {
  const m = String(name || "").match(/unidentified\s*\((-?\d+)\)/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) ? id : null;
}

export function betterName(current, next) {
  if (isPlaceholderName(current) && !isPlaceholderName(next)) return next;
  if (isPlaceholderName(next)) return current || next;
  return current || next;
}

export function actorMergeKey(row) {
  const id = row?.id;
  if (id != null && String(id).trim() !== "" && /^-?\d+$/.test(String(id).trim())) {
    return String(id).trim();
  }
  const fromLabel = actorIdFromLabel(row?.name);
  if (fromLabel != null) return String(fromLabel);
  if (row?.name && !isPlaceholderName(row.name)) return String(row.name);
  return String(id || row?.name || "");
}
