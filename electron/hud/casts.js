const body = document.getElementById("body");

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function looksAnonymous(name) {
  return /^Actor\s+-?\d+$/i.test(String(name || "").trim());
}

function render(snapshot) {
  const casts = (snapshot?.casts || []).filter((row) => !looksAnonymous(row.actorName));
  if (!casts.length) {
    body.innerHTML = `<div class="empty">Waiting for enemy casts…</div>`;
    return;
  }
  body.innerHTML = casts
    .map((row) => {
      const pct = Math.min(100, Math.round((Number(row.elapsedMs) || 0) / 30));
      return `
      <article class="row">
        <div class="row-top">
          <span>${escapeHtml(row.actorName)}</span>
          <span>${escapeHtml(row.skillName)}</span>
        </div>
        <div class="bar"><span style="width:${pct}%;background:linear-gradient(90deg,#ff7b7b,#e0c36a)"></span></div>
      </article>`;
    })
    .join("");
}

document.getElementById("close").addEventListener("click", () => {
  window.overlayHud?.closeMeter?.("casts");
});

if (window.HudChrome) window.HudChrome.mount({ hudId: "casts" });

if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
