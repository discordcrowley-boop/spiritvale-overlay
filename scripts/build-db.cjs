"use strict";

// Dev-only: pulls wiki data + local seeds into the sealed electron/data/core.db.
// Not shipped in the installer.

const fs = require("fs");
const path = require("path");
const { seal, open } = require("../electron/capture/data-store.cjs");

const WIKI = "https://spiritvalers.com";
const REMOTE = {
  drops: "/wiki-data/drops.json",
  monsters: "/wiki-data/monsters.json",
  maps: "/wiki-data/maps.json",
  materials: "/wiki-data/materials.json",
  statTypes: "/wiki-data/stat-types.json",
  skills: "/wiki-data/skills.json",
  classes: "/wiki-data/classes.json",
  consumables: "/wiki-data/consumables.json",
  statuses: "/wiki-data/statuses.json",
  pets: "/wiki-data/pets.json",
  npcs: "/wiki-data/npcs.json",
  quests: "/wiki-data/quests.json",
  equips: "/equip-configs.json",
  cards: "/card-configs.json",
  gems: "/gem-configs.json",
  consumableConfigs: "/consumable-configs.json",
  skillConfigs: "/skill-configs.json",
  substatPools: "/substat-pools.json",
};
const REQUIRED = ["drops", "monsters", "maps", "materials", "statTypes", "skills", "equips", "cards", "gems", "substatPools"];
const SEEDS = {
  iconIndex: "icon-index.json",
  skillClassMap: "skill-class-map.json",
  skillTipIndex: "skill-tip-index.json",
  skeletonNames: "skeleton-names.json",
  extraMonsters: "extra-monsters.json",
};

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (/^\s*</.test(text)) throw new Error("HTML response");
  return JSON.parse(text);
}

(async () => {
  const datasets = {};
  const report = [];
  for (const [name, route] of Object.entries(REMOTE)) {
    try {
      datasets[name] = await getJson(`${WIKI}${route}`);
      const size = Array.isArray(datasets[name]) ? datasets[name].length : Object.keys(datasets[name] || {}).length;
      report.push(`ok   ${name.padEnd(18)} ${size}`);
    } catch (err) {
      report.push(`skip ${name.padEnd(18)} ${err.message}`);
      if (REQUIRED.includes(name)) {
        console.error(report.join("\n"));
        throw new Error(`Required dataset ${name} failed`);
      }
    }
  }
  const seedDir = path.join(__dirname, "..", "seed");
  for (const [name, file] of Object.entries(SEEDS)) {
    datasets[name] = JSON.parse(fs.readFileSync(path.join(seedDir, file), "utf8"));
    report.push(`seed ${name}`);
  }
  const out = path.join(__dirname, "..", "electron", "data", "core.db");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const sealed = seal({ v: 1, datasets });
  fs.writeFileSync(out, sealed);
  const check = open(fs.readFileSync(out));
  console.log(report.join("\n"));
  console.log(`wrote ${out} (${sealed.length} bytes, ${Object.keys(check.datasets).length} datasets)`);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
