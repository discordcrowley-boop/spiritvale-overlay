const fs = require("fs");
const path = require("path");
const { app, shell } = require("electron");
const { resolveBunBinary } = require("./overlay-live-bridge");

const SAFETY_POLICY = {
  title: "Ban-safe Overlay Policy",
  summary:
    "Spiritvale Overlay is a complete custom rebuild. It only observes combat passively via Npcap. It never injects into SpiritVale, writes memory, sends packets, or automates input.",
  allowed: [
    "Passive packet capture (Npcap) that never sends, modifies, drops, or injects game traffic",
    "Overlay-owned always-on-top HUD windows (Meters / Gold / Kills / Exp / Pets / Timer)",
    "Read-only decoding of observed combat events into meters and history",
    "Manual overlay controls: show/hide, lock, opacity, reset encounter, game dark-mode dimmer",
  ],
  forbidden: [
    "Injecting into SpiritVale, patching files, or writing process memory",
    "Sending, forging, or replaying game packets",
    "Macros, AutoHotkey, input automation, or AFK progression helpers",
    "Multiclient helpers or anything that plays the game for you",
  ],
  officialRulesNote:
    "Official rules ban exploits, game-modifying hacks, macros/AHK, AFK automation, RMT, and multiclient. Spiritvale Overlay stays on the passive-observation side of that line.",
};

const FEATURE_ROADMAP = [
  {
    id: "meters",
    panel: "spiritist-meter",
    name: "Meters!",
    detail: "Live party DPS / HPS / Taken",
    status: "live",
  },
  {
    id: "gold",
    panel: "loot-meter",
    name: "Gold!",
    detail: "Inventory gold, earned, gold/hr",
    status: "live",
  },
  {
    id: "kills",
    panel: "kill-counter",
    name: "Kills!",
    detail: "Session kill total, rate, and per-monster breakdown",
    status: "live",
  },
  {
    id: "exp",
    panel: "exp-meter",
    name: "Exp!",
    detail: "XP/hour and time to next level",
    status: "live",
  },
  {
    id: "pets",
    panel: "pets-meter",
    name: "Pets!",
    detail: "Summoner minion HP bars (live)",
    status: "live",
  },
  {
    id: "timer",
    panel: "session-timer",
    name: "Timer!",
    detail: "Start / pause / stop stopwatch · pause freezes every meter",
    status: "live",
    standalone: true,
  },
  {
    id: "buffs",
    panel: "buffs",
    name: "Buffs & Auras",
    detail: "Effect durations on you",
    status: "soon",
  },
  {
    id: "farm",
    panel: "farm",
    name: "Farm Tracker",
    detail: "XP/h, drops, loot finds",
    status: "soon",
  },
  {
    id: "casts",
    panel: "casts",
    name: "Enemy Cast Tracker",
    detail: "Enemy and boss cast bars",
    status: "soon",
  },
  {
    id: "boss",
    panel: "boss",
    name: "Boss Mechanics",
    detail: "Ability callouts",
    status: "soon",
  },
  {
    id: "tower",
    panel: "tower",
    name: "Tower Tracker",
    detail: "Eternal Tower floors",
    status: "soon",
  },
];

function prefsPath() {
  return path.join(app.getPath("userData"), "overlay-prefs.json");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function loadOverlayPrefs() {
  const defaults = {
    policyAccepted: false,
    locked: true,
    opacity: 0.88,
    personalName: "",
    panels: {
      "spiritist-meter": true,
      "loot-meter": true,
      "kill-counter": true,
      buffs: false,
      deaths: false,
      farm: false,
      casts: false,
      boss: false,
      tower: false,
      "dps-meter": false,
    },
    captureMode: "live",
    prefsVersion: 2,
    hudBounds: {},
    hudLayoutBounds: {},
    hudScales: {},
    hudOptions: {},
    tipScale: 1.35,
    nightMode: false,
    nightDim: 0.45,
    hudLook: 0.4,
    hudCorners: "square",
    mouseIndicator: false,
    mouseIndicatorStyle: "neon-cyan-ring",
    mouseIndicatorAnimate: true,
    mouseIndicatorFlash: false,
    hudCompact: {
      "spiritist-meter": false,
      "loot-meter": false,
      "kill-counter": false,
      "exp-meter": false,
      "pets-meter": false,
    },
    hudFab: {},
    startInclude: {
      "spiritist-meter": true,
      "loot-meter": true,
      "kill-counter": true,
      "exp-meter": true,
      "pets-meter": false,
      "session-timer": false,
    },
    hudDock: {
      enabled: false,
      include: {
        "spiritist-meter": true,
        "loot-meter": true,
        "kill-counter": true,
        "exp-meter": true,
        "pets-meter": false,
      },
      display: {
        "spiritist-meter": { dps: true },
        "loot-meter": { earned: true, goldPerHour: true, inventory: false },
        "kill-counter": { kills: true },
        "exp-meter": { xpPerHour: true, ttl: true, jobTtl: true, percent: true },
        "pets-meter": { count: true, lowest: true },
      },
    },
  };
  const saved = readJson(prefsPath(), null);
  if (!saved) return defaults;
  const next = {
    ...defaults,
    ...saved,
    panels: { ...defaults.panels, ...(saved.panels || {}) },
    hudBounds: { ...(defaults.hudBounds || {}), ...(saved.hudBounds || {}) },
    hudLayoutBounds: {
      ...(defaults.hudLayoutBounds || {}),
      ...(saved.hudLayoutBounds || {}),
    },
    hudScales: { ...(defaults.hudScales || {}), ...(saved.hudScales || {}) },
    hudOptions: { ...(defaults.hudOptions || {}), ...(saved.hudOptions || {}) },
    tipScale: Number(saved.tipScale) > 0 ? Number(saved.tipScale) : defaults.tipScale,
    nightMode: Boolean(saved.nightMode),
    nightDim:
      saved.nightDim != null && Number.isFinite(Number(saved.nightDim))
        ? Math.min(0.75, Math.max(0, Number(saved.nightDim)))
        : defaults.nightDim,
    hudLook: Number(saved.hudLook) > 0 ? Number(saved.hudLook) : defaults.hudLook,
    hudCorners: saved.hudCorners === "square" ? "square" : "round",
    mouseIndicator: Boolean(saved.mouseIndicator),
    mouseIndicatorStyle: saved.mouseIndicatorStyle
      ? String(saved.mouseIndicatorStyle)
      : defaults.mouseIndicatorStyle,
    mouseIndicatorAnimate:
      saved.mouseIndicatorAnimate == null
        ? defaults.mouseIndicatorAnimate
        : Boolean(saved.mouseIndicatorAnimate),
    mouseIndicatorFlash: Boolean(saved.mouseIndicatorFlash),
    hudCompact: {
      "spiritist-meter": false,
      "loot-meter": false,
      "kill-counter": false,
      "exp-meter": false,
      "pets-meter": false,
      ...(saved.hudCompact || {}),
    },
    hudFab: {
      ...(saved.hudFab || {}),
    },
    startInclude: {
      "spiritist-meter": true,
      "loot-meter": true,
      "kill-counter": true,
      "exp-meter": true,
      "pets-meter": false,
      "session-timer": false,
      ...(saved.startInclude || {}),
    },
    hudDock: {
      enabled: Boolean(saved.hudDock?.enabled),
      include: {
        "spiritist-meter": true,
        "loot-meter": true,
        "kill-counter": true,
        "exp-meter": true,
        "pets-meter": false,
        ...(saved.hudDock?.include || {}),
      },
      display: {
        "spiritist-meter": {
          ...defaults.hudDock.display["spiritist-meter"],
          ...(saved.hudDock?.display?.["spiritist-meter"] || {}),
        },
        "loot-meter": {
          ...defaults.hudDock.display["loot-meter"],
          ...(saved.hudDock?.display?.["loot-meter"] || {}),
        },
        "kill-counter": {
          ...defaults.hudDock.display["kill-counter"],
          ...(saved.hudDock?.display?.["kill-counter"] || {}),
        },
        "exp-meter": {
          ...defaults.hudDock.display["exp-meter"],
          ...(saved.hudDock?.display?.["exp-meter"] || {}),
        },
        "pets-meter": {
          ...defaults.hudDock.display["pets-meter"],
          ...(saved.hudDock?.display?.["pets-meter"] || {}),
        },
      },
    },
  };
  // Pre-1.8 builds defaulted to demo; flip those installs to live once.
  if ((saved.prefsVersion || 1) < 2) {
    next.captureMode = "live";
    next.prefsVersion = 2;
    try {
      fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
      fs.writeFileSync(prefsPath(), JSON.stringify(next, null, 2));
    } catch {
      /* ignore */
    }
  }
  return next;
}

function saveOverlayPrefs(patch) {
  const current = loadOverlayPrefs();
  const next = {
    ...current,
    ...patch,
    panels: { ...current.panels, ...(patch.panels || {}) },
    hudBounds: { ...(current.hudBounds || {}), ...(patch.hudBounds || {}) },
    hudLayoutBounds: {
      ...(current.hudLayoutBounds || {}),
      ...(patch.hudLayoutBounds || {}),
    },
    hudScales: { ...(current.hudScales || {}), ...(patch.hudScales || {}) },
    hudOptions: (() => {
      const merged = { ...(current.hudOptions || {}) };
      const patchOpts = patch.hudOptions || {};
      for (const [id, opts] of Object.entries(patchOpts)) {
        merged[id] = { ...(merged[id] || {}), ...(opts || {}) };
      }
      return merged;
    })(),
    hudCompact: { ...(current.hudCompact || {}), ...(patch.hudCompact || {}) },
    hudFab: { ...(current.hudFab || {}), ...(patch.hudFab || {}) },
    startInclude: { ...(current.startInclude || {}), ...(patch.startInclude || {}) },
    hudDock: {
      enabled:
        patch.hudDock && patch.hudDock.enabled != null
          ? Boolean(patch.hudDock.enabled)
          : Boolean(current.hudDock?.enabled),
      include: {
        ...(current.hudDock?.include || {}),
        ...(patch.hudDock?.include || {}),
      },
      display: {
        "spiritist-meter": {
          ...(current.hudDock?.display?.["spiritist-meter"] || {}),
          ...(patch.hudDock?.display?.["spiritist-meter"] || {}),
        },
        "loot-meter": {
          ...(current.hudDock?.display?.["loot-meter"] || {}),
          ...(patch.hudDock?.display?.["loot-meter"] || {}),
        },
        "kill-counter": {
          ...(current.hudDock?.display?.["kill-counter"] || {}),
          ...(patch.hudDock?.display?.["kill-counter"] || {}),
        },
        "exp-meter": {
          ...(current.hudDock?.display?.["exp-meter"] || {}),
          ...(patch.hudDock?.display?.["exp-meter"] || {}),
        },
        "pets-meter": {
          ...(current.hudDock?.display?.["pets-meter"] || {}),
          ...(patch.hudDock?.display?.["pets-meter"] || {}),
        },
      },
    },
  };
  fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
  fs.writeFileSync(prefsPath(), JSON.stringify(next, null, 2));
  return next;
}

function npcapLikelyInstalled() {
  const candidates = [
    path.join(process.env["ProgramFiles"] || "", "Npcap", "Npcap.sys"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Npcap", "Npcap.sys"),
    path.join(process.env.SystemRoot || "C:\\Windows", "System32", "Npcap", "Npcap.sys"),
  ];
  return candidates.some((file) => {
    try {
      return fs.existsSync(file);
    } catch {
      return false;
    }
  });
}

function getOverlayStatus(runtime = {}) {
  const prefs = loadOverlayPrefs();
  const npcapInstalled = npcapLikelyInstalled();
  const bunReady = Boolean(resolveBunBinary());
  const live = runtime.live || {};
  const captureReady = npcapInstalled && bunReady;
  let captureNote =
    "Press Start Overlay while SpiritVale is running. Meters fill from live combat (passive Npcap).";
  if (!npcapInstalled) {
    captureNote = "Install Npcap (with WinPcap API compatibility), then Start Overlay.";
  } else if (!bunReady) {
    captureNote = "Capture runtime missing. Reinstall Spiritvale Overlay to restore Bun.";
  } else if (live.error) {
    captureNote = live.error;
  } else if (runtime.running && runtime.mode === "live" && !live.gameSeen) {
    captureNote = "Listening… open SpiritVale and enter combat.";
  } else if (runtime.running && runtime.mode === "live") {
    captureNote = "Live capture linked. Meters!, Gold!, and Kills! fill from combat.";
  } else if (runtime.running && runtime.mode === "demo") {
    captureNote = "Demo mode — synthetic data. Switch to Live for real combat.";
  }

  return {
    policy: SAFETY_POLICY,
    roadmap: FEATURE_ROADMAP,
    prefs,
    runtime: {
      running: Boolean(runtime.running),
      mode: runtime.mode || "idle",
      openHuds: runtime.openHuds || [],
      captureReady,
      captureNote,
      npcapInstalled,
      bunReady,
      live,
      capture: runtime.capture || null,
      nightMode: runtime.nightMode || {
        enabled: Boolean(prefs.nightMode),
        dim: Number(prefs.nightDim) || 0.45,
        gameFound: false,
        hotkey: "Ctrl+Shift+D",
      },
      mouseIndicator: runtime.mouseIndicator || {
        enabled: Boolean(prefs.mouseIndicator),
        styleId: prefs.mouseIndicatorStyle || "neon-cyan-ring",
        animate: prefs.mouseIndicatorAnimate !== false,
        flash: Boolean(prefs.mouseIndicatorFlash),
        presets: [],
      },
    },
    links: {
      npcap: "https://npcap.com/#download",
    },
  };
}

function openExternalSafe(url) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Only http(s) links are allowed");
  }
  return shell.openExternal(url);
}

module.exports = {
  SAFETY_POLICY,
  FEATURE_ROADMAP,
  getOverlayStatus,
  loadOverlayPrefs,
  saveOverlayPrefs,
  openExternalSafe,
  npcapLikelyInstalled,
};
