const body = document.getElementById("body");
const sub = document.getElementById("sub");

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function render(snapshot) {
  const tower = snapshot?.tower;
  if (!tower?.known && !tower?.inTower) {
    body.innerHTML = `<div class="empty">Enter Eternal Tower to track floors.</div>`;
    sub.textContent = "Eternal Tower";
    return;
  }
  sub.textContent = tower.towerName || "Eternal Tower";
  const history = (tower.history || [])
    .map(
      (row) => `
      <article class="row">
        <div class="row-top">
          <span>Floor ${escapeHtml(row.floor)}</span>
          <span>${escapeHtml(row.note || "")}</span>
        </div>
      </article>`,
    )
    .join("");
  body.innerHTML = `
    <div class="stats">
      <div class="stat"><span>Floor</span><b>${tower.floor ?? "—"}</b></div>
      <div class="stat job"><span>Status</span><b>${tower.inTower ? "Inside" : "Outside"}</b></div>
      <div class="stat gold"><span>Source</span><b>${escapeHtml(tower.source || "—")}</b></div>
    </div>
    ${history || `<div class="empty">Floor history fills as you advance.</div>`}
  `;
}

document.getElementById("close").addEventListener("click", () => {
  window.overlayHud?.closeMeter?.("tower");
});

if (window.HudChrome) window.HudChrome.mount({ hudId: "tower" });

if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
