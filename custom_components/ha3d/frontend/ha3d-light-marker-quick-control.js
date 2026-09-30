const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const HOLD_MS = 550;
const MOVE_CANCEL_PX = 10;
const SUPPRESS_CLICK_MS = 900;

function isLightEntity(entityId) {
  return typeof entityId === "string" && entityId.startsWith("light.");
}

function cleanLegacyMarker(panel, binding) {
  const original = binding?.marker;
  const entityId = binding?.entity;
  if (!original || !isLightEntity(entityId)) return original;
  if (original.dataset.ha3dLightQuickControlClean === "2") return original;

  // Clone the marker DOM node to deliberately drop every legacy event listener.
  // The original HA3D marker registered click => more-info unconditionally;
  // trying to stop that listener later proved browser/order dependent on touch.
  const marker = original.cloneNode(true);
  marker.dataset.ha3dLightQuickControlClean = "2";
  original.replaceWith(marker);
  binding.marker = marker;

  // cloneNode does not copy JS properties assigned to HA custom elements.
  // Restore the state object so the native HA icon remains state-aware.
  const stateIcon = marker.querySelector?.("ha-state-icon");
  const stateObj = panel?._hass?.states?.[entityId];
  if (stateIcon && stateObj) stateIcon.stateObj = stateObj;

  return marker;
}

function installLightMarkerQuickControl(panel, binding) {
  const entityId = binding?.entity;
  if (!isLightEntity(entityId)) return;

  const marker = cleanLegacyMarker(panel, binding);
  if (!marker || marker.dataset.ha3dLightQuickControl === "2") return;

  marker.dataset.ha3dLightQuickControl = "2";
  marker.style.touchAction = "manipulation";
  marker.setAttribute("aria-label", `${binding.name || entityId}: toque para ligar/desligar; segure para abrir controles`);

  let timer = 0;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let holdFired = false;
  let moved = false;
  let suppressClickUntil = 0;

  const clearTimer = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };

  const resetPointer = () => {
    clearTimer();
    pointerId = null;
  };

  const toggleLight = async () => {
    const state = panel._hass?.states?.[entityId];
    if (!state || state.state === "unavailable" || state.state === "unknown") {
      panel._setStatus?.(`${binding.name || entityId} indisponível`);
      return;
    }

    try {
      marker.dataset.ha3dQuickPending = "1";
      await panel._hass.callService("light", "toggle", { entity_id: entityId });
    } catch (error) {
      console.error("[HA3D] light quick toggle", entityId, error);
      panel._setStatus?.(`Falha ao alternar ${binding.name || entityId}`);
    } finally {
      delete marker.dataset.ha3dQuickPending;
    }
  };

  marker.addEventListener("pointerdown", (event) => {
    if (event.button > 0 || !event.isPrimary) return;

    event.stopPropagation();
    holdFired = false;
    moved = false;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    clearTimer();

    try { marker.setPointerCapture?.(event.pointerId); } catch (_error) {}

    timer = window.setTimeout(() => {
      timer = 0;
      if (pointerId !== event.pointerId || moved) return;
      holdFired = true;
      suppressClickUntil = performance.now() + SUPPRESS_CLICK_MS;
      panel._openNativeMoreInfo?.(entityId);
    }, HOLD_MS);
  });

  marker.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId || holdFired) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_CANCEL_PX) {
      moved = true;
      clearTimer();
    }
  });

  marker.addEventListener("pointerup", async (event) => {
    if (pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    clearTimer();
    try { marker.releasePointerCapture?.(event.pointerId); } catch (_error) {}
    pointerId = null;

    if (!holdFired && !moved) {
      suppressClickUntil = performance.now() + SUPPRESS_CLICK_MS;
      await toggleLight();
    }
    holdFired = false;
  });

  marker.addEventListener("pointercancel", () => {
    moved = true;
    resetPointer();
  });
  marker.addEventListener("lostpointercapture", () => clearTimer());

  // Never let the browser synthesize a second action from pointer/touch.
  marker.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    if (performance.now() < suppressClickUntil) return;
  }, true);

  marker.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}

function installAll(panel) {
  for (const binding of panel?._lightBindings?.values?.() || []) {
    installLightMarkerQuickControl(panel, binding);
  }
}

if (!proto.__ha3dLightMarkerQuickControlV2) {
  proto.__ha3dLightMarkerQuickControlV2 = true;

  const originalMakeLightMarker = proto._makeLightMarker;
  proto._makeLightMarker = function (...args) {
    const binding = originalMakeLightMarker.apply(this, args);
    installLightMarkerQuickControl(this, binding);
    return binding;
  };

  const originalBindEntityLightMarkers = proto._bindEntityLightMarkers;
  proto._bindEntityLightMarkers = function (...args) {
    const result = originalBindEntityLightMarkers.apply(this, args);
    installAll(this);
    return result;
  };

  const originalSyncLightStates = proto._syncLightStates;
  proto._syncLightStates = function (...args) {
    const result = originalSyncLightStates.apply(this, args);
    installAll(this);
    return result;
  };

  const originalConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = originalConnected?.apply(this, args);
    queueMicrotask(() => installAll(this));
    return result;
  };
}
