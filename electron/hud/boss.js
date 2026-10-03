const body = document.getElementById("body");

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function render(snapshot) {
  const rows = snapshot?.boss || [];
  if (!rows.length) {
    body.innerHTML = `<div class="empty">No boss encounter yet.<br/>Trash packs stay off this panel.</div>`;
    return;
  }
  body.innerHTML = rows
    .map(
      (row) => `
      <article class="row">
        <div class="row-top">
          <strong style="color:#ff8d8d">${escapeHtml(row.skillName)}</strong>
          <span>${escapeHtml(row.phase || "")}</span>
        </div>
        <div class="meta">${escapeHtml(row.actorName)}</div>
      </article>`,
    )
    .join("");
}

document.getElementById("close").addEventListener("click", () => {
  window.overlayHud?.closeMeter?.("boss");
});

if (window.HudChrome) window.HudChrome.mount({ hudId: "boss" });

if (window.overlayHud?.onTick) window.overlayHud.onTick(render);
if (window.overlayHud?.getSnapshot) window.overlayHud.getSnapshot().then(render).catch(() => {});
