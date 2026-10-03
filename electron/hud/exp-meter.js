const subLabel = document.getElementById("subLabel");
const jobTrack = document.getElementById("jobTrack");

const xpRateEl = document.getElementById("xpRate");
const ttlEl = document.getElementById("ttl");
const xpEarnedEl = document.getElementById("xpEarned");
const xpRemainEl = document.getElementById("xpRemain");
const xpBarEl = document.getElementById("xpBar");
const xpPctEl = document.getElementById("xpPct");
const xpPctCompactEl = document.getElementById("xpPctCompact");
const baseLevelEl = document.getElementById("baseLevel");

const jobXpRateEl = document.getElementById("jobXpRate");
const jobTtlEl = document.getElementById("jobTtl");
const jobXpEarnedEl = document.getElementById("jobXpEarned");
const jobXpRemainEl = document.getElementById("jobXpRemain");
const jobXpBarEl = document.getElementById("jobXpBar");
const jobXpPctEl = document.getElementById("jobXpPct");
const jobLevelEl = document.getElementById("jobLevel");
const jobMaxBadge = document.getElementById("jobMaxBadge");
const jobSummary = document.getElementById("jobSummary");
const jobBarWrap = document.getElementById("jobBarWrap");

let hudOptions = { fontScale: 100, showJobExp: true };
let latest = null;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Number(n) || lo));
}

function applyScales() {
  const font = clamp(hudOptions.fontScale, 70, 160) / 100;
  document.documentElement.style.setProperty("--font-scale", String(font));
}

function money(value) {
  return Math.round(Number(value) || 0).toLocaleString();
}

function ttlLabel(ms, maxed) {
  if (maxed) return "MAX";
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const sec = Math.round(n / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  if (s <= 0) return "<1s";
  return `${s}s`;
}

function applyCompact(enabled) {
  document.documentElement.dataset.compact = enabled ? "1" : "0";
}

function renderTrack(opts) {
  const {
    rateEl,
    ttlEl: ttlNode,
    earnedEl,
    remainEl,
    barEl,
    pctEl,
    levelEl,
    rate,
    ttlMs,
    earned,
    remain,
    pct,
    level,
    maxLevel,
    maxed,
    unknownLabel,
  } = opts;

  rateEl.textContent = maxed ? "—" : money(rate);
  ttlNode.textContent = ttlLabel(ttlMs, maxed);
  earnedEl.textContent = maxed ? "—" : `+${money(earned)}`;
  if (maxed) {
    remainEl.textContent = "MAX";
    barEl.style.width = "100%";
    pctEl.textContent = `Lv ${level} · MAX (${maxLevel})`;
  } else if (remain == null) {
    remainEl.textContent = "—";
    barEl.style.width = "0%";
    pctEl.textContent = unknownLabel;
  } else {
    remainEl.textContent = money(remain);
    barEl.style.width = `${pct == null ? 0 : pct}%`;
    pctEl.textContent =
      pct == null ? unknownLabel : `${Number(pct).toFixed(1)}% to next level`;
  }
  levelEl.textContent =
    level != null && Number.isFinite(Number(level))
      ? `Lv ${Math.round(Number(level))}${maxLevel ? ` / ${maxLevel}` : ""}`
      : "Lv —";
  if (opts.pctCompactEl) {
    opts.pctCompactEl.textContent =
      maxed ? "MAX" : pct != null ? `${Number(pct).toFixed(1)}%` : "";
  }
}

function render(snapshot) {
  latest = snapshot;
  applyScales();
  const farm = snapshot?.farm;
  const personal = snapshot?.capture?.personalName;
  subLabel.textContent = personal ? `${personal} · since reset` : "Session · since reset";

  const showJob = hudOptions.showJobExp !== false;
  const maxBase = Number(farm?.maxBaseLevel) || 150;
  const maxJob = Number(farm?.maxJobLevel) || 70;

  if (!farm) {
    renderTrack({
      rateEl: xpRateEl,
      ttlEl,
      earnedEl: xpEarnedEl,
      remainEl: xpRemainEl,
      barEl: xpBarEl,
      pctEl: xpPctEl,
      levelEl: baseLevelEl,
      rate: 0,
      ttlMs: null,
      earned: 0,
      remain: null,
      pct: null,
      level: null,
      maxLevel: maxBase,
      maxed: false,
      unknownLabel: "0%",
    });
    jobTrack.hidden = !showJob;
    if (showJob) {
      jobTrack.dataset.maxed = "0";
      if (jobMaxBadge) jobMaxBadge.hidden = true;
      if (jobSummary) jobSummary.hidden = false;
      if (jobBarWrap) jobBarWrap.hidden = false;
      renderTrack({
        rateEl: jobXpRateEl,
        ttlEl: jobTtlEl,
        earnedEl: jobXpEarnedEl,
        remainEl: jobXpRemainEl,
        barEl: jobXpBarEl,
        pctEl: jobXpPctEl,
        levelEl: jobLevelEl,
        rate: 0,
        ttlMs: null,
        earned: 0,
        remain: null,
        pct: null,
        level: null,
        maxLevel: maxJob,
        maxed: false,
        unknownLabel: "0%",
      });
    }
    return;
  }

  const baseMaxed = Boolean(farm.baseMaxed) || Number(farm.level) >= maxBase;
  const jobMaxed = Boolean(farm.jobMaxed) || Number(farm.jobLevel) >= maxJob;

  renderTrack({
    rateEl: xpRateEl,
    ttlEl,
    earnedEl: xpEarnedEl,
    remainEl: xpRemainEl,
    barEl: xpBarEl,
    pctEl: xpPctEl,
    pctCompactEl: xpPctCompactEl,
    levelEl: baseLevelEl,
    rate: Math.max(0, Number(farm.xpPerHour) || 0),
    ttlMs: farm.ttlMs,
    earned: Math.max(0, Number(farm.xp) || 0),
    remain: farm.xpToLevel != null ? Math.max(0, Number(farm.xpToLevel) || 0) : null,
    pct: farm.xpPercent != null ? clamp(Number(farm.xpPercent) || 0, 0, 100) : null,
    level: farm.level,
    maxLevel: maxBase,
    maxed: baseMaxed,
    unknownLabel: "Level progress unknown",
  });

  // Job block: when maxed, show only "JOB MAX" — no rate/TTL noise.
  jobTrack.hidden = !showJob;
  if (showJob) {
    jobTrack.dataset.maxed = jobMaxed ? "1" : "0";
    if (jobMaxBadge) jobMaxBadge.hidden = !jobMaxed;
    if (jobSummary) jobSummary.hidden = jobMaxed;
    if (jobBarWrap) jobBarWrap.hidden = jobMaxed;
    if (jobMaxed) {
      jobLevelEl.textContent = "";
    } else {
      renderTrack({
        rateEl: jobXpRateEl,
        ttlEl: jobTtlEl,
        earnedEl: jobXpEarnedEl,
        remainEl: jobXpRemainEl,
        barEl: jobXpBarEl,
        pctEl: jobXpPctEl,
        levelEl: jobLevelEl,
        rate: Math.max(0, Number(farm.jobXpPerHour) || 0),
        ttlMs: farm.jobTtlMs,
        earned: Math.max(0, Number(farm.jobXp) || 0),
        remain: farm.jobXpToLevel != null ? Math.max(0, Number(farm.jobXpToLevel) || 0) : null,
        pct: farm.jobXpPercent != null ? clamp(Number(farm.jobXpPercent) || 0, 0, 100) : null,
        level: farm.jobLevel,
        maxLevel: maxJob,
        maxed: false,
        unknownLabel: "Job progress unknown",
      });
    }
  }
}

document.getElementById("reset").addEventListener("click", () => {
  window.overlayHud?.resetEncounter?.();
});
document.getElementById("close").addEventListener("click", () => {
  window.overlayHud?.closeMeter?.("exp-meter");
});

if (window.HudChrome) {
  window.HudChrome.mount({
    hudId: "exp-meter",
    resetBtn: document.getElementById("reset"),
    defaultOptions: hudOptions,
    renderExtra: (options) => `
      <div class="hud-settings-head">Exp</div>
      <div class="hud-settings-row"><span>Font size</span><b>${Math.round(options.fontScale || 100)}%</b></div>
      <input class="hud-dim-range" type="range" min="70" max="160" data-opt="fontScale" data-opt-type="range" value="${Math.round(
        options.fontScale || 100,
      )}" />
      <label class="hud-settings-row" style="display:flex;align-items:center;gap:8px;margin-top:10px">
        <input type="checkbox" data-opt="showJobExp" data-opt-type="bool" ${
          options.showJobExp !== false ? "checked" : ""
        } />
        <span>Show job level exp</span>
      </label>
      <p class="hud-settings-hint">Base caps at 150 · Job 70 = MAX. XP/hr and TTL come from ExpCoins bar deltas (same math as the game). Compare % next to TTL with the in-game bar.</p>
    `,
    onOptions: (options) => {
      hudOptions = { ...hudOptions, ...options };
      applyScales();
      if (latest) render(latest);
    },
  });
}

if (window.overlayHud?.onHudCompact) {
  window.overlayHud.onHudCompact((payload) => {
    if (payload?.id && payload.id !== "exp-meter") return;
    applyCompact(Boolean(payload?.enabled ?? payload?.map?.["exp-meter"]));
  });
}

applyScales();
if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
