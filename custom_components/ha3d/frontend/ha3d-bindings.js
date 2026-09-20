// Pure binding/state rules; no house-specific names or browser dependencies.
export const FRONTEND_VERSION = "20260919-3";
const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;

export function entityIdFromName(name) {
  const value = typeof name === "string" ? name.replace(/^LightNode_/, "") : "";
  return ENTITY_ID.test(value) ? value : null;
}

// GLTFLoader sanitizes dots and may suffix duplicate names. Use the original
// glTF node name, not the animation-safe Object3D.name, for entity matching.
export function restoreNodeNames(gltf) {
  gltf.scene.traverse((object) => {
    const index = gltf.parser?.associations?.get(object)?.nodes;
    const name = gltf.parser?.json?.nodes?.[index]?.name;
    object.userData.ha3dNodeName = name ?? object.userData.name ?? object.name;
  });
}

export function indexCandidates(model, config = {}) {
  const candidates = new Map();
  const owners = new Map();
  model?.traverse((object) => {
    const name = object.userData.ha3dNodeName ?? object.name;
    const explicit = config.bindings?.[name];
    const entity = entityIdFromName(explicit) || (config.auto_bind !== false && entityIdFromName(name));
    if (!entity) return;
    if (!candidates.has(entity)) candidates.set(entity, { entity, objects: [], lights: [], metadata: {} });
    const candidate = candidates.get(entity);
    candidate.objects.push(object);
    // Prefer metadata and marker placement on the ordinary device node.
    const physical = name.startsWith("LightNode_") || object.isLight;
    if (!candidate.anchor || (!physical && !candidate.deviceAnchor)) candidate.anchor = object;
    if (!physical) candidate.deviceAnchor = true;
    candidate.metadata = physical
      ? { ...(object.userData.ha3d || {}), ...candidate.metadata }
      : { ...candidate.metadata, ...(object.userData.ha3d || {}) };
    owners.set(object, candidate);
  });
  model?.traverse((light) => {
    if (!light.isLight) return;
    for (let node = light; node; node = node.parent) {
      if (owners.has(node)) {
        const candidate = owners.get(node);
        candidate.lights.push(light);
        light.userData.ha3dCandidate = candidate.entity;
        break;
      }
      if (node === model) break;
    }
  });
  return candidates;
}

export function visualState(entity, state) {
  const value = state?.state;
  const unavailable = !state || value === "unavailable" || value === "unknown";
  const domain = entity.split(".")[0];
  let on = false;
  if (!unavailable) {
    if (domain === "media_player") on = ["on", "playing", "paused", "idle"].includes(value);
    else if (domain === "vacuum") on = ["cleaning", "returning", "spot_cleaning"].includes(value);
    else if (domain === "climate") on = ["heat", "cool", "heat_cool", "auto", "dry", "fan_only"].includes(value);
    else if (domain === "cover") on = ["open", "opening", "closing"].includes(value);
    else if (domain === "lock") on = value === "unlocked";
    else on = value === "on";
  }
  const assumed = state?.attributes?.assumed_state === true;
  const brightness = state?.attributes?.brightness;
  const level = domain === "light" && typeof brightness === "number"
    ? Math.max(0, Math.min(1, brightness / 255)) : 1;
  return { on, unavailable, assumed, level, emits: on && !unavailable && !assumed };
}

export function iconFor(entity, state) {
  const attrs = state?.attributes || {};
  if (typeof attrs.icon === "string" && /^[a-z0-9_-]+:[a-z0-9_-]+$/i.test(attrs.icon)) return attrs.icon;
  const classes = { tv: "television", speaker: "speaker", receiver: "audio-video", outlet: "power-socket-eu", door: "door", window: "window-closed", garage_door: "garage", motion: "motion-sensor", occupancy: "account", temperature: "thermometer" };
  if (classes[attrs.device_class]) return `mdi:${classes[attrs.device_class]}`;
  const domains = { light: "lightbulb", switch: "power-socket-eu", input_boolean: "toggle-switch", media_player: "cast", vacuum: "robot-vacuum", climate: "air-conditioner", cover: "blinds", lock: "lock", fan: "fan", binary_sensor: "checkbox-blank-circle-outline", sensor: "gauge", button: "gesture-tap-button" };
  return `mdi:${domains[entity.split(".")[0]] || "help-circle-outline"}`;
}
