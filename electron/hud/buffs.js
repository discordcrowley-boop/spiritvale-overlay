const body = document.getElementById("body");
const sub = document.getElementById("sub");
const tipEl = (() => {
  let el = document.getElementById("tip");
  if (!el) {
    el = document.createElement("div");
    el.id = "tip";
    el.className = "fx-tip";
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
})();

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtMs(ms) {
  if (ms == null) return "—";
  const sec = Math.max(0, Math.ceil(Number(ms) / 1000));
  return `${sec}`;
}

function iconCandidates(row) {
  const list = [];
  for (const url of [row.iconUrl, ...(row.iconUrls || [])]) {
    if (url && !list.includes(url)) list.push(url);
  }
  return list;
}

function iconTag(row) {
  const letter = escapeHtml(String(row.name || "?").slice(0, 1).toUpperCase());
  const urls = iconCandidates(row);
  if (!urls.length) {
    return `<div class="fx-icon missing ${row.debuff ? "bad" : ""}" data-name="${escapeHtml(
      row.name || "",
    )}">${letter}</div>`;
  }
  return `<img class="fx-icon ${row.debuff ? "bad" : ""}" src="${escapeHtml(
    urls[0],
  )}" data-fallbacks="${escapeHtml(urls.slice(1).join("|"))}" data-name="${escapeHtml(
    row.name || "",
  )}" alt="${escapeHtml(row.name || "")}" />`;
}

function placeTip(event, text) {
  if (!text) {
    tipEl.hidden = true;
    return;
  }
  tipEl.hidden = false;
  tipEl.textContent = text;
  const pad = 8;
  const rect = tipEl.getBoundingClientRect();
  let x = event.clientX + 12;
  let y = event.clientY + 12;
  if (x + rect.width > window.innerWidth - pad) x = event.clientX - rect.width - 8;
  if (y + rect.height > window.innerHeight - pad) y = event.clientY - rect.height - 8;
  tipEl.style.left = `${Math.max(pad, x)}px`;
  tipEl.style.top = `${Math.max(pad, y)}px`;
}

function hideTip() {
  tipEl.hidden = true;
}

function bindIconFallback(img) {
  img.addEventListener("error", () => {
    const rest = String(img.dataset.fallbacks || "")
      .split("|")
      .filter(Boolean);
    if (rest.length) {
      img.dataset.fallbacks = rest.slice(1).join("|");
      img.src = rest[0];
      return;
    }
    const letter = (img.dataset.name || "?").slice(0, 1).toUpperCase();
    const fallback = document.createElement("div");
    fallback.className = `fx-icon missing${img.classList.contains("bad") ? " bad" : ""}`;
    fallback.dataset.name = img.dataset.name || "";
    fallback.textContent = letter;
    img.replaceWith(fallback);
  });
}

function render(snapshot) {
  const buffs = snapshot?.buffs || [];
  sub.textContent = snapshot?.capture?.personalName
    ? snapshot.capture.personalName
    : "Buffs & debuffs";
  if (!buffs.length) {
    body.innerHTML = `<div class="empty">No active effects yet. Set your character name in Overlay settings if needed.</div>`;
    hideTip();
    return;
  }
  body.innerHTML = `<div class="fx-grid">${buffs
    .map((row) => {
      const label = `${row.name || "Effect"}${row.stacks > 1 ? ` ×${row.stacks}` : ""}`;
      return `
      <div class="fx ${row.debuff ? "bad" : ""}" data-label="${escapeHtml(label)}">
        ${iconTag(row)}
        <span class="fx-timer">${fmtMs(row.remainingMs)}</span>
        ${row.stacks > 1 ? `<span class="fx-stacks">${row.stacks}</span>` : ""}
      </div>`;
    })
    .join("")}</div>`;

  body.querySelectorAll("img.fx-icon").forEach(bindIconFallback);

  body.querySelectorAll(".fx").forEach((el) => {
    el.addEventListener("mouseenter", (event) => placeTip(event, el.dataset.label || ""));
    el.addEventListener("mousemove", (event) => placeTip(event, el.dataset.label || ""));
    el.addEventListener("mouseleave", hideTip);
  });
}

document.getElementById("close").addEventListener("click", () => {
  window.overlayHud?.closeMeter?.("buffs");
});

if (window.HudChrome) window.HudChrome.mount({ hudId: "buffs" });

if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
