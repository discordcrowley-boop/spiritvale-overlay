const subLabel = document.getElementById("subLabel");
const elapsedEl = document.getElementById("elapsed");
const walletGoldEl = document.getElementById("walletGold");
const sessionGoldEl = document.getElementById("sessionGold");
const goldRateEl = document.getElementById("goldRate");

let hudOptions = {
  fontScale: 100,
};
/** Sticky Inventory display — don't flash blank between wallet ticks. */
let lastShownWallet = null;

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

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function render(snapshot) {
  applyScales();
  const farm = snapshot?.farm;
  const personal = snapshot?.capture?.personalName;
  subLabel.textContent = personal ? `${personal} · since reset` : "Inventory · since reset";
  elapsedEl.textContent = formatElapsed(farm?.elapsedMs);

  if (!farm) {
    walletGoldEl.textContent = lastShownWallet != null ? money(lastShownWallet) : "—";
    sessionGoldEl.textContent = "+0";
    goldRateEl.textContent = "0";
    return;
  }

  const wallet = farm.inventoryGold != null ? Number(farm.inventoryGold) : null;
  const earned = Math.max(0, Number(farm.gold) || 0);
  if (wallet != null && Number.isFinite(wallet) && wallet >= 100) lastShownWallet = wallet;
  walletGoldEl.textContent = lastShownWallet != null ? money(lastShownWallet) : "—";
  sessionGoldEl.textContent = `+${money(earned)}`;
  goldRateEl.textContent = money(farm.goldPerHour || 0);
}

document.getElementById("reset").addEventListener("click", () => {
  window.overlayHud?.resetEncounter?.();
});
document.getElementById("close").addEventListener("click", () => {
  window.overlayHud?.closeMeter?.("loot-meter");
});

if (window.HudChrome) {
  window.HudChrome.mount({
    hudId: "loot-meter",
    resetBtn: document.getElementById("reset"),
    defaultOptions: hudOptions,
    renderExtra: (options) => `
      <div class="hud-settings-head">Gold</div>
      <div class="hud-settings-row"><span>Font size</span><b>${Math.round(options.fontScale || 100)}%</b></div>
      <input class="hud-dim-range" type="range" min="70" max="160" data-opt="fontScale" data-opt-type="range" value="${Math.round(
        options.fontScale || 100,
      )}" />
      <p class="hud-settings-hint">Inventory = live bag gold. Earned and Gold/hr are since ↺ (locks on first gold tick).</p>
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
    if (payload?.id && payload.id !== "loot-meter") return;
    document.documentElement.dataset.compact = payload?.enabled || payload?.map?.["loot-meter"] ? "1" : "0";
  });
}
if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
