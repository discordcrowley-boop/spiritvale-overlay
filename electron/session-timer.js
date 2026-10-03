const { EventEmitter } = require("events");

/**
 * Start / pause / stop session stopwatch shared by every overlay window.
 * State lives in main so a pause can freeze the live capture for all meters.
 */
class SessionTimer extends EventEmitter {
  constructor() {
    super();
    this.state = "idle";
    this.startedAt = null;
    this.accumulatedMs = 0;
    this.pauseOverlays = true;
  }

  elapsedMs(nowMs = Date.now()) {
    const live = this.state === "running" && this.startedAt != null ? nowMs - this.startedAt : 0;
    return Math.max(0, this.accumulatedMs + live);
  }

  /** True when meters should be frozen by this timer. */
  overlaysPaused() {
    return this.pauseOverlays && this.state === "paused";
  }

  snapshot(nowMs = Date.now()) {
    return {
      state: this.state,
      startedAt: this.startedAt,
      accumulatedMs: this.accumulatedMs,
      elapsedMs: this.elapsedMs(nowMs),
      pauseOverlays: this.pauseOverlays,
      overlaysPaused: this.overlaysPaused(),
      at: nowMs,
    };
  }

  command(cmd, payload = {}) {
    const now = Date.now();
    const before = this.overlaysPaused();
    switch (String(cmd || "")) {
      case "start":
        if (this.state !== "running") {
          this.startedAt = now;
          this.state = "running";
        }
        break;
      case "pause":
        if (this.state === "running") {
          this.accumulatedMs = this.elapsedMs(now);
          this.startedAt = null;
          this.state = "paused";
        }
        break;
      case "restart":
        this.accumulatedMs = 0;
        this.startedAt = now;
        this.state = "running";
        break;
      case "toggle":
        return this.command(this.state === "running" ? "pause" : "start", payload);
      case "stop":
        this.state = "idle";
        this.startedAt = null;
        this.accumulatedMs = 0;
        break;
      case "config":
        if (payload.pauseOverlays != null) this.pauseOverlays = Boolean(payload.pauseOverlays);
        break;
      default:
        return this.snapshot(now);
    }
    const snap = this.snapshot(now);
    this.emit("changed", snap, { pauseChanged: before !== this.overlaysPaused() });
    return snap;
  }
}

module.exports = { SessionTimer };
