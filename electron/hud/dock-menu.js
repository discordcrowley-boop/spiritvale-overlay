const menu = document.getElementById("menu");

const MIN_SCALE = 0.7;
const MAX_SCALE = 1.8;
const MIN_TIP = 0.9;
const MAX_TIP = 2.2;
const STEP = 0.1;

let kind = "dock";
let hudId = "";
let includeMap = {};
let displayMap = {};
let hudState = {
  scale: 1,
  tipScale: 1.35,
  hudLook: 0.4,
  hudCorners: "round",
  options: {},
  nightEnabled: false,
  nightDim: 0.45,
  clickThroughOn: true,
  compactOn: false,
  fabOn: false,
  hideCompact: false,
  iconCollapse: true,
};
let moving = false;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Number(n) || lo));
}

async function fit() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const width = Math.ceil(Math.max(248, Math.min(320, menu.scrollWidth + 8)));
  const height = Math.ceil(Math.max(80, Math.min(560, menu.scrollHeight + 8)));
  await window.overlayHud?.fitDockMenu?.({ width, height });
}

async function persistDock() {
  if (!window.overlayHud?.setHudDock) return;
  await window.overlayHud.setHudDock({
    include: { ...includeMap },
    display: {
      "spiritist-meter": { ...(displayMap["spiritist-meter"] || {}) },
      "loot-meter": { ...(displayMap["loot-meter"] || {}) },
      "kill-counter": { ...(displayMap["kill-counter"] || {}) },
      "exp-meter": { ...(displayMap["exp-meter"] || {}) },
      "pets-meter": { ...(displayMap["pets-meter"] || {}) },
    },
  });
}

function bindDock() {
  menu.querySelectorAll("[data-dock-include]").forEach((input) => {
    input.addEventListener("change", async () => {
      includeMap[input.getAttribute("data-dock-include")] = input.checked;
      await persistDock();
      const section = input.closest(".dock-section");
      if (section) {
        section.querySelectorAll("[data-dock-field]").forEach((field) => {
          field.disabled = !input.checked;
        });
      }
    });
  });
  menu.querySelectorAll("[data-dock-field]").forEach((input) => {
    input.addEventListener("change", async () => {
      const raw = input.getAttribute("data-dock-field") || "";
      const [sectionId, key] = raw.split(":");
      if (!sectionId || !key) return;
      displayMap[sectionId] = { ...(displayMap[sectionId] || {}), [key]: input.checked };
      await persistDock();
    });
  });
}

function setToggleUi(btn, on) {
  if (!btn) return;
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  const stateEl = btn.querySelector(".hud-menu-toggle-state");
  if (stateEl) stateEl.textContent = on ? "On" : "Off";
}

async function notifyHudOptions() {
  if (!hudId) return;
  await window.overlayHud?.saveHudPrefs?.(hudId, { options: { ...hudState.options } });
  await window.overlayHud?.notifyHudOptions?.(hudId, { ...hudState.options });
}

async function onHudClick(event) {
  if (kind !== "hud") return;
  const menuAct = event.target.closest("[data-menu-action]");
  if (menuAct && menu.contains(menuAct)) {
    const action = menuAct.getAttribute("data-menu-action");
    if (action === "click-through") {
      const next = !hudState.clickThroughOn;
      hudState.clickThroughOn = next;
      setToggleUi(menuAct, next);
      try {
        await window.overlayHud?.setLocked?.(next);
      } catch {
        hudState.clickThroughOn = !next;
        setToggleUi(menuAct, !next);
      }
      return;
    }
    if (action === "compact") {
      const next = !hudState.compactOn;
      hudState.compactOn = next;
      if (next) hudState.fabOn = false;
      setToggleUi(menuAct, next);
      const fabToggle = menu.querySelector('[data-menu-action="fab"]');
      if (next && fabToggle) setToggleUi(fabToggle, false);
      try {
        await window.overlayHud?.setHudCompact?.(hudId, next);
      } catch {
        hudState.compactOn = !next;
        setToggleUi(menuAct, !next);
      }
      return;
    }
    if (action === "fab") {
      const next = !hudState.fabOn;
      hudState.fabOn = next;
      if (next) hudState.compactOn = false;
      setToggleUi(menuAct, next);
      const compactToggle = menu.querySelector('[data-menu-action="compact"]');
      if (next && compactToggle) setToggleUi(compactToggle, false);
      try {
        await window.overlayHud?.setHudFab?.(hudId, next);
      } catch {
        hudState.fabOn = !next;
        setToggleUi(menuAct, !next);
      }
      return;
    }
    if (action === "move") return;
  }

  const pick = event.target.closest("[data-opt-set]");
  if (pick && menu.contains(pick)) {
    const key = pick.getAttribute("data-opt-set");
    hudState.options[key] = pick.getAttribute("data-opt-value");
    for (const sibling of menu.querySelectorAll(`[data-opt-set="${key}"]`)) {
      sibling.classList.toggle("on", sibling === pick);
    }
    await notifyHudOptions();
    return;
  }

  const adj = event.target.closest("[data-adjust]");
  if (adj && menu.contains(adj)) {
    const attr = adj.getAttribute("data-adjust");
    const dir = Number(adj.getAttribute("data-dir")) || 0;
    if (attr === "scale") {
      hudState.scale = clamp(Math.round((hudState.scale + dir * STEP) * 10) / 10, MIN_SCALE, MAX_SCALE);
      await window.overlayHud?.setHudScale?.(hudId, hudState.scale);
    } else if (attr === "tipScale") {
      hudState.tipScale = clamp(Math.round((hudState.tipScale + dir * STEP) * 10) / 10, MIN_TIP, MAX_TIP);
      await window.overlayHud?.saveHudPrefs?.(hudId, { tipScale: hudState.tipScale });
    }
    const label = menu.querySelector(`[data-scale-label="${attr}"]`);
    if (label) {
      label.textContent = `${Math.round((attr === "scale" ? hudState.scale : hudState.tipScale) * 100)}%`;
    }
  }
}

async function onHudChange(event) {
  if (kind !== "hud") return;
  const cornersEl = event.target.closest("[data-corners]");
  if (cornersEl) {
    hudState.hudCorners = cornersEl.checked ? "round" : "square";
    await window.overlayHud?.saveHudPrefs?.(hudId, { hudCorners: hudState.hudCorners });
    return;
  }
  const nightEl = event.target.closest("[data-night]");
  if (nightEl && nightEl.getAttribute("data-night") === "enabled") {
    hudState.nightEnabled = Boolean(nightEl.checked);
    await window.overlayHud?.setNightMode?.({ enabled: hudState.nightEnabled });
    return;
  }
  const opt = event.target.closest("[data-opt]");
  if (opt && opt.getAttribute("data-opt-type") === "bool") {
    const key = opt.getAttribute("data-opt");
    hudState.options[key] = Boolean(opt.checked);
    await notifyHudOptions();
  }
}

async function onHudInput(event) {
  if (kind !== "hud") return;
  const opt = event.target.closest("[data-opt]");
  if (opt && opt.getAttribute("data-opt-type") === "range") {
    const key = opt.getAttribute("data-opt");
    hudState.options[key] = Number(opt.value);
    const row = opt.previousElementSibling;
    const label = row?.querySelector?.("b");
    if (label && (/size/i.test(row?.textContent || "") || opt.hasAttribute("data-opt-pct"))) {
      label.textContent = `${Math.round(Number(opt.value))}%`;
    }
    await notifyHudOptions();
    return;
  }
  const lookEl = event.target.closest("[data-look]");
  if (lookEl) {
    hudState.hudLook = clamp(Number(lookEl.value) / 100, 0.2, 1);
    const label = menu.querySelector("[data-look-label]");
    if (label) {
      const name = hudState.hudLook < 0.38 ? "Ghost" : hudState.hudLook < 0.72 ? "Soft" : "Solid";
      label.textContent = `${name} · ${Math.round(hudState.hudLook * 100)}%`;
    }
    await window.overlayHud?.saveHudPrefs?.(hudId, { hudLook: hudState.hudLook });
    return;
  }
  const nightEl = event.target.closest("[data-night]");
  if (nightEl && nightEl.getAttribute("data-night") === "dim") {
    hudState.nightDim = clamp(Number(nightEl.value) / 100, 0, 0.75);
    const label = menu.querySelector("[data-night-label]");
    if (label) label.textContent = `${Math.round(hudState.nightDim * 100)}%`;
    await window.overlayHud?.setNightMode?.({ dim: hudState.nightDim });
  }
}

async function onHudPointerDown(event) {
  if (kind !== "hud") return;
  const handle = event.target.closest("[data-menu-action='move']");
  if (!handle || !menu.contains(handle)) return;
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  moving = true;
  const ok = await window.overlayHud?.beginMove?.(hudId, { allowWhileLocked: true });
  if (!ok) {
    moving = false;
    return;
  }
  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
}

function endMoveDrag() {
  if (!moving) return;
  moving = false;
  window.overlayHud?.endMove?.();
}

function applyPayload(payload = {}) {
  kind = payload.kind === "hud" ? "hud" : "dock";
  hudId = String(payload.hudId || "");
  includeMap = { ...(payload.include || {}) };
  displayMap = {
    "spiritist-meter": { ...(payload.display?.["spiritist-meter"] || {}) },
    "loot-meter": { ...(payload.display?.["loot-meter"] || {}) },
    "kill-counter": { ...(payload.display?.["kill-counter"] || {}) },
    "exp-meter": { ...(payload.display?.["exp-meter"] || {}) },
    "pets-meter": { ...(payload.display?.["pets-meter"] || {}) },
  };
  if (kind === "hud" && payload.state && typeof payload.state === "object") {
    hudState = {
      ...hudState,
      ...payload.state,
      options: { ...(payload.state.options || {}) },
    };
  }
  menu.innerHTML = payload.html || "";
  if (kind === "dock") bindDock();
  fit();
}

menu.addEventListener("click", onHudClick);
menu.addEventListener("change", onHudChange);
menu.addEventListener("input", onHudInput);
menu.addEventListener("pointerdown", onHudPointerDown);
window.addEventListener("pointerup", endMoveDrag);
window.addEventListener("pointercancel", endMoveDrag);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.overlayHud?.hideDockMenu?.();
});

document.addEventListener("mousedown", (event) => {
  event.stopPropagation();
});

if (window.overlayHud?.onDockMenu) {
  window.overlayHud.onDockMenu((payload) => applyPayload(payload || {}));
}

window.addEventListener("blur", () => {
  endMoveDrag();
  setTimeout(() => {
    if (!document.hasFocus()) window.overlayHud?.hideDockMenu?.();
  }, 120);
});
