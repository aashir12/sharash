const { EventEmitter } = require("events");
const os = require("os");
const { WebSocketServer } = require("ws");
const { v4: uuidv4 } = require("uuid");
const { MsgType, PROTOCOL_VERSION, safeJsonParse, toJson } = require("./protocol");

function normalizeRemoteAddress(remoteAddress) {
  if (!remoteAddress) return "";
  // ws on Node often returns IPv6-mapped IPv4 like ::ffff:192.168.1.10
  if (remoteAddress.startsWith("::ffff:")) return remoteAddress.slice("::ffff:".length);
  return remoteAddress;
}

class HostServer extends EventEmitter {
  constructor({ port, maxClients = 5 }) {
    super();
    this.port = port;
    this.maxClients = maxClients;
    this.wss = null;
    this.clients = new Map(); // id -> { ws, ip, hostname, platform, screen }
    this._pingInterval = null;
  }

  start() {
    if (this.wss) return;

    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on("connection", (ws, req) => {
      if (this.clients.size >= this.maxClients) {
        ws.close(1008, "Host is full");
        return;
      }

      const id = uuidv4();
      const ip = normalizeRemoteAddress(req?.socket?.remoteAddress);

      const client = {
        id,
        ip,
        hostname: "(unknown)",
        platform: "(unknown)",
        screen: { width: 0, height: 0 },
        connectedAt: Date.now(),
        ws,
      };

      this.clients.set(id, client);

      ws.on("message", (data) => {
        const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        const parsed = safeJsonParse(text);
        if (!parsed.ok) return;

        const msg = parsed.value;
        if (!msg || typeof msg.type !== "string") return;

        if (msg.type === MsgType.HELLO) {
          const c = msg.client || {};
          client.hostname = String(c.hostname || "(unknown)");
          client.platform = String(c.platform || "(unknown)");
          client.screen = {
            width: Number(c.screen?.width || 0),
            height: Number(c.screen?.height || 0),
          };
          this._send(ws, MsgType.WELCOME, {
            protocolVersion: PROTOCOL_VERSION,
            id,
            maxClients: this.maxClients,
            host: {
              hostname: os.hostname(),
              platform: process.platform,
            },
          });
          this._emitDevices();
          return;
        }

        // Reserved for future client->host messages (e.g. clipboard sync, latency stats).
        this.emit("client:message", { clientId: id, message: msg });
      });

      ws.on("close", () => {
        this.clients.delete(id);
        this._emitDevices();
      });

      ws.on("error", () => {
        // Close is handled separately; keep error side-effects minimal.
      });

      // Immediately send device list so UI updates quickly, even before HELLO.
      this._emitDevices();
    });

    this.wss.on("listening", () => {
      this.emit("listening", { port: this.port });
    });

    this.wss.on("error", (err) => {
      this.emit("error", err);
    });

    // Keep connections healthy; ws automatically responds to pings with pongs.
    this._pingInterval = setInterval(() => {
      for (const client of this.clients.values()) {
        try {
          client.ws.ping();
        } catch (_) {
          // ignore
        }
      }
    }, 10_000);
  }

  stop() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }

    for (const client of this.clients.values()) {
      try {
        client.ws.close(1001, "Host stopped");
      } catch (_) {
        // ignore
      }
    }
    this.clients.clear();

    if (this.wss) {
      try {
        this.wss.close();
      } catch (_) {
        // ignore
      }
      this.wss = null;
    }
    this._emitDevices();
  }

  getDevices() {
    return Array.from(this.clients.values()).map((c) => ({
      id: c.id,
      ip: c.ip,
      hostname: c.hostname,
      platform: c.platform,
      screen: c.screen,
      connectedAt: c.connectedAt,
    }));
  }

  sendTo(clientId, type, payload) {
    const c = this.clients.get(clientId);
    if (!c) return false;
    return this._send(c.ws, type, payload);
  }

  broadcast(type, payload) {
    for (const c of this.clients.values()) {
      this._send(c.ws, type, payload);
    }
  }

  _send(ws, type, payload) {
    try {
      ws.send(toJson({ type, ...payload }));
      return true;
    } catch (_) {
      return false;
    }
  }

  _emitDevices() {
    const devices = this.getDevices();
    this.emit("devices", devices);
    this.broadcast(MsgType.DEVICE_LIST, { devices });
  }
}

module.exports = {
  HostServer,
};

