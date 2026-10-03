/**
 * Decode StatusComponent ApplyEffectDisplays_O / ApplySkillDisplay_O for pets.
 * Combat tracker's decoder omits the Level field now present on QueuedEffectDisplay,
 * so ApplyEffectDisplays_O fails silently for leveled buffs on summons.
 */
import {
  checkedEnd,
  readSignedPackedWhole,
  requireBytes,
} from "@kar-mi/spirit-vale-tools-capture/wire-reader";

function readString(buffer, offset) {
  const length = readSignedPackedWhole(buffer, offset);
  if (length.value < 0) throw new Error("null effect display status id");
  const nextOffset = checkedEnd(buffer, length.nextOffset, length.value);
  return {
    value: buffer.toString("utf8", length.nextOffset, nextOffset),
    nextOffset,
  };
}

function readBoolean(buffer, offset) {
  requireBytes(buffer, offset, 1, "effect display showFx");
  const value = buffer[offset];
  if (value !== 0 && value !== 1) throw new Error("invalid showFx");
  return { value: value === 1, nextOffset: offset + 1 };
}

function decodeEffectDisplaysLayout(payload, withLevel) {
  const applies = [];
  let offset = 0;
  const count = readSignedPackedWhole(payload, offset);
  offset = count.nextOffset;
  if (count.value < 0 || count.value > 64) return null;
  for (let index = 0; index < count.value; index += 1) {
    const status = readString(payload, offset);
    offset = status.nextOffset;
    requireBytes(payload, offset, 4, "remaining seconds");
    const remainingSeconds = payload.readFloatLE(offset);
    offset += 4;
    const stacks = readSignedPackedWhole(payload, offset);
    offset = stacks.nextOffset;
    const maxStacks = readSignedPackedWhole(payload, offset);
    offset = maxStacks.nextOffset;
    let level = 1;
    if (withLevel) {
      const levelRead = readSignedPackedWhole(payload, offset);
      offset = levelRead.nextOffset;
      level = Math.max(1, levelRead.value || 1);
    }
    offset = readBoolean(payload, offset).nextOffset;
    if (stacks.value < 0) return null;
    applies.push({
      statusId: status.value,
      ...(remainingSeconds < 0 || !Number.isFinite(remainingSeconds)
        ? {}
        : { remainingSeconds }),
      stacks: stacks.value,
      maxStacks: Math.max(0, maxStacks.value),
      level,
    });
  }
  const removes = [];
  const removeCount = readSignedPackedWhole(payload, offset);
  offset = removeCount.nextOffset;
  if (removeCount.value < 0 || removeCount.value > 64) return null;
  for (let index = 0; index < removeCount.value; index += 1) {
    const status = readString(payload, offset);
    offset = status.nextOffset;
    removes.push(status.value);
  }
  // Prefer exact length; allow small trailing pad from prefab variants.
  if (offset > payload.length) return null;
  if (offset < payload.length && payload.length - offset > 8) return null;
  if (applies.length === 0 && removes.length === 0) return null;
  return { applies, removes, withLevel, consumed: offset, total: payload.length };
}

export function decodePetEffectDisplays(payload) {
  if (!payload || !payload.length) return null;
  // Current wire format includes Level (rpc-map QueuedEffectDisplay).
  try {
    const withLevel = decodeEffectDisplaysLayout(payload, true);
    if (withLevel) return withLevel;
  } catch {
    /* try legacy */
  }
  try {
    return decodeEffectDisplaysLayout(payload, false);
  } catch {
    return null;
  }
}

export function decodePetSkillDisplay(payload) {
  if (!payload || !payload.length) return null;
  try {
    const id = readString(payload, 0);
    let offset = id.nextOffset;
    let level = 1;
    if (offset < payload.length) {
      const lv = readSignedPackedWhole(payload, offset);
      offset = lv.nextOffset;
      level = Math.max(1, lv.value || 1);
    }
    if (!id.value) return null;
    // Reject payloads that look like health floaters (no string id).
    if (offset < payload.length && payload.length - offset > 24) return null;
    return { statusId: id.value, level };
  } catch {
    return null;
  }
}

export function packetLooksLikeEffectDisplays(packet) {
  if (!packet) return false;
  if (packet.rpcName === "ApplyEffectDisplays_O") return true;
  if (packet.networkBehaviourType === "StatusComponent" && packet.rpcHash === 5) return true;
  if (packet.packetName === "observersRpc" && packet.rpcHash === 5) return true;
  return false;
}

export function packetLooksLikeSkillDisplay(packet) {
  if (!packet) return false;
  if (packet.rpcName === "ApplySkillDisplay_O" || packet.rpcName === "RemoveSkillDisplay_O") {
    return true;
  }
  if (packet.networkBehaviourType === "StatusComponent" && packet.rpcHash === 1) return true;
  return false;
}
