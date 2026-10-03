const statusEl = document.getElementById("status");
const allowedList = document.getElementById("allowedList");
const forbiddenList = document.getElementById("forbiddenList");
const policySummary = document.getElementById("policySummary");
const policyNote = document.getElementById("policyNote");
const liveMetersEl = document.getElementById("liveMeters");
const soonMetersEl = document.getElementById("soonMeters");
const sessionDataEl = document.getElementById("sessionData");
const sessionPill = document.getElementById("sessionPill");
const captureNote = document.getElementById("captureNote");
const demoMode = document.getElementById("demoMode");
const clickThroughBtn = document.getElementById("clickThroughBtn");
const opacity = document.getElementById("opacity");
const opacityLabel = document.getElementById("opacityLabel");
const hudCorners = document.getElementById("hudCorners");
const nightMode = document.getElementById("nightMode");
const nightDim = document.getElementById("nightDim");
const nightDimLabel = document.getElementById("nightDimLabel");
const nightHint = document.getElementById("nightHint");
const dockEnabled = document.getElementById("dockEnabled");
const mouseIndicator = document.getElementById("mouseIndicator");
const mouseAnimate = document.getElementById("mouseAnimate");
const mouseFlash = document.getElementById("mouseFlash");
const mouseStyle = document.getElementById("mouseStyle");
const mousePill = document.getElementById("mousePill");
const mouseSwatch = document.getElementById("mouseSwatch");
const mouseStyleName = document.getElementById("mouseStyleName");
const mouseStyleMeta = document.getElementById("mouseStyleMeta");
const personalName = document.getElementById("personalName");
const previewTip = document.getElementById("previewTip");
const previewTipLabel = document.getElementById("previewTipLabel");
const previewTipBody = document.getElementById("previewTipBody");
const npcapText = document.getElementById("npcapText");
const runtimeText = document.getElementById("runtimeText");
const gameText = document.getElementById("gameText");

let cache = null;
let previewTimer = null;
let sessionsCache = [];
/** Click-through / locked HUDs — mirrored by the meters-panel button. */
let hudLocked = true;
/** Block status-driven re-renders while Start/Stop is in flight. */
let meterActionBusy = false;
let lastOpenHudsKey = "";
let statusRefreshTimer = null;

const PREVIEWS = {
  meters: {
    label: "Meters!",
    html: `<div class="mock"><div class="mock-title">METERS!</div><div class="mock-sub">Live combat</div><div class="mock-rate">439,910</div></div>`,
  },
  gold: {
    label: "Gold!",
    html: `<div class="mock"><div class="mock-title">GOLD!</div><div class="mock-sub">Wallet</div><div class="mock-chips"><span>Inv 1.2M</span><span>Earned 84K</span><span>92K/h</span></div></div>`,
  },
  kills: {
    label: "Kills!",
    html: `<div class="mock"><div class="mock-title">KILLS!</div><div class="mock-sub">Session</div><div class="mock-chips"><span>142 kills</span><span>Slime ×48</span><span>Wolf ×31</span></div></div>`,
  },
  exp: {
    label: "Exp!",
    html: `<div class="mock"><div class="mock-title">EXP!</div><div class="mock-sub">Progress</div><div class="mock-chips"><span>275K/h</span><span>TTL 42m</span></div></div>`,
  },
  pets: {
    label: "Pets!",
    html: `<div class="mock"><div class="mock-title">PETS!</div><div class="mock-sub">Summons</div><div class="mock-chips"><span>2 active</span><span>Wolf 72%</span><span>Sprite 100%</span></div></div>`,
  },
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(value) {
  const n = Number(value) || 0;
  return n.toLocaleString();
}

function durationLabel(ms) {
  const sec = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function prettyDate(key) {
  const d = new Date(`${key}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return key;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function timeLabel(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function setCheck(name, state, text) {
  const el = document.querySelector(`[data-check="${name}"]`);
  if (!el) return;
  el.classList.remove("ok", "warn", "bad");
  el.classList.add(state);
  const p = el.querySelector("p");
  if (p) p.textContent = text;
}

function hidePreview() {
  clearTimeout(previewTimer);
  previewTip.hidden = true;
}

function placePreview(event) {
  const pad = 14;
  const tip = previewTip;
  tip.hidden = false;
  const w = tip.offsetWidth || 280;
  const h = tip.offsetHeight || 120;
  let x = event.clientX + 16;
  let y = event.clientY + 16;
  if (x + w > window.innerWidth - pad) x = event.clientX - w - 12;
  if (y + h > window.innerHeight - pad) y = event.clientY - h - 12;
  tip.style.left = `${Math.max(pad, x)}px`;
  tip.style.top = `${Math.max(pad, y)}px`;
}

function showPreview(event, key) {
  const preview = PREVIEWS[key];
  if (!preview) return;
  previewTipLabel.textContent = preview.label;
  previewTipBody.innerHTML = preview.html;
  placePreview(event);
}

function modeValue() {
  return demoMode.checked ? "demo" : "live";
}

async function persistUiPrefs() {
  const panels = {};
  for (const input of document.querySelectorAll("[data-panel-toggle]")) {
    panels[input.dataset.panelToggle] = input.checked;
  }
  const startInclude = { ...(cache?.prefs?.startInclude || {}) };
  for (const input of document.querySelectorAll("[data-start-include]")) {
    startInclude[input.dataset.startInclude] = input.checked;
  }
  await window.overlay.savePrefs({
    personalName: personalName.value.trim(),
    locked: hudLocked,
    opacity: Number(opacity.value) / 100,
    hudCorners: hudCorners.checked ? "round" : "square",
    captureMode: modeValue(),
    panels,
    startInclude,
  });
}

function applyClickThroughUi(locked) {
  hudLocked = locked !== false;
  if (!clickThroughBtn) return;
  clickThroughBtn.setAttribute("aria-pressed", hudLocked ? "true" : "false");
  clickThroughBtn.classList.toggle("on", hudLocked);
  const strong = clickThroughBtn.querySelector("strong");
  const small = clickThroughBtn.querySelector("small");
  if (strong) strong.textContent = hudLocked ? "Click-through on" : "Click-through off";
  if (small) {
    small.textContent = hudLocked
      ? "Clicks pass through · only reset, close, and settings stay clickable · unlock to move"
      : "HUDs interactive · drag title to move · edges to resize";
  }
}

function applyNightUi(state = {}) {
  const enabled = state.enabled ?? state.nightMode ?? false;
  const dim = Math.round((state.dim ?? state.nightDim ?? 0.45) * 100);
  nightMode.checked = Boolean(enabled);
  nightDim.value = String(Math.min(75, Math.max(0, dim)));
  nightDimLabel.textContent = `${nightDim.value}%`;
  if (!enabled) {
    nightHint.textContent =
      "Off. Turn on to shade the game. Clicks pass through. Ctrl+Shift+D toggles.";
  } else if (state.mode === "screen") {
    nightHint.textContent = `Fullscreen dim at ${nightDim.value}% (whole monitor). Ctrl+Shift+D toggles.`;
  } else if (state.gameFound || state.mode === "window") {
    nightHint.textContent = `Shading the SpiritVale window at ${nightDim.value}%. HUDs stay on top. Ctrl+Shift+D toggles.`;
  } else {
    nightHint.textContent = `Shading this monitor at ${nightDim.value}% until SpiritVale is found. Ctrl+Shift+D toggles.`;
  }
}

function fillMouseStyles(presets = []) {
  if (!Array.isArray(presets) || !presets.length) return;
  const current = mouseStyle.value;
  const groups = new Map();
  for (const row of presets) {
    const g = row.group || "Styles";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(row);
  }
  mouseStyle.innerHTML = [...groups.entries()]
    .map(([group, rows]) => {
      const options = rows
        .map(
          (row) =>
            `<option value="${escapeHtml(row.id)}" data-color="${escapeHtml(row.color)}" data-color2="${escapeHtml(row.color2 || row.color)}" data-group="${escapeHtml(row.group)}" data-animate="${escapeHtml(row.animate)}" data-name="${escapeHtml(row.name)}">${escapeHtml(row.name)}</option>`,
        )
        .join("");
      return `<optgroup label="${escapeHtml(group)}">${options}</optgroup>`;
    })
    .join("");
  if (current && [...mouseStyle.options].some((o) => o.value === current)) {
    mouseStyle.value = current;
  }
}

function applyMouseUi(state = {}, prefs = {}) {
  const enabled = state.enabled ?? prefs.mouseIndicator ?? false;
  const styleId = state.styleId || prefs.mouseIndicatorStyle || "neon-cyan-ring";
  const animate = state.animate ?? prefs.mouseIndicatorAnimate ?? true;
  const flash = state.flash ?? prefs.mouseIndicatorFlash ?? false;
  if (Array.isArray(state.presets) && state.presets.length) {
    fillMouseStyles(state.presets);
  }
  mouseIndicator.checked = Boolean(enabled);
  mouseAnimate.checked = Boolean(animate);
  mouseFlash.checked = Boolean(flash);
  if ([...mouseStyle.options].some((o) => o.value === styleId)) {
    mouseStyle.value = styleId;
  }
  const opt = mouseStyle.selectedOptions?.[0];
  const color = opt?.dataset.color || "#00f6ff";
  const color2 = opt?.dataset.color2 || "#ffffff";
  const name = opt?.dataset.name || state.styleName || styleId;
  const group = opt?.dataset.group || "Style";
  const anim = opt?.dataset.animate || "pulse";
  mouseSwatch.style.borderColor = color;
  mouseSwatch.style.background = `radial-gradient(circle, ${color2} 0%, ${color} 55%, transparent 72%)`;
  mouseSwatch.style.boxShadow = `0 0 0 1px rgba(255,255,255,0.12), 0 0 16px ${color}`;
  mouseStyleName.textContent = name;
  mouseStyleMeta.textContent = `${group} · ${anim}${flash ? " · flash" : ""}`;
  mousePill.textContent = enabled ? "On" : "Off";
  mousePill.classList.toggle("on", Boolean(enabled));
}

function applyCompactUi(map = {}) {
  for (const input of document.querySelectorAll("[data-compact-hud]")) {
    input.checked = Boolean(map[input.dataset.compactHud]);
  }
}

function applyDockUi(dock = {}) {
  if (dockEnabled) dockEnabled.checked = Boolean(dock.enabled);
  const include = dock.include || {};
  for (const input of document.querySelectorAll("[data-dock-hud]")) {
    input.checked = include[input.dataset.dockHud] !== false;
  }
}

function applyStartIncludeUi(map = {}) {
  for (const input of document.querySelectorAll("[data-start-include]")) {
    input.checked = map[input.dataset.startInclude] !== false;
  }
}

function meterIsOpen(panel, openHuds = [], prefs = {}) {
  const openSet = new Set(openHuds || []);
  if (openSet.has(panel)) return true;
  if (panel === "session-timer") return false;
  const dock = prefs.hudDock || {};
  if (
    dock.enabled &&
    openSet.has("dock-bar") &&
    (dock.include?.[panel] !== false)
  ) {
    return true;
  }
  return false;
}

function openHudsKey(list = []) {
  return (list || []).slice().sort().join("|");
}

function patchMeterRunningState(openHuds = []) {
  if (meterActionBusy) return;
  const prefs = cache?.prefs || {};
  for (const card of liveMetersEl.querySelectorAll(".meter-card.live[data-hud]")) {
    const panel = card.getAttribute("data-hud");
    const isOpen = meterIsOpen(panel, openHuds, prefs);
    card.classList.toggle("running", isOpen);
    const badge = card.querySelector(".badge");
    if (badge) {
      badge.className = `badge ${isOpen ? "live" : "idle"}`;
      badge.textContent = isOpen ? "Running" : "Not running";
    }
    const actions = card.querySelector(".card-actions");
    if (!actions || actions.querySelector("button:disabled")) continue;
    const wantStop = isOpen;
    const hasStop = Boolean(actions.querySelector("[data-stop-hud]"));
    if (wantStop === hasStop) continue;
    actions.innerHTML = wantStop
      ? `<button type="button" class="svo-glow stop" data-stop-hud="${escapeHtml(panel)}">Stop</button>`
      : `<button type="button" class="svo-glow" data-start-hud="${escapeHtml(panel)}">Start</button>`;
  }
  lastOpenHudsKey = openHudsKey(openHuds);
}

function renderMeters(roadmap = [], prefs = {}, openHuds = []) {
  if (meterActionBusy) return;
  lastOpenHudsKey = openHudsKey(openHuds);
  const live = roadmap.filter((row) => row.status === "live");
  const soon = roadmap.filter((row) => row.status !== "live");
  const compact = prefs.hudCompact || {};
  const dockInclude = prefs.hudDock?.include || {};
  const startInclude = prefs.startInclude || {};

  liveMetersEl.innerHTML = live
    .map((item) => {
      const panel = item.panel || item.id;
      const startOn = startInclude[panel] !== false;
      const compactOn = Boolean(compact[panel]);
      const dockOn = dockInclude[panel] !== false;
      const isOpen = meterIsOpen(panel, openHuds, prefs);
      return `
      <article class="meter-card live${isOpen ? " running" : ""}" data-hud="${escapeHtml(panel)}">
        <div class="meter-card-top">
          <span class="badge ${isOpen ? "live" : "idle"}">${isOpen ? "Running" : "Not running"}</span>
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.detail)}</p>
        </div>
        <div class="meter-toggles">
          <label class="meter-toggle start ${startOn ? "on" : ""}">
            <input type="checkbox" data-start-include="${escapeHtml(panel)}" ${startOn ? "checked" : ""} />
            <span class="meter-toggle-ui" aria-hidden="true"></span>
            <span class="meter-toggle-label">
              <b>Start</b>
              <i>Include in Start Overlay</i>
            </span>
          </label>
          ${
            item.standalone
              ? ""
              : `<label class="meter-toggle">
            <input type="checkbox" data-compact-hud="${escapeHtml(panel)}" ${compactOn ? "checked" : ""} />
            <span class="meter-toggle-ui" aria-hidden="true"></span>
            <span class="meter-toggle-label">
              <b>Compact</b>
              <i>Thin strip layout</i>
            </span>
          </label>
          <label class="meter-toggle">
            <input type="checkbox" data-dock-hud="${escapeHtml(panel)}" ${dockOn ? "checked" : ""} />
            <span class="meter-toggle-ui" aria-hidden="true"></span>
            <span class="meter-toggle-label">
              <b>Dock</b>
              <i>Join one-bar dock</i>
            </span>
          </label>`
          }
        </div>
        <div class="card-actions">
          ${
            isOpen
              ? `<button type="button" class="svo-glow stop" data-stop-hud="${escapeHtml(panel)}">Stop</button>`
              : `<button type="button" class="svo-glow" data-start-hud="${escapeHtml(panel)}">Start</button>`
          }
        </div>
      </article>`;
    })
    .join("");

  soonMetersEl.innerHTML = soon
    .map((item) => {
      return `
      <article class="meter-card soon">
        <div>
          <span class="badge soon">Coming soon</span>
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.detail)}</p>
        </div>
        <div class="card-actions">
          <span class="badge soon">Coming soon</span>
        </div>
      </article>`;
    })
    .join("");

  applyCompactUi(compact);
  applyDockUi(prefs.hudDock || {});
  applyStartIncludeUi(startInclude);
}

function hourBuckets(sessions = []) {
  const hours = Array.from({ length: 24 }, () => ({
    gold: 0,
    xp: 0,
    kills: 0,
    damage: 0,
  }));
  for (const row of sessions) {
    const t = new Date(row.endedAt || row.startedAt);
    if (!Number.isFinite(t.getTime())) continue;
    const h = t.getHours();
    hours[h].gold += Number(row.gold) || 0;
    hours[h].xp += Number(row.xp) || 0;
    hours[h].kills += Number(row.kills) || 0;
    hours[h].damage += Number(row.totalDamage) || 0;
  }
  return hours;
}

const GRAPH_COLORS = {
  gold: "#e0c36a",
  xp: "#7ad7ff",
  kills: "#3ee0b0",
  damage: "#ff8d8d",
};

const GRAPH_LABELS = {
  gold: "Gold",
  xp: "XP",
  kills: "Kills",
  damage: "Damage",
};

function niceMax(value) {
  const n = Math.max(1, Number(value) || 1);
  const exp = Math.floor(Math.log10(n));
  const base = 10 ** exp;
  const mant = n / base;
  let nice = 1;
  if (mant <= 1) nice = 1;
  else if (mant <= 2) nice = 2;
  else if (mant <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

function axisLabel(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return money(n);
}

function drawDayGraph(canvas, sessions, selectedStat = "gold") {
  if (!canvas) return;
  const key = GRAPH_COLORS[selectedStat] ? selectedStat : "gold";
  const hours = hourBuckets(sessions);
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 640;
  const cssH = canvas.clientHeight || 180;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const pad = { l: 44, r: 14, t: 18, b: 28 };
  const plotW = cssW - pad.l - pad.r;
  const plotH = cssH - pad.t - pad.b;
  let rawMax = 1;
  for (const hour of hours) rawMax = Math.max(rawMax, hour[key] || 0);
  const maxY = niceMax(rawMax);
  const color = GRAPH_COLORS[key] || "#fff";

  // Grid + Y ticks for this stat only
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#9bb5ad";
  ctx.font = "10px Segoe UI, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.t + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(cssW - pad.r, y);
    ctx.stroke();
    const tick = maxY * (1 - i / 4);
    ctx.fillText(axisLabel(tick), pad.l - 6, y);
  }

  // X axis hours
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (let h = 0; h < 24; h += 3) {
    const x = pad.l + (plotW * h) / 23;
    ctx.fillText(`${h}`, x, cssH - 8);
  }

  // Title for selected meter
  ctx.textAlign = "left";
  ctx.fillStyle = color;
  ctx.font = "600 11px Segoe UI, system-ui, sans-serif";
  ctx.fillText(GRAPH_LABELS[key] || key, pad.l, 12);

  // Area fill under trend
  ctx.beginPath();
  hours.forEach((hour, idx) => {
    const x = pad.l + (plotW * idx) / 23;
    const y = pad.t + plotH - ((hour[key] || 0) / maxY) * plotH;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  const lastX = pad.l + plotW;
  ctx.lineTo(lastX, pad.t + plotH);
  ctx.lineTo(pad.l, pad.t + plotH);
  ctx.closePath();
  ctx.fillStyle = color.length === 7 ? `${color}22` : "rgba(255,255,255,0.08)";
  ctx.fill();

  // Trend line
  ctx.beginPath();
  hours.forEach((hour, idx) => {
    const x = pad.l + (plotW * idx) / 23;
    const y = pad.t + plotH - ((hour[key] || 0) / maxY) * plotH;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.25;
  ctx.lineJoin = "round";
  ctx.stroke();

  // Hour points
  for (let idx = 0; idx < hours.length; idx += 1) {
    const value = hours[idx][key] || 0;
    if (value <= 0) continue;
    const x = pad.l + (plotW * idx) / 23;
    const y = pad.t + plotH - (value / maxY) * plotH;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function renderSessions(days = []) {
  sessionsCache = days;
  if (!days.length) {
    sessionDataEl.innerHTML =
      `<p class="empty">No saved sessions yet. Run Overlay, play, then Stop or Reset Encounter.</p>`;
    return;
  }

  sessionDataEl.innerHTML = days
    .map((day, dayIndex) => {
      const t = day.totals || {};
      const rows = (day.sessions || [])
        .map(
          (s) => `
        <div class="session-row">
          <div class="when">${escapeHtml(timeLabel(s.endedAt || s.startedAt))}</div>
          <div class="facts">
            ${money(s.gold)} gold · ${money(s.xp)} XP · ${money(s.totalDamage)} dmg · ${durationLabel(s.elapsedMs)}
          </div>
          <div class="tag">${escapeHtml(s.reason || s.mode || "session")}</div>
        </div>`,
        )
        .join("");
      return `
      <details class="day-card" data-day-index="${dayIndex}">
        <summary>
          <div>
            <div class="day-title">${escapeHtml(prettyDate(day.date))}</div>
            <div class="day-meta">${t.count || 0} session${t.count === 1 ? "" : "s"} · ${durationLabel(t.elapsedMs)} · double-click for graph</div>
          </div>
          <div class="day-totals">
            <span class="stat-pill"><strong>${money(t.gold)}</strong> gold</span>
            <span class="stat-pill"><strong>${money(t.xp)}</strong> XP</span>
            <span class="stat-pill"><strong>${money(t.damage)}</strong> dmg</span>
            <span class="stat-pill"><strong>${money(t.kills)}</strong> kills</span>
          </div>
        </summary>
        <div class="day-graph" hidden data-graph-for="${dayIndex}" data-selected-stat="gold">
          <div class="graph-filters">
            <button type="button" class="graph-filter on" data-stat="gold">Gold</button>
            <button type="button" class="graph-filter" data-stat="xp">XP</button>
            <button type="button" class="graph-filter" data-stat="kills">Kills</button>
            <button type="button" class="graph-filter" data-stat="damage">Damage</button>
          </div>
          <div class="graph-canvas-wrap"><canvas></canvas></div>
          <p class="graph-hint">Select one meter · X = 24h clock · Y scales to that meter’s hourly totals</p>
        </div>
        <div class="day-sessions">${rows}</div>
      </details>`;
    })
    .join("");
}

function render(data) {
  cache = data;
  const { policy, prefs, runtime, roadmap } = data;

  policySummary.textContent = policy.summary;
  policyNote.textContent = policy.officialRulesNote;
  allowedList.innerHTML = policy.allowed.map((row) => `<li>${escapeHtml(row)}</li>`).join("");
  forbiddenList.innerHTML = policy.forbidden.map((row) => `<li>${escapeHtml(row)}</li>`).join("");

  demoMode.checked = (prefs.captureMode || "live") === "demo";
  applyClickThroughUi(prefs.locked !== false);
  opacity.value = Math.round((prefs.opacity ?? 0.88) * 100);
  if (opacityLabel) opacityLabel.textContent = `${opacity.value}%`;
  hudCorners.checked = prefs.hudCorners !== "square";
  personalName.value = prefs.personalName || "";
  const personalHint = document.getElementById("personalNameHint");
  if (personalHint) {
    personalHint.textContent = prefs.personalName
      ? `Last detected: ${prefs.personalName}. Updates automatically when you log in on another character.`
      : "Reads the character you log into. Leave blank — it fills in automatically.";
  }
  applyNightUi(runtime.nightMode || prefs);
  applyMouseUi(runtime.mouseIndicator || {}, prefs);
  applyDockUi(prefs.hudDock || {});

  sessionPill.textContent = runtime.running
    ? `${String(runtime.mode || "live").toUpperCase()} · ON`
    : "Idle";
  sessionPill.classList.toggle("on", runtime.running);

  setCheck(
    "npcap",
    runtime.npcapInstalled ? "ok" : "bad",
    runtime.npcapInstalled ? "Ready" : "Not installed — click Install",
  );
  setCheck(
    "runtime",
    runtime.bunReady ? "ok" : "bad",
    runtime.bunReady ? "Ready" : "Missing — reinstall Spiritvale Overlay",
  );
  const gameSeen = Boolean(runtime.live?.gameSeen || runtime.capture?.gameSeen);
  if (runtime.running && runtime.mode === "live" && gameSeen) {
    setCheck("game", "ok", "Traffic seen — linked to SpiritVale");
  } else if (runtime.running && runtime.mode === "live") {
    setCheck("game", "warn", "Listening… open the game / enter combat");
  } else if (runtime.running && runtime.mode === "demo") {
    setCheck("game", "warn", "Demo mode (not linked to the game)");
  } else {
    setCheck("game", "warn", "Start Overlay while SpiritVale is running");
  }

  captureNote.textContent = runtime.captureNote || "";
  if (runtime.live?.error) {
    statusEl.textContent = runtime.live.error;
  } else if (runtime.running) {
    statusEl.textContent =
      runtime.mode === "live"
        ? "Live — Meters!, Gold!, Kills!, and Exp! are open. Fight something."
        : "Demo overlay running — turn off Demo mode for real combat.";
  } else if (runtime.captureReady) {
    statusEl.textContent = "Ready. Start Overlay opens Meters!, Gold!, Kills!, and Exp!";
  } else {
    statusEl.textContent = runtime.captureNote || "Finish setup, then Start Overlay.";
  }

  renderMeters(roadmap || [], prefs, runtime.openHuds || []);
}

async function refreshSessions() {
  if (!window.overlay?.getSessions) return;
  try {
    const days = await window.overlay.getSessions();
    renderSessions(days || []);
  } catch {
    renderSessions([]);
  }
}

async function refresh() {
  if (meterActionBusy) return;
  const data = await window.overlay.getStatus();
  render(data);
  await refreshSessions();
}

async function refreshFromStatusEvent(payload = {}) {
  if (meterActionBusy) return;
  const nextKey = openHudsKey(payload.openHuds || []);
  // Soft update when only capture/live chrome changed — keep Start/Stop DOM stable.
  if (cache && nextKey === lastOpenHudsKey && liveMetersEl.querySelector(".meter-card")) {
    if (cache.runtime) {
      cache.runtime = {
        ...cache.runtime,
        running: payload.running ?? cache.runtime.running,
        mode: payload.mode ?? cache.runtime.mode,
        openHuds: payload.openHuds || cache.runtime.openHuds,
        capture: payload.capture ?? cache.runtime.capture,
        live: payload.live ?? cache.runtime.live,
        error: payload.error,
      };
    }
    // Reuse render's status lines without rebuilding meter cards.
    const runtime = {
      ...(cache.runtime || {}),
      npcapInstalled: cache.runtime?.npcapInstalled,
      bunReady: cache.runtime?.bunReady,
      captureReady: cache.runtime?.captureReady,
      captureNote: cache.runtime?.captureNote,
    };
    sessionPill.textContent = runtime.running
      ? `${String(runtime.mode || "live").toUpperCase()} · ON`
      : "Idle";
    sessionPill.classList.toggle("on", Boolean(runtime.running));
    if (payload.error) statusEl.textContent = String(payload.error);
    patchMeterRunningState(payload.openHuds || []);
    const detected = String(payload.capture?.personalName || "").trim();
    if (detected && document.activeElement !== personalName) {
      personalName.value = detected;
      const hint = document.getElementById("personalNameHint");
      if (hint) hint.textContent = `Playing as ${detected} (detected from game).`;
    }
    return;
  }
  await refresh();
}

document.getElementById("startOverlay").addEventListener("click", async () => {
  await persistUiPrefs();
  await window.overlay.start({ mode: modeValue() });
  await refresh();
});

document.getElementById("stopOverlay").addEventListener("click", async () => {
  await window.overlay.stop();
  await refresh();
});

document.getElementById("resetEncounter").addEventListener("click", async () => {
  await window.overlay.resetEncounter();
  await refresh();
});

document.getElementById("zeroMeters")?.addEventListener("click", async () => {
  await window.overlay.zeroMeters?.();
  await refresh();
});

document.getElementById("acceptPolicy").addEventListener("click", async () => {
  await window.overlay.acceptPolicy();
  await refresh();
});

document.getElementById("clearSessions").addEventListener("click", async () => {
  if (!window.overlay?.clearSessions) return;
  const ok = window.confirm("Clear all saved Overlay session history?");
  if (!ok) return;
  const days = await window.overlay.clearSessions();
  renderSessions(days || []);
});

liveMetersEl.addEventListener("click", async (event) => {
  const stopBtn = event.target.closest("[data-stop-hud]");
  if (stopBtn) {
    event.preventDefault();
    event.stopPropagation();
    if (meterActionBusy || stopBtn.disabled) return;
    const hudId = stopBtn.getAttribute("data-stop-hud") || stopBtn.dataset.stopHud || "";
    meterActionBusy = true;
    stopBtn.disabled = true;
    try {
      if (window.overlay?.closeHud && hudId) {
        await window.overlay.closeHud(hudId);
      }
    } catch (err) {
      console.error("closeHud failed", err);
    } finally {
      meterActionBusy = false;
    }
    await refresh();
    return;
  }
  const startBtn = event.target.closest("[data-start-hud]");
  if (!startBtn) return;
  event.preventDefault();
  event.stopPropagation();
  if (meterActionBusy || startBtn.disabled) return;
  const hudId = startBtn.getAttribute("data-start-hud") || startBtn.dataset.startHud || "";
  meterActionBusy = true;
  startBtn.disabled = true;
  try {
    await persistUiPrefs();
    await window.overlay.start({ mode: modeValue(), onlyHud: hudId });
  } catch (err) {
    console.error("startHud failed", err);
  } finally {
    meterActionBusy = false;
  }
  await refresh();
});

liveMetersEl.addEventListener("change", async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;

  if (input.dataset.startInclude) {
    input.closest(".meter-toggle")?.classList.toggle("on", input.checked);
    await persistUiPrefs();
    return;
  }
  if (input.dataset.compactHud) {
    if (window.overlay?.setHudCompact) {
      await window.overlay.setHudCompact(input.dataset.compactHud, input.checked);
    }
    return;
  }
  if (input.dataset.dockHud) {
    await persistDockPrefs();
  }
});

clickThroughBtn?.addEventListener("click", async () => {
  applyClickThroughUi(!hudLocked);
  await persistUiPrefs();
  await window.overlay.setLocked(hudLocked);
});

if (window.overlay?.onLocked) {
  window.overlay.onLocked((payload) => {
    applyClickThroughUi(payload?.locked !== false);
  });
}

opacity.addEventListener("input", async () => {
  if (opacityLabel) opacityLabel.textContent = `${opacity.value}%`;
  await window.overlay.setOpacity(Number(opacity.value) / 100);
});
opacity.addEventListener("change", () => persistUiPrefs());

hudCorners.addEventListener("change", () => persistUiPrefs());

nightMode.addEventListener("change", async () => {
  await window.overlay.setNightMode({ enabled: nightMode.checked });
});

nightDim.addEventListener("input", async () => {
  nightDimLabel.textContent = `${nightDim.value}%`;
  await window.overlay.setNightMode({ dim: Number(nightDim.value) / 100 });
});

async function persistDockPrefs() {
  if (!window.overlay?.setHudDock) return;
  const include = {};
  for (const input of document.querySelectorAll("[data-dock-hud]")) {
    include[input.dataset.dockHud] = input.checked;
  }
  // Preserve any dock prefs for meters not currently rendered.
  const prev = cache?.prefs?.hudDock?.include || {};
  await window.overlay.setHudDock({
    enabled: Boolean(dockEnabled?.checked),
    include: { ...prev, ...include },
  });
}

dockEnabled?.addEventListener("change", persistDockPrefs);

sessionDataEl.addEventListener("dblclick", (event) => {
  const card = event.target.closest(".day-card");
  if (!card) return;
  event.preventDefault();
  const idx = Number(card.dataset.dayIndex);
  const graph = card.querySelector("[data-graph-for]");
  if (!graph) return;
  const show = graph.hidden;
  graph.hidden = !show;
  card.open = true;
  if (!show) return;
  const day = sessionsCache[idx];
  const canvas = graph.querySelector("canvas");
  const selected = graph.dataset.selectedStat || "gold";
  requestAnimationFrame(() => drawDayGraph(canvas, day?.sessions || [], selected));
});

sessionDataEl.addEventListener("click", (event) => {
  const btn = event.target.closest(".graph-filter");
  if (!btn) return;
  const graph = btn.closest(".day-graph");
  if (!graph) return;
  const selected = btn.dataset.stat || "gold";
  graph.dataset.selectedStat = selected;
  for (const el of graph.querySelectorAll(".graph-filter")) {
    el.classList.toggle("on", el.dataset.stat === selected);
  }
  const idx = Number(graph.dataset.graphFor);
  const day = sessionsCache[idx];
  drawDayGraph(graph.querySelector("canvas"), day?.sessions || [], selected);
});

if (window.overlay?.onNightMode) {
  window.overlay.onNightMode((state) => applyNightUi(state || {}));
}

mouseIndicator.addEventListener("change", async () => {
  await window.overlay.setMouseIndicator({ enabled: mouseIndicator.checked });
});

mouseAnimate.addEventListener("change", async () => {
  await window.overlay.setMouseIndicator({ animate: mouseAnimate.checked });
});

mouseFlash.addEventListener("change", async () => {
  await window.overlay.setMouseIndicator({ flash: mouseFlash.checked });
});

mouseStyle.addEventListener("change", async () => {
  applyMouseUi(
    {
      enabled: mouseIndicator.checked,
      styleId: mouseStyle.value,
      animate: mouseAnimate.checked,
      flash: mouseFlash.checked,
    },
    {},
  );
  await window.overlay.setMouseIndicator({ styleId: mouseStyle.value });
});

async function cycleMousePreset(delta) {
  const options = [...mouseStyle.options].filter((o) => o.value);
  if (!options.length) return;
  const idx = Math.max(0, options.findIndex((o) => o.value === mouseStyle.value));
  const next = options[(idx + delta + options.length) % options.length];
  if (!next || next.value === mouseStyle.value) return;
  mouseStyle.value = next.value;
  mouseStyle.dispatchEvent(new Event("change"));
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (
    target &&
    (target.matches(
      "input[type='text'], textarea, input:not([type]), input[type='search']",
    ) ||
      target.isContentEditable)
  ) {
    return;
  }
  event.preventDefault();
  cycleMousePreset(event.key === "ArrowDown" ? 1 : -1);
});

if (window.overlay?.onMouseIndicator) {
  window.overlay.onMouseIndicator((state) => applyMouseUi(state || {}, {}));
}

demoMode.addEventListener("change", () => persistUiPrefs());
personalName.addEventListener("change", () => persistUiPrefs());

document.body.addEventListener("mouseover", (event) => {
  const host = event.target.closest("[data-preview]");
  if (!host || host.classList.contains("meter-card")) return;
  if (event.target.closest("input, button, a")) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => showPreview(event, host.dataset.preview), 120);
});

document.body.addEventListener("mousemove", (event) => {
  if (previewTip.hidden) return;
  const host = event.target.closest("[data-preview]");
  if (!host || host.classList.contains("meter-card")) return;
  placePreview(event);
});

document.body.addEventListener("mouseout", (event) => {
  const host = event.target.closest("[data-preview]");
  if (!host || host.classList.contains("meter-card")) return;
  if (host.contains(event.relatedTarget)) return;
  hidePreview();
});

document.body.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-link]");
  if (!btn || !cache) return;
  const url = cache.links?.[btn.dataset.link];
  if (url) await window.overlay.openLink(url);
});

if (window.overlay?.onStatusChanged) {
  window.overlay.onStatusChanged((payload) => {
    clearTimeout(statusRefreshTimer);
    statusRefreshTimer = setTimeout(() => {
      refreshFromStatusEvent(payload || {}).catch(() => {});
    }, 80);
  });
}

if (window.overlay?.onIdentity) {
  window.overlay.onIdentity((payload) => {
    const name = String(payload?.personalName || "").trim();
    if (!name) return;
    if (document.activeElement !== personalName) personalName.value = name;
    const hint = document.getElementById("personalNameHint");
    if (hint) {
      hint.textContent = `Playing as ${name} (detected from game).`;
    }
  });
}

refresh().catch((err) => {
  statusEl.textContent = `Overlay failed to load: ${err.message || err}`;
});
