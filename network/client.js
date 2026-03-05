const { EventEmitter } = require("events");
const WebSocket = require("ws");
const { MsgType, PROTOCOL_VERSION, safeJsonParse, toJson } = require("./protocol");

class ClientConnection extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    this.clientId = null;
    this.lastDeviceList = [];
    this.activeId = null;
  }

  connect({ host, port, clientInfo }) {
    if (this.ws) this.disconnect();

    const url = `ws://${host}:${port}`;
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this.connected = true;
      this.emit("status", { connected: true, url });

      this._send(MsgType.HELLO, {
        protocolVersion: PROTOCOL_VERSION,
        client: clientInfo,
      });
    });

    this.ws.on("message", (data) => {
      const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
      const parsed = safeJsonParse(text);
      if (!parsed.ok) return;
      const msg = parsed.value;
      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === MsgType.WELCOME) {
        this.clientId = msg.id || null;
        this.emit("welcome", msg);
        return;
      }

      if (msg.type === MsgType.DEVICE_LIST) {
        this.lastDeviceList = Array.isArray(msg.devices) ? msg.devices : [];
        this.emit("devices", this.lastDeviceList);
        return;
      }

      if (msg.type === MsgType.CONTROL_ACTIVE) {
        this.activeId = msg.activeId || null;
        this.emit("active", { activeId: this.activeId });
        return;
      }

      if (msg.type === MsgType.INPUT) {
        const events = Array.isArray(msg.events) ? msg.events : [];
        this.emit("input", { events });
        return;
      }

      this.emit("message", msg);
    });

    this.ws.on("close", (code, reason) => {
      const msg = Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason || "");
      this.connected = false;
      this.clientId = null;
      this.emit("status", { connected: false, code, reason: msg });
      this.ws = null;
    });

    this.ws.on("error", (err) => {
      this.emit("error", err);
    });
  }

  disconnect() {
    if (!this.ws) return;
    try {
      this.ws.close(1000, "Client disconnect");
    } catch (_) {
      // ignore
    }
    this.ws = null;
    this.connected = false;
    this.clientId = null;
  }

  _send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(toJson({ type, ...payload }));
      return true;
    } catch (_) {
      return false;
    }
  }
}

module.exports = {
  ClientConnection,
};

