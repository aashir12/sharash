# sharemouse-clone (personal)

Electron desktop app that lets **one HOST** computer share mouse/keyboard control with up to **5 CLIENT** computers on the same LAN using **WebSockets**.

This project is designed to be runnable even if native input modules fail to install:

- If `iohook` is unavailable, HOST input capture runs in **mock mode** (no global capture).
- If `@nut-tree/nut-js` is unavailable, CLIENT input simulation runs in **mock mode** (events are logged).

## Features

- **Multi-client support**: host accepts up to 5 clients, each with ID + IP + hostname.
- **Screen layout system**: arrange devices like monitors in a simple grid editor; stored as JSON.
- **Edge switching**: move to a layout neighbor when the pointer hits an edge.
- **Input capture**: via `iohook` (optional native).
- **Input simulation**: via `@nut-tree/nut-js` (optional native).
- **Networking**: `ws` (host server, client connections).
- **Electron UI**: start host, connect to host, device list, layout editor, toggles, status indicator.
- **Performance**: mouse move events are throttled and coalesced.

## Project structure

```
sharemouse-clone/
  main.js
  preload.js
  renderer/
    index.html
    style.css
    app.js
  network/
    server.js
    client.js
    protocol.js
  input/
    capture.js
    simulate.js
  layout/
    layout-manager.js
```

## Run

1. Install Node.js (recommended: **Node 20+**).
2. Install dependencies:

```bash
cd sharemouse-clone
npm install
```

3. Start the app:

```bash
npm start
```

## Native modules (recommended)

To actually capture/simulate input across the OS, you need native modules:

- `iohook` for global input capture (HOST)
- `@nut-tree/nut-js` for input simulation (CLIENT)

On Windows, native builds typically require:

- Visual Studio Build Tools (C++ build tools)
- Python 3

If native modules fail to install, the app will still start and the UI/network/layout will work, but it will log input events instead of capturing/simulating them.

## How to use

- On the computer that should be the **HOST**:
  - Click **Start Host**
  - Arrange devices in the **Screen Layout** grid (drag tiles)
  - Enable **Mouse sharing** and/or **Keyboard sharing**
- On each **CLIENT** computer:
  - Enter the HOST IP (e.g. `192.168.1.50`)
  - Click **Connect**

When the active pointer hits an edge, control switches to the adjacent device based on the saved layout.

## Layout JSON (example)

The layout is stored at `app.getPath('userData')/layout.json` and uses simple grid coordinates:

```json
{
  "version": 1,
  "devices": [
    { "id": "client-1", "name": "CLIENT1", "role": "client", "x": 0, "y": 0 },
    { "id": "client-2", "name": "CLIENT2", "role": "client", "x": 1, "y": 0 },
    { "id": "HOST",     "name": "HOST",    "role": "host",   "x": 0, "y": 1 },
    { "id": "client-3", "name": "CLIENT3", "role": "client", "x": 1, "y": 1 },
    { "id": "client-4", "name": "CLIENT4", "role": "client", "x": 0, "y": 2 }
  ]
}
```

## Notes / limitations

- Input suppression (preventing the host OS from also receiving input) is **not implemented**; this is a personal-use prototype.
- Key mapping is intentionally minimal; you can extend `input/simulate.js` to handle more keys.

