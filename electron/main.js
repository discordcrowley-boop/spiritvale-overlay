const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } = require("electron");
const fs = require("fs");
const path = require("path");
const overlay = require("./overlay-service");
const { OverlayEngine } = require("./overlay-engine");
const { OverlayHudManager } = require("./overlay-hud-manager");
const { OverlayLiveBridge } = require("./overlay-live-bridge");
const { SessionTimer } = require("./session-timer");
const { NightModeManager } = require("./night-mode");
const { MouseIndicatorManager } = require("./mouse-indicator");
const sessionLog = require("./overlay-session-log");
const itemCatalog = require("./item-catalog-service");

const APP_TITLE = "Spiritvale Overlay";
const DEFAULT_BOUNDS = { width: 1180, height: 900 };
const BACKGROUND = "#0b0f0e";

app.setName(APP_TITLE);

let mainWindow = null;
let tray = null;
let isQuitting = false;
const views = {};
const overlayEngine = new OverlayEngine();
const overlayLive = new OverlayLiveBridge();
const overlayHuds = new OverlayHudManager({
  onClosed: () => {
    const meterIds = new Set([
      "spiritist-meter",
      "loot-meter",
      "kill-counter",
      "exp-meter",
      "pets-meter",
      "session-timer",
      "dock-bar",
    ]);
    const anyMeterOpen = overlayHuds
      .list()
      .some((row) => row.open && meterIds.has(row.id));
    if (!anyMeterOpen && overlayEngine.running) {
      // Closed last meter via X — release capture so per-card Start works again.
      stopOverlay().catch(() => {});
      return;
    }
    broadcastOverlayStatus();
  },
  onBoundsChanged: (id, bounds, meta = {}) => {
    const prefs = overlay.loadOverlayPrefs();
    const hudBounds = { ...(prefs.hudBounds || {}), [id]: bounds };
    const hudLayoutBounds =
      meta.layoutBounds != null
        ? meta.layoutBounds
        : { ...(prefs.hudLayoutBounds || {}) };
    overlay.saveOverlayPrefs({ hudBounds, hudLayoutBounds });
  },
  onFabMapChanged: (hudFab) => {
    overlay.saveOverlayPrefs({ hudFab: { ...(hudFab || {}) } });
  },
  onHudPrefsChanged: ({ hudScales, hudOptions, tipScale, hudLook, hudCorners }) => {
    overlay.saveOverlayPrefs({ hudScales, hudOptions, tipScale, hudLook, hudCorners });
  },
});
const sessionTimer = new SessionTimer();
sessionTimer.on("changed", (snap, meta) => {
  overlayHuds.broadcast("overlay:timer", snap);
  if (meta?.pauseChanged && overlayEngine.mode === "live") {
    overlayLive.setPaused(snap.overlaysPaused);
  }
});

function broadcastNightMode(state) {
  overlayHuds.broadcast("overlay:night-mode", state);
  if (views.overlay && !views.overlay.webContents.isDestroyed()) {
    views.overlay.webContents.send("overlay:night-mode", state);
  }
}

const nightMode = new NightModeManager({
  onChanged: (state) => {
    overlay.saveOverlayPrefs({
      nightMode: state.enabled,
      nightDim: state.dim,
    });
    broadcastNightMode(state);
    if (state.enabled) overlayHuds.restack();
  },
  onStatus: (state) => {
    broadcastNightMode(state);
    if (state.enabled) overlayHuds.restack();
  },
  onRestack: () => overlayHuds.restack(),
});

function broadcastMouseIndicator(state) {
  if (views.overlay && !views.overlay.webContents.isDestroyed()) {
    views.overlay.webContents.send("overlay:mouse-indicator", state);
  }
}

const mouseIndicator = new MouseIndicatorManager({
  onChanged: (state) => {
    overlay.saveOverlayPrefs({
      mouseIndicator: state.enabled,
      mouseIndicatorStyle: state.styleId,
      mouseIndicatorAnimate: state.animate,
      mouseIndicatorFlash: state.flash,
    });
    broadcastMouseIndicator(state);
  },
  onStatus: (state) => {
    broadcastMouseIndicator(state);
  },
});

const HUD_LAYOUT = {
  "spiritist-meter": { title: "Meters!", width: 380, height: 720, minWidth: 280, minHeight: 360, xOffset: 24 },
  "loot-meter": { title: "Gold!", width: 280, height: 180, minWidth: 220, minHeight: 150, xOffset: 420 },
  "kill-counter": { title: "Kills!", width: 280, height: 360, minWidth: 220, minHeight: 220, xOffset: 720 },
  "exp-meter": { title: "Exp!", width: 300, height: 340, minWidth: 240, minHeight: 160, xOffset: 1000 },
  "pets-meter": { title: "Pets!", width: 300, height: 320, minWidth: 240, minHeight: 180, xOffset: 1320 },
  "session-timer": { title: "Timer!", width: 260, height: 96, minWidth: 110, minHeight: 44, xOffset: 24, yOffset: 24 },
  "dock-bar": { title: "Dock", width: 920, height: 52, minWidth: 160, minHeight: 24, xOffset: 24, yOffset: 24 },
  "loot-finds": { title: "Loot!", width: 360, height: 520, minWidth: 260, minHeight: 280, xOffset: 1280 },
  "dps-meter": { title: "Damage Done", width: 310, height: 280, xOffset: 24 },
  buffs: { title: "Effects", width: 260, height: 200, xOffset: 350 },
  deaths: { title: "Monster Kills", width: 300, height: 320, xOffset: 24, yOffset: 380 },
  farm: { title: "Loot", width: 560, height: 420, xOffset: 630 },
  casts: { title: "Enemy Casts", width: 280, height: 220, xOffset: 350, yOffset: 300 },
  boss: { title: "Boss", width: 280, height: 220, xOffset: 650, yOffset: 360 },
  tower: { title: "Tower", width: 260, height: 260, xOffset: 1000 },
};

function layoutTitle(id) {
  return HUD_LAYOUT[id]?.title || id;
}

function broadcastOverlayTick(snapshot) {
  // HUD windows need the live tick. The Overlay settings page must NOT full-refresh
  // on every tick — that rebuilds Start/Stop buttons and makes them nearly unclickable.
  overlayHuds.broadcast("overlay:tick", snapshot);
}

function broadcastOverlayStatus(extra = {}) {
  if (!views.overlay || views.overlay.webContents.isDestroyed()) return;
  try {
    views.overlay.webContents.send("overlay:status-changed", {
      running: overlayEngine.running,
      mode: overlayEngine.mode,
      openHuds: overlayHuds.list().filter((row) => row.open).map((row) => row.id),
      capture: overlayEngine.getSnapshot()?.capture || null,
      live: overlayLive.getStatus(),
      ...extra,
    });
  } catch {
    /* ignore */
  }
}

overlayEngine.on("tick", broadcastOverlayTick);
overlayEngine.on("status", (snapshot) => {
  broadcastOverlayTick(snapshot);
  broadcastOverlayStatus();
});

let liveResetUntil = 0;
let liveEnrichSeq = 0;
let lastDetectedPersonalName = "";

function rememberDetectedPersonalName(name) {
  const next = String(name || "").trim();
  if (!next || next === lastDetectedPersonalName) return;
  lastDetectedPersonalName = next;
  try {
    overlay.saveOverlayPrefs({ personalName: next });
  } catch {
    /* ignore */
  }
  if (views.overlay && !views.overlay.webContents.isDestroyed()) {
    try {
      views.overlay.webContents.send("overlay:identity", { personalName: next, auto: true });
    } catch {
      /* ignore */
    }
  }
}

overlayLive.on("identity", (msg) => {
  rememberDetectedPersonalName(msg?.personalName);
});

overlayLive.on("snapshot", (snap) => {
  if (Date.now() < liveResetUntil) return;
  rememberDetectedPersonalName(snap?.capture?.personalName);
  const seq = ++liveEnrichSeq;
  // Apply the raw capture immediately so gold never waits on wiki enrichment.
  overlayEngine.applyLiveSnapshot(snap);
  itemCatalog
    .enrichSnapshot(snap)
    .then((enriched) => {
      if (seq !== liveEnrichSeq) return;
      overlayEngine.applyLiveSnapshot(enriched);
    })
    .catch(() => {
      /* raw snapshot already applied */
    });
});
overlayLive.on("reset", () => {
  liveResetUntil = Date.now() + 750;
  const snap = overlayEngine.resetEncounter();
  broadcastOverlayTick(snap);
});
overlayLive.on("error", (err) => {
  broadcastOverlayStatus({ error: String(err.message || err) });
});

function openConfiguredHuds(panels, prefs = null, options = {}) {
  let display = screen.getPrimaryDisplay().workArea;
  try {
    display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  } catch {
    /* keep primary */
  }
  const dock = prefs?.hudDock || overlay.loadOverlayPrefs().hudDock || {};
  const include = dock.include || {};
  const resolved = { ...panels };
  const allowDock = options.allowDock !== false;
  if (allowDock && dock.enabled) {
    let anyDocked = false;
    for (const id of Object.keys(resolved)) {
      if (!resolved[id]) continue;
      if (include[id] === false) continue;
      if (id === "dock-bar" || id === "session-timer") continue;
      resolved[id] = false;
      anyDocked = true;
    }
    if (anyDocked) resolved["dock-bar"] = true;
  }
  for (const [id, enabled] of Object.entries(resolved)) {
    if (enabled === false) continue;
    const layout = HUD_LAYOUT[id];
    if (!layout) continue;
    overlayHuds.open(id, {
      title: layout.title,
      width: layout.width,
      height: layout.height,
      minWidth: layout.minWidth,
      minHeight: layout.minHeight,
      x: display.x + display.width - (layout.xOffset || 24) - layout.width,
      y: display.y + (layout.yOffset || 80),
    });
  }
  overlayHuds.restack();
}

async function startOverlay(options = {}) {
  const prefs = overlay.loadOverlayPrefs();
  overlayHuds.setSavedBounds(prefs.hudBounds || {});
  overlayHuds.setLayoutBounds(prefs.hudLayoutBounds || {});
  overlayHuds.setHudPrefs({
    scales: prefs.hudScales || {},
    options: prefs.hudOptions || {},
    tipScale: prefs.tipScale,
    hudLook: prefs.hudLook,
    hudCorners: prefs.hudCorners,
  });
  const mode = options.mode || prefs.captureMode || "live";
  const onlyHud = options.onlyHud ? String(options.onlyHud) : "";
  const startInclude = prefs.startInclude || {};
  // Start Overlay opens meters marked Include in Start. Per-card Start still works.
  const panels = onlyHud
    ? { [onlyHud]: true }
    : {
        "spiritist-meter": startInclude["spiritist-meter"] !== false,
        "loot-meter": startInclude["loot-meter"] !== false,
        "kill-counter": startInclude["kill-counter"] !== false,
        "exp-meter": startInclude["exp-meter"] !== false,
        // Opt-in only — default Start Overlay set stays meters-only.
        ...(startInclude["pets-meter"] === true ? { "pets-meter": true } : {}),
        ...(startInclude["session-timer"] === true ? { "session-timer": true } : {}),
        ...(options.panels || {}),
      };

  overlayHuds.setLocked(prefs.locked !== false);
  overlayHuds.setOpacity(prefs.opacity ?? 0.88);
  overlayHuds.setHudLook(prefs.hudLook);
  overlayHuds.setCompactMap(prefs.hudCompact || {});
  // Never restore name-chip collapse across app/session starts — hard to find.
  overlayHuds.setFabMap({});
  overlay.saveOverlayPrefs({ hudFab: {} });

  if (overlayEngine.running && onlyHud) {
    // Always allow opening another individual meter while capture is already live.
    openConfiguredHuds(panels, prefs, { allowDock: false });
    broadcastOverlayTick(overlayEngine.getSnapshot());
    broadcastOverlayStatus();
    const label = layoutTitle(onlyHud);
    return {
      ...overlayEngine.getSnapshot(),
      note: `${label} opened. Live capture is already running.`,
      live: overlayLive.getStatus(),
      openHuds: overlayHuds.list().filter((row) => row.open).map((row) => row.id),
    };
  }

  const snapshot = overlayEngine.start(mode);
  openConfiguredHuds(panels, prefs, { allowDock: !onlyHud });

  let note = null;
  if (mode === "live") {
    try {
      await overlayLive.start({
        // Hint only — worker still auto-detects from LoadCharacter; hint labels your bar immediately.
        personalName: prefs.personalName || "",
      });
      if (sessionTimer.overlaysPaused()) overlayLive.setPaused(true);
      note = onlyHud
        ? `${layoutTitle(onlyHud)} started. Enter SpiritVale — the window fills from live capture.`
        : "Live capture started. Meters!, Gold!, and Kills! are open — fight in SpiritVale to fill them.";
    } catch (err) {
      note = String(err.message || err);
      // Keep HUDs open so the user still sees the shell; live bridge reports the error.
    }
  }

  broadcastOverlayTick(overlayEngine.getSnapshot());
  broadcastOverlayStatus();
  return {
    ...overlayEngine.getSnapshot(),
    note,
    live: overlayLive.getStatus(),
  };
}

async function stopOverlay() {
  const snap = overlayEngine.getSnapshot();
  try {
    sessionLog.recordSession(snap, "stop");
  } catch {
    /* ignore */
  }
  await overlayLive.stop();
  overlayEngine.stop();
  overlayHuds.closeAll();
  const out = overlayEngine.getSnapshot();
  broadcastOverlayStatus();
  return out;
}

function iconPath() {
  return path.join(__dirname, "..", "assets", "icon.png");
}

function prefsPath() {
  return path.join(app.getPath("userData"), "window.json");
}

function loadWindowPrefs() {
  try {
    return JSON.parse(fs.readFileSync(prefsPath(), "utf8"));
  } catch {
    return {};
  }
}

function saveWindowPrefs(patch) {
  const next = { ...loadWindowPrefs(), ...patch };
  fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
  fs.writeFileSync(prefsPath(), JSON.stringify(next, null, 2));
  return next;
}

function sanitizeWindowBounds(bounds = {}) {
  const width = Math.max(820, Number(bounds.width) || DEFAULT_BOUNDS.width);
  const height = Math.max(600, Number(bounds.height) || DEFAULT_BOUNDS.height);
  const primary = screen.getPrimaryDisplay().workArea;
  const hasPos = Number.isInteger(bounds.x) && Number.isInteger(bounds.y);
  if (hasPos) {
    const rect = { x: bounds.x, y: bounds.y, width, height };
    const visible = screen.getAllDisplays().some((display) => {
      const a = display.workArea;
      const x = Math.min(rect.x + rect.width, a.x + a.width) - Math.max(rect.x, a.x);
      const y = Math.min(rect.y + rect.height, a.y + a.height) - Math.max(rect.y, a.y);
      return x > 160 && y > 120;
    });
    if (visible) return { ...rect, isMaximized: Boolean(bounds.isMaximized) };
  }
  const fitW = Math.min(width, primary.width);
  const fitH = Math.min(height, primary.height);
  return {
    width: fitW,
    height: fitH,
    x: primary.x + Math.max(0, Math.floor((primary.width - fitW) / 2)),
    y: primary.y + Math.max(0, Math.floor((primary.height - fitH) / 2)),
    isMaximized: Boolean(bounds.isMaximized),
  };
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function registerIpc() {
  ipcMain.handle("overlay:status", async () =>
    overlay.getOverlayStatus({
      running: overlayEngine.running,
      mode: overlayEngine.mode,
      openHuds: overlayHuds.list().filter((row) => row.open).map((row) => row.id),
      live: overlayLive.getStatus(),
      capture: overlayEngine.getSnapshot()?.capture || null,
      nightMode: nightMode.getState(),
      mouseIndicator: mouseIndicator.getState(),
    }),
  );
  ipcMain.handle("overlay:night-mode", async () => nightMode.getState());
  ipcMain.handle("overlay:set-night-mode", async (_event, patch) =>
    nightMode.setState(patch || {}),
  );
  ipcMain.handle("overlay:mouse-indicator", async () => mouseIndicator.getState());
  ipcMain.handle("overlay:set-mouse-indicator", async (_event, patch) =>
    mouseIndicator.setState(patch || {}),
  );
  ipcMain.handle("overlay:accept-policy", async () =>
    overlay.saveOverlayPrefs({ policyAccepted: true }),
  );
  ipcMain.handle("overlay:save-prefs", async (_event, patch) => {
    const next = overlay.saveOverlayPrefs(patch || {});
    if (patch && patch.hudLook != null) overlayHuds.setHudLook(patch.hudLook);
    if (patch && patch.hudCorners != null) overlayHuds.saveHudPrefs("dps-meter", { hudCorners: patch.hudCorners });
    return next;
  });
  ipcMain.handle("overlay:start", async (_event, options) =>
    startOverlay(options || {}),
  );
  ipcMain.handle("overlay:stop", async () => stopOverlay());
  ipcMain.handle("overlay:reset", async () => {
    try {
      sessionLog.recordSession(overlayEngine.getSnapshot(), "reset");
    } catch {
      /* ignore */
    }
    liveResetUntil = Date.now() + 1200;
    if (overlayEngine.mode === "live") overlayLive.reset();
    sessionTimer.command("restart");
    const snap = overlayEngine.resetEncounter();
    broadcastOverlayTick(snap);
    return snap;
  });
  ipcMain.handle("overlay:zero", async () => {
    liveResetUntil = Date.now() + 800;
    if (overlayEngine.mode === "live") overlayLive.zero();
    const snap = overlayEngine.zeroMeters();
    broadcastOverlayTick(snap);
    return snap;
  });
  ipcMain.handle("overlay:sessions", async () => sessionLog.listSessionsByDate());
  ipcMain.handle("overlay:clear-sessions", async () => {
    sessionLog.clearSessions();
    return sessionLog.listSessionsByDate();
  });
  ipcMain.handle("overlay:snapshot", async () => overlayEngine.getSnapshot());
  ipcMain.handle("overlay:timer", async () => sessionTimer.snapshot());
  ipcMain.handle("overlay:timer-command", async (_event, cmd, payload) =>
    sessionTimer.command(String(cmd || ""), payload || {}),
  );
  ipcMain.handle("overlay:set-locked", async (_event, locked) => {
    const next = Boolean(locked);
    overlay.saveOverlayPrefs({ locked: next });
    overlayHuds.setLocked(next);
    if (views.overlay && !views.overlay.webContents.isDestroyed()) {
      views.overlay.webContents.send("overlay:locked", { locked: next });
    }
    return true;
  });
  ipcMain.handle("overlay:set-opacity", async (_event, value) => {
    overlay.saveOverlayPrefs({ opacity: Number(value) });
    overlayHuds.setOpacity(Number(value));
    return true;
  });
  ipcMain.handle("overlay:set-hud-compact", async (_event, id, enabled) => {
    const prefs = overlay.loadOverlayPrefs();
    const hudCompact = { ...(prefs.hudCompact || {}), [String(id)]: Boolean(enabled) };
    const hudFab = { ...(prefs.hudFab || {}) };
    if (enabled) hudFab[String(id)] = false;
    overlay.saveOverlayPrefs({ hudCompact, hudFab });
    overlayHuds.setFabMap(hudFab);
    overlayHuds.applyCompact(String(id), Boolean(enabled));
    return hudCompact;
  });
  ipcMain.handle("overlay:hud-compact", async () => {
    const prefs = overlay.loadOverlayPrefs();
    return prefs.hudCompact || {};
  });
  ipcMain.handle("overlay:set-hud-fab", async (_event, id, enabled) => {
    const prefs = overlay.loadOverlayPrefs();
    const hudFab = { ...(prefs.hudFab || {}), [String(id)]: Boolean(enabled) };
    const hudCompact = { ...(prefs.hudCompact || {}) };
    if (enabled) hudCompact[String(id)] = false;
    overlay.saveOverlayPrefs({ hudFab, hudCompact });
    overlayHuds.setCompactMap(hudCompact);
    overlayHuds.applyFab(String(id), Boolean(enabled));
    return hudFab;
  });
  ipcMain.handle("overlay:hud-fab", async () => {
    // Live map only — prefs may still say collapsed, but opens always start expanded.
    return overlayHuds.getFabMap?.() || overlayHuds.hudFab || {};
  });
  ipcMain.handle("overlay:hud-dock", async () => {
    const prefs = overlay.loadOverlayPrefs();
    return prefs.hudDock || { enabled: false, include: {} };
  });
  ipcMain.handle("overlay:set-hud-dock", async (_event, patch) => {
    const prefs = overlay.loadOverlayPrefs();
    const prev = prefs.hudDock || {};
    const hudDock = {
      enabled: patch?.enabled != null ? Boolean(patch.enabled) : Boolean(prev.enabled),
      include: {
        ...(prev.include || {}),
        ...(patch?.include || {}),
      },
      display: {
        "spiritist-meter": {
          ...(prev.display?.["spiritist-meter"] || {}),
          ...(patch?.display?.["spiritist-meter"] || {}),
        },
        "loot-meter": {
          ...(prev.display?.["loot-meter"] || {}),
          ...(patch?.display?.["loot-meter"] || {}),
        },
        "kill-counter": {
          ...(prev.display?.["kill-counter"] || {}),
          ...(patch?.display?.["kill-counter"] || {}),
        },
        "exp-meter": {
          ...(prev.display?.["exp-meter"] || {}),
          ...(patch?.display?.["exp-meter"] || {}),
        },
        "pets-meter": {
          ...(prev.display?.["pets-meter"] || {}),
          ...(patch?.display?.["pets-meter"] || {}),
        },
      },
    };
    overlay.saveOverlayPrefs({ hudDock });
    overlayHuds.broadcast("overlay:hud-dock", hudDock);

    // Only reshuffle open windows when dock enable/include membership changes —
    // display field toggles should not close individual meters.
    const enableChanged = Boolean(prev.enabled) !== Boolean(hudDock.enabled);
    const includeChanged =
      JSON.stringify(prev.include || {}) !== JSON.stringify(hudDock.include || {});
    if (overlayEngine.running && (enableChanged || includeChanged)) {
      const panels = {
        "spiritist-meter": true,
        "loot-meter": true,
        "kill-counter": true,
        "exp-meter": true,
        "pets-meter": true,
      };
      if (hudDock.enabled) {
        for (const [id, inDock] of Object.entries(hudDock.include || {})) {
          if (inDock !== false && overlayHuds.isOpen(id)) overlayHuds.close(id);
        }
        openConfiguredHuds(panels, { ...prefs, hudDock });
      } else if (overlayHuds.isOpen("dock-bar")) {
        overlayHuds.close("dock-bar");
        openConfiguredHuds(panels, { ...prefs, hudDock });
      }
    }
    return hudDock;
  });
  ipcMain.handle("overlay:close-hud", async (_event, id) => {
    const hudId = String(id || "").trim();
    const meterIds = [
      "spiritist-meter",
      "loot-meter",
      "kill-counter",
      "exp-meter",
      "pets-meter",
    ];

    if (hudId) {
      // Always close a standalone window if it exists.
      overlayHuds.close(hudId);

      // If this meter is living inside the dock bar, pull it out of the dock.
      if (meterIds.includes(hudId) && overlayHuds.isOpen("dock-bar")) {
        const prefs = overlay.loadOverlayPrefs();
        const dock = prefs.hudDock || {};
        const include = { ...(dock.include || {}), [hudId]: false };
        const nextDock = { ...dock, include, enabled: dock.enabled !== false };
        overlay.saveOverlayPrefs({ hudDock: nextDock });

        const remaining = meterIds.filter((mid) => include[mid] !== false);
        overlayHuds.close("dock-bar");
        if (remaining.length && nextDock.enabled) {
          const panels = Object.fromEntries(
            meterIds.map((mid) => [mid, include[mid] !== false]),
          );
          openConfiguredHuds(panels, { ...prefs, hudDock: nextDock });
        }
        try {
          overlayHuds.broadcast("overlay:hud-dock", nextDock);
        } catch {
          /* ignore */
        }
      }
    }

    const openMeterIds = new Set([...meterIds, "dock-bar"]);
    const anyMeterOpen = overlayHuds
      .list()
      .some((row) => row.open && openMeterIds.has(row.id));
    // Individual Stop should fully release capture when nothing is left open,
    // so the next per-card Start can boot cleanly without needing top Stop.
    if (!anyMeterOpen && overlayEngine.running) {
      await stopOverlay();
    }
    broadcastOverlayStatus();
    return true;
  });
  ipcMain.handle("overlay:hud-prefs", async (_event, id) => overlayHuds.getHudPrefs(id));
  ipcMain.handle("overlay:save-hud-prefs", async (_event, id, patch) =>
    overlayHuds.saveHudPrefs(id, patch || {}),
  );
  ipcMain.handle("overlay:set-hud-scale", async (_event, id, scale) =>
    overlayHuds.setHudScale(id, scale),
  );
  ipcMain.handle("overlay:report-hud-base", async (_event, id, base) => {
    overlayHuds.reportHudBase(id, base || {});
    return true;
  });
  ipcMain.handle("overlay:begin-resize", async (_event, id, edge) =>
    overlayHuds.beginResize(id, edge),
  );
  ipcMain.handle("overlay:end-resize", async () => {
    overlayHuds.endResize();
    return true;
  });
  ipcMain.handle("overlay:begin-move", async (_event, id, options) =>
    overlayHuds.beginMove(id, options || {}),
  );
  ipcMain.handle("overlay:end-move", async () => {
    overlayHuds.endMove();
    return true;
  });
  ipcMain.handle("overlay:set-chrome-interactive", async (_event, id, interactive) => {
    overlayHuds.setChromeInteractive(id, interactive);
    return true;
  });
  ipcMain.handle("overlay:get-locked", async () => overlayHuds.locked !== false);
  ipcMain.handle("overlay:show-loot-tip", async (event, html) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    overlayHuds.showLootTip(html, win);
    return true;
  });
  ipcMain.handle("overlay:fit-loot-tip", async (_event, size) => {
    overlayHuds.fitLootTip(size || {});
    return true;
  });
  ipcMain.handle("overlay:hide-loot-tip", async () => {
    overlayHuds.hideLootTip();
    return true;
  });
  ipcMain.handle("overlay:show-dock-menu", async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    // Toggle closed if already open from this dock.
    if (overlayHuds.isDockMenuOpen()) {
      overlayHuds.hideDockMenu();
      return { open: false };
    }
    overlayHuds.showDockMenu(payload || {}, win);
    return { open: true };
  });
  ipcMain.handle("overlay:fit-dock-menu", async (_event, size) => {
    overlayHuds.fitDockMenu(size || {});
    return true;
  });
  ipcMain.handle("overlay:hide-dock-menu", async () => {
    overlayHuds.hideDockMenu();
    return true;
  });
  ipcMain.handle("overlay:notify-hud-options", async (_event, id, options) => {
    overlayHuds.notifyHudOptions(id || "", options || {});
    return true;
  });
  ipcMain.on("overlay:persist-zoom", (event, zoom) => {
    const id = overlayHuds.idForWebContents(event.sender);
    if (!id) return;
    const next = Math.min(1.8, Math.max(0.7, Number(zoom) || 1));
    overlayHuds.setHudScale(id, next);
  });
  ipcMain.handle("overlay:set-hud-menu-space", async (_event, id, open, size) => {
    overlayHuds.setHudMenuSpace(id || "", Boolean(open), size || {});
    return true;
  });
  ipcMain.handle("overlay:open-link", async (_event, url) => {
    await overlay.openExternalSafe(url);
    return true;
  });
}

function createWindow() {
  const prefs = loadWindowPrefs();
  const bounds = sanitizeWindowBounds(prefs.bounds && typeof prefs.bounds === "object" ? prefs.bounds : {});

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    show: false,
    title: APP_TITLE,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  views.overlay = mainWindow;
  Menu.setApplicationMenu(null);
  if (bounds.isMaximized) mainWindow.maximize();

  mainWindow.on("page-title-updated", (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    overlay.openExternalSafe(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!String(url).startsWith("file://")) event.preventDefault();
  });

  mainWindow.once("ready-to-show", () => showMainWindow());
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) showMainWindow();
  }, 2500);

  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    saveWindowPrefs({
      bounds: { ...mainWindow.getBounds(), isMaximized: mainWindow.isMaximized() },
    });
  };
  mainWindow.on("resize", persistBounds);
  mainWindow.on("move", persistBounds);
  mainWindow.on("close", (event) => {
    persistBounds();
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.loadFile(path.join(__dirname, "overlay.html"));
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath());
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip(APP_TITLE);
  tray.on("click", () => showMainWindow());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Show ${APP_TITLE}`, click: () => showMainWindow() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());

  app.whenReady().then(() => {
    itemCatalog.loadCatalog().catch(() => {});
    registerIpc();
    createWindow();
    createTray();
    overlayHuds.watchDisplays();
    nightMode.registerHotkey();
    const overlayPrefs = overlay.loadOverlayPrefs();
    overlayHuds.setHudPrefs({
      scales: overlayPrefs.hudScales || {},
      options: overlayPrefs.hudOptions || {},
      tipScale: overlayPrefs.tipScale,
      hudLook: overlayPrefs.hudLook,
      hudCorners: overlayPrefs.hudCorners,
    });
    nightMode.applyPrefs(overlayPrefs);
    mouseIndicator.applyPrefs(overlayPrefs);
    sessionTimer.pauseOverlays =
      overlayPrefs.hudOptions?.["session-timer"]?.pauseOverlays !== false;
  });
}

app.on("before-quit", () => {
  isQuitting = true;
  try {
    nightMode.destroy();
  } catch {
    // ignore
  }
  try {
    mouseIndicator.destroy();
  } catch {
    // ignore
  }
  try {
    stopOverlay();
  } catch {
    // ignore
  }
});

app.on("window-all-closed", () => {
  // Tray keeps the app alive while the main window is hidden.
});
