/** Healing Done should be cast/party healing — not lifesteal, siphon, or regen. */
export function isSelfishHealEvent(event) {
  if (!event || event.kind !== "heal") return false;
  // Negative ApplyDamage is attributed as heal but is leech, not cast healing.
  if (event.rpc === "ApplyDamage_C") return true;
  const style = String(event.recoveryStyle || "");
  if (style === "drain" || style === "passive-regeneration") return true;
  const src = `${event.sourceId || ""} ${event.sourceLabel || ""}`.toLowerCase();
  return /siphon|leech|lifesteal|life[\s-]?steal|passive.?regen|\bdrain\b/.test(src);
}
