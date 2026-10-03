/**
 * Party/system chat loot notices: "Player found Molten Core Heater (1%)"
 * BroadcastChat / ShowMessage / ReceiveChat payloads carry these more reliably
 * than PickupItems_T for rare gear and cards.
 */
import { decodeFieldRun } from "@kar-mi/spirit-vale-tools-capture";

const FOUND_RE =
  /^(.{1,32}?)\s+found\s+(.+?)\s+\(([\d.]+)\s*%\)\s*$/i;
const FOUND_BRACKET_RE =
  /^(.{1,32}?)\s+found\s+\[([^\]]+)\]\s+\(([\d.]+)\s*%\)\s*$/i;
const FOUND_INLINE_RE =
  /([A-Za-z][A-Za-z0-9 _'\-]{0,30}?)\s+found\s+\[?([A-Za-z0-9][A-Za-z0-9 '_\-]{1,48}?)\]?\s+\(([\d.]+)\s*%\)/gi;

const CHAT_STRING_RPCS = new Set([
  "BroadcastChat",
  "BroadcastChat_T",
  "ReceiveAnnouncement",
  "ShowMessage_T",
  "ReceiveChat",
  "ReceiveChat_T",
  "ReceiveSystemMessageLoc_T",
]);

const CHAT_HASHES = new Set([
  // pre-2026-09-21
  91, 92, 93, 94, 116,
  // BroadcastChat / ReceiveChat / ReceiveAnnouncement / ReceiveSystemMessageLoc / ShowMessage
  95, 96, 97, 98, 132,
]);

function packetHashes(packet) {
  return [packet?.rpcHash, packet?.registeredRpcHash]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
}

function isChatLootPacket(packet) {
  if (!packet) return false;
  if (CHAT_STRING_RPCS.has(String(packet.rpcName || ""))) return true;
  if (/chat|message|announce/i.test(String(packet.rpcName || ""))) return true;
  return packetHashes(packet).some((hash) => CHAT_HASHES.has(hash));
}

function readPackedString(buffer, skip = 0) {
  if (!buffer?.length || skip >= buffer.length) return null;
  try {
    const run = decodeFieldRun(buffer.subarray(skip), [
      { name: "msg", typeName: "System.String", codec: "stringUtf8Packed" },
    ]);
    const value = run.fields?.find((field) => field.name === "msg")?.value;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function extractPackedStrings(buffer, limit = 12) {
  if (!buffer?.length) return [];
  const out = [];
  const seen = new Set();
  for (let skip = 0; skip < Math.min(buffer.length, 64) && out.length < limit; skip += 1) {
    const value = readPackedString(buffer, skip);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  // Also pull plain ASCII runs that look like chat lines.
  let ascii = "";
  for (let i = 0; i < buffer.length; i += 1) {
    const c = buffer[i];
    if (c >= 32 && c <= 126) ascii += String.fromCharCode(c);
    else ascii += "\n";
  }
  for (const chunk of ascii.split(/[\n\r\0]+/)) {
    const value = chunk.trim();
    if (value.length < 8 || value.length > 120) continue;
    if (!/found/i.test(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function coerceFoundLine(text) {
  let raw = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^}]+\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw || !/found/i.test(raw)) return "";
  // Packed length prefixes are often 1–3 printable junk bytes before the real line.
  for (let i = 0; i < Math.min(raw.length, 4); i += 1) {
    const slice = raw.slice(i).trim();
    if (FOUND_RE.test(slice) || FOUND_BRACKET_RE.test(slice)) return slice;
  }
  return raw.replace(/^[^A-Za-z]+/, "").trim();
}

export function parseFoundLootMessage(text) {
  const raw = String(text || "").trim();
  if (!raw || !/found/i.test(raw)) return null;
  const cleaned = coerceFoundLine(raw);
  const bracket = cleaned.match(FOUND_BRACKET_RE) || raw.match(FOUND_BRACKET_RE);
  if (bracket) {
    return {
      player: bracket[1].trim(),
      itemName: bracket[2].trim(),
      dropRate: Number(bracket[3]),
      raw: cleaned || raw,
    };
  }
  const exact = cleaned.match(FOUND_RE) || raw.match(FOUND_RE);
  if (exact) {
    return {
      player: exact[1].trim(),
      itemName: String(exact[2] || "")
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .trim(),
      dropRate: Number(exact[3]),
      raw: cleaned || raw,
    };
  }
  FOUND_INLINE_RE.lastIndex = 0;
  const inline = FOUND_INLINE_RE.exec(cleaned) || FOUND_INLINE_RE.exec(raw);
  if (!inline) return null;
  const player = String(inline[1] || "")
    .replace(/^[^A-Za-z]+/, "")
    .trim();
  const itemName = String(inline[2] || "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .trim();
  if (!player || !itemName) return null;
  return {
    player,
    itemName,
    dropRate: Number(inline[3]),
    raw: cleaned || raw,
  };
}

function messagesFromDecodedFields(packet) {
  const out = [];
  for (const field of packet?.decodedFields || []) {
    const value = field?.value;
    if (typeof value === "string" && value.trim()) out.push(value.trim());
    if (Array.isArray(value)) {
      for (const row of value) {
        if (typeof row === "string" && row.trim()) out.push(row.trim());
      }
    }
    if (value && typeof value === "object") {
      for (const key of ["msg", "message", "text", "messageFallback", "content"]) {
        if (typeof value[key] === "string" && value[key].trim()) out.push(value[key].trim());
      }
    }
  }
  return out;
}

/**
 * @returns {{ player: string, itemName: string, dropRate: number, raw: string }[]}
 */
export function decodeChatLootNotices(packet) {
  if (!packet) return [];
  const texts = [];
  const seenText = new Set();
  const pushText = (value) => {
    const text = String(value || "").trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seenText.has(key)) return;
    seenText.add(key);
    texts.push(text);
  };

  for (const value of messagesFromDecodedFields(packet)) pushText(value);

  if (isChatLootPacket(packet) && packet.payload?.length) {
    const hashes = packetHashes(packet);
    if (
      hashes.includes(91) ||
      hashes.includes(93) ||
      hashes.includes(116) ||
      CHAT_STRING_RPCS.has(String(packet.rpcName || ""))
    ) {
      for (const skip of [0, 1, 2, 4]) {
        const msg = readPackedString(packet.payload, skip);
        if (msg) pushText(msg);
      }
    }
    for (const msg of extractPackedStrings(packet.payload)) pushText(msg);
  } else if (packet.payload?.length && /found/i.test(Buffer.from(packet.payload).toString("latin1"))) {
    // Cheap gate: only deep-scan payloads that literally contain "found".
    for (const msg of extractPackedStrings(packet.payload)) pushText(msg);
  }

  const notices = [];
  const seen = new Set();
  for (const text of texts) {
    const parsed = parseFoundLootMessage(text);
    if (!parsed?.player || !parsed?.itemName) continue;
    if (parsed.itemName.length < 2) continue;
    // Same drop can appear twice when a length prefix contaminates the player name.
    const key = `${parsed.itemName.toLowerCase()}|${parsed.dropRate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notices.push(parsed);
  }
  return notices;
}

export function isChatLootPacketExport(packet) {
  return isChatLootPacket(packet);
}
