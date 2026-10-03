"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const MAGIC = Buffer.from("SVDB1");
const SALT = Buffer.from("9f1c7a2e5b8d4036a1e7c3f90b2d6e14", "hex");
const PASS = Buffer.from([
  0x73, 0x76, 0x2d, 0x6f, 0x76, 0x65, 0x72, 0x6c, 0x61, 0x79, 0x3a, 0x63, 0x6f, 0x72, 0x65, 0x3a,
  0x76, 0x31, 0x3a, 0x4b, 0x71, 0x38, 0x21, 0x7a, 0x50, 0x34, 0x23, 0x6d, 0x4c, 0x77,
]);

let cached = null;

function deriveKey() {
  return crypto.scryptSync(PASS, SALT, 32, { N: 16384, r: 8, p: 1 });
}

function dbCandidates() {
  const resources = process.resourcesPath || "";
  return [
    path.join(__dirname, "..", "data", "core.db"),
    path.join(resources, "app.asar.unpacked", "electron", "data", "core.db"),
  ];
}

function seal(payload) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const packed = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 });
  const body = Buffer.concat([cipher.update(packed), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function open(buf) {
  if (!buf || buf.length < MAGIC.length + 28 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Invalid data store");
  }
  let at = MAGIC.length;
  const iv = buf.subarray(at, (at += 12));
  const tag = buf.subarray(at, (at += 16));
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), iv);
  decipher.setAuthTag(tag);
  const packed = Buffer.concat([decipher.update(buf.subarray(at)), decipher.final()]);
  return JSON.parse(zlib.gunzipSync(packed).toString("utf8"));
}

function loadStore() {
  if (cached) return cached;
  for (const file of dbCandidates()) {
    try {
      if (!fs.existsSync(file)) continue;
      cached = open(fs.readFileSync(file));
      return cached;
    } catch {
      /* try next */
    }
  }
  cached = { datasets: {} };
  return cached;
}

function dataset(name, fallback = null) {
  const value = loadStore().datasets?.[name];
  return value == null ? fallback : value;
}

module.exports = { dataset, seal, open };
