const LIGHT_ON_DELAY_MS = 450;
const START_POLL_MS = 40;
const START_TIMEOUT_MS = 6000;

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function ensureDelayState(panel) {
  if (!panel._ha3dCinematicLightDelayPending) panel._ha3dCinematicLightDelayPending = new Set();
  if (!panel._ha3dCinematicLightDelayHold) panel._ha3dCinematicLightDelayHold = new Set();
  if (!panel._ha3dCinematicLightDelayTimers) panel._ha3dCinematicLightDelayTimers = new Map();
}

function isLightEntity(entity) {
  return String(entity || "").startsWith("light.");
}

function currentState(panel, entity) {
  return panel._hass?.states?.[entity]?.state;
}

function bindingLights(binding) {
  if (Array.isArray(binding?.lights) && binding.lights.length) return binding.lights;
  return binding?.light ? [binding.light] : [];
}

function suppressVisualLight(panel, entity) {
  const binding = panel._lightBindings?.get?.(entity);
  if (!binding) return;
  for (const light of bindingLights(binding)) {
    light.intensity = 0;
    light.castShadow = false;
  }
}

function clearEntityTimer(panel, entity) {
  const timer = panel._ha3dCinematicLightDelayTimers?.get?.(entity);
  if (timer) clearTimeout(timer);
  panel._ha3dCinematicLightDelayTimers?.delete?.(entity);
}

function releaseVisualLight(panel, entity) {
  ensureDelayState(panel);
  clearEntityTimer(panel, entity);
  panel._ha3dCinematicLightDelayPending.delete(entity);
  panel._ha3dCinematicLightDelayHold.delete(entity);
  panel._syncLightStates?.();
}

function waitForCinematicStart(panel, entity) {
  ensureDelayState(panel);
  clearEntityTimer(panel, entity);
  const started = Date.now();

  const poll = () => {
    if (
      !panel.isConnected ||
      !panel._cinematicEnabled ||
      currentState(panel, entity) !== "on"
    ) {
      releaseVisualLight(panel, entity);
      return;
    }

    if (panel._cinematicActive && !panel._ha3dCinematicPrepActive) {
      const timer = setTimeout(() => releaseVisualLight(panel, entity), LIGHT_ON_DELAY_MS);
      panel._ha3dCinematicLightDelayTimers.set(entity, timer);
      return;
    }

    if (Date.now() - started >= START_TIMEOUT_MS) {
      releaseVisualLight(panel, entity);
      return;
    }

    const timer = setTimeout(poll, START_POLL_MS);
    panel._ha3dCinematicLightDelayTimers.set(entity, timer);
  };

  poll();
}

if (!proto.__ha3dCinematicLightDelayV1) {
  proto.__ha3dCinematicLightDelayV1 = true;

  const originalQueue = proto._queueCinematicFocus;
  proto._queueCinematicFocus = function (entity, ...args) {
    ensureDelayState(this);

    if (isLightEntity(entity)) {
      if (this._cinematicEnabled && currentState(this, entity) === "on") {
        this._ha3dCinematicLightDelayPending.add(entity);
      } else {
        clearEntityTimer(this, entity);
        this._ha3dCinematicLightDelayPending.delete(entity);
        this._ha3dCinematicLightDelayHold.delete(entity);
      }
    }

    return originalQueue?.call(this, entity, ...args);
  };

  const originalSync = proto._syncLightStates;
  proto._syncLightStates = function (...args) {
    ensureDelayState(this);
    const result = originalSync?.apply(this, args);

    for (const entity of this._ha3dCinematicLightDelayPending) {
      if (currentState(this, entity) === "on") suppressVisualLight(this, entity);
    }
    for (const entity of this._ha3dCinematicLightDelayHold) {
      if (currentState(this, entity) === "on") suppressVisualLight(this, entity);
    }

    return result;
  };

  const originalRun = proto._runCinematicFocus;
  proto._runCinematicFocus = function (entities, ...args) {
    ensureDelayState(this);
    const list = Array.isArray(entities) ? entities : [];

    for (const entity of list) {
      if (
        isLightEntity(entity) &&
        this._ha3dCinematicLightDelayPending.has(entity) &&
        currentState(this, entity) === "on"
      ) {
        this._ha3dCinematicLightDelayPending.delete(entity);
        this._ha3dCinematicLightDelayHold.add(entity);
        suppressVisualLight(this, entity);
        waitForCinematicStart(this, entity);
      }
    }

    return originalRun?.call(this, entities, ...args);
  };

  const originalDisconnected = proto.disconnectedCallback;
  proto.disconnectedCallback = function (...args) {
    ensureDelayState(this);
    for (const timer of this._ha3dCinematicLightDelayTimers.values()) clearTimeout(timer);
    this._ha3dCinematicLightDelayTimers.clear();
    this._ha3dCinematicLightDelayPending.clear();
    this._ha3dCinematicLightDelayHold.clear();
    return originalDisconnected?.apply(this, args);
  };
}
