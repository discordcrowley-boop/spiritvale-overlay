const https = require("https");
const http = require("http");
const market = require("./market-service");
const store = require("./capture/data-store.cjs");

const WIKI = "https://spiritvalers.com";
const INFO_ICONS = "https://spiritvale.info/content/game/icons";

let iconIndex = store.dataset("iconIndex", { byId: {}, byName: {}, skills: {} });

const RARITY_COLORS = {
  poor: "#9d9d9d",
  common: "#ffffff",
  uncommon: "#1eff00",
  rare: "#0070dd",
  epic: "#a335ee",
  legendary: "#ff8000",
  artifact: "#e6cc80",
  unique: "#e6cc80",
  heirloom: "#00ccff",
};

const RARITY_FROM_NUMBER = {
  0: "poor",
  1: "common",
  2: "uncommon",
  3: "rare",
  4: "epic",
  5: "legendary",
  6: "artifact",
  7: "unique",
};

let cache = null;
let inFlight = null;

function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toSlug(value) {
  return String(value || "")
    .trim()
    // ClericChest → Cleric-Chest before lowercasing
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    // Apostrophes become hyphens so "Witch's Whisk" → witch-s-whisk (CDN slug).
    .replace(/['']/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function iconSlugCandidates(itemId, displayName, sprite) {
  const names = [displayName, itemId, sprite].filter(Boolean);
  const out = [];
  const seen = new Set();
  const push = (slug) => {
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    out.push(slug);
  };
  for (const name of names) {
    const primary = toSlug(name);
    const stripped = String(name || "")
      .trim()
      .toLowerCase()
      .replace(/['']/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    // Sprite tokens like T_Axe_GoldenAxe / antique_teacup → axe-goldenaxe / antique-teacup
    const fromSprite = String(name || "")
      .trim()
      .replace(/^T_/i, "")
      .replace(/_/g, "-")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    for (const slug of [primary, stripped, fromSprite]) push(slug);
    // witchs-whisk ↔ witch-s-whisk
    if (primary) push(primary.replace(/([a-z])s-/g, "$1-s-"));
    if (stripped) push(stripped.replace(/([a-z])s-/g, "$1-s-"));
  }
  return out;
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timeout ${url}`));
    });
  });
}

function httpGetText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timeout ${url}`));
    });
  });
}

function rarityKey(value) {
  if (typeof value === "number") return RARITY_FROM_NUMBER[value] || "common";
  const raw = String(value || "common").trim().toLowerCase();
  if (RARITY_COLORS[raw]) return raw;
  if (raw.includes("legend")) return "legendary";
  if (raw.includes("unique") || raw.includes("artifact")) return "unique";
  if (raw.includes("epic")) return "epic";
  if (raw.includes("rare")) return "rare";
  if (raw.includes("uncommon") || raw.includes("magic")) return "uncommon";
  if (raw.includes("poor") || raw.includes("junk")) return "poor";
  return "common";
}

function spaceName(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
}

const STAT_LABELS = {
  Atk: "Atk",
  Matk: "Matk",
  Def: "Def",
  Mdef: "Mdef",
  Hit: "Hit",
  Flee: "Flee",
  Crit: "Crit",
  Aspd: "Aspd",
  Hp: "Max HP",
  Mp: "Max MP",
  HpMult: "Max HP",
  MpMult: "Max MP",
  AtkMult: "Atk",
  MatkMult: "Matk",
  DefMult: "Def",
  MdefMult: "Mdef",
  MatkPerStr: "Matk per Str",
  AtkPerStr: "Atk per Str",
  AtkPerAgi: "Atk per Agi",
  MatkPerInt: "Matk per Int",
  SkillDamage: "Skill Damage",
  SkillCooldown: "Skill Cooldown",
  CooldownRecovery: "Cooldown Recovery",
  DoubleAttack: "Double Attack",
  AutocastAttack: "AutocastAttack",
  StatusImmune: "Status Immunity",
  WeightLimit: "Weight Limit",
  DamageRanged: "Ranged Damage",
  Range: "Range",
};

function isPercentStat(statName) {
  const key = String(statName || "");
  if (/^(Hit|Flee|Crit|Atk|Matk|Def|Mdef|Hp|Mp|Range|Chain|Block|Str|Vit|Agi|Dex|Int|Luk)$/i.test(key)) {
    return false;
  }
  return (
    key.endsWith("Mult") ||
    /Chance|Rate|Recovery|Damage|Resist|Pierce|CritDamage|AtkSpd|CastSpd|MoveSpd|Aspd|Cooldown|Autocast|Leech|Healing/i.test(
      key,
    )
  );
}

function formatStatValue(stat, { primary = false } = {}) {
  if (!stat) return null;
  const raw = stat.stat || stat.name || "Stat";
  const base = Number(stat.base);
  const per = Number(stat.per);
  const q = String(stat.q || "").trim();
  const percent = isPercentStat(raw) || /Autocast/i.test(raw);

  if (/^Autocast/i.test(raw)) {
    const skill = spaceName(q) || "skill";
    const chance = Number.isFinite(per) && per !== 0 ? per : base;
    if (!Number.isFinite(chance) || chance === 0) return null;
    const refine = Number.isFinite(per) && per !== 0 && Number.isFinite(base) && base !== 0
      ? `+${base}% · +${per}% per refine`
      : Number.isFinite(per) && per !== 0
        ? `+${per}% per refine`
        : `+${chance}%`;
    return {
      label: `Chance to autocast ${skill} when attacking`,
      value: refine,
      tone: "bonus",
    };
  }

  const label = STAT_LABELS[raw] || spaceName(raw) || raw;
  const suffix = q ? ` (${spaceName(q)})` : "";
  const unit = percent ? "%" : "";
  const parts = [];
  if (Number.isFinite(base) && (base !== 0 || primary)) {
    if (primary && !percent) parts.push(String(base));
    else parts.push(`${base > 0 ? "+" : ""}${base}${unit}`);
  }
  if (Number.isFinite(per) && per !== 0) {
    parts.push(`${per > 0 ? "+" : ""}${per}${unit}/refine`);
  }
  if (!parts.length) return null;
  return {
    label: `${label}${suffix}`,
    value: parts.join(" · "),
    tone: primary ? "base" : "bonus",
  };
}

function tipStatsFromRow(row, kind) {
  const header = [];
  const base = [];
  const bonus = [];
  if (kind === "equipment") {
    if (row.slot) header.push({ label: "Slot", value: row.slot, tone: "meta" });
    if (row.lvl != null) header.push({ label: "Level", value: String(row.lvl), tone: "meta" });
    if (row.element) header.push({ label: "Element", value: row.element, tone: "meta" });
    for (const stat of row.primary || []) {
      const line = formatStatValue(stat, { primary: true });
      if (line) base.push(line);
    }
    for (const stat of row.secondary || []) {
      const line = formatStatValue(stat, { primary: false });
      if (line) bonus.push(line);
    }
  } else if (kind === "card") {
    if (row.eqClass) header.push({ label: "Slot", value: row.eqClass, tone: "meta" });
    if (row.affix) header.push({ label: "Affix", value: row.affix, tone: "meta" });
    for (const stat of row.stats || []) {
      const line = formatStatValue(stat);
      if (line) bonus.push(line);
    }
  } else if (kind === "gem") {
    if (row.skill) header.push({ label: "Skill", value: spaceName(row.skill), tone: "meta" });
    for (const stat of row.stats || row.effects || []) {
      const line = formatStatValue(stat);
      if (line) bonus.push(line);
    }
  } else if (kind === "material") {
    if (row.sell != null) header.push({ label: "Vendor", value: String(row.sell), tone: "meta" });
  }

  const lines = [...header, ...base, ...bonus].map((rowLine) => `${rowLine.label}: ${rowLine.value}`);
  return {
    header,
    base,
    bonus,
    lines: lines.slice(0, 16),
    slot: row.slot || row.eqClass || null,
    level: row.lvl ?? null,
    element: row.element || null,
    cardSlots: row.cardSlots ?? null,
    substatPool: row.substatPool || null,
  };
}

const PRIMARY_ATTRS = new Set(["Str", "Vit", "Agi", "Dex", "Int", "Luk"]);
// Primary attrs + small % rolls the wiki pool under-specifies.
const KNOWN_ROLL_WINDOWS = {
  Str: { min: 2, max: 3 },
  Vit: { min: 2, max: 3 },
  Agi: { min: 2, max: 3 },
  Dex: { min: 2, max: 3 },
  Int: { min: 2, max: 3 },
  Luk: { min: 2, max: 3 },
  HpMult: { min: 1, max: 2 },
  MpMult: { min: 1, max: 2 },
};

function rangeFromMax(max) {
  if (!Number.isFinite(max) || max <= 0) return null;
  // Wiki: value = max × (roll/100 × 1/3 + 2/3) → ~66.7% .. 100% of max
  return { min: Math.max(1, Math.floor((max * 2) / 3)), max };
}

function poolRangeFor(poolName, statName) {
  if (KNOWN_ROLL_WINDOWS[statName]) return { ...KNOWN_ROLL_WINDOWS[statName] };
  if (PRIMARY_ATTRS.has(statName)) return { min: 2, max: 3 };
  if (!cache?.substatPools || !poolName || !statName) return null;
  const pool = cache.substatPools[poolName];
  if (!Array.isArray(pool)) return null;
  const values = [];
  for (const group of pool) {
    for (const opt of group || []) {
      if (String(opt.stat) === String(statName) && Number.isFinite(Number(opt.value))) {
        values.push(Number(opt.value));
      }
    }
  }
  if (!values.length) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (min === max) return rangeFromMax(max);
  return { min, max };
}

/**
 * Pickup StatData.Value is often a quality roll 0..100, but inventory/market
 * paths may already store the tip number. Only treat values *above* the pool
 * max as rolls so we don't destroy real display values like +4 on a max-5 pool.
 */
function decodeSubstatValue(raw, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(max) || max <= 0) return Math.trunc(value);
  const min = Math.max(1, Math.floor((max * 2) / 3));
  if (value >= min && value <= max) return Math.trunc(value);
  if (value > max && value <= 100) {
    return Math.round(max * ((value / 100) * (1 / 3) + 2 / 3));
  }
  if (value >= 0 && value < min) {
    return Math.round(max * ((value / 100) * (1 / 3) + 2 / 3));
  }
  const roll = Math.max(0, Math.min(100, Math.abs(Math.trunc(value))));
  return Math.round(max * ((roll / 100) * (1 / 3) + 2 / 3));
}

function formatRolledSubstats(substats, poolName) {
  if (!Array.isArray(substats) || !substats.length) return [];
  const rows = [];
  for (const row of substats.slice(0, 6)) {
    const type = row.type;
    // Prefer numeric Value; ValueStr is rarely the roll (often empty / skill id).
    let wire = Number(row.value);
    if (!Number.isFinite(wire)) {
      const fromStr = Number(String(row.valueStr || "").replace(/[^\d.-]/g, ""));
      if (Number.isFinite(fromStr) && String(row.valueStr || "").trim() !== "") wire = fromStr;
    }
    if (!Number.isFinite(wire)) continue;
    const statName =
      (cache?.statTypes && (cache.statTypes[String(type)] || cache.statTypes[type])) ||
      `Stat ${type}`;
    const label = STAT_LABELS[statName] || spaceName(statName) || statName;
    const percent = isPercentStat(statName);
    const unit = percent ? "%" : "";
    const range = poolRangeFor(poolName, statName);
    let low = range ? range.min : null;
    let high = range ? range.max : null;
    let value = wire;
    if (low == null || high == null) {
      // Unknown pool: if wire looks like a 0..100 roll, skip rather than show +86.
      if (wire > 30 && wire <= 100) continue;
      if (Math.abs(wire) > 100) continue;
      value = Math.trunc(wire);
      low = Math.min(value, Math.max(1, value - 1));
      high = Math.max(value, low);
    } else {
      value = decodeSubstatValue(wire, high);
    }
    rows.push({
      label,
      value: `+${value}${unit} [${low}~${high}${unit}]`,
      tone: "rolled",
      stat: statName,
      raw: value,
      wire,
      low,
      high,
    });
  }
  return rows;
}

const flavorCache = new Map();
const flavorInFlight = new Map();

async function fetchFlavor(kind, slug) {
  if (!slug) return null;
  const key = `${kind}:${slug}`;
  if (flavorCache.has(key)) return flavorCache.get(key);
  if (flavorInFlight.has(key)) return flavorInFlight.get(key);
  const path =
    kind === "card"
      ? `cards/${slug}`
      : kind === "material"
        ? `materials/${slug}`
        : `equipment/${slug}`;
  const job = httpGetText(`https://spiritvale.info/${path}`)
    .then((html) => {
      const desc = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] || null;
      const cleaned = desc
        ? desc
            .replace(/&#8211;/g, "—")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim()
        : null;
      flavorCache.set(key, cleaned);
      return cleaned;
    })
    .catch(() => {
      flavorCache.set(key, null);
      return null;
    })
    .finally(() => flavorInFlight.delete(key));
  flavorInFlight.set(key, job);
  return job;
}

function statsFromRow(row, kind) {
  return tipStatsFromRow(row, kind).lines;
}

function artifactSlot(name) {
  const match = String(name || "").match(/\b(Relic|Scroll|Rune|Jewel)\b/i);
  return match ? match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() : null;
}

function kindPlaceholderFill(kind, slot) {
  if (slot === "Relic") return "#e6cc80";
  if (slot === "Scroll") return "#7ec8ff";
  if (slot === "Rune") return "#c9a0ff";
  if (slot === "Jewel") return "#6dffb0";
  if (kind === "equipment") return "#d4b483";
  if (kind === "card") return "#f0c36a";
  if (kind === "gem") return "#7ec8ff";
  if (kind === "material") return "#9aa0a8";
  if (kind === "consumable") return "#8fd19e";
  return "#d8dde3";
}

function itemPlaceholderIcon(displayName, kind = null) {
  const slot = artifactSlot(displayName);
  const fill = kindPlaceholderFill(kind, slot);
  const letter = escapeXml(String(slot || displayName || "?").slice(0, 1).toUpperCase());
  const label = escapeXml(String(displayName || slot || "Item").slice(0, 18));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="8" fill="#14161a"/>
  <rect x="4" y="4" width="56" height="56" rx="6" fill="none" stroke="${fill}" stroke-width="2"/>
  <text x="32" y="30" text-anchor="middle" font-family="Segoe UI,sans-serif" font-size="22" font-weight="700" fill="${fill}">${letter}</text>
  <text x="32" y="48" text-anchor="middle" font-family="Segoe UI,sans-serif" font-size="8" fill="#9aa0a8">${label}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}`;
}

function artifactPlaceholderIcon(displayName) {
  return itemPlaceholderIcon(displayName, "artifact");
}

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function indexedIconUrl(itemId, displayName) {
  const byId = iconIndex?.byId || {};
  const byName = iconIndex?.byName || {};
  for (const key of [itemId, displayName]) {
    if (!key) continue;
    if (byId[key]) return byId[key];
    if (byName[key]) return byName[key];
  }
  const needle = norm(displayName || itemId);
  if (!needle) return null;
  for (const [name, url] of Object.entries(byName)) {
    if (norm(name) === needle) return url;
  }
  for (const [id, url] of Object.entries(byId)) {
    if (norm(id) === needle) return url;
  }
  return null;
}

function iconUrlsFor(itemId, displayName, kind, sprite) {
  if (kind === "card" || sprite === "card" || sprite === "card_gold") {
    return [`${INFO_ICONS}/item-card-normal.webp`, itemPlaceholderIcon(displayName || itemId, "card")];
  }
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  // Prefer the pre-built SpiritvaleRS/info index so display-name slugs win over raw ids.
  push(indexedIconUrl(itemId, displayName));
  // Wiki equipment icons are keyed by Unity sprite: equip-T_Chest_DFHeavy.webp
  const spriteKey = String(sprite || "").trim();
  if (spriteKey) {
    push(`${WIKI}/content/game/icons/equip-${spriteKey}.webp`);
    push(`${INFO_ICONS}/equip-${spriteKey}.webp`);
    push(`${WIKI}/content/game/icons/item-${spriteKey}.webp`);
    push(`${INFO_ICONS}/item-${spriteKey}.webp`);
  }
  // Prefer human names before opaque ids (Leg_Luk → fate-greaves).
  for (const slug of iconSlugCandidates(itemId, displayName, sprite)) {
    push(`${INFO_ICONS}/item-${slug}.webp`);
    push(`${WIKI}/content/game/icons/item-${slug}.webp`);
    push(`${WIKI}/content/game/icons/equip-${slug}.webp`);
    push(`${WIKI}/wiki-data/item-icons/${slug}.webp`);
  }
  // Always end with a local SVG so a broken CDN never leaves a blank/missing icon.
  push(itemPlaceholderIcon(displayName || itemId, kind));
  return urls;
}

function iconUrlFor(itemId, displayName, kind, sprite) {
  return iconUrlsFor(itemId, displayName, kind, sprite)[0] || null;
}

async function loadCatalog(force = false) {
  const now = Date.now();
  if (!force && cache && now - cache.fetchedAt < 30 * 60_000) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const local = (name, route, fallback) => {
      const value = store.dataset(name);
      if (value != null) return Promise.resolve(value);
      return httpGetJson(`${WIKI}${route}`).catch(() => fallback);
    };
    const [drops, monsters, maps, equips, cards, gems, materials, statTypes, substatPools] =
      await Promise.all([
      local("drops", "/wiki-data/drops.json", {}),
      local("monsters", "/wiki-data/monsters.json", []),
      local("maps", "/wiki-data/maps.json", []),
      local("equips", "/equip-configs.json", []),
      local("cards", "/card-configs.json", []),
      local("gems", "/gem-configs.json", []),
      local("materials", "/wiki-data/materials.json", []),
      local("statTypes", "/wiki-data/stat-types.json", {}),
      local("substatPools", "/substat-pools.json", {}),
    ]);

    const items = new Map();
    const add = (row, kind, rarityHint) => {
      if (!row?.id && !row?.name) return;
      const id = row.id || row.name;
      const name = row.name || row.id;
      const rarity = rarityKey(row.rarity || rarityHint || (row.unique ? "unique" : "common"));
      const tip = tipStatsFromRow(row, kind);
      const entry = {
        itemId: id,
        displayName: name,
        kind,
        rarity,
        color: RARITY_COLORS[rarity] || RARITY_COLORS.common,
        sprite: row.sprite || null,
        iconUrl: iconUrlFor(id, name, kind, row.sprite),
        iconUrls: iconUrlsFor(id, name, kind, row.sprite),
        slug: row.slug || toSlug(name),
        description: row.desc || null,
        stats: tip.lines,
        tip,
        substatPool: tip.substatPool || row.substatPool || null,
      };
      items.set(norm(id), entry);
      items.set(norm(name), entry);
    };

    for (const row of materials || []) add(row, "material", row.rarity);
    for (const row of equips || [])
      add(row, "equipment", row.unique ? "unique" : Number(row.lvl) >= 80 ? "rare" : "uncommon");
    for (const row of cards || []) add(row, "card", row.sprite === "card_gold" ? "legendary" : "epic");
    for (const row of gems || []) add(row, "gem", "rare");

    // Artifact set pieces (Starfire Relic, etc.) often only appear in drops.json.
    for (const itemId of Object.keys(drops || {})) {
      if (items.has(norm(itemId))) continue;
      const slot = artifactSlot(itemId);
      if (!slot) continue;
      add({ id: itemId, name: itemId, rarity: "artifact" }, "artifact", "artifact");
    }

    const monsterByName = new Map();
    const monsterById = new Map();
    const monsterBySlug = new Map();
    for (const mon of monsters || []) {
      if (!mon) continue;
      if (mon.name) monsterByName.set(norm(mon.name), mon);
      if (mon.id) monsterById.set(norm(mon.id), mon);
      if (mon.slug) monsterBySlug.set(norm(mon.slug), mon);
    }

    const mapsByMonster = new Map();
    for (const map of maps || []) {
      if (!map) continue;
      for (const name of [...(map.pool || []), ...(map.bosses || [])]) {
        const key = norm(name);
        if (!mapsByMonster.has(key)) mapsByMonster.set(key, []);
        mapsByMonster.get(key).push(map);
      }
    }

    const sourcesByItem = new Map();
    for (const [itemId, rows] of Object.entries(drops || {})) {
      const sources = [];
      for (const drop of rows || []) {
        const mon =
          monsterByName.get(norm(drop.monster)) ||
          monsterByName.get(norm(drop.monsterSlug));
        const mapList =
          mapsByMonster.get(norm(drop.monster)) ||
          mapsByMonster.get(norm(mon?.name || mon?.id)) ||
          [];
        const bestMap = mapList
          .slice()
          .sort((a, b) => (b.density || 0) - (a.density || 0))[0];
        sources.push({
          monster: drop.monster || mon?.name || "Unknown",
          monsterSlug: drop.slug || mon?.slug || null,
          mapName: bestMap?.name || bestMap?.id || null,
          mapSlug: bestMap?.slug || null,
          mapId: bestMap?.id || null,
          mapLevel:
            bestMap?.minLevel != null || bestMap?.maxLevel != null
              ? `${bestMap.minLevel ?? "?"}–${bestMap.maxLevel ?? "?"}`
              : null,
          boss: Boolean(drop.boss || mon?.boss),
          chance: Number(drop.chance) || 0,
          level: drop.level ?? mon?.level ?? null,
          minimapUrl: bestMap?.slug
            ? `${WIKI}/wiki-data/minimaps/${bestMap.slug}.webp`
            : null,
          mapUrl: bestMap?.slug ? `${WIKI}/#/maps/${bestMap.slug}` : null,
          monsterIconUrl: (drop.slug || mon?.slug)
            ? `${WIKI}/wiki-data/monster-icons/${drop.slug || mon.slug}.webp`
            : null,
        });
      }
      sources.sort((a, b) => b.chance - a.chance);
      sourcesByItem.set(norm(itemId), sources);
      const meta = items.get(norm(itemId));
      if (meta?.displayName) sourcesByItem.set(norm(meta.displayName), sources);
    }

    cache = {
      fetchedAt: now,
      items,
      sourcesByItem,
      monsterByName,
      monsterById,
      monsterBySlug,
      statTypes: statTypes || {},
      substatPools: substatPools || {},
    };
    return cache;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

function lookup(itemId, displayName) {
  if (!cache) return null;
  return (
    cache.items.get(norm(itemId)) ||
    cache.items.get(norm(displayName)) ||
    null
  );
}

function sourcesFor(itemId, displayName) {
  if (!cache) return [];
  return (
    cache.sourcesByItem.get(norm(itemId)) ||
    cache.sourcesByItem.get(norm(displayName)) ||
    []
  );
}

function marketLookup(marketItems, itemId, displayName) {
  if (!Array.isArray(marketItems) || !marketItems.length) return null;
  const keys = [norm(displayName), norm(itemId)].filter(Boolean);
  for (const item of marketItems) {
    if (keys.includes(norm(item.displayName)) || keys.includes(norm(item.itemId))) {
      return item;
    }
  }
  const needle = keys[0];
  if (!needle) return null;
  return (
    marketItems.find((item) => norm(item.displayName).includes(needle)) ||
    marketItems.find((item) => needle.includes(norm(item.displayName))) ||
    null
  );
}

function enrichDrop(drop, marketItems = []) {
  const meta = lookup(drop.itemId, drop.name || drop.displayName);
  const sources = sourcesFor(drop.itemId, drop.name || drop.displayName || meta?.displayName);
  const best = sources[0] || null;
  const rarity = rarityKey(drop.rarity ?? meta?.rarity ?? "common");
  const name = drop.name || drop.displayName || meta?.displayName || drop.itemId || "Item";
  const itemId = drop.itemId || meta?.itemId || name;
  const marketHit = marketLookup(marketItems, itemId, name);
  const tip = meta?.tip ? { ...meta.tip } : null;
  const rolled = formatRolledSubstats(drop.substats || [], meta?.substatPool || tip?.substatPool);
  if (tip && rolled.length) {
    tip.rolled = rolled;
    tip.lines = [...(tip.lines || []), ...rolled.map((row) => `${row.label}: ${row.value}`)];
  }
  if (tip && drop.potential != null) {
    tip.potential = drop.potential;
  }
  if (tip && drop.cardSlots == null && tip.cardSlots != null && Array.isArray(drop.cards)) {
    tip.cardsFilled = `(${drop.cards.length}/${tip.cardSlots})`;
  }
  const kind = meta?.kind || drop.category || (artifactSlot(name) ? "artifact" : null);
  const iconUrls =
    (meta?.iconUrls && meta.iconUrls.length
      ? [...meta.iconUrls]
      : iconUrlsFor(itemId, name, kind, meta?.sprite)) || [];
  const indexed = indexedIconUrl(itemId, name);
  if (indexed && !iconUrls.includes(indexed)) iconUrls.unshift(indexed);
  if (!iconUrls.some((url) => String(url).startsWith("data:"))) {
    iconUrls.push(itemPlaceholderIcon(name, kind));
  }
  return {
    ...drop,
    itemId,
    name,
    displayName: name,
    count: Number(drop.count || drop.quantity || 1),
    rarity,
    color: RARITY_COLORS[rarity] || RARITY_COLORS.common,
    iconUrl: iconUrls[0] || meta?.iconUrl || null,
    iconUrls,
    description: meta?.description || null,
    stats: tip?.lines || meta?.stats || [],
    tip,
    rolled,
    potential: drop.potential ?? null,
    slot: tip?.slot || null,
    level: tip?.level,
    element: tip?.element || null,
    cardSlots: tip?.cardSlots,
    kind: kind || meta?.kind || drop.category || null,
    mapName: drop.mapName || null,
    monster: drop.from && drop.from !== "loot" ? drop.from : drop.monster || null,
    sourceLabel:
      drop.from && drop.from !== "loot"
        ? drop.from
        : drop.sourceLabel && drop.sourceLabel !== "Unknown source"
          ? drop.sourceLabel
          : "Picked up",
    market: marketHit
      ? {
          low: marketHit.low || 0,
          median: marketHit.median || 0,
          high: marketHit.high || 0,
          listingCount: marketHit.listingCount || 0,
          average: marketHit.median || 0,
        }
      : null,
  };
}

async function enrichFarm(farm) {
  if (!farm) return farm;
  try {
    await loadCatalog();
  } catch {
    /* offline enrichment still returns icons by id */
  }
  let marketItems = [];
  try {
    const snap = await market.getSnapshot(false);
    marketItems = snap.items || [];
  } catch {
    marketItems = [];
  }
  const STAT_NOISE = new Set([
    "atk",
    "matk",
    "def",
    "mdef",
    "hit",
    "flee",
    "crit",
    "hp",
    "mp",
    "sp",
    "str",
    "agi",
    "vit",
    "int",
    "dex",
    "luk",
    "weight",
    "refine",
    "potential",
  ]);
  const isStatNoise = (value) => {
    const key = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    return Boolean(key) && (STAT_NOISE.has(key) || /(atk|matk|def|mdef|hp|mp)mult$/.test(key));
  };
  const drops = [];
  for (const drop of farm.drops || []) {
    if (isStatNoise(drop.itemId) || isStatNoise(drop.name) || isStatNoise(drop.displayName)) continue;
    // Keep enrichment synchronous on the live tick path. Flavor text is optional and
    // used to stall/overwrite fresher snapshots when awaited per item.
    drops.push(enrichDrop(drop, marketItems));
  }
  return {
    ...farm,
    drops,
    mobs: (farm.mobs || []).map(enrichWikiMob),
    killers: (farm.killers || []).map((row) => ({
      ...row,
      mobs: (row.mobs || []).map(enrichWikiMob),
    })),
  };
}

function findWikiMonster(name, id) {
  if (!cache) return null;
  const keys = [id, name].map(norm).filter(Boolean);
  for (const key of keys) {
    const hit = cache.monsterById?.get(key) || cache.monsterByName?.get(key) || cache.monsterBySlug?.get(key);
    if (hit) return hit;
  }
  const compact = String(name || id || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!compact || compact.length < 4) return null;
  for (const mon of cache.monsterByName?.values() || []) {
    const theirs = String(mon.name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (theirs && (compact === theirs || (compact.startsWith(theirs) && compact.length - theirs.length <= 2))) {
      return mon;
    }
  }
  return null;
}

function enrichWikiMob(mob) {
  if (!mob) return mob;
  const mon = findWikiMonster(mob.name, mob.id);
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  if (mon?.slug) push(`${WIKI}/wiki-data/monster-icons/${mon.slug}.webp`);
  for (const url of mob.iconUrls || []) push(url);
  push(mob.iconUrl);
  return {
    ...mob,
    name: mon?.name || mob.name,
    iconUrl: urls[0] || mob.iconUrl || null,
    iconUrls: urls,
  };
}

async function enrichSnapshot(snapshot) {
  if (!snapshot?.farm) return snapshot;
  return {
    ...snapshot,
    farm: await enrichFarm(snapshot.farm),
  };
}

const KIND_TO_ITEM_TYPE = {
  material: 0,
  consumable: 1,
  equipment: 2,
  artifact: 3,
  card: 4,
  gem: 5,
  cosmetic: 6,
};

function uniqueCatalogEntries(catalog) {
  const seen = new Set();
  const out = [];
  for (const entry of catalog?.items?.values?.() || []) {
    const key = `${entry.kind || ""}::${entry.itemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  out.sort((a, b) =>
    String(a.displayName || "").localeCompare(String(b.displayName || "")),
  );
  return out;
}

function formatCatalogHit(entry) {
  return {
    itemType: KIND_TO_ITEM_TYPE[entry.kind] ?? 2,
    itemId: entry.itemId,
    displayName: entry.displayName,
    kind: entry.kind,
    rarity: entry.rarity,
    color: entry.color,
    iconUrl: entry.iconUrl,
    iconUrls: entry.iconUrls,
    stats: entry.stats || [],
    tip: entry.tip || null,
    description: entry.description,
    slug: entry.slug,
    searchText: `${entry.displayName || ""} ${entry.itemId || ""} ${entry.kind || ""} ${(entry.stats || []).join(" ")}`.toLowerCase(),
  };
}

async function listCatalogItems(options = {}) {
  const catalog = await loadCatalog(Boolean(options.force));
  let entries = uniqueCatalogEntries(catalog);
  const kinds = Array.isArray(options.kinds)
    ? options.kinds.map((k) => String(k).toLowerCase())
    : null;
  if (kinds?.length) {
    const set = new Set(kinds);
    entries = entries.filter((e) => set.has(String(e.kind || "").toLowerCase()));
  }
  return entries.map(formatCatalogHit);
}

async function searchCatalog(query, options = {}) {
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 80));
  const entries = await listCatalogItems(options);
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) {
    return entries.slice(0, limit);
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const item of entries) {
    let score = 0;
    const hay = item.searchText || "";
    const name = String(item.displayName || "").toLowerCase();
    const id = String(item.itemId || "").toLowerCase();
    if (hay.includes(q)) score += 50;
    if (name.startsWith(q)) score += 40;
    if (id.startsWith(q)) score += 30;
    let all = true;
    for (const token of tokens) {
      if (!hay.includes(token)) {
        all = false;
        break;
      }
      score += 8;
    }
    if (!all && score < 50) continue;
    if (score > 0 || all) scored.push({ item, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      String(a.item.displayName || "").localeCompare(String(b.item.displayName || "")),
  );
  return scored.slice(0, limit).map((row) => row.item);
}

async function getItemSources(itemId, displayName) {
  await loadCatalog(false);
  const meta = lookup(itemId, displayName);
  const sources = sourcesFor(itemId, displayName || meta?.displayName);
  const best = sources[0] || null;
  return {
    displayName: meta?.displayName || displayName || itemId,
    itemId: meta?.itemId || itemId,
    kind: meta?.kind || null,
    sourceCount: sources.length,
    best,
    sources: sources.slice(0, 12),
    mapUrl: best?.mapUrl || null,
  };
}

/** Preferred secondary rolls by class for overlay “substats meta”. */
const CLASS_SUBSTAT_FOCUS = [
  {
    className: "Warrior",
    want: ["Atk", "AtkMult", "Str", "Crit", "CritDamage", "Hit", "DamageMelee", "AtkSpd", "HpMult", "Vit"],
  },
  {
    className: "Berserker",
    want: ["Atk", "AtkMult", "Str", "Crit", "CritDamage", "AtkSpd", "DoubleAttack", "DamageMelee", "HpMult"],
  },
  {
    className: "Knight",
    want: ["Atk", "AtkMult", "Str", "Vit", "HpMult", "Def", "DefMult", "Hit", "DamageMelee"],
  },
  {
    className: "Paladin",
    want: ["Atk", "AtkMult", "Vit", "HpMult", "Def", "DefMult", "Mdef", "HealingReceived", "Str"],
  },
  {
    className: "Mage",
    want: ["Matk", "MatkMult", "Int", "CastSpd", "DamageMagic", "MpMult", "SkillDamage", "Crit"],
  },
  {
    className: "Wizard",
    want: ["Matk", "MatkMult", "Int", "CastSpd", "DamageMagic", "MpMult", "SkillDamage", "CritDamage"],
  },
  {
    className: "Weaver",
    want: ["Matk", "MatkMult", "Int", "CastSpd", "DamageMagic", "MpMult", "SkillDamage", "CooldownRecovery"],
  },
  {
    className: "Necromancer",
    want: ["Matk", "MatkMult", "Int", "CastSpd", "DamageMagic", "MpMult", "HpMult", "SkillDamage"],
  },
  {
    className: "Scout",
    want: ["Atk", "AtkMult", "Dex", "Crit", "CritDamage", "Hit", "DamageRanged", "AtkSpd", "Agi"],
  },
  {
    className: "Gunslinger",
    want: ["Atk", "AtkMult", "Dex", "Crit", "CritDamage", "Hit", "DamageRanged", "AtkSpd", "DoubleAttack"],
  },
  {
    className: "Rogue",
    want: ["Atk", "AtkMult", "Agi", "Crit", "CritDamage", "AtkSpd", "Flee", "DoubleAttack", "PerfectDodge"],
  },
  {
    className: "Shinobi",
    want: ["Atk", "AtkMult", "Agi", "Crit", "CritDamage", "AtkSpd", "Flee", "DoubleAttack", "PerfectDodge"],
  },
  {
    className: "Acolyte",
    want: ["Int", "Vit", "CastSpd", "MpMult", "HpMult", "HealingReceived", "Mdef", "MdefMult", "Matk"],
  },
  {
    className: "Priest",
    want: ["Int", "Vit", "CastSpd", "MpMult", "HpMult", "HealingReceived", "Mdef", "MdefMult", "CooldownRecovery"],
  },
  {
    className: "Summoner",
    want: ["Matk", "MatkMult", "Int", "CastSpd", "MpMult", "DamageMagic", "HpMult", "SkillDamage"],
  },
];

function expandSubstatPoolRanges(poolName) {
  if (!cache?.substatPools || !poolName) return [];
  const pool = cache.substatPools[poolName];
  if (!Array.isArray(pool)) return [];
  const out = [];
  const seen = new Set();
  // Primaries always roll on gear pools.
  for (const attr of PRIMARY_ATTRS) {
    const range = poolRangeFor(poolName, attr) || { min: 2, max: 3 };
    out.push({
      stat: attr,
      label: STAT_LABELS[attr] || attr,
      min: range.min,
      max: range.max,
      percent: false,
    });
    seen.add(attr);
  }
  for (const group of pool) {
    for (const opt of group || []) {
      const stat = String(opt.stat || "");
      if (!stat || seen.has(stat)) continue;
      seen.add(stat);
      const range = poolRangeFor(poolName, stat) || rangeFromMax(Number(opt.value));
      if (!range) continue;
      out.push({
        stat,
        label: STAT_LABELS[stat] || spaceName(stat) || stat,
        min: range.min,
        max: range.max,
        percent: isPercentStat(stat),
      });
    }
  }
  return out;
}

function classSubstatMeta(poolName, poolRows) {
  const rows = Array.isArray(poolRows) ? poolRows : expandSubstatPoolRanges(poolName);
  if (!rows.length) return [];
  const byStat = new Map(rows.map((row) => [row.stat, row]));
  return CLASS_SUBSTAT_FOCUS.map((entry) => {
    const picks = [];
    for (const want of entry.want) {
      const hit = byStat.get(want);
      if (hit) picks.push(hit);
      if (picks.length >= 5) break;
    }
    return {
      className: entry.className,
      stats: picks.map((row) => ({
        label: row.label,
        range: `${row.min}~${row.max}${row.percent ? "%" : ""}`,
        stat: row.stat,
      })),
    };
  }).filter((row) => row.stats.length > 0);
}

async function getItemTip(itemId, displayName) {
  await loadCatalog(false);
  const meta = lookup(itemId, displayName);
  if (!meta) {
    return {
      displayName: displayName || itemId || "Item",
      itemId: itemId || null,
      kind: null,
      rarity: null,
      description: null,
      stats: [],
      iconUrl: null,
      iconUrls: [],
      substatPool: null,
      substatRanges: [],
      classMeta: [],
    };
  }
  const poolName = meta.substatPool || meta.tip?.substatPool || null;
  const substatRanges = expandSubstatPoolRanges(poolName);
  return {
    displayName: meta.displayName,
    itemId: meta.itemId,
    kind: meta.kind,
    rarity: meta.rarity,
    description: meta.description || null,
    stats: meta.stats || meta.tip?.lines || [],
    tip: meta.tip || null,
    iconUrl: meta.iconUrl || null,
    iconUrls: meta.iconUrls || [],
    substatPool: poolName,
    substatRanges,
    classMeta: classSubstatMeta(poolName, substatRanges),
  };
}

module.exports = {
  RARITY_COLORS,
  KIND_TO_ITEM_TYPE,
  loadCatalog,
  listCatalogItems,
  searchCatalog,
  getItemTip,
  getItemSources,
  enrichDrop,
  enrichFarm,
  enrichSnapshot,
  iconUrlFor,
  rarityKey,
  toSlug,
};
