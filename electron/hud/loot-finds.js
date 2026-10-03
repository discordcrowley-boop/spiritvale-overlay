const rowsEl = document.getElementById("rows");
const subLabel = document.getElementById("subLabel");
const itemCountEl = document.getElementById("itemCount");
const dropKindsEl = document.getElementById("dropKinds");
const sessionNoteEl = document.getElementById("sessionNote");
const sourceNoteEl = document.getElementById("sourceNote");

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

let hudOptions = {
  fontScale: 100,
  iconScale: 100,
  tipScale: 135,
};

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Number(n) || lo));
}

function applyScales() {
  const font = clamp(hudOptions.fontScale, 70, 160) / 100;
  const icon = clamp(hudOptions.iconScale, 70, 160) / 100;
  const tip = clamp(hudOptions.tipScale, 90, 220) / 100;
  document.documentElement.style.setProperty("--font-scale", String(font));
  document.documentElement.style.setProperty("--icon-scale", String(icon));
  document.documentElement.style.setProperty("--tip-scale", String(tip));
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

function isLootRow(drop) {
  const raw = [drop?.itemId, drop?.name, drop?.displayName].filter(Boolean);
  if (!raw.length) return false;
  const category = String(drop?.category || "").toLowerCase();
  if (category === "cosmetic") return false;
  if (raw.some((value) => /_Transparent$/i.test(String(value)))) return false;
  // Equipment legitimately uses Feet_/Leg_ ids — only treat unknown cosmetic prefixes
  // as wardrobe when the drop is not already categorized as real loot.
  if (
    !["equipment", "artifact", "material", "card", "gem", "consumable", "currency"].includes(
      category,
    ) &&
    raw.some((value) =>
      /^(Hands|Head|Face|Hair|Hat|Feet|Chest|Legs|Body|Back|Mount|Pet|Aura|Wings|Tail)_/i.test(
        String(value),
      ),
    )
  ) {
    return false;
  }
  const keys = raw
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, ""),
    )
    .filter(Boolean);
  if (!keys.length) return false;
  return !keys.some((key) => STAT_NOISE.has(key) || /(atk|matk|def|mdef|hp|mp)mult$/.test(key));
}

function iconTag(drop) {
  const urls = [...(drop.iconUrls || [])];
  if (drop.iconUrl && !urls.includes(drop.iconUrl)) urls.unshift(drop.iconUrl);
  if (!urls.length) {
    const letter = String(drop.name || drop.displayName || "?").slice(0, 1);
    return `<div class="icon missing">${escapeHtml(letter)}</div>`;
  }
  return `<img class="icon" src="${escapeHtml(urls[0])}" alt="" loading="lazy" data-fallbacks="${escapeHtml(
    urls.slice(1).join("|"),
  )}" />`;
}

function tipStatRows(drop) {
  const tip = drop.tip;
  if (tip && (tip.header?.length || tip.base?.length || tip.bonus?.length || drop.rolled?.length)) {
    const blocks = [];
    const pushBlock = (rows, className) => {
      if (!rows?.length) return;
      blocks.push(
        rows
          .map(
            (row) =>
              `<div class="tip-stat ${className || row.tone || ""}"><span>${escapeHtml(
                row.label,
              )}</span><b>${escapeHtml(row.value)}</b></div>`,
          )
          .join(""),
      );
    };
    if (drop.potential != null || tip.potential != null) {
      pushBlock(
        [{ label: "Potential", value: String(drop.potential ?? tip.potential), tone: "potential" }],
        "potential",
      );
    }
    pushBlock(tip.header, "meta");
    pushBlock(tip.base, "base");
    const fixedBonus = (tip.bonus || []).filter((row) => row.label !== "Cards");
    pushBlock(fixedBonus, "bonus");
    pushBlock(drop.rolled || tip.rolled || [], "rolled");
    const cards =
      tip.cardsFilled ||
      (tip.cardSlots != null ? `(${(drop.cards || []).length}/${tip.cardSlots})` : null);
    if (cards) pushBlock([{ label: "Cards", value: cards, tone: "meta" }], "meta");
    return blocks.map((html) => `<div class="tip-stats">${html}</div>`).join("");
  }
  const stats = drop.stats || [];
  if (!stats.length) return `<div class="tip-stat muted">No wiki stats for this item</div>`;
  return `<div class="tip-stats">${stats
    .map((line) => {
      const parts = String(line).split(/:\s*/);
      if (parts.length < 2) return `<div class="tip-stat">${escapeHtml(line)}</div>`;
      const label = parts.shift();
      return `<div class="tip-stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(
        parts.join(": "),
      )}</b></div>`;
    })
    .join("")}</div>`;
}

function dropSourceLabel(drop) {
  const raw = drop.sourceLabel || drop.from || "";
  if (raw === "loot") return "Picked up";
  if (raw === "Party chat" || raw === "Party find") return "Party find";
  if (raw) return raw;
  return [drop.mapName, drop.monster].filter(Boolean).join(" · ") || "Pickup";
}

function tipHtml(drop) {
  const color = drop.color || "#ffffff";
  const slot = drop.slot || drop.tip?.slot || "";
  const market = drop.market;
  const marketLine = market
    ? `<div class="tip-market">Avg market · <b>${money(market.average || market.median)}</b></div>
       <div class="tip-market-sub">(${market.listingCount || 0} listings · low ${money(market.low)})</div>`
    : `<div class="tip-market muted">No market listings observed yet</div>`;
  return `
    <div class="tip-head">
      ${iconTag(drop)}
      <div>
        ${slot ? `<div class="tip-slot">${escapeHtml(slot)}</div>` : ""}
        <div class="tip-name" style="color:${escapeHtml(color)}">${escapeHtml(
          drop.name || drop.displayName,
        )}</div>
      </div>
    </div>
    <div class="tip-meta">${escapeHtml(drop.rarity || "common")} · ${escapeHtml(
      dropSourceLabel(drop),
    )}</div>
    ${drop.description ? `<div class="tip-desc">${escapeHtml(drop.description)}</div>` : ""}
    ${tipStatRows(drop)}
    ${marketLine}
  `;
}

function placeTip(html) {
  if (window.overlayHud?.showLootTip) {
    window.overlayHud.showLootTip(html);
  }
}

function hideTip() {
  if (window.overlayHud?.hideLootTip) {
    window.overlayHud.hideLootTip();
  }
}

function bindBrokenIcons(root) {
  root.querySelectorAll("img.icon").forEach((img) => {
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
      const src = String(img.getAttribute("src") || "");
      if (!img.dataset.slugRetry && /item-([a-z0-9]+s)-/.test(src)) {
        img.dataset.slugRetry = "1";
        img.src = src.replace(/item-([a-z0-9]+s)-/g, (_, part) => `item-${part.slice(0, -1)}-s-`);
        return;
      }
      const fallback = document.createElement("div");
      fallback.className = "icon missing";
      fallback.textContent = "?";
      img.replaceWith(fallback);
    });
  });
}

function bindItemTips(root, drops) {
  root.querySelectorAll(".item").forEach((el) => {
    const drop = drops[Number(el.dataset.index)];
    if (!drop) return;
    el.addEventListener("mouseenter", () => placeTip(tipHtml(drop)));
    el.addEventListener("mouseleave", hideTip);
  });
}

let lastLootSig = "";

function lootListSignature(drops, personal) {
  return `${personal || ""}|${drops
    .map((drop) => {
      const id = drop.itemId || drop.name || drop.displayName || "";
      const hasIcon = drop.iconUrl || (drop.iconUrls && drop.iconUrls.length) ? "1" : "0";
      return `${id}:${drop.count || 1}:${drop.from || drop.sourceLabel || ""}:${hasIcon}`;
    })
    .join(";")}`;
}

function render(snapshot) {
  applyScales();
  const farm = snapshot?.farm;
  const personal = snapshot?.capture?.personalName;
  subLabel.textContent = personal ? `${personal} · pickups + chat` : "Pickups + party chat";
  sessionNoteEl.textContent = "since reset";
  sourceNoteEl.textContent = "pickups + chat";

  if (!farm) {
    lastLootSig = "";
    itemCountEl.textContent = "0";
    dropKindsEl.textContent = "0 kinds";
    rowsEl.innerHTML = `<div class="empty">Pick something up or get a party-chat find — your loot is logged here.</div>`;
    hideTip();
    return;
  }

  const drops = (farm.drops || []).filter(isLootRow);
  const totalPieces = drops.reduce((sum, drop) => sum + (Number(drop.count) || 1), 0);
  itemCountEl.textContent = money(totalPieces);
  dropKindsEl.textContent = `${money(drops.length)} kind${drops.length === 1 ? "" : "s"}`;

  if (!drops.length) {
    lastLootSig = "";
    rowsEl.innerHTML = `<div class="empty">${
      farm.kills
        ? "Kills seen — pick up an item or wait for a chat find."
        : "Pick something up or get a party-chat find — your loot is logged here."
    }</div>`;
    hideTip();
    return;
  }

  const sig = lootListSignature(drops, personal);
  if (sig === lastLootSig) return;
  lastLootSig = sig;

  rowsEl.innerHTML = drops
    .map((drop, index) => {
      const color = drop.color || "#e8eaed";
      const source = dropSourceLabel(drop);
      return `
        <article class="item" data-index="${index}">
          ${iconTag(drop)}
          <div>
            <div class="name" style="color:${escapeHtml(color)}">${escapeHtml(
              drop.name || drop.displayName || drop.itemId || "Item",
            )}</div>
            <div class="source">${escapeHtml(source)}</div>
          </div>
          <div class="count">×${money(drop.count || 1)}</div>
        </article>`;
    })
    .join("");

  bindBrokenIcons(rowsEl);
  bindItemTips(rowsEl, drops);
}

document.getElementById("reset").addEventListener("click", () => {
  lastLootSig = "";
  window.overlayHud?.resetEncounter?.();
});
document.getElementById("close").addEventListener("click", () => {
  hideTip();
  window.overlayHud?.closeMeter?.("loot-finds");
});

if (window.HudChrome) {
  window.HudChrome.mount({
    hudId: "loot-finds",
    resetBtn: document.getElementById("reset"),
    defaultOptions: hudOptions,
    renderExtra: (options) => `
      <div class="hud-settings-head">Loot</div>
      <div class="hud-settings-row"><span>Font size</span><b>${Math.round(options.fontScale || 100)}%</b></div>
      <input class="hud-dim-range" type="range" min="70" max="160" data-opt="fontScale" data-opt-type="range" value="${Math.round(
        options.fontScale || 100,
      )}" />
      <div class="hud-settings-row"><span>Icon size</span><b>${Math.round(options.iconScale || 100)}%</b></div>
      <input class="hud-dim-range" type="range" min="70" max="160" data-opt="iconScale" data-opt-type="range" value="${Math.round(
        options.iconScale || 100,
      )}" />
      <div class="hud-settings-row"><span>Tooltip size</span><b>${Math.round(options.tipScale || 135)}%</b></div>
      <input class="hud-dim-range" type="range" min="90" max="220" data-opt="tipScale" data-opt-type="range" value="${Math.round(
        options.tipScale || 135,
      )}" />
      <p class="hud-settings-hint">Lists your pickups and party-chat finds. Hover an item for stats. Reset with ↺.</p>
    `,
    onOptions: (options) => {
      hudOptions = { ...hudOptions, ...options };
      applyScales();
      if (window.overlayHud?.setTipScale) {
        window.overlayHud.setTipScale(clamp(hudOptions.tipScale, 90, 220) / 100);
      }
      const panel = document.getElementById("hudSettingsPanel");
      if (!panel || panel.hidden) return;
      for (const row of panel.querySelectorAll(".hud-settings-row")) {
        const text = row.querySelector("span")?.textContent || "";
        const value = row.querySelector("b");
        if (!value) continue;
        if (text === "Font size") value.textContent = `${Math.round(hudOptions.fontScale || 100)}%`;
        if (text === "Icon size") value.textContent = `${Math.round(hudOptions.iconScale || 100)}%`;
        if (text === "Tooltip size") value.textContent = `${Math.round(hudOptions.tipScale || 135)}%`;
      }
    },
  });
}

applyScales();
if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
