/* global ShareMouse */

const $ = (sel) => document.querySelector(sel);

const el = {
  pillMode: $("#pillMode"),
  pillConn: $("#pillConn"),
  hostPort: $("#hostPort"),
  btnStartHost: $("#btnStartHost"),
  btnStopHost: $("#btnStopHost"),
  hostIp: $("#hostIp"),
  clientPort: $("#clientPort"),
  btnConnect: $("#btnConnect"),
  btnDisconnect: $("#btnDisconnect"),
  toggleMouse: $("#toggleMouse"),
  toggleKeyboard: $("#toggleKeyboard"),
  devices: $("#devices"),
  layoutGrid: $("#layoutGrid"),
  logs: $("#logs"),
  btnClearLogs: $("#btnClearLogs"),
  nativeNote: $("#nativeNote"),
};

let state = null;
let devices = [];
let layout = null;
let activeId = "HOST";

function fmtTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString();
  } catch {
    return "";
  }
}

function logLine(msg) {
  const div = document.createElement("div");
  div.className = "logLine";
  div.textContent = `[${fmtTime(Date.now())}] ${msg}`;
  el.logs.appendChild(div);
  el.logs.scrollTop = el.logs.scrollHeight;
}

function setPills() {
  const mode = state?.mode || "idle";
  el.pillMode.textContent = `Mode: ${mode.toUpperCase()}`;

  let conn = "-";
  if (mode === "host") conn = `Hosting on :${state?.port ?? ""}`;
  if (mode === "client") conn = `Client mode`;
  if (mode === "idle") conn = `Idle`;
  el.pillConn.textContent = `Status: ${conn}`;
}

function renderNativeNote() {
  const c = state?.native?.captureAvailable;
  const s = state?.native?.simulateAvailable;

  const parts = [];
  parts.push(`Capture: ${c ? "iohook OK" : "mock mode"}`);
  parts.push(`Simulate: ${s ? "nut-js OK" : "mock mode"}`);
  parts.push(`Tip: install optional native modules for full functionality.`);
  el.nativeNote.textContent = parts.join(" · ");
}

function renderDevices() {
  el.devices.innerHTML = "";
  for (const d of devices) {
    const row = document.createElement("div");
    row.className = "device";
    if (d.id === activeId) row.classList.add("device--active");

    const left = document.createElement("div");
    left.className = "device__left";

    const name = document.createElement("div");
    name.className = "device__name";
    const label = d.role === "host" ? "HOST" : (d.hostname || d.id.slice(0, 6));
    name.textContent = label;

    const meta = document.createElement("div");
    meta.className = "device__meta";
    const ip = d.ip || "";
    const scr = d.screen?.width ? `${d.screen.width}×${d.screen.height}` : "";
    meta.textContent = `${d.id}${ip ? ` · ${ip}` : ""}${scr ? ` · ${scr}` : ""}`;

    left.appendChild(name);
    left.appendChild(meta);

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = d.id === activeId ? "ACTIVE" : (d.role === "host" ? "LOCAL" : "CONNECTED");

    row.appendChild(left);
    row.appendChild(badge);
    el.devices.appendChild(row);
  }
}

function computeGridBounds(devs) {
  if (!devs.length) return { minX: 0, maxX: 2, minY: 0, maxY: 2 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of devs) {
    minX = Math.min(minX, d.x);
    minY = Math.min(minY, d.y);
    maxX = Math.max(maxX, d.x);
    maxY = Math.max(maxY, d.y);
  }
  // Add padding around for easier editing.
  return { minX: minX - 1, maxX: maxX + 1, minY: minY - 1, maxY: maxY + 1 };
}

function renderLayout() {
  el.layoutGrid.innerHTML = "";

  const devs = Array.isArray(layout?.devices) ? layout.devices : [];
  const bounds = computeGridBounds(devs);
  const cols = bounds.maxX - bounds.minX + 1;
  const rows = bounds.maxY - bounds.minY + 1;
  el.layoutGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(120px, 1fr))`;
  el.layoutGrid.style.gridAutoRows = `72px`;

  const posToDevice = new Map();
  for (const d of devs) posToDevice.set(`${d.x},${d.y}`, d);

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);

      cell.addEventListener("dragover", (e) => e.preventDefault());
      cell.addEventListener("drop", async (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/deviceId");
        if (!id) return;
        await ShareMouse.moveDevice(id, x, y);
      });

      const d = posToDevice.get(`${x},${y}`);
      if (d) {
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.draggable = true;
        tile.dataset.deviceId = d.id;

        tile.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/deviceId", d.id);
          e.dataTransfer.effectAllowed = "move";
        });

        if (d.role === "host") tile.classList.add("tile--host");
        else tile.classList.add("tile--client");
        if (d.id === activeId) tile.classList.add("tile--active");

        const title = document.createElement("div");
        title.className = "tile__title";
        title.textContent = d.role === "host" ? "HOST" : (d.name || d.id.slice(0, 6));

        const sub = document.createElement("div");
        sub.className = "tile__sub";
        sub.textContent = `${d.id.slice(0, 8)} @ (${d.x},${d.y})`;

        tile.appendChild(title);
        tile.appendChild(sub);
        cell.appendChild(tile);
      }

      el.layoutGrid.appendChild(cell);
    }
  }
}

async function refreshAll() {
  state = await ShareMouse.getState();
  layout = await ShareMouse.getLayout();
  activeId = state?.activeId || activeId;

  setPills();
  renderNativeNote();
  renderDevices();
  renderLayout();

  el.toggleMouse.checked = Boolean(state?.sharing?.mouse);
  el.toggleKeyboard.checked = Boolean(state?.sharing?.keyboard);
}

async function main() {
  el.btnStartHost.addEventListener("click", async () => {
    const port = Number(el.hostPort.value || 41500);
    await ShareMouse.startHost(port);
  });
  el.btnStopHost.addEventListener("click", async () => {
    await ShareMouse.stopHost();
  });

  el.btnConnect.addEventListener("click", async () => {
    const host = (el.hostIp.value || "").trim();
    const port = Number(el.clientPort.value || 41500);
    if (!host) {
      logLine("Enter a HOST IP first.");
      return;
    }
    await ShareMouse.connectToHost(host, port);
  });
  el.btnDisconnect.addEventListener("click", async () => {
    await ShareMouse.disconnect();
  });

  el.toggleMouse.addEventListener("change", async () => {
    await ShareMouse.setSharing({ mouse: el.toggleMouse.checked });
  });
  el.toggleKeyboard.addEventListener("change", async () => {
    await ShareMouse.setSharing({ keyboard: el.toggleKeyboard.checked });
  });

  el.btnClearLogs.addEventListener("click", () => {
    el.logs.innerHTML = "";
  });

  ShareMouse.on("state:update", (s) => {
    state = s;
    activeId = state?.activeId || activeId;
    setPills();
    renderNativeNote();
  });
  ShareMouse.on("devices:update", (payload) => {
    devices = payload?.devices || [];
    activeId = payload?.activeId || activeId;
    renderDevices();
    renderLayout();
  });
  ShareMouse.on("layout:update", (payload) => {
    layout = payload?.layout || layout;
    renderLayout();
  });
  ShareMouse.on("log", (payload) => {
    if (!payload?.msg) return;
    logLine(payload.msg);
  });

  await refreshAll();
}

main();

