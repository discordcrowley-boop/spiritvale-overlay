const rowsEl = document.getElementById("rows");
const tabsEl = document.getElementById("tabs");
const subLabel = document.getElementById("subLabel");
const instanceLabel = document.getElementById("instanceLabel");
const partyRate = document.getElementById("partyRate");
const partyMeta = document.getElementById("partyMeta");
const bossBtn = document.getElementById("bossOnly");

const BOSS_MODE = {
  id: "boss",
  valueKey: "bossDps",
  amountKey: "bossDamage",
  skillsKey: "bossSkills",
  totalRate: null,
  totalAmount: null,
  rateSuffix: "DPS",
  amountLabel: "BOSS DAMAGE",
};

const MODES = [
  {
    id: "dps",
    valueKey: "dps",
    amountKey: "damage",
    skillsKey: "skills",
    totalRate: "totalDps",
    totalAmount: "totalDamage",
    rateSuffix: "DPS",
    amountLabel: "TOTAL DAMAGE",
  },
  {
    id: "hps",
    valueKey: "hps",
    amountKey: "healing",
    skillsKey: "healingSkills",
    totalRate: "totalHps",
    totalAmount: "totalHealing",
    rateSuffix: "HPS",
    amountLabel: "TOTAL HEALING",
  },
  {
    id: "taken",
    valueKey: "takenDps",
    amountKey: "taken",
    skillsKey: "takenSkills",
    totalRate: null,
    totalAmount: "totalTaken",
    rateSuffix: "TPS",
    amountLabel: "TOTAL TAKEN",
  },
];

const CLASS_COLORS = {
  default: "#8b919a",
};

let modeIndex = 0;
let latest = null;
let hudOptions = {
  fontScale: 100,
  iconScale: 100,
  compactMode: false,
  bossOnly: false,
};
let chromeState = null;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Number(n) || lo));
}

function applyScales() {
  const font = clamp(hudOptions.fontScale, 70, 160) / 100;
  const icon = clamp(hudOptions.iconScale, 70, 160) / 100;
  document.documentElement.style.setProperty("--font-scale", String(font));
  document.documentElement.style.setProperty("--icon-scale", String(icon));
}

function compact(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(Math.round(n));
}

function whole(value) {
  return String(Math.round(Number(value) || 0));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function classColor(actor) {
  return actor.color || CLASS_COLORS.default;
}

function displayName(actor, snapshot) {
  return playerName(actor, snapshot);
}

function playerName(actor, snapshot) {
  const name = String(actor?.name || "").trim();
  if (
    name &&
    !isPlaceholderActor(actor) &&
    !/^(player|unknown|resolving\.+|unidentified)/i.test(name)
  ) {
    return name;
  }
  const personal = String(snapshot?.capture?.personalName || "").trim();
  if (personal) return personal;
  return "Player";
}

function isPlaceholderActor(actor) {
  return /^actor\s+-?\d+$/i.test(String(actor?.name || "").trim()) ||
    /^unidentified/i.test(String(actor?.name || "").trim()) ||
    /^resolving/i.test(String(actor?.name || "").trim());
}

function actorRate(actor, mode, elapsedSec) {
  const amount = actor?.[mode.amountKey] || 0;
  return actor?.[mode.valueKey] || amount / Math.max(0.001, elapsedSec || 1);
}

function myActor(snapshot, actors) {
  const mine = String(snapshot?.capture?.personalName || "").trim().toLowerCase();
  if (!mine) return null;
  return (
    actors.find((actor) => String(actor.name || "").trim().toLowerCase() === mine) || null
  );
}

function humanizeSkill(value) {
  const raw = String(value || "Ability");
  if (/\s/.test(raw)) return raw;
  return raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
}

function skillsFor(actor, mode) {
  const list = actor?.[mode.skillsKey];
  if (Array.isArray(list) && list.length) return list;
  if (mode.id === "dps" && Array.isArray(actor?.skills)) return actor.skills;
  return [];
}

function skillIcon(skill) {
  const urls = [...(skill.iconUrls || [])];
  if (skill.iconUrl && !urls.includes(skill.iconUrl)) urls.unshift(skill.iconUrl);
  const label = humanizeSkill(skill.name || skill.id || "?");
  if (!urls.length) {
    return `<span class="skill-icon missing">${escapeHtml(label.slice(0, 1))}</span>`;
  }
  return `<img class="skill-icon" src="${escapeHtml(urls[0])}" alt="" data-name="${escapeHtml(
    label,
  )}" data-fallbacks="${escapeHtml(urls.slice(1).join("|"))}" />`;
}

function towerLine(snapshot) {
  const tower = snapshot?.tower || {};
  if (tower.floor != null || tower.inTower) {
    const name = String(tower.towerName || "Tower").trim().toUpperCase();
    return tower.floor != null ? `${name} · FLOOR ${tower.floor}` : name;
  }
  if (snapshot?.running) return snapshot.mode === "demo" ? "Demo combat" : "Live combat";
  return "Waiting for combat";
}

function instanceText(snapshot) {
  const id = snapshot?.tower?.instanceId;
  if (id == null || id === "") return "";
  return `INSTANCE: ${id}`;
}

function bindBrokenIcons(root) {
  root.querySelectorAll("img.skill-icon").forEach((img) => {
    img.addEventListener("error", () => {
      const fallbacks = String(img.dataset.fallbacks || "")
        .split("|")
        .map((url) => url.trim())
        .filter(Boolean);
      if (fallbacks.length) {
        img.dataset.fallbacks = fallbacks.slice(1).join("|");
        img.src = fallbacks[0];
        return;
      }
      const fallback = document.createElement("span");
      fallback.className = "skill-icon missing";
      fallback.textContent = String(img.dataset.name || img.getAttribute("title") || "?").slice(0, 1);
      img.replaceWith(fallback);
    });
  });
}

function syncBossButton(bossView) {
  if (!bossBtn) return;
  bossBtn.hidden = MODES[modeIndex].id !== "dps";
  bossBtn.classList.toggle("on", bossView);
  bossBtn.setAttribute("aria-pressed", String(bossView));
  bossBtn.title = bossView
    ? "Boss only is ON: showing damage dealt to bosses. Click for all damage."
    : "Boss only: count damage dealt to bosses";
}

function render(snapshot) {
  latest = snapshot || latest;
  applyScales();
  const bossView = MODES[modeIndex].id === "dps" && Boolean(hudOptions.bossOnly);
  syncBossButton(bossView);
  const mode = bossView ? BOSS_MODE : MODES[modeIndex];
  tabsEl.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", Number(tab.dataset.mode) === modeIndex);
  });

  const snap = latest || {};
  const compactMode = Boolean(hudOptions.compactMode);
  document.getElementById("meter")?.classList.toggle("compact", compactMode);
  const packets = Number(snap?.capture?.stats?.packets) || 0;
  const damageEvents = Number(snap?.capture?.stats?.damageEvents) || 0;
  if (!snap.running) {
    subLabel.textContent = "Overlay idle — Start Overlay to capture";
  } else if (packets === 0) {
    subLabel.textContent = "Listening… open SpiritVale / enter the world";
  } else if (damageEvents === 0) {
    subLabel.textContent = "Waiting for combat";
  } else {
    subLabel.textContent = `${towerLine(snap)} · session since reset`;
  }
  instanceLabel.textContent = instanceText(snap);

  const boss = snap.bossMeter || {};
  const elapsedSec = bossView ? Number(boss.elapsedSec) || 0 : snap.elapsedSec || 0;
  const elapsed = Math.max(0, Math.round(elapsedSec));
  const sessionTag = bossView
    ? `BOSS${boss.targets?.length ? `: ${boss.targets.join(", ").toUpperCase()}` : ""}`
    : "SESSION";
  let totalAmount = bossView ? Number(boss.totalDamage) || 0 : snap[mode.totalAmount] || 0;

  const actors = [...(snap.actors || [])]
    .filter((actor) => (actor[mode.amountKey] || 0) > 0)
    .map((actor) => ({
      ...actor,
      name:
        !actor?.name || /^actor\s+-?\d+$/i.test(String(actor.name).trim())
          ? "Resolving…"
          : actor.name,
    }))
    .sort((a, b) => (b[mode.amountKey] || 0) - (a[mode.amountKey] || 0));
  if (!totalAmount) totalAmount = actors.reduce((sum, row) => sum + (row[mode.amountKey] || 0), 0);
  const me = myActor(snap, actors);
  const myRate = me ? actorRate(me, mode, elapsedSec) : 0;
  const myAmount = me ? me[mode.amountKey] || 0 : totalAmount;
  const partyTotalRate = bossView
    ? Number(boss.totalDps) || 0
    : mode.totalRate != null
      ? snap[mode.totalRate] || totalAmount / Math.max(0.001, elapsedSec || 1)
      : totalAmount / Math.max(0.001, elapsedSec || 1);

  // Main number = cumulative total; secondary = per-second (always visible).
  const headerAmount = whole(me ? myAmount : totalAmount);
  const headerRate = compact(me ? myRate : partyTotalRate);
  partyRate.innerHTML = `<span class="party-total">${escapeHtml(headerAmount)}</span><span class="party-per-sec">${escapeHtml(
    headerRate,
  )}/s</span>`;
  partyMeta.textContent = `TIME ${elapsed}s · ${sessionTag}`;

  if (!actors.length) {
    partyRate.innerHTML = `<span class="party-total">0</span><span class="party-per-sec">0/s</span>`;
    partyMeta.textContent = `TIME 0s · ${sessionTag}`;
    rowsEl.innerHTML = bossView
      ? `<div class="empty">No boss damage yet. Hit a boss to start.</div>`
      : `<div class="empty">Waiting for combat…</div>`;
    return;
  }

  const topAmount = actors[0]?.[mode.amountKey] || 1;
  rowsEl.innerHTML = actors
    .map((actor, index) => {
      const color = classColor(actor);
      const amount = actor[mode.amountKey] || 0;
      const rate = actorRate(actor, mode, elapsedSec);
      const share = Math.max(8, Math.round((amount / topAmount) * 100));
      const name = playerName(actor, snap);
      const skills = compactMode
        ? []
        : skillsFor(actor, mode)
            .slice()
            .sort((a, b) => (b.damage || b.amount || 0) - (a.damage || a.amount || 0));
      const skillHtml = skills
        .map((skill) => {
          const skillAmt = skill.damage || skill.amount || 0;
          const label = humanizeSkill(skill.name || skill.id || "Ability");
          return `
            <div class="skill" title="${escapeHtml(label)}">
              ${skillIcon(skill)}
              <span class="skill-name">${escapeHtml(label)}</span>
              <span class="skill-amt">${compact(skillAmt)}</span>
            </div>`;
        })
        .join("");
      return `
        <article class="actor">
          <div class="actor-bar">
            <div class="actor-fill" style="width:${share}%;background-color:${escapeHtml(color)}"></div>
            <div class="actor-head">
              <div class="actor-identity">
                <span class="actor-label">
                  <span class="rank">${index + 1}.</span>
                  <span class="actor-name">${escapeHtml(name)}</span>
                </span>
              </div>
              <div class="actor-rate-block">
                <span class="actor-rate">${compact(amount)}</span>
                <span class="actor-rate-sub">${compact(rate)}/s</span>
              </div>
            </div>
          </div>
          ${skillHtml ? `<div class="skills">${skillHtml}</div>` : ""}
        </article>`;
    })
    .join("");

  bindBrokenIcons(rowsEl);
}

tabsEl.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-mode]");
  if (!tab) return;
  modeIndex = Number(tab.dataset.mode) || 0;
  render(latest);
});

bossBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  hudOptions = { ...hudOptions, bossOnly: !hudOptions.bossOnly };
  const options = { ...(chromeState?.options || {}), bossOnly: hudOptions.bossOnly };
  if (chromeState) chromeState.options = options;
  window.overlayHud?.saveHudPrefs?.("spiritist-meter", { options });
  render(latest);
});

document.getElementById("reset").addEventListener("click", () => {
  window.overlayHud?.resetEncounter?.();
});
document.getElementById("close").addEventListener("click", () => {
  window.overlayHud?.closeMeter?.("spiritist-meter");
});

if (window.HudChrome) {
  Promise.resolve(window.HudChrome.mount({
    hudId: "spiritist-meter",
    resetBtn: document.getElementById("reset"),
    defaultOptions: hudOptions,
    renderExtra: (options) => `
      <div class="hud-settings-head">Meter</div>
      <div class="hud-settings-row"><span>Font size</span><b>${Math.round(options.fontScale || 100)}%</b></div>
      <input class="hud-dim-range" type="range" min="70" max="160" data-opt="fontScale" data-opt-type="range" value="${Math.round(
        options.fontScale || 100,
      )}" />
      <div class="hud-settings-row"><span>Icon size</span><b>${Math.round(options.iconScale || 100)}%</b></div>
      <input class="hud-dim-range" type="range" min="70" max="160" data-opt="iconScale" data-opt-type="range" value="${Math.round(
        options.iconScale || 100,
      )}" />
      <div class="hud-settings-row">
        <span>Compact rows</span>
        <label class="hud-toggle">
          <input type="checkbox" data-opt="compactMode" data-opt-type="bool" ${
            options.compactMode ? "checked" : ""
          } />
        </label>
      </div>
      <div class="hud-settings-row">
        <span>Boss only (DPS)</span>
        <label class="hud-toggle">
          <input type="checkbox" data-opt="bossOnly" data-opt-type="bool" ${
            options.bossOnly ? "checked" : ""
          } />
        </label>
      </div>
      <p class="hud-settings-hint">Totals run as one session until Reset. Compact rows keep names and totals only — turn off for skills &amp; stats.</p>
      <p class="hud-settings-hint">Drag any edge or corner to resize. Use Move overlay in the menu to reposition with click-through on.</p>
    `,
    onOptions: (options) => {
      const compactChanged = Boolean(options.compactMode) !== Boolean(hudOptions.compactMode);
      const bossChanged = Boolean(options.bossOnly) !== Boolean(hudOptions.bossOnly);
      hudOptions = { ...hudOptions, ...options };
      applyScales();
      if (compactChanged || bossChanged) render(latest);
      const detailBtn = document.getElementById("hudDetail");
      if (detailBtn) {
        const on = !Boolean(hudOptions.compactMode);
        detailBtn.classList.toggle("on", on);
        detailBtn.title = on ? "Detail on — skills & stats" : "Detail off — bars only";
        detailBtn.setAttribute("aria-pressed", on ? "true" : "false");
      }
      const panel = document.getElementById("hudSettingsPanel");
      if (!panel || panel.hidden) return;
      for (const row of panel.querySelectorAll(".hud-settings-row")) {
        const text = row.querySelector("span")?.textContent || "";
        const value = row.querySelector("b");
        if (!value) continue;
        if (text === "Font size") value.textContent = `${Math.round(hudOptions.fontScale || 100)}%`;
        if (text === "Icon size") value.textContent = `${Math.round(hudOptions.iconScale || 100)}%`;
      }
    },
  }))
    .then((state) => {
      chromeState = state || null;
    })
    .catch(() => {});
}

applyScales();
if (window.overlayHud?.onHudCompact) {
  window.overlayHud.onHudCompact((payload) => {
    if (payload?.id && payload.id !== "spiritist-meter") return;
    document.documentElement.dataset.compact =
      payload?.enabled || payload?.map?.["spiritist-meter"] ? "1" : "0";
  });
}
if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
