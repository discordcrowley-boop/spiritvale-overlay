/**
 * Pickup decoder that keeps equipment/artifact substats the stock rewards decoder discards.
 * Wire layout matches @kar-mi/spirit-vale-tools-rewards RewardReader (AGPL).
 */
import { FishNetProtocolError, decodeFieldRun } from "@kar-mi/spirit-vale-tools-capture";
import { checkedEnd, readUnsignedPackedWhole, requireBytes } from "@kar-mi/spirit-vale-tools-capture/wire-reader";

export function packetHashes(packet) {
  return [packet?.rpcHash, packet?.registeredRpcHash]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
}

function hasHash(packet, hash) {
  return packetHashes(packet).includes(Number(hash));
}

const EXP_COINS_PARAMS = [
  { name: "exp", typeName: "System.Int32", codec: "packedInt32" },
  { name: "level", typeName: "System.Int32", codec: "packedInt32" },
  { name: "jobExp", typeName: "System.Int32", codec: "packedInt32" },
  { name: "jobLevel", typeName: "System.Int32", codec: "packedInt32" },
  { name: "coins", typeName: "System.Int64", codec: "packedInt64" },
];

function safeCount(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new FishNetProtocolError("reward count exceeds safe integer range");
  }
  return Number(value);
}

class LootReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  finish(_name) {
    // Game patches sometimes append fields. Leftover bytes must not drop the loot.
    return this.offset;
  }

  int32() {
    const value = this.signedPacked();
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < -2147483648 || number > 2147483647) {
      throw new FishNetProtocolError("reward int32 exceeds its wire range");
    }
    return number;
  }

  int64() {
    return this.signedPacked();
  }

  boolean() {
    requireBytes(this.buffer, this.offset, 1, "reward boolean");
    const value = this.buffer[this.offset] ?? 0;
    this.offset += 1;
    if (value !== 0 && value !== 1) {
      throw new FishNetProtocolError(`invalid reward boolean ${value}`);
    }
    return value === 1;
  }

  string() {
    const length = this.int32();
    if (length === -1) return null;
    if (length < -1) throw new FishNetProtocolError(`invalid reward string length ${length}`);
    const end = checkedEnd(this.buffer, this.offset, length);
    const value = this.buffer.toString("utf8", this.offset, end);
    this.offset = end;
    return value;
  }

  list(read) {
    const count = this.int64();
    if (count === -1n) return [];
    if (count < -1n || count > 1_000_000n) {
      throw new FishNetProtocolError(`invalid reward collection count ${count}`);
    }
    const rows = [];
    for (let index = 0; index < Number(count); index += 1) {
      const row = read();
      if (row !== undefined) rows.push(row);
    }
    return rows;
  }

  signedPacked() {
    const decoded = readUnsignedPackedWhole(this.buffer, this.offset);
    this.offset = decoded.nextOffset;
    return decoded.value >> 1n ^ -(decoded.value & 1n);
  }

  inventoryBase() {
    return { id: this.string() };
  }

  stat() {
    if (this.boolean()) return null;
    return {
      type: this.int32(),
      value: this.int32(),
      valueStr: this.string() || "",
    };
  }

  stackable() {
    if (this.boolean()) return { id: null, count: 0 };
    const count = this.int32();
    const { id } = this.inventoryBase();
    this.boolean();
    return { id, count };
  }

  refinable() {
    if (this.boolean()) return { id: null, count: 0 };
    this.string();
    this.int32();
    const { id } = this.inventoryBase();
    this.boolean();
    return { id, count: 1 };
  }

  equipment() {
    if (this.boolean()) return { id: null, count: 0 };
    const substats = this.list(() => this.stat()).filter(Boolean);
    const cards = this.list(() => this.string()).filter((row) => row != null && row !== "");
    const startingPotential = this.int32();
    const spentPotential = this.int32();
    this.int32(); // chaos type
    const uid = this.string();
    const refine = this.int32();
    const { id } = this.inventoryBase();
    this.boolean();
    return {
      id,
      count: 1,
      uid,
      refine,
      startingPotential,
      spentPotential,
      potential: Math.max(0, startingPotential - spentPotential),
      cards,
      substats,
    };
  }

  artifact() {
    if (this.boolean()) return { id: null, count: 0 };
    const substats = this.list(() => this.stat()).filter(Boolean);
    this.int32();
    this.list(() => this.string());
    const uid = this.string();
    this.int32();
    const { id } = this.inventoryBase();
    this.boolean();
    return { id, count: 1, uid, substats, cards: [], refine: 0, potential: null };
  }

  cosmetic() {
    if (this.boolean()) return { id: null, count: 0 };
    this.int32();
    this.boolean();
    const uid = this.string();
    this.int32();
    const { id } = this.inventoryBase();
    this.boolean();
    return { id, count: 1, uid };
  }

  dictionary(category, read, items) {
    try {
      this.list(() => {
        this.string();
        const value = read();
        if (value?.id && value.count > 0 && isRealLootItem(value.id, category)) {
          items.push({ category, itemId: value.id, count: value.count, ...value, id: undefined });
        }
      });
    } catch {
      /* keep items already parsed */
    }
  }

  pickupList() {
    if (this.boolean()) return [];
    const items = [];
    this.list(() => {
      if (this.boolean()) return;
      const type = this.int32();
      const value = this.int64();
      if (value > 0n) {
        items.push({ category: "currency", itemId: `currency:${type}`, count: safeCount(value) });
      }
    });
    this.dictionary("equipment", () => this.equipment(), items);
    this.dictionary("artifact", () => this.artifact(), items);
    this.dictionary("card", () => this.stackable(), items);
    this.dictionary("gem", () => this.refinable(), items);
    this.dictionary("material", () => this.stackable(), items);
    this.dictionary("consumable", () => this.stackable(), items);
    this.dictionary("cosmetic", () => this.cosmetic(), items);
    return items;
  }
}

const PICKUP_RPCS = new Set(["PickupItems_T", "Debug_PickupItems"]);

export function isPickupRpc(name) {
  return PICKUP_RPCS.has(String(name || ""));
}

export function isPickupPacket(packet) {
  if (!packet) return false;
  if (isPickupRpc(packet.rpcName)) return true;
  // PickupItems_T: was 86 → 101
  return hasHash(packet, 86) || hasHash(packet, 101);
}

export function isExpCoinsPacket(packet) {
  if (!packet) return false;
  if (packet.rpcName === "ExpCoinsChanged_T") return true;
  // ExpCoinsChanged_T: was 43 → 53
  return hasHash(packet, 43) || hasHash(packet, 53);
}

export function isCoinsPacket(packet) {
  if (!packet) return false;
  if (packet.rpcName === "CoinsCallback_T") return true;
  // CoinsCallback_T: was 42 → 52
  return hasHash(packet, 42) || hasHash(packet, 52);
}

function readPickupItems(buffer) {
  if (!buffer?.length) return [];
  for (let skip = 0; skip <= 8 && skip < buffer.length; skip += 1) {
    const reader = new LootReader(skip === 0 ? buffer : buffer.subarray(skip));
    try {
      const items = reader.pickupList();
      if (items.length) return items;
    } catch {
      /* try next offset */
    }
  }
  return [];
}

/** Best-effort: pull length-prefixed item id strings out of a pickup payload. */
export function scanPayloadItemIds(buffer) {
  if (!buffer || buffer.length < 3) return [];
  const found = [];
  const seen = new Set();
  for (let offset = 0; offset < buffer.length - 2; offset += 1) {
    try {
      const reader = new LootReader(buffer.subarray(offset));
      const id = reader.string();
      if (!id || id.length < 3 || id.length > 40) continue;
      if (!/[A-Za-z]/.test(id) || /[^\x20-\x7e]/.test(id)) continue;
      if (!isRealLootItem(id, "material", id)) continue;
      const key = id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(id);
      if (found.length >= 12) break;
    } catch {
      /* next byte */
    }
  }
  return found;
}

/**
 * Official RewardReader.finish() throws on leftover bytes, which aborts
 * FishNetMobRewardTracker.consume() and drops pending kills. Trim the known
 * prefix so the stock tracker can attach YOUR pickup/XP again.
 *
 * Only rewrite packets already identified as ExpCoins / Pickup / Coins by name
 * or hash. Blind shape-matching on unnamed rpcLink false-positives (wallet
 * flicker + destroyed chat payloads).
 */
export function prepareRewardPacket(packet) {
  if (!packet?.payload?.length) return packet;
  if (isExpCoinsPacket(packet)) {
    for (let start = 0; start <= 4 && start < packet.payload.length; start += 1) {
      const run = decodeFieldRun(packet.payload, EXP_COINS_PARAMS, start);
      if (expStateFromFields(run.fields || []) && run.consumed > start) {
        packet.payload = packet.payload.subarray(start, run.consumed);
        packet.rpcName = packet.rpcName || "ExpCoinsChanged_T";
        return packet;
      }
    }
    try {
      const reader = new LootReader(packet.payload);
      reader.int32();
      reader.int32();
      reader.int32();
      reader.int32();
      reader.int64();
      if (reader.offset > 0) {
        packet.payload = packet.payload.subarray(0, reader.offset);
        packet.rpcName = packet.rpcName || "ExpCoinsChanged_T";
      }
    } catch {
      /* leave unnamed so official consume does not throw */
    }
    return packet;
  }
  if (isPickupPacket(packet)) {
    for (let skip = 0; skip <= 8 && skip < packet.payload.length; skip += 1) {
      const buf = skip === 0 ? packet.payload : packet.payload.subarray(skip);
      try {
        const reader = new LootReader(buf);
        reader.pickupList();
        if (reader.offset > 0) {
          packet.payload = buf.subarray(0, reader.offset);
          packet.rpcName = packet.rpcName || "PickupItems_T";
          break;
        }
      } catch {
        /* try next offset */
      }
    }
    return packet;
  }
  if (isCoinsPacket(packet)) {
    try {
      const reader = new LootReader(packet.payload);
      reader.int64();
      if (reader.offset > 0) {
        packet.payload = packet.payload.subarray(0, reader.offset);
        packet.rpcName = packet.rpcName || "CoinsCallback_T";
      }
    } catch {
      /* leave unnamed */
    }
  }
  return packet;
}

export function decodePickupItemsDetailed(packet) {
  if (!isPickupPacket(packet) || !packet.payload) return null;
  const items = readPickupItems(packet.payload);
  return { kind: "pickupDetailed", tick: packet.tick, items };
}

function fieldValue(packet, names) {
  const fields = packet?.decodedFields || [];
  const want = names.map((name) => String(name).toLowerCase());
  for (const field of fields) {
    const name = String(field?.name || "").toLowerCase();
    const short = name.split(".").pop();
    if (want.includes(name) || want.includes(short)) return field.value;
  }
  return undefined;
}

function toCoins(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  const number = Number(value);
  return Number.isFinite(number) ? BigInt(Math.max(0, Math.round(number))) : 0n;
}

function expStateFromFields(fields) {
  const get = (name) => fields.find((field) => String(field.name || "").split(".").pop() === name)?.value;
  const experience = Number(get("exp") ?? get("experience"));
  const level = Number(get("level"));
  const jobExperience = Number(get("jobExp") ?? get("jobExperience"));
  const jobLevel = Number(get("jobLevel"));
  const coins = get("coins");
  if (!Number.isInteger(level) || level < 1 || level > 250 || !Number.isFinite(experience) || experience < 0) {
    return null;
  }
  if (coins == null) return null;
  return {
    experience,
    level,
    jobExperience: Number.isFinite(jobExperience) ? jobExperience : 0,
    jobLevel: Number.isInteger(jobLevel) ? jobLevel : 0,
    coins: toCoins(coins),
  };
}

/** Peek ExpCoins wire shape without requiring hash 43 (cold-start wallet seed). */
export function peekExpCoinsState(packet) {
  if (!packet?.payload?.length) return null;
  for (let start = 0; start <= 4 && start < packet.payload.length; start += 1) {
    try {
      const run = decodeFieldRun(packet.payload, EXP_COINS_PARAMS, start);
      const state = expStateFromFields(run.fields || []);
      if (state) return state;
    } catch {
      /* next */
    }
  }
  try {
    const reader = new LootReader(packet.payload);
    const state = {
      experience: reader.int32(),
      level: reader.int32(),
      jobExperience: reader.int32(),
      jobLevel: reader.int32(),
      coins: reader.int64(),
    };
    return expStateFromFields([
      { name: "exp", value: state.experience },
      { name: "level", value: state.level },
      { name: "jobExp", value: state.jobExperience },
      { name: "jobLevel", value: state.jobLevel },
      { name: "coins", value: state.coins },
    ]);
  } catch {
    return null;
  }
}

export function decodeExpCoinsLenient(packet) {
  if (!isExpCoinsPacket(packet)) return null;
  const peeked = peekExpCoinsState(packet);
  if (peeked) return { kind: "experienceState", tick: packet.tick, state: peeked };
  const experience = Number(fieldValue(packet, ["exp", "experience"]));
  const level = Number(fieldValue(packet, ["level"]));
  const jobExperience = Number(fieldValue(packet, ["jobexp", "jobexperience"]));
  const jobLevel = Number(fieldValue(packet, ["joblevel"]));
  const coinsRaw = fieldValue(packet, ["coins"]);
  if (!Number.isFinite(experience) || !Number.isFinite(level) || coinsRaw == null) return null;
  return {
    kind: "experienceState",
    tick: packet.tick,
    state: {
      experience,
      level,
      jobExperience: Number.isFinite(jobExperience) ? jobExperience : 0,
      jobLevel: Number.isFinite(jobLevel) ? jobLevel : 0,
      coins: typeof coinsRaw === "bigint" ? coinsRaw : BigInt(Math.max(0, Number(coinsRaw) || 0)),
    },
  };
}

const PICKUP_BUCKETS = {
  Equips: "equipment",
  Artifacts: "artifact",
  Cards: "card",
  Gems: "gem",
  Junks: "material",
  Consumables: "consumable",
  Cosmetics: "cosmetic",
  Currencies: "currency",
};

const STAT_NOISE = new Set([
  "atk",
  "matk",
  "def",
  "mdef",
  "hit",
  "flee",
  "crit",
  "critrate",
  "critdamage",
  "aspd",
  "cspd",
  "castspd",
  "atkspd",
  "hp",
  "sp",
  "mp",
  "str",
  "agi",
  "vit",
  "int",
  "dex",
  "luk",
  "atkmult",
  "matkmult",
  "defmult",
  "mdefmult",
  "hpmult",
  "mpmult",
  "movespeed",
  "movespd",
  "cooldownrecovery",
  "damagemelee",
  "damagemagic",
  "damageranged",
  "rangeddamage",
  "perfectdodge",
  "mpcost",
  "hpregen",
  "healing",
  "id",
  "count",
  "type",
  "value",
  "uid",
  "refine",
  "potential",
  "weight",
  "range",
  "block",
  "haste",
  "heal",
]);

function compactItemKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function isWardrobeItemId(itemId, extraName, category) {
  const cat = String(category || "").toLowerCase();
  // Real equipment uses Feet_/Leg_-style ids (Power Shoes, Fate Greaves). Never
  // treat known loot categories as wardrobe cosmetics.
  if (cat && cat !== "cosmetic") {
    for (const raw of [itemId, extraName]) {
      if (raw != null && /_Transparent$/i.test(String(raw))) return true;
    }
    return false;
  }
  for (const raw of [itemId, extraName]) {
    if (raw == null || raw === "") continue;
    const id = String(raw).trim();
    if (/_Transparent$/i.test(id)) return true;
    if (
      /^(Hands|Head|Face|Hair|Hat|Feet|Chest|Legs|Body|Back|Mount|Pet|Aura|Wings|Tail|Ear|Horn)_/i.test(
        id,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function isRealLootItem(itemId, category, extraName) {
  if (category === "currency") return true;
  if (category === "cosmetic") return false;
  if (isWardrobeItemId(itemId, extraName, category)) return false;
  const primary = String(itemId || "").trim();
  if (!primary || primary.length < 3) return false;
  for (const raw of [itemId, extraName]) {
    if (raw == null || raw === "") continue;
    const id = String(raw).trim();
    const compact = compactItemKey(id);
    if (STAT_NOISE.has(compact)) return false;
    if (/^(stat|attr|param)\d*$/i.test(id)) return false;
    if (/(atk|matk|def|mdef|hp|mp|hit|flee|crit)mult$/i.test(compact)) return false;
    if (/\.(atk|matk|def|mdef|hit|flee|value|count)$/i.test(id)) return false;
  }
  return true;
}

function pushPickup(items, category, itemId, count) {
  if (!category || !itemId || !count) return;
  if (!isRealLootItem(itemId, category)) return;
  items.push({ category, itemId: String(itemId), count: Number(count) || 1 });
}

function walkPickupObject(value, items) {
  if (!value || typeof value !== "object") return;
  for (const [bucket, category] of Object.entries(PICKUP_BUCKETS)) {
    const bag = value[bucket] ?? value[bucket.toLowerCase()];
    if (!bag || typeof bag !== "object") continue;
    const rows = Array.isArray(bag) ? bag : Object.values(bag);
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      if (category === "currency") {
        const count = Number(row.Value ?? row.value ?? row.Count ?? row.count) || 0;
        if (count > 0) pushPickup(items, "currency", `currency:${row.Type ?? row.type ?? "gold"}`, count);
        continue;
      }
      const id = row.Id ?? row.id;
      if (id) pushPickup(items, category, id, row.Count ?? row.count ?? 1);
    }
  }
}

export function pickupsFromDecodedFields(packet) {
  if (!packet || !isPickupPacket(packet)) return [];
  const items = [];
  const fields = packet.decodedFields || [];
  const rows = new Map();
  for (const field of fields) {
    const name = String(field?.name || "");
    if (/\.Inventory\.Cosmetics\b/i.test(name) || /(?:^|\.)Cosmetics\[\d+\]\.(Id|Slot|Rarity)$/i.test(name)) {
      continue;
    }
    const match = name.match(
      /(?:^|\.)(Equips|Artifacts|Cards|Gems|Junks|Consumables|Currencies)(?:\[(\d+)\]|\["([^"]+)"\]|\.(\d+))\.(Id|Count|Type|Value)$/i,
    );
    if (!match) continue;
    const bucket = match[1][0].toUpperCase() + match[1].slice(1);
    const key = `${bucket}:${match[2] || match[3] || match[4]}`;
    if (!rows.has(key)) rows.set(key, { bucket, id: null, count: 1, dictKey: match[3] || null });
    const row = rows.get(key);
    const fieldKey = match[5];
    if (fieldKey === "Id") row.id = field.value;
    if (fieldKey === "Count") row.count = Number(field.value) || 0;
    if (fieldKey === "Type") row.type = field.value;
    if (fieldKey === "Value") row.value = field.value;
  }
  for (const row of rows.values()) {
    const category = PICKUP_BUCKETS[row.bucket];
    if (category === "currency") {
      const count = Number(row.value ?? row.count) || 0;
      if (count > 0) pushPickup(items, "currency", `currency:${row.type ?? row.id ?? "gold"}`, count);
    } else {
      const id = row.id || row.dictKey;
      if (id) pushPickup(items, category, id, row.count);
    }
  }
  for (const field of fields) {
    const short = String(field?.name || "").split(".").pop();
    if ((short === "data" || short === "pickupList") && field.value && typeof field.value === "object") {
      walkPickupObject(field.value, items);
    }
  }
  return items;
}

export function coinsFromPacket(packet) {
  if (!isCoinsPacket(packet)) return null;
  const raw = fieldValue(packet, ["coins"]);
  if (raw != null) {
    return typeof raw === "bigint" ? Number(raw) : Number(raw);
  }
  if (!packet.payload) return null;
  try {
    const reader = new LootReader(packet.payload);
    const coins = reader.int64();
    return Number(coins);
  } catch {
    return null;
  }
}

export function decodeRewardLenient(packet) {
  if (isExpCoinsPacket(packet)) return decodeExpCoinsLenient(packet);
  if (isPickupPacket(packet)) {
    let items = [];
    try {
      items = decodePickupItemsDetailed(packet)?.items || [];
    } catch {
      items = [];
    }
    if (!items.length) items = pickupsFromDecodedFields(packet);
    items = items.filter((item) => item.category !== "cosmetic" && isRealLootItem(item.itemId, item.category));
    if (items.length) {
      return {
        kind: "pickup",
        tick: packet.tick,
        items: items.map((item) => ({
          category: item.category,
          itemId: item.itemId,
          count: item.count,
        })),
      };
    }
  }
  return null;
}
