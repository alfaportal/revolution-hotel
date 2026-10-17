const EventEmitter = require("events");
const {
  pickLanIPv4Address,
  listLanIPv4Addresses,
  getLocalServerPort,
} = require("../local-staff-links");

class NetworkMonitor extends EventEmitter {
  constructor(intervalMs = 30000) {
    super();
    this.intervalMs = Math.max(5000, Number(intervalMs) || 30000);
    this.timer = null;
    this.lastSnapshot = null;
  }

  snapshot() {
    const ips = listLanIPv4Addresses();
    const primary_ip = pickLanIPv4Address() || ips[0] || "";
    const port = getLocalServerPort();
    return {
      primary_ip,
      ips: ips.slice(),
      port,
      fingerprint: `${primary_ip}|${ips.join(",")}|${port}`,
      at: new Date().toISOString(),
    };
  }

  start() {
    if (this.timer) return this;
    this.lastSnapshot = this.snapshot();
    this.timer = setInterval(() => {
      const next = this.snapshot();
      if (!this.lastSnapshot || next.fingerprint !== this.lastSnapshot.fingerprint) {
        const previous = this.lastSnapshot;
        this.lastSnapshot = next;
        this.emit("change", { previous, current: next });
      }
    }, this.intervalMs);
    return this;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = {
  NetworkMonitor,
  listLanIPv4Addresses,
  pickLanIPv4Address,
};
