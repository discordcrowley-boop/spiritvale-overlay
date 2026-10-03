const body = document.getElementById("body");
const sub = document.getElementById("sub");

let latest = null;
const expanded = new Set();
let didAutoExpand = false;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(value) {
  return Math.round(Number(value) || 0).toLocaleString();
}

function monsterSlug(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function monsterIconUrls(row) {
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  for (const url of row.iconUrls || []) push(url);
  push(row.iconUrl);
  for (const label of [row.id, row.name, row.displayName]) {
    const slug = monsterSlug(label);
    if (slug) push(`https://spiritvalers.com/wiki-data/monster-icons/${slug}.webp`);
  }
  return urls;
}

function classSlug(name) {
  return String(name || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function classIconUrls(actor) {
  const urls = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  push(actor.classIconUrl);
  const slug = classSlug(actor.className);
  if (slug) {
    push(`https://spiritvalers.com/content/game/icons/class-${slug}.webp`);
  }
  return urls;
}

function classIconHtml(actor) {
  const urls = classIconUrls(actor);
  const title = actor.className || "Class";
  if (!urls.length) {
    return `<span class="class-icon player-class placeholder" title="${escapeHtml(title)}">${escapeHtml(
      String(title).slice(0, 1),
    )}</span>`;
  }
  return `<img class="class-icon player-class" src="${escapeHtml(urls[0])}" alt="" title="${escapeHtml(
    title,
  )}" data-fallbacks="${escapeHtml(urls.slice(1).join("|"))}" />`;
}

function actorKey(row) {
  return String(row.id || row.name || "");
}

function isPartyMob(mob, snapshot, extraNames = []) {
  const name = String(mob?.name || "").trim().toLowerCase();
  if (!name) return true;
  if (extraNames.some((row) => String(row || "").toLowerCase() === name)) return true;
  if ((snapshot?.actors || []).some((row) => String(row.name || "").toLowerCase() === name)) return true;
  if ((snapshot?.farm?.killers || []).some((row) => String(row.name || "").toLowerCase() === name)) return true;
  return false;
}

function mergeMobs(left = [], right = [], snapshot = null, extraNames = []) {
  const byId = new Map();
  for (const mob of [...left, ...right]) {
    if (!mob) continue;
    if (isPartyMob(mob, snapshot, extraNames)) continue;
    const key = String(mob.id || mob.name || "");
    if (!key) continue;
    const cur = byId.get(key);
    if (!cur) {
      byId.set(key, { ...mob });
      continue;
    }
    cur.kills = Math.max(Number(cur.kills) || 0, Number(mob.kills) || 0);
    cur.xp = mob.xp || cur.xp;
    cur.iconUrl = cur.iconUrl || mob.iconUrl;
    if (!cur.iconUrls?.length && mob.iconUrls?.length) cur.iconUrls = mob.iconUrls;
    cur.name = cur.name && !String(cur.name).startsWith("Actor ") ? cur.name : mob.name;
  }
  return [...byId.values()].sort((a, b) => (b.kills || 0) - (a.kills || 0));
}

function enrichKillers(snapshot) {
  const actors = snapshot?.actors || [];
  const byName = new Map(actors.map((row) => [String(row.name || "").toLowerCase(), row]));
  const byId = new Map(actors.map((row) => [String(row.id), row]));
  const farmMobs = snapshot?.farm?.mobs || [];
  const selfName = snapshot?.capture?.personalName || "";
  const killers = [...(snapshot?.farm?.killers || [])]
    .filter((row) => row?.name && !/^actor\s+-?\d+$/i.test(String(row.name).trim()))
    .map((row) => {
    const actor = byName.get(String(row.name || "").toLowerCase()) || byId.get(String(row.id));
    const isSelf = selfName && String(row.name || "").toLowerCase() === selfName.toLowerCase();
    const mobs = mergeMobs(row.mobs, isSelf ? farmMobs : [], snapshot, [row.name, selfName]);
    return {
      ...row,
      className: row.className || actor?.className || null,
      classIconUrl: row.classIconUrl || actor?.classIconUrl || classIconUrls({ className: row.className || actor?.className })[0] || null,
      color: row.color || actor?.color || "#3ee0b0",
      mobs,
      kills: Math.max(Number(row.kills) || 0, mobs.reduce((sum, mob) => sum + (Number(mob.kills) || 0), 0)),
    };
  });
  if (killers.length) return killers;
  if (!farmMobs.length) return [];
  const self = byName.get(String(selfName || "").toLowerCase());
  return [
    {
      id: self?.id || "you",
      name: selfName || self?.name || "You",
      className: self?.className || null,
      classIconUrl: self?.classIconUrl || null,
      color: self?.color || "#3ee0b0",
      kills: farmMobs.reduce((sum, row) => sum + (Number(row.kills) || 0), 0),
      mobs: farmMobs.filter((mob) => !isPartyMob(mob, snapshot, [selfName])),
    },
  ];
}

function render(snapshot) {
  latest = snapshot || latest;
  const farm = latest?.farm;
  const killers = enrichKillers(latest);
  const total = killers.reduce((sum, row) => sum + (Number(row.kills) || 0), 0) || farm?.kills || 0;
  sub.textContent = total ? `${money(total)} party kills · click a name` : "Click a name to see mobs";

  if (!killers.length) {
    body.innerHTML = `<div class="empty">No monster kills yet — damage a mob until it dies.</div>`;
    return;
  }

  if (!didAutoExpand) {
    const selfName = String(latest?.capture?.personalName || "").toLowerCase();
    const self = killers.find((row) => String(row.name || "").toLowerCase() === selfName) || killers[0];
    if (self) expanded.add(actorKey(self));
    didAutoExpand = true;
  }

  const top = killers[0]?.kills || 1;
  body.innerHTML = killers
    .map((row, index) => {
      const key = actorKey(row);
      const open = expanded.has(key);
      const share = Math.max(8, Math.round((row.kills / top) * 100));
      const mobHtml = (row.mobs || [])
        .map((mob) => {
          const icons = monsterIconUrls(mob);
          const iconHtml = icons.length
            ? `<img class="kill-icon" src="${escapeHtml(icons[0])}" alt="" data-name="${escapeHtml(
                mob.name || "?",
              )}" data-fallbacks="${escapeHtml(icons.slice(1).join("|"))}" />`
            : `<div class="kill-icon missing">${escapeHtml(String(mob.name || "?").slice(0, 1))}</div>`;
          return `
            <article class="kill-row">
              ${iconHtml}
              <div class="kill-copy">
                <div class="row-top">
                  <span>${escapeHtml(mob.name || "Monster")}</span>
                  <strong style="color:#e0c36a">${money(mob.kills || 0)}</strong>
                </div>
                <div class="meta">${
                  mob.xp ? `${money(mob.xp)} XP from this mob` : "Kill total this session"
                }</div>
              </div>
            </article>`;
        })
        .join("");

      return `
        <div class="actor ${open ? "open" : ""}" data-actor="${escapeHtml(key)}">
          <div class="row expandable" data-actor="${escapeHtml(key)}" title="Click to show monsters">
            <div class="row-fill" style="width:${share}%;background-color:${escapeHtml(row.color || "#3ee0b0")}"></div>
            <div class="row-content">
              <button type="button" class="expand-btn" data-actor="${escapeHtml(key)}" aria-expanded="${open}" title="${open ? "Hide monsters" : "Show monsters"}"><span class="chevron"></span></button>
              ${classIconHtml(row)}
              <span class="name">${escapeHtml(row.name || "Player")}</span>
              <span class="amount">${money(row.kills)}</span>
            </div>
          </div>
          <div class="kill-details">${
            mobHtml || `<div class="empty">No monster names yet for this player.</div>`
          }</div>
        </div>`;
    })
    .join("");

  body.querySelectorAll("img.kill-icon").forEach((img) => {
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
      const fallback = document.createElement("div");
      fallback.className = "kill-icon missing";
      fallback.textContent = String(img.dataset.name || "?").slice(0, 1) || "?";
      img.replaceWith(fallback);
    });
  });
  body.querySelectorAll("img.class-icon").forEach((img) => {
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
      fallback.className = "class-icon player-class placeholder";
      fallback.title = img.getAttribute("title") || "";
      fallback.textContent = (img.getAttribute("title") || "?").slice(0, 1);
      img.replaceWith(fallback);
    });
  });
}

body.addEventListener("click", (event) => {
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

document.getElementById("reset").addEventListener("click", () => {
  window.overlayHud?.resetEncounter?.();
});
document.getElementById("close").addEventListener("click", () => {
  window.overlayHud?.closeMeter?.("deaths");
});

if (window.HudChrome) {
  window.HudChrome.mount({
    hudId: "deaths",
    resetBtn: document.getElementById("reset"),
  });
}

if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
