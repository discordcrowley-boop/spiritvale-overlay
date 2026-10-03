const HUD_ID = "session-timer";
const shell = document.getElementById("meter");
const face = document.getElementById("face");
const readout = document.getElementById("readout");
const stateTag = document.getElementById("stateTag");
const btnToggle = document.getElementById("btnToggle");
const btnStop = document.getElementById("btnStop");

/** kind: seg7 = seven-segment LED/LCD · dot = 5×7 matrix · font = typeface */
const STYLES = [
  { id: "led-mint", name: "Spirit Mint", kind: "seg7", swatch: "#3ee0b0" },
  { id: "led-red", name: "LED Red", kind: "seg7", swatch: "#ff3b30" },
  { id: "led-green", name: "LED Green", kind: "seg7", swatch: "#39ff6a" },
  { id: "led-blue", name: "Ice Blue", kind: "seg7", swatch: "#4fc3ff" },
  { id: "led-amber", name: "Amber", kind: "seg7", swatch: "#ffb000" },
  { id: "led-violet", name: "Violet", kind: "seg7", swatch: "#b47bff" },
  { id: "led-pink", name: "Neon Pink", kind: "seg7", swatch: "#ff4fd8" },
  { id: "led-gold", name: "Gold", kind: "seg7", swatch: "#e0c36a" },
  { id: "led-white", name: "Clean White", kind: "seg7", swatch: "#f2f6ff" },
  { id: "led-sunset", name: "Sunset", kind: "seg7", swatch: "#ff8a4c" },
  { id: "lcd-retro", name: "Retro LCD", kind: "seg7", swatch: "#9fb48a" },
  { id: "lcd-casio", name: "Wrist LCD", kind: "seg7", swatch: "#b9c1b0" },
  { id: "dot-amber", name: "Dot Amber", kind: "dot", swatch: "#ffb347" },
  { id: "dot-cyan", name: "Dot Cyan", kind: "dot", swatch: "#4ff0ff" },
  { id: "dot-red", name: "Arena Red", kind: "dot", swatch: "#ff4040" },
  { id: "dot-green", name: "Matrix", kind: "dot", swatch: "#3bff7a" },
  { id: "dot-stadium", name: "Stadium", kind: "dot", swatch: "#ffffff" },
  { id: "minimal", name: "Minimal", kind: "font", swatch: "#f4f7fb" },
  { id: "bahn", name: "Condensed", kind: "font", swatch: "#3ee0b0" },
  { id: "terminal", name: "Terminal", kind: "font", swatch: "#33ff66" },
  { id: "cyber", name: "Cyberpunk", kind: "font", swatch: "#fcee0a" },
  { id: "outline", name: "Outline", kind: "font", swatch: "#f4f7fb" },
  { id: "vapor", name: "Vaporwave", kind: "font", swatch: "#ff71ce" },
  { id: "mono-gold", name: "Mono Gold", kind: "font", swatch: "#e0c36a" },
  { id: "blood-moon", name: "Blood Moon", kind: "font", swatch: "#ff7a1a" },
  { id: "frost", name: "Frost", kind: "font", swatch: "#bfefff" },
  { id: "impact", name: "Heavy", kind: "font", swatch: "#ffffff" },
];
const STYLE_BY_ID = new Map(STYLES.map((row) => [row.id, row]));

const SEGMENTS = {
  0: "abcdef",
  1: "bc",
  2: "abged",
  3: "abgcd",
  4: "fgbc",
  5: "afgcd",
  6: "afgedc",
  7: "abc",
  8: "abcdefg",
  9: "abcdfg",
};

const MATRIX = {
  0: [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  2: [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  3: ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  5: ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  6: ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  7: ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  9: [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  ":": [".", ".", "#", ".", "#", ".", "."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
};

let hudOptions = {
  style: "led-mint",
  opacity: 100,
  bgOpacity: 100,
  padding: 10,
  showHours: false,
  showTenths: false,
  blinkPaused: true,
  alwaysControls: false,
  pauseOverlays: true,
  mode: "timer",
  clockZone: "local",
  clock24: false,
  clockSeconds: true,
  clockLabel: true,
};

/** Region zones (not fixed offsets) so daylight saving is handled automatically. */
const ZONES = [
  { id: "local", name: "Local (this PC)" },
  { id: "Pacific/Honolulu", name: "Hawaii" },
  { id: "America/Anchorage", name: "Alaska" },
  { id: "America/Los_Angeles", name: "Pacific" },
  { id: "America/Phoenix", name: "Arizona" },
  { id: "America/Denver", name: "Mountain" },
  { id: "America/Chicago", name: "Central" },
  { id: "America/New_York", name: "Eastern" },
  { id: "America/Halifax", name: "Atlantic" },
  { id: "America/Sao_Paulo", name: "São Paulo" },
  { id: "UTC", name: "UTC" },
  { id: "Europe/London", name: "London" },
  { id: "Europe/Paris", name: "Paris · Berlin" },
  { id: "Europe/Athens", name: "Athens · Helsinki" },
  { id: "Europe/Moscow", name: "Moscow" },
  { id: "Asia/Dubai", name: "Dubai" },
  { id: "Asia/Kolkata", name: "India" },
  { id: "Asia/Bangkok", name: "Bangkok · Jakarta" },
  { id: "Asia/Manila", name: "Manila · Singapore" },
  { id: "Asia/Shanghai", name: "China · Taiwan" },
  { id: "Asia/Tokyo", name: "Tokyo · Seoul" },
  { id: "Australia/Brisbane", name: "Brisbane" },
  { id: "Australia/Sydney", name: "Sydney" },
  { id: "Pacific/Auckland", name: "Auckland" },
];
const ZONE_BY_ID = new Map(ZONES.map((row) => [row.id, row]));
const clockFormats = new Map();

let timer = { state: "idle", startedAt: null, accumulatedMs: 0, pauseOverlays: true };
let chromeState = null;
let lastText = "";
let lastSuffix = "";
let lastKind = "";
let lastStyle = "";

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Number(n) || lo));
}

function elapsedMs() {
  const live = timer.state === "running" && timer.startedAt != null ? Date.now() - timer.startedAt : 0;
  return Math.max(0, (Number(timer.accumulatedMs) || 0) + live);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  let text = hudOptions.showHours || h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  if (hudOptions.showTenths) text += `.${Math.floor(ms / 100) % 10}`;
  return text;
}

function clockFormatter() {
  const zone = ZONE_BY_ID.has(hudOptions.clockZone) ? hudOptions.clockZone : "local";
  const key = `${zone}|${hudOptions.clock24 ? 24 : 12}`;
  if (!clockFormats.has(key)) {
    clockFormats.set(
      key,
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: hudOptions.clock24 ? "h23" : "h12",
        ...(zone === "local" ? {} : { timeZone: zone }),
      }),
    );
  }
  return clockFormats.get(key);
}

function formatClock() {
  const parts = {};
  for (const part of clockFormatter().formatToParts(new Date())) parts[part.type] = part.value;
  const hour = hudOptions.clock24 ? pad2(Number(parts.hour) || 0) : String(Number(parts.hour) || 12);
  let text = `${hour}:${parts.minute}`;
  if (hudOptions.clockSeconds !== false) text += `:${parts.second}`;
  const suffix = hudOptions.clock24 ? "" : String(parts.dayPeriod || "").toUpperCase();
  return { text, suffix };
}

function displayValue() {
  if (hudOptions.mode === "clock") return formatClock();
  return { text: formatTime(elapsedMs()), suffix: "" };
}

function zoneLabel() {
  return (ZONE_BY_ID.get(hudOptions.clockZone) || ZONES[0]).name.replace(" (this PC)", "");
}

function currentStyle() {
  return STYLE_BY_ID.get(hudOptions.style) || STYLES[0];
}

function seg7Char(ch) {
  if (ch === ":") return '<span class="c7"><i></i><i></i></span>';
  if (ch === ".") return '<span class="p7"><i></i></span>';
  const lit = SEGMENTS[ch] || "";
  return `<span class="d7">${"abcdefg"
    .split("")
    .map((seg) => `<i class="${seg}${lit.includes(seg) ? " on" : ""}"></i>`)
    .join("")}</span>`;
}

function dotChar(ch) {
  const rows = MATRIX[ch] || MATRIX[0];
  const cols = rows[0].length;
  const dots = rows
    .join("")
    .split("")
    .map((cell) => `<b${cell === "#" ? ' class="on"' : ""}></b>`)
    .join("");
  return `<span class="m5" style="--cols:${cols}">${dots}</span>`;
}

function fontChar(ch) {
  const sep = ch === ":" || ch === ".";
  return `<span class="ft${sep ? " sep" : ""}">${ch}</span>`;
}

function buildReadout(text, kind, suffix = "") {
  const draw = kind === "seg7" ? seg7Char : kind === "dot" ? dotChar : fontChar;
  const tail = suffix ? `<span class="ampm">${suffix}</span>` : "";
  return `<div class="readout-inner">${text.split("").map(draw).join("")}${tail}</div>`;
}

function fitReadout() {
  const inner = readout.firstElementChild;
  if (!inner) return;
  const natW = readout.offsetWidth;
  const natH = readout.offsetHeight;
  const box = face.getBoundingClientRect();
  if (!natW || !natH || !box.width || !box.height) return;
  const pad = clamp(hudOptions.padding ?? 10, 0, 40) / 100;
  const padX = Math.max(2, box.width * pad * 0.7);
  const padY = Math.max(2, box.height * pad * 1.4);
  const scale = Math.max(0.05, Math.min((box.width - padX * 2) / natW, (box.height - padY * 2) / natH));
  readout.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function paint(force = false) {
  const style = currentStyle();
  const { text, suffix } = displayValue();
  if (!force && text === lastText && suffix === lastSuffix && style.id === lastStyle) return;
  const reshape =
    force ||
    text.length !== lastText.length ||
    suffix !== lastSuffix ||
    style.kind !== lastKind ||
    style.id !== lastStyle;
  if (!reshape) {
    const inner = readout.firstElementChild;
    const draw = style.kind === "seg7" ? seg7Char : style.kind === "dot" ? dotChar : fontChar;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === lastText[i]) continue;
      const holder = document.createElement("div");
      holder.innerHTML = draw(text[i]);
      inner?.children[i]?.replaceWith(holder.firstElementChild);
    }
  } else {
    readout.dataset.kind = style.kind;
    readout.innerHTML = buildReadout(text, style.kind, suffix);
  }
  lastText = text;
  lastSuffix = suffix;
  lastKind = style.kind;
  lastStyle = style.id;
  if (reshape) fitReadout();
}

function applyState() {
  shell.dataset.state = timer.state;
  btnToggle.title = timer.state === "running" ? "Pause" : timer.state === "paused" ? "Resume" : "Start";
  if (hudOptions.mode === "clock") {
    stateTag.textContent = hudOptions.clockLabel === false ? "" : zoneLabel();
  } else if (timer.state === "paused") {
    stateTag.textContent = timer.pauseOverlays ? "Paused · meters frozen" : "Paused";
  } else {
    stateTag.textContent = "";
  }
}

/** Older builds saved an on/off Backdrop toggle; off maps to 0%. */
function backgroundOpacity() {
  if (hudOptions.bgOpacity == null && hudOptions.backdrop === false) return 0;
  return Number(hudOptions.bgOpacity ?? 100);
}

function rangeOpt(label, key, value, min, max) {
  return `
    <div class="hud-settings-row"><span>${label}</span><b>${Math.round(value)}%</b></div>
    <input class="hud-dim-range" type="range" min="${min}" max="${max}" data-opt="${key}" data-opt-type="range" data-opt-pct="1" value="${Math.round(value)}" />`;
}

function applyOptions() {
  const style = currentStyle();
  shell.dataset.style = style.id;
  shell.style.setProperty("--bg-pct", `${clamp(backgroundOpacity(), 0, 100)}%`);
  shell.dataset.blink = hudOptions.blinkPaused === false ? "0" : "1";
  shell.dataset.controls = hudOptions.alwaysControls ? "always" : "hover";
  shell.style.setProperty("--timer-opacity", String(clamp(hudOptions.opacity, 15, 100) / 100));
  const mode = hudOptions.mode === "clock" ? "clock" : "timer";
  shell.dataset.mode = mode;
  for (const btn of document.querySelectorAll("#modeSwitch [data-mode]")) {
    btn.classList.toggle("on", btn.dataset.mode === mode);
  }
  applyState();
  paint(true);
}

function setMode(mode) {
  if (mode === hudOptions.mode) return;
  hudOptions = { ...hudOptions, mode };
  if (chromeState) chromeState.options = { ...chromeState.options, mode };
  applyOptions();
  window.overlayHud?.saveHudPrefs?.(HUD_ID, { options: { ...hudOptions } });
}

for (const btn of document.querySelectorAll("#modeSwitch [data-mode]")) {
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    setMode(btn.dataset.mode);
  });
}

function setTimer(next) {
  if (!next) return;
  timer = { ...timer, ...next };
  applyState();
  paint();
}

async function command(cmd, payload) {
  try {
    setTimer(await window.overlayHud?.timerCommand?.(cmd, payload));
  } catch {
    /* ignore */
  }
}

btnToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  command("toggle");
});
btnStop.addEventListener("click", (event) => {
  event.stopPropagation();
  command("stop");
});
face.addEventListener("dblclick", () => {
  if (hudOptions.mode !== "clock") command("toggle");
});
document.addEventListener("keydown", (event) => {
  if (hudOptions.mode === "clock") return;
  if (event.code === "Space") {
    event.preventDefault();
    command("toggle");
  } else if (event.key === "Backspace" || event.key === "Delete") {
    command("stop");
  }
});
document.getElementById("close").addEventListener("click", () => {
  window.overlayHud?.closeMeter?.(HUD_ID);
});

function styleGrid(selected) {
  return STYLES.map(
    (row) => `
      <button type="button" class="hud-pick${row.id === selected ? " on" : ""}" data-opt-set="style" data-opt-value="${row.id}" title="${row.name}">
        <i class="hud-pick-swatch" style="background:${row.swatch};color:${row.swatch}"></i>
        <span>${row.name}</span>
      </button>`,
  ).join("");
}

function pickGrid(key, rows, selected) {
  return rows
    .map(
      (row) => `
      <button type="button" class="hud-pick${row.id === selected ? " on" : ""}" data-opt-set="${key}" data-opt-value="${row.id}" title="${row.name}">
        <span>${row.name}</span>
      </button>`,
    )
    .join("");
}

function toggleOpt(label, key, on) {
  return `
    <label class="hud-settings-row">
      <span>${label}</span>
      <span class="hud-toggle"><input type="checkbox" data-opt="${key}" data-opt-type="bool" ${on ? "checked" : ""} /></span>
    </label>`;
}

if (window.HudChrome) {
  Promise.resolve(
    window.HudChrome.mount({
    hudId: HUD_ID,
    hideCompact: true,
    defaultOptions: hudOptions,
    renderExtra: (options) => `
      <div class="hud-settings-head">Show</div>
      <div class="hud-pick-grid">${pickGrid(
        "mode",
        [
          { id: "timer", name: "Timer" },
          { id: "clock", name: "Clock" },
        ],
        options.mode === "clock" ? "clock" : "timer",
      )}</div>
      <div class="hud-settings-head">Clock</div>
      ${toggleOpt("24-hour", "clock24", Boolean(options.clock24))}
      ${toggleOpt("Show seconds", "clockSeconds", options.clockSeconds !== false)}
      ${toggleOpt("Show time zone name", "clockLabel", options.clockLabel !== false)}
      <div class="hud-settings-head">Time zone</div>
      <div class="hud-pick-grid">${pickGrid(
        "clockZone",
        ZONES,
        ZONE_BY_ID.has(options.clockZone) ? options.clockZone : "local",
      )}</div>
      <div class="hud-settings-head">Timer</div>
      ${toggleOpt("Pausing freezes all meters", "pauseOverlays", options.pauseOverlays !== false)}
      ${rangeOpt("Timer opacity", "opacity", clamp(options.opacity ?? 100, 15, 100), 15, 100)}
      ${rangeOpt("Background opacity", "bgOpacity", clamp(backgroundOpacity(), 0, 100), 0, 100)}
      ${rangeOpt("Padding", "padding", clamp(options.padding ?? 10, 0, 40), 0, 40)}
      ${toggleOpt("Always show hours", "showHours", Boolean(options.showHours))}
      ${toggleOpt("Show tenths", "showTenths", Boolean(options.showTenths))}
      ${toggleOpt("Blink while paused", "blinkPaused", options.blinkPaused !== false)}
      ${toggleOpt("Always show buttons", "alwaysControls", Boolean(options.alwaysControls))}
      <div class="hud-settings-head">Style · ${STYLES.length}</div>
      <div class="hud-pick-grid">${styleGrid(options.style || hudOptions.style)}</div>
      <p class="hud-settings-hint">Hover the timer to switch Timer / Clock. Resize the window to scale the digits. Space = start/pause, Delete = stop (when focused). Double-click the time to start/pause.</p>
    `,
    onOptions: (options) => {
      const prevPause = hudOptions.pauseOverlays !== false;
      hudOptions = { ...hudOptions, ...options };
      applyOptions();
      const nextPause = hudOptions.pauseOverlays !== false;
      if (nextPause !== prevPause || nextPause !== (timer.pauseOverlays !== false)) {
        command("config", { pauseOverlays: nextPause });
      }
    },
    }),
  ).then((state) => {
    chromeState = state || null;
  });
}

new ResizeObserver(() => fitReadout()).observe(face);
window.overlayHud?.onTimer?.(setTimer);
window.overlayHud
  ?.getTimer?.()
  .then(setTimer)
  .catch(() => {});

applyOptions();
applyState();
setInterval(() => paint(), 100);
