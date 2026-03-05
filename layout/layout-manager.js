const fs = require("fs");
const path = require("path");

// A simple grid-based layout.
//
// Each device has a (x, y) cell. Neighbor lookup uses nearest device in the
// requested direction along the same row/column (matches the example layout).
//
// This is intentionally easy to understand + extend (e.g. overlap-based monitor
// adjacency) without changing the storage format.

const LAYOUT_VERSION = 1;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

class LayoutManager {
  constructor({ userDataPath, hostId }) {
    this.hostId = hostId;
    this.layoutPath = path.join(userDataPath, "layout.json");
    this.layout = null;
  }

  loadOrCreateDefault() {
    const existing = this._readLayoutFromDisk();
    if (existing) {
      this.layout = this._normalizeLayout(existing);
      return this.layout;
    }

    this.layout = this._normalizeLayout({
      version: LAYOUT_VERSION,
      devices: [
        { id: this.hostId, name: "HOST", role: "host", x: 0, y: 1 }
      ],
    });
    this._writeLayoutToDisk(this.layout);
    return this.layout;
  }

  getLayout() {
    if (!this.layout) return null;
    return JSON.parse(JSON.stringify(this.layout));
  }

  saveLayout(layout) {
    this.layout = this._normalizeLayout(layout);
    this._writeLayoutToDisk(this.layout);
    return this.getLayout();
  }

  ensureDevice({ id, name, role }) {
    if (!this.layout) return;
    const d = this.layout.devices.find((x) => x.id === id);
    if (d) {
      if (name) d.name = name;
      if (role) d.role = role;
      return;
    }

    // Place new clients to the right of the host by default.
    const host = this.layout.devices.find((x) => x.id === this.hostId) || { x: 0, y: 0 };
    const used = new Set(this.layout.devices.map((x) => `${x.x},${x.y}`));
    let x = host.x + 1;
    let y = host.y;
    while (used.has(`${x},${y}`)) x += 1;

    this.layout.devices.push({
      id,
      name: name || id.slice(0, 6),
      role: role || "client",
      x,
      y,
    });
    this._writeLayoutToDisk(this.layout);
  }

  moveDevice(id, x, y) {
    if (!this.layout) return null;
    const d = this.layout.devices.find((t) => t.id === id);
    if (!d) return null;
    d.x = clamp(Number(x) || 0, -50, 50);
    d.y = clamp(Number(y) || 0, -50, 50);
    this._writeLayoutToDisk(this.layout);
    return this.getLayout();
  }

  getNeighbor(id, direction) {
    if (!this.layout) return null;
    const d = this.layout.devices.find((x) => x.id === id);
    if (!d) return null;

    const devs = this.layout.devices.filter((x) => x.id !== id);
    if (direction === "left") {
      const cands = devs.filter((x) => x.y === d.y && x.x < d.x);
      cands.sort((a, b) => b.x - a.x);
      return cands[0]?.id || null;
    }
    if (direction === "right") {
      const cands = devs.filter((x) => x.y === d.y && x.x > d.x);
      cands.sort((a, b) => a.x - b.x);
      return cands[0]?.id || null;
    }
    if (direction === "up") {
      const cands = devs.filter((x) => x.x === d.x && x.y < d.y);
      cands.sort((a, b) => b.y - a.y);
      return cands[0]?.id || null;
    }
    if (direction === "down") {
      const cands = devs.filter((x) => x.x === d.x && x.y > d.y);
      cands.sort((a, b) => a.y - b.y);
      return cands[0]?.id || null;
    }
    return null;
  }

  _normalizeLayout(layout) {
    const devices = Array.isArray(layout?.devices) ? layout.devices : [];
    const norm = {
      version: LAYOUT_VERSION,
      devices: devices
        .filter((d) => d && typeof d.id === "string")
        .map((d) => ({
          id: d.id,
          name: typeof d.name === "string" ? d.name : d.id.slice(0, 6),
          role: d.role === "host" ? "host" : "client",
          x: Number.isFinite(d.x) ? d.x : 0,
          y: Number.isFinite(d.y) ? d.y : 0,
        })),
    };

    // Ensure host exists.
    if (!norm.devices.some((d) => d.id === this.hostId)) {
      norm.devices.push({ id: this.hostId, name: "HOST", role: "host", x: 0, y: 1 });
    }

    // De-dupe by ID, last one wins.
    const byId = new Map();
    for (const d of norm.devices) byId.set(d.id, d);
    norm.devices = Array.from(byId.values());

    return norm;
  }

  _readLayoutFromDisk() {
    try {
      if (!fs.existsSync(this.layoutPath)) return null;
      const raw = fs.readFileSync(this.layoutPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  _writeLayoutToDisk(layout) {
    try {
      fs.writeFileSync(this.layoutPath, JSON.stringify(layout, null, 2), "utf8");
    } catch (_) {
      // ignore: layout persistence failure should not crash the app
    }
  }
}

module.exports = {
  LayoutManager,
};

