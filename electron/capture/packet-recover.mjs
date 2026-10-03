/**
 * Official capture drops leftover-byte RPCs (rpcName never set). Recover the
 * ones All The Things and player names depend on. Never attach worn cosmetics
 * or wardrobe slots — those were being logged as farm loot.
 *
 * Wire hashes shifted in the 2026-09-21 game build (capture@3.0.3). Keep both
 * old and new hashes so leftover recovery still works across versions.
 */
import { decodeFieldRun, characterDataParameter } from "@kar-mi/spirit-vale-tools-capture";

export const RECOVER_RPC_BY_HASH = {
  // LoadCharacter_T (targetRpc): was 7 → 10
  7: "LoadCharacter_T",
  10: "LoadCharacter_T",
  // UpdateLootFilter_S (serverRpc): was 33 → 37
  33: "UpdateLootFilter_S",
  37: "UpdateLootFilter_S",
  // CharacterCallback_T (targetRpc): was 59/60 → 72/73
  59: "CharacterCallback_T",
  60: "CharacterCallback_T",
  72: "CharacterCallback_T",
  73: "CharacterCallback_T",
};

const LOAD_CHARACTER_HASHES = new Set([7, 10]);
const CHARACTER_CALLBACK_HASHES = new Set([59, 60, 72, 73]);

const KEEP_FIELD =
  /\.(UID|AccountId|Name|Level|Exp|JobLevel|JobExp|Coins|Attributes\[\d+\]|Inventory\.(Equips|Artifacts|Cards|Gems|Junks|Consumables|Currencies)(\.|$)|Appearance\.Archetype$|Archetypes(\[\d+\])?$)/;

export function recoverPacketRpc(packet) {
  if (!packet || packet.rpcName) return packet;
  const hash = [packet.rpcHash, packet.registeredRpcHash]
    .map((value) => Number(value))
    .find((value) => RECOVER_RPC_BY_HASH[value]);
  const name = RECOVER_RPC_BY_HASH[hash];
  if (!name) return packet;
  packet.rpcName = name;
  return packet;
}

function callbackStartOffsets(payload) {
  const starts = new Set([0, 1, 4]);
  try {
    const typeRun = decodeFieldRun(payload, [{ name: "type", typeName: "System.Int32", codec: "packedInt32" }]);
    if (typeRun.complete) starts.add(typeRun.consumed);
  } catch {
    /* keep fallbacks */
  }
  return [...starts].sort((left, right) => right - left);
}

function identityParameter(full) {
  const fields = full.fields || [];
  const nameIndex = fields.findIndex((field) => field.name === "Name");
  return {
    ...full,
    fields: nameIndex >= 0 ? fields.slice(0, nameIndex + 1) : fields.slice(0, 6),
  };
}

function economyParameters(withCoins = false) {
  const params = [
    { name: "Level", typeName: "System.Int32", codec: "packedInt32" },
    { name: "Exp", typeName: "System.Int32", codec: "packedInt32" },
    { name: "JobLevel", typeName: "System.Int32", codec: "packedInt32" },
    { name: "JobExp", typeName: "System.Int32", codec: "packedInt32" },
  ];
  if (withCoins) {
    params.push({ name: "Coins", typeName: "System.Int64", codec: "packedInt64" });
  }
  return params;
}

function looksLikeEconomy(fields, prefix) {
  const get = (tail) =>
    fields.find((field) => String(field.name || "") === `${prefix}.${tail}` || String(field.name || "") === tail)
      ?.value;
  const level = Number(get("Level"));
  const exp = Number(get("Exp"));
  const jobLevel = Number(get("JobLevel"));
  const jobExp = Number(get("JobExp"));
  const coinsRaw = get("Coins");
  const coinsOk =
    coinsRaw == null ||
    (Number.isFinite(Number(coinsRaw)) && Number(coinsRaw) >= 0) ||
    (typeof coinsRaw === "bigint" && coinsRaw >= 0n);
  return (
    Number.isInteger(level) &&
    level >= 1 &&
    level <= 250 &&
    Number.isFinite(exp) &&
    exp >= 0 &&
    Number.isInteger(jobLevel) &&
    jobLevel >= 1 &&
    jobLevel <= 250 &&
    Number.isFinite(jobExp) &&
    jobExp >= 0 &&
    coinsOk
  );
}

function scanEconomyFields(payload, startOffset, prefix) {
  const begin = Math.max(0, startOffset);
  const end = Math.min(payload.length - 1, begin + 1200);
  for (const withCoins of [true, false]) {
    const params = economyParameters(withCoins);
    for (let offset = begin; offset < end; offset += 1) {
      const run = decodeFieldRun(payload, params, offset);
      if (!run.fields?.length) continue;
      const fields = run.fields.map((field) => ({
        ...field,
        name: String(field.name || "").includes(".") ? field.name : `${prefix}.${field.name}`,
      }));
      if (looksLikeEconomy(fields, prefix)) return fields;
    }
  }
  return [];
}

function keepRecoveredField(field) {
  const name = String(field?.name || "");
  // Keep class identity — strip the rest of Appearance / wardrobe cosmetics.
  if (/\.Appearance\.Archetype$/i.test(name) || /\.Archetypes(\[\d+\])?$/i.test(name)) return true;
  if (/\.(Appearance|EquipAppearance|Cosmetics|ChatBubble|Badge|Title)\b/.test(name)) return false;
  if (/\.Inventory\.Cosmetics(\.|$)/.test(name)) return false;
  return KEEP_FIELD.test(name);
}

export function recoverCharacterFields(packet) {
  const name = packet?.rpcName;
  const hash = Number(packet?.rpcHash);
  const isLoad = name === "LoadCharacter_T" || LOAD_CHARACTER_HASHES.has(hash);
  const isCallback = name === "CharacterCallback_T" || CHARACTER_CALLBACK_HASHES.has(hash);
  if (!packet?.payload || (!isLoad && !isCallback)) return packet;
  if ((packet.decodedFields || []).some((field) => /\.(UID|Name|Level|Exp)\b/.test(String(field?.name || "")))) {
    packet.decodedFields = (packet.decodedFields || []).filter(keepRecoveredField);
    return packet;
  }
  try {
    const dataParam = characterDataParameter();
    const identityParam = identityParameter(dataParam);
    const starts = isCallback ? callbackStartOffsets(packet.payload) : [0];
    const prefix = isCallback ? "sync" : "data";
    let identity = [];
    let consumed = 0;
    for (const start of starts) {
      const run = decodeFieldRun(packet.payload, [identityParam], start);
      const fields = (run.fields || []).map((field) =>
        isCallback
          ? { ...field, name: String(field.name || "").replace(/^data\b/, "sync") }
          : field,
      );
      const uid = fields.find((field) => /\.UID$/.test(String(field.name || "")))?.value;
      const display = fields.find((field) => /\.Name$/.test(String(field.name || "")))?.value;
      if (
        typeof uid === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid) &&
        typeof display === "string" &&
        display.trim()
      ) {
        identity = fields;
        consumed = run.consumed;
        break;
      }
    }
    const economy = scanEconomyFields(packet.payload, consumed, prefix);
    const kept = [...identity, ...economy].filter(keepRecoveredField);
    if (!kept.length) return packet;
    packet.decodedFields = [...(packet.decodedFields || []).filter(keepRecoveredField), ...kept];
    if (!packet.rpcName) packet.rpcName = isLoad ? "LoadCharacter_T" : "CharacterCallback_T";
  } catch {
    /* keep original packet */
  }
  return packet;
}

export function recoverPacket(packet) {
  return recoverCharacterFields(recoverPacketRpc(packet));
}
