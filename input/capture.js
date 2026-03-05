// Global input capture wrapper.
//
// Uses `iohook` if available (optionalDependency). If not installed or it fails
// to load, the rest of the app can still run in "mock mode".

function tryLoadIohook() {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const iohook = require("iohook");
    return { available: true, iohook };
  } catch (err) {
    return { available: false, error: err };
  }
}

function createInputCapture({ onEvent, log }) {
  const loaded = tryLoadIohook();

  let running = false;
  let mouseEnabled = true;
  let keyboardEnabled = true;

  let lastMoveAt = 0;
  const minMoveIntervalMs = 1000 / 240; // keep capture overhead reasonable

  function emit(evt) {
    if (!running) return;
    onEvent(evt);
  }

  function start() {
    if (running) return { running: true, available: loaded.available };
    running = true;

    if (!loaded.available) {
      log?.(`[capture] iohook unavailable -> mock mode`);
      return { running: true, available: false };
    }

    const { iohook } = loaded;

    iohook.on("mousemove", (e) => {
      if (!mouseEnabled) return;
      const now = Date.now();
      if (now - lastMoveAt < minMoveIntervalMs) return;
      lastMoveAt = now;
      emit({
        type: "mousemove",
        x: e.x,
        y: e.y,
        timestamp: now,
      });
    });

    iohook.on("mousedown", (e) => {
      if (!mouseEnabled) return;
      emit({ type: "mousedown", button: e.button, x: e.x, y: e.y, timestamp: Date.now() });
    });

    iohook.on("mouseup", (e) => {
      if (!mouseEnabled) return;
      emit({ type: "mouseup", button: e.button, x: e.x, y: e.y, timestamp: Date.now() });
    });

    iohook.on("mousewheel", (e) => {
      if (!mouseEnabled) return;
      emit({
        type: "mousewheel",
        amount: e.amount,
        rotation: e.rotation,
        direction: e.direction,
        timestamp: Date.now(),
      });
    });

    iohook.on("keydown", (e) => {
      if (!keyboardEnabled) return;
      emit({
        type: "keydown",
        keycode: e.keycode,
        rawcode: e.rawcode,
        timestamp: Date.now(),
      });
    });

    iohook.on("keyup", (e) => {
      if (!keyboardEnabled) return;
      emit({
        type: "keyup",
        keycode: e.keycode,
        rawcode: e.rawcode,
        timestamp: Date.now(),
      });
    });

    try {
      iohook.start();
      log?.(`[capture] iohook started`);
    } catch (err) {
      log?.(`[capture] iohook failed to start -> mock mode: ${err?.message || err}`);
    }

    return { running: true, available: true };
  }

  function stop() {
    if (!running) return;
    running = false;
    if (!loaded.available) return;
    try {
      loaded.iohook.stop();
      loaded.iohook.removeAllListeners();
      log?.(`[capture] iohook stopped`);
    } catch (_) {
      // ignore
    }
  }

  function setEnabled({ mouse, keyboard }) {
    if (typeof mouse === "boolean") mouseEnabled = mouse;
    if (typeof keyboard === "boolean") keyboardEnabled = keyboard;
  }

  return {
    available: loaded.available,
    start,
    stop,
    setEnabled,
  };
}

module.exports = {
  createInputCapture,
};

