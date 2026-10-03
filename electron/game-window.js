const { EventEmitter } = require("events");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function scriptPath() {
  const packed = path.join(__dirname, "capture", "game-window-watch.ps1");
  if (fs.existsSync(packed)) return packed;
  const unpacked = packed.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  if (unpacked !== packed && fs.existsSync(unpacked)) return unpacked;
  return packed;
}

class GameWindowTracker extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.wanted = false;
    this.bounds = null;
    this.found = false;
    this.processSeen = false;
    this.buffer = "";
  }

  start() {
    if (this.child) return;
    this.wanted = true;
    const file = scriptPath();
    const shell = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    this.child = spawn(
      fs.existsSync(shell) ? shell : "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", file],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#onData(chunk));
    this.child.stderr.on("data", () => {});
    this.child.on("exit", () => {
      this.child = null;
      if (!this.wanted) return;
      setTimeout(() => {
        if (this.wanted && !this.child) this.start();
      }, 800);
    });
  }

  stop() {
    this.wanted = false;
    if (this.child && !this.child.killed) {
      try {
        this.child.kill();
      } catch {
        /* ignore */
      }
    }
    this.child = null;
    this.buffer = "";
  }

  getStatus() {
    return {
      found: this.found,
      bounds: this.bounds,
    };
  }

  #onData(chunk) {
    this.buffer += String(chunk || "");
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const found = Boolean(parsed.found);
        const bounds = found
          ? {
              x: Number(parsed.x) || 0,
              y: Number(parsed.y) || 0,
              width: Number(parsed.width) || 0,
              height: Number(parsed.height) || 0,
            }
          : null;
        const same =
          this.found === found &&
          JSON.stringify(this.bounds) === JSON.stringify(bounds);
        this.found = found;
        this.processSeen = Boolean(parsed.process) || found;
        this.bounds = bounds;
        if (!same) this.emit("bounds", { found, bounds, process: this.processSeen });
      } catch {
        /* ignore partial JSON */
      }
    }
  }
}

module.exports = { GameWindowTracker };
