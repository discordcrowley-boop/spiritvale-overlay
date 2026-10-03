const path = require("path");
const { BrowserWindow, screen } = require("electron");
const {
  getPreset,
  listPresets,
  DEFAULT_PRESET_ID,
} = require("./mouse-indicator-presets");

const SIZE = 220;
const POLL_MS = 16;

function samePoint(a, b) {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y;
}

class MouseIndicatorManager {
  constructor({ onChanged, onStatus } = {}) {
    this.onChanged = onChanged;
    this.onStatus = onStatus;
    this.enabled = false;
    this.styleId = DEFAULT_PRESET_ID;
    this.animate = true;
    this.flash = false;
    this.win = null;
    this.pollTimer = null;
    this.lastPoint = null;
    this.ready = false;
  }

  getState() {
    const preset = getPreset(this.styleId);
    return {
      enabled: this.enabled,
      styleId: preset.id,
      styleName: preset.name,
      animate: this.animate,
      flash: this.flash,
      presets: listPresets(),
    };
  }

  applyPrefs(prefs = {}) {
    if (prefs.mouseIndicatorStyle) this.styleId = String(prefs.mouseIndicatorStyle);
    if (prefs.mouseIndicatorAnimate != null) {
      this.animate = Boolean(prefs.mouseIndicatorAnimate);
    }
    if (prefs.mouseIndicatorFlash != null) {
      this.flash = Boolean(prefs.mouseIndicatorFlash);
    }
    this.setEnabled(Boolean(prefs.mouseIndicator), { silent: true });
    this.#pushStyle();
    this.#notify(false);
  }

  setEnabled(enabled, { silent } = {}) {
    const next = Boolean(enabled);
    this.enabled = next;
    if (next) {
      this.#ensureWindow();
      this.#startPoll();
      this.#tick(true);
    } else {
      this.#stopPoll();
      this.#hideWindow();
    }
    if (!silent) this.#notify(true);
    return this.getState();
  }

  setStyle(styleId, { silent } = {}) {
    this.styleId = String(styleId || DEFAULT_PRESET_ID);
    this.#pushStyle();
    if (!silent) this.#notify(true);
    return this.getState();
  }

  setAnimate(animate, { silent } = {}) {
    this.animate = Boolean(animate);
    this.#pushStyle();
    if (!silent) this.#notify(true);
    return this.getState();
  }

  setFlash(flash, { silent } = {}) {
    this.flash = Boolean(flash);
    this.#pushStyle();
    if (!silent) this.#notify(true);
    return this.getState();
  }

  setState(patch = {}) {
    if (patch.styleId != null || patch.style != null) {
      this.setStyle(patch.styleId || patch.style, { silent: true });
    }
    if (patch.animate != null) this.setAnimate(patch.animate, { silent: true });
    if (patch.flash != null) this.setFlash(patch.flash, { silent: true });
    if (patch.enabled != null) this.setEnabled(patch.enabled, { silent: true });
    this.#notify(true);
    return this.getState();
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  destroy() {
    this.#stopPoll();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.ready = false;
    this.lastPoint = null;
  }

  #notify(persist) {
    const state = this.getState();
    if (persist && typeof this.onChanged === "function") this.onChanged(state);
    if (typeof this.onStatus === "function") this.onStatus(state);
  }

  #ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.ready = false;
    const win = new BrowserWindow({
      x: 0,
      y: 0,
      width: SIZE,
      height: SIZE,
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
      title: "Spiritvale Mouse Indicator",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    win.setMenuBarVisibility(false);
    // High always-on-top level so the glow stays above the game (and custom cursor area).
    win.setAlwaysOnTop(true, "screen-saver", 2);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadFile(path.join(__dirname, "hud", "mouse-indicator.html"));
    win.webContents.on("did-finish-load", () => {
      this.ready = true;
      this.#pushStyle();
    });
    win.on("closed", () => {
      if (this.win === win) {
        this.win = null;
        this.ready = false;
      }
    });
    this.win = win;
    this.lastPoint = null;
    return win;
  }

  #hideWindow() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.hide();
    this.lastPoint = null;
  }

  #startPoll() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.#tick(false), POLL_MS);
  }

  #stopPoll() {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  #pushStyle() {
    if (!this.win || this.win.isDestroyed() || !this.ready) return;
    const preset = getPreset(this.styleId);
    const payload = {
      ...preset,
      animate: this.animate ? preset.animate : "none",
      flash: this.flash || preset.flash,
    };
    const js = `window.__applyMouseStyle && window.__applyMouseStyle(${JSON.stringify(payload)})`;
    this.win.webContents.executeJavaScript(js, true).catch(() => {});
  }

  #tick(force) {
    if (!this.enabled) return;
    let point;
    try {
      point = screen.getCursorScreenPoint();
    } catch {
      return;
    }
    if (!force && samePoint(point, this.lastPoint)) {
      this.#restack();
      return;
    }
    this.lastPoint = point;
    const dip = screen.screenToDipPoint(point);
    const win = this.#ensureWindow();
    const bounds = {
      x: Math.round(dip.x - SIZE / 2),
      y: Math.round(dip.y - SIZE / 2),
      width: SIZE,
      height: SIZE,
    };
    win.setBounds(bounds, false);
    win.setAlwaysOnTop(true, "screen-saver", 2);
    win.setIgnoreMouseEvents(true, { forward: true });
    if (!win.isVisible()) win.showInactive();
    this.#restack();
  }

  #restack() {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.moveTop();
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  MouseIndicatorManager,
  SIZE,
};
