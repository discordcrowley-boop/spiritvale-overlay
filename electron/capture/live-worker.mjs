/**
 * Bun sidecar: passive Npcap capture → combat/farm/tower snapshots for the overlay.
 * Speaks NDJSON on stdout. Never injects or sends game traffic.
 */
import { PacketCapture, getNpcapStatus } from "@kar-mi/spirit-vale-tools-capture/capture";
import { FishNetEternalTowerTracker } from "@kar-mi/spirit-vale-tools-capture";
import {
  FishNetCombatTracker,
  FishNetActorDirectory,
  FishNetStatusTracker,
  LiveCombatService,
  createBossCatalog,
  observeFishNetDamagePacket,
} from "@kar-mi/spirit-vale-tools-combat";
import { FishNetMobRewardTracker, FishNetLootDropTracker, MobRewardSession, mobIdentityDefinitionsById, mobDefinitionsById, loadBundledMobRewardCatalog } from "@kar-mi/spirit-vale-tools-rewards";
import { resolveFishNetSkill } from "@kar-mi/spirit-vale-tools-skills";
import { resolveFishNetStatus } from "@kar-mi/spirit-vale-tools-statuses";
import { resolveFishNetItem } from "@kar-mi/spirit-vale-tools-items";
import {
  decodePetEffectDisplays,
  decodePetSkillDisplay,
  packetLooksLikeEffectDisplays,
  packetLooksLikeSkillDisplay,
} from "./pet-status-decoder.mjs";
import {
  decodePickupItemsDetailed,
  decodeRewardLenient,
  decodeExpCoinsLenient,
  pickupsFromDecodedFields,
  coinsFromPacket,
  isRealLootItem,
  isPickupPacket,
  isExpCoinsPacket,
  isCoinsPacket,
  isWardrobeItemId,
  prepareRewardPacket,
  scanPayloadItemIds,
} from "./loot-pickup-decoder.mjs";
import { decodeChatLootNotices, parseFoundLootMessage } from "./loot-chat-decoder.mjs";
import { decodeLootFilter, isLootFilterPacket } from "./loot-filter-decoder.mjs";
import { actorMergeKey, betterName, isPlaceholderName, actorIdFromLabel } from "./actor-names.mjs";
import { isSelfishHealEvent } from "./heal-filter.mjs";
import { recoverPacket } from "./packet-recover.mjs";
import {
  createExpTracker,
  MAX_BASE_LEVEL,
  MAX_JOB_LEVEL,
} from "./exp-tracker.mjs";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import dataStore from "./data-store.cjs";

const COLORS = ["#6dffb0", "#5fd0ff", "#ffd27a", "#e0c36a", "#c9a0ff", "#ff8d8d", "#9ad7ff", "#3aa89a"];
const SKILL_ICON_BASE = "https://spiritvale.info/content/game/icons";
const SKILL_SPRITE_BASE = "https://spiritvalers.com/wiki-data/skill-icons";
const STATUS_ICON_BASE =
  "https://gamingwithdaopa.ellatha.com/spiritvale/wp-content/uploads/sites/44/2026/07";
const MONSTER_ICON_BASE = "https://spiritvalers.com/wiki-data/monster-icons";

let iconIndex = { byId: {}, byName: {}, skills: {} };
let skillClassByKey = {};
/** Wiki skill tip blurbs (name/id → { name, desc, icon }). */
let skillTipIndex = { byKey: {} };
/** Funny cycle names for plain Summon Skeleton pets. */
let skeletonNameList = [];
let skeletonNameNextIndex = 0;
/** Wiki monsters missing from the bundled @kar-mi catalog (event / patch mobs). */
let extraMonsterRows = [];
const DEBUG_DUMPS = false;
const APP_DATA_DIR = join(process.env.APPDATA || process.cwd(), "Spiritvale Overlay");
const SKELETON_NAME_STATE_PATH = join(APP_DATA_DIR, "skeleton-name-cursor.json");
try {
  iconIndex = dataStore.dataset("iconIndex", iconIndex);
  const skillMap = dataStore.dataset("skillClassMap", {});
  skillClassByKey = skillMap?.byKey || skillMap || {};
  const tips = dataStore.dataset("skillTipIndex", {});
  skillTipIndex = { byKey: tips?.byKey || tips || {} };
  const names = dataStore.dataset("skeletonNames", []);
  if (Array.isArray(names)) {
    skeletonNameList = names.map((n) => String(n || "").trim()).filter(Boolean);
  }
  const extra = dataStore.dataset("extraMonsters", {});
  if (Array.isArray(extra?.monsters)) extraMonsterRows = extra.monsters;
  try {
    if (existsSync(SKELETON_NAME_STATE_PATH)) {
      const cursor = JSON.parse(readFileSync(SKELETON_NAME_STATE_PATH, "utf8"));
      const next = Number(cursor?.nextIndex);
      if (Number.isInteger(next) && next >= 0) skeletonNameNextIndex = next;
    }
  } catch {
    /* ignore */
  }
} catch {
  /* bundled index optional at first boot */
}
const rewardCatalog = loadBundledMobRewardCatalog();
const experienceRequirements = rewardCatalog.experienceRequirements || [];
const expTracker = createExpTracker(experienceRequirements);
const CATEGORY_ITEM_TYPE = {
  material: 0,
  consumable: 1,
  equipment: 2,
  artifact: 3,
  card: 4,
  gem: 5,
  cosmetic: 6,
};
const LOOT_TYPE_CATEGORY = ["material", "consumable", "equipment", "artifact", "card", "gem", "cosmetic"];

function emit(msg) {
  process.stdout.write(
    `${JSON.stringify(msg, (_key, value) => (typeof value === "bigint" ? Number(value) : value))}\n`,
  );
}

function colorFor(name) {
  let hash = 0;
  for (const ch of String(name || "")) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** Training-dummy / partial HealthComponent RPCs often omit vectors; the stock observer drops them. */
function ensureDamageDecodeDefaults(packet) {
  if (packet?.rpcName !== "ApplyDamage_C" && packet?.rpcName !== "Death_C") return packet;
  if (packet.networkBehaviourType && packet.networkBehaviourType !== "HealthComponent") return packet;

  const fields = Array.isArray(packet.decodedFields) ? [...packet.decodedFields] : [];
  const has = (name) => fields.some((row) => row.name === name);
  let changed = false;
  const add = (name, value, codec = "auto") => {
    if (has(name)) return;
    fields.push({ name, codec, value });
    changed = true;
  };

  // Core combat observer requires these to exist (nullable string may be null).
  add("dmg.DamageSourceId", null, "string");
  add("dmg.IsClone", false, "bool");
  add("dmg.IsSummon", false, "bool");
  if (packet.rpcName === "ApplyDamage_C") {
    add("position", [0, 0, 0], "vector3");
    add("origin", [0, 0, 0], "vector3");
  }

  return changed ? { ...packet, decodedFields: fields } : packet;
}

function meterRows(meter) {
  if (!meter) return [];
  return (meter.rows || []).map((row) => ({
    id: row.actorIds?.[0] != null ? String(row.actorIds[0]) : row.displayName,
    name: row.displayName,
    color: colorFor(row.displayName),
    amount: row.amount,
    rate: row.rate,
    hits: row.hits,
  }));
}

function mapSkills(skills, limit = Infinity) {
  const rows = skills || [];
  const capped = Number.isFinite(limit) ? rows.slice(0, limit) : rows;
  return capped.map((skill) => {
    const name = skill.sourceLabel || skill.sourceId || "Ability";
    const icons = skillIconUrls(skill.sourceId, name);
    return {
      id: skill.sourceId,
      name,
      damage: skill.damage,
      hits: skill.hits,
      iconUrl: icons[0] || null,
      iconUrls: icons,
    };
  });
}

function skillSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SKILL_NAME_ALIASES = {
  "basic attack": "AutoAttack",
  "auto attack": "AutoAttack",
  "normal attack": "AutoAttack",
  attack: "AutoAttack",
  burning: "Burning",
  burn: "Burning",
  "flame ground": "FireField",
  flameground: "FireField",
  "volatile explosion": "VolatileExplosion",
};

function skillIconUrls(sourceId, displayName) {
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  const aliasKey = String(displayName || sourceId || "")
    .trim()
    .toLowerCase();
  const aliasId = SKILL_NAME_ALIASES[aliasKey];
  const resolved =
    resolveFishNetSkill(sourceId) ||
    resolveFishNetSkill(displayName) ||
    (aliasId ? resolveFishNetSkill(aliasId) : null) ||
    null;
  const status =
    resolveFishNetStatus(sourceId) ||
    resolveFishNetStatus(displayName) ||
    (aliasId ? resolveFishNetStatus(aliasId) : null) ||
    null;

  const skills = iconIndex?.skills || {};
  for (const key of [sourceId, displayName, aliasId, resolved?.id, resolved?.displayName, resolved?.spriteId]) {
    if (key && skills[key]) push(skills[key]);
  }

  const sprite = resolved?.spriteId || status?.spriteId || null;
  if (sprite) {
    push(`${SKILL_SPRITE_BASE}/${sprite}.webp`);
    push(`${SKILL_ICON_BASE}/${sprite}.webp`);
    push(`${SKILL_ICON_BASE}/skill-${skillSlug(sprite)}.webp`);
  }
  if (status?.id && status?.spriteId) {
    push(`${STATUS_ICON_BASE}/Status_${status.id}_${status.spriteId}.png`);
  }

  for (const label of [resolved?.displayName, displayName, sourceId, aliasId]) {
    const slug = skillSlug(label);
    if (!slug) continue;
    push(`${SKILL_ICON_BASE}/skill-${slug}.webp`);
    push(`https://spiritvalers.com/content/game/icons/skill-${slug}.webp`);
  }

  // Auto / basic attack often has no sprite — use a known melee icon.
  if (/^(basic|auto|normal)?\s*attack$/i.test(String(displayName || sourceId || ""))) {
    push(`${SKILL_ICON_BASE}/skill-bash.webp`);
    push(`https://spiritvalers.com/content/game/icons/skill-bash.webp`);
  }

  return urls;
}

function skillIconUrl(name) {
  return skillIconUrls(null, name)[0] || null;
}

function detailActors(detail, kind) {
  if (!detail?.actors) return [];
  return detail.actors.map((row) => {
    const className = archetypeClassName(row.archetype) || null;
    const fightAvg = Number(row.dps) || 0;
    const current = Number(row.currentDps) || 0;
    const actorId =
      Array.isArray(row.actorIds) && row.actorIds.length
        ? row.actorIds[0]
        : actorIdFromLabel(row.displayName);
    const base = {
      id: actorId != null ? actorId : row.rowId,
      actorIds: row.actorIds || [],
      name: row.displayName,
      color: colorFor(row.displayName),
      className,
      classIconUrl: classIconUrl(className),
      classIconUrls: classIconUrls(className),
      archetype: row.archetype,
      damage: 0,
      dps: 0,
      currentDps: 0,
      healing: 0,
      hps: 0,
      taken: 0,
      takenDps: 0,
      hits: row.hits || 0,
      crits: row.criticalHits || 0,
      skills: [],
      healingSkills: [],
      takenSkills: [],
    };
    if (kind === "dps") {
      base.damage = row.damage;
      base.dps = fightAvg;
      base.currentDps = current;
      base.skills = mapSkills(row.skills);
    } else if (kind === "hps") {
      base.healing = row.damage;
      base.hps = fightAvg;
      base.healingSkills = mapSkills(row.skills);
    } else if (kind === "tps") {
      base.taken = row.damage;
      base.takenDps = fightAvg;
      base.takenSkills = mapSkills(row.skills);
    }
    return base;
  });
}

function mergeSkillLists(left, right) {
  const byId = new Map();
  for (const skill of [...(left || []), ...(right || [])]) {
    if (!skill) continue;
    const key = String(skill.id || skill.name || "");
    if (!key) continue;
    const cur = byId.get(key);
    if (!cur) {
      byId.set(key, { ...skill });
      continue;
    }
    cur.damage = (cur.damage || 0) + (skill.damage || 0);
    cur.hits = (cur.hits || 0) + (skill.hits || 0);
    if (!cur.iconUrl && skill.iconUrl) cur.iconUrl = skill.iconUrl;
    if ((!cur.iconUrls || !cur.iconUrls.length) && skill.iconUrls?.length) cur.iconUrls = skill.iconUrls;
  }
  return [...byId.values()].sort((a, b) => (b.damage || 0) - (a.damage || 0));
}

function meterMergeKey(row) {
  const rawId = row?.id;
  const numericId = Number(String(rawId || "").replace(/^actor:/i, ""));
  const fromLabel = actorIdFromLabel(row?.name);
  const actorId = Number.isFinite(numericId) ? numericId : fromLabel;
  const identity = Number.isFinite(actorId)
    ? directory.getAttribution(actorId) || directory.get(actorId)
    : null;
  // Only merge on durable identity — never by display name (that mis-credits damage).
  if (identity?.uid) return `uid:${identity.uid}`;
  if (identity?.ownerConnectionId != null) return `owner:${identity.ownerConnectionId}`;
  if (Number.isFinite(actorId)) return `id:${actorId}`;
  return actorMergeKey(row);
}

/** Compose DPS/HPS/TPS from LiveCombatService only — one clock, owner-merged rows. */
function composeMeters(dpsDetail, hpsMeter, tpsMeter) {
  const byKey = new Map();
  const put = (row, mode, { replaceRates = false } = {}) => {
    if (!row) return;
    const polished = polishActorRow(row);
    const key = meterMergeKey(polished);
    if (!key) return;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        ...polished,
        skills: polished.skills || [],
        healingSkills: polished.healingSkills || [],
        takenSkills: polished.takenSkills || [],
      });
      return;
    }
    cur.name = betterName(cur.name, polished.name);
    if (isPlaceholderName(cur.name) && polished.name && !isPlaceholderName(polished.name)) {
      cur.name = polished.name;
    }
    if (!isPlaceholderName(cur.name)) cur.color = colorFor(cur.name);

    if (mode === "dps") {
      // Combat service rows are already complete totals per identity. Same key twice
      // means a split that should sum; if both look like full re-emits, keep the larger.
      const nextDamage = Number(polished.damage) || 0;
      const prevDamage = Number(cur.damage) || 0;
      if (nextDamage > 0 && prevDamage > 0) {
        const ratio = Math.min(nextDamage, prevDamage) / Math.max(nextDamage, prevDamage);
        if (ratio > 0.85) {
          // Near-duplicate totals for the same identity — do not double-count.
          if (nextDamage >= prevDamage) {
            cur.damage = nextDamage;
            cur.dps = polished.dps || cur.dps;
            cur.currentDps = polished.currentDps || cur.currentDps;
            cur.hits = Math.max(cur.hits || 0, polished.hits || 0);
            cur.crits = Math.max(cur.crits || 0, polished.crits || 0);
            if (polished.skills?.length) cur.skills = mergeSkillLists([], polished.skills);
          }
        } else {
          cur.damage = prevDamage + nextDamage;
          cur.dps = (cur.dps || 0) + (polished.dps || 0);
          cur.currentDps = (cur.currentDps || 0) + (polished.currentDps || 0);
          cur.hits = (cur.hits || 0) + (polished.hits || 0);
          cur.crits = (cur.crits || 0) + (polished.crits || 0);
          cur.skills = mergeSkillLists(cur.skills, polished.skills);
        }
      } else {
        cur.damage = prevDamage + nextDamage;
        cur.dps = (cur.dps || 0) + (polished.dps || 0);
        cur.currentDps = (cur.currentDps || 0) + (polished.currentDps || 0);
        cur.hits = (cur.hits || 0) + (polished.hits || 0);
        cur.crits = (cur.crits || 0) + (polished.crits || 0);
        cur.skills = mergeSkillLists(cur.skills, polished.skills);
      }
    } else if (mode === "hps") {
      if (replaceRates || (polished.healing || 0) >= (cur.healing || 0)) {
        cur.healing = polished.healing || 0;
        cur.hps = polished.hps || 0;
        cur.hits = Math.max(cur.hits || 0, polished.hits || 0);
      }
      if (polished.healingSkills?.length) {
        cur.healingSkills = mergeSkillLists(cur.healingSkills, polished.healingSkills);
      }
    } else if (mode === "tps") {
      if (replaceRates || (polished.taken || 0) >= (cur.taken || 0)) {
        cur.taken = polished.taken || 0;
        cur.takenDps = polished.takenDps || 0;
        cur.hits = Math.max(cur.hits || 0, polished.hits || 0);
      }
      if (polished.takenSkills?.length) {
        cur.takenSkills = mergeSkillLists(cur.takenSkills, polished.takenSkills);
      }
    }
  };

  for (const row of detailActors(dpsDetail, "dps")) put(row, "dps");

  const hpsDetail = detailActors(hpsMeter?.detail || null, "hps");
  if (hpsDetail.length) {
    for (const row of hpsDetail) put(row, "hps", { replaceRates: true });
  } else {
    for (const row of meterRows(hpsMeter)) {
      put(
        {
          id: row.id,
          name: row.name,
          color: row.color,
          healing: row.amount,
          hps: row.rate,
          hits: row.hits,
          healingSkills: [],
        },
        "hps",
        { replaceRates: true },
      );
    }
  }

  const tpsDetail = detailActors(tpsMeter?.detail || null, "tps");
  if (tpsDetail.length) {
    for (const row of tpsDetail) put(row, "tps", { replaceRates: true });
  } else {
    for (const row of meterRows(tpsMeter)) {
      put(
        {
          id: row.id,
          name: row.name,
          color: row.color,
          taken: row.amount,
          takenDps: row.rate,
          hits: row.hits,
          takenSkills: [],
        },
        "tps",
        { replaceRates: true },
      );
    }
  }

  // Do not collapse by display name — that can merge two different players.
  return [...byKey.values()].sort((a, b) => (b.damage || 0) - (a.damage || 0));
}

function statusIconUrls(statusId, displayName, spriteId) {
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  const id = String(statusId || displayName || "")
    .replace(/[^A-Za-z0-9_]/g, "")
    .replace(/\s+/g, "");
  const tip = lookupSkillTip(statusId, displayName);
  const sprite = String(spriteId || tip?.icon || "").trim();
  const conditionSprite = /^Conditions_/i.test(sprite);

  // Status CDN PNGs are the reliable source for Conditions_* (wiki .webp often 404s).
  if (id && sprite) {
    push(`${STATUS_ICON_BASE}/Status_${id}_${sprite}.png`);
  }
  // Skill/wiki sprites — good for Skills_*, T_Icon_*, Necromancer2, etc.
  if (sprite) {
    push(`${SKILL_SPRITE_BASE}/${sprite}.webp`);
    if (!conditionSprite) {
      push(`${SKILL_ICON_BASE}/${sprite}.webp`);
      push(`${SKILL_ICON_BASE}/skill-${skillSlug(sprite)}.webp`);
    }
  }
  // Conditions_*.webp last — frequently missing on the skill CDN.
  if (sprite && conditionSprite) {
    push(`${SKILL_ICON_BASE}/${sprite}.webp`);
    push(`${SKILL_SPRITE_BASE}/${sprite}.webp`);
  }
  for (const label of [displayName, statusId, tip?.name]) {
    const slug = skillSlug(label);
    if (!slug) continue;
    push(`${SKILL_SPRITE_BASE}/${String(label || "").replace(/\s+/g, "")}.webp`);
    push(`${SKILL_ICON_BASE}/skill-${slug}.webp`);
    push(`https://spiritvalers.com/content/game/icons/skill-${slug}.webp`);
  }
  return urls;
}

function statusIconUrl(statusId, displayName, spriteId) {
  return statusIconUrls(statusId, displayName, spriteId)[0] || null;
}

function lookupSkillTip(...keys) {
  const map = skillTipIndex?.byKey || {};
  for (const raw of keys) {
    if (!raw) continue;
    const variants = [
      String(raw),
      String(raw).replace(/\s+/g, ""),
      String(raw).replace(/[^A-Za-z0-9]/g, ""),
    ];
    for (const v of variants) {
      const hit = map[String(v).toLowerCase()];
      if (hit) return hit;
    }
  }
  return null;
}

function formatStatusTipExtras(def, level = 1, stacks = 1) {
  const lines = [];
  const notes = [];
  if (!def) return { lines, notes };
  if (def.isDebuff && (Number(def.damage) > 0 || Number(def.damagePerc) > 0)) {
    notes.push("Drains hp over time");
  }
  if (Number(def.damagePerc) > 0) {
    lines.push({
      label: "Healing Received",
      value: `-${Number(def.damagePerc)}%`,
      tone: "bad",
    });
  } else if (def.isDebuff && Number(def.damage) > 0) {
    // Decay-style: damage field is a percent heal cut in the live UI.
    lines.push({
      label: "Healing Received",
      value: `-${Number(def.damage) * Math.max(1, stacks)}%`,
      tone: "bad",
    });
  }
  if (stacks > 1 || Number(def.maxLevel) > 0) {
    notes.push(stacks > 1 ? `Stackable (×${stacks})` : "Stackable");
  }
  const effect = (def.effects || []).find((e) => Number(e?.durationPerLevel) > 0);
  if (effect) {
    lines.push({
      label: "Duration",
      value: `${Number(effect.durationPerLevel) * Math.max(1, level)}s`,
      tone: "good",
    });
  }
  return { lines, notes };
}

function serializeStatusRow(row) {
  if (!row) return null;
  const def =
    resolveFishNetStatus(row.statusId) ||
    resolveFishNetStatus(row.displayName) ||
    null;
  const statusId = def?.id || row.statusId || row.displayName;
  const tip = lookupSkillTip(statusId, row.displayName, def?.displayName);
  const displayName = tip?.name || def?.displayName || row.displayName;
  const spriteId = def?.spriteId || tip?.icon || row.spriteId || null;
  const icons = statusIconUrls(statusId, displayName, spriteId);
  const stacks = row.stacks || 1;
  const level = row.level || 1;
  const extras = formatStatusTipExtras(def, level, stacks);
  const description =
    (tip?.desc && String(tip.desc).trim()) ||
    (def?.isDebuff ? "Negative status effect." : "") ||
    "";
  return {
    id: statusId,
    name: displayName,
    debuff: Boolean(def?.isDebuff ?? row.isDebuff ?? row.debuff),
    remainingMs: row.remainingMs ?? null,
    stacks,
    level,
    spriteId,
    description,
    notes: extras.notes,
    effectLines: extras.lines,
    iconUrl: icons[0] || null,
    iconUrls: icons,
  };
}

/** Unity Archetype enum order (bases then advanced) from SVClassMeta export. */
const ARCHETYPE_NAMES = [
  "Acolyte",
  "Knight",
  "Mage",
  "Rogue",
  "Scout",
  "Summoner",
  "Warrior",
  "Berserker",
  "Gunslinger",
  "Necromancer",
  "Paladin",
  "Priest",
  "Shinobi",
  "Weaver",
  "Wizard",
];
const CLASS_ICON_BASE = "https://spiritvalers.com/content/game/icons";

function archetypeClassName(archetype) {
  const n = Number(archetype);
  if (!Number.isInteger(n) || n < 0 || n >= ARCHETYPE_NAMES.length) {
    return null;
  }
  return ARCHETYPE_NAMES[n];
}

function classIconUrl(className) {
  const slug = toSlug(className);
  if (!slug) return null;
  return `${CLASS_ICON_BASE}/class-${slug}.webp`;
}

function classIconUrls(className) {
  const slug = toSlug(className);
  if (!slug) return [];
  // Primary CDN only — wiki-data / spiritvale.info mirrors 404 for class icons.
  return [`${CLASS_ICON_BASE}/class-${slug}.webp`];
}

/** Skill sourceIds are often `Gunslinger_3`, `Priest_1`, … — strong class signal. */
function classFromSkillRef(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  for (const name of ARCHETYPE_NAMES) {
    const key = name.toLowerCase();
    if (lower === key) return name;
    if (lower.startsWith(`${key}_`)) return name;
  }
  const compact = lower.replace(/[^a-z0-9]+/g, "");
  if (compact && skillClassByKey[compact]) return skillClassByKey[compact];
  return null;
}

function inferClassFromSkills(skills) {
  const votes = new Map();
  for (const skill of skills || []) {
    for (const ref of [skill?.id, skill?.sourceId, skill?.name]) {
      const cls = classFromSkillRef(ref);
      if (!cls) continue;
      const weight = Number(skill?.damage) || Number(skill?.hits) || 1;
      votes.set(cls, (votes.get(cls) || 0) + weight);
    }
  }
  if (!votes.size) return null;
  let best = null;
  let bestScore = -1;
  for (const [cls, score] of votes) {
    // Prefer advanced jobs when both base + advanced skill ids appear.
    const advancedBoost = ARCHETYPE_NAMES.indexOf(cls) >= 7 ? 1e9 : 0;
    const total = score + advancedBoost;
    if (total > bestScore) {
      bestScore = total;
      best = cls;
    }
  }
  return best;
}

function applyClassToRow(row, className) {
  if (!row || !className) return row;
  row.className = className;
  row.classIconUrl = classIconUrl(className);
  row.classIconUrls = classIconUrls(className);
  rememberClass(row.name, className);
  return row;
}

/** Prefer current Appearance.Archetype; else last entry in CharacterData.Archetypes. */
function extractArchetypeValue(fields) {
  if (!Array.isArray(fields) || !fields.length) return null;
  for (const field of fields) {
    const name = String(field?.name || "");
    if (!/(^|\.)Appearance\.Archetype$/i.test(name)) continue;
    const n = Number(field.value);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  const listed = [];
  for (const field of fields) {
    const name = String(field?.name || "");
    const indexed = name.match(/(^|\.)Archetypes\[(\d+)\]$/i);
    if (indexed) {
      const n = Number(field.value);
      if (Number.isInteger(n) && n >= 0) listed.push({ i: Number(indexed[2]), v: n });
      continue;
    }
    if (!/(^|\.)Archetypes$/i.test(name)) continue;
    const raw = field.value;
    if (Array.isArray(raw)) {
      raw.forEach((v, i) => {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0) listed.push({ i, v: n });
      });
    } else {
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 0) listed.push({ i: 0, v: n });
    }
  }
  if (!listed.length) return null;
  listed.sort((a, b) => a.i - b.i);
  return listed[listed.length - 1].v;
}

function rememberClass(name, archetypeOrClass) {
  const key = String(name || "")
    .trim()
    .toLowerCase();
  if (!key || key.startsWith("actor ") || key === "resolving…" || key === "player" || key === "unknown") {
    return null;
  }
  if (/^unidentified/.test(key)) return null;
  const className =
    typeof archetypeOrClass === "string"
      ? archetypeOrClass
      : archetypeClassName(archetypeOrClass);
  if (!className) return null;
  classByName.set(key, className);
  return className;
}

function noteArchetypesFromPacket(packet) {
  if (!packet) return;
  const fromFields = extractArchetypeValue(packet.decodedFields);
  const nameFromFields = (packet.decodedFields || []).find((field) =>
    /(^|\.)(Name|Appearance\.DisplayName)$/i.test(String(field?.name || "")),
  )?.value;
  if (fromFields != null && typeof nameFromFields === "string") {
    rememberClass(nameFromFields, fromFields);
    if (
      personalName &&
      String(nameFromFields).toLowerCase() === String(personalName).toLowerCase()
    ) {
      try {
        directory.setLocalIdentity({
          displayName: personalName,
          archetype: fromFields,
          ...(localUid ? { uid: localUid } : {}),
          ...(localAccountId ? { accountId: localAccountId } : {}),
        });
      } catch {
        /* ignore */
      }
    }
  }

  for (const entry of packet.spawnSyncEntries || []) {
    const fields = entry?.fields || [];
    const displayName = fields.find((field) => /Appearance\.DisplayName$/i.test(String(field.name || "")))
      ?.value;
    const archetype = fields.find((field) => /Appearance\.Archetype$/i.test(String(field.name || "")))
      ?.value;
    if (typeof displayName === "string" && Number.isInteger(Number(archetype))) {
      rememberClass(displayName, Number(archetype));
    }
  }

  // Any PlayerController VisualData / Appearance sync — don't require syncIndex === 5 only.
  if (packet.networkBehaviourType === "PlayerController") {
    const displayName = (packet.decodedFields || []).find((field) =>
      /Appearance\.DisplayName$/i.test(String(field?.name || "")),
    )?.value;
    const archetype = extractArchetypeValue(packet.decodedFields);
    if (typeof displayName === "string" && archetype != null) {
      rememberClass(displayName, archetype);
    }
  }
}

function toSlug(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/['']/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function compactMobName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function editDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array(b.length + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}

let mobNameIndex = null;
function getMobNameIndex() {
  if (mobNameIndex) return mobNameIndex;
  const byCompact = new Map();
  const byId = new Map();
  for (const def of mobDefs.values()) {
    byCompact.set(compactMobName(def.displayName), def);
    byId.set(String(def.id), def);
    byId.set(compactMobName(def.id), def);
  }
  mobNameIndex = { byCompact, byId };
  return mobNameIndex;
}

function resolveMobRecord(mobId, displayName) {
  const index = getMobNameIndex();
  if (mobId != null && mobId !== "") {
    const direct = mobDefs.get(String(mobId)) || index.byId.get(String(mobId)) || index.byId.get(compactMobName(mobId));
    if (direct) return direct;
  }
  const compact = compactMobName(displayName || mobId);
  if (!compact) return null;
  const exact = index.byCompact.get(compact);
  if (exact) return exact;
  let best = null;
  let bestDist = 3;
  for (const [key, def] of index.byCompact) {
    const dist = editDistance(compact, key);
    if (dist < bestDist) {
      best = def;
      bestDist = dist;
    } else if (dist === bestDist && best && def !== best) {
      best = null;
    }
  }
  return best;
}

function monsterIconUrls(mobId, displayName) {
  const def = resolveMobRecord(mobId, displayName);
  // Wiki icons use internal ids (Snow Bomb → snow-bomb), not display names.
  const labels = [def?.id, mobId, def?.displayName, displayName].filter(Boolean);
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  if (def?.slug) push(`${MONSTER_ICON_BASE}/${def.slug}.webp`);
  for (const label of labels) {
    const slug = toSlug(label);
    if (slug) push(`${MONSTER_ICON_BASE}/${slug}.webp`);
  }
  return urls;
}

function monsterIconUrl(mobId, displayName) {
  return monsterIconUrls(mobId, displayName)[0] || null;
}

function resolvedMobName(mobId, displayName) {
  const def = resolveMobRecord(mobId, displayName);
  if (def?.displayName) return def.displayName;
  const name = String(displayName || "").trim();
  return name || String(mobId || "").trim() || "Monster";
}

const INV_BUCKET_CATEGORY = {
  Equips: "equipment",
  Artifacts: "artifact",
  Cards: "card",
  Gems: "gem",
  Junks: "material",
  Consumables: "consumable",
};
const WEIGHT_LIMIT_STAT = 101;

function itemWeight(category, itemId) {
  const type = CATEGORY_ITEM_TYPE[category];
  if (type == null || !itemId) return 0;
  try {
    const item = resolveFishNetItem(type, itemId);
    if (item && item.weight != null && Number.isFinite(Number(item.weight))) {
      return Number(item.weight);
    }
  } catch {
    /* fall through to defaults */
  }
  // FishNet catalog omits weight for nearly all junks/cards/consumables.
  // Materials/cards/gems are typically weightless; treating them as 1 over-counted
  // bag weight by hundreds (e.g. 2693 vs real 2486).
  if (category === "equipment" || category === "artifact") return 10;
  if (category === "consumable") return 1;
  return 0;
}

function equipWeightLimitBonus(itemId, refine = 0) {
  if (!itemId) return 0;
  try {
    const item = resolveFishNetItem(CATEGORY_ITEM_TYPE.equipment, itemId);
    if (!item) return 0;
    let bonus = 0;
    for (const effect of item.effects || []) {
      if (Number(effect?.type) === WEIGHT_LIMIT_STAT) bonus += Number(effect.value) || 0;
    }
    const refineLevel = Math.max(0, Number(refine) || 0);
    for (const effect of item.refineEffects || []) {
      if (Number(effect?.type) === WEIGHT_LIMIT_STAT) {
        bonus += (Number(effect.value) || 0) * refineLevel;
      }
    }
    return bonus;
  } catch {
    return 0;
  }
}

function recomputeBagWeight() {
  bagWeight = 0;
  for (const [key, count] of bagItems.entries()) {
    const [category, itemId] = key.split("|");
    bagWeight += itemWeight(category, itemId) * (Number(count) || 0);
  }
}

function levelWeightCap(level) {
  const lv = Number(level);
  if (!Number.isFinite(lv) || lv < 1) return null;
  // Patch notes: Character weight = 2000 + 30 * lv
  return 2000 + 30 * lv;
}

function resolvedBagWeightMax() {
  const base = levelWeightCap(playerEconomy?.level);
  const worn = wornWeightLimitBonus || 0;
  const fromLevel = base != null ? base + worn : worn > 0 ? worn : null;
  const fromAttr = bagWeightLimitAttr != null && bagWeightLimitAttr > 0 ? bagWeightLimitAttr : null;
  // Prefer the higher of reconstructed max vs Attributes[101] (sometimes incomplete).
  if (fromLevel != null && fromAttr != null) return Math.max(fromLevel, fromAttr);
  return fromLevel ?? fromAttr;
}

function noteBagItems(items) {
  // Only nudge weight from pickups after a full inventory snapshot;
  // otherwise session loot (~110) is mistaken for real bag weight.
  if (!bagSynced) return;
  for (const item of items || []) {
    if (!item?.itemId || !item.category || item.category === "currency") continue;
    const key = `${item.category}|${item.itemId}`;
    bagItems.set(key, (bagItems.get(key) || 0) + (Number(item.count) || 0));
  }
  recomputeBagWeight();
}

function inventoryFieldPrefixes(rpcName, fields) {
  const prefixes = [];
  if (rpcName === "LoadCharacter_T") prefixes.push("data.Inventory");
  if (rpcName === "CharacterCallback_T") prefixes.push("sync.Inventory");
  // Also accept any decoded Inventory block (spawn/sync edge cases).
  const seen = new Set(prefixes);
  for (const field of fields || []) {
    const name = String(field?.name || "");
    const match = name.match(/^(.*\.)?Inventory\.(Equips|Artifacts|Cards|Gems|Junks|Consumables|Currencies)(\.|$)/);
    if (!match) continue;
    const prefix = `${match[1] || ""}Inventory`;
    if (!seen.has(prefix)) {
      seen.add(prefix);
      prefixes.push(prefix);
    }
  }
  return prefixes;
}

function ingestInventoryValue(value) {
  if (!value || typeof value !== "object") return false;
  let added = false;
  const next = new Map();
  for (const [bucket, category] of Object.entries(INV_BUCKET_CATEGORY)) {
    const bag = value[bucket] ?? value[bucket.toLowerCase()];
    if (!bag || typeof bag !== "object") continue;
    const rows = Array.isArray(bag) ? bag : Object.values(bag);
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const id = row.Id ?? row.id;
      if (!id) continue;
      const count = Number(row.Count ?? row.count ?? 1) || 1;
      const key = `${category}|${id}`;
      next.set(key, (next.get(key) || 0) + count);
      added = true;
    }
  }
  if (!added) return false;
  bagItems.clear();
  for (const [key, count] of next) bagItems.set(key, count);
  recomputeBagWeight();
  bagSynced = true;
  return true;
}

function applyInventorySnapshot(fields, prefix) {
  if (!fields?.length || !prefix) return false;
  const nullRow = fields.find((row) => row.name === prefix);
  if (nullRow && nullRow.value === null) return false;
  const related = fields.filter((row) => row.name.startsWith(`${prefix}.`));
  if (!related.length) return false;

  const rows = new Map();
  for (const [bucket, category] of Object.entries(INV_BUCKET_CATEGORY)) {
    const bucketPrefix = `${prefix}.${bucket}`;
    for (const field of related) {
      const name = String(field.name || "");
      if (!name.startsWith(`${bucketPrefix}`)) continue;
      // Arrays: Inventory.Junks[0].Id
      // Dicts:  Inventory.Junks["Tree Bark"].Count  / Inventory.Equips["uid"].Id
      const match = name.match(
        new RegExp(
          `^${bucketPrefix.replace(/\./g, "\\.")}(?:\\[(\\d+)\\]|\\["([^"]+)"\\]|\\.([^./\\[]+))\\.(Id|Count|\\$key)$`,
        ),
      );
      if (!match) continue;
      const key = `${bucket}:${match[1] || match[2] || match[3]}`;
      if (!rows.has(key)) rows.set(key, { category, id: null, count: 1 });
      const row = rows.get(key);
      if (match[4] === "Id" || match[4] === "$key") {
        if (match[4] === "Id" || !row.id) row.id = field.value;
      }
      if (match[4] === "Count") row.count = Number(field.value) || 0;
    }
  }

  const sawBucket = Object.keys(INV_BUCKET_CATEGORY).some((bucket) =>
    related.some((row) => row.name.startsWith(`${prefix}.${bucket}`)),
  );
  if (!sawBucket) return false;

  bagItems.clear();
  for (const row of rows.values()) {
    if (!row.id) continue;
    const key = `${row.category}|${row.id}`;
    bagItems.set(key, (bagItems.get(key) || 0) + (Number(row.count) || 1));
  }
  // Currencies often use Type/Value instead of Id/Count — type 0 is gold.
  const currencySlots = new Map();
  for (const field of related) {
    const name = String(field.name || "");
    const match = name.match(
      new RegExp(
        `^${prefix.replace(/\./g, "\\.")}\\.Currencies(?:\\[(\\d+)\\]|\\["([^"]+)"\\]|\\.([^./\\[]+))\\.(Type|Value|Count)$`,
        "i",
      ),
    );
    if (!match) continue;
    const slot = match[1] || match[2] || match[3] || "0";
    const row = currencySlots.get(slot) || {};
    if (match[4] === "Type") row.type = Number(field.value);
    if (match[4] === "Value" || match[4] === "Count") row.value = Number(field.value);
    currencySlots.set(slot, row);
  }
  for (const [slot, row] of currencySlots) {
    if (row.type === 0 && Number.isFinite(row.value) && row.value >= 100) {
      setWalletCoins(row.value, Date.now());
    }
  }
  recomputeBagWeight();
  bagSynced = true;
  return true;
}

function applyWornWeightLimit(fields) {
  const worn = new Map();
  for (const field of fields || []) {
    const name = String(field?.name || "");
    const match = name.match(
      /^(?:data|sync)\.(Equips|LoadoutNormal|LoadoutSecondary)\[(\d+)\]\.Equip\.(Id|Refine)$/,
    );
    if (!match) continue;
    const idx = `${match[1]}:${match[2]}`;
    if (!worn.has(idx)) worn.set(idx, { id: null, refine: 0 });
    const row = worn.get(idx);
    if (match[3] === "Id") row.id = field.value;
    if (match[3] === "Refine") row.refine = Number(field.value) || 0;
  }
  if (!worn.size) return false;
  let bonus = 0;
  const seen = new Set();
  for (const row of worn.values()) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    bonus += equipWeightLimitBonus(row.id, row.refine);
  }
  wornWeightLimitBonus = bonus;
  return true;
}

function lootFromBagDelta(before, after) {
  const added = [];
  for (const [key, count] of after.entries()) {
    const gain = (Number(count) || 0) - (Number(before.get(key) || 0) || 0);
    if (gain <= 0) continue;
    const [category, itemId] = String(key).split("|");
    if (!category || !itemId) continue;
    added.push({ category, itemId, count: gain });
  }
  return added;
}

function maybeIngestBagDelta(before, after, tick, nowMs) {
  // Only a pickup RPC means "I looted". Kill-window bag syncs are wardrobe/loadout.
  if (!before || !lastPersonalPickupAt || nowMs - lastPersonalPickupAt > 8_000) return;
  const added = lootFromBagDelta(before, after).filter(
    (row) =>
      row.category &&
      row.category !== "cosmetic" &&
      row.category !== "equipment" &&
      row.category !== "artifact" &&
      !isWardrobeItemId(row.itemId, null, row.category) &&
      isRealLootItem(row.itemId, row.category),
  );
  if (!added.length) return;
  const newKeys = added.filter((row) => !before.has(`${row.category}|${row.itemId}`));
  const addedCount = added.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  if (newKeys.length > 4 || addedCount > 8) return;
  ingestFarmPickups(added, tick, nowMs);
}

function noteCharacterBagFields(packet, nowMs = Date.now()) {
  const fields = packet?.decodedFields || [];
  if (packet?.rpcName === "StorageBatchResult_T") return;
  for (const field of fields) {
    const name = String(field?.name || "");
    const tail = name.split(".").pop();
    // Only character sync/data Level — bare "Level" on mobs/skills/items poisons Exp!
    if (tail === "Level" && /(^|\.)(data|sync)\.Level$/i.test(name)) {
      const level = Number(field.value);
      if (Number.isFinite(level) && level >= 1 && level <= MAX_BASE_LEVEL) {
        if (!playerEconomy) playerEconomy = { updatedAt: nowMs };
        playerEconomy.level = level;
        playerEconomy.updatedAt = nowMs;
        expTracker.hintLevel(level, nowMs);
      }
    }
    if (tail === "Exp" && /(^|\.)(data|sync)\.Exp$/i.test(name)) {
      const experience = Number(field.value);
      if (Number.isFinite(experience) && experience >= 0) {
        if (!playerEconomy) playerEconomy = { updatedAt: nowMs };
        const prior = Number(playerEconomy.experience);
        if (experience > 0 || !(prior > 0)) {
          playerEconomy.experience = experience;
          playerEconomy.updatedAt = nowMs;
          expTracker.hintExperience(experience, nowMs);
        }
      }
    }
    if (tail === "JobExp" && /(^|\.)(data|sync)\.JobExp$/i.test(name)) {
      const jobExperience = Number(field.value);
      if (Number.isFinite(jobExperience) && jobExperience >= 0) {
        if (!playerEconomy) playerEconomy = { updatedAt: nowMs };
        const prior = Number(playerEconomy.jobExperience);
        if (jobExperience > 0 || !(prior > 0)) {
          playerEconomy.jobExperience = jobExperience;
          playerEconomy.updatedAt = nowMs;
          expTracker.hintJobExperience(jobExperience, nowMs);
        }
      }
    }
    if (tail === "JobLevel" && /(^|\.)(data|sync)\.JobLevel$/i.test(name)) {
      const jobLevel = Number(field.value);
      if (Number.isFinite(jobLevel) && jobLevel >= 1 && jobLevel <= MAX_JOB_LEVEL) {
        if (!playerEconomy) playerEconomy = { updatedAt: nowMs };
        playerEconomy.jobLevel = jobLevel;
        playerEconomy.updatedAt = nowMs;
        expTracker.hintJobLevel(jobLevel, nowMs);
      }
    }
    // Inventory.Currencies[*].Type / .Value — type 0 is gold in Spiritvale.
    {
      const cur = name.match(/^(.*\.)?Inventory\.Currencies(?:\[(\d+)\]|\["([^"]+)"\])\.(Type|Value|Count)$/i);
      if (cur) {
        const slot = cur[2] || cur[3] || "0";
        if (!noteCharacterBagFields._currency) noteCharacterBagFields._currency = new Map();
        const row = noteCharacterBagFields._currency.get(slot) || {};
        if (cur[4] === "Type") row.type = Number(field.value);
        if (cur[4] === "Value" || cur[4] === "Count") row.value = Number(field.value);
        noteCharacterBagFields._currency.set(slot, row);
        if (row.type === 0 && Number.isFinite(row.value) && row.value >= 100) {
          setWalletCoins(row.value, nowMs);
        }
      }
    }
    if (tail === "AccountId" || tail === "SteamId") {
      const id = String(field.value || "").trim();
      if (/^\d{15,20}$/.test(id) && !localAccountId) localAccountId = id;
    }
    const attr = name.match(/(?:^|\.)Attributes\[(\d+)\]$/);
    if (attr && Number(attr[1]) === WEIGHT_LIMIT_STAT) {
      const value = Number(field.value);
      if (Number.isFinite(value) && value >= 0) bagWeightLimitAttr = value;
    }
  }
  try {
    applyWornWeightLimit(fields);
  } catch {
    /* ignore */
  }
  const wasSynced = bagSynced;
  const before = wasSynced ? new Map(bagItems) : null;
  let snapped = false;
  for (const prefix of inventoryFieldPrefixes(packet?.rpcName, fields)) {
    if (applyInventorySnapshot(fields, prefix)) snapped = true;
  }
  for (const field of fields) {
    const name = String(field?.name || "");
    if (!/(^|\.)Inventory$/.test(name)) continue;
    if (field.value && typeof field.value === "object" && ingestInventoryValue(field.value)) {
      snapped = true;
    }
  }
  if (snapped && before) maybeIngestBagDelta(before, bagItems, packet?.tick || 0, nowMs);
}

function resolvedItemName(category, itemId, displayName) {
  const fallback = String(displayName || itemId || "Item").trim() || "Item";
  const type = CATEGORY_ITEM_TYPE[category];
  if (type == null || !itemId) return fallback;
  try {
    const item = resolveFishNetItem(type, itemId);
    if (item?.displayName) return item.displayName;
    if (item?.name) return item.name;
  } catch {
    /* keep fallback */
  }
  return fallback;
}

function equipDetailsFor(itemId, count, cursor, preferUid = null) {
  const matches = equipDetailsLog.filter((row) => row.itemId === itemId);
  const rows = [];
  let index = cursor.get(itemId) || 0;
  for (let i = 0; i < Math.max(1, count); i += 1) {
    let detail = null;
    if (preferUid) {
      const byUid = matches.findIndex((row) => row.uid && row.uid === preferUid);
      if (byUid >= 0) detail = matches[byUid];
    }
    if (!detail) {
      detail = matches[index] || null;
      index += 1;
    }
    rows.push(detail);
  }
  cursor.set(itemId, index);
  return rows;
}

function preferEquipRow(a, b) {
  const score = (row) => {
    let n = 0;
    if (Array.isArray(row.substats) && row.substats.length) n += 20 + row.substats.length;
    if (row.potential != null) n += 8;
    if (row.uid) n += 4;
    if (row.from && row.from !== "loot") n += 3;
    if (Array.isArray(row.cards) && row.cards.length) n += 2;
    return n;
  };
  const best = score(a) >= score(b) ? a : b;
  const other = best === a ? b : a;
  const from =
    best.from && best.from !== "loot"
      ? best.from
      : other.from && other.from !== "loot"
        ? other.from
        : best.from || other.from || "loot";
  return {
    ...best,
    from,
    uid: best.uid || other.uid || null,
    refine: best.refine ?? other.refine ?? null,
    potential: best.potential ?? other.potential ?? null,
    cards: best.cards?.length ? best.cards : other.cards || [],
    substats: best.substats?.length ? best.substats : other.substats || [],
  };
}

/** Collapse stock-tracker + detailed-ingest twins (same piece as "Blaze" and "Picked up"). */
function dedupeEquipmentTwins(rows) {
  const stacked = [];
  const gear = [];
  for (const row of rows) {
    const cat = String(row.category || "").toLowerCase();
    if (cat === "equipment" || cat === "artifact") gear.push(row);
    else stacked.push(row);
  }

  const byUid = new Map();
  const noUid = [];
  for (const row of gear) {
    if (row.uid) {
      const prev = byUid.get(row.uid);
      byUid.set(row.uid, prev ? preferEquipRow(prev, row) : row);
    } else {
      noUid.push(row);
    }
  }

  const byItem = new Map();
  for (const row of noUid) {
    const key = String(row.itemId || row.name || "");
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key).push(row);
  }

  const mergedGear = [...byUid.values()];
  for (const group of byItem.values()) {
    const named = group.filter((row) => row.from && row.from !== "loot");
    const unmatched = group.filter((row) => !row.from || row.from === "loot");
    if (named.length && unmatched.length) {
      const n = Math.max(named.length, unmatched.length);
      for (let i = 0; i < n; i += 1) {
        const a = named[i];
        const b = unmatched[i];
        if (a && b) mergedGear.push(preferEquipRow(a, b));
        else mergedGear.push(a || b);
      }
    } else {
      mergedGear.push(...group);
    }
  }

  return [...stacked, ...mergedGear];
}

function stackFarmDrops(rows) {
  const stacked = new Map();
  const unique = [];
  for (const row of rows) {
    const category = row.category || "material";
    if (!isRealLootItem(row.itemId || row.name, category, row.name || row.displayName)) continue;
    const isUnique =
      category === "equipment" ||
      category === "artifact" ||
      category === "cosmetic" ||
      Boolean(row.uid) ||
      (Array.isArray(row.substats) && row.substats.length);
    if (isUnique) {
      unique.push(row);
      continue;
    }
    const key = `${category}|${row.itemId || row.name}`;
    const cur = stacked.get(key);
    if (cur) {
      cur.count += Number(row.count) || 0;
      if (row.from && cur.from && !String(cur.from).includes(row.from)) {
        cur.from = `${cur.from}, ${row.from}`;
      }
    } else {
      stacked.set(key, { ...row, count: Number(row.count) || 0 });
    }
  }
  return dedupeEquipmentTwins([...stacked.values(), ...unique]);
}

function dumpClassDebug(actors, nowMs = Date.now()) {
  if (!DEBUG_DUMPS) return;
  if (nowMs - lastClassDumpAt < 2500) return;
  lastClassDumpAt = nowMs;
  try {
    const dir = APP_DATA_DIR;
    if (!existsSync(dir)) return;
    let identities = [];
    try {
      identities = directory.snapshot?.() || [];
    } catch {
      identities = [];
    }
    const payload = {
      at: new Date(nowMs).toISOString(),
      personalName,
      packets: stats.packets,
      damageEvents: stats.damageEvents,
      warning: lastWarning || null,
      classByName: Object.fromEntries(classByName),
      identities: identities.map((row) => ({
        id: row.actorId,
        name: row.displayName,
        archetype: row.archetype ?? null,
        className: archetypeClassName(row.archetype),
      })),
      actors: (actors || []).map((row) => ({
        name: row.name,
        className: row.className || null,
        archetype: row.archetype ?? null,
        skills: (row.skills || []).slice(0, 10).map((skill) => ({
          id: skill.id,
          name: skill.name,
          damage: skill.damage,
        })),
      })),
    };
    writeFileSync(join(dir, "class-debug.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch {
    /* ignore dump failures */
  }
}

function serializeFarm(session, startedAtMs, nowMs) {
  const snap = session.snapshot();
  const hours = Math.max(1 / 3600, (nowMs - startedAtMs) / 3_600_000);
  const drops = [];
  const equipCursor = new Map();
  for (const mob of snap.mobs || []) {
    for (const drop of mob.drops || []) {
      const category = drop.category || null;
      const itemId = drop.itemId || drop.displayName || "Item";
      if (!isRealLootItem(itemId, category, drop.displayName)) continue;
      const count = Number(drop.quantity ?? drop.count ?? 1);
      if (category === "equipment" || category === "artifact") {
        const details = equipDetailsFor(itemId, count, equipCursor, drop.uid || null);
        const name = resolvedItemName(category, itemId, drop.displayName);
        for (const detail of details) {
          drops.push({
            itemId,
            name,
            count: 1,
            from: mob.displayName,
            category,
            uid: detail?.uid || drop.uid || null,
            refine: detail?.refine ?? drop.refine ?? null,
            potential: detail?.potential ?? detail?.startingPotential ?? drop.potential ?? null,
            cards: detail?.cards || drop.cards || [],
            substats: detail?.substats || drop.substats || [],
          });
        }
      } else {
        drops.push({
          itemId,
          name: resolvedItemName(category, itemId, drop.displayName),
          count,
          from: mob.displayName,
          category,
        });
      }
    }
  }
  for (const drop of snap.unmatchedDrops || []) {
    const category = drop.category || null;
    const itemId = drop.itemId || drop.displayName || "Item";
    if (!isRealLootItem(itemId, category, drop.displayName)) continue;
    const count = Number(drop.quantity ?? drop.count ?? 1);
    if (category === "equipment" || category === "artifact") {
      const details = equipDetailsFor(itemId, count, equipCursor, drop.uid || null);
      const name = resolvedItemName(category, itemId, drop.displayName);
      const chat = chatFoundNames.get(normLootName(name)) || chatFoundNames.get(normLootName(itemId));
      const from = chat ? "Party find" : "loot";
      for (const detail of details) {
        drops.push({
          itemId,
          name,
          count: 1,
          from,
          category,
          uid: detail?.uid || drop.uid || null,
          refine: detail?.refine ?? drop.refine ?? null,
          potential: detail?.potential ?? detail?.startingPotential ?? drop.potential ?? null,
          cards: detail?.cards || drop.cards || [],
          substats: detail?.substats || drop.substats || [],
        });
      }
    } else {
      const name = resolvedItemName(category, itemId, drop.displayName);
      const chat = chatFoundNames.get(normLootName(name)) || chatFoundNames.get(normLootName(itemId));
      drops.push({
        itemId,
        name,
        count,
        from: chat ? "Party find" : "loot",
        category,
      });
    }
  }
  const exp = expTracker.serialize(nowMs);
  const sessionCoins = Number(snap.totalCoins ?? 0n);
  const wallet =
    Number(lastKnownWallet) >= 100
      ? Number(lastKnownWallet)
      : Number(playerEconomy?.coins) >= 100
        ? Number(playerEconomy.coins)
        : null;
  const earned = walletGoldGained();
  // The live wallet is ground truth; reward-event coins only until the first wallet tick.
  const sessionGoldForHud = earned != null ? earned : sessionCoins;
  const sessionXp = exp.xp;
  const sessionJobXp = exp.jobXp;
  const xpPerHour = exp.xpPerHour;
  const jobXpPerHour = exp.jobXpPerHour;
  const remainingXp = exp.xpToLevel;
  const xpPercent = exp.known ? exp.xpPercent : null;
  const ttlMs = exp.ttlMs;
  const remainingJobXp = exp.jobXpToLevel;
  const jobXpPercent = exp.jobMaxed ? 100 : exp.jobXpPercent;
  const jobTtlMs = exp.jobTtlMs;
  const baseMaxed = exp.baseMaxed;
  const jobMaxed = exp.jobMaxed;
  const stacked = stackFarmDrops(drops).sort((a, b) => {
    const rank = (row) => {
      const cat = String(row.category || "").toLowerCase();
      if (cat === "equipment" || cat === "artifact") return 0;
      if (cat === "card" || cat === "gem") return 1;
      return 2;
    };
    const byRank = rank(a) - rank(b);
    if (byRank) return byRank;
    const an = String(a.name || a.displayName || a.itemId || "");
    const bn = String(b.name || b.displayName || b.itemId || "");
    return an.localeCompare(bn);
  });
  const rewardMobs = (snap.mobs || [])
    .map((mob) => {
      const name = resolvedMobName(mob.mobId, mob.displayName);
      const icons = monsterIconUrls(mob.mobId, name);
      return {
        id: mob.mobId,
        name,
        kills: Number(mob.attributedKills) || 0,
        xp: mob.experience,
        iconUrl: icons[0] || null,
        iconUrls: icons,
      };
    })
    .filter((mob) => mob.kills > 0 && mob.name && !partyNamed(mob.name));
  const killers = [...killerKills.values()]
    .map((row) => {
      const identity = directory.get(row.id);
      const className = archetypeClassName(identity?.archetype) || row.className || null;
      const name = betterName(row.name, actorDisplayName(row.id));
      if (!isPlaceholderName(name)) row.name = name;
      return {
        id: row.id,
        name: row.name,
        className,
        classIconUrl: classIconUrl(className),
        color: colorFor(row.name),
        kills: row.kills,
        mobs: [...row.mobs.values()]
          .filter((mob) => mob.name && !partyNamed(mob.name) && String(mob.name).toLowerCase() !== String(row.name).toLowerCase())
          .map((mob) => {
            const name = resolvedMobName(mob.id, mob.name);
            const icons = monsterIconUrls(mob.id, name);
            return {
              ...mob,
              name,
              iconUrl: icons[0] || null,
              iconUrls: icons,
            };
          })
          .sort((a, b) => (b.kills || 0) - (a.kills || 0)),
      };
    })
    .filter((row) => row.kills > 0 && !isPlaceholderName(row.name))
    .sort((a, b) => (b.kills || 0) - (a.kills || 0))
    .slice(0, 16);
  const localName = String(personalName || "").toLowerCase();
  let localKiller = localName
    ? killers.find((row) => String(row.name).toLowerCase() === localName)
    : killers[0];
  if (!localKiller && (rewardMobs.length || personalName)) {
    localKiller = {
      id: "you",
      name: personalName || "You",
      className: null,
      classIconUrl: null,
      color: colorFor(personalName || "You"),
      kills: 0,
      mobs: [],
    };
    killers.unshift(localKiller);
  }
  if (localKiller) {
    const byId = new Map((localKiller.mobs || []).map((mob) => [String(mob.id || mob.name), { ...mob }]));
    for (const mob of rewardMobs) {
      const key = String(mob.id || mob.name);
      const cur = byId.get(key);
      if (cur) {
        cur.kills = Math.max(cur.kills || 0, mob.kills || 0);
        cur.xp = mob.xp || cur.xp;
        cur.iconUrl = cur.iconUrl || mob.iconUrl;
      } else {
        byId.set(key, { ...mob });
      }
    }
    localKiller.mobs = [...byId.values()].sort((a, b) => (b.kills || 0) - (a.kills || 0));
    localKiller.kills = Math.max(
      localKiller.kills || 0,
      localKiller.mobs.reduce((sum, row) => sum + (Number(row.kills) || 0), 0),
    );
  }
  const mobsById = new Map(rewardMobs.map((row) => [String(row.id || row.name), row]));
  for (const mob of localKiller?.mobs || []) {
    const key = String(mob.id || mob.name);
    const cur = mobsById.get(key);
    if (cur) cur.kills = Math.max(cur.kills, mob.kills);
    else mobsById.set(key, { ...mob });
  }
  const mobs = [...mobsById.values()].sort((a, b) => (b.kills || 0) - (a.kills || 0)).slice(0, 40);
  const attributed = (snap.kills || []).filter((row) => row.attributed).length;
  const killTotal = Math.max(
    attributed,
    localKiller?.kills || 0,
    mobs.reduce((sum, row) => sum + (Number(row.kills) || 0), 0),
  );
  return {
    elapsedMs: nowMs - (goldRateStartedAt || startedAtMs),
    xp: sessionXp,
    jobXp: sessionJobXp,
    gold: sessionGoldForHud,
    xpPerHour,
    jobXpPerHour,
    goldPerHour: goldPerHourSinceReset(sessionGoldForHud, nowMs),
    inventoryGold: wallet,
    level: exp.level,
    jobLevel: exp.jobLevel,
    experience: exp.experience,
    jobExperience: exp.jobExperience,
    xpToLevel: remainingXp,
    xpPercent,
    ttlMs,
    jobXpToLevel: remainingJobXp,
    jobXpPercent,
    jobTtlMs,
    baseMaxed,
    jobMaxed,
    maxBaseLevel: exp.maxBaseLevel,
    maxJobLevel: exp.maxJobLevel,
    bagWeight: bagSynced ? bagWeight : sessionBagWeight || null,
    bagWeightMax: resolvedBagWeightMax(),
    kills: killTotal,
    drops: stacked.slice(0, 120),
    mobs,
    killers,
  };
}

const prefs = (() => {
  try {
    return JSON.parse(process.argv[2] || "{}");
  } catch {
    return {};
  }
})();

let personalName = "";
/** Last known name from prefs — display-only until LoadCharacter confirms. */
let personalNameHint = String(prefs.personalName || "").trim();
let localUid = "";
let localAccountId = "";

function effectivePersonalName() {
  return personalName || personalNameHint || "";
}
const deaths = [];
const castMap = new Map();
const bossCalls = [];
const floorHistory = [];
const knownPlayers = new Set();
const knownMonsters = new Set(); // actorId -> mobId
const monsterNames = new Map();
const bossActorIds = new Set();
/** Meters! BOSS toggle: credited actorId → damage landed on boss actors only. */
const bossDamageByActor = new Map();
const bossTargetNames = new Set();
let bossFightStartedAt = null;
let bossFightLastHitAt = null;
const actorNames = new Map(); // actorId -> resolved display name
const classByName = new Map(); // lowercase player name -> className
/** SummoningComponent object id → summoner PlayerController actor id. */
const summonOwnerByActorId = new Map();
/** Summon object id → live pet row (skill, HP, owner). */
const petStateByActorId = new Map();
/** Backup status map for pets — survives identity-remove wipes. */
const petStatusBackup = new Map();
/** HP seen on summon-owned objects before SummonSkillSync arrives. */
const pendingPetHealth = new Map();
/** Recent pet status packet recoveries (debug). */
const petStatusProbe = [];
const PET_STATUS_PROBE_MAX = 40;
let lastPetDebugAt = 0;
let lastClassDumpAt = 0;
let lastIdentitySaveAt = 0;
let lootFilter = null; // last UpdateLootFilter_S decode
const mobDefs = mobDefinitionsById();
const mobIdentityCatalog = mobIdentityDefinitionsById();

function humanizeMobId(id) {
  return String(id || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function addExtraMonster(row) {
  const id = String(row?.id || "").trim();
  if (!id || mobDefs.has(id)) return false;
  mobDefs.set(id, {
    id,
    displayName: String(row.displayName || row.name || humanizeMobId(id)),
    level: Number(row.level) || 0,
    boss: Boolean(row.boss),
    baseExperience: Number(row.baseExperience ?? row.exp) || 0,
    baseCoins: Number(row.baseCoins) || 0,
    drops: [],
    ...(row.slug ? { slug: String(row.slug) } : {}),
  });
  mobNameIndex = null;
  return true;
}

for (const row of extraMonsterRows) addExtraMonster(row);

/**
 * The stock FishNet monster directory drops spawns whose id isn't in the catalog, so
 * brand-new event mobs never got names, kill credit, or boss flags. Answer for any id.
 */
class OpenMonsterCatalog extends Map {
  get(mobId) {
    const hit = super.get(mobId);
    if (hit) return hit;
    const id = String(mobId || "").trim();
    if (!id || /^Summon/i.test(id)) return undefined;
    addExtraMonster({ id });
    const def = mobDefs.get(id);
    return { id, displayName: def?.displayName || humanizeMobId(id), level: Number(def?.level) || 0 };
  }
}

function createOpenMonsterCatalog() {
  const catalog = new OpenMonsterCatalog();
  for (const [id, row] of mobIdentityCatalog) catalog.set(id, row);
  return catalog;
}

/** Pick up monsters the wiki adds after this build shipped. */
async function refreshExtraMonstersFromWiki() {
  try {
    const res = await fetch("https://spiritvalers.com/wiki-data/monsters.json", {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return;
    const list = await res.json();
    if (!Array.isArray(list)) return;
    for (const m of list) {
      const id = String(m?.id || "").trim();
      if (!id) continue;
      if (mobIdentityCatalog.has(id)) continue;
      const existing = mobDefs.get(id);
      if (existing && m.name) {
        existing.displayName = String(m.name);
        existing.level = Number(m.level) || existing.level;
        existing.boss = Boolean(m.boss) || existing.boss;
        existing.baseExperience = Number(m.exp) || existing.baseExperience;
        mobNameIndex = null;
        continue;
      }
      addExtraMonster({ id, displayName: m.name, level: m.level, boss: m.boss, exp: m.exp, slug: m.slug });
    }
  } catch {
    /* offline — bundled extra-monsters.json still applies */
  }
}

let lastTowerFloor = null;
let captureStartedAt = Date.now();
let gameSeen = false;
let lastWarning = "";
let playerEconomy = null;
let goldRateBaseline = null;
let goldRateStartedAt = captureStartedAt;
/** Sticky absolute wallet — survives junk/zero packets between ExpCoins ticks. */
let lastKnownWallet = null;
/** Gold! earned = sum of wallet increases since Reset; spending never subtracts. */
/** Session timer pause: gains are not counted and rate clocks skip the paused span. */
let sessionPausedAt = null;

function isSessionPaused() {
  return sessionPausedAt != null;
}

function snapshotNow() {
  return sessionPausedAt ?? Date.now();
}

function pauseSession(nowMs = Date.now()) {
  if (sessionPausedAt != null) return false;
  sessionPausedAt = nowMs;
  expTracker.setPaused(true);
  return true;
}

function resumeSession(nowMs = Date.now()) {
  if (sessionPausedAt == null) return false;
  const pausedMs = Math.max(0, nowMs - sessionPausedAt);
  sessionPausedAt = null;
  captureStartedAt += pausedMs;
  if (goldRateStartedAt) goldRateStartedAt += pausedMs;
  if (bossFightStartedAt != null) bossFightStartedAt += pausedMs;
  if (bossFightLastHitAt != null) bossFightLastHitAt += pausedMs;
  expTracker.shiftClock(pausedMs);
  expTracker.setPaused(false);
  return true;
}

let goldEarnedSinceReset = 0;
let walletPrev = null;
/** Large jumps wait for a later packet to confirm — one misdecoded int64 must not add millions. */
let walletPendingJump = null;
const WALLET_JUMP_CONFIRM = 100_000;
/**
 * Only packets the RPC map names ExpCoinsChanged_T / CoinsCallback_T carry the real wallet.
 * Hash-guessed and loose "Coins"/currency fields decode other RPCs and event currencies.
 */
let economyPacketTrusted = false;
let walletTrusted = false;
/** Gold-only economy baseline (XP baseline lives in expTracker). */
let lastEconomy = null;

const IDENTITY_STORE_PATH = join(APP_DATA_DIR, "known-identities.json");

function loadIdentityStore() {
  try {
    if (!existsSync(IDENTITY_STORE_PATH)) return { known: [], actors: {}, classes: {} };
    const parsed = JSON.parse(readFileSync(IDENTITY_STORE_PATH, "utf8"));
    return {
      known: Array.isArray(parsed?.known) ? parsed.known : [],
      actors: parsed?.actors && typeof parsed.actors === "object" ? parsed.actors : {},
      classes: parsed?.classes && typeof parsed.classes === "object" ? parsed.classes : {},
    };
  } catch {
    return { known: [], actors: {}, classes: {} };
  }
}

function seedIdentityStore(store) {
  for (const [id, name] of Object.entries(store.actors || {})) {
    if (!name || isPlaceholderName(name)) continue;
    actorNames.set(id, name);
    const num = Number(id);
    if (Number.isFinite(num)) actorNames.set(num, name);
  }
  for (const [name, cls] of Object.entries(store.classes || {})) {
    if (!name || !cls) continue;
    classByName.set(String(name).toLowerCase(), cls);
  }
}

function saveIdentityStore(force = false) {
  const now = Date.now();
  if (!force && now - lastIdentitySaveAt < 15000) return;
  lastIdentitySaveAt = now;
  try {
    const dir = dirname(IDENTITY_STORE_PATH);
    if (!existsSync(dir)) {
      /* fs.mkdirSync not imported — writeFile will fail if missing; AppData folder exists */
    }
    const knownByUid = new Map();
    for (const row of identityStore.known || []) {
      if (row?.uid && row?.displayName) knownByUid.set(String(row.uid), row);
    }
    try {
      for (const row of directory.snapshot?.() || []) {
        if (!row?.uid || !row?.displayName || isPlaceholderName(row.displayName)) continue;
        const prev = knownByUid.get(String(row.uid)) || {};
        knownByUid.set(String(row.uid), {
          uid: String(row.uid),
          displayName: row.displayName,
          archetype: row.archetype ?? prev.archetype,
        });
      }
    } catch {
      /* directory may not be ready */
    }
    const actors = {};
    for (const [key, name] of actorNames) {
      if (!/^-?\d+$/.test(String(key))) continue;
      if (!name || isPlaceholderName(name)) continue;
      actors[String(key)] = name;
    }
    const classes = Object.fromEntries(classByName);
    const payload = {
      savedAt: new Date(now).toISOString(),
      known: [...knownByUid.values()],
      actors,
      classes,
    };
    identityStore = payload;
    writeFileSync(IDENTITY_STORE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch {
    /* ignore persist failures */
  }
}

let identityStore = loadIdentityStore();
seedIdentityStore(identityStore);

/**
 * Simple gold tracker:
 * - Inventory = last live absolute wallet (ExpCoins / CoinsCallback / currency≥100)
 * - Earned = Inventory − baseline (baseline locks on first live wallet or Reset)
 * - Gold/hr = Earned / hours since baseline
 * Never seed from disk — stale cache desyncs the meter.
 */
function adoptGoldBaseline(coins, nowMs = Date.now()) {
  const n = Number(coins);
  if (!Number.isFinite(n) || n < 100) return;
  if (goldRateBaseline == null || Number(goldRateBaseline) < 100) {
    goldRateBaseline = n;
    goldRateStartedAt = nowMs;
  }
}

function observeWallet(coins) {
  const n = Number(coins);
  if (!Number.isFinite(n) || n < 100) return;
  if (walletPrev == null || isSessionPaused()) {
    walletPendingJump = null;
    walletPrev = n;
    return;
  }
  if (walletPendingJump) {
    // The same packet reaches several decode paths; only a later packet can confirm.
    if (walletPendingJump.packet === stats.packets) return;
    const { from, to } = walletPendingJump;
    walletPendingJump = null;
    if (Math.abs(n - to) < Math.abs(n - from)) {
      if (to > from) goldEarnedSinceReset += to - from;
      walletPrev = to;
    }
  }
  const delta = n - walletPrev;
  if (Math.abs(delta) > WALLET_JUMP_CONFIRM) {
    walletPendingJump = { from: walletPrev, to: n, packet: stats.packets };
    return;
  }
  if (delta > 0) goldEarnedSinceReset += delta;
  walletPrev = n;
}

function resetGoldEarned() {
  goldEarnedSinceReset = 0;
  walletPendingJump = null;
  walletPrev = walletTrusted && Number(lastKnownWallet) >= 100 ? Number(lastKnownWallet) : null;
}

function setWalletCoins(coins, nowMs = Date.now(), trusted = false) {
  const n = typeof coins === "bigint" ? Number(coins) : Number(coins);
  if (!Number.isFinite(n) || n < 100) return false;
  if (!trusted) {
    // Cold-start Inventory display only; never feeds Earned or Gold/hr.
    if (!walletTrusted) lastKnownWallet = n;
    return false;
  }
  walletTrusted = true;
  if (!playerEconomy) playerEconomy = { updatedAt: nowMs };
  playerEconomy.coins = n;
  playerEconomy.updatedAt = nowMs;
  lastKnownWallet = n;
  observeWallet(n);
  adoptGoldBaseline(n, nowMs);
  return true;
}
let bagWeight = 0;
let bagWeightLimitAttr = null;
let wornWeightLimitBonus = 0;
let bagSynced = false;
const bagItems = new Map();
const equipDetailsLog = [];
const killerKills = new Map();
let sessionBagWeight = 0;
const stats = {
  packets: 0,
  activations: 0,
  damageEvents: 0,
  damageSkipped: 0,
  damagePatched: 0,
  rewardEvents: 0,
  rewardErrors: 0,
};

const directory = new FishNetActorDirectory({
  // Never seed a stale prefs name — always learn from LoadCharacter / CharacterCallback.
  localIdentity: undefined,
  knownIdentities: (identityStore.known || []).filter(
    (row) => row?.uid && row?.displayName && !isPlaceholderName(row.displayName),
  ),
  stickyPlayerIdentities: true,
  onIdentityLearned: (identity) => {
    if (!identity?.uid || !identity?.displayName || isPlaceholderName(identity.displayName)) return;
    const list = Array.isArray(identityStore.known) ? [...identityStore.known] : [];
    const idx = list.findIndex((row) => String(row.uid) === String(identity.uid));
    const next = {
      uid: String(identity.uid),
      displayName: identity.displayName,
      archetype: identity.archetype,
    };
    if (idx >= 0) list[idx] = { ...list[idx], ...next };
    else list.push(next);
    identityStore.known = list;
    rememberClass(identity.displayName, identity.archetype);
    saveIdentityStore();
  },
  onLocalIdentity: (identity) => {
    if (identity?.uid) localUid = identity.uid;
    if (identity?.accountId) localAccountId = identity.accountId;
    if (identity?.displayName) {
      const next = String(identity.displayName).trim();
      const changed = personalName !== next;
      personalName = next;
      try {
        meter.setPersonalName(next);
      } catch {
        /* ignore */
      }
      if (identity.archetype != null) rememberClass(next, identity.archetype);
      const match = directory
        .snapshot()
        .find(
          (row) => String(row.displayName || "").toLowerCase() === next.toLowerCase(),
        );
      if (match?.actorId != null) meter.setPersonalActorId(match.actorId);
      if (changed) {
        personalNameHint = next;
        emit({ type: "identity", personalName: next, auto: true });
      }
      saveIdentityStore();
    }
  },
});

const tracker = new FishNetCombatTracker({
  bossCatalog: createBossCatalog({}),
  monsterCatalog: createOpenMonsterCatalog(),
  actorIdentityResolver: (actorId) => directory.getAttribution(actorId) || directory.get(actorId),
});
const meter = new LiveCombatService({
  personalName: undefined,
  // Session until Reset — map farming must not auto-split on idle.
  idleGapMs: 24 * 60 * 60 * 1000,
});

function adoptPersonalName(name, extra = {}) {
  const next = String(name || "").trim();
  if (!next || isPlaceholderName(next)) return false;
  const changed = personalName !== next;
  personalName = next;
  if (extra.uid) localUid = String(extra.uid);
  if (extra.accountId) localAccountId = String(extra.accountId);
  try {
    meter.setPersonalName(next);
  } catch {
    /* ignore */
  }
  try {
    directory.setLocalIdentity({
      displayName: next,
      ...(localUid ? { uid: localUid } : {}),
      ...(localAccountId ? { accountId: localAccountId } : {}),
      ...(extra.archetype != null ? { archetype: extra.archetype } : {}),
    });
  } catch {
    /* ignore */
  }
  if (changed) {
    personalNameHint = next;
    emit({ type: "identity", personalName: next, auto: true });
  }
  return changed;
}

function noteLocalNameFromCharacterPacket(packet) {
  const rpc = packet?.rpcName;
  if (rpc !== "LoadCharacter_T" && rpc !== "CharacterCallback_T") return;
  const fields = packet.decodedFields || [];
  const name = fields.find((field) => /^(data|sync)\.Name$/i.test(String(field?.name || "")))?.value;
  if (typeof name !== "string" || !name.trim()) return;
  const uid = fields.find((field) => /^(data|sync)\.UID$/i.test(String(field?.name || "")))?.value;
  const accountId = fields.find((field) =>
    /^(data|sync)\.AccountId$/i.test(String(field?.name || "")),
  )?.value;
  adoptPersonalName(name.trim(), {
    uid: typeof uid === "string" ? uid : undefined,
    accountId: typeof accountId === "string" ? accountId : undefined,
    archetype: extractArchetypeValue(fields),
  });
}

function readSummonerSyncValue(packet) {
  if (!packet) return null;
  for (const entry of packet.syncEntries || []) {
    if (String(entry?.name || "") !== "SummonerSync") continue;
    const value = (entry.fields || []).find((field) => String(field?.name || "") === "SummonerSync")?.value;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  }
  for (const entry of packet.spawnSyncEntries || []) {
    if (
      entry?.networkBehaviourType === "SummoningComponent" &&
      String(entry?.name || "") === "SummonerSync"
    ) {
      const value = (entry.fields || []).find((field) => String(field?.name || "") === "SummonerSync")
        ?.value;
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
    }
  }
  if (packet.networkBehaviourType === "SummoningComponent") {
    const value = (packet.decodedFields || []).find(
      (field) => String(field?.name || "") === "SummonerSync",
    )?.value;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}

function readSummonSkillId(packet) {
  if (!packet) return null;
  const takeSkill = (fields) => {
    const list = fields || [];
    const skill = list.find((field) => String(field?.name || "") === "SkillId")?.value;
    if (typeof skill === "string" && isSummonSkillId(skill)) return skill.trim();
    const unit = list.find((field) => String(field?.name || "") === "Id")?.value;
    if (typeof unit === "string" && unit.trim() && /^Summon/i.test(unit.trim())) {
      return unit.trim();
    }
    return null;
  };
  for (const entry of packet.syncEntries || []) {
    if (String(entry?.name || "") !== "SummonSkillSync") continue;
    const value = takeSkill(entry.fields);
    if (value) return value;
  }
  for (const entry of packet.spawnSyncEntries || []) {
    // Spawn payloads sometimes omit networkBehaviourType — still accept SummonSkillSync by name.
    if (String(entry?.name || "") !== "SummonSkillSync") continue;
    if (
      entry.networkBehaviourType &&
      entry.networkBehaviourType !== "SummoningComponent"
    ) {
      continue;
    }
    const value = takeSkill(entry.fields);
    if (value) return value;
  }
  if (packet.networkBehaviourType === "SummoningComponent") {
    const value = takeSkill(packet.decodedFields);
    if (value) return value;
  }
  return null;
}

/** SummonSkillSync.Id — the summoned unit (e.g. "Mega Ice Golem" for a Reanimation boss). */
function readSummonUnitId(packet) {
  if (!packet) return null;
  const entries = [...(packet.syncEntries || []), ...(packet.spawnSyncEntries || [])];
  for (const entry of entries) {
    if (String(entry?.name || "") !== "SummonSkillSync") continue;
    const unit = (entry.fields || []).find((field) => String(field?.name || "") === "Id")?.value;
    if (typeof unit === "string" && unit.trim()) return unit.trim();
  }
  return null;
}

function readNamedSyncNumber(packet, syncName) {
  if (!packet || !syncName) return null;
  const want = String(syncName);
  const take = (value) => {
    const n = typeof value === "bigint" ? Number(value) : Number(value);
    return Number.isFinite(n) ? n : null;
  };
  for (const entry of packet.syncEntries || []) {
    if (String(entry?.name || "") !== want) continue;
    const field = (entry.fields || []).find((row) => String(row?.name || "") === want);
    const n = take(field?.value ?? entry.value);
    if (n != null) return n;
  }
  for (const entry of packet.spawnSyncEntries || []) {
    if (String(entry?.name || "") !== want) continue;
    // Never take a same-named sync from non-health behaviours.
    if (entry.networkBehaviourType && entry.networkBehaviourType !== "HealthComponent") continue;
    const field = (entry.fields || []).find((row) => String(row?.name || "") === want);
    const n = take(field?.value ?? entry.value);
    if (n != null) return n;
  }
  // Named field on decoded payload — only when this packet is HealthComponent.
  if (packet.networkBehaviourType === "HealthComponent") {
    if (String(packet.syncName || "") === want || packet.syncIndex === healthSyncIndex(want)) {
      const named = (packet.decodedFields || []).find((row) => String(row?.name || "") === want);
      const n = take(named?.value);
      if (n != null) return n;
      // Single-field health syncType packets often omit the name and only carry the Int32.
      if ((packet.decodedFields || []).length === 1) {
        const only = take(packet.decodedFields[0]?.value);
        if (only != null) return only;
      }
    }
    const fromFields = (packet.decodedFields || []).find((row) => String(row?.name || "") === want);
    return take(fromFields?.value);
  }
  return null;
}

function healthSyncIndex(name) {
  if (name === "healthSync") return 0;
  if (name === "maxHealthSync") return 1;
  if (name === "barrierSync") return 2;
  if (name === "overhealSync") return 3;
  return -1;
}

function isHealthComponentPacket(packet) {
  if (!packet) return false;
  if (packet.networkBehaviourType === "HealthComponent") return true;
  if (
    (packet.rpcName === "ApplyDamage_C" ||
      packet.rpcName === "Death_C" ||
      packet.rpcName === "Recover_C") &&
    (!packet.networkBehaviourType || packet.networkBehaviourType === "HealthComponent")
  ) {
    return true;
  }
  return (packet.spawnSyncEntries || []).some(
    (entry) => entry?.networkBehaviourType === "HealthComponent",
  );
}

/** Summon object id → last known Summon* skill (survives owner-only sync packets). */
const skillIdBySummonActorId = new Map();
/** Summon object id → summoned unit id from SummonSkillSync.Id. */
const unitIdBySummonActorId = new Map();

function isPlainSkeletonSkill(skillId) {
  return String(skillId || "").trim() === "SummonSkeleton";
}

function rememberSummonSkill(actorId, skillId) {
  const id = Number(actorId);
  const skill = String(skillId || "").trim();
  if (!Number.isInteger(id) || id < 0 || !isSummonSkillId(skill)) return;
  skillIdBySummonActorId.set(id, skill);
}

function resolveSummonSkill(actorId, explicitSkillId = null) {
  if (explicitSkillId && isSummonSkillId(explicitSkillId)) return String(explicitSkillId).trim();
  const id = Number(actorId);
  if (skillIdBySummonActorId.has(id)) return skillIdBySummonActorId.get(id);
  const row = petStateByActorId.get(id);
  if (row?.skillId && isSummonSkillId(row.skillId)) return row.skillId;
  return null;
}

/** When skill sync was missed (late join), match HP pool to a sibling pet of the same owner. */
function inferSkillFromOwnerHp(ownerActorId, maxHp) {
  const owner = Number(ownerActorId);
  const pool = Number(maxHp);
  if (!Number.isInteger(owner) || !Number.isFinite(pool) || pool < 100) return null;
  let best = null;
  let bestDist = Infinity;
  for (const row of petStateByActorId.values()) {
    if (!row || Number(row.ownerActorId) !== owner) continue;
    if (!isSummonSkillId(row.skillId)) continue;
    const siblingMax = Number(row.maxHp);
    if (!Number.isFinite(siblingMax) || siblingMax < 100) continue;
    const dist = Math.abs(siblingMax - pool);
    // Same summon skill shares an essentially identical max HP.
    if (dist <= Math.max(5, siblingMax * 0.02) && dist < bestDist) {
      best = row.skillId;
      bestDist = dist;
    }
  }
  return best;
}

function resolveOwnerForSummon(actorId, explicitOwner = null) {
  const id = Number(actorId);
  if (explicitOwner != null && Number(explicitOwner) !== id) return Number(explicitOwner);
  if (summonOwnerByActorId.has(id)) return summonOwnerByActorId.get(id);
  const row = petStateByActorId.get(id);
  if (row?.ownerActorId != null && Number(row.ownerActorId) !== id) return Number(row.ownerActorId);
  return null;
}

function upsertSummonPet(actorId, { ownerActorId = null, skillId = null, hp = null, maxHp = null, barrier = null } = {}) {
  const id = Number(actorId);
  if (!Number.isInteger(id) || id < 0) return null;
  const owner = resolveOwnerForSummon(id, ownerActorId);
  let skill = resolveSummonSkill(id, skillId);
  if (!skill && owner != null && maxHp != null) {
    skill = inferSkillFromOwnerHp(owner, maxHp);
  }
  if (owner != null && owner !== id) summonOwnerByActorId.set(id, owner);
  if (skill) rememberSummonSkill(id, skill);
  if (!skill) {
    // Keep HP pending until we learn the Summon* skill.
    if (hp != null || maxHp != null || barrier != null) {
      const prev = pendingPetHealth.get(id) || {};
      pendingPetHealth.set(id, {
        hp: hp ?? prev.hp ?? null,
        maxHp: maxHp ?? prev.maxHp ?? null,
        barrier: barrier ?? prev.barrier ?? null,
      });
    }
    return null;
  }
  const patch = { skillId: skill, dead: false };
  if (owner != null && owner !== id) patch.ownerActorId = owner;
  const pending = pendingPetHealth.get(id);
  if (pending) {
    if (pending.hp != null) patch.hp = pending.hp;
    if (pending.maxHp != null) patch.maxHp = pending.maxHp;
    if (pending.barrier != null) patch.barrier = pending.barrier;
    pendingPetHealth.delete(id);
  }
  if (hp != null) patch.hp = hp;
  if (maxHp != null) patch.maxHp = maxHp;
  if (barrier != null) patch.barrier = barrier;
  return ensurePetState(id, patch);
}

function saveSkeletonNameCursor() {
  try {
    const dir = dirname(SKELETON_NAME_STATE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      SKELETON_NAME_STATE_PATH,
      `${JSON.stringify({ nextIndex: skeletonNameNextIndex }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

/** Assign the next funny name to a fresh Summon Skeleton (sticky for that actor). */
function assignSkeletonNickname(row) {
  if (!row || !isPlainSkeletonSkill(row.skillId)) return;
  if (row.nickname) return;
  if (!skeletonNameList.length) return;
  const idx = skeletonNameNextIndex % skeletonNameList.length;
  row.nickname = skeletonNameList[idx];
  skeletonNameNextIndex = (idx + 1) % skeletonNameList.length;
  saveSkeletonNameCursor();
}

function ensurePetState(actorId, patch = {}) {
  const id = Number(actorId);
  if (!Number.isInteger(id) || id < 0) return null;
  let row = petStateByActorId.get(id);
  if (!row) {
    row = {
      actorId: id,
      ownerActorId: null,
      skillId: null,
      nickname: null,
      hp: null,
      maxHp: null,
      barrier: null,
      dead: false,
      updatedAt: Date.now(),
    };
    petStateByActorId.set(id, row);
  }
  Object.assign(row, patch, { updatedAt: Date.now() });
  assignSkeletonNickname(row);
  return row;
}

/** Learn summon → owner so pet damage rolls up on the Summoner bar. */
function noteSummonOwnerFromPacket(packet) {
  if (!packet || packet.objectId == null) return;
  const summonObjectId = Number(packet.objectId);
  if (!Number.isInteger(summonObjectId) || summonObjectId < 0) return;

  if (packet.packetName === "objectDespawn") {
    summonOwnerByActorId.delete(summonObjectId);
    petStateByActorId.delete(summonObjectId);
    petStatusBackup.delete(summonObjectId);
    pendingPetHealth.delete(summonObjectId);
    skillIdBySummonActorId.delete(summonObjectId);
    unitIdBySummonActorId.delete(summonObjectId);
    return;
  }
  if (packet.packetName === "authenticated" || packet.packetName === "disconnect") {
    summonOwnerByActorId.clear();
    petStateByActorId.clear();
    petStatusBackup.clear();
    pendingPetHealth.clear();
    skillIdBySummonActorId.clear();
    unitIdBySummonActorId.clear();
    return;
  }

  const ownerActorId = readSummonerSyncValue(packet);
  const skillId = readSummonSkillId(packet);
  if (ownerActorId == null && !skillId) return;
  if (skillId) {
    const unitId = readSummonUnitId(packet);
    if (unitId) unitIdBySummonActorId.set(summonObjectId, unitId);
  }

  if (ownerActorId != null && ownerActorId !== summonObjectId) {
    summonOwnerByActorId.set(summonObjectId, ownerActorId);
  }
  if (skillId) rememberSummonSkill(summonObjectId, skillId);

  // Owner-only sync for an already-known summon — just refresh owner, don't drop the row.
  if (!skillId) {
    const existing = petStateByActorId.get(summonObjectId);
    const owner = resolveOwnerForSummon(summonObjectId, ownerActorId);
    if (existing?.skillId && owner != null) {
      ensurePetState(summonObjectId, { ownerActorId: owner });
      return;
    }
    // Try promoting a pending HP-owned object once we at least know the owner
    // and can infer skill from siblings (late join / missed SummonSkillSync).
    const pending = pendingPetHealth.get(summonObjectId);
    if (owner != null && pending?.maxHp != null) {
      upsertSummonPet(summonObjectId, {
        ownerActorId: owner,
        maxHp: pending.maxHp,
        hp: pending.hp,
        barrier: pending.barrier,
      });
    }
    return;
  }

  upsertSummonPet(summonObjectId, {
    ownerActorId,
    skillId,
  });
}

function notePetHealthFromPacket(packet) {
  if (!packet || packet.objectId == null) return;
  const actorId = Number(packet.objectId);
  if (!Number.isInteger(actorId) || actorId < 0) return;

  // Only HealthComponent sync/spawn carries real HP — SummoningComponent syncIndex 0/1
  // was previously misread as 1/13 for every pet.
  if (!isHealthComponentPacket(packet)) return;

  const hp = readNamedSyncNumber(packet, "healthSync");
  const maxHp = readNamedSyncNumber(packet, "maxHealthSync");
  const barrier = readNamedSyncNumber(packet, "barrierSync");
  if (hp == null && maxHp == null && barrier == null) return;

  // Already a tracked summon skill pet → apply immediately.
  if (petStateByActorId.has(actorId)) {
    applyPetHealth(actorId, { hp, maxHp, barrier });
    // Backfill owner if SummonerSync arrived on a different packet.
    const owner = resolveOwnerForSummon(actorId);
    if (owner != null) ensurePetState(actorId, { ownerActorId: owner });
    return;
  }

  // Owned summon (or sticky skill) — promote even if SummonSkillSync was missed this session.
  if (summonOwnerByActorId.has(actorId) || skillIdBySummonActorId.has(actorId)) {
    const row = upsertSummonPet(actorId, {
      ownerActorId: summonOwnerByActorId.get(actorId) ?? null,
      skillId: skillIdBySummonActorId.get(actorId) ?? null,
      hp,
      maxHp,
      barrier,
    });
    if (row) return;
  }

  // Not promotable yet — stash HP against SummonerSync ownership.
  if (summonOwnerByActorId.has(actorId)) {
    const prev = pendingPetHealth.get(actorId) || {};
    pendingPetHealth.set(actorId, {
      hp: hp ?? prev.hp ?? null,
      maxHp: maxHp ?? prev.maxHp ?? null,
      barrier: barrier ?? prev.barrier ?? null,
    });
  }
}

function applyPetHealth(actorId, { hp = null, maxHp = null, barrier = null } = {}) {
  const prev = petStateByActorId.get(Number(actorId));
  const patch = { dead: false };
  if (maxHp != null && Number.isFinite(maxHp) && maxHp >= 0) {
    // Prefer larger authentic max HP — ignore tiny junk overwriting a real pool.
    if (prev?.maxHp == null || maxHp >= 20 || maxHp >= Number(prev.maxHp) || Number(prev.maxHp) < 20) {
      patch.maxHp = Math.max(0, maxHp);
    }
  }
  if (hp != null && Number.isFinite(hp) && hp >= 0) {
    const nextMax = patch.maxHp ?? prev?.maxHp;
    if (nextMax != null && hp > nextMax * 1.05 && hp >= 20) {
      // Current HP above known max → grow max (level-up / buff).
      patch.maxHp = Math.max(nextMax, hp);
      patch.hp = hp;
    } else if (nextMax != null && nextMax >= 20 && hp <= 5 && hp < nextMax * 0.02 && prev?.hp != null && prev.hp > nextMax * 0.5) {
      // Ignore sudden 1-HP junk while we recently saw a healthy pet.
    } else {
      patch.hp = Math.max(0, hp);
    }
  }
  if (barrier != null && Number.isFinite(barrier) && barrier >= 0) {
    patch.barrier = Math.max(0, barrier);
  }
  if (summonOwnerByActorId.has(Number(actorId))) {
    patch.ownerActorId = summonOwnerByActorId.get(Number(actorId));
  }
  if (Object.keys(patch).length <= 1 && patch.dead === false && !("hp" in patch) && !("maxHp" in patch) && !("barrier" in patch)) {
    return;
  }
  const row = ensurePetState(actorId, patch);
  if (row?.maxHp != null && row?.hp != null && row.hp > row.maxHp) {
    row.hp = row.maxHp;
  }
  return row;
}

/** Live HP from damage/heal RPCs — faster than waiting for the next healthSync. */
function notePetCombatHealth(event) {
  if (!event) return;
  if (event.kind !== "damage" && event.kind !== "death" && event.kind !== "heal") return;
  const targetId = event.kind === "heal" ? event.targetId : event.targetId ?? event.objectId;
  const actorId = Number(targetId);
  if (!Number.isInteger(actorId) || actorId < 0) return;
  // Only mutate pets that already have a SummonSkillSync row — never spawn ghosts here.
  if (!petStateByActorId.has(actorId)) return;

  if (event.kind === "death") {
    applyPetHealth(actorId, { hp: 0 });
    ensurePetState(actorId, { dead: true, hp: 0 });
    return;
  }

  const row = petStateByActorId.get(actorId);
  const value = Math.abs(Number(event.value) || 0);
  if (!row || !Number.isFinite(value) || value <= 0) return;

  let hp = row.hp;
  let maxHp = row.maxHp;
  if (hp == null && maxHp == null) return;

  if (event.kind === "damage") {
    if (hp == null && maxHp != null) hp = maxHp;
    if (hp == null) return;
    hp = Math.max(0, hp - value);
  } else if (event.kind === "heal") {
    if (hp == null) hp = 0;
    hp = maxHp != null ? Math.min(maxHp, hp + value) : hp + value;
  }
  applyPetHealth(actorId, { hp, maxHp });
}

function rememberPetStatus(actorId, statusId, patch, nowMs = Date.now()) {
  const id = Number(actorId);
  if (!Number.isInteger(id) || id < 0) return;
  const key = String(statusId || "").trim();
  if (!key) return;
  let map = petStatusBackup.get(id);
  if (!map) {
    map = new Map();
    petStatusBackup.set(id, map);
  }
  if (patch?.removed) {
    map.delete(key);
    if (!map.size) petStatusBackup.delete(id);
    return;
  }
  const prev = map.get(key);
  const def = resolveFishNetStatus(key) || resolveFishNetStatus(patch?.displayName);
  const expiresAtMs =
    patch?.remainingSeconds != null
      ? nowMs + Number(patch.remainingSeconds) * 1000
      : prev?.expiresAtMs;
  map.set(key, {
    displayName: def?.displayName || patch?.displayName || key,
    isDebuff: Boolean(def?.isDebuff),
    level: patch?.level || prev?.level || 1,
    stacks: patch?.stacks || prev?.stacks || 1,
    spriteId: def?.spriteId || prev?.spriteId,
    expiresAtMs,
    appliedAtMs: nowMs,
  });
}

function pushPetStatusProbe(entry) {
  petStatusProbe.push(entry);
  while (petStatusProbe.length > PET_STATUS_PROBE_MAX) petStatusProbe.shift();
}

function notePetStatusFromEvent(event, nowMs = Date.now()) {
  if (!event || event.kind !== "status") return;
  const actorId = Number(event.actorId);
  if (!Number.isInteger(actorId) || actorId < 0) return;
  // Buffer for any actor — serializePets only surfaces statuses for known pets.
  // (Statuses often arrive before SummonSkillSync marks the object as a pet.)
  const statusId = String(event.statusId || "").trim();
  if (!statusId) return;
  if (event.action === "removed") {
    rememberPetStatus(actorId, statusId, { removed: true }, nowMs);
    return;
  }
  rememberPetStatus(
    actorId,
    statusId,
    {
      displayName: event.displayName,
      level: event.level,
      stacks: event.stacks,
      remainingSeconds: event.remainingSeconds,
    },
    nowMs,
  );
}

/**
 * Recover ApplyEffectDisplays_O / skill displays the combat tracker drops:
 * - decoder missing Level field → silent fail on leveled buffs
 * - ambiguous rpcHash 5 only for StatusComponent indices 5/6
 * - ApplySkillDisplay never recovered on ambiguous packets
 */
function notePetStatusFromPacket(packet, nowMs = Date.now()) {
  if (!packet || packet.objectId == null) return;
  const actorId = Number(packet.objectId);
  if (!Number.isInteger(actorId) || actorId < 0) return;
  const isKnownPet =
    summonOwnerByActorId.has(actorId) || petStateByActorId.has(actorId);
  const tryDisplays =
    packetLooksLikeEffectDisplays(packet) &&
    (isKnownPet ||
      packet.networkBehaviourType === "StatusComponent" ||
      packet.rpcName === "ApplyEffectDisplays_O");
  if (tryDisplays) {
    const batch = decodePetEffectDisplays(packet.payload);
    if (batch) {
      pushPetStatusProbe({
        at: nowMs,
        actorId,
        kind: "effectDisplays",
        withLevel: batch.withLevel,
        applies: batch.applies.map((a) => a.statusId),
        removes: batch.removes,
        rpc: packet.rpcName || null,
        rpcHash: packet.rpcHash,
        behaviourIndex: packet.networkBehaviourIndex,
        behaviour: packet.networkBehaviourType || null,
      });
      for (const display of batch.applies) {
        rememberPetStatus(
          actorId,
          display.statusId,
          {
            level: display.level,
            stacks: display.stacks,
            remainingSeconds: display.remainingSeconds,
          },
          nowMs,
        );
      }
      for (const statusId of batch.removes) {
        rememberPetStatus(actorId, statusId, { removed: true }, nowMs);
      }
      return;
    }
  }

  const isSkillApply = packet.rpcName === "ApplySkillDisplay_O";
  const isSkillRemove = packet.rpcName === "RemoveSkillDisplay_O";
  const trySkill =
    (isSkillApply ||
      isSkillRemove ||
      (packetLooksLikeSkillDisplay(packet) && isKnownPet)) &&
    packet.packetName !== "serverRpc";
  if (!trySkill) return;
  if (
    !isSkillApply &&
    !isSkillRemove &&
    packet.networkBehaviourType &&
    packet.networkBehaviourType !== "StatusComponent"
  ) {
    return;
  }
  if (isSkillRemove) {
    const statusId =
      (packet.decodedFields || []).find((f) => String(f?.name || "") === "id")?.value ||
      decodePetSkillDisplay(packet.payload)?.statusId;
    if (statusId) {
      rememberPetStatus(actorId, statusId, { removed: true }, nowMs);
      pushPetStatusProbe({ at: nowMs, actorId, kind: "skillRemove", statusId });
    }
    return;
  }
  const decoded = (() => {
    const id = (packet.decodedFields || []).find((f) => String(f?.name || "") === "id")?.value;
    const lv = (packet.decodedFields || []).find((f) => String(f?.name || "") === "lv")?.value;
    if (typeof id === "string" && id.trim()) {
      return { statusId: id.trim(), level: typeof lv === "number" ? lv : 1 };
    }
    return decodePetSkillDisplay(packet.payload);
  })();
  if (!decoded?.statusId) return;
  rememberPetStatus(
    actorId,
    decoded.statusId,
    { level: decoded.level || 1, stacks: 1 },
    nowMs,
  );
  pushPetStatusProbe({
    at: nowMs,
    actorId,
    kind: "skillDisplay",
    statusId: decoded.statusId,
    level: decoded.level,
    rpc: packet.rpcName || null,
    rpcHash: packet.rpcHash,
    behaviourIndex: packet.networkBehaviourIndex,
  });
}

function dumpPetDebug(nowMs = Date.now()) {
  if (!DEBUG_DUMPS) return;
  if (nowMs - lastPetDebugAt < 2000) return;
  if (!petStateByActorId.size) return;
  lastPetDebugAt = nowMs;
  try {
    const dir = APP_DATA_DIR;
    const pets = serializePets(nowMs);
    const payload = {
      at: new Date(nowMs).toISOString(),
      personalName: effectivePersonalName() || null,
      personalActorId: (() => {
        try {
          return meter.getPersonalActorId?.() ?? null;
        } catch {
          return null;
        }
      })(),
      summonCount: summonOwnerByActorId.size,
      skillSticky: [...skillIdBySummonActorId.entries()],
      unitSticky: [...unitIdBySummonActorId.entries()],
      pendingHealth: [...pendingPetHealth.entries()].map(([id, row]) => ({ actorId: id, ...row })),
      pets,
      raw: [...petStateByActorId.values()],
      statusBackup: [...petStatusBackup.entries()].map(([id, map]) => ({
        actorId: id,
        statuses: [...map.entries()].map(([statusId, row]) => ({ statusId, ...row })),
      })),
      statusProbe: petStatusProbe.slice(-20),
    };
    writeFileSync(join(dir, "pet-debug.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

function hasSummonIdentityEvidence(packet) {
  if (!packet) return false;
  if (readSummonerSyncValue(packet) != null) return true;
  if (readSummonSkillId(packet) != null) return true;
  return (
    packet.networkBehaviourType === "SummoningComponent" ||
    (packet.spawnSyncEntries || []).some(
      (entry) => entry?.networkBehaviourType === "SummoningComponent",
    )
  );
}

function notePetDeathFromPacket(packet) {
  if (packet?.rpcName !== "Death_C" || packet.objectId == null) return;
  const actorId = Number(packet.objectId);
  if (!summonOwnerByActorId.has(actorId) && !petStateByActorId.has(actorId)) return;
  ensurePetState(actorId, { hp: 0, dead: true });
}

function isMyPetOwner(ownerActorId) {
  if (ownerActorId == null) return false;
  const id = Number(ownerActorId);
  try {
    const personalId = meter.getPersonalActorId?.();
    if (personalId != null && Number(personalId) === id) return true;
  } catch {
    /* ignore */
  }
  const me = effectivePersonalName();
  if (me) {
    const owner = directory.get(id) || directory.getAttribution(id);
    if (owner?.displayName && String(owner.displayName).toLowerCase() === me.toLowerCase()) {
      return true;
    }
  }
  // Solo before LoadCharacter: if every active pet shares one owner, treat it as you.
  const owners = new Set();
  for (const row of petStateByActorId.values()) {
    if (row?.ownerActorId != null) owners.add(Number(row.ownerActorId));
  }
  if (owners.size === 1 && owners.has(id)) return true;
  return false;
}

function isSummonSkillId(skillId) {
  if (!skillId || typeof skillId !== "string") return false;
  const id = skillId.trim();
  if (!id) return false;
  // Real summons are Summon* skills (plus Reanimation bosses); reject mounts/helpers without a skill label.
  return /Summon/i.test(id) || isReanimationSkill(id);
}

function isReanimationSkill(skillId) {
  return /^Reanimat/i.test(String(skillId || "").trim());
}

function serializePets(nowMs = Date.now()) {
  const rows = [];
  for (const row of petStateByActorId.values()) {
    if (!row || row.dead) continue;
    // Backfill owner from SummonerSync map if skill arrived on a different packet.
    if (row.ownerActorId == null) {
      const owner = resolveOwnerForSummon(row.actorId);
      if (owner != null) row.ownerActorId = owner;
    }
    if (row.ownerActorId == null) continue;
    if (!isMyPetOwner(row.ownerActorId)) continue;
    // Hide ghost objects that got SummonerSync but never a summon skill (Pet 47015).
    if (!isSummonSkillId(row.skillId)) continue;
    // Drop SummoningComponent junk (classic 1/13) until real HealthComponent sync arrives.
    if (row.maxHp != null && row.maxHp > 0 && row.maxHp < 20) {
      row.hp = null;
      row.maxHp = null;
      row.barrier = null;
    }
    const skill =
      (row.skillId && resolveFishNetSkill(row.skillId)) ||
      (row.skillId ? { id: row.skillId, displayName: row.skillId } : null);
    assignSkeletonNickname(row);
    const baseName =
      skill?.displayName ||
      (row.skillId ? humanizeSkillLabel(row.skillId) : `Pet ${row.actorId}`);
    // Reanimation binds a boss — show that boss (Ice Titan), not the skill name.
    const unitId = isReanimationSkill(row.skillId) ? unitIdBySummonActorId.get(row.actorId) : null;
    // Plain skeletons get a cycling funny name; icon still uses the skill.
    const name = unitId
      ? resolvedMobName(unitId, unitId)
      : isPlainSkeletonSkill(row.skillId) && row.nickname
        ? row.nickname
        : baseName;
    const icons = unitId
      ? [...monsterIconUrls(unitId, unitId), ...skillIconUrls(row.skillId, baseName)]
      : skillIconUrls(row.skillId, baseName);
    const maxHp = Number(row.maxHp);
    const hp = Number(row.hp);
    let statusesForPet = [];
    try {
      statusesForPet = statuses.getActiveStatuses(row.actorId, nowMs) || [];
    } catch {
      statusesForPet = [];
    }
    // Also merge any backup pet status map (survives identity clears).
    const backup = petStatusBackup.get(row.actorId);
    if (backup?.size) {
      for (const [statusId, tracked] of backup) {
        if (tracked.expiresAtMs != null && tracked.expiresAtMs <= nowMs) continue;
        if (statusesForPet.some((s) => String(s.statusId) === String(statusId))) continue;
        statusesForPet.push({
          statusId,
          displayName: tracked.displayName || statusId,
          isDebuff: Boolean(tracked.isDebuff),
          level: tracked.level || 1,
          stacks: tracked.stacks || 1,
          remainingMs: tracked.expiresAtMs != null ? Math.max(0, tracked.expiresAtMs - nowMs) : null,
          spriteId: tracked.spriteId,
        });
      }
    }
    const effects = statusesForPet
      .map(serializeStatusRow)
      .filter(Boolean)
      .sort((a, b) => Number(b.debuff) - Number(a.debuff) || String(a.name).localeCompare(String(b.name)));
    rows.push({
      id: String(row.actorId),
      actorId: row.actorId,
      ownerActorId: row.ownerActorId,
      skillId: row.skillId || null,
      name,
      hp: Number.isFinite(hp) ? hp : null,
      maxHp: Number.isFinite(maxHp) ? maxHp : null,
      barrier: Number.isFinite(Number(row.barrier)) ? Number(row.barrier) : 0,
      pct:
        Number.isFinite(hp) && Number.isFinite(maxHp) && maxHp > 0
          ? Math.max(0, Math.min(100, Math.round((hp / maxHp) * 1000) / 10))
          : null,
      iconUrl: icons[0] || null,
      iconUrls: icons,
      statuses: effects,
      updatedAt: row.updatedAt,
    });
  }
  rows.sort((a, b) => {
    const ap = a.pct == null ? 999 : a.pct;
    const bp = b.pct == null ? 999 : b.pct;
    if (ap !== bp) return ap - bp;
    return String(a.name).localeCompare(String(b.name));
  });
  return rows;
}

function humanizeSkillLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function syncPetsFromCombatSummonTracker() {
  const state = tracker?.summons?.summonSkillSyncState;
  if (!state || typeof state.entries !== "function") return;
  for (const [objectId, row] of state.entries()) {
    const actorId = Number(objectId);
    if (!Number.isInteger(actorId) || actorId < 0) continue;
    const skillId = typeof row?.skillId === "string" ? row.skillId.trim() : null;
    const ownerActorId =
      typeof row?.ownerActorId === "number" && Number.isInteger(row.ownerActorId)
        ? row.ownerActorId
        : null;
    if (!skillId && ownerActorId == null) continue;
    upsertSummonPet(actorId, { ownerActorId, skillId });
  }
}

/**
 * Credit summon/clone hits to the summoner (owner actor), not the pet object.
 * Without this, pet damage sits on a nameless bar until identity finally mirrors your character.
 */
function creditActorIdForCombat(actorId, event = {}) {
  if (actorId == null) return actorId;
  const id = Number(actorId);
  if (!Number.isInteger(id)) return actorId;

  const mapped = summonOwnerByActorId.get(id);
  if (mapped != null && mapped !== id) return mapped;

  if (event.isSummon || event.isClone) {
    const attr = directory.getAttribution(id);
    if (attr?.actorId != null && Number(attr.actorId) !== id) return Number(attr.actorId);
    // Solo fallback only — never steal another Summoner's pets in a party.
    const otherPlayers = [...knownPlayers].filter((pid) => Number(pid) !== id);
    if (otherPlayers.length <= 1) {
      try {
        const personalId = meter.getPersonalActorId?.();
        if (personalId != null && Number(personalId) !== id) return Number(personalId);
      } catch {
        /* ignore */
      }
      if (personalName) {
        const match = directory.snapshot().find(
          (row) =>
            row?.actorId != null &&
            String(row.displayName || "").toLowerCase() === String(personalName).toLowerCase(),
        );
        if (match?.actorId != null && Number(match.actorId) !== id) return Number(match.actorId);
      }
    }
  }
  return id;
}

function attributeCombatEventToOwner(event) {
  if (!event || event.actorId == null) return event;
  if (
    event.kind !== "damage" &&
    event.kind !== "death" &&
    event.kind !== "activation" &&
    event.kind !== "heal"
  ) {
    return event;
  }
  const ownerId = creditActorIdForCombat(event.actorId, event);
  if (ownerId === event.actorId) return event;
  const ownerIdentity =
    directory.getAttribution(ownerId) || directory.get(ownerId) || event.actorIdentity || null;
  return {
    ...event,
    actorId: ownerId,
    ...(ownerIdentity ? { actorIdentity: ownerIdentity } : {}),
  };
}
const statuses = new FishNetStatusTracker();
const rewards = new FishNetMobRewardTracker();
const farmSession = new MobRewardSession();
{
  const consumeFarm = farmSession.consume.bind(farmSession);
  farmSession.consume = (...args) => (isSessionPaused() ? undefined : consumeFarm(...args));
}
const groundLoot = new FishNetLootDropTracker();
const tower = new FishNetEternalTowerTracker();

function isMonsterActor(actorId, event = {}) {
  if (actorId == null) return false;
  if (knownPlayers.has(actorId) || isPlayerSide(actorId, event)) return false;
  const identity = identityForActor(actorId, event) || directory.get(actorId);
  if (identity?.uid || identity?.ownerConnectionId != null || identity?.archetype != null) {
    return false;
  }
  if (knownMonsters.has(actorId)) return true;
  return Boolean(identity?.mobId);
}

function deathVictimId(event) {
  const targetId = event.targetId;
  const actorId = event.actorId;
  if (isMonsterActor(targetId, event)) return targetId;
  if (isMonsterActor(actorId, event)) return actorId;
  return null;
}

function deathKillerId(event, victimId) {
  const actorId = event.actorId;
  const targetId = event.targetId;
  if (actorId != null && actorId !== victimId && (knownPlayers.has(actorId) || isPlayerSide(actorId, event))) {
    return actorId;
  }
  if (targetId != null && targetId !== victimId && (knownPlayers.has(targetId) || isPlayerSide(targetId, event))) {
    return targetId;
  }
  return actorId !== victimId ? actorId : null;
}

function partyNamed(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n || n.startsWith("actor ")) return false;
  if (personalName && n === String(personalName).toLowerCase()) return true;
  for (const row of killerKills.values()) {
    if (String(row.name || "").toLowerCase() === n) return true;
  }
  return false;
}

function noteCombatKill(event, nowMs = Date.now()) {
  if (event.kind !== "death" || event.team !== 0) return;
  const victimId = deathVictimId(event);
  if (victimId == null) return;
  if (knownPlayers.has(victimId) || isPlayerSide(victimId, event)) return;
  const killerId = deathKillerId(event, victimId);
  if (killerId == null || killerId === victimId) return;
  const victim = directory.get(victimId);
  let mobName = actorDisplayName(victimId, event);
  if (monsterNames.has(victimId)) mobName = monsterNames.get(victimId);
  const resolved = resolveMobRecord(victim?.mobId, mobName);
  if (resolved?.displayName) mobName = resolved.displayName;
  if (!mobName || String(mobName).startsWith("Actor ")) return;
  if (partyNamed(mobName)) return;
  const mobId = String(resolved?.id || victim?.mobId || mobName);
  lastKillAtMs = nowMs;
  const killerName = actorDisplayName(killerId, event);
  const killerKey = String(killerId);
  let row = killerKills.get(killerKey);
  if (!row) {
    const identity = directory.get(killerId);
    row = {
      id: killerKey,
      name: killerName,
      className: archetypeClassName(identity?.archetype) || null,
      kills: 0,
      mobs: new Map(),
    };
    killerKills.set(killerKey, row);
  }
  row.name = killerName;
  const identity = directory.get(killerId);
  row.className = archetypeClassName(identity?.archetype) || row.className || null;
  row.kills += 1;
  const mob = row.mobs.get(mobId) || { id: mobId, name: mobName, kills: 0, xp: 0 };
  mob.kills += 1;
  mob.name = mobName;
  row.mobs.set(mobId, mob);
}

/**
 * Reject implausible level regressions (mob/skill Level=2 overwriting Base 139).
 * Allow cold-start and small corrections; never drop more than 2 levels from a known value.
 */
function adoptTrackedLevel(incoming, prior, maxLevel) {
  const next = Number(incoming);
  const prev = Number(prior);
  if (!Number.isFinite(next) || next < 1 || next > maxLevel) {
    return Number.isFinite(prev) && prev >= 1 ? prev : null;
  }
  if (!Number.isFinite(prev) || prev < 1) return next;
  if (next + 2 < prev) return prev;
  return next;
}

function applyPlayerEconomy(state, nowMs) {
  if (!state) return;
  // Exp! absolute bar + session gains (span-based, matches official progressGain).
  expTracker.observe(state, nowMs);
  const expSnap = expTracker.snapshot;
  const prior =
    Number(lastKnownWallet) >= 100
      ? Number(lastKnownWallet)
      : Number(playerEconomy?.coins) >= 100
        ? Number(playerEconomy.coins)
        : null;
  let coins = prior;
  if (state.coins != null) {
    const incoming = typeof state.coins === "bigint" ? Number(state.coins) : Number(state.coins);
    if (Number.isFinite(incoming) && incoming >= 100) {
      coins = incoming;
    } else if (
      Number.isFinite(incoming) &&
      incoming >= 0 &&
      prior == null &&
      Number(expSnap.level) >= 1 &&
      Number(expSnap.level) < 20
    ) {
      coins = incoming;
    }
  }
  playerEconomy = {
    experience: expSnap.experience,
    level: expSnap.level,
    jobExperience: expSnap.jobExperience,
    jobLevel: expSnap.jobLevel,
    coins: coins == null ? null : Number(coins),
    updatedAt: nowMs,
    experienceKnown: Boolean(expSnap.known),
  };
  if (Number(playerEconomy.coins) >= 100) {
    walletTrusted = true;
    lastKnownWallet = Number(playerEconomy.coins);
    observeWallet(lastKnownWallet);
    adoptGoldBaseline(playerEconomy.coins, nowMs);
  }
}

/** ExpCoins → wallet + level/XP for Gold! and Exp! */
function trySeedAbsoluteWallet(packet, nowMs) {
  try {
    if (!isExpCoinsPacket(packet)) return false;
    const decoded = decodeExpCoinsLenient(packet);
    if (!decoded?.state) return false;
    return noteEconomyDelta(decoded.state, packet.tick || 0, nowMs);
  } catch {
    return false;
  }
}

function walletGoldGained() {
  if (walletPrev == null) return null;
  return goldEarnedSinceReset;
}

function goldPerHourSinceReset(sessionGoldAmount, nowMs) {
  const started = goldRateStartedAt || captureStartedAt || nowMs;
  const hours = Math.max(1 / 3600, (nowMs - started) / 3_600_000);
  return Math.round((Number(sessionGoldAmount) || 0) / hours);
}

function economyProgressGain(previous, next, keyLevel, keyXp) {
  // Legacy — gold path only uses lastEconomy coin deltas now.
  if (!previous || !next) return 0;
  const prevLevel = Number(previous[keyLevel]) || 0;
  const nextLevel = Number(next[keyLevel]) || 0;
  const prevXp = Number(previous[keyXp]) || 0;
  const nextXp = Number(next[keyXp]) || 0;
  if (prevLevel < 1 || nextLevel < 1) return 0;
  if (nextLevel < prevLevel) return 0;
  if (nextLevel === prevLevel) return Math.max(0, nextXp - prevXp);
  return 0;
}

function noteEconomyDelta(state, tick, nowMs) {
  if (!state || !economyPacketTrusted) return false;
  applyPlayerEconomy(state, nowMs);
  const next = {
    experience: Number(playerEconomy?.experience) || 0,
    level: Number(playerEconomy?.level) || 0,
    jobExperience: Number(playerEconomy?.jobExperience) || 0,
    jobLevel: Number(playerEconomy?.jobLevel) || 0,
    coins:
      Number(lastKnownWallet) >= 100
        ? Number(lastKnownWallet)
        : Number(playerEconomy?.coins) || 0,
  };
  if (lastEconomy && Number(lastEconomy.coins) >= 100 && next.coins >= 100) {
    const coins = Math.max(0, next.coins - (Number(lastEconomy.coins) || 0));
    // Only coin deltas go into farmSession — XP is owned by expTracker.
    if (coins > 0) {
      farmSession.consume(
        {
          kind: "unmatched",
          reward: "experience",
          tick: tick || 0,
          reason: "unidentified",
          experience: 0,
          jobExperience: 0,
          coins: BigInt(Math.round(coins) || 0),
          drops: [],
        },
        { recordedAt: new Date(nowMs).toISOString() },
      );
    }
  }
  if (Number(next.level) >= 1) lastEconomy = next;
  return true;
}

const ingestedPickupKeys = new Set();
const ingestedPickupRecent = new Map();
const chatFoundNames = new Map(); // norm(name) -> { at, rate }
const loggedGroundLoot = new Set();
const recentLootDespawns = [];
let lastKillAtMs = 0;
let lastPickupAnimAt = 0;
let lastPersonalPickupAt = 0;
let lootFlushUntil = 0;
let groundLootSeen = 0;

function normLootName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function categoryForFoundItem(itemName) {
  for (const [category, type] of Object.entries(CATEGORY_ITEM_TYPE)) {
    if (category === "cosmetic" || category === "currency") continue;
    try {
      if (resolveFishNetItem(type, itemName)) return category;
    } catch {
      /* next */
    }
  }
  if (/\bcard$/i.test(itemName)) return "card";
  if (/\b(box|potion|scroll|ticket|voucher)\b/i.test(itemName)) return "consumable";
  if (/\b(crystal|ore|ash|dust|shard|whisk|bark|fur|bone)\b/i.test(itemName)) return "material";
  return "equipment";
}

function rememberRecentLoot(sig, nowMs) {
  ingestedPickupRecent.set(sig, nowMs);
  if (ingestedPickupRecent.size > 240) ingestedPickupRecent.clear();
}

function recentlyIngested(sig, nowMs, windowMs = 3000) {
  const prevAt = ingestedPickupRecent.get(sig);
  return prevAt != null && nowMs - prevAt < windowMs;
}

function ingestFarmPickups(items, tick, nowMs) {
  if (isSessionPaused()) return;
  const drops = (items || []).filter((item) => {
    if (
      !item?.category ||
      item.category === "currency" ||
      item.category === "cosmetic" ||
      isWardrobeItemId(item.itemId, item.displayName || item.name, item.category) ||
      !isRealLootItem(item.itemId, item.category, item.displayName || item.name)
    ) {
      return false;
    }
    return true;
  });
  if (!drops.length) return false;
  const sig = drops.map((row) => `${row.category}:${row.itemId}:${row.count}`).join(",");
  const key = `${tick}|${sig}`;
  if (ingestedPickupKeys.has(key)) return true;
  if (recentlyIngested(sig, nowMs, 2500)) {
    ingestedPickupKeys.add(key);
    return true;
  }
  // Skip individual gear rows already logged from party-chat "found" notices.
  const filtered = drops.filter((row) => {
    if (row.category !== "equipment" && row.category !== "artifact" && row.category !== "card") {
      return true;
    }
    const nameKey = `found:${normLootName(row.displayName || row.name || row.itemId)}`;
    return !recentlyIngested(nameKey, nowMs, 4000);
  });
  if (!filtered.length) {
    ingestedPickupKeys.add(key);
    rememberRecentLoot(sig, nowMs);
    return true;
  }
  ingestedPickupKeys.add(key);
  rememberRecentLoot(sig, nowMs);
  for (const row of filtered) {
    const nameKey = `found:${normLootName(row.displayName || row.name || row.itemId)}`;
    rememberRecentLoot(nameKey, nowMs);
  }
  if (ingestedPickupKeys.size > 240) ingestedPickupKeys.clear();
  farmSession.consume(
    {
      kind: "unmatched",
      reward: "pickup",
      tick: tick || 0,
      reason: "unidentified",
      drops: filtered.map((item) => ({
        category: item.category,
        itemId: item.itemId,
        count: item.count,
        displayName: item.displayName || item.name || item.itemId,
        uid: item.uid || null,
        refine: item.refine ?? null,
        potential: item.potential ?? item.startingPotential ?? null,
        cards: item.cards || [],
        substats: item.substats || [],
      })),
    },
    { recordedAt: new Date(nowMs).toISOString() },
  );
  for (const item of filtered) {
    sessionBagWeight += itemWeight(item.category, item.itemId) * (Number(item.count) || 0);
  }
  return true;
}

function ingestChatLootNotices(packet, nowMs) {
  const notices = decodeChatLootNotices(packet);
  if (!notices.length) return false;
  let did = false;
  for (const notice of notices) {
    const player = String(notice.player || "").trim();
    const itemName = String(notice.itemName || "").trim();
    if (!player || !itemName) continue;
    if (personalName && player.toLowerCase() !== String(personalName).toLowerCase()) continue;
    if (!personalName && localUid) {
      // Identity not ready — still accept; party mates' finds use different names once we know ours.
    }
    const nameKey = `found:${normLootName(itemName)}`;
    if (recentlyIngested(nameKey, nowMs, 4000)) continue;
    const category = categoryForFoundItem(itemName);
    if (!isRealLootItem(itemName, category, itemName)) continue;
    chatFoundNames.set(normLootName(itemName), { at: nowMs, rate: notice.dropRate });
    if (chatFoundNames.size > 240) chatFoundNames.clear();
    rememberRecentLoot(nameKey, nowMs);
    farmSession.consume(
      {
        kind: "unmatched",
        reward: "pickup",
        tick: packet.tick || 0,
        reason: "unidentified",
        drops: [
          {
            category,
            itemId: itemName,
            count: 1,
            displayName: itemName,
          },
        ],
      },
      { recordedAt: new Date(nowMs).toISOString() },
    );
    sessionBagWeight += itemWeight(category, itemName);
    did = true;
  }
  return did;
}

function inLootWindow(nowMs) {
  if (lastKillAtMs && nowMs - lastKillAtMs < 180_000) return true;
  return false;
}

function categoryFromLootType(lootType) {
  const category = LOOT_TYPE_CATEGORY[Number(lootType)];
  return category || "material";
}

function dropFromDecodedFields(fields, base = {}) {
  const drop = { ...base };
  for (const field of fields || []) {
    const key = fieldTail(field?.name);
    if (key === "DisplayName" && typeof field.value === "string") drop.displayName = field.value;
    if (key === "SpriteId" && typeof field.value === "string") drop.spriteId = field.value;
    if (key === "LootType" && typeof field.value === "number") drop.lootType = field.value;
    if (key === "LootChance" && (typeof field.value === "number" || typeof field.value === "string")) {
      drop.lootChance = Number(field.value);
    }
    if (key === "Rarity" && typeof field.value === "number") drop.rarity = field.value;
    if (key === "PlayerId" && field.value != null && field.value !== "") {
      drop.playerId = String(field.value);
    }
    if (key === "PartyId" && field.value != null) drop.partyId = field.value;
    if (key === "ExpireAt" && field.value != null) drop.expireAt = String(field.value);
  }
  return drop;
}

function isMyLockedDrop(drop) {
  const playerId = String(drop?.playerId || "").trim();
  if (!playerId) return false;
  if (localUid && playerId === localUid) return true;
  if (localAccountId && playerId === localAccountId) return true;
  try {
    const mine = String(personalName || "").toLowerCase();
    for (const row of directory.snapshot?.() || []) {
      if (!mine || String(row.displayName || "").toLowerCase() !== mine) continue;
      if (row.accountId && String(row.accountId) === playerId) {
        localAccountId = String(row.accountId);
        return true;
      }
      if (row.uid && String(row.uid) === playerId) {
        localUid = String(row.uid);
        return true;
      }
    }
  } catch {
    /* directory may not expose snapshot in all builds */
  }
  // Live loot sync uses Steam-style PlayerId. Latch the first one once we know who we are.
  if (personalName && !localAccountId && !localUid && /^\d{15,20}$/.test(playerId)) {
    localAccountId = playerId;
    return true;
  }
  return false;
}

function ingestGroundLoot(drop, kind, tick, nowMs) {
  if (!drop?.displayName) return false;
  groundLootSeen += 1;
  // Live probes: PickupItems_T / party-chat "found" plaintext rarely appear on UDP.
  // Rare finds show up as ground syncType (DisplayName + LootType + LootChance) —
  // often with null PlayerId even when chat says you found them.
  if (kind !== "spawn" && kind !== "update") return false;

  const category = categoryFromLootType(drop.lootType);
  if (!category || category === "cosmetic" || category === "currency") return false;
  const itemId = drop.displayName || drop.spriteId;
  if (!itemId) return false;
  if (isWardrobeItemId(itemId, drop.displayName, category)) return false;
  if (!isRealLootItem(itemId, category, drop.displayName)) return false;

  const chance = Number(drop.lootChance);
  const rare =
    Number.isFinite(chance) &&
    chance > 0 &&
    chance <= 1 &&
    (category === "equipment" ||
      category === "artifact" ||
      category === "card" ||
      category === "gem");
  const mine = isMyLockedDrop(drop);
  // Common junk (Ash/Candy at 100%): only when locked to your PlayerId.
  // Rares (≤1%): accept even with null PlayerId — that matches observed chat finds.
  if (!mine && !rare) return false;

  const dedupeKey =
    drop.expireAt ||
    (drop.objectId != null ? `obj:${drop.objectId}` : null) ||
    `g:${normLootName(drop.displayName)}:${drop.playerId || "party"}:${tick}`;
  if (loggedGroundLoot.has(dedupeKey)) return false;
  loggedGroundLoot.add(dedupeKey);
  if (loggedGroundLoot.size > 400) {
    const keep = [...loggedGroundLoot].slice(-200);
    loggedGroundLoot.clear();
    for (const key of keep) loggedGroundLoot.add(key);
  }

  const nameKey = `found:${normLootName(drop.displayName)}`;
  if (recentlyIngested(nameKey, nowMs, 1500)) return false;
  rememberRecentLoot(nameKey, nowMs);
  if (rare) {
    chatFoundNames.set(normLootName(drop.displayName), {
      at: nowMs,
      rate: Number.isFinite(chance) ? chance : null,
    });
  }

  farmSession.consume(
    {
      kind: "unmatched",
      reward: "pickup",
      tick: tick || 0,
      reason: "unidentified",
      drops: [
        {
          category,
          itemId,
          count: 1,
          displayName: drop.displayName,
        },
      ],
    },
    { recordedAt: new Date(nowMs).toISOString() },
  );
  sessionBagWeight += itemWeight(category, itemId);
  return true;
}

function resolveScannedPickupItems(buffer) {
  const items = [];
  for (const id of scanPayloadItemIds(buffer)) {
    if (isWardrobeItemId(id)) continue;
    let category = null;
    for (const [cat, type] of Object.entries(CATEGORY_ITEM_TYPE)) {
      if (cat === "cosmetic") continue;
      try {
        if (resolveFishNetItem(type, id)) {
          category = cat;
          break;
        }
      } catch {
        /* next type */
      }
    }
    if (category && isRealLootItem(id, category, id)) {
      items.push({ category, itemId: id, count: 1, displayName: id });
    }
  }
  return items;
}

function fieldTail(name) {
  return String(name || "").split(".").pop();
}

function consumeGroundLoot(packet, nowMs) {
  if (packet?.rpcName === "Pickup_C") {
    // Observers RPC — everyone nearby fires this. Do not treat it as "I looted".
    lastPickupAnimAt = nowMs;
  }
  let events = [];
  try {
    events = groundLoot.consume(packet) || [];
  } catch {
    events = [];
  }
  for (const event of events) {
    let drop = event.drop;
    if (!drop?.displayName && packet.spawnSyncEntries?.length) {
      drop = dropFromDecodedFields(
        packet.spawnSyncEntries.flatMap((entry) => entry.fields || []),
        drop || { objectId: packet.objectId, tick: packet.tick },
      );
    }
    if (!drop?.displayName && packet.decodedFields?.length) {
      drop = dropFromDecodedFields(packet.decodedFields, drop || { objectId: packet.objectId, tick: packet.tick });
    }
    if (event.kind === "spawn" || event.kind === "update" || event.kind === "removed") {
      ingestGroundLoot(drop, event.kind, event.tick || packet.tick || 0, nowMs);
    }
  }
  if (!events.length && packet?.packetName === "objectSpawn" && packet.spawnPrefabId === 0 && packet.spawnCollectionId === 0) {
    const drop = dropFromDecodedFields(
      (packet.spawnSyncEntries || []).flatMap((entry) => entry.fields || []),
      { objectId: packet.objectId, tick: packet.tick },
    );
    if (drop.displayName) ingestGroundLoot(drop, "spawn", packet.tick || 0, nowMs);
  }
  // Live wire: loot rows often arrive as syncType with DisplayName/LootType/PlayerId
  // and never as PickupItems_T.
  if (
    !events.length &&
    packet?.decodedFields?.length &&
    (packet.packetName === "syncType" || packet.packetName === "objectSpawn")
  ) {
    const drop = dropFromDecodedFields(packet.decodedFields, {
      objectId: packet.objectId,
      tick: packet.tick,
    });
    if (drop.displayName && drop.lootType != null) {
      ingestGroundLoot(drop, "spawn", packet.tick || 0, nowMs);
    }
  }
}

function injectLenientReward(packet, nowMs) {
  const decoded = decodeRewardLenient(packet) || null;
  if (!decoded) return false;
  if (decoded.kind === "experienceState" && decoded.state) {
    return noteEconomyDelta(decoded.state, packet.tick || 0, nowMs);
  }
  if (decoded.kind === "pickup" && decoded.items?.length) {
    return ingestFarmPickups(decoded.items, packet.tick || 0, nowMs);
  }
  return false;
}

function markPlayer(actorId) {
  if (actorId == null || actorId < 0) return;
  knownPlayers.add(actorId);
  knownMonsters.delete(actorId);
}

function markMonster(actorId, mobId, name, bossHint = false) {
  if (actorId == null) return;
  knownMonsters.add(actorId);
  knownPlayers.delete(actorId);
  if (name) monsterNames.set(actorId, name);
  let def = mobId ? mobDefs.get(String(mobId)) : undefined;
  if (!def && name) {
    for (const row of mobDefs.values()) {
      if (String(row.displayName || "").toLowerCase() === String(name).toLowerCase()) {
        def = row;
        break;
      }
    }
  }
  const ranked = monsterRankByObjectId.get(actorId);
  const isBoss =
    isEnemyTeam(actorId) &&
    Boolean(
      bossHint ||
        def?.boss ||
        String(mobId || "").startsWith("boss:") ||
        (ranked?.rank ?? 0) >= BOSS_RANK,
    );
  if (isBoss) bossActorIds.add(actorId);
  else bossActorIds.delete(actorId);
}

function isBossActor(actorId) {
  if (actorId == null) return false;
  return bossActorIds.has(actorId);
}

/** MonsterController.Data Team/Rank per object: Team 0 = player summons, 2 = pets, 1 = enemies. */
const monsterRankByObjectId = new Map();
const BOSS_RANK = 2;

function readMonsterData(packet) {
  if (packet.packetName === "objectSpawn") {
    const entry = (packet.spawnSyncEntries || []).find(
      (e) =>
        e.networkBehaviourType === "MonsterController" &&
        e.name === "Data" &&
        typeof e.fields?.find((f) => f.name === "Id")?.value === "string",
    );
    if (!entry) return null;
    const field = (name) => entry.fields.find((f) => f.name === name)?.value;
    return { rank: field("Rank"), team: field("Team") };
  }
  if (packet.packetName === "syncType" && packet.networkBehaviourType === "MonsterController") {
    const field = (name) => packet.decodedFields?.find((f) => f.name === name)?.value;
    const rank = field("Data.Rank") ?? field("Rank");
    const team = field("Data.Team") ?? field("Team");
    if (rank === undefined && team === undefined) return null;
    return { rank, team };
  }
  return null;
}

/** Tower floor bosses are ordinary mob ids promoted with Rank ≥ 2 — not in the boss catalog. */
function noteMonsterRankFromPacket(packet) {
  if (packet.packetName === "authenticated" || packet.packetName === "disconnect") {
    monsterRankByObjectId.clear();
    return;
  }
  if (packet.objectId == null) return;
  if (packet.packetName === "objectDespawn") {
    monsterRankByObjectId.delete(packet.objectId);
    return;
  }
  const data = readMonsterData(packet);
  if (!data) return;
  const prev = monsterRankByObjectId.get(packet.objectId) || {};
  const next = {
    rank: typeof data.rank === "number" ? data.rank : prev.rank,
    team: typeof data.team === "number" ? data.team : prev.team,
  };
  monsterRankByObjectId.set(packet.objectId, next);
  if (monsterRankByObjectId.size > 4000) {
    monsterRankByObjectId.delete(monsterRankByObjectId.keys().next().value);
  }
  if (next.team === 1 && next.rank >= BOSS_RANK) bossActorIds.add(packet.objectId);
  else if (next.team === 0 || next.team === 2) bossActorIds.delete(packet.objectId);
}

function isEnemyTeam(actorId) {
  const team = monsterRankByObjectId.get(actorId)?.team;
  return team === undefined || team === 1;
}

function noteBossDamage(rawEvent, event, nowMs) {
  if (event?.kind !== "damage" || event.team !== 0) return;
  const targetId = rawEvent.targetId;
  if (!isBossActor(targetId) || event.actorId == null) return;
  if (petStateByActorId.has(targetId) || summonOwnerByActorId.has(targetId)) return;
  const value = Math.abs(Number(event.value) || 0);
  if (!Number.isFinite(value) || value <= 0) return;
  let tally = bossDamageByActor.get(event.actorId);
  if (!tally) {
    tally = { damage: 0, hits: 0, crits: 0, skills: new Map() };
    bossDamageByActor.set(event.actorId, tally);
  }
  tally.damage += value;
  tally.hits += 1;
  if (event.hitResult === "critical") tally.crits += 1;
  const skillKey = String(event.sourceId || event.sourceLabel || "Ability");
  const skill = tally.skills.get(skillKey) || {
    sourceId: event.sourceId,
    sourceLabel: event.sourceLabel,
    damage: 0,
    hits: 0,
  };
  skill.damage += value;
  skill.hits += 1;
  tally.skills.set(skillKey, skill);
  if (bossFightStartedAt == null) bossFightStartedAt = nowMs;
  bossFightLastHitAt = nowMs;
  const bossName = monsterNames.get(targetId);
  if (bossName) bossTargetNames.add(bossName);
}

function clearBossDamage() {
  bossDamageByActor.clear();
  bossTargetNames.clear();
  bossFightStartedAt = null;
  bossFightLastHitAt = null;
}

/** Attach boss-only damage to the composed meter rows (same owner-merge keys). */
function applyBossDamage(actors, nowMs) {
  const byKey = new Map();
  for (const [actorId, tally] of bossDamageByActor) {
    const key = meterMergeKey({ id: actorId });
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { ...tally, skills: new Map(tally.skills) });
      continue;
    }
    cur.damage += tally.damage;
    cur.hits += tally.hits;
    cur.crits += tally.crits;
    for (const [id, skill] of tally.skills) {
      const prev = cur.skills.get(id);
      if (prev) {
        prev.damage += skill.damage;
        prev.hits += skill.hits;
      } else cur.skills.set(id, { ...skill });
    }
  }
  // Boss clock stops 3s after the last boss hit so walking away doesn't bleed DPS.
  const endAt = bossFightLastHitAt != null ? Math.min(nowMs, bossFightLastHitAt + 3000) : nowMs;
  const elapsedSec =
    bossFightStartedAt != null ? Math.max(1, (endAt - bossFightStartedAt) / 1000) : 0;
  let total = 0;
  for (const row of actors) {
    const tally = byKey.get(meterMergeKey(row));
    const damage = tally?.damage || 0;
    row.bossDamage = damage;
    row.bossDps = elapsedSec > 0 ? damage / elapsedSec : 0;
    row.bossSkills = tally
      ? mapSkills([...tally.skills.values()].sort((a, b) => b.damage - a.damage))
      : [];
    total += damage;
  }
  return {
    totalDamage: total,
    totalDps: elapsedSec > 0 ? total / elapsedSec : 0,
    elapsedSec,
    targets: [...bossTargetNames].slice(0, 4),
    tracked: [...bossActorIds].slice(0, 6).map((id) => monsterNames.get(id) || `#${id}`),
    active: bossFightLastHitAt != null && nowMs - bossFightLastHitAt <= 10_000,
  };
}

function isPlayerSide(actorId, event = {}) {
  if (actorId == null) return false;
  if (knownPlayers.has(actorId)) return true;
  if (knownMonsters.has(actorId)) return false;
  const identity =
    event.actorIdentity ||
    directory.getAttribution(actorId) ||
    directory.get(actorId);
  if (identity?.uid || identity?.ownerConnectionId != null) return true;
  // Player skill catalog hit + not a known mob ⇒ treat as party (fixes Piercing Flurry as "boss")
  const sourceId = event.sourceId;
  if (sourceId && resolveFishNetSkill(sourceId) && !knownMonsters.has(actorId)) return true;
  return false;
}

/** Lifesteal / siphon / passive regen — not cast Healing Done. */
function identityForActor(actorId, event = {}) {
  const claimed = event.actorIdentity;
  if (
    claimed &&
    (event.actorId === actorId ||
      claimed.actorId === actorId ||
      claimed.rowId === actorId ||
      claimed.id === actorId)
  ) {
    return claimed;
  }
  return directory.getAttribution(actorId) || directory.get(actorId);
}

function actorDisplayName(actorId, event = {}) {
  const identity = identityForActor(actorId, event);
  if (identity?.displayName && !isPlaceholderName(identity.displayName)) return identity.displayName;
  const attributed = directory.getAttribution(actorId) || directory.get(Number(actorId));
  if (attributed?.displayName && !isPlaceholderName(attributed.displayName)) return attributed.displayName;
  if (monsterNames.has(actorId)) return monsterNames.get(actorId);
  const mobId = identity?.mobId || attributed?.mobId;
  if (mobId != null) {
    const def = mobDefs.get(String(mobId));
    if (def?.displayName) return def.displayName;
  }
  const remembered = actorNames.get(actorId) || actorNames.get(String(actorId));
  if (remembered && !isPlaceholderName(remembered)) return remembered;
  return `Actor ${actorId}`;
}

function polishActorRow(row) {
  if (!row) return row;
  let numericId = Number(String(row.id || "").replace(/^actor:/i, ""));
  if (!Number.isFinite(numericId)) {
    const fromActors = Array.isArray(row.actorIds) ? Number(row.actorIds[0]) : NaN;
    numericId = Number.isFinite(fromActors) ? fromActors : actorIdFromLabel(row.name);
  }
  const identity = Number.isFinite(numericId)
    ? directory.getAttribution(numericId) || directory.get(numericId)
    : null;
  const resolved = Number.isFinite(numericId)
    ? actorDisplayName(numericId, { actorId: numericId })
    : row.name;
  let name = betterName(row.name, resolved);
  if (isPlaceholderName(name) && Number.isFinite(numericId)) {
    const remembered = actorNames.get(numericId) || actorNames.get(String(numericId));
    if (remembered && !isPlaceholderName(remembered)) name = remembered;
  }
  // Instant label for your own bar — don't wait on Appearance sync.
  const selfName = effectivePersonalName();
  const personalId = (() => {
    try {
      return meter.getPersonalActorId?.();
    } catch {
      return null;
    }
  })();
  if (selfName && (isPlaceholderName(name) || name === "Resolving...")) {
    if (personalId != null && Number.isFinite(numericId) && Number(personalId) === numericId) {
      name = selfName;
    }
  }
  if (isPlaceholderName(name)) name = "Resolving...";

  const priorClass =
    (typeof row.className === "string" &&
    row.className.trim() &&
    !/^(player|unknown)$/i.test(row.className)
      ? row.className.trim()
      : null) ||
    archetypeClassName(row.archetype) ||
    archetypeClassName(identity?.archetype) ||
    null;
  let className = priorClass;
  if (!className && name && name !== "Resolving…" && !isPlaceholderName(name)) {
    className = classByName.get(String(name).toLowerCase()) || null;
  }
  if (!className) {
    className = inferClassFromSkills([
      ...(row.skills || []),
      ...(row.healingSkills || []),
      ...(row.takenSkills || []),
    ]);
  }
  if (className) rememberClass(name, className);
  if (Number.isFinite(numericId) && name && !isPlaceholderName(name) && name !== "Resolving…") {
    rememberActorName(numericId, name);
  }

  return {
    ...row,
    id: Number.isFinite(numericId) ? numericId : row.id,
    name,
    className,
    classIconUrl: row.classIconUrl || classIconUrl(className),
    classIconUrls: className ? classIconUrls(className) : row.classIconUrls || [],
    color: name === "Resolving…" ? row.color || "#8b919a" : colorFor(name),
  };
}

function rememberActorName(actorId, name) {
  if (actorId == null || isPlaceholderName(name)) return;
  actorNames.set(actorId, name);
  actorNames.set(String(actorId), name);
  const killer = killerKills.get(String(actorId));
  if (killer) killer.name = name;
}

function noteDeath(event, nowMs) {
  const victimId = event.targetId ?? event.actorId;
  const victim = directory.get(victimId) || directory.get(event.actorId);
  deaths.unshift({
    at: nowMs,
    actorId: victimId,
    actorName: actorDisplayName(victimId, event),
    source: event.sourceLabel || "Unknown",
    skillName: event.sourceLabel || "Fatal",
    amount: Number(event.value || 0),
  });
  if (deaths.length > 40) deaths.length = 40;
}

function noteActivation(event, nowMs) {
  stats.activations += 1;
  const actorId = event.actorId;
  const name = actorDisplayName(actorId, event);
  const player = isPlayerSide(actorId, event);
  const label = event.sourceLabel || event.sourceId || "Cast";

  if (player) markPlayer(actorId);

  if (event.phase === "begin" || event.phase === "inferred") {
    if (!player) {
      castMap.set(actorId, {
        actorId,
        actorName: name,
        skillName: label,
        sourceId: event.sourceId || null,
        startedAt: nowMs,
        isPlayer: false,
        isBoss: isBossActor(actorId),
      });
    } else {
      castMap.delete(actorId);
    }
  }
  if (event.phase === "complete" || event.phase === "interrupt" || event.phase === "cancel") {
    castMap.delete(actorId);
  }

  // Boss callouts only for confirmed bosses — never trash packs or party skills
  if (
    !player &&
    isBossActor(actorId) &&
    (event.phase === "begin" || event.phase === "inferred")
  ) {
    bossCalls.unshift({
      at: nowMs,
      actorName: name,
      skillName: label,
      phase: event.phase,
    });
    if (bossCalls.length > 20) bossCalls.length = 20;
  }
}

function actorAggregatesToDetail(encounter) {
  if (!encounter?.actors?.length) return null;
  const actors = [];
  for (const actor of encounter.actors) {
    const damage = Number(actor.damage) || 0;
    if (damage <= 0) continue;
    const actorId = actor.actorId ?? actor.actorIds?.[0];
    const skillRows = [];
    if (actor.skills instanceof Map) {
      for (const skill of actor.skills.values()) {
        skillRows.push({
          sourceId: skill.sourceId,
          sourceLabel: skill.sourceLabel,
          damage: skill.damage,
          hits: skill.hits,
          criticalHits: skill.criticalHits,
        });
      }
    }
    actors.push({
      rowId: actorId != null ? `actor:${actorId}` : `row:${actors.length}`,
      actorIds: Array.isArray(actor.actorIds) ? actor.actorIds : actorId != null ? [actorId] : [],
      displayName: actor.displayName || (actorId != null ? `Unidentified (${actorId})` : "Player"),
      archetype: actor.archetype,
      damage,
      dps: 0,
      currentDps: 0,
      hits: actor.hits || 0,
      criticalHits: actor.criticalHits || 0,
      skills: skillRows.sort((a, b) => (b.damage || 0) - (a.damage || 0)),
    });
  }
  if (!actors.length) return null;
  return { actors, startedAtMs: encounter.startedAtMs, durationMs: encounter.durationMs };
}

function buildSnapshot(nowMs) {
  meter.advance(nowMs);
  statuses.advance(nowMs);
  const state = meter.getState(nowMs);
  const current = state.current ?? state.latestFinished;
  let dps = current?.dps;
  const hps = current?.hps;
  const tps = current?.tps;
  // Combat lib hides nameless actors for 10s — pull raw encounter rows so meters move immediately.
  if (!dps?.actors?.length && meter.reducer?.current) {
    const fallback = actorAggregatesToDetail(meter.reducer.current);
    if (fallback) dps = fallback;
  }
  const actors = composeMeters(dps, hps, tps);
  // Solo / self bar: if the only damage row is still nameless, use detected/hint name immediately.
  const selfName = effectivePersonalName();
  if (selfName && actors.length) {
    const personalId = (() => {
      try {
        return meter.getPersonalActorId?.();
      } catch {
        return null;
      }
    })();
    const unresolved = actors.filter(
      (row) => isPlaceholderName(row.name) || row.name === "Resolving..." || /^player$/i.test(String(row.name || "")),
    );
    for (const row of actors) {
      const idNum = Number(row.id);
      if (personalId != null && Number.isFinite(idNum) && idNum === Number(personalId)) {
        if (isPlaceholderName(row.name) || row.name === "Resolving..." || /^player$/i.test(String(row.name || ""))) {
          row.name = selfName;
          rememberActorName(idNum, selfName);
        }
      }
    }
    if (unresolved.length === 1 && actors.length === 1) {
      unresolved[0].name = selfName;
      rememberActorName(unresolved[0].id, selfName);
      try {
        if (unresolved[0].id != null) meter.setPersonalActorId(Number(unresolved[0].id));
      } catch {
        /* ignore */
      }
    }
  }

  const personal =
    personalName ||
    personalNameHint ||
    (meter.getPersonalActorId() != null
      ? directory.get(meter.getPersonalActorId())?.displayName
      : null);
  const buffs = personal ? statuses.getActiveStatusesForName(personal, nowMs) : [];

  const casts = [...castMap.values()]
    .filter((row) => !row.isPlayer && !isPlayerSide(row.actorId))
    .map((row) => {
      const resolvedName = actorDisplayName(row.actorId);
      if (resolvedName && !String(resolvedName).startsWith("Actor ")) {
        row.actorName = resolvedName;
      }
      const skill = row.sourceId ? resolveFishNetSkill(row.sourceId) : null;
      return {
        ...row,
        actorName: row.actorName,
        skillName: skill?.displayName || row.skillName,
        elapsedMs: nowMs - row.startedAt,
      };
    })
    .filter((row) => row.actorName && !String(row.actorName).startsWith("Actor "))
    .sort((a, b) => b.elapsedMs - a.elapsedMs)
    .slice(0, 8);

  const towerState = tower.current();
  if (towerState.inTower && towerState.floor != null && towerState.floor !== lastTowerFloor) {
    if (lastTowerFloor != null) {
      floorHistory.push({
        floor: lastTowerFloor,
        clearedAt: nowMs,
        note: `→ ${towerState.floor}`,
      });
      if (floorHistory.length > 30) floorHistory.shift();
    }
    lastTowerFloor = towerState.floor;
  }

  const totalDamage = actors.reduce((sum, row) => sum + (row.damage || 0), 0);
  const started = dps?.startedAtMs || captureStartedAt;
  const elapsedMs = dps?.durationMs || Math.max(0, nowMs - started);
  const elapsedSec = Math.max(0.001, elapsedMs / 1000);
  for (const row of actors) {
    row.dps = (row.damage || 0) / elapsedSec;
    row.hps = (row.healing || 0) / elapsedSec;
    row.takenDps = (row.taken || 0) / elapsedSec;
  }
  const totalDps = totalDamage / elapsedSec;
  const bossMeter = applyBossDamage(actors, nowMs);

  dumpClassDebug(actors, nowMs);
  dumpPetDebug(nowMs);

  return {
    type: "snapshot",
    running: true,
    mode: "live",
    startedAt: started,
    elapsedMs,
    elapsedSec,
    totalDamage,
    totalHealing: hps?.total || 0,
    totalTaken: tps?.total || 0,
    totalDps,
    totalHps: hps?.rate || 0,
    bossMeter,
    actors,
    recentDeaths: deaths.slice(0, 12),
    buffs: buffs.map(serializeStatusRow).filter(Boolean),
    farm: serializeFarm(farmSession, captureStartedAt, nowMs),
    pets: serializePets(nowMs),
    casts,
    boss: bossCalls.slice(0, 8),
    tower: {
      ...towerState,
      history: [...floorHistory].reverse().slice(0, 12),
    },
    capture: {
      gameSeen,
      personalName: personal || personalName || null,
      warning: lastWarning || null,
      stats: { ...stats, groundLootSeen, rewardEvents: stats.rewardEvents },
      lootFilter: lootFilter
        ? {
            chancePercent: lootFilter.chancePercent,
            equips: lootFilter.equips,
            artifacts: lootFilter.artifacts,
            materials: lootFilter.materials,
          }
        : null,
    },
  };
}

async function main() {
  const npcap = await getNpcapStatus();
  emit({ type: "npcap", ...npcap });
  if (npcap.availability !== "ready") {
    emit({
      type: "error",
      message: npcap.detail || "Npcap is not ready. Install Npcap with WinPcap API mode enabled.",
    });
    process.exitCode = 2;
    return;
  }

  void refreshExtraMonstersFromWiki();
  const capture = new PacketCapture();
  capture.on("warning", (message) => {
    lastWarning = String(message || "");
    emit({ type: "warning", message: lastWarning });
  });
  capture.on("error", (error) => {
    emit({ type: "error", message: String(error?.message || error) });
  });
  capture.on("targetStatus", (status) => {
    const ids = status?.processIds;
    gameSeen = Boolean(
      status?.running ||
        status?.found ||
        status?.present ||
        status?.state === "tracking" ||
        status?.state === "attached" ||
        status?.state === "found" ||
        (Array.isArray(ids) && ids.length > 0),
    );
    emit({ type: "target", status });
  });
  capture.on("connection", () => {
    gameSeen = true;
  });

  capture.on("fishNetPacket", (packet) => {
    const nowMs = Date.now();
    gameSeen = true;
    stats.packets += 1;

    economyPacketTrusted =
      packet.rpcName === "ExpCoinsChanged_T" || packet.rpcName === "CoinsCallback_T";
    let working = prepareRewardPacket(recoverPacket(packet));
    if (packet.rpcName === "ApplyDamage_C" || packet.rpcName === "Death_C") {
      const before = observeFishNetDamagePacket(packet);
      working = ensureDamageDecodeDefaults(packet);
      const after = observeFishNetDamagePacket(working);
      if (!before && after) stats.damagePatched += 1;
      if (!after) stats.damageSkipped += 1;
    }

    let identities = [];
    try {
      identities = directory.consume(working);
    } catch (err) {
      lastWarning = `identity: ${err?.message || err}`;
    }
    try {
      noteArchetypesFromPacket(working);
      noteLocalNameFromCharacterPacket(working);
      noteSummonOwnerFromPacket(working);
      noteMonsterRankFromPacket(working);
      notePetHealthFromPacket(working);
      notePetDeathFromPacket(working);
      notePetStatusFromPacket(working, nowMs);
    } catch {
      /* ignore class/name decode noise */
    }

    let events = [];
    try {
      events = tracker.consume(working);
      // Combat tracker keeps a per-object SummonSkillSync map — mirror it so we don't
      // drop sibling skeletons when owner/skill arrive on separate packets.
      syncPetsFromCombatSummonTracker();
    } catch (err) {
      lastWarning = `combat: ${err?.message || err}`;
      events = [];
    }

    // Official overlay: team-0 damage marks the attacker as a player actor.
    // Skip summons/clones — their object ids must not inherit a player identity row.
    for (const event of events) {
      if ((event.kind === "damage" || event.kind === "death") && event.team === 0) {
        if (event.isSummon || event.isClone || summonOwnerByActorId.has(event.actorId)) {
          /* pet hits credit the owner below */
        } else {
          try {
            identities.push(...directory.observePlayerActor(event.actorId, event.tick));
          } catch {
            markPlayer(event.actorId);
          }
        }
      }
      if (event.kind === "death" && event.team !== 0) {
        try {
          identities.push(...directory.observePlayerActor(event.targetId, event.tick));
        } catch {
          markPlayer(event.targetId);
        }
      }
      if (event.kind === "monsterIdentity") {
        if (event.operation === "upsert") {
          markMonster(event.actorId, event.mobId, event.displayName, false);
        }
        if (event.operation === "remove") {
          knownMonsters.delete(event.actorId);
          bossActorIds.delete(event.actorId);
          monsterNames.delete(event.actorId);
        }
        if (event.operation === "reset") {
          knownMonsters.clear();
          bossActorIds.clear();
          monsterNames.clear();
        }
      }
    }

    for (const identity of identities) {
      meter.consumeIdentity(identity, nowMs);
      // Summon objects intentionally lose player identity on SummonerSync; the stock status
      // tracker would wipe their buffs on that remove. Keep pet statuses alive.
      const isPet =
        identity?.actorId != null &&
        (summonOwnerByActorId.has(identity.actorId) || petStateByActorId.has(identity.actorId));
      if (!(identity?.operation === "remove" && isPet)) {
        statuses.consumeIdentity(identity);
      }
      if (identity.operation === "upsert") {
        markPlayer(identity.actorId);
        rememberActorName(identity.actorId, identity.displayName);
        if (identity.archetype != null) {
          rememberClass(identity.displayName, identity.archetype);
        } else if (identity.displayName) {
          const cached = classByName.get(String(identity.displayName).toLowerCase());
          if (cached) rememberClass(identity.displayName, cached);
        }
        if (
          personalName &&
          String(identity.displayName || "").toLowerCase() === String(personalName).toLowerCase()
        ) {
          meter.setPersonalActorId(identity.actorId);
        }
      }
    }

    for (const rawEvent of events) {
      // Pet HP must use the raw target id (before summon damage is credited to the owner).
      try {
        notePetCombatHealth(rawEvent);
        notePetStatusFromEvent(rawEvent, nowMs);
      } catch {
        /* ignore */
      }
      const event = attributeCombatEventToOwner(rawEvent);
      // Healing Done is cast/party healing only — skip lifesteal, siphon, and regen.
      const paused = isSessionPaused();
      if (!paused && !isSelfishHealEvent(event)) {
        meter.consumeCombat(event, nowMs);
      }
      if (!paused) noteBossDamage(rawEvent, event, nowMs);
      statuses.consume(event, nowMs);
      if (event.kind === "damage" || event.kind === "death") {
        stats.damageEvents += 1;
      }
      // Class-prefixed skill ids (Gunslinger_3, …) fill gaps when Appearance.Archetype never arrives.
      if (
        (event.kind === "damage" || event.kind === "activation" || event.kind === "heal") &&
        event.team === 0
      ) {
        const cls = classFromSkillRef(event.sourceId) || classFromSkillRef(event.sourceLabel);
        if (cls) {
          const name = actorDisplayName(event.actorId, event);
          if (!isPlaceholderName(name)) rememberClass(name, cls);
        }
      }
      if (event.kind === "death" && !paused) {
        noteDeath(event, nowMs);
        noteCombatKill(event, nowMs);
      }
      if (event.kind === "activation") noteActivation(event, nowMs);
    }

    let rewardOk = false;
    let detailedItems = [];
    try {
      if (isPickupPacket(working)) {
        lastPersonalPickupAt = nowMs;
        try {
          detailedItems = decodePickupItemsDetailed(working)?.items || [];
        } catch {
          detailedItems = [];
        }
        if (!detailedItems.length) detailedItems = pickupsFromDecodedFields(working);
        // Do not scan raw payload strings for item ids — that invents loot you never picked up.
      }
    } catch {
      detailedItems = [];
    }
    try {
      const rewardEvents = rewards.consume(working) || [];
      for (const reward of rewardEvents) {
        // Personal pickups: keep XP/coins from stock, but log items via our decoder so
        // materials aren't dropped when stock marks the packet "ok" without usable drops.
        const use =
          isPickupPacket(working) && detailedItems.length
            ? { ...reward, drops: [] }
            : reward;
        farmSession.consume(use, { recordedAt: new Date(nowMs).toISOString() });
        stats.rewardEvents += 1;
        rewardOk = true;
      }
    } catch (err) {
      stats.rewardErrors += 1;
      lastWarning = `reward: ${String(err?.message || err).slice(0, 180)}`;
    }
    try {
      if (detailedItems.length) {
        noteBagItems(detailedItems);
        const gear = detailedItems.filter(
          (item) => item.category === "equipment" || item.category === "artifact",
        );
        for (const item of gear) {
          equipDetailsLog.push(item);
          if (equipDetailsLog.length > 120) equipDetailsLog.shift();
        }
        ingestFarmPickups(detailedItems, working.tick || 0, nowMs);
      }
    } catch {
      /* ignore detailed pickup misses */
    }
    try {
      if (isLootFilterPacket(working)) {
        const decoded = decodeLootFilter(working);
        if (decoded) lootFilter = decoded;
      }
    } catch {
      /* ignore loot-filter decode misses */
    }
    try {
      ingestChatLootNotices(working, nowMs);
    } catch {
      /* ignore chat loot misses */
    }
    try {
      const coins = coinsFromPacket(working);
      if (coins != null) setWalletCoins(coins, nowMs, economyPacketTrusted);
    } catch {
      /* ignore */
    }
    try {
      const decodedReward = decodeRewardLenient(working);
      if (decodedReward?.kind === "experienceState" && decodedReward.state) {
        // Always record into-level XP deltas for Exp! rate/TTL — even when the
        // official reward tracker also marked this packet (rewardOk).
        noteEconomyDelta(decodedReward.state, working.tick || 0, nowMs);
      } else if (!rewardOk) {
        injectLenientReward(working, nowMs);
      }
    } catch {
      if (!rewardOk) {
        try {
          injectLenientReward(working, nowMs);
        } catch {
          /* ignore */
        }
      }
    }
    try {
      consumeGroundLoot(working, nowMs);
    } catch {
      /* ignore ground-loot decode misses */
    }
    try {
      noteCharacterBagFields(working, nowMs);
    } catch {
      /* ignore inventory/weight decode misses */
    }
    try {
      trySeedAbsoluteWallet(working, nowMs);
    } catch {
      /* ignore cold-start wallet misses */
    }
    try {
      tower.consume(working);
    } catch {
      /* ignore */
    }
  });

  await capture.start({
    protocols: ["udp"],
    targetProcessName: "SpiritVale.exe",
    decodeFishNet: true,
  });
  captureStartedAt = Date.now();
  goldRateStartedAt = captureStartedAt;
  goldRateBaseline = null;
  resetGoldEarned();
  lastEconomy = null;
  expTracker.reset(captureStartedAt);
  emit({ type: "started", at: captureStartedAt });
  try {
    emit(buildSnapshot(captureStartedAt));
  } catch {
    /* ignore */
  }

  const tick = setInterval(() => {
    try {
      saveIdentityStore();
      emit(buildSnapshot(snapshotNow()));
    } catch (err) {
      emit({ type: "error", message: String(err?.message || err) });
    }
  }, 250);

  const shutdown = async () => {
    clearInterval(tick);
    try {
      await capture.stop();
    } catch {
      /* ignore */
    }
    emit({ type: "stopped" });
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  const handleCommand = (text) => {
    if (text === "stop") shutdown();
    if (text === "pause" || text === "resume") {
      const changed = text === "pause" ? pauseSession() : resumeSession();
      if (changed) emit({ type: "paused", paused: isSessionPaused() });
      emit(buildSnapshot(snapshotNow()));
    }
    if (text === "zero") {
      // Soft clear: wipe combat totals only — keep names, identities, farm/exp baselines.
      const now = Date.now();
      meter.reset(now);
      meter.latestFinished = undefined;
      meter.meterId = undefined;
      try {
        meter.meters?.reset?.();
      } catch {
        /* ignore */
      }
      deaths.length = 0;
      castMap.clear();
      bossCalls.length = 0;
      clearBossDamage();
      if (isSessionPaused()) sessionPausedAt = now;
      emit({ type: "zero" });
      emit(buildSnapshot(snapshotNow()));
    }
    if (text === "reset") {
      meter.reset(Date.now());
      meter.latestFinished = undefined;
      meter.meterId = undefined;
      farmSession.reset();
      try {
        rewards.reset();
      } catch {
        /* ignore */
      }
      statuses.reset();
      deaths.length = 0;
      castMap.clear();
      bossCalls.length = 0;
      clearBossDamage();
      floorHistory.length = 0;
      actorNames.clear();
      classByName.clear();
      killerKills.clear();
      lastKillAtMs = 0;
      ingestedPickupKeys.clear();
      ingestedPickupRecent.clear();
      chatFoundNames.clear();
      loggedGroundLoot.clear();
      recentLootDespawns.length = 0;
      lastPickupAnimAt = 0;
      lastPersonalPickupAt = 0;
      lootFlushUntil = 0;
      groundLootSeen = 0;
      try {
        groundLoot.reset();
      } catch {
        /* ignore */
      }
      lastEconomy = null;
      sessionBagWeight = 0;
      captureStartedAt = Date.now();
      goldRateStartedAt = captureStartedAt;
      expTracker.reset(captureStartedAt);
      goldRateBaseline =
        Number(lastKnownWallet) >= 100
          ? Number(lastKnownWallet)
          : playerEconomy?.coins != null &&
              Number.isFinite(Number(playerEconomy.coins)) &&
              Number(playerEconomy.coins) >= 100
            ? Number(playerEconomy.coins)
            : null;
      playerEconomy = playerEconomy
        ? { ...playerEconomy, updatedAt: captureStartedAt }
        : null;
      resetGoldEarned();
      bagWeight = 0;
      bagWeightLimitAttr = null;
      wornWeightLimitBonus = 0;
      bagSynced = false;
      bagItems.clear();
      equipDetailsLog.length = 0;
      knownPlayers.clear();
      // keep monster identity maps — still in the zone
      if (isSessionPaused()) {
        sessionPausedAt = captureStartedAt;
        expTracker.setPaused(true);
      }
      emit({ type: "reset" });
      emit(buildSnapshot(snapshotNow()));
    }
  };
  process.stdin.on("data", (buf) => {
    for (const line of String(buf || "").split(/\r?\n/)) {
      const text = line.trim();
      if (text) handleCommand(text);
    }
  });
}

main().catch((err) => {
  emit({ type: "error", message: String(err?.message || err) });
  process.exit(1);
});
