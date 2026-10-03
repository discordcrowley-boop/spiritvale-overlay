const rowsEl = document.getElementById("rows");
const titleLabel = document.getElementById("titleLabel");
const statusLeft = document.getElementById("statusLeft");
const statusRight = document.getElementById("statusRight");
const menuEl = document.getElementById("menu");
const menuBtn = document.getElementById("menuBtn");
const bossBtn = document.getElementById("bossOnly");

const BOSS_MODE = {
  id: "boss",
  title: "Boss Damage",
  valueKey: "bossDps",
  amountKey: "bossDamage",
  skillsKey: "bossSkills",
};

const MODES = [
  {
    id: "dps",
    title: "Damage Done",
    valueKey: "dps",
    amountKey: "damage",
    skillsKey: "skills",
    totalRate: "totalDps",
    totalAmount: "totalDamage",
  },
  {
    id: "hps",
    title: "Healing Done",
    valueKey: "hps",
    amountKey: "healing",
    skillsKey: "healingSkills",
    totalRate: "totalHps",
    totalAmount: "totalHealing",
  },
  {
    id: "taken",
    title: "Damage Taken",
    valueKey: "takenDps",
    amountKey: "taken",
    skillsKey: "takenSkills",
    totalRate: null,
    totalAmount: "totalTaken",
  },
];

const CLASS_COLORS = {
  wizard: "#3fc7eb",
  mage: "#3fc7eb",
  weaver: "#3fc7eb",
  priest: "#ffffff",
  acolyte: "#ffffff",
  shinobi: "#fff468",
  rogue: "#fff468",
  gunslinger: "#aad372",
  scout: "#aad372",
  hunter: "#aad372",
  ranger: "#aad372",
  necromancer: "#8788ee",
  summoner: "#8788ee",
  warlock: "#8788ee",
  warrior: "#c69b6d",
  berserker: "#c69b6d",
  knight: "#c69b6d",
  paladin: "#f0e6d2",
  monk: "#00ff98",
  default: "#c69b6d",
};

const CLASS_LEGEND = [
  ["Acolyte / Priest", "#ffffff"],
  ["Mage / Wizard / Weaver", "#3fc7eb"],
  ["Rogue / Shinobi", "#fff468"],
  ["Scout / Gunslinger", "#aad372"],
  ["Summoner / Necromancer", "#8788ee"],
  ["Warrior / Berserker / Knight", "#c69b6d"],
  ["Paladin", "#f0e6d2"],
];

let modeIndex = 0;
let latest = null;
const expanded = new Set();
let hudOptions = {
  showRank: true,
  compactBars: false,
  bossOnly: false,
};
let chromeState = null;

function money(value) {
  return Math.round(Number(value) || 0).toLocaleString();
}

function compact(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function classColor(actor) {
  const key = String(actor.className || "")
    .toLowerCase()
    .split(/\s+/)[0];
  return CLASS_COLORS[key] || actor.color || CLASS_COLORS.default;
}

function classIconHtml(actor) {
  if (!hudOptions.showClassIcons) return "";
  const cls = String(actor.className || "").trim();
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  push(actor.classIconUrl);
  for (const url of actor.classIconUrls || []) push(url);
  if (cls) {
    const slug = cls
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug) {
      push(`https://spiritvalers.com/content/game/icons/class-${slug}.webp`);
    }
  }
  if (!urls.length) {
    return cls
      ? `<span class="class-icon placeholder" title="${escapeHtml(cls)}">${escapeHtml(cls.slice(0, 1))}</span>`
      : "";
  }
  return `<img class="class-icon" src="${escapeHtml(urls[0])}" alt="" title="${escapeHtml(
    cls,
  )}" data-name="${escapeHtml(cls)}" data-fallbacks="${escapeHtml(urls.slice(1).join("|"))}" />`;
}

function actorKey(actor) {
  return String(actor.id || actor.name || "");
}

function skillsFor(actor, mode) {
  const list = actor?.[mode.skillsKey];
  if (Array.isArray(list) && list.length) return list;
  if (mode.id === "dps" && Array.isArray(actor?.skills)) return actor.skills;
  return [];
}

function skillIconTag(skill) {
  const urls = [...(skill.iconUrls || [])];
  if (skill.iconUrl && !urls.includes(skill.iconUrl)) urls.unshift(skill.iconUrl);
  if (!urls.length) {
    return `<span class="skill-icon missing">${escapeHtml(String(skill.name || "?").slice(0, 1))}</span>`;
  }
  return `<img class="skill-icon" src="${escapeHtml(urls[0])}" alt="" data-name="${escapeHtml(
    skill.name || "",
  )}" data-fallbacks="${escapeHtml(urls.slice(1).join("|"))}" />`;
}

function syncMenu() {
  menuEl.querySelectorAll(".menu-item").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.mode) === modeIndex);
  });
}

function syncBossButton(bossView) {
  if (!bossBtn) return;
  bossBtn.hidden = MODES[modeIndex].id !== "dps";
  bossBtn.classList.toggle("on", bossView);
  bossBtn.setAttribute("aria-pressed", String(bossView));
  bossBtn.title = bossView
    ? "Boss only is ON: showing damage dealt to bosses. Click for all damage."
    : "Boss only: count damage dealt to bosses";
}

function render(snapshot) {
  latest = snapshot;
  const bossView = MODES[modeIndex].id === "dps" && Boolean(hudOptions.bossOnly);
  syncBossButton(bossView);
  if (!snapshot) return;
  const mode = bossView ? BOSS_MODE : MODES[modeIndex];
  const boss = snapshot.bossMeter || {};
  titleLabel.textContent = mode.title;
  syncMenu();
  document.getElementById("meter")?.classList.toggle("compact", Boolean(hudOptions.compactBars));

  const elapsedSec = bossView ? Number(boss.elapsedSec) || 0 : snapshot.elapsedSec || 0;
  const elapsed = Math.max(0, Math.round(elapsedSec));
  const sessionLabel = bossView ? (boss.targets?.length ? boss.targets.join(", ") : "boss") : "session";
  statusLeft.textContent = `${elapsed}s · ${sessionLabel}`;

  let totalAmount = bossView ? Number(boss.totalDamage) || 0 : snapshot[mode.totalAmount] || 0;
  let totalRate = bossView
    ? Number(boss.totalDps) || 0
    : mode.totalRate != null
      ? snapshot[mode.totalRate]
      : totalAmount / Math.max(0.001, snapshot.elapsedSec || 1);

  const actors = [...(snapshot.actors || [])]
    .filter((actor) => (actor?.[mode.amountKey] || 0) > 0)
    .map((actor) => ({
      ...actor,
      name:
        !actor?.name || /^actor\s+-?\d+$/i.test(String(actor.name).trim())
          ? "Resolving…"
          : actor.name,
    }))
    .sort((a, b) => (b[mode.amountKey] || 0) - (a[mode.amountKey] || 0));
  if (!actors.length) {
    rowsEl.innerHTML = bossView
      ? `<div class="empty">No boss damage yet. Hit a boss to start.</div>`
      : `<div class="empty">Waiting for combat…</div>`;
    statusRight.textContent = `0 · 0/s`;
    return;
  }

  const top = actors[0]?.[mode.amountKey] || 1;
  const sum = actors.reduce((s, a) => s + (a[mode.amountKey] || 0), 0) || totalAmount || 1;
  if (!totalAmount) totalAmount = sum;

  statusRight.textContent = `${money(totalAmount)} · ${compact(totalRate)}/s`;

  rowsEl.innerHTML = actors
    .map((actor, index) => {
      const key = actorKey(actor);
      const amount = actor[mode.amountKey] || 0;
      const rate =
        Number(actor[mode.valueKey]) ||
        amount / Math.max(0.001, elapsedSec || 1);
      const share = Math.max(2, Math.round((amount / top) * 100));
      const pct = Math.round((amount / sum) * 100);
      const color = classColor(actor);
      const open = expanded.has(key);
      const skills = skillsFor(actor, mode);
      const skillTop = skills[0]?.damage || skills[0]?.amount || 1;
      const skillHtml = skills.length
        ? skills
            .map((skill) => {
              const skillAmt = skill.damage || skill.amount || 0;
              const skillShare = Math.max(2, Math.round((skillAmt / skillTop) * 100));
              const skillPct = Math.round((skillAmt / Math.max(1, amount)) * 100);
              return `
                <div class="skill" title="${escapeHtml(skill.name || skill.id || "Ability")}">
                  <div class="skill-fill" style="width:${skillShare}%;background-color:${escapeHtml(color)}"></div>
                  <div class="skill-content">
                    ${skillIconTag(skill)}
                    <span class="skill-name">${escapeHtml(skill.name || skill.id || "Ability")}</span>
                    <span class="amount">${money(skillAmt)}</span>
                    <span class="pct">${skillPct}%</span>
                  </div>
                </div>`;
            })
            .join("")
        : `<div class="skill-empty">No ability breakdown yet — click a bar after combat data arrives.</div>`;

      return `
        <div class="actor ${open ? "open" : ""}" data-actor="${escapeHtml(key)}">
          <div class="row expandable" data-actor="${escapeHtml(key)}" title="Click to show abilities">
            <div class="row-fill" style="width:${share}%;background-color:${escapeHtml(color)}"></div>
            <div class="row-content">
              <button type="button" class="expand-btn" data-actor="${escapeHtml(key)}" aria-expanded="${open}" title="${open ? "Hide abilities" : "Show abilities"}"><span class="chevron"></span></button>
              ${hudOptions.showRank !== false ? `<span class="rank">${index + 1}</span>` : ""}
              <span class="name">${escapeHtml(actor.name)}</span>
              <span class="amount">${money(amount)}</span>
              <span class="rate">${compact(rate)}/s</span>
              <span class="pct">${pct}%</span>
            </div>
          </div>
          <div class="skills">${skillHtml}</div>
        </div>`;
    })
    .join("");

  rowsEl.querySelectorAll("img.skill-icon").forEach((img) => {
    img.addEventListener("error", () => {
      const fallbacks = String(img.dataset.fallbacks || "")
        .split("|")
        .map((u) => u.trim())
        .filter(Boolean);
      if (fallbacks.length) {
        img.dataset.fallbacks = fallbacks.slice(1).join("|");
        img.src = fallbacks[0];
        return;
      }
      const fallback = document.createElement("span");
      fallback.className = "skill-icon missing";
      fallback.textContent = (img.dataset.name || "?").slice(0, 1).toUpperCase();
      img.replaceWith(fallback);
    });
  });
  rowsEl.querySelectorAll("img.class-icon").forEach((img) => {
    img.addEventListener("error", () => {
      const fallbacks = String(img.dataset.fallbacks || "")
        .split("|")
        .map((url) => url.trim())
        .filter(Boolean);
      if (fallbacks.length) {
        img.dataset.fallbacks = fallbacks.slice(1).join("|");
        img.src = fallbacks[0];
        return;
      }
      const fallback = document.createElement("span");
      fallback.className = "class-icon placeholder";
      fallback.textContent = String(img.dataset.name || img.getAttribute("title") || "?").slice(0, 1);
      img.replaceWith(fallback);
    });
  });
}

function toggleModeMenu(event) {
  event.stopPropagation();
  menuEl.hidden = !menuEl.hidden;
}

menuBtn.addEventListener("click", toggleModeMenu);
titleLabel.addEventListener("click", toggleModeMenu);

menuEl.addEventListener("click", (event) => {
  const btn = event.target.closest(".menu-item");
  if (!btn) return;
  modeIndex = Number(btn.dataset.mode) || 0;
  menuEl.hidden = true;
  render(latest);
});

document.addEventListener("click", (event) => {
  if (!menuEl.hidden && !menuEl.contains(event.target) && event.target !== menuBtn) {
    menuEl.hidden = true;
  }
});

rowsEl.addEventListener("click", (event) => {
  const btn = event.target.closest(".expand-btn");
  const row = event.target.closest(".row.expandable");
  const key = btn?.dataset.actor || row?.dataset.actor;
  if (!key) return;
  event.preventDefault();
  event.stopPropagation();
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
  render(latest);
});

bossBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  hudOptions = { ...hudOptions, bossOnly: !hudOptions.bossOnly };
  const options = { ...(chromeState?.options || {}), bossOnly: hudOptions.bossOnly };
  if (chromeState) chromeState.options = options;
  window.overlayHud?.saveHudPrefs?.("dps-meter", { options });
  render(latest);
});

document.getElementById("reset").addEventListener("click", () => {
  window.overlayHud?.resetEncounter?.();
});

document.getElementById("close").addEventListener("click", () => {
  window.overlayHud?.closeMeter?.("dps-meter");
});

if (window.HudChrome) {
  Promise.resolve(window.HudChrome.mount({
    hudId: "dps-meter",
    resetBtn: document.getElementById("reset"),
    defaultOptions: hudOptions,
    renderExtra: (options) => `
      <label><input type="checkbox" data-opt="showRank" data-opt-type="bool" ${
        options.showRank !== false ? "checked" : ""
      }/> Show rank numbers</label>
      <label><input type="checkbox" data-opt="compactBars" data-opt-type="bool" ${
        options.compactBars ? "checked" : ""
      }/> Compact bars</label>
      <label><input type="checkbox" data-opt="bossOnly" data-opt-type="bool" ${
        options.bossOnly ? "checked" : ""
      }/> Boss only (Damage Done)</label>
    `,
    onOptions: (options) => {
      hudOptions = { ...hudOptions, ...options };
      render(latest);
    },
  }))
    .then((state) => {
      chromeState = state || null;
    })
    .catch(() => {});
}

if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
