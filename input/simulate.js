// Input simulation wrapper.
//
// Uses `@nut-tree/nut-js` if available (optionalDependency). If not installed or
// it fails to load, input simulation becomes a no-op (events are logged).

function tryLoadNutJs() {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const nut = require("@nut-tree/nut-js");
    return { available: true, nut };
  } catch (err) {
    return { available: false, error: err };
  }
}

function keyFromIohookRawcode(rawcode, nut) {
  // Minimal mapping for common keys.
  // Extend as needed for your keyboard layout.
  const { Key } = nut;

  // Letters A-Z: Windows virtual-key codes are 65..90
  if (rawcode >= 65 && rawcode <= 90) {
    const name = String.fromCharCode(rawcode);
    return Key[name];
  }

  // Digits 0-9: 48..57
  if (rawcode >= 48 && rawcode <= 57) {
    const name = String.fromCharCode(rawcode);
    return Key[`Num${name}`] || Key[name];
  }

  const map = new Map([
    [13, "Enter"],
    [27, "Escape"],
    [32, "Space"],
    [8, "Backspace"],
    [9, "Tab"],
    [16, "LeftShift"],
    [17, "LeftControl"],
    [18, "LeftAlt"],
    [91, "LeftSuper"], // Win key
    [37, "Left"],
    [38, "Up"],
    [39, "Right"],
    [40, "Down"],
    [46, "Delete"],
    [36, "Home"],
    [35, "End"],
    [33, "PageUp"],
    [34, "PageDown"],
  ]);

  const keyName = map.get(rawcode);
  if (!keyName) return null;
  return Key[keyName] || null;
}

function createInputSimulator({ log } = {}) {
  const loaded = tryLoadNutJs();
  const isMock = !loaded.available;

  let nut = null;
  let mouse = null;
  let keyboard = null;
  let Button = null;
  let Point = null;

  if (loaded.available) {
    nut = loaded.nut;
    mouse = nut.mouse;
    keyboard = nut.keyboard;
    Button = nut.Button;
    Point = nut.Point;

    // Keep movements snappy.
    // If your device feels too fast/slow, tune these.
    if (mouse?.config) mouse.config.mouseSpeed = 1000;
  } else {
    log?.(`[simulate] nut-js unavailable -> mock mode`);
  }

  async function setMousePosition(x, y) {
    if (isMock) {
      log?.(`[simulate/mock] mouse -> (${x}, ${y})`);
      return;
    }
    try {
      await mouse.setPosition(new Point(Math.round(x), Math.round(y)));
    } catch (err) {
      log?.(`[simulate] setPosition failed: ${err?.message || err}`);
    }
  }

  async function mouseDown(buttonNum) {
    if (isMock) return;
    const b = buttonNum === 2 ? Button.RIGHT : Button.LEFT;
    try {
      await mouse.pressButton(b);
    } catch (_) {
      // ignore
    }
  }

  async function mouseUp(buttonNum) {
    if (isMock) return;
    const b = buttonNum === 2 ? Button.RIGHT : Button.LEFT;
    try {
      await mouse.releaseButton(b);
    } catch (_) {
      // ignore
    }
  }

  async function scroll(amount) {
    if (isMock) return;
    try {
      if (amount < 0) await mouse.scrollUp(Math.abs(amount));
      else await mouse.scrollDown(Math.abs(amount));
    } catch (_) {
      // ignore
    }
  }

  async function keyDown(rawcode) {
    if (isMock) return;
    const key = keyFromIohookRawcode(rawcode, nut);
    if (!key) return;
    try {
      await keyboard.pressKey(key);
    } catch (_) {
      // ignore
    }
  }

  async function keyUp(rawcode) {
    if (isMock) return;
    const key = keyFromIohookRawcode(rawcode, nut);
    if (!key) return;
    try {
      await keyboard.releaseKey(key);
    } catch (_) {
      // ignore
    }
  }

  return {
    available: loaded.available,
    setMousePosition,
    mouseDown,
    mouseUp,
    scroll,
    keyDown,
    keyUp,
  };
}

module.exports = {
  createInputSimulator,
};

