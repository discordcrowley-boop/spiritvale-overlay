/**
 * Shared overlay chrome: branded settings, per-window scale, tooltip scale, resize grips.
 */
(function () {
  const DEFAULT_SCALE = 1;
  const MIN_SCALE = 0.7;
  const MAX_SCALE = 1.8;
  const MIN_TIP = 0.9;
  const MAX_TIP = 2.2;
  const MIN_LOOK = 0.2;
  const MAX_LOOK = 1;
  const STEP = 0.1;
  const GEAR_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.4 1.2h3.2l.3 1.4a5.2 5.2 0 0 1 1.4.8l1.3-.6 1.6 1.6-.6 1.3c.3.4.6.9.8 1.4l1.4.3v3.2l-1.4.3a5.2 5.2 0 0 1-.8 1.4l.6 1.3-1.6 1.6-1.3-.6a5.2 5.2 0 0 1-1.4.8l-.3 1.4H6.4l-.3-1.4a5.2 5.2 0 0 1-1.4-.8l-1.3.6-1.6-1.6.6-1.3a5.2 5.2 0 0 1-.8-1.4L.2 9.6V6.4l1.4-.3c.2-.5.5-1 .8-1.4l-.6-1.3 1.6-1.6 1.3.6c.4-.3.9-.6 1.4-.8l.3-1.4ZM8 5.4A2.6 2.6 0 1 0 8 10.6 2.6 2.6 0 0 0 8 5.4Z"/></svg>';
  const RESET_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 2.2a5.8 5.8 0 1 1-5.4 3.7l1.4.4A4.4 4.4 0 1 0 8 3.6V5.5L11.2 3 8 0.6V2.2Z"/></svg>';
  const ZERO_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" stroke-width="1.45"/><path fill="currentColor" d="M8 3.6c1.95 0 3.45 1.7 3.45 4.4S9.95 12.4 8 12.4 4.55 10.7 4.55 8 6.05 3.6 8 3.6Zm0 1.55c-1.05 0-1.85 1.15-1.85 2.85S6.95 10.85 8 10.85s1.85-1.15 1.85-2.85S9.05 5.15 8 5.15Z"/></svg>';
  const CLOSE_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.2 2.1 8 6.9l4.8-4.8 1.1 1.1L9.1 8l4.8 4.8-1.1 1.1L8 9.1l-4.8 4.8-1.1-1.1L6.9 8 2.1 3.2z"/></svg>';
  const MENU_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 3.2h12v1.6H2zm0 4h12v1.6H2zm0 4h12v1.6H2z"/></svg>';
  const CLICK_THROUGH_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7.2 1.2h1.6v3.1h-1.6zm0 10.5h1.6v3.1h-1.6zM1.2 7.2h3.1v1.6H1.2zm10.5 0h3.1v1.6h-3.1zM3.4 3.4l1.1-1.1 2.1 2.1-1.1 1.1zm5.9 5.9 2.1 2.1-1.1 1.1-2.1-2.1zm2.1-5.9-1.1-1.1-2.1 2.1 1.1 1.1zM6.5 9.5 4.4 11.6l1.1 1.1 2.1-2.1z"/><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  const COMPACT_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 7.2h12v1.6H2zM5.2 2.2 8 5l2.8-2.8-.1 1.6L8 6.6 5.3 3.8zm5.6 11.6L8 11l-2.8 2.8.1-1.6L8 9.4l2.7 2.8z"/></svg>';
  const EXPAND_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 7.2h12v1.6H2zM8 1.4l2.7 2.8-.1 1.6L8 3.4 5.3 5.8l-.1-1.6zm0 13.2-2.7-2.8.1-1.6L8 12.6l2.7-2.4.1 1.6z"/></svg>';
  const MOVE_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.1 10.2 3.3H8.8V6H7.2V3.3H5.8zm0 13.8-2.2-2.2h1.4V10h1.6v2.7h1.4zM1.1 8l2.2-2.2V7.2H6v1.6H3.3v1.4zm13.8 0-2.2 2.2V8.8H10V7.2h2.7V5.8z"/></svg>';
  const DETAIL_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.4A6.6 6.6 0 1 0 8 14.6 6.6 6.6 0 0 0 8 1.4Zm0 2.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM6.7 7.2h2.1v5.2H6.7z"/></svg>';
  const COLLAPSE_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.2 3.2h4.2v1.5H4.7v2.7H3.2zm5.4 0h4.2v1.5H10v2.7H8.6zM3.2 8.6h1.5v2.7h2.7v1.5H3.2zm7.8 0H10v2.7H7.3v1.5h4.2z"/></svg>';

  // Collapsed chip labels — overlay names, not glyphs.
  const FAB_LABELS = {
    "spiritist-meter": "Meters!",
    "loot-meter": "Gold!",
    "kill-counter": "Kills!",
    "exp-meter": "Exp!",
    "pets-meter": "Pets!",
    "session-timer": "Timer!",
    "loot-finds": "Loot!",
    "dps-meter": "Damage",
    buffs: "Effects",
    deaths: "Kills",
    farm: "Loot",
    casts: "Casts",
    boss: "Boss",
    tower: "Tower",
  };

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function applyTipScale(scale) {
    const next = clamp(Number(scale) || 1.35, MIN_TIP, MAX_TIP);
    document.documentElement.style.setProperty("--tip-scale", String(next));
    return next;
  }

  function applyHudLook(value) {
    const next = clamp(Number(value) || 0.4, MIN_LOOK, MAX_LOOK);
    document.documentElement.style.setProperty("--hud-look", String(next));
    document.documentElement.dataset.look = next < 0.38 ? "ghost" : next < 0.72 ? "soft" : "solid";
    return next;
  }

  function applyHudCorners(value) {
    const next = value === "square" ? "square" : "round";
    document.documentElement.dataset.corners = next;
    document.documentElement.style.setProperty("--hud-radius", next === "square" ? "0px" : "14px");
    document.documentElement.style.setProperty("--hud-radius-sm", next === "square" ? "0px" : "8px");
    return next;
  }

  function lookLabel(value) {
    if (value < 0.38) return "Ghost";
    if (value < 0.72) return "Soft";
    return "Solid";
  }

  function scaleRow(label, attr, value) {
    return `
      <div class="hud-settings-row">
        <span>${escapeHtml(label)}</span>
        <div class="hud-scale">
          <button type="button" class="hud-scale-btn" data-adjust="${attr}" data-dir="-1" title="Smaller">−</button>
          <b data-scale-label="${attr}">${Math.round(value * 100)}%</b>
          <button type="button" class="hud-scale-btn" data-adjust="${attr}" data-dir="1" title="Larger">+</button>
        </div>
      </div>`;
  }

  function toggleRow(opts) {
    const on = Boolean(opts.on);
    return `
      <button type="button" class="hud-menu-toggle ${on ? "on" : ""}" data-menu-action="${escapeHtml(opts.action)}" aria-pressed="${on ? "true" : "false"}">
        <span class="hud-menu-toggle-copy">
          <strong>${escapeHtml(opts.title)}</strong>
          <small>${escapeHtml(opts.desc || "")}</small>
        </span>
        <span class="hud-menu-toggle-state">${on ? "On" : "Off"}</span>
      </button>`;
  }

  async function loadPrefs(hudId) {
    try {
      const prefs = (await window.overlayHud?.getHudPrefs?.(hudId)) || {};
      return {
        scale: clamp(Number(prefs.scale) || DEFAULT_SCALE, MIN_SCALE, MAX_SCALE),
        tipScale: clamp(Number(prefs.tipScale) || 1.35, MIN_TIP, MAX_TIP),
        hudLook: clamp(Number(prefs.hudLook) || 0.4, MIN_LOOK, MAX_LOOK),
        hudCorners: prefs.hudCorners === "square" ? "square" : "round",
        options: prefs.options && typeof prefs.options === "object" ? prefs.options : {},
      };
    } catch {
      return { scale: DEFAULT_SCALE, tipScale: 1.35, hudLook: 0.4, hudCorners: "round", options: {} };
    }
  }

  async function savePrefs(hudId, patch) {
    try {
      return await window.overlayHud?.saveHudPrefs?.(hudId, patch || {});
    } catch {
      return null;
    }
  }

  function installResizeGrips(hudId) {
    if (document.querySelector(".hud-resize")) return;
    const host = document.querySelector(".details, .att, .shell") || document.body;
    const edges = ["s", "e", "w", "nw", "ne", "sw", "se"];
    for (const edge of edges) {
      const grip = document.createElement("div");
      grip.className = `hud-resize hud-resize-${edge}`;
      grip.dataset.edge = edge;
      grip.title = "Drag to resize";
      host.appendChild(grip);
    }

    let dragging = false;
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("hud-resizing");
      window.overlayHud?.endResize?.();
    };

    host.addEventListener("pointerdown", (event) => {
      const grip = event.target.closest(".hud-resize");
      if (!grip) return;
      if (document.body.classList.contains("hud-locked")) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      document.body.classList.add("hud-resizing");
      window.overlayHud?.beginResize?.(hudId, grip.dataset.edge);
      try {
        grip.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
  }

  function installTitleDrag(hudId) {
    const bar = document.querySelector(".titlebar, header.head, .head");
    if (!bar || bar.dataset.moveBound === "1") return;
    bar.dataset.moveBound = "1";
    // Never use native -webkit-app-region:drag — it steals pointer events from beginMove.
    bar.style.webkitAppRegion = "no-drag";
    bar.style.cursor = "move";
    let moving = false;
    const onUp = () => {
      if (!moving) return;
      moving = false;
      document.body.classList.remove("hud-moving");
      window.overlayHud?.endMove?.();
    };
    bar.addEventListener("pointerdown", async (event) => {
      if (event.button !== 0) return;
      // When click-through lock is on, only the Move button repositions.
      if (document.body.classList.contains("hud-locked")) return;
      if (event.target.closest("button, a, input, label, select, textarea, .no-drag, .hud-resize, .hud-settings, .hud-icon-btn")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      moving = true;
      document.body.classList.add("hud-moving");
      const ok = await window.overlayHud?.beginMove?.(hudId);
      if (!ok) {
        moving = false;
        document.body.classList.remove("hud-moving");
        return;
      }
      try {
        bar.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
  }

  function installChromePassthrough(hudId, getPanel) {
    let locked = true;
    let interactive = false;
    const CHROME =
      "button, a, input, label, select, textarea, .hud-settings, .title-actions, .actions, .hud-icon-btn, .hud-menu-toggle, .hud-menu-move, .hud-move, .hud-fab, .no-drag";

    function applyLockedUi(next) {
      locked = Boolean(next);
      document.body.classList.toggle("hud-locked", locked);
      for (const grip of document.querySelectorAll(".hud-resize")) {
        grip.style.display = locked ? "none" : "";
      }
      const bar = document.querySelector(".titlebar, header.head, .head");
      if (bar) bar.style.cursor = locked ? "default" : "move";
      if (!locked) {
        interactive = false;
      }
    }

    function isChromeHit(target) {
      if (!(target instanceof Element)) return false;
      if (target.closest(CHROME)) return true;
      const panel = typeof getPanel === "function" ? getPanel() : null;
      if (panel && !panel.hidden && panel.contains(target)) return true;
      return false;
    }

    function setInteractive(want) {
      if (!locked) return;
      if (want === interactive) return;
      interactive = want;
      window.overlayHud?.setChromeInteractive?.(hudId, want);
    }

    function wantInteractive(target) {
      const panel = typeof getPanel === "function" ? getPanel() : null;
      if (panel && !panel.hidden) return true;
      return isChromeHit(target);
    }

    document.addEventListener(
      "mousemove",
      (event) => {
        if (!locked) return;
        setInteractive(wantInteractive(event.target));
      },
      true,
    );
    document.addEventListener("mouseleave", () => {
      if (locked) setInteractive(false);
    });

    applyLockedUi(true);
    window.overlayHud
      ?.getLocked?.()
      .then((value) => applyLockedUi(value !== false))
      .catch(() => {});
    if (window.overlayHud?.onLocked) {
      window.overlayHud.onLocked((payload) => {
        applyLockedUi(payload?.locked !== false);
        if (locked) setInteractive(false);
      });
    }
  }

  function installPausedBadge(hudId) {
    if (hudId === "session-timer" || hudId === "dock-menu" || document.querySelector(".hud-paused-badge")) {
      return;
    }
    const badge = document.createElement("div");
    badge.className = "hud-paused-badge";
    badge.textContent = "Paused";
    badge.hidden = true;
    document.body.appendChild(badge);
    const apply = (timer) => {
      const paused = Boolean(timer?.overlaysPaused);
      badge.hidden = !paused;
      document.documentElement.dataset.sessionPaused = paused ? "1" : "0";
    };
    window.overlayHud?.getTimer?.().then(apply).catch(() => {});
    window.overlayHud?.onTimer?.(apply);
  }

  async function mount(opts) {
    const hudId = opts.hudId;
    if (!hudId) return null;
    installPausedBadge(hudId);

    const prefs = await loadPrefs(hudId);
    let night = { enabled: false, dim: 0.45, gameFound: false };
    try {
      night = (await window.overlayHud?.getNightMode?.()) || night;
    } catch {
      /* ignore */
    }
    const state = {
      hudId,
      scale: prefs.scale,
      tipScale: prefs.tipScale,
      hudLook: prefs.hudLook,
      hudCorners: prefs.hudCorners,
      options: { ...(opts.defaultOptions || {}), ...prefs.options },
      nightEnabled: Boolean(night.enabled),
      nightDim: clamp(Number(night.dim) || 0.45, 0, 0.75),
      nightGameFound: Boolean(night.gameFound),
    };
    applyTipScale(state.tipScale);
    applyHudLook(state.hudLook);
    applyHudCorners(state.hudCorners);

    const actions =
      opts.actionsEl ||
      document.querySelector(".title-actions, .actions, .head .actions");
    if (!actions) return state;

    const reset = opts.resetBtn || actions.querySelector("#reset");
    if (reset) {
      reset.classList.add("hud-icon-btn", "hud-reset");
      reset.title = reset.title || "Reset session";
      reset.innerHTML = RESET_SVG;
    }

    // Soft-zero: clear totals without full identity resync. Sits next to Reset.
    let zeroBtn = actions.querySelector("#zero");
    if (reset) {
      if (!zeroBtn) {
        zeroBtn = document.createElement("button");
        zeroBtn.type = "button";
        zeroBtn.id = "zero";
        reset.insertAdjacentElement("afterend", zeroBtn);
      }
      zeroBtn.classList.add("hud-icon-btn", "hud-zero");
      zeroBtn.title = "Zero totals (keep names)";
      zeroBtn.setAttribute("aria-label", "Zero totals");
      zeroBtn.innerHTML = ZERO_SVG;
      if (!zeroBtn.dataset.zeroBound) {
        zeroBtn.dataset.zeroBound = "1";
        zeroBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const api = window.overlayHud || window.overlay;
          api?.zeroMeters?.();
        });
      }
    } else if (zeroBtn) {
      zeroBtn.remove();
      zeroBtn = null;
    }

    const closeBtn = actions.querySelector("#close");
    if (closeBtn) {
      closeBtn.classList.add("hud-icon-btn", "hud-close");
      closeBtn.title = closeBtn.title || "Close";
      closeBtn.innerHTML = CLOSE_SVG;
    }
    const menuBtn = document.getElementById("menuBtn");
    if (menuBtn) {
      menuBtn.classList.add("hud-icon-btn", "hud-menu");
      menuBtn.innerHTML = MENU_SVG;
    }

    // Gear opens a floating dropdown (separate window) — never clipped by the HUD.
    const showSettings = opts.showSettings !== false;
    const externalSettings = opts.externalSettings === true;
    const hideCompact = opts.hideCompact === true || hudId === "dock-bar";
    const iconCollapse = opts.iconCollapse !== false && hudId !== "dock-bar";
    const settingsOnlyExtra = opts.settingsOnlyExtra === true;

    // Flatten any legacy two-row tool chrome into one quiet action row.
    const legacyStack = actions.querySelector(".hud-action-stack");
    if (legacyStack) {
      const keep = [];
      for (const el of legacyStack.querySelectorAll(".hud-action-row > *")) keep.push(el);
      for (const el of keep) actions.appendChild(el);
      legacyStack.remove();
    }
    for (const stale of actions.querySelectorAll(
      "#hudClickThrough, #hudCompactToggle, #hudMove, #hudDetail, #hudCollapse, #hudFab, .hud-tool-row, #hudSettingsPanel",
    )) {
      stale.remove();
    }
    const leftoverPanel = document.getElementById("hudSettingsPanel");
    if (leftoverPanel) leftoverPanel.remove();
    document.getElementById("hudFab")?.remove();
    document.getElementById("mapFab")?.remove();
    document.getElementById("collapseMap")?.remove();

    let settingsBtn = actions.querySelector("#hudSettings");
    if (showSettings) {
      if (!settingsBtn) {
        settingsBtn = document.createElement("button");
        settingsBtn.type = "button";
        settingsBtn.id = "hudSettings";
        settingsBtn.className = "hud-icon-btn hud-gear";
        actions.appendChild(settingsBtn);
      }
      settingsBtn.title = "Overlay menu";
      settingsBtn.innerHTML = GEAR_SVG;
    } else if (settingsBtn) {
      settingsBtn.remove();
      settingsBtn = null;
    }

    let moveBtn = actions.querySelector("#hudMoveQuick");
    if (!moveBtn) {
      moveBtn = document.createElement("button");
      moveBtn.type = "button";
      moveBtn.id = "hudMoveQuick";
      moveBtn.className = "hud-icon-btn hud-move";
      actions.appendChild(moveBtn);
    }
    moveBtn.title = "Move";
    moveBtn.setAttribute("aria-label", "Move");
    moveBtn.innerHTML = MOVE_SVG;

    let collapseBtn = null;
    let fabBtn = null;
    const fabLabel = FAB_LABELS[hudId] || "Overlay";
    if (iconCollapse) {
      collapseBtn = document.createElement("button");
      collapseBtn.type = "button";
      collapseBtn.id = "hudCollapse";
      collapseBtn.className = "hud-icon-btn hud-collapse";
      collapseBtn.title = "Collapse to name";
      collapseBtn.setAttribute("aria-label", "Collapse to name");
      collapseBtn.innerHTML = COLLAPSE_SVG;
      actions.appendChild(collapseBtn);

      fabBtn = document.createElement("button");
      fabBtn.type = "button";
      fabBtn.id = "hudFab";
      fabBtn.className = "hud-fab";
      fabBtn.hidden = true;
      fabBtn.title = `Open ${fabLabel}`;
      fabBtn.setAttribute("aria-label", `Open ${fabLabel}`);
      fabBtn.innerHTML = `<span class="hud-fab-label">${escapeHtml(fabLabel)}</span>`;
      document.body.appendChild(fabBtn);
    }

    // Canonical order: (custom) · collapse · reset · zero · Move · settings · close
    const customs = [...actions.children].filter(
      (el) =>
        el !== reset &&
        el !== zeroBtn &&
        el !== moveBtn &&
        el !== settingsBtn &&
        el !== closeBtn &&
        el !== collapseBtn &&
        el.id !== "hudSettings" &&
        el.id !== "hudMoveQuick" &&
        el.id !== "hudCollapse" &&
        el.id !== "zero",
    );
    for (const el of customs) actions.appendChild(el);
    if (collapseBtn) actions.appendChild(collapseBtn);
    if (reset && reset.parentElement === actions) actions.appendChild(reset);
    if (zeroBtn && zeroBtn.parentElement === actions) actions.appendChild(zeroBtn);
    actions.appendChild(moveBtn);
    if (settingsBtn) actions.appendChild(settingsBtn);
    if (closeBtn && closeBtn.parentElement === actions) actions.appendChild(closeBtn);

    actions.classList.add("hud-chrome-actions");

    let compactOn = false;
    let fabOn = false;
    let clickThroughOn = true;

    function applyCompactState(enabled) {
      compactOn = Boolean(enabled);
      document.documentElement.dataset.compact = compactOn ? "1" : "0";
    }

    function applyFabState(enabled) {
      fabOn = Boolean(enabled);
      document.documentElement.dataset.fab = fabOn ? "1" : "0";
      document.body.classList.toggle("hud-icon-collapsed", fabOn);
      if (fabBtn) fabBtn.hidden = !fabOn;
      if (collapseBtn) collapseBtn.disabled = fabOn;
    }

    async function setCompact(enabled) {
      applyCompactState(enabled);
      if (enabled) applyFabState(false);
      try {
        await window.overlayHud?.setHudCompact?.(hudId, Boolean(enabled));
      } catch {
        /* ignore */
      }
    }

    async function setCollapsed(enabled) {
      applyFabState(enabled);
      if (enabled) applyCompactState(false);
      try {
        await window.overlayHud?.setHudFab?.(hudId, Boolean(enabled));
      } catch {
        /* ignore */
      }
    }

    function applyClickThroughState(locked) {
      clickThroughOn = locked !== false;
    }

    try {
      const map = (await window.overlayHud?.getHudCompact?.()) || {};
      applyCompactState(Boolean(map[hudId]));
    } catch {
      applyCompactState(false);
    }
    // Always start expanded — name-chip is opt-in after the window is visible.
    // Restoring fab from prefs made overlays hard to find on first open.
    applyFabState(false);
    try {
      const locked = await window.overlayHud?.getLocked?.();
      applyClickThroughState(locked !== false);
    } catch {
      applyClickThroughState(true);
    }

    function renderOverlayControls() {
      if (externalSettings) return "";
      const rows = [
        toggleRow({
          action: "click-through",
          on: clickThroughOn,
          title: "Click-through",
          desc: "Clicks pass to the game",
        }),
      ];
      if (!hideCompact) {
        rows.push(
          toggleRow({
            action: "compact",
            on: compactOn,
            title: "Compact strip",
            desc: "Thin stats bar",
          }),
        );
      }
      if (iconCollapse) {
        rows.push(
          toggleRow({
            action: "fab",
            on: fabOn,
            title: "Collapse to name",
            desc: "Named chip · click to expand",
          }),
        );
      }
      rows.push(`
        <button type="button" class="hud-menu-move" data-menu-action="move" title="Drag to reposition">
          <span class="hud-menu-toggle-copy">
            <strong>Move overlay</strong>
            <small>Drag this row to reposition</small>
          </span>
          <span class="hud-menu-move-glyph" aria-hidden="true">${MOVE_SVG}</span>
        </button>`);
      return `
        <div class="hud-settings-head">Overlay</div>
        <div class="hud-menu-toggles">${rows.join("")}</div>`;
    }

    function buildMenuHtml() {
      const extra =
        typeof opts.renderExtra === "function" ? opts.renderExtra(state.options, state) : "";
      if (settingsOnlyExtra) {
        return `${renderOverlayControls()}${extra || ""}`;
      }
      if (externalSettings) return extra || "";
      return `
        ${renderOverlayControls()}
        <div class="hud-settings-head">Window</div>
        ${scaleRow("Window scale", "scale", state.scale)}
        ${scaleRow("Tooltip text", "tipScale", state.tipScale)}
        <div class="hud-settings-row">
          <span>Look</span>
          <b data-look-label>${lookLabel(state.hudLook)} · ${Math.round(state.hudLook * 100)}%</b>
        </div>
        <input class="hud-dim-range" type="range" min="20" max="100" data-look="1" value="${Math.round(state.hudLook * 100)}" />
        <div class="hud-settings-row">
          <span>Rounded corners</span>
          <label class="hud-toggle">
            <input type="checkbox" data-corners="1" ${state.hudCorners !== "square" ? "checked" : ""} />
          </label>
        </div>
        <div class="hud-settings-head">Game dark mode</div>
        <div class="hud-settings-row">
          <span>Dim SpiritVale</span>
          <label class="hud-toggle">
            <input type="checkbox" data-night="enabled" ${state.nightEnabled ? "checked" : ""} />
          </label>
        </div>
        <div class="hud-settings-row">
          <span>Dim amount</span>
          <b data-night-label>${Math.round(state.nightDim * 100)}%</b>
        </div>
        <input class="hud-dim-range" type="range" min="0" max="75" data-night="dim" value="${Math.round(state.nightDim * 100)}" />
        <p class="hud-settings-hint">${
          state.nightEnabled
            ? state.nightGameFound
              ? "Shading the game. Ctrl+Shift+D toggles."
              : "Waiting for SpiritVale…"
            : "Dim the game window. Ctrl+Shift+D toggles."
        }</p>
        ${extra}
      `;
    }

    async function openFloatMenu(anchorBtn) {
      if (externalSettings && typeof opts.openExternalSettings === "function") {
        await opts.openExternalSettings(anchorBtn || settingsBtn);
        return;
      }
      const btn = anchorBtn || settingsBtn;
      const rect = (btn || actions).getBoundingClientRect();
      const x = Math.round((window.screenX || 0) + rect.left);
      const y = Math.round((window.screenY || 0) + rect.bottom + 4);
      await window.overlayHud?.showDockMenu?.({
        kind: "hud",
        hudId,
        html: buildMenuHtml(),
        x,
        y,
        state: {
          scale: state.scale,
          tipScale: state.tipScale,
          hudLook: state.hudLook,
          hudCorners: state.hudCorners,
          options: { ...state.options },
          nightEnabled: state.nightEnabled,
          nightDim: state.nightDim,
          clickThroughOn,
          compactOn,
          fabOn,
          hideCompact,
          iconCollapse,
        },
      });
    }

    installResizeGrips(hudId);
    installTitleDrag(hudId);
    installChromePassthrough(hudId, () => null);

    if (moveBtn) {
      let movingQuick = false;
      const endQuickMove = () => {
        if (!movingQuick) return;
        movingQuick = false;
        document.body.classList.remove("hud-moving");
        window.overlayHud?.endMove?.();
      };
      moveBtn.addEventListener("pointerdown", async (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        movingQuick = true;
        document.body.classList.add("hud-moving");
        const ok = await window.overlayHud?.beginMove?.(hudId, { allowWhileLocked: true });
        if (!ok) {
          movingQuick = false;
          document.body.classList.remove("hud-moving");
          return;
        }
        try {
          moveBtn.setPointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
      });
      moveBtn.addEventListener("pointerup", endQuickMove);
      moveBtn.addEventListener("pointercancel", endQuickMove);
      window.addEventListener("blur", endQuickMove);
    }

    if (settingsBtn) {
      settingsBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        await openFloatMenu(settingsBtn);
      });
    }

    if (collapseBtn) {
      collapseBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        setCollapsed(true);
      });
    }

    if (fabBtn) {
      let fabStart = null;
      let fabMoved = false;

      fabBtn.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        fabStart = { x: event.screenX, y: event.screenY };
        fabMoved = false;
        window.overlayHud?.beginMove?.(hudId, {
          x: event.screenX,
          y: event.screenY,
          allowWhileLocked: true,
        });
      });
      window.addEventListener("pointermove", (event) => {
        if (!fabStart) return;
        if (Math.hypot(event.screenX - fabStart.x, event.screenY - fabStart.y) > 5) {
          fabMoved = true;
        }
      });
      window.addEventListener("pointerup", () => {
        if (!fabStart) return;
        fabStart = null;
        window.overlayHud?.endMove?.();
        if (!fabMoved) setCollapsed(false);
      });
    }

    if (window.overlayHud?.onHudCompact) {
      window.overlayHud.onHudCompact((payload) => {
        if (!payload) return;
        if (payload.id && payload.id !== hudId && payload.map == null) return;
        const enabled =
          payload.id === hudId
            ? Boolean(payload.enabled)
            : Boolean(payload.map?.[hudId]);
        applyCompactState(enabled);
      });
    }

    if (window.overlayHud?.onHudFab) {
      window.overlayHud.onHudFab((payload) => {
        if (!payload) return;
        if (payload.id && payload.id !== hudId && payload.map == null) return;
        const enabled =
          payload.id === hudId
            ? Boolean(payload.enabled)
            : Boolean(payload.map?.[hudId]);
        applyFabState(enabled);
      });
    }

    if (window.overlayHud?.onLocked) {
      window.overlayHud.onLocked((payload) => {
        applyClickThroughState(payload?.locked !== false);
      });
    }

    if (typeof opts.setupTools === "function") {
      opts.setupTools({
        settingsBtn,
        state,
        hudId,
        savePrefs,
        openFloatMenu,
        DETAIL_SVG,
      });
    }

    if (window.overlayHud?.onHudOptions) {
      window.overlayHud.onHudOptions((payload) => {
        if (!payload || payload.id !== hudId) return;
        state.options = { ...state.options, ...(payload.options || {}) };
        if (typeof opts.onOptions === "function") opts.onOptions(state.options);
      });
    }

    if (window.overlayHud?.onNightMode) {
      window.overlayHud.onNightMode((payload) => {
        if (!payload) return;
        if (payload.enabled != null) state.nightEnabled = Boolean(payload.enabled);
        if (payload.dim != null) state.nightDim = clamp(Number(payload.dim), 0, 0.75);
        if (payload.gameFound != null) state.nightGameFound = Boolean(payload.gameFound);
      });
    }

    if (window.overlayHud?.onTipScale) {
      window.overlayHud.onTipScale((payload) => {
        if (payload?.tipScale != null) {
          state.tipScale = clamp(Number(payload.tipScale), MIN_TIP, MAX_TIP);
          applyTipScale(state.tipScale);
        }
      });
    }

    if (window.overlayHud?.onHudLook) {
      window.overlayHud.onHudLook((payload) => {
        if (!payload) return;
        if (payload.hudLook != null) state.hudLook = applyHudLook(payload.hudLook);
        if (payload.hudCorners) state.hudCorners = applyHudCorners(payload.hudCorners);
      });
    }

    // Keep Window scale in sync if main reapplies zoom (and persist ctrl+scroll).
    if (window.overlayHud?.onHudScale) {
      window.overlayHud.onHudScale((payload) => {
        if (!payload || (payload.id && payload.id !== hudId)) return;
        if (payload.scale != null) {
          state.scale = clamp(Number(payload.scale), MIN_SCALE, MAX_SCALE);
        }
      });
    }

    if (typeof opts.onOptions === "function") opts.onOptions(state.options);
    return state;
  }

  window.HudChrome = { mount, applyTipScale, applyHudLook, escapeHtml, clamp, MIN_SCALE, MAX_SCALE };
})();
