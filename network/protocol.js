const PROTOCOL_VERSION = 1;

// All messages are JSON:
// { type: string, ...payload }
//
// Client -> Host
// - HELLO: { protocolVersion, client: { hostname, platform, screen: { width, height } } }
//
// Host -> Client
// - WELCOME: { protocolVersion, id, maxClients }
// - DEVICE_LIST: { devices: [...] }
// - CONTROL_ACTIVE: { activeId }
// - INPUT: { events: [...] }

const MsgType = Object.freeze({
  HELLO: "HELLO",
  WELCOME: "WELCOME",
  DEVICE_LIST: "DEVICE_LIST",
  CONTROL_ACTIVE: "CONTROL_ACTIVE",
  INPUT: "INPUT",
});

function safeJsonParse(str) {
  try {
    return { ok: true, value: JSON.parse(str) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

function toJson(obj) {
  return JSON.stringify(obj);
}

module.exports = {
  PROTOCOL_VERSION,
  MsgType,
  safeJsonParse,
  toJson,
};

