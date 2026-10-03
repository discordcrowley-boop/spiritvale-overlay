const segmentsEl = document.getElementById("segments");
const elapsedEl = document.getElementById("elapsed");

const DEFAULT_INCLUDE = {
  "spiritist-meter": true,
  "loot-meter": true,
  "kill-counter": true,
  "exp-meter": true,
  "pets-meter": false,
};

const DEFAULT_DISPLAY = {
  "spiritist-meter": { dps: true },
  "loot-meter": { earned: true, goldPerHour: true, inventory: false },
  "kill-counter": { kills: true },
  "exp-meter": { xpPerHour: true, ttl: true, jobTtl: true, percent: true },
  "pets-meter": { count: true, lowest: true },
};

const SECTIONS = [
  {
    id: "spiritist-meter",
    title: "Meters!",
    fields: [{ key: "dps", label: "DPS", kind: "main" }],
  },
  {
    id: "loot-meter",
    title: "Gold!",
    fields: [
      { key: "earned", label: "Earned", kind: "main" },
      { key: "goldPerHour", label: "Gold/hr", kind: "secondary" },
      { key: "inventory", label: "Inventory", kind: "secondary" },
    ],
  },
  {
    id: "kill-counter",
    title: "Kills!",
    fields: [{ key: "kills", label: "Kills", kind: "main" }],
  },
  {
    id: "exp-meter",
    title: "Exp!",
    fields: [
      { key: "xpPerHour", label: "XP/hr", kind: "main" },
      { key: "ttl", label: "TTL", kind: "secondary" },
      { key: "jobTtl", label: "Job TTL", kind: "secondary" },
      { key: "percent", label: "Level %", kind: "secondary" },
    ],
  },
  {
    id: "pets-meter",
    title: "Pets!",
    fields: [
      { key: "count", label: "Active", kind: "main" },
      { key: "lowest", label: "Lowest %", kind: "secondary" },
    ],
  },
];

let includeMap = { ...DEFAULT_INCLUDE };
let displayMap = {
  "spiritist-meter": { ...DEFAULT_DISPLAY["spiritist-meter"] },
  "loot-meter": { ...DEFAULT_DISPLAY["loot-meter"] },
  "kill-counter": { ...DEFAULT_DISPLAY["kill-counter"] },
  "exp-meter": { ...DEFAULT_DISPLAY["exp-meter"] },
  "pets-meter": { ...DEFAULT_DISPLAY["pets-meter"] },
};
let latestSnap = null;

function money(value) {
  return Math.round(Number(value) || 0).toLocaleString();
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ttlLabel(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const sec = Math.round(n / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

function personalDps(snapshot) {
  const actors = snapshot?.actors || [];
  const me = String(snapshot?.capture?.personalName || "").toLowerCase();
  if (!me) return Math.max(0, Number(snapshot?.totals?.totalDps) || 0);
  const mine = actors.find((a) => String(a.name || a.displayName || "").toLowerCase() === me);
  return Math.max(0, Number(mine?.dps ?? mine?.rate ?? snapshot?.totals?.totalDps) || 0);
}

function fieldOn(sectionId, key, fallback = true) {
  const row = displayMap[sectionId] || {};
  return row[key] != null ? Boolean(row[key]) : fallback;
}

function render(snapshot) {
  latestSnap = snapshot || latestSnap;
  const farm = latestSnap?.farm || {};
  elapsedEl.textContent = formatElapsed(farm.elapsedMs);
  const parts = [];

  if (includeMap["spiritist-meter"] !== false) {
    const bits = [];
    if (fieldOn("spiritist-meter", "dps")) {
      bits.push(`<span class="label">DPS</span><span class="value">${money(personalDps(latestSnap))}</span>`);
    }
    if (bits.length) parts.push(`<div class="seg meters">${bits.join("")}</div>`);
  }

  if (includeMap["loot-meter"] !== false) {
    const bits = [];
    if (fieldOn("loot-meter", "earned")) {
      const earned = Math.max(0, Number(farm.gold) || 0);
      bits.push(`<span class="label">Gold</span><span class="value">+${money(earned)}</span>`);
    }
    if (fieldOn("loot-meter", "goldPerHour")) {
      bits.push(`<span class="label">${money(farm.goldPerHour || 0)}/h</span>`);
    }
    if (fieldOn("loot-meter", "inventory")) {
      const wallet =
        farm.inventoryGold != null
          ? money(farm.inventoryGold)
          : farm.walletGold != null
            ? money(farm.walletGold)
            : "—";
      bits.push(`<span class="label">Inv ${wallet}</span>`);
    }
    if (bits.length) parts.push(`<div class="seg gold">${bits.join("")}</div>`);
  }

  if (includeMap["kill-counter"] !== false) {
    const bits = [];
    if (fieldOn("kill-counter", "kills")) {
      bits.push(`<span class="label">Kills</span><span class="value">${money(farm.kills || 0)}</span>`);
    }
    if (bits.length) parts.push(`<div class="seg kills">${bits.join("")}</div>`);
  }

  if (includeMap["exp-meter"] !== false) {
    const baseMaxed = Boolean(farm.baseMaxed) || Number(farm.level) >= 150;
    const jobMaxed = Boolean(farm.jobMaxed) || Number(farm.jobLevel) >= 70;
    const bits = [];
    if (fieldOn("exp-meter", "xpPerHour")) {
      bits.push(
        `<span class="label">XP/h</span><span class="value">${baseMaxed ? "—" : money(farm.xpPerHour || 0)}</span>`,
      );
    }
    if (fieldOn("exp-meter", "ttl")) {
      const ttl = baseMaxed ? "MAX" : ttlLabel(farm.ttlMs);
      bits.push(`<span class="label">TTL ${ttl}</span>`);
    }
    if (fieldOn("exp-meter", "jobTtl")) {
      const jobBit = jobMaxed ? "Job MAX" : farm.jobTtlMs ? `Job ${ttlLabel(farm.jobTtlMs)}` : null;
      if (jobBit) bits.push(`<span class="label">${jobBit}</span>`);
    }
    if (fieldOn("exp-meter", "percent")) {
      const pct =
        farm.xpPercent != null && Number.isFinite(Number(farm.xpPercent))
          ? `${Math.round(Number(farm.xpPercent))}%`
          : "—";
      bits.push(`<span class="label">${pct}</span>`);
    }
    if (bits.length) parts.push(`<div class="seg exp">${bits.join("")}</div>`);
  }

  if (includeMap["pets-meter"] !== false) {
    const pets = Array.isArray(latestSnap?.pets) ? latestSnap.pets : [];
    const bits = [];
    if (fieldOn("pets-meter", "count")) {
      bits.push(`<span class="label">Pets</span><span class="value">${pets.length}</span>`);
    }
    if (fieldOn("pets-meter", "lowest")) {
      const lowest = pets.reduce((best, row) => {
        if (row?.pct == null) return best;
        if (best == null || row.pct < best) return row.pct;
        return best;
      }, null);
      bits.push(
        `<span class="label">${lowest == null ? "—" : `${Math.round(lowest)}%`}</span>`,
      );
    }
    if (bits.length) parts.push(`<div class="seg pets">${bits.join("")}</div>`);
  }

  segmentsEl.innerHTML = parts.join("") || `<div class="seg"><span class="label">No meters docked</span></div>`;
}

function buildSettingsHtml() {
  return `
    <div class="hud-settings-head">One-bar display</div>
    <p class="hud-settings-hint">Pick which trackers appear, and which main / secondary values show in each section.</p>
    ${SECTIONS.map((section) => {
      const shown = includeMap[section.id] !== false;
      const fields = section.fields
        .map((field) => {
          const on = fieldOn(section.id, field.key, field.key !== "inventory");
          return `
            <label class="dock-field ${field.kind}">
              <input type="checkbox" data-dock-field="${section.id}:${field.key}" ${on ? "checked" : ""} ${
                shown ? "" : "disabled"
              } />
              <span>${field.label}<i>${field.kind === "main" ? "main" : "secondary"}</i></span>
            </label>`;
        })
        .join("");
      return `
        <div class="dock-section" data-section="${section.id}">
          <label class="dock-section-head">
            <input type="checkbox" data-dock-include="${section.id}" ${shown ? "checked" : ""} />
            <strong>${section.title}</strong>
          </label>
          <div class="dock-fields">${fields}</div>
        </div>`;
    }).join("")}
  `;
}

async function persistDockDisplay() {
  if (!window.overlayHud?.setHudDock) return;
  await window.overlayHud.setHudDock({
    include: { ...includeMap },
    display: {
      "spiritist-meter": { ...displayMap["spiritist-meter"] },
      "loot-meter": { ...displayMap["loot-meter"] },
      "kill-counter": { ...displayMap["kill-counter"] },
      "exp-meter": { ...displayMap["exp-meter"] },
      "pets-meter": { ...displayMap["pets-meter"] },
    },
  });
}

function applyDockPrefs(prefs = {}) {
  if (prefs.include && typeof prefs.include === "object") {
    includeMap = { ...includeMap, ...prefs.include };
  }
  if (prefs.display && typeof prefs.display === "object") {
    for (const id of Object.keys(DEFAULT_DISPLAY)) {
      displayMap[id] = { ...DEFAULT_DISPLAY[id], ...(prefs.display[id] || {}) };
    }
  }
}

document.getElementById("reset").addEventListener("click", () => {
  window.overlayHud?.resetEncounter?.();
});
document.getElementById("close").addEventListener("click", () => {
  window.overlayHud?.closeMeter?.("dock-bar");
});

if (window.HudChrome) {
  window.HudChrome.mount({
    hudId: "dock-bar",
    resetBtn: document.getElementById("reset"),
    showSettings: true,
    externalSettings: true,
    hideCompact: true,
    openExternalSettings: async (btn) => {
      const rect = btn.getBoundingClientRect();
      const x = Math.round((window.screenX || 0) + rect.left);
      const y = Math.round((window.screenY || 0) + rect.bottom + 4);
      await window.overlayHud?.showDockMenu?.({
        kind: "dock",
        x,
        y,
        html: buildSettingsHtml(),
        include: { ...includeMap },
        display: {
          "spiritist-meter": { ...displayMap["spiritist-meter"] },
          "loot-meter": { ...displayMap["loot-meter"] },
          "kill-counter": { ...displayMap["kill-counter"] },
          "exp-meter": { ...displayMap["exp-meter"] },
        },
      });
    },
  });
}

async function loadDockPrefs() {
  try {
    const prefs = (await window.overlayHud?.getHudDock?.()) || {};
    applyDockPrefs(prefs);
  } catch {
    /* ignore */
  }
}

if (window.overlayHud?.onHudDock) {
  window.overlayHud.onHudDock((payload) => {
    applyDockPrefs(payload || {});
    render(latestSnap);
  });
}

loadDockPrefs().then(() => {
  if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
  if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
});
