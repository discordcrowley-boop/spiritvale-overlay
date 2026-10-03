const subLabel = document.getElementById("subLabel");
const killTotalEl = document.getElementById("killTotal");
const killRateEl = document.getElementById("killRate");
const killListEl = document.getElementById("killList");

let hudOptions = {
  fontScale: 100,
};

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Number(n) || lo));
}

function applyScales() {
  const font = clamp(hudOptions.fontScale, 70, 160) / 100;
  document.documentElement.style.setProperty("--font-scale", String(font));
}

function money(value) {
  return Math.round(Number(value) || 0).toLocaleString();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function monsterSlug(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function monsterIconUrls(row) {
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  for (const url of row.iconUrls || []) push(url);
  push(row.iconUrl);
  for (const label of [row.id, row.name, row.displayName]) {
    const slug = monsterSlug(label);
    if (slug) push(`https://spiritvalers.com/wiki-data/monster-icons/${slug}.webp`);
  }
  return urls;
}

function isPlaceholderName(name) {
  return !name || /^actor\s+-?\d+$/i.test(String(name).trim());
}

function collectMobs(snapshot) {
  const farm = snapshot?.farm || {};
  const byKey = new Map();

  const push = (mob) => {
    if (!mob) return;
    const name = mob.name || mob.displayName || "";
    if (isPlaceholderName(name)) return;
    const key = String(mob.id || name);
    if (!key) return;
    const kills = Number(mob.kills) || 0;
    if (kills <= 0) return;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { ...mob, name, kills });
      return;
    }
    cur.kills = Math.max(cur.kills, kills);
    cur.iconUrl = cur.iconUrl || mob.iconUrl;
    if (!cur.iconUrls?.length && mob.iconUrls?.length) cur.iconUrls = mob.iconUrls;
  };

  for (const mob of farm.mobs || []) push(mob);

  // Fallback: flatten from party killers if farm.mobs is empty.
  if (!byKey.size) {
    for (const killer of farm.killers || []) {
      for (const mob of killer.mobs || []) push(mob);
    }
  }

  return [...byKey.values()].sort((a, b) => (b.kills || 0) - (a.kills || 0));
}

function render(snapshot) {
  applyScales();
  const farm = snapshot?.farm;
  const personal = snapshot?.capture?.personalName;
  subLabel.textContent = personal ? `${personal} · since reset` : "Session · since reset";

  const mobs = collectMobs(snapshot);
  const totalFromMobs = mobs.reduce((sum, row) => sum + (Number(row.kills) || 0), 0);
  const total = Math.max(Number(farm?.kills) || 0, totalFromMobs);
  const elapsedMs = Number(farm?.elapsedMs) || Number(snapshot?.elapsedMs) || 0;
  const hours = Math.max(1 / 3600, elapsedMs / 3_600_000);
  const rate = Math.round(total / hours);

  killTotalEl.textContent = money(total);
  killRateEl.textContent = money(rate);

  if (!mobs.length) {
    killListEl.innerHTML = `<p class="empty">No kills yet — damage a mob until it dies.</p>`;
    return;
  }

  killListEl.innerHTML = mobs
    .slice(0, 40)
    .map((mob) => {
      const icons = monsterIconUrls(mob);
      const iconHtml = icons.length
        ? `<img class="kill-icon" src="${escapeHtml(icons[0])}" alt="" data-name="${escapeHtml(
            mob.name || "?",
          )}" data-fallbacks="${escapeHtml(icons.slice(1).join("|"))}" />`
        : `<div class="kill-icon missing">${escapeHtml(String(mob.name || "?").slice(0, 1))}</div>`;
      return `
      <article class="kill-row">
        ${iconHtml}
        <div class="kill-name" title="${escapeHtml(mob.name || "Monster")}">${escapeHtml(
          mob.name || "Monster",
        )}</div>
        <div class="kill-count">${money(mob.kills || 0)}</div>
      </article>`;
    })
    .join("");

  killListEl.querySelectorAll("img.kill-icon").forEach((img) => {
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
      const fallback = document.createElement("div");
      fallback.className = "kill-icon missing";
      fallback.textContent = String(img.dataset.name || "?").slice(0, 1) || "?";
      img.replaceWith(fallback);
    });
  });
}

document.getElementById("reset").addEventListener("click", () => {
  window.overlayHud?.resetEncounter?.();
});
document.getElementById("close").addEventListener("click", () => {
  window.overlayHud?.closeMeter?.("kill-counter");
});

if (window.HudChrome) {
  window.HudChrome.mount({
    hudId: "kill-counter",
    resetBtn: document.getElementById("reset"),
    defaultOptions: hudOptions,
    renderExtra: (options) => `
      <div class="hud-settings-head">Kills</div>
      <div class="hud-settings-row"><span>Font size</span><b>${Math.round(options.fontScale || 100)}%</b></div>
      <input class="hud-dim-range" type="range" min="70" max="160" data-opt="fontScale" data-opt-type="range" value="${Math.round(
        options.fontScale || 100,
      )}" />
      <p class="hud-settings-hint">Totals are since ↺. Per-monster rows use live capture kill credits.</p>
    `,
    onOptions: (options) => {
      hudOptions = { ...hudOptions, ...options };
      applyScales();
      const panel = document.getElementById("hudSettingsPanel");
      if (!panel || panel.hidden) return;
      for (const row of panel.querySelectorAll(".hud-settings-row")) {
        const text = row.querySelector("span")?.textContent || "";
        const value = row.querySelector("b");
        if (!value) continue;
        if (text === "Font size") value.textContent = `${Math.round(hudOptions.fontScale || 100)}%`;
      }
    },
  });
}

applyScales();
if (window.overlayHud?.onHudCompact) {
  window.overlayHud.onHudCompact((payload) => {
    if (payload?.id && payload.id !== "kill-counter") return;
    document.documentElement.dataset.compact =
      payload?.enabled || payload?.map?.["kill-counter"] ? "1" : "0";
  });
}
if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
