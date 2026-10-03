/**
 * Game loot-filter setting: UpdateLootFilter_S (PlayerController serverRpc).
 *
 * Hash was 33 (shared with ApplyGrimoire_S on PlayerSave) → 37 after 2026-09-21.
 * Distinguish ambiguous hash-only packets by payload shape: loot filter is a
 * fixed 7-byte DTO (3 bools + float32).
 *
 * Settings field order:
 *   LootFilterEquips, LootFilterArtifacts, LootFilterMaterials, LootFilterChance
 */
import { decodeFieldRun } from "@kar-mi/spirit-vale-tools-capture";

export const LOOT_FILTER_RPC_HASH = 37;
export const LOOT_FILTER_RPC_HASHES = new Set([33, 37]);
export const LOOT_FILTER_RPC_NAME = "UpdateLootFilter_S";
export const LOOT_FILTER_DTO_BYTES = 7;

const TOGGLES_THEN_CHANCE = [
  { name: "equips", typeName: "System.Boolean", codec: "boolean" },
  { name: "artifacts", typeName: "System.Boolean", codec: "boolean" },
  { name: "materials", typeName: "System.Boolean", codec: "boolean" },
  { name: "chance", typeName: "System.Single", codec: "float32" },
];

const CHANCE_THEN_TOGGLES = [
  { name: "chance", typeName: "System.Single", codec: "float32" },
  { name: "equips", typeName: "System.Boolean", codec: "boolean" },
  { name: "artifacts", typeName: "System.Boolean", codec: "boolean" },
  { name: "materials", typeName: "System.Boolean", codec: "boolean" },
];

const FIELD_LAYOUTS = [
  { id: "togglesThenChance", fields: TOGGLES_THEN_CHANCE, prefer: 30 },
  { id: "chanceThenToggles", fields: CHANCE_THEN_TOGGLES, prefer: 10 },
];

function readFields(buffer, layout) {
  try {
    const run = decodeFieldRun(buffer, layout);
    if (!run?.complete && run?.consumed !== buffer.length) return null;
    const out = {};
    for (const field of run.fields || []) out[field.name] = field.value;
    out.__consumed = run.consumed ?? buffer.length;
    return out;
  } catch {
    return null;
  }
}

/** Normalize wire chance to percent units used by the settings slider (0–100). */
export function chanceToPercent(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  const pct = n > 0 && n <= 1 ? n * 100 : n;
  if (pct > 100) return null;
  if (pct > 0 && pct < 0.01) return null;
  return Math.round(pct * 100) / 100;
}

function scoreLayout(parsed, prefer = 0, payloadLen = 0) {
  if (!parsed || parsed.chance == null) return -1;
  const pct = chanceToPercent(parsed.chance);
  if (pct == null) return -1;
  let score = 10 + prefer;
  if (payloadLen && parsed.__consumed === payloadLen) score += 8;
  if (payloadLen === LOOT_FILTER_DTO_BYTES && parsed.__consumed === LOOT_FILTER_DTO_BYTES) score += 6;
  const rounded = Math.round(pct);
  if (Math.abs(pct - rounded) < 0.051) score += 10;
  else if (Math.abs(pct * 10 - Math.round(pct * 10)) < 0.051) score += 5;
  const frac = Math.abs(pct - Math.round(pct));
  if (frac > 0.15 && frac < 0.85) score -= 12;
  if (typeof parsed.equips === "boolean") score += 2;
  if (typeof parsed.artifacts === "boolean") score += 2;
  if (typeof parsed.materials === "boolean") score += 2;
  return score;
}

function fromDecodedFields(packet) {
  const fields = packet?.decodedFields || [];
  if (!fields.length) return null;
  const byTail = new Map();
  for (const field of fields) {
    const key = String(field?.name || "")
      .split(".")
      .pop()
      .toLowerCase();
    byTail.set(key, field.value);
  }
  const chance =
    byTail.get("lootfilterchance") ??
    byTail.get("chance") ??
    byTail.get("threshold") ??
    byTail.get("maxchance") ??
    byTail.get("minchance");
  if (chance == null) return null;
  return {
    chance: Number(chance),
    equips: Boolean(byTail.get("lootfilterequips") ?? byTail.get("equips") ?? true),
    artifacts: Boolean(byTail.get("lootfilterartifacts") ?? byTail.get("artifacts") ?? true),
    materials: Boolean(byTail.get("lootfiltermaterials") ?? byTail.get("materials") ?? true),
    __consumed: null,
  };
}

function behaviourName(packet) {
  return String(
    packet?.networkBehaviourType ||
      packet?.behaviourType ||
      packet?.networkBehaviourName ||
      packet?.objectName ||
      "",
  );
}

function packetHashes(packet) {
  return [packet?.rpcHash, packet?.registeredRpcHash]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
}

function looksLikeStringPayload(buffer) {
  if (!buffer?.length) return false;
  // ApplyGrimoire_S starts with a packed string length, not three 0/1 bools + float.
  try {
    const run = decodeFieldRun(buffer, [
      { name: "uid", typeName: "System.String", codec: "stringUtf8Packed" },
    ]);
    return Boolean(run?.complete && typeof run.fields?.[0]?.value === "string");
  } catch {
    return false;
  }
}

/**
 * Candidate packets: named UpdateLootFilter_S, or loot-filter hash serverRpc that is not
 * ApplyGrimoire / PlayerSave. Hash-only is allowed — capture often omits rpcName.
 */
export function isLootFilterPacket(packet) {
  if (!packet) return false;
  const name = String(packet.rpcName || "");
  if (name === LOOT_FILTER_RPC_NAME) return true;
  if (name === "ApplyGrimoire_S") return false;
  if (name && name !== LOOT_FILTER_RPC_NAME) return false;
  if (/PlayerSave/i.test(behaviourName(packet))) return false;

  const hashes = packetHashes(packet);
  if (!hashes.some((hash) => LOOT_FILTER_RPC_HASHES.has(hash))) return false;

  const kind = String(packet.packetName || packet.packetKind || "");
  if (kind && kind !== "serverRpc" && kind !== "rpcLink") return false;

  const payload = packet.payload;
  if (payload?.length && looksLikeStringPayload(payload)) return false;
  return true;
}

function decodeFromPayload(payload) {
  if (!payload?.length) return null;
  // Exact DTO, or DTO with a tiny leading/trailing pad.
  const windows = [];
  if (payload.length === LOOT_FILTER_DTO_BYTES) windows.push({ buf: payload, tag: "" });
  if (payload.length > LOOT_FILTER_DTO_BYTES) {
    windows.push({ buf: payload.subarray(0, LOOT_FILTER_DTO_BYTES), tag: ":head7" });
    windows.push({
      buf: payload.subarray(payload.length - LOOT_FILTER_DTO_BYTES),
      tag: ":tail7",
    });
  }
  if (payload.length === LOOT_FILTER_DTO_BYTES + 1) {
    windows.push({ buf: payload.subarray(1), tag: ":skip1" });
  }

  let best = null;
  let bestScore = -1;
  let layout = "";
  for (const window of windows) {
    for (const entry of FIELD_LAYOUTS) {
      const parsed = readFields(window.buf, entry.fields);
      const score = scoreLayout(parsed, entry.prefer, window.buf.length);
      if (score > bestScore) {
        best = parsed;
        bestScore = score;
        layout = `${entry.id}${window.tag}`;
      }
    }
  }
  if (!best || bestScore < 0) return null;
  const chancePercent = chanceToPercent(best.chance);
  if (chancePercent == null) return null;
  return {
    chance: Number(best.chance),
    chancePercent,
    equips: best.equips !== false,
    artifacts: best.artifacts !== false,
    materials: best.materials !== false,
    layout,
  };
}

/**
 * @returns {{
 *   chance: number,
 *   chancePercent: number,
 *   equips: boolean,
 *   artifacts: boolean,
 *   materials: boolean,
 *   layout: string,
 * } | null}
 */
export function decodeLootFilter(packet) {
  if (!packet || !isLootFilterPacket(packet)) return null;

  const fromFields = fromDecodedFields(packet);
  const fieldScore = scoreLayout(fromFields, 0);
  const fromPayload = decodeFromPayload(packet.payload);

  if (fromPayload && (!fromFields || (fromPayload.layout && fieldScore < 20))) {
    return fromPayload;
  }
  if (fromFields && fieldScore >= 0) {
    const chancePercent = chanceToPercent(fromFields.chance);
    if (chancePercent == null) return fromPayload;
    return {
      chance: Number(fromFields.chance),
      chancePercent,
      equips: fromFields.equips !== false,
      artifacts: fromFields.artifacts !== false,
      materials: fromFields.materials !== false,
      layout: "decodedFields",
    };
  }
  return fromPayload;
}

export function passesLootFilter(filter, { dropRatePercent = null, category = null } = {}) {
  if (!filter) return true;
  const cat = String(category || "").toLowerCase();
  if (cat === "equipment" || cat === "equip" || cat === "card" || cat === "gem") {
    if (filter.equips === false) return false;
  } else if (cat === "artifact") {
    if (filter.artifacts === false) return false;
  } else if (cat === "material" || cat === "consumable") {
    if (filter.materials === false) return false;
  }
  if (dropRatePercent == null || !Number.isFinite(Number(dropRatePercent))) return true;
  return Number(dropRatePercent) <= Number(filter.chancePercent) + 1e-6;
}
