const subLabel = document.getElementById("subLabel");
const petCountEl = document.getElementById("petCount");
const petLowestEl = document.getElementById("petLowest");
const petListEl = document.getElementById("petList");
const meterEl = document.getElementById("meter");

let hudOptions = {
  fontScale: 100,
};
let latest = null;
let tipVisible = false;
let tipKey = null;
let lastMouse = { x: 0, y: 0 };
let tipsBound = false;

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

function hpClass(pct) {
  if (pct == null) return "";
  if (pct <= 25) return "low";
  if (pct <= 50) return "mid";
  return "";
}

function formatRemain(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "";
  const sec = Math.ceil(n / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m${s}` : `${m}m`;
}

function bindBrokenIcons(root) {
  root.querySelectorAll("img.pet-icon, img.status-icon").forEach((img) => {
    if (img.dataset.boundError === "1") return;
    img.dataset.boundError = "1";
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
      const isStatus = img.classList.contains("status-icon");
      const fallback = document.createElement("span");
      fallback.className = isStatus ? "status-icon missing" : "pet-icon missing";
      fallback.textContent = String(img.dataset.name || "?").slice(0, 1).toUpperCase();
      if (isStatus) {
        fallback.dataset.tip = img.dataset.tip || "";
        fallback.dataset.tipKey = img.dataset.tipKey || "";
        fallback.dataset.name = img.dataset.name || "";
        if (img.dataset.stacks && Number(img.dataset.stacks) > 1) {
          fallback.dataset.stacks = img.dataset.stacks;
        }
        if (img.classList.contains("debuff")) fallback.classList.add("debuff");
        else fallback.classList.add("buff");
      }
      img.replaceWith(fallback);
    });
  });
}

function statusTipPayload(status) {
  const name = status.name || status.id || "Effect";
  const stacks = Number(status.stacks) || 1;
  const level = Number(status.level) || 0;
  const remain = formatRemain(status.remainingMs);
  const icons = [...(status.iconUrls || []), status.iconUrl].filter(Boolean);
  return {
    key: String(status.id || name),
    name,
    debuff: Boolean(status.debuff),
    description: status.description || "",
    notes: Array.isArray(status.notes) ? status.notes : [],
    effectLines: Array.isArray(status.effectLines) ? status.effectLines : [],
    level,
    stacks,
    remain,
    iconUrl: icons[0] || "",
    iconUrls: icons,
  };
}

function statusTipHtml(payload) {
  if (!payload?.name) return "";
  const debuff = Boolean(payload.debuff);
  const kind = debuff ? "Status" : "Active";
  const kindColor = debuff ? "#e0c36a" : "#e0c36a";
  const icons = [...(payload.iconUrls || []), payload.iconUrl].filter(Boolean);
  const icon = icons.length
    ? `<img class="icon sv-tip-icon" src="${escapeHtml(icons[0])}" data-fallbacks="${escapeHtml(
        icons.slice(1).join("|"),
      )}" alt="" />`
    : `<div class="icon missing">${escapeHtml(String(payload.name).slice(0, 1).toUpperCase())}</div>`;

  const metaBits = [
    levelBit(payload.level),
    payload.stacks > 1 ? `×${payload.stacks}` : "",
    payload.remain ? `${payload.remain} left` : "Ongoing",
  ].filter(Boolean);

  const notes = (payload.notes || [])
    .map((n) => `<div class="sv-tip-note">${escapeHtml(n)}</div>`)
    .join("");
  const effects = (payload.effectLines || [])
    .map((line) => {
      const tone = line.tone === "bad" ? "bad" : line.tone === "good" ? "good" : "";
      return `<div class="sv-tip-stat ${tone}"><span>${escapeHtml(line.label)}</span><b>${escapeHtml(
        line.value,
      )}</b></div>`;
    })
    .join("");
  const desc = payload.description
    ? `<div class="sv-tip-desc">${escapeHtml(payload.description)}</div>`
    : "";

  return `
    <div class="sv-tip ${debuff ? "is-debuff" : "is-buff"}">
      <div class="tip-head">
        ${icon}
        <div>
          <div class="tip-slot" style="color:${kindColor}">${kind}</div>
          <div class="tip-name">${escapeHtml(payload.name)}</div>
        </div>
      </div>
      ${desc}
      ${
        debuff
          ? `<div class="sv-tip-name-accent">${escapeHtml(payload.name)}</div>`
          : ""
      }
      ${notes}
      ${effects ? `<div class="sv-tip-effects">${effects}</div>` : ""}
      <div class="tip-meta">${escapeHtml(metaBits.join(" · "))}</div>
    </div>
  `;
}

function levelBit(level) {
  const n = Number(level);
  return Number.isFinite(n) && n > 0 ? `Lv ${n}` : "";
}

function showStatusTip(payload) {
  const html = statusTipHtml(payload);
  if (!html) {
    hideStatusTip();
    return;
  }
  const key = payload.key || payload.name;
  // Avoid thrashing the floating tip window on every tick while still hovering.
  if (tipVisible && tipKey === key) return;
  tipVisible = true;
  tipKey = key;
  window.overlayHud?.showLootTip?.(html);
}

function hideStatusTip() {
  if (!tipVisible && !tipKey) return;
  tipVisible = false;
  tipKey = null;
  window.overlayHud?.hideLootTip?.();
}

function payloadFromEl(el) {
  if (!el) return null;
  try {
    return JSON.parse(el.dataset.tip || "null");
  } catch {
    return null;
  }
}

function statusIconUnderPoint(x, y) {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  return hit.closest?.(".status-icon") || (hit.classList?.contains("status-icon") ? hit : null);
}

function bindStatusTipsOnce() {
  if (tipsBound) return;
  tipsBound = true;

  petListEl.addEventListener("mousemove", (event) => {
    lastMouse = { x: event.clientX, y: event.clientY };
    const icon = event.target?.closest?.(".status-icon");
    if (!icon) return;
    const payload = payloadFromEl(icon);
    if (payload?.name) showStatusTip(payload);
  });

  petListEl.addEventListener("mouseover", (event) => {
    const icon = event.target?.closest?.(".status-icon");
    if (!icon) return;
    const payload = payloadFromEl(icon);
    if (payload?.name) showStatusTip(payload);
  });

  petListEl.addEventListener("mouseout", (event) => {
    const fromIcon = event.target?.closest?.(".status-icon");
    if (!fromIcon) return;
    const toIcon = event.relatedTarget?.closest?.(".status-icon");
    if (toIcon) return;
    // Leaving an icon — only hide if pointer isn't still over another status icon.
    requestAnimationFrame(() => {
      const under = statusIconUnderPoint(lastMouse.x, lastMouse.y);
      if (!under) hideStatusTip();
    });
  });

  // Leaving the whole Pets! panel must dismiss the floating tip.
  const leaveRoot = meterEl || document.body;
  leaveRoot.addEventListener("mouseleave", () => hideStatusTip());
  document.addEventListener("mouseleave", () => hideStatusTip());
  window.addEventListener("blur", hideStatusTip);
}

function statusHtml(statuses) {
  const rows = Array.isArray(statuses) ? statuses.slice(0, 10) : [];
  if (!rows.length) {
    return `<div class="status-row empty-status">—</div>`;
  }
  return `<div class="status-row">${rows
    .map((status) => {
      const name = escapeHtml(status.name || status.id || "Effect");
      const stacks = Number(status.stacks) || 1;
      const payload = statusTipPayload(status);
      const tip = escapeHtml(JSON.stringify(payload));
      const tipKeyAttr = escapeHtml(payload.key);
      const icons = [...(status.iconUrls || []), status.iconUrl].filter(Boolean);
      const kind = status.debuff ? "debuff" : "buff";
      const stackAttr = stacks > 1 ? ` data-stacks="${stacks}"` : "";
      if (icons.length) {
        return `<img class="status-icon ${kind}" src="${escapeHtml(icons[0])}" data-tip="${tip}" data-tip-key="${tipKeyAttr}" data-name="${name}" data-fallbacks="${escapeHtml(
          icons.slice(1).join("|"),
        )}"${stackAttr} alt="" />`;
      }
      return `<span class="status-icon missing ${kind}" data-tip="${tip}" data-tip-key="${tipKeyAttr}" data-name="${name}"${stackAttr}>${escapeHtml(
        String(status.name || "?").slice(0, 1).toUpperCase(),
      )}</span>`;
    })
    .join("")}</div>`;
}

function applyCompact(enabled) {
  document.documentElement.dataset.compact = enabled ? "1" : "0";
  document.getElementById("meter")?.classList.toggle("compact", Boolean(enabled));
}

function statusSig(statuses) {
  return (Array.isArray(statuses) ? statuses : [])
    .map((s) => `${s?.id || s?.name || ""}:${s?.stacks || 1}:${s?.level || 1}:${s?.iconUrl || ""}`)
    .join("|");
}

function petRowHtml(pet) {
  const name = escapeHtml(pet.name || "Pet");
  const pct = pet.pct;
  const hpText =
    pet.hp != null && pet.maxHp != null
      ? `${money(pet.hp)} / ${money(pet.maxHp)}`
      : pet.hp != null
        ? money(pet.hp)
        : pet.maxHp != null
          ? `— / ${money(pet.maxHp)}`
          : "Syncing…";
  const barrier = Number(pet.barrier) || 0;
  const barrierPct =
    barrier > 0 && pet.maxHp > 0 ? Math.max(0, Math.min(100, (barrier / pet.maxHp) * 100)) : 0;
  const barClass = pct == null ? "unknown" : hpClass(pct);
  const width = pct == null ? 100 : Math.max(0, Math.min(100, pct));
  const icons = [...(pet.iconUrls || []), pet.iconUrl].filter(Boolean);
  const iconHtml = icons.length
    ? `<img class="pet-icon" src="${escapeHtml(icons[0])}" data-name="${name}" data-fallbacks="${escapeHtml(
        icons.slice(1).join("|"),
      )}" alt="" />`
    : `<span class="pet-icon missing">${escapeHtml(String(pet.name || "?").slice(0, 1).toUpperCase())}</span>`;
  return `
        <div class="pet-row" data-actor-id="${escapeHtml(String(pet.actorId))}" data-status-sig="${escapeHtml(
          statusSig(pet.statuses),
        )}">
          ${iconHtml}
          <div class="pet-main">
            <div class="pet-top">
              <span class="pet-name">${name}</span>
              <span class="pet-nums">${hpText}${pct != null ? ` · ${Math.round(pct)}%` : ""}</span>
            </div>
            <div class="pet-vitals">
              <div class="bar-wrap">
                <i class="${barClass}" style="width:${width}%"></i>
                ${barrierPct ? `<span class="barrier" style="width:${barrierPct}%"></span>` : ""}
              </div>
              ${statusHtml(pet.statuses)}
            </div>
          </div>
        </div>`;
}

function patchPetRow(el, pet) {
  if (!el || !pet) return false;
  const name = pet.name || "Pet";
  const pct = pet.pct;
  const hpText =
    pet.hp != null && pet.maxHp != null
      ? `${money(pet.hp)} / ${money(pet.maxHp)}`
      : pet.hp != null
        ? money(pet.hp)
        : pet.maxHp != null
          ? `— / ${money(pet.maxHp)}`
          : "Syncing…";
  const barrier = Number(pet.barrier) || 0;
  const barrierPct =
    barrier > 0 && pet.maxHp > 0 ? Math.max(0, Math.min(100, (barrier / pet.maxHp) * 100)) : 0;
  const barClass = pct == null ? "unknown" : hpClass(pct);
  const width = pct == null ? 100 : Math.max(0, Math.min(100, pct));

  const nameEl = el.querySelector(".pet-name");
  const numsEl = el.querySelector(".pet-nums");
  const bar = el.querySelector(".bar-wrap > i");
  const barrierEl = el.querySelector(".bar-wrap .barrier");
  if (nameEl) nameEl.textContent = name;
  if (numsEl) numsEl.textContent = `${hpText}${pct != null ? ` · ${Math.round(pct)}%` : ""}`;
  if (bar) {
    bar.className = barClass;
    bar.style.width = `${width}%`;
  }
  if (barrierPct) {
    if (barrierEl) barrierEl.style.width = `${barrierPct}%`;
    else {
      const wrap = el.querySelector(".bar-wrap");
      if (wrap) {
        const span = document.createElement("span");
        span.className = "barrier";
        span.style.width = `${barrierPct}%`;
        wrap.appendChild(span);
      }
    }
  } else if (barrierEl) {
    barrierEl.remove();
  }

  const nextSig = statusSig(pet.statuses);
  if (el.dataset.statusSig !== nextSig) {
    const vitals = el.querySelector(".pet-vitals");
    const oldRow = el.querySelector(".status-row");
    const tmp = document.createElement("div");
    tmp.innerHTML = statusHtml(pet.statuses);
    const nextRow = tmp.firstElementChild;
    if (oldRow && nextRow) oldRow.replaceWith(nextRow);
    else if (vitals && nextRow) vitals.appendChild(nextRow);
    el.dataset.statusSig = nextSig;
    bindBrokenIcons(el);
  }
  return true;
}

function restoreTipAfterRender() {
  if (!tipKey) return;
  const under = statusIconUnderPoint(lastMouse.x, lastMouse.y);
  if (!under) {
    hideStatusTip();
    return;
  }
  const payload = payloadFromEl(under);
  if (!payload?.name) {
    hideStatusTip();
    return;
  }
  if (payload.key === tipKey) {
    tipVisible = true;
    return;
  }
  tipVisible = false;
  tipKey = null;
  showStatusTip(payload);
}

function render(snapshot) {
  try {
    latest = snapshot || latest;
    applyScales();
    const snap = latest || {};
    const personal = snap?.capture?.personalName;
    subLabel.textContent = personal ? `${personal} · active summons` : "Active summons";

    const pets = Array.isArray(snap?.pets) ? snap.pets : [];
    petCountEl.textContent = String(pets.length);

    if (!pets.length) {
      hideStatusTip();
      petLowestEl.textContent = "—";
      petListEl.innerHTML = `<p class="empty">No active summons — summon a minion to track HP.</p>`;
      return;
    }

    const lowest = pets.reduce((best, row) => {
      if (row?.pct == null) return best;
      if (best == null || row.pct < best) return row.pct;
      return best;
    }, null);
    petLowestEl.textContent = lowest == null ? "—" : `${Math.round(lowest)}%`;

    const visible = pets.slice(0, 16);
    const existing = [...petListEl.querySelectorAll(".pet-row")];
    const sameLayout =
      existing.length === visible.length &&
      existing.every((el, i) => String(el.dataset.actorId) === String(visible[i]?.actorId));

    if (sameLayout) {
      // Patch in place so status <img> nodes keep their resolved (non-404) sources.
      visible.forEach((pet, i) => patchPetRow(existing[i], pet));
    } else {
      petListEl.innerHTML = visible.map((pet) => petRowHtml(pet)).join("");
      bindBrokenIcons(petListEl);
    }
    bindStatusTipsOnce();
    restoreTipAfterRender();
  } catch (err) {
    console.error("pets-meter render failed", err);
  }
}

document.getElementById("reset")?.addEventListener("click", () => {
  window.overlayHud?.resetEncounter?.();
});
document.getElementById("close")?.addEventListener("click", () => {
  hideStatusTip();
  window.overlayHud?.closeMeter?.("pets-meter");
});

if (window.HudChrome) {
  window.HudChrome.mount({
    hudId: "pets-meter",
    resetBtn: document.getElementById("reset"),
    defaultOptions: hudOptions,
    renderExtra: (options) => `
      <div class="hud-settings-head">Pets</div>
      <div class="hud-settings-row"><span>Font size</span><b>${Math.round(options.fontScale || 100)}%</b></div>
      <input class="hud-dim-range" type="range" min="70" max="160" data-opt="fontScale" data-opt-type="range" value="${Math.round(
        options.fontScale || 100,
      )}" />
      <p class="hud-settings-hint">Shows your active summons with live HP and status effects (buffs + debuffs).</p>
    `,
    onOptions: (options) => {
      hudOptions = { ...hudOptions, ...options };
      applyScales();
      if (latest) render(latest);
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
bindStatusTipsOnce();
if (window.overlayHud?.onHudCompact) {
  window.overlayHud.onHudCompact((payload) => {
    if (payload?.id && payload.id !== "pets-meter") return;
    applyCompact(Boolean(payload?.enabled ?? payload?.map?.["pets-meter"]));
  });
}
if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
