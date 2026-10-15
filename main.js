const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const os = require("os");

const { HostServer } = require("./network/server");
const { ClientConnection } = require("./network/client");
const { MsgType } = require("./network/protocol");
const { createInputCapture } = require("./input/capture");
const { createInputSimulator } = require("./input/simulate");
const { LayoutManager } = require("./layout/layout-manager");

// Host Id
const HOST_ID = "HOST";
const DEFAULT_PORT = 41500;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function getPrimaryScreenSize() {
  const d = screen.getPrimaryDisplay();
  const b = d?.bounds || { width: 0, height: 0 };
  return { width: b.width, height: b.height };
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    backgroundColor: "#0b0b0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  return win;
}

class AppController {
  constructor({ window }) {
    this.window = window;

    this.mode = "idle"; // idle | host | client
    this.port = DEFAULT_PORT;

    this.server = null;
    this.client = null;

    this.capture = null;
    this.simulator = null; // used by client to simulate input
    this.hostWarp = null; // optional: warp host pointer while controlling remote

    this.sharing = { mouse: true, keyboard: true };
    this.devices = [
      {
        id: HOST_ID,
        ip: "local",
        hostname: os.hostname(),
        platform: process.platform,
        screen: getPrimaryScreenSize(),
        connectedAt: Date.now(),
        role: "host",
      },
    ];
    this.activeId = HOST_ID;

    this.layoutManager = new LayoutManager({ userDataPath: app.getPath("userData"), hostId: HOST_ID });
    this.layoutManager.loadOrCreateDefault();

    // For edge switching / movement
    this._lastMouse = null; // { x, y }
    this._virtualCursor = { x: 0, y: 0 };
    this._lastSentMoveAt = 0;
    this._pendingMove = null;
    this._moveFlushTimer = null;
  }

  log(msg) {
    this.window.webContents.send("log", { msg, at: Date.now() });
  }

  broadcastState() {
    this.window.webContents.send("state:update", this.getState());
  }

  broadcastDevices() {
    this.window.webContents.send("devices:update", { devices: this.devices, activeId: this.activeId });
  }

  broadcastLayout() {
    this.window.webContents.send("layout:update", { layout: this.layoutManager.getLayout() });
  }

  getState() {
    return {
      mode: this.mode,
      port: this.port,
      sharing: this.sharing,
      activeId: this.activeId,
      host: {
        id: HOST_ID,
        hostname: os.hostname(),
        platform: process.platform,
        screen: getPrimaryScreenSize(),
      },
      layout: this.layoutManager.getLayout(),
      native: {
        captureAvailable: Boolean(this.capture?.available),
        simulateAvailable: Boolean(this.simulator?.available),
      },
    };
  }

  setSharing(opts) {
    this.sharing = {
      mouse: typeof opts?.mouse === "boolean" ? opts.mouse : this.sharing.mouse,
      keyboard: typeof opts?.keyboard === "boolean" ? opts.keyboard : this.sharing.keyboard,
    };
    this.capture?.setEnabled(this.sharing);
    this.broadcastState();
  }

  setActive(id) {
    if (!id) return;
    if (this.activeId === id) return;
    this.activeId = id;
    this.broadcastDevices();

    if (this.server) {
      this.server.broadcast(MsgType.CONTROL_ACTIVE, { activeId: this.activeId });
    }
  }

  _getDeviceById(id) {
    return this.devices.find((d) => d.id === id) || null;
  }

  _getActiveScreenSize() {
    if (this.activeId === HOST_ID) return getPrimaryScreenSize();
    const d = this._getDeviceById(this.activeId);
    return d?.screen?.width ? d.screen : { width: 1920, height: 1080 };
  }

  _maybeSwitchEdge(dx, dy) {
    const { width, height } = this._getActiveScreenSize();
    const x = this._virtualCursor.x;
    const y = this._virtualCursor.y;

    const atLeft = x <= 0 && dx < 0;
    const atRight = x >= width - 1 && dx > 0;
    const atUp = y <= 0 && dy < 0;
    const atDown = y >= height - 1 && dy > 0;

    let dir = null;
    if (atLeft) dir = "left";
    else if (atRight) dir = "right";
    else if (atUp) dir = "up";
    else if (atDown) dir = "down";
    if (!dir) return;

    const neighborId = this.layoutManager.getNeighbor(this.activeId, dir);
    if (!neighborId) return;
    if (!this._getDeviceById(neighborId)) return;

    // Set new virtual cursor near the opposite edge on the neighbor.
    const neighborSize = neighborId === HOST_ID ? getPrimaryScreenSize() : (this._getDeviceById(neighborId)?.screen || { width, height });
    if (dir === "left") this._virtualCursor.x = neighborSize.width - 2;
    if (dir === "right") this._virtualCursor.x = 1;
    if (dir === "up") this._virtualCursor.y = neighborSize.height - 2;
    if (dir === "down") this._virtualCursor.y = 1;

    this._virtualCursor.x = clamp(this._virtualCursor.x, 0, neighborSize.width - 1);
    this._virtualCursor.y = clamp(this._virtualCursor.y, 0, neighborSize.height - 1);

    this.setActive(neighborId);
    this.log(`[switch] ${this.activeId} via ${dir}`);
  }

  _queueMouseMoveToActive(x, y) {
    // Coalesce moves: keep only the latest position and flush at ~60Hz.
    this._pendingMove = { x, y, at: Date.now() };
    if (this._moveFlushTimer) return;

    this._moveFlushTimer = setInterval(() => {
      if (!this._pendingMove) return;
      if (!this.server) return;
      if (this.activeId === HOST_ID) {
        this._pendingMove = null;
        return;
      }

      const { x: px, y: py } = this._pendingMove;
      this._pendingMove = null;

      const now = Date.now();
      if (now - this._lastSentMoveAt < 12) return; // extra guard
      this._lastSentMoveAt = now;

      this.server.sendTo(this.activeId, MsgType.INPUT, {
        events: [{ kind: "mousemove", x: Math.round(px), y: Math.round(py) }],
      });
    }, 1000 / 60);
  }

  _handleCapturedEvent(evt) {
    if (evt.type === "mousemove") {
      const { width: hostW, height: hostH } = getPrimaryScreenSize();
      const x = clamp(Number(evt.x) || 0, 0, hostW - 1);
      const y = clamp(Number(evt.y) || 0, 0, hostH - 1);

      let dx = 0;
      let dy = 0;
      if (this._lastMouse) {
        dx = x - this._lastMouse.x;
        dy = y - this._lastMouse.y;
      }
      this._lastMouse = { x, y };

      // Update virtual cursor differently depending on which screen is active.
      if (this.activeId === HOST_ID) {
        this._virtualCursor = { x, y };
      } else {
        const { width, height } = this._getActiveScreenSize();
        this._virtualCursor.x = clamp(this._virtualCursor.x + dx, 0, width - 1);
        this._virtualCursor.y = clamp(this._virtualCursor.y + dy, 0, height - 1);

        // Keep host pointer from drifting while controlling remote (best-effort).
        if (this.hostWarp?.available) {
          const cx = Math.floor(hostW / 2);
          const cy = Math.floor(hostH / 2);
          this.hostWarp.setMousePosition(cx, cy);
        }
      }

      this._maybeSwitchEdge(dx, dy);
      this._queueMouseMoveToActive(this._virtualCursor.x, this._virtualCursor.y);
      return;
    }

    if (!this.server) return;
    if (this.activeId === HOST_ID) return;

    if (evt.type === "mousedown" && this.sharing.mouse) {
      this.server.sendTo(this.activeId, MsgType.INPUT, { events: [{ kind: "mousedown", button: evt.button }] });
      return;
    }
    if (evt.type === "mouseup" && this.sharing.mouse) {
      this.server.sendTo(this.activeId, MsgType.INPUT, { events: [{ kind: "mouseup", button: evt.button }] });
      return;
    }
    if (evt.type === "mousewheel" && this.sharing.mouse) {
      // Use rotation as a coarse wheel signal.
      const amount = Number(evt.rotation || evt.amount || 0);
      this.server.sendTo(this.activeId, MsgType.INPUT, { events: [{ kind: "mousewheel", amount }] });
      return;
    }
    if (evt.type === "keydown" && this.sharing.keyboard) {
      this.server.sendTo(this.activeId, MsgType.INPUT, { events: [{ kind: "keydown", rawcode: evt.rawcode }] });
      return;
    }
    if (evt.type === "keyup" && this.sharing.keyboard) {
      this.server.sendTo(this.activeId, MsgType.INPUT, { events: [{ kind: "keyup", rawcode: evt.rawcode }] });
      return;
    }
  }

  startHost({ port }) {
    this.stopAll();

    this.mode = "host";
    this.port = Number(port || DEFAULT_PORT);

    this.server = new HostServer({ port: this.port, maxClients: 5 });
    this.server.on("listening", () => {
      this.log(`[host] listening on :${this.port}`);
      this.broadcastState();
    });
    this.server.on("devices", (clientDevices) => {
      // Merge host device with client list.
      const hostDevice = this.devices.find((d) => d.id === HOST_ID);
      const clients = clientDevices.map((d) => ({ ...d, role: "client" }));
      this.devices = [hostDevice, ...clients];

      // Ensure layout entries exist for connected clients.
      for (const c of clients) {
        this.layoutManager.ensureDevice({ id: c.id, name: c.hostname, role: "client" });
      }
      this.broadcastDevices();
      this.broadcastLayout();

      // If active device disconnected, fall back to host.
      if (this.activeId !== HOST_ID && !clients.some((c) => c.id === this.activeId)) {
        this.setActive(HOST_ID);
      }
    });
    this.server.start();

    this.capture = createInputCapture({
      onEvent: (evt) => this._handleCapturedEvent(evt),
      log: (m) => this.log(m),
    });
    this.capture.setEnabled(this.sharing);
    this.capture.start();

    // Optional host warp support (use the same simulator wrapper; it will be mock if unavailable)
    this.hostWarp = createInputSimulator({ log: (m) => this.log(m) });

    this.setActive(HOST_ID);
    this.broadcastState();
    this.broadcastDevices();
    this.broadcastLayout();
  }

  stopHost() {
    if (this.mode !== "host") return;
    this.stopAll();
  }

  connectClient({ host, port }) {
    this.stopAll();

    this.mode = "client";
    this.port = Number(port || DEFAULT_PORT);

    const clientInfo = {
      hostname: os.hostname(),
      platform: process.platform,
      screen: getPrimaryScreenSize(),
    };

    this.simulator = createInputSimulator({ log: (m) => this.log(m) });
    this.client = new ClientConnection();

    this.client.on("status", (s) => {
      this.log(`[client] ${s.connected ? "connected" : "disconnected"} ${s.url || ""}`.trim());
      this.broadcastState();
    });
    this.client.on("welcome", (w) => {
      this.log(`[client] assigned id ${w.id}`);
      this.broadcastState();
    });
    this.client.on("devices", (devs) => {
      const hostDevice =
        this.devices.find((d) => d && d.id === HOST_ID) || {
          id: HOST_ID,
          ip: "local",
          hostname: os.hostname(),
          platform: process.platform,
          screen: getPrimaryScreenSize(),
          connectedAt: Date.now(),
          role: "host",
        };
      hostDevice.screen = getPrimaryScreenSize();
      this.devices = [hostDevice, ...devs.map((d) => ({ ...d, role: "client" }))];
      this.broadcastDevices();
    });
    this.client.on("active", (a) => {
      this.activeId = a.activeId || this.activeId;
      this.broadcastDevices();
    });
    this.client.on("input", async ({ events }) => {
      for (const e of events) {
        if (e.kind === "mousemove") await this.simulator.setMousePosition(e.x, e.y);
        else if (e.kind === "mousedown") await this.simulator.mouseDown(e.button);
        else if (e.kind === "mouseup") await this.simulator.mouseUp(e.button);
        else if (e.kind === "mousewheel") await this.simulator.scroll(Number(e.amount || 0));
        else if (e.kind === "keydown") await this.simulator.keyDown(Number(e.rawcode || 0));
        else if (e.kind === "keyup") await this.simulator.keyUp(Number(e.rawcode || 0));
      }
    });

    this.client.connect({ host, port: this.port, clientInfo });

    this.broadcastState();
    this.broadcastDevices();
    this.broadcastLayout();
  }

  disconnectClient() {
    if (this.mode !== "client") return;
    this.stopAll();
  }

  stopAll() {
    if (this._moveFlushTimer) {
      clearInterval(this._moveFlushTimer);
      this._moveFlushTimer = null;
    }
    this._pendingMove = null;
    this._lastMouse = null;

    try {
      this.capture?.stop();
    } catch (_) {
      // ignore
    }
    this.capture = null;

    try {
      this.server?.stop();
    } catch (_) {
      // ignore
    }
    this.server = null;

    try {
      this.client?.disconnect();
    } catch (_) {
      // ignore
    }
    this.client = null;

    this.simulator = null;
    this.hostWarp = null;

    this.mode = "idle";
    this.activeId = HOST_ID;

    const hostDevice =
      this.devices.find((d) => d && d.id === HOST_ID) || {
        id: HOST_ID,
        ip: "local",
        hostname: os.hostname(),
        platform: process.platform,
        screen: getPrimaryScreenSize(),
        connectedAt: Date.now(),
        role: "host",
      };
    hostDevice.screen = getPrimaryScreenSize();
    this.devices = [hostDevice];

    this.broadcastState();
    this.broadcastDevices();
    this.broadcastLayout();
  }
}

let mainWindow = null;
let controller = null;

app.whenReady().then(() => {
  mainWindow = createMainWindow();
  controller = new AppController({ window: mainWindow });

  controller.broadcastState();
  controller.broadcastDevices();
  controller.broadcastLayout();

  mainWindow.on("closed", () => {
    controller?.stopAll();
    controller = null;
    mainWindow = null;
  });
});

app.on("window-all-closed", () => {
  // Typical Windows behavior: quit when all windows closed.
  app.quit();
});

// IPC
ipcMain.handle("app:getState", async () => controller?.getState());

ipcMain.handle("app:setSharing", async (_evt, opts) => {
  controller?.setSharing(opts);
  return controller?.getState();
});

ipcMain.handle("host:start", async (_evt, { port }) => {
  controller?.startHost({ port });
  return controller?.getState();
});

ipcMain.handle("host:stop", async () => {
  controller?.stopHost();
  return controller?.getState();
});

ipcMain.handle("client:connect", async (_evt, { host, port }) => {
  controller?.connectClient({ host, port });
  return controller?.getState();
});

ipcMain.handle("client:disconnect", async () => {
  controller?.disconnectClient();
  return controller?.getState();
});

ipcMain.handle("layout:get", async () => controller?.layoutManager?.getLayout());

ipcMain.handle("layout:save", async (_evt, { layout }) => {
  const saved = controller?.layoutManager?.saveLayout(layout);
  controller?.broadcastLayout();
  return saved;
});

ipcMain.handle("layout:moveDevice", async (_evt, { id, x, y }) => {
  const saved = controller?.layoutManager?.moveDevice(id, x, y);
  controller?.broadcastLayout();
  return saved;
});

