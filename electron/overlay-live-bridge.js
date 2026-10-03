const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { EventEmitter } = require("events");

function isInsideAsar(filePath) {
  const normalized = String(filePath || "").replace(/\//g, "\\").toLowerCase();
  // Real binaries live in app.asar.unpacked — never spawn from inside the archive.
  return normalized.includes("app.asar\\") && !normalized.includes("app.asar.unpacked\\");
}

function fileLooksReal(filePath) {
  try {
    if (!filePath || isInsideAsar(filePath)) return false;
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function resolveBunBinary() {
  const resources = process.resourcesPath || "";
  const candidates = [
    // Packaged Electron: always prefer unpacked first
    path.join(resources, "app.asar.unpacked", "node_modules", "bun", "bin", "bun.exe"),
    path.join(resources, "bun", "bun.exe"),
    // Dev / unpackaged
    path.join(__dirname, "..", "node_modules", "bun", "bin", "bun.exe"),
  ];
  for (const candidate of candidates) {
    if (fileLooksReal(candidate)) return candidate;
  }
  return null;
}

function projectRoot() {
  const resources = process.resourcesPath || "";
  const unpacked = path.join(resources, "app.asar.unpacked");
  if (resources && fs.existsSync(path.join(unpacked, "node_modules"))) {
    return unpacked;
  }
  return path.join(__dirname, "..");
}

function workerPath() {
  const resources = process.resourcesPath || "";
  const candidates = [
    path.join(resources, "app.asar.unpacked", "electron", "capture", "live-worker.mjs"),
    path.join(__dirname, "capture", "live-worker.mjs"),
  ];
  for (const candidate of candidates) {
    if (fileLooksReal(candidate) || (!isInsideAsar(candidate) && fs.existsSync(candidate))) {
      return candidate;
    }
  }
  // Last resort: asar path may still be readable by Bun via electron's asar fs when running
  // from unpacked cwd with NODE_PATH — but prefer unpacked above.
  return path.join(resources, "app.asar.unpacked", "electron", "capture", "live-worker.mjs");
}

class OverlayLiveBridge extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.buffer = "";
    this.latest = null;
    this.lastError = null;
    this.npcap = null;
    this.running = false;
  }

  getSnapshot() {
    return this.latest;
  }

  getStatus() {
    return {
      running: this.running,
      npcap: this.npcap,
      error: this.lastError,
      gameSeen: Boolean(this.latest?.capture?.gameSeen),
      personalName: this.latest?.capture?.personalName || null,
      bunPath: resolveBunBinary(),
    };
  }

  async start(options = {}) {
    await this.stop();
    const bun = resolveBunBinary();
    if (!bun) {
      const err = new Error(
        "Bun runtime missing from app.asar.unpacked. Reinstall Spiritvale Overlay.",
      );
      this.lastError = err.message;
      this.emit("error", err);
      throw err;
    }

    const worker = workerPath();
    if (!worker || !fs.existsSync(worker)) {
      const err = new Error("Live capture worker missing. Reinstall Spiritvale Overlay.");
      this.lastError = err.message;
      this.emit("error", err);
      throw err;
    }

    const args = [worker, JSON.stringify({ personalName: options.personalName || "" })];
    const root = projectRoot();
    this.child = spawn(bun, args, {
      cwd: root,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        BUN_INSTALL_CACHE_DIR: path.join(root, ".bun-cache"),
      },
    });
    this.running = true;
    this.lastError = null;
    this.buffer = "";

    this.child.on("error", (err) => {
      this.running = false;
      this.child = null;
      this.lastError = String(err.message || err);
      this.emit("error", err);
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#onStdout(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      const text = String(chunk || "").trim();
      if (!text) return;
      this.lastError = text.slice(0, 400);
      this.emit("warning", this.lastError);
    });
    this.child.on("exit", (code) => {
      this.running = false;
      this.child = null;
      if (code && code !== 0 && !this.lastError) {
        this.lastError = `Live capture exited (${code})`;
      }
      this.emit("stopped", { code });
    });

    return this.getStatus();
  }

  reset() {
    if (this.child?.stdin?.writable) {
      this.child.stdin.write("reset\n");
    }
  }

  /** Soft-clear combat totals only — keeps identity / name sync. */
  zero() {
    if (this.child?.stdin?.writable) {
      this.child.stdin.write("zero\n");
    }
  }

  /** Session timer pause: freeze session gains + rate clocks in the worker. */
  setPaused(paused) {
    if (this.child?.stdin?.writable) {
      this.child.stdin.write(paused ? "pause\n" : "resume\n");
    }
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.running = false;
    if (!child) return;
    try {
      if (child.stdin?.writable) child.stdin.write("stop\n");
    } catch {
      /* ignore */
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        resolve();
      }, 1500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("error", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  #onStdout(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        this.#handleMessage(JSON.parse(line));
      } catch {
        /* ignore malformed */
      }
    }
  }

  #handleMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "npcap") {
      this.npcap = msg;
      this.emit("npcap", msg);
      return;
    }
    if (msg.type === "error") {
      this.lastError = msg.message || "Live capture error";
      this.emit("error", new Error(this.lastError));
      return;
    }
    if (msg.type === "warning") {
      this.lastError = msg.message;
      this.emit("warning", msg.message);
      return;
    }
    if (msg.type === "snapshot") {
      this.latest = msg;
      this.emit("snapshot", msg);
      return;
    }
    if (msg.type === "started" || msg.type === "target" || msg.type === "identity" || msg.type === "reset") {
      this.emit(msg.type, msg);
    }
  }
}

module.exports = { OverlayLiveBridge, resolveBunBinary };
