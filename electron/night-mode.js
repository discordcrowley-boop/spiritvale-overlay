const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { BrowserWindow, screen } = require("electron");
const { GameWindowTracker } = require("./game-window");

const MIN_DIM = 0;
const MAX_DIM = 0.75;
const DEFAULT_DIM = 0.45;
const HOTKEY = "CommandOrControl+Shift+D";

function clampDim(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_DIM;
  return Math.min(MAX_DIM, Math.max(MIN_DIM, n));
}

function powershellPath() {
  const shell = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  return fs.existsSync(shell) ? shell : "powershell.exe";
}

function magScriptPath() {
  const packed = path.join(__dirname, "capture", "night-dim-mag.ps1");
  if (fs.existsSync(packed)) return packed;
  const unpacked = packed.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  return unpacked !== packed && fs.existsSync(unpacked) ? unpacked : packed;
}

function physicalToDip(bounds) {
  if (!bounds) return null;
  const tl = screen.screenToDipPoint({ x: bounds.x, y: bounds.y });
  const br = screen.screenToDipPoint({
    x: bounds.x + bounds.width,
    y: bounds.y + bounds.height,
  });
  return {
    x: Math.round(tl.x),
    y: Math.round(tl.y),
    width: Math.max(1, Math.round(br.x - tl.x)),
    height: Math.max(1, Math.round(br.y - tl.y)),
  };
}

function cursorDisplayBounds() {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
  } catch {
    return screen.getPrimaryDisplay().bounds;
  }
}

function coversDisplay(dip) {
  if (!dip) return false;
  const displays = screen.getAllDisplays();
  return displays.some((display) => {
    const area = display.bounds;
    return (
      Math.abs(dip.x - area.x) <= 16 &&
      Math.abs(dip.y - area.y) <= 16 &&
      Math.abs(dip.width - area.width) <= 24 &&
      Math.abs(dip.height - area.height) <= 24
    );
  });
}

function sameBounds(a, b) {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

class NightModeManager {
  constructor({ onChanged, onStatus, onRestack } = {}) {
    this.onChanged = onChanged;
    this.onStatus = onStatus;
    this.onRestack = onRestack;
    this.enabled = false;
    this.dim = DEFAULT_DIM;
    this.win = null;
    this.applied = null;
    this.mode = "off";
    this.magChild = null;
    this.magScale = null;
    this.keepAlive = null;
    this.tracker = new GameWindowTracker();
    this.tracker.on("bounds", () => this.#onBounds());
  }

  getState() {
    return {
      enabled: this.enabled,
      dim: this.dim,
      hotkey: "Ctrl+Shift+D",
      gameFound: Boolean(this.tracker.found || this.tracker.processSeen),
      bounds: this.tracker.bounds,
      mode: this.mode,
    };
  }

  applyPrefs(prefs = {}) {
    if (prefs.nightDim != null) this.dim = clampDim(prefs.nightDim);
    this.setEnabled(Boolean(prefs.nightMode), { silent: true });
    this.#notify(false);
  }

  setEnabled(enabled, { silent } = {}) {
    const next = Boolean(enabled);
    this.enabled = next;
    if (next) {
      this.tracker.start();
      this.#sync();
      this.#startKeepAlive();
    } else {
      this.#stopKeepAlive();
      this.#hideWindow();
      this.#stopMag();
      this.tracker.stop();
      this.mode = "off";
    }
    if (!silent) this.#notify(true);
    return this.getState();
  }

  setDim(dim, { silent } = {}) {
    this.dim = clampDim(dim);
    if (this.win && !this.win.isDestroyed()) this.win.setOpacity(this.dim);
    if (this.enabled) this.#sync();
    if (!silent) this.#notify(true);
    return this.getState();
  }

  setState({ enabled, dim } = {}) {
    if (dim != null) this.setDim(dim, { silent: true });
    if (enabled != null) this.setEnabled(enabled, { silent: true });
    this.#notify(true);
    return this.getState();
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  registerHotkey() {
    try {
      const { globalShortcut } = require("electron");
      globalShortcut.unregister(HOTKEY);
      globalShortcut.register(HOTKEY, () => this.toggle());
    } catch {
      /* ignore */
    }
  }

  destroy() {
    try {
      const { globalShortcut } = require("electron");
      globalShortcut.unregister(HOTKEY);
    } catch {
      /* ignore */
    }
    this.#stopKeepAlive();
    this.tracker.stop();
    this.#stopMag();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.applied = null;
  }

  #notify(persist) {
    const state = this.getState();
    if (persist && typeof this.onChanged === "function") this.onChanged(state);
    if (typeof this.onStatus === "function") this.onStatus(state);
  }

  #onBounds() {
    if (!this.enabled) return;
    this.#sync();
    if (typeof this.onStatus === "function") this.onStatus(this.getState());
  }

  #startKeepAlive() {
    if (this.keepAlive) return;
    this.keepAlive = setInterval(() => {
      if (!this.enabled) return;
      this.#sync();
    }, 1000);
  }

  #stopKeepAlive() {
    if (!this.keepAlive) return;
    clearInterval(this.keepAlive);
    this.keepAlive = null;
  }

  #ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      thickFrame: false,
      backgroundColor: "#00000000",
      title: "Spiritvale Night Mode",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    win.setMenuBarVisibility(false);
    win.setAlwaysOnTop(true, "screen-saver", 0);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true);
    win.setOpacity(this.dim);
    win.loadFile(path.join(__dirname, "hud", "night-dim.html"));
    win.on("closed", () => {
      if (this.win === win) this.win = null;
    });
    this.win = win;
    this.applied = null;
    return win;
  }

  #hideWindow() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.hide();
    this.applied = null;
  }

  #startMag() {
    const scale = Math.max(0.25, 1 - this.dim);
    if (this.magChild && !this.magChild.killed && this.magScale === scale) return;
    this.#stopMag();
    const file = magScriptPath();
    if (!fs.existsSync(file)) return;
    this.magScale = scale;
    this.magChild = spawn(
      powershellPath(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", file, "-Scale", String(scale)],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.magChild.on("exit", () => {
      if (this.magChild) this.magChild = null;
    });
  }

  #stopMag() {
    this.magScale = null;
    if (!this.magChild) return;
    const child = this.magChild;
    this.magChild = null;
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }

  #restackHuds() {
    if (typeof this.onRestack === "function") this.onRestack();
  }

  #showOverlay(dip) {
    const win = this.#ensureWindow();
    if (!sameBounds(this.applied, dip)) {
      win.setBounds(dip, false);
      this.applied = dip;
    }
    win.setAlwaysOnTop(true, "screen-saver", 0);
    win.setIgnoreMouseEvents(true);
    win.setOpacity(this.dim);
    if (!win.isVisible()) win.showInactive();
    try {
      win.moveTop();
    } catch {
      /* ignore */
    }
    this.#restackHuds();
  }

  #sync() {
    if (!this.enabled) return;
    const dip = physicalToDip(this.tracker.bounds) || cursorDisplayBounds();
    const exclusive = Boolean(this.tracker.processSeen && !this.tracker.found) || coversDisplay(dip);
    if (exclusive && !this.tracker.found) {
      this.mode = "screen";
      this.#startMag();
    } else {
      this.#stopMag();
      this.mode = this.tracker.found ? "window" : "display";
    }
    this.#showOverlay(dip);
  }
}

module.exports = { NightModeManager, MIN_DIM, MAX_DIM, DEFAULT_DIM };
