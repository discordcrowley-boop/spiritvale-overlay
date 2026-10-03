const path = require("path");
const { BrowserWindow, screen } = require("electron");

const HUD_PRELOAD = path.join(__dirname, "preload.js");
const EDGE_PX = 12;
const EXPAND_GUTTER = 20;

function hudPath(name) {
  return path.join(__dirname, "hud", `${name}.html`);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Number(n) || lo));
}

const MIN_HUD_W = 180;
const MIN_HUD_H = 120;
const MIN_COMPACT_W = 160;
const MIN_COMPACT_H = 24;
const MIN_VISIBLE = 48;

const COMPACT_SIZES = {
  "spiritist-meter": { width: 560, height: 72 },
  "loot-meter": { width: 480, height: 64 },
  "kill-counter": { width: 520, height: 64 },
  "exp-meter": { width: 480, height: 64 },
  "pets-meter": { width: 480, height: 72 },
  "dock-bar": { width: 920, height: 64 },
};

const FAB_CHIP = { width: 132, height: 44 };
const FAB_SIZES = {
  "spiritist-meter": FAB_CHIP,
  "loot-meter": FAB_CHIP,
  "kill-counter": FAB_CHIP,
  "exp-meter": FAB_CHIP,
  "pets-meter": FAB_CHIP,
  "session-timer": FAB_CHIP,
  "loot-finds": FAB_CHIP,
  "dps-meter": FAB_CHIP,
  buffs: FAB_CHIP,
  deaths: FAB_CHIP,
  farm: FAB_CHIP,
  casts: FAB_CHIP,
  boss: FAB_CHIP,
  tower: FAB_CHIP,
};

const DEFAULT_NORMAL_SIZES = {
  "spiritist-meter": { width: 380, height: 720 },
  "loot-meter": { width: 280, height: 180 },
  "kill-counter": { width: 280, height: 360 },
  "exp-meter": { width: 300, height: 340 },
  "pets-meter": { width: 300, height: 320 },
  "session-timer": { width: 260, height: 96 },
  "loot-finds": { width: 360, height: 520 },
  "dps-meter": { width: 310, height: 280 },
  buffs: { width: 260, height: 200 },
  deaths: { width: 300, height: 320 },
  farm: { width: 560, height: 420 },
  casts: { width: 280, height: 220 },
  boss: { width: 280, height: 220 },
  tower: { width: 260, height: 260 },
};

function compactMins(id) {
  if (id === "dock-bar") return { minWidth: MIN_COMPACT_W, minHeight: MIN_COMPACT_H };
  return { minWidth: MIN_COMPACT_W, minHeight: MIN_COMPACT_H };
}

function fabMins() {
  return { minWidth: 64, minHeight: 28 };
}

const NORMAL_MINS = {
  "session-timer": { minWidth: 110, minHeight: 40 },
};

function normalMins(id) {
  return NORMAL_MINS[id] || { minWidth: MIN_HUD_W, minHeight: MIN_HUD_H };
}

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

function currentWorkArea(hintBounds) {
  const areas = screen.getAllDisplays().map((display) => display.workArea);
  if (hintBounds && Number.isFinite(hintBounds.x) && Number.isFinite(hintBounds.y)) {
    let best = null;
    let bestOverlap = 0;
    for (const area of areas) {
      const next = overlapArea(hintBounds, area);
      if (next > bestOverlap) {
        bestOverlap = next;
        best = area;
      }
    }
    if (best && bestOverlap >= MIN_VISIBLE * 24) return best;
  }
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  } catch {
    return screen.getPrimaryDisplay().workArea;
  }
}

function sameBounds(a, b) {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function fitHudBounds(desired = {}, fallback = {}, limits = {}) {
  const minW = Math.max(80, Number(limits.minWidth) || MIN_HUD_W);
  const minH = Math.max(20, Number(limits.minHeight) || MIN_HUD_H);
  const width = Math.max(minW, Number(desired.width) || Number(fallback.width) || 360);
  const height = Math.max(minH, Number(desired.height) || Number(fallback.height) || 280);
  const x = Number.isFinite(desired.x) ? desired.x : fallback.x;
  const y = Number.isFinite(desired.y) ? desired.y : fallback.y;
  const probe = {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width,
    height,
  };
  const visible = Number.isFinite(x) && Number.isFinite(y);
  const area = currentWorkArea(visible ? probe : null);
  const maxW = Math.max(minW, area.width - 16);
  const maxH = Math.max(minH, area.height - 16);
  const nextW = Math.min(width, maxW);
  const nextH = Math.min(height, maxH);
  const stillVisible =
    visible && overlapArea({ x, y, width: nextW, height: nextH }, area) >= MIN_VISIBLE * 24;

  let nextX = x;
  let nextY = y;
  if (!stillVisible) {
    nextX = Number.isFinite(fallback.x) ? fallback.x : area.x + Math.max(8, area.width - nextW - 24);
    nextY = Number.isFinite(fallback.y) ? fallback.y : area.y + 80;
  }
  nextX = clamp(nextX, area.x, area.x + area.width - Math.min(nextW, MIN_VISIBLE));
  nextY = clamp(nextY, area.y, area.y + area.height - Math.min(nextH, MIN_VISIBLE));
  return {
    x: Math.round(nextX),
    y: Math.round(nextY),
    width: Math.round(nextW),
    height: Math.round(nextH),
  };
}

class OverlayHudManager {
  constructor({
    onClosed,
    onBoundsChanged,
    onHudPrefsChanged,
    onFabMapChanged,
  } = {}) {
    this.windows = new Map();
    this.onClosed = onClosed;
    this.onBoundsChanged = onBoundsChanged;
    this.onHudPrefsChanged = onHudPrefsChanged;
    this.onFabMapChanged = onFabMapChanged;
    this.locked = true;
    this.opacity = 0.88;
    this.hudLook = 0.4;
    this.savedBounds = {};
    this.hudScales = {};
    this.hudOptions = {};
    this.baseSizes = {};
    this.edgeInteractive = new Set();
    this.lootTip = null;
    this.lootTipPreferredWin = null;
    this.dockMenu = null;
    this.dockMenuAnchor = null;
    /** Temporary bounds restore while a HUD gear menu is open (avoids compact clip). */
    this.menuSpace = new Map();
    this.edgeTimer = null;
    this.resizeDrag = null;
    this.moveDrag = null;
    this.resizeTimer = null;
    this.moveTimer = null;
    this.tipScale = 1.35;
    this.hudCorners = "round";
    this.hudCompact = {};
    this.hudFab = {};
    /** Per-HUD last bounds for normal vs compact vs fab — survives toggles and restarts. */
    this.layoutBounds = {};
    this._watchingDisplays = false;
    this._onDisplayChange = () => this.refitAll();
  }

  watchDisplays() {
    if (this._watchingDisplays) return;
    this._watchingDisplays = true;
    screen.on("display-added", this._onDisplayChange);
    screen.on("display-removed", this._onDisplayChange);
    screen.on("display-metrics-changed", this._onDisplayChange);
  }

  setSavedBounds(boundsById = {}) {
    this.savedBounds = boundsById && typeof boundsById === "object" ? { ...boundsById } : {};
  }

  setLayoutBounds(layoutById = {}) {
    this.layoutBounds = layoutById && typeof layoutById === "object" ? { ...layoutById } : {};
    // Seed missing normal slots from legacy hudBounds.
    for (const [id, bounds] of Object.entries(this.savedBounds || {})) {
      if (!this.layoutBounds[id]) this.layoutBounds[id] = {};
      if (!this.layoutBounds[id].normal && bounds?.width) {
        this.layoutBounds[id] = { ...this.layoutBounds[id], normal: { ...bounds } };
      }
    }
  }

  #modeKey(id) {
    if (id === "dock-bar") return "compact";
    if (this.isFab(id)) return "fab";
    if (this.isCompact(id)) return "compact";
    return "normal";
  }

  #rememberBounds(id, bounds, mode = null) {
    if (!bounds) return;
    const key = mode || this.#modeKey(id);
    if (!this.layoutBounds[id]) this.layoutBounds[id] = {};
    this.layoutBounds[id] = {
      ...this.layoutBounds[id],
      [key]: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
    };
    this.savedBounds[id] = { ...bounds };
  }

  #boundsForMode(id, mode) {
    const slot = this.layoutBounds[id]?.[mode];
    if (slot?.width && slot?.height) return { ...slot };
    if (mode === "compact" && COMPACT_SIZES[id]) {
      const cur = this.savedBounds[id] || this.layoutBounds[id]?.normal || {};
      return {
        x: cur.x,
        y: cur.y,
        width: COMPACT_SIZES[id].width,
        height: COMPACT_SIZES[id].height,
      };
    }
    if (mode === "fab" && FAB_SIZES[id]) {
      // Always use the current chip size — old saved fab slots were icon-sized and clip labels.
      const cur = this.layoutBounds[id]?.fab || this.savedBounds[id] || this.layoutBounds[id]?.normal || {};
      return {
        x: cur.x,
        y: cur.y,
        width: FAB_SIZES[id].width,
        height: FAB_SIZES[id].height,
      };
    }
    return this.savedBounds[id] ? { ...this.savedBounds[id] } : null;
  }

  #emitBounds(id, bounds) {
    if (typeof this.onBoundsChanged === "function") {
      this.onBoundsChanged(id, bounds, {
        mode: this.#modeKey(id),
        layoutBounds: { ...this.layoutBounds },
      });
    }
  }

  setHudPrefs({ scales = {}, options = {}, tipScale, hudLook, hudCorners } = {}) {
    this.hudScales = {};
    if (scales && typeof scales === "object") {
      for (const [id, value] of Object.entries(scales)) {
        this.hudScales[id] = clamp(Number(value) || 1, 0.7, 1.8);
      }
    }
    this.hudOptions = {};
    if (options && typeof options === "object") {
      for (const [id, value] of Object.entries(options)) {
        this.hudOptions[id] =
          value && typeof value === "object" ? { ...value } : {};
      }
    }
    if (tipScale != null) this.tipScale = clamp(tipScale, 0.9, 2.2);
    if (hudLook != null) this.hudLook = clamp(hudLook, 0.2, 1);
    if (hudCorners != null) this.hudCorners = hudCorners === "square" ? "square" : "round";
    this.#applyTipScale();
    this.#applyHudLook();
    for (const id of this.windows.keys()) this.#applyScale(id);
  }

  getHudPrefs(id) {
    return {
      scale: clamp(this.hudScales[id] ?? 1, 0.7, 1.8),
      tipScale: clamp(this.tipScale, 0.9, 2.2),
      hudLook: clamp(this.hudLook, 0.2, 1),
      hudCorners: this.hudCorners === "square" ? "square" : "round",
      options: { ...(this.hudOptions[id] || {}) },
    };
  }

  saveHudPrefs(id, patch = {}) {
    if (patch.scale != null) {
      this.hudScales[id] = clamp(patch.scale, 0.7, 1.8);
    }
    if (patch.tipScale != null) {
      this.tipScale = clamp(patch.tipScale, 0.9, 2.2);
      this.#applyTipScale();
    }
    if (patch.hudLook != null) {
      this.hudLook = clamp(patch.hudLook, 0.2, 1);
      this.#applyHudLook();
    }
    if (patch.hudCorners != null) {
      this.hudCorners = patch.hudCorners === "square" ? "square" : "round";
      this.#applyHudLook();
    }
    if (patch.options && typeof patch.options === "object") {
      this.hudOptions[id] = { ...(this.hudOptions[id] || {}), ...patch.options };
    }
    this.#applyScale(id);
    if (typeof this.onHudPrefsChanged === "function") {
      this.onHudPrefsChanged({
        hudScales: { ...this.hudScales },
        hudOptions: { ...this.hudOptions },
        tipScale: this.tipScale,
        hudLook: this.hudLook,
        hudCorners: this.hudCorners,
      });
    }
    return this.getHudPrefs(id);
  }

  reportHudBase(id, base = {}) {
    if (!id) return;
    this.baseSizes[id] = {
      width: Math.max(120, Number(base.width) || 320),
      height: Math.max(100, Number(base.height) || 280),
    };
    this.#applyScale(id);
  }

  setHudScale(id, scale) {
    return this.saveHudPrefs(id, { scale });
  }

  setHudLook(value) {
    this.hudLook = clamp(value, 0.2, 1);
    this.#applyHudLook();
    if (typeof this.onHudPrefsChanged === "function") {
      this.onHudPrefsChanged({
        hudScales: { ...this.hudScales },
        hudOptions: { ...this.hudOptions },
        tipScale: this.tipScale,
        hudLook: this.hudLook,
        hudCorners: this.hudCorners,
      });
    }
    return this.hudLook;
  }

  #applyHudLook() {
    const payload = {
      hudLook: clamp(this.hudLook, 0.2, 1),
      hudCorners: this.hudCorners === "square" ? "square" : "round",
    };
    this.broadcast("overlay:hud-look", payload);
    if (this.lootTip && !this.lootTip.isDestroyed()) {
      try {
        this.lootTip.webContents.send("overlay:hud-look", payload);
      } catch {
        /* ignore */
      }
    }
  }

  #applyScale(id) {
    const win = this.windows.get(id);
    if (!win || win.isDestroyed()) return;
    // Name-chip mode must stay at 1× — zoom clips the pill.
    const zoom = this.isFab(id) ? 1 : clamp(this.hudScales[id] ?? 1, 0.7, 1.8);
    try {
      win.webContents.setZoomFactor(zoom);
    } catch {
      /* ignore */
    }
    try {
      win.webContents.send("overlay:hud-scale", { id, scale: zoom });
      win.webContents.send("overlay:hud-size-scale", {
        id,
        height: win.getBounds().height,
        width: win.getBounds().width,
        sizeZoom: 1,
        zoom,
      });
    } catch {
      /* ignore */
    }
  }

  notifyHudOptions(id, options = {}) {
    const win = this.windows.get(id);
    if (!win || win.isDestroyed()) return false;
    try {
      win.webContents.send("overlay:hud-options", { id, options: { ...options } });
    } catch {
      return false;
    }
    return true;
  }

  idForWebContents(webContents) {
    if (!webContents) return null;
    for (const [id, win] of this.windows.entries()) {
      if (win && !win.isDestroyed() && win.webContents === webContents) return id;
    }
    return null;
  }

  #applyTipScale() {
    const zoom = clamp(this.tipScale, 0.9, 2.2);
    const payload = { tipScale: zoom };
    for (const win of this.windows.values()) {
      if (!win || win.isDestroyed()) continue;
      try {
        win.webContents.send("overlay:tip-scale", payload);
      } catch {
        /* ignore */
      }
    }
    const tip = this.lootTip;
    if (tip && !tip.isDestroyed()) {
      try {
        tip.webContents.setZoomFactor(1);
      } catch {
        /* ignore */
      }
      try {
        tip.webContents.send("overlay:tip-scale", payload);
      } catch {
        /* ignore */
      }
    }
  }

  beginMove(id, options = {}) {
    const allowWhileLocked = Boolean(options?.allowWhileLocked);
    if (this.locked && !allowWhileLocked) return false;
    const win = this.windows.get(id);
    if (!win || win.isDestroyed()) return false;
    let point;
    try {
      point = screen.getCursorScreenPoint();
    } catch {
      return false;
    }
    this.endResize();
    this.moveDrag = {
      id,
      startPoint: point,
      startBounds: win.getBounds(),
      allowWhileLocked,
    };
    win.setIgnoreMouseEvents(false);
    this.edgeInteractive.add(id);
    if (!this.moveTimer) {
      this.moveTimer = setInterval(() => this.#tickMove(), 16);
    }
    return true;
  }

  endMove() {
    const drag = this.moveDrag;
    this.moveDrag = null;
    if (this.moveTimer) {
      clearInterval(this.moveTimer);
      this.moveTimer = null;
    }
    if (!drag) return;
    const win = this.windows.get(drag.id);
    if (win && !win.isDestroyed() && this.locked) {
      win.setIgnoreMouseEvents(true, { forward: true });
      this.edgeInteractive.delete(drag.id);
    }
  }

  #tickMove() {
    const drag = this.moveDrag;
    if (!drag) return;
    const win = this.windows.get(drag.id);
    if (!win || win.isDestroyed()) {
      this.endMove();
      return;
    }
    let point;
    try {
      point = screen.getCursorScreenPoint();
    } catch {
      return;
    }
    const x = drag.startBounds.x + (point.x - drag.startPoint.x);
    const y = drag.startBounds.y + (point.y - drag.startPoint.y);
    win.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: drag.startBounds.width,
      height: drag.startBounds.height,
    });
  }

  beginResize(id, edge) {
    if (this.locked) return false;
    const win = this.windows.get(id);
    if (!win || win.isDestroyed() || !edge) return false;
    this.endMove();
    let point;
    try {
      point = screen.getCursorScreenPoint();
    } catch {
      return false;
    }
    this.resizeDrag = {
      id,
      edge: String(edge),
      startPoint: point,
      startBounds: win.getBounds(),
    };
    win.setIgnoreMouseEvents(false);
    if (!this.resizeTimer) {
      this.resizeTimer = setInterval(() => this.#tickResize(), 16);
    }
    return true;
  }

  endResize() {
    const drag = this.resizeDrag;
    this.resizeDrag = null;
    if (this.resizeTimer) {
      clearInterval(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (!drag) return;
    const win = this.windows.get(drag.id);
    if (win && !win.isDestroyed() && this.locked) {
      win.setIgnoreMouseEvents(true, { forward: true });
      this.edgeInteractive.delete(drag.id);
    }
  }

  #tickResize() {
    const drag = this.resizeDrag;
    if (!drag) return;
    const win = this.windows.get(drag.id);
    if (!win || win.isDestroyed()) {
      this.endResize();
      return;
    }
    let point;
    try {
      point = screen.getCursorScreenPoint();
    } catch {
      return;
    }
    const dx = point.x - drag.startPoint.x;
    const dy = point.y - drag.startPoint.y;
    const compact = this.isCompact(drag.id) || drag.id === "dock-bar";
    const fab = this.isFab(drag.id);
    const mins = fab
      ? fabMins()
      : compact
        ? compactMins(drag.id)
        : normalMins(drag.id);
    const minW = mins.minWidth;
    const minH = mins.minHeight;
    let { x, y, width, height } = drag.startBounds;
    if (drag.edge.includes("e")) width = drag.startBounds.width + dx;
    if (drag.edge.includes("s")) height = drag.startBounds.height + dy;
    if (drag.edge.includes("w")) {
      width = drag.startBounds.width - dx;
      x = drag.startBounds.x + dx;
    }
    if (drag.edge.includes("n")) {
      height = drag.startBounds.height - dy;
      y = drag.startBounds.y + dy;
    }
    if (width < minW) {
      if (drag.edge.includes("w")) x -= minW - width;
      width = minW;
    }
    if (height < minH) {
      if (drag.edge.includes("n")) y -= minH - height;
      height = minH;
    }
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
    this.#applyScale(drag.id);
  }

  list() {
    return [...this.windows.entries()].map(([id, win]) => ({
      id,
      open: Boolean(win && !win.isDestroyed()),
    }));
  }

  isOpen(id) {
    const win = this.windows.get(id);
    return Boolean(win && !win.isDestroyed());
  }

  refitAll() {
    for (const [id, win] of this.windows.entries()) {
      if (!win || win.isDestroyed()) continue;
      this.#ensureOnScreen(id, win);
    }
  }

  #ensureOnScreen(id, win, options = {}) {
    if (!win || win.isDestroyed()) return;
    const current = win.getBounds();
    const compact = this.isCompact(id) || id === "dock-bar";
    const fab = this.isFab(id);
    const mins = fab
      ? fabMins()
      : compact
        ? compactMins(id)
        : {
            minWidth: options.minWidth || normalMins(id).minWidth,
            minHeight: options.minHeight || normalMins(id).minHeight,
          };
    const fitted = fitHudBounds(
      current,
      {
        x: options.x,
        y: options.y,
        width: options.width || current.width,
        height: options.height || current.height,
      },
      {
        minWidth: mins.minWidth,
        minHeight: mins.minHeight,
      },
    );
    if (sameBounds(current, fitted)) return;
    win.setBounds(fitted);
    this.#rememberBounds(id, fitted);
    this.#emitBounds(id, fitted);
  }

  open(id, options = {}) {
    this.watchDisplays();
    // Always open expanded — name-chip is opt-in after the window is visible.
    if (this.hudFab[id]) {
      this.hudFab[id] = false;
      if (typeof this.onFabMapChanged === "function") {
        this.onFabMapChanged({ ...this.hudFab });
      }
    }
    if (this.isOpen(id)) {
      const existing = this.windows.get(id);
      this.#ensureOnScreen(id, existing, options);
      existing.show();
      existing.focus();
      return existing;
    }

    const compact = this.isCompact(id) || id === "dock-bar";
    const fab = this.isFab(id);
    const mins = fab
      ? fabMins()
      : compact
        ? compactMins(id)
        : {
            minWidth: options.minWidth || normalMins(id).minWidth,
            minHeight: options.minHeight || normalMins(id).minHeight,
          };
    const mode = fab ? "fab" : compact ? "compact" : "normal";
    const modeBounds = this.#boundsForMode(id, mode) || {};
    const saved = modeBounds.width ? modeBounds : this.savedBounds[id] || {};
    const fitted = fitHudBounds(
      {
        x: saved.x,
        y: saved.y,
        width: saved.width,
        height: saved.height,
      },
      {
        x: options.x,
        y: options.y,
        width:
          options.width ||
          (fab ? FAB_SIZES[id]?.width : compact ? COMPACT_SIZES[id]?.width : 360) ||
          360,
        height:
          options.height ||
          (fab ? FAB_SIZES[id]?.height : compact ? COMPACT_SIZES[id]?.height : 280) ||
          280,
      },
      {
        minWidth: mins.minWidth,
        minHeight: mins.minHeight,
      },
    );
    if (!this.baseSizes[id]) {
      this.baseSizes[id] = {
        width: options.width || fitted.width,
        height: options.height || fitted.height,
      };
    }
    const win = new BrowserWindow({
      width: fitted.width,
      height: fitted.height,
      x: fitted.x,
      y: fitted.y,
      minWidth: mins.minWidth,
      minHeight: mins.minHeight,
      frame: false,
      transparent: true,
      roundedCorners: false,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: "#00000000",
      title: options.title || "Spiritvale Overlay",
      webPreferences: {
        preload: HUD_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    win.setAlwaysOnTop(true, "screen-saver", 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(this.locked, { forward: true });
    win.setOpacity(this.opacity);
    win.loadFile(hudPath(id));
    win.webContents.on("did-finish-load", () => {
      this.#applyScale(id);
      this.#applyHudLook();
      this.#ensureOnScreen(id, win, options);
      try {
        win.webContents.send("overlay:locked", { locked: this.locked });
      } catch {
        /* ignore */
      }
      // Never reopen in name-chip form — always start expanded (easy to find).
      if (this.hudFab[id]) {
        this.hudFab[id] = false;
      }
      win.webContents.send("overlay:hud-fab", {
        id,
        enabled: false,
        map: { ...this.hudFab },
      });
      if (this.isCompact(id)) this.applyCompact(id, true);
      else {
        win.webContents.send("overlay:hud-compact", {
          id,
          enabled: false,
          map: { ...this.hudCompact },
        });
      }
    });
    if (!sameBounds(saved, fitted)) {
      this.#rememberBounds(id, fitted);
      this.#emitBounds(id, fitted);
    }

    const persist = () => {
      if (!win || win.isDestroyed()) return;
      // Don't persist the temporary tall bounds used while the gear menu is open.
      if (this.menuSpace.has(id)) return;
      const bounds = win.getBounds();
      this.#rememberBounds(id, bounds);
      this.#applyScale(id);
      this.#emitBounds(id, bounds);
      if (id === "farm" || id === "loot-meter" || id === "loot-finds") this.#repositionLootTip();
    };
    win.on("moved", persist);
    win.on("resized", persist);
    win.on("closed", () => {
      // Only drop the map entry if it still points at this window (a quick
      // reopen can otherwise lose the replacement BrowserWindow).
      if (this.windows.get(id) === win) this.windows.delete(id);
      this.edgeInteractive.delete(id);
      this.menuSpace.delete(id);
      if (id === "farm" || id === "loot-meter" || id === "loot-finds") this.hideLootTip();
      if (id === "dock-bar") this.hideDockMenu();
      if (typeof this.onClosed === "function") this.onClosed(id);
      this.#syncEdgePolling();
    });
    this.windows.set(id, win);
    this.#syncEdgePolling();
    return win;
  }

  close(id) {
    if (id === "farm" || id === "loot-meter" || id === "loot-finds") this.hideLootTip();
    const win = this.windows.get(id);
    this.windows.delete(id);
    this.edgeInteractive.delete(id);
    if (win && !win.isDestroyed()) win.close();
    this.#syncEdgePolling();
  }

  closeAll() {
    this.hideLootTip();
    for (const id of [...this.windows.keys()]) this.close(id);
  }

  broadcast(channel, payload) {
    for (const win of this.windows.values()) {
      if (!win || win.isDestroyed()) continue;
      win.webContents.send(channel, payload);
    }
  }

  restack() {
    for (const win of this.windows.values()) {
      if (!win || win.isDestroyed()) continue;
      win.setAlwaysOnTop(true, "screen-saver", 1);
      try {
        win.moveTop();
      } catch {
        /* ignore */
      }
    }
    if (this.lootTip && !this.lootTip.isDestroyed()) {
      this.lootTip.setAlwaysOnTop(true, "screen-saver", 1);
    }
    this.#raiseDockMenu();
  }

  #raiseDockMenu() {
    const menu = this.dockMenu;
    if (!menu || menu.isDestroyed() || !menu.isVisible()) return;
    try {
      // Higher relativeLevel than HUD windows (1) so the dropdown isn't buried.
      menu.setAlwaysOnTop(true, "screen-saver", 5);
      menu.moveTop();
    } catch {
      /* ignore */
    }
  }

  setLocked(locked) {
    this.locked = Boolean(locked);
    for (const [id, win] of this.windows.entries()) {
      if (!win || win.isDestroyed()) continue;
      if (!this.locked) {
        win.setIgnoreMouseEvents(false);
        this.edgeInteractive.delete(id);
      } else {
        win.setIgnoreMouseEvents(true, { forward: true });
        this.edgeInteractive.delete(id);
      }
    }
    if (this.lootTip && !this.lootTip.isDestroyed()) {
      this.lootTip.setIgnoreMouseEvents(true, { forward: true });
    }
    this.broadcast("overlay:locked", { locked: this.locked });
    this.#syncEdgePolling();
  }

  /** When locked, only chrome hits (reset / close / settings) temporarily accept mouse. */
  setChromeInteractive(id, interactive) {
    const win = this.windows.get(id);
    if (!win || win.isDestroyed()) return false;
    if (!this.locked || this.moveDrag || this.resizeDrag) return false;
    if (interactive) {
      this.edgeInteractive.add(id);
      win.setIgnoreMouseEvents(false);
    } else {
      this.edgeInteractive.delete(id);
      win.setIgnoreMouseEvents(true, { forward: true });
    }
    return true;
  }

  setOpacity(opacity) {
    this.opacity = Math.min(1, Math.max(0.35, Number(opacity) || 0.96));
    for (const win of this.windows.values()) {
      if (!win || win.isDestroyed()) continue;
      win.setOpacity(this.opacity);
    }
    if (this.lootTip && !this.lootTip.isDestroyed()) {
      this.lootTip.setOpacity(this.opacity);
    }
  }

  setCompactMap(map = {}) {
    this.hudCompact = map && typeof map === "object" ? { ...map } : {};
  }

  setFabMap(map = {}) {
    this.hudFab = map && typeof map === "object" ? { ...map } : {};
  }

  getFabMap() {
    return { ...this.hudFab };
  }

  isCompact(id) {
    return Boolean(this.hudCompact?.[id]);
  }

  isFab(id) {
    return Boolean(this.hudFab?.[id]);
  }

  #applyModeSize(id, entering) {
    const win = this.windows.get(id);
    if (!win || win.isDestroyed()) return null;
    const cur = win.getBounds();
    const saved = this.#boundsForMode(id, entering);
    const mins =
      entering === "fab"
        ? fabMins()
        : entering === "compact"
          ? compactMins(id)
          : normalMins(id);
    const minW = mins.minWidth;
    const minH = mins.minHeight;
    win.setMinimumSize(minW, minH);

    let width = Number(saved?.width) || 0;
    let height = Number(saved?.height) || 0;
    // Name chips always use FAB_SIZES — never restore undersized legacy fab bounds.
    if (entering === "fab" && FAB_SIZES[id]) {
      width = FAB_SIZES[id].width;
      height = FAB_SIZES[id].height;
    } else if (!(width && height)) {
      if (entering === "compact" && COMPACT_SIZES[id]) {
        width = COMPACT_SIZES[id].width;
        height = COMPACT_SIZES[id].height;
      } else if (entering === "normal" && DEFAULT_NORMAL_SIZES[id]) {
        width = DEFAULT_NORMAL_SIZES[id].width;
        height = DEFAULT_NORMAL_SIZES[id].height;
      } else {
        width = Math.max(cur.width, minW);
        height = Math.max(cur.height, minH);
      }
    }
    if (entering === "normal" && height < normalMins(id).minHeight) {
      height = DEFAULT_NORMAL_SIZES[id]?.height || normalMins(id).minHeight;
      width = Math.max(width, DEFAULT_NORMAL_SIZES[id]?.width || normalMins(id).minWidth);
    }
    width = Math.max(minW, width);
    height = Math.max(minH, height);

    const fitted = fitHudBounds(
      { x: cur.x, y: cur.y, width, height },
      cur,
      { minWidth: minW, minHeight: minH },
    );
    if (!sameBounds(cur, fitted)) win.setBounds(fitted, false);
    const after = win.getBounds();
    this.#rememberBounds(id, after, entering);
    this.#applyScale(id);
    this.#emitBounds(id, after);
    return after;
  }

  applyCompact(id, enabled) {
    const next = Boolean(enabled);
    const wasCompact = Boolean(this.hudCompact[id]);
    const wasFab = Boolean(this.hudFab[id]);
    const leaving = wasFab ? "fab" : wasCompact ? "compact" : "normal";
    this.hudCompact[id] = next;
    if (next && wasFab) this.hudFab[id] = false;
    this.broadcast("overlay:hud-compact", { id, enabled: next, map: { ...this.hudCompact } });
    if (next && wasFab) {
      this.broadcast("overlay:hud-fab", { id, enabled: false, map: { ...this.hudFab } });
    }
    const win = this.windows.get(id);
    if (!win || win.isDestroyed()) return this.hudCompact;

    const cur = win.getBounds();
    if (leaving !== (next ? "compact" : "normal") || wasFab) {
      this.#rememberBounds(id, cur, leaving);
    }
    this.#applyModeSize(id, next ? "compact" : "normal");
    return this.hudCompact;
  }

  applyFab(id, enabled) {
    const next = Boolean(enabled);
    const wasFab = Boolean(this.hudFab[id]);
    const wasCompact = Boolean(this.hudCompact[id]);
    const leaving = wasFab ? "fab" : wasCompact ? "compact" : "normal";
    this.hudFab[id] = next;
    if (next && wasCompact) this.hudCompact[id] = false;
    this.broadcast("overlay:hud-fab", { id, enabled: next, map: { ...this.hudFab } });
    if (next && wasCompact) {
      this.broadcast("overlay:hud-compact", { id, enabled: false, map: { ...this.hudCompact } });
    }
    const win = this.windows.get(id);
    if (!win || win.isDestroyed()) return this.hudFab;

    const cur = win.getBounds();
    if (leaving !== (next ? "fab" : "normal") || wasCompact) {
      this.#rememberBounds(id, cur, leaving);
    }
    this.#applyModeSize(id, next ? "fab" : "normal");
    return this.hudFab;
  }

  applyCompactMap(map = {}) {
    this.setCompactMap(map);
    for (const [id, enabled] of Object.entries(this.hudCompact)) {
      this.applyCompact(id, enabled);
    }
    return this.hudCompact;
  }

  applyFabMap(map = {}) {
    this.setFabMap(map);
    for (const [id, enabled] of Object.entries(this.hudFab)) {
      this.applyFab(id, enabled);
    }
    return this.hudFab;
  }

  #syncEdgePolling() {
    // Locked = true click-through. Chrome interactivity is driven by HUD
    // setChromeInteractive (forwarded mouse hits), not full-window unlock.
    if (this.edgeTimer) {
      clearInterval(this.edgeTimer);
      this.edgeTimer = null;
    }
  }

  #pollEdges() {
    /* retained no-op — full-window unlock on hover broke click-through */
  }

  #ensureLootTip() {
    if (this.lootTip && !this.lootTip.isDestroyed()) return this.lootTip;
    const win = new BrowserWindow({
      width: 300,
      height: 200,
      show: false,
      frame: false,
      transparent: true,
      roundedCorners: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      focusable: false,
      backgroundColor: "#00000000",
      title: "Loot Tip",
      webPreferences: {
        preload: HUD_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setAlwaysOnTop(true, "screen-saver", 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setOpacity(this.opacity);
    win.loadFile(hudPath("loot-tip"));
    win.webContents.on("did-finish-load", () => {
      this.#applyTipScale();
      this.#applyHudLook();
    });
    win.on("closed", () => {
      this.lootTip = null;
    });
    this.lootTip = win;
    return win;
  }

  #lootTipAnchor(preferredWin = null) {
    if (preferredWin && !preferredWin.isDestroyed() && [...this.windows.values()].includes(preferredWin)) {
      return preferredWin;
    }
    for (const id of ["loot-finds", "loot-meter", "farm"]) {
      const win = this.windows.get(id);
      if (win && !win.isDestroyed()) return win;
    }
    return null;
  }

  #repositionLootTip(preferredWin = null) {
    if (!this.lootTip || this.lootTip.isDestroyed() || !this.lootTip.isVisible()) return;
    const anchor = this.#lootTipAnchor(preferredWin || this.lootTipPreferredWin || null);
    if (!anchor) return;
    const anchorBounds = anchor.getBounds();
    const display = currentWorkArea(anchorBounds);
    const tipBounds = this.lootTip.getBounds();
    let x = anchorBounds.x + anchorBounds.width + 8;
    let y = anchorBounds.y + 28;
    if (x + tipBounds.width > display.x + display.width) {
      x = Math.max(display.x, anchorBounds.x - tipBounds.width - 8);
    }
    if (y + tipBounds.height > display.y + display.height) {
      y = Math.max(display.y, display.y + display.height - tipBounds.height);
    }
    this.lootTip.setPosition(Math.round(x), Math.round(y), false);
  }

  showLootTip(html, preferredWin = null) {
    if (preferredWin && !preferredWin.isDestroyed()) this.lootTipPreferredWin = preferredWin;
    if (!this.#lootTipAnchor(preferredWin)) return false;
    const tip = this.#ensureLootTip();
    const payload = { html: String(html || "") };
    const send = () => {
      if (!tip || tip.isDestroyed()) return;
      tip.webContents.send("overlay:loot-tip", payload);
      this.#repositionLootTip(preferredWin);
      if (!tip.isVisible()) tip.showInactive();
    };
    if (tip.webContents.isLoading()) {
      tip.webContents.once("did-finish-load", send);
    } else {
      send();
    }
    return true;
  }

  fitLootTip(size = {}) {
    const tip = this.lootTip;
    if (!tip || tip.isDestroyed()) return false;
    const anchor = this.#lootTipAnchor(this.lootTipPreferredWin || null);
    const area = currentWorkArea(anchor ? anchor.getBounds() : null);
    const width = clamp(Math.ceil(Number(size.width) || 300), 220, Math.max(220, area.width - 16));
    const height = clamp(Math.ceil(Number(size.height) || 120), 72, Math.max(72, area.height - 16));
    const pos = tip.getBounds();
    tip.setBounds({ x: pos.x, y: pos.y, width, height }, false);
    this.#repositionLootTip();
    return true;
  }

  hideLootTip() {
    this.lootTipPreferredWin = null;
    if (!this.lootTip || this.lootTip.isDestroyed()) return;
    this.lootTip.hide();
    try {
      this.lootTip.webContents.send("overlay:loot-tip", { html: "" });
    } catch {
      /* ignore */
    }
  }

  #ensureDockMenu() {
    if (this.dockMenu && !this.dockMenu.isDestroyed()) return this.dockMenu;
    const win = new BrowserWindow({
      width: 260,
      height: 320,
      show: false,
      frame: false,
      transparent: true,
      roundedCorners: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      focusable: true,
      backgroundColor: "#00000000",
      title: "Dock Settings",
      webPreferences: {
        preload: HUD_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setAlwaysOnTop(true, "screen-saver", 5);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setOpacity(this.opacity);
    win.loadFile(hudPath("dock-menu"));
    win.on("blur", () => {
      // Let checkbox interactions settle, then close if focus left the menu.
      setTimeout(() => {
        if (!this.dockMenu || this.dockMenu.isDestroyed()) return;
        if (!this.dockMenu.isFocused()) this.hideDockMenu();
      }, 140);
    });
    win.on("closed", () => {
      this.dockMenu = null;
      this.dockMenuAnchor = null;
    });
    this.dockMenu = win;
    return win;
  }

  showDockMenu(payload = {}, preferredWin = null) {
    if (preferredWin && !preferredWin.isDestroyed()) this.dockMenuAnchor = preferredWin;
    const menu = this.#ensureDockMenu();
    const x = Number(payload.x);
    const y = Number(payload.y);
    const html = String(payload.html || "");
    const include = payload.include && typeof payload.include === "object" ? payload.include : {};
    const display = payload.display && typeof payload.display === "object" ? payload.display : {};

    const send = () => {
      if (!menu || menu.isDestroyed()) return;
      try {
        menu.webContents.send("overlay:dock-menu", {
          kind: payload.kind === "hud" ? "hud" : "dock",
          hudId: String(payload.hudId || ""),
          html,
          include,
          display,
          state: payload.state && typeof payload.state === "object" ? payload.state : null,
        });
      } catch {
        /* ignore */
      }
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const area = currentWorkArea({ x, y, width: 260, height: 320 });
        const width = menu.getBounds().width || 260;
        const height = menu.getBounds().height || 320;
        let nextX = Math.round(x);
        let nextY = Math.round(y);
        if (nextX + width > area.x + area.width) nextX = Math.max(area.x, area.x + area.width - width);
        if (nextY + height > area.y + area.height) nextY = Math.max(area.y, y - height - 8);
        menu.setPosition(nextX, nextY, false);
      }
      if (!menu.isVisible()) menu.show();
      this.#raiseDockMenu();
      try {
        menu.focus();
      } catch {
        /* ignore */
      }
    };

    if (menu.webContents.isLoading()) {
      menu.webContents.once("did-finish-load", send);
    } else {
      send();
    }
    return true;
  }

  fitDockMenu(size = {}) {
    const menu = this.dockMenu;
    if (!menu || menu.isDestroyed()) return false;
    const width = clamp(Math.ceil(Number(size.width) || 260), 220, 420);
    const height = clamp(Math.ceil(Number(size.height) || 200), 120, 640);
    const cur = menu.getBounds();
    const area = currentWorkArea(cur);
    let x = cur.x;
    let y = cur.y;
    if (x + width > area.x + area.width) x = Math.max(area.x, area.x + area.width - width);
    if (y + height > area.y + area.height) y = Math.max(area.y, area.y + area.height - height);
    menu.setBounds({ x: Math.round(x), y: Math.round(y), width, height }, false);
    this.#raiseDockMenu();
    return true;
  }

  hideDockMenu() {
    this.dockMenuAnchor = null;
    if (!this.dockMenu || this.dockMenu.isDestroyed()) return;
    this.dockMenu.hide();
    try {
      this.dockMenu.webContents.send("overlay:dock-menu", { html: "" });
    } catch {
      /* ignore */
    }
  }

  isDockMenuOpen() {
    return Boolean(this.dockMenu && !this.dockMenu.isDestroyed() && this.dockMenu.isVisible());
  }

  /**
   * Grow a HUD window so an in-overlay gear menu isn't clipped by compact strip height.
   * Restores prior bounds when closed. Skips layout persistence while open.
   */
  setHudMenuSpace(id, open, size = {}) {
    const win = this.windows.get(id);
    if (!win || win.isDestroyed()) return false;

    if (!open) {
      const restore = this.menuSpace.get(id);
      this.menuSpace.delete(id);
      if (!restore) return true;
      const compact = this.isCompact(id) || id === "dock-bar";
      try {
        win.setMinimumSize(
          compact ? MIN_COMPACT_W : MIN_HUD_W,
          compact ? MIN_COMPACT_H : MIN_HUD_H,
        );
      } catch {
        /* ignore */
      }
      const area = currentWorkArea(restore);
      const width = clamp(restore.width, compact ? MIN_COMPACT_W : MIN_HUD_W, area.width);
      const height = clamp(restore.height, compact ? MIN_COMPACT_H : MIN_HUD_H, area.height);
      let x = restore.x;
      let y = restore.y;
      if (x + width > area.x + area.width) x = Math.max(area.x, area.x + area.width - width);
      if (y + height > area.y + area.height) y = Math.max(area.y, area.y + area.height - height);
      win.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }, false);
      return true;
    }

    const cur = win.getBounds();
    if (!this.menuSpace.has(id)) {
      this.menuSpace.set(id, { x: cur.x, y: cur.y, width: cur.width, height: cur.height });
    }
    const base = this.menuSpace.get(id);
    const area = currentWorkArea(cur);
    const width = clamp(
      Math.max(base.width, Math.ceil(Number(size.width) || base.width)),
      MIN_COMPACT_W,
      area.width,
    );
    const height = clamp(
      Math.max(base.height, Math.ceil(Number(size.height) || 360), 280),
      MIN_COMPACT_H,
      area.height,
    );
    let x = base.x;
    let y = base.y;
    if (x + width > area.x + area.width) x = Math.max(area.x, area.x + area.width - width);
    if (y + height > area.y + area.height) y = Math.max(area.y, area.y + area.height - height);
    try {
      win.setMinimumSize(MIN_COMPACT_W, MIN_COMPACT_H);
    } catch {
      /* ignore */
    }
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }, false);
    return true;
  }
}

module.exports = { OverlayHudManager };
