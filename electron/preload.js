const { contextBridge, ipcRenderer, webFrame } = require("electron");

function installCtrlScrollZoom() {
  let saveTimer = null;
  const onWheel = (event) => {
    if (!event.ctrlKey) {
      return;
    }
    event.preventDefault();
    const step = event.deltaY < 0 ? 0.1 : -0.1;
    const next = Math.min(
      1.8,
      Math.max(0.7, Number((webFrame.getZoomFactor() + step).toFixed(2))),
    );
    webFrame.setZoomFactor(next);
    // Persist HUD window scale so reloads keep Ctrl+scroll zoom.
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      ipcRenderer.send("overlay:persist-zoom", next);
    }, 200);
  };
  window.addEventListener("wheel", onWheel, { passive: false, capture: true });
}

installCtrlScrollZoom();

contextBridge.exposeInMainWorld("overlay", {
  getStatus: () => ipcRenderer.invoke("overlay:status"),
  acceptPolicy: () => ipcRenderer.invoke("overlay:accept-policy"),
  savePrefs: (patch) => ipcRenderer.invoke("overlay:save-prefs", patch || {}),
  start: (options) => ipcRenderer.invoke("overlay:start", options || {}),
  stop: () => ipcRenderer.invoke("overlay:stop"),
  closeHud: (id) => ipcRenderer.invoke("overlay:close-hud", id || ""),
  resetEncounter: () => ipcRenderer.invoke("overlay:reset"),
  zeroMeters: () => ipcRenderer.invoke("overlay:zero"),
  setLocked: (locked) => ipcRenderer.invoke("overlay:set-locked", Boolean(locked)),
  setOpacity: (value) => ipcRenderer.invoke("overlay:set-opacity", value),
  getHudCompact: () => ipcRenderer.invoke("overlay:hud-compact"),
  setHudCompact: (id, enabled) =>
    ipcRenderer.invoke("overlay:set-hud-compact", id || "", Boolean(enabled)),
  getHudFab: () => ipcRenderer.invoke("overlay:hud-fab"),
  setHudFab: (id, enabled) =>
    ipcRenderer.invoke("overlay:set-hud-fab", id || "", Boolean(enabled)),
  getHudDock: () => ipcRenderer.invoke("overlay:hud-dock"),
  setHudDock: (patch) => ipcRenderer.invoke("overlay:set-hud-dock", patch || {}),
  getNightMode: () => ipcRenderer.invoke("overlay:night-mode"),
  setNightMode: (patch) => ipcRenderer.invoke("overlay:set-night-mode", patch || {}),
  getMouseIndicator: () => ipcRenderer.invoke("overlay:mouse-indicator"),
  setMouseIndicator: (patch) =>
    ipcRenderer.invoke("overlay:set-mouse-indicator", patch || {}),
  getSessions: () => ipcRenderer.invoke("overlay:sessions"),
  clearSessions: () => ipcRenderer.invoke("overlay:clear-sessions"),
  openLink: (url) => ipcRenderer.invoke("overlay:open-link", url || ""),
  onNightMode: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:night-mode", listener);
    return () => ipcRenderer.removeListener("overlay:night-mode", listener);
  },
  onMouseIndicator: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:mouse-indicator", listener);
    return () => ipcRenderer.removeListener("overlay:mouse-indicator", listener);
  },
  onStatusChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:status-changed", listener);
    return () => ipcRenderer.removeListener("overlay:status-changed", listener);
  },
  onIdentity: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:identity", listener);
    return () => ipcRenderer.removeListener("overlay:identity", listener);
  },
  onLocked: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:locked", listener);
    return () => ipcRenderer.removeListener("overlay:locked", listener);
  },
});

contextBridge.exposeInMainWorld("overlayHud", {
  getSnapshot: () => ipcRenderer.invoke("overlay:snapshot"),
  resetEncounter: () => ipcRenderer.invoke("overlay:reset"),
  zeroMeters: () => ipcRenderer.invoke("overlay:zero"),
  closeMeter: (id) => ipcRenderer.invoke("overlay:close-hud", id || "dps-meter"),
  showLootTip: (html) => ipcRenderer.invoke("overlay:show-loot-tip", html || ""),
  hideLootTip: () => ipcRenderer.invoke("overlay:hide-loot-tip"),
  fitLootTip: (size) => ipcRenderer.invoke("overlay:fit-loot-tip", size || {}),
  showDockMenu: (payload) => ipcRenderer.invoke("overlay:show-dock-menu", payload || {}),
  fitDockMenu: (size) => ipcRenderer.invoke("overlay:fit-dock-menu", size || {}),
  hideDockMenu: () => ipcRenderer.invoke("overlay:hide-dock-menu"),
  notifyHudOptions: (id, options) =>
    ipcRenderer.invoke("overlay:notify-hud-options", id || "", options || {}),
  setHudMenuSpace: (id, open, size) =>
    ipcRenderer.invoke("overlay:set-hud-menu-space", id || "", Boolean(open), size || {}),
  onDockMenu: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:dock-menu", listener);
    return () => ipcRenderer.removeListener("overlay:dock-menu", listener);
  },
  onHudOptions: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:hud-options", listener);
    return () => ipcRenderer.removeListener("overlay:hud-options", listener);
  },
  onHudScale: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:hud-scale", listener);
    return () => ipcRenderer.removeListener("overlay:hud-scale", listener);
  },
  getHudPrefs: (id) => ipcRenderer.invoke("overlay:hud-prefs", id || ""),
  saveHudPrefs: (id, patch) =>
    ipcRenderer.invoke("overlay:save-hud-prefs", id || "", patch || {}),
  setHudScale: (id, scale) =>
    ipcRenderer.invoke("overlay:set-hud-scale", id || "", Number(scale) || 1),
  reportHudBase: (id, base) =>
    ipcRenderer.invoke("overlay:report-hud-base", id || "", base || {}),
  beginResize: (id, edge) =>
    ipcRenderer.invoke("overlay:begin-resize", id || "", edge || ""),
  endResize: () => ipcRenderer.invoke("overlay:end-resize"),
  beginMove: (id, options) =>
    ipcRenderer.invoke("overlay:begin-move", id || "", options || {}),
  endMove: () => ipcRenderer.invoke("overlay:end-move"),
  setLocked: (locked) => ipcRenderer.invoke("overlay:set-locked", Boolean(locked)),
  getHudCompact: () => ipcRenderer.invoke("overlay:hud-compact"),
  setHudCompact: (id, enabled) =>
    ipcRenderer.invoke("overlay:set-hud-compact", id || "", Boolean(enabled)),
  getHudFab: () => ipcRenderer.invoke("overlay:hud-fab"),
  setHudFab: (id, enabled) =>
    ipcRenderer.invoke("overlay:set-hud-fab", id || "", Boolean(enabled)),
  setChromeInteractive: (id, interactive) =>
    ipcRenderer.invoke("overlay:set-chrome-interactive", id || "", Boolean(interactive)),
  getLocked: () => ipcRenderer.invoke("overlay:get-locked"),
  onLocked: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:locked", listener);
    return () => ipcRenderer.removeListener("overlay:locked", listener);
  },
  getNightMode: () => ipcRenderer.invoke("overlay:night-mode"),
  setNightMode: (patch) => ipcRenderer.invoke("overlay:set-night-mode", patch || {}),
  onNightMode: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:night-mode", listener);
    return () => ipcRenderer.removeListener("overlay:night-mode", listener);
  },
  onTipScale: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:tip-scale", listener);
    return () => ipcRenderer.removeListener("overlay:tip-scale", listener);
  },
  onHudLook: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:hud-look", listener);
    return () => ipcRenderer.removeListener("overlay:hud-look", listener);
  },
  onHudCompact: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:hud-compact", listener);
    return () => ipcRenderer.removeListener("overlay:hud-compact", listener);
  },
  onHudFab: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:hud-fab", listener);
    return () => ipcRenderer.removeListener("overlay:hud-fab", listener);
  },
  getHudDock: () => ipcRenderer.invoke("overlay:hud-dock"),
  setHudDock: (patch) => ipcRenderer.invoke("overlay:set-hud-dock", patch || {}),
  onHudDock: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:hud-dock", listener);
    return () => ipcRenderer.removeListener("overlay:hud-dock", listener);
  },
  onLootTip: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:loot-tip", listener);
    return () => ipcRenderer.removeListener("overlay:loot-tip", listener);
  },
  onTick: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:tick", listener);
    return () => ipcRenderer.removeListener("overlay:tick", listener);
  },
  getTimer: () => ipcRenderer.invoke("overlay:timer"),
  timerCommand: (cmd, payload) =>
    ipcRenderer.invoke("overlay:timer-command", String(cmd || ""), payload || {}),
  onTimer: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("overlay:timer", listener);
    return () => ipcRenderer.removeListener("overlay:timer", listener);
  },
});
