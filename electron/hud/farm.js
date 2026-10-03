const listEl = document.getElementById("list");
const ratesEl = document.getElementById("rates");
const tipEl = document.getElementById("tip");

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

function isLootRow(drop) {
  const raw = [drop?.itemId, drop?.name, drop?.displayName].filter(Boolean);
  if (!raw.length) return false;
  const category = String(drop?.category || "").toLowerCase();
  if (category === "cosmetic") return false;
  if (raw.some((value) => /_Transparent$/i.test(String(value)))) return false;
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

function fmtTtl(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 48) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH ? `${days}d ${remH}h` : `${days}d`;
}

function iconTag(drop) {
  const urls = [...(drop.iconUrls || [])];
  if (drop.iconUrl && !urls.includes(drop.iconUrl)) urls.unshift(drop.iconUrl);
  if (!urls.length) return `<div class="icon missing">?</div>`;
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
      drop.sourceLabel || "Loot",
    )}</div>
    ${drop.description ? `<div class="tip-desc">${escapeHtml(drop.description)}</div>` : ""}
    ${tipStatRows(drop)}
    ${marketLine}
  `;
}

function placeTip(html) {
  if (window.overlayHud?.showLootTip) {
    window.overlayHud.showLootTip(html);
    return;
  }
  if (!tipEl) return;
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  const main = document.querySelector(".main");
  if (main) main.classList.add("tip-open");
}

function hideTip() {
  if (window.overlayHud?.hideLootTip) {
    window.overlayHud.hideLootTip();
    return;
  }
  if (!tipEl) return;
  tipEl.hidden = true;
  const main = document.querySelector(".main");
  if (main) main.classList.remove("tip-open");
}

function render(snapshot) {
  const farm = snapshot?.farm;
  if (!farm) {
    ratesEl.innerHTML = "";
    listEl.innerHTML = `<div class="empty">No loot yet — keep farming.</div>`;
    hideTip();
    return;
  }

  const inventoryGold =
    farm.inventoryGold != null
      ? farm.inventoryGold
      : farm.walletGold != null
        ? farm.walletGold
        : null;
  const ttlLabel = farm.ttlMs != null ? fmtTtl(farm.ttlMs) : "—";
  const xpPct =
    farm.xpPercent != null && Number.isFinite(Number(farm.xpPercent))
      ? `${Number(farm.xpPercent)}%`
      : "—";
  const levelLabel = farm.level != null ? `Lv ${farm.level}` : "";

  ratesEl.innerHTML = `
    <div class="rate">
      <span>TO LEVEL</span>
      <b>${escapeHtml(ttlLabel)}</b>
      <small>${escapeHtml(xpPct)}${levelLabel ? ` · ${escapeHtml(levelLabel)}` : ""} · ${money(farm.xpPerHour)}/h</small>
    </div>
    <div class="rate">
      <span>JOB/H</span>
      <b>${money(farm.jobXpPerHour)}</b>
      <small>${farm.jobLevel != null ? `Job ${farm.jobLevel}` : "Job XP"}</small>
    </div>
    <div class="rate">
      <span>GOLD</span>
      <b>${inventoryGold != null ? money(inventoryGold) : "—"}</b>
      <small>${money(farm.goldPerHour)}/h</small>
    </div>
  `;

  const bag =
    farm.bagWeight != null && farm.bagWeightMax != null
      ? `${money(farm.bagWeight)} / ${money(farm.bagWeightMax)}`
      : farm.bagWeight != null
        ? money(farm.bagWeight)
        : farm.bagWeightMax != null
          ? `— / ${money(farm.bagWeightMax)}`
          : "—";
  const bagEl = document.getElementById("bagWeight");
  if (bagEl) bagEl.textContent = `Bag weight · ${bag}`;

  const drops = (farm.drops || []).filter(isLootRow);
  if (!drops.length) {
    listEl.innerHTML = `<div class="empty">${
      farm.kills
        ? "Kills seen — pick up an item. Only your loot is logged."
        : "No loot yet — keep farming."
    }</div>`;
    hideTip();
    return;
  }

  listEl.innerHTML = drops
    .map((drop, index) => {
      const color = drop.color || "#ffffff";
      const source =
        drop.sourceLabel ||
        [drop.mapName, drop.monster || drop.from].filter(Boolean).join(" · ") ||
        "Unknown source";
      return `
        <article class="item" data-index="${index}">
          ${iconTag(drop)}
          <div>
            <div class="name" style="color:${escapeHtml(color)}">${escapeHtml(drop.name || drop.displayName)} <span class="count">×${drop.count || 1}</span></div>
            <div class="source">${escapeHtml(source)}</div>
          </div>
        </article>`;
    })
    .join("");

  listEl.querySelectorAll("img.icon").forEach((img) => {
    img.addEventListener("error", () => {
      const fallbacks = String(img.dataset.fallbacks || "")
        .split("|")
        .map((u) => u.trim())
        .filter(Boolean);
      if (fallbacks.length) {
        img.dataset.fallbacks = fallbacks.slice(1).join("|");
        img.src = fallbacks[0];
        return;
      }
      const src = String(img.getAttribute("src") || "");
      // Retry common apostrophe slug mismatch: witchs-whisk → witch-s-whisk
      if (!img.dataset.slugRetry && /item-([a-z0-9]+s)-/.test(src)) {
        img.dataset.slugRetry = "1";
        img.src = src.replace(/item-([a-z0-9]+s)-/g, (_, part) => {
          return `item-${part.slice(0, -1)}-s-`;
        });
        return;
      }
      const fallback = document.createElement("div");
      fallback.className = "icon missing";
      fallback.textContent = "?";
      img.replaceWith(fallback);
    });
  });

  listEl.querySelectorAll(".item").forEach((el) => {
    const drop = drops[Number(el.dataset.index)];
    if (!drop) return;
    el.addEventListener("mouseenter", () => {
      const html = tipHtml(drop);
      placeTip(html);
    });
    el.addEventListener("mouseleave", hideTip);
  });
}

document.getElementById("reset").addEventListener("click", () => {
  window.overlayHud?.resetEncounter?.();
});
document.getElementById("close").addEventListener("click", () => {
  window.overlayHud?.closeMeter?.("farm");
});

if (window.HudChrome) {
  window.HudChrome.mount({
    hudId: "farm",
    resetBtn: document.getElementById("reset"),
    defaultOptions: { showBagWeight: true },
    renderExtra: (options) => `
      <label><input type="checkbox" data-opt="showBagWeight" data-opt-type="bool" ${
        options.showBagWeight !== false ? "checked" : ""
      }/> Show bag weight</label>
    `,
    onOptions: (options) => {
      const bag = document.getElementById("bagWeight");
      if (bag) bag.style.display = options.showBagWeight === false ? "none" : "";
    },
  });
}

if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
