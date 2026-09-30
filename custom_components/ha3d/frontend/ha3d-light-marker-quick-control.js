const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const HOLD_MS = 550;
const MOVE_CANCEL_PX = 10;
const SUPPRESS_CLICK_MS = 900;

function isLightEntity(entityId) {
  return typeof entityId === "string" && entityId.startsWith("light.");
}

function installLightMarkerQuickControl(panel, binding) {
  const marker = binding?.marker;
  const entityId = binding?.entity;
  if (!marker || !isLightEntity(entityId) || marker.dataset.ha3dLightQuickControl === "1") return;

  marker.dataset.ha3dLightQuickControl = "1";
  marker.style.touchAction = "manipulation";

  let timer = 0;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let holdFired = false;
  let suppressClickUntil = 0;

  const clearTimer = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };

  const cancelPress = () => {
    clearTimer();
    pointerId = null;
  };

  const finishPress = () => {
    clearTimer();
    pointerId = null;
  };

  marker.addEventListener("pointerdown", (event) => {
    if (event.button > 0 || !event.isPrimary) return;

    holdFired = false;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    clearTimer();

    try { marker.setPointerCapture?.(event.pointerId); } catch (_error) {}

    timer = window.setTimeout(() => {
      timer = 0;
      if (pointerId !== event.pointerId) return;
      holdFired = true;
      suppressClickUntil = performance.now() + SUPPRESS_CLICK_MS;
      panel._openNativeMoreInfo?.(entityId);
    }, HOLD_MS);
  });

  marker.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId || holdFired) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_CANCEL_PX) cancelPress();
  });

  marker.addEventListener("pointerup", (event) => {
    if (pointerId !== event.pointerId) return;
    finishPress();
    try { marker.releasePointerCapture?.(event.pointerId); } catch (_error) {}
  });

  marker.addEventListener("pointercancel", cancelPress);
  marker.addEventListener("lostpointercapture", () => clearTimer());

  // Prevent iOS/Safari long-press context menu from competing with HA more-info.
  marker.addEventListener("contextmenu", (event) => event.preventDefault());

  // Capture phase intentionally wins over the original marker click handler,
  // which otherwise opens more-info for every click.
  marker.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();

    if (holdFired || performance.now() < suppressClickUntil) {
      holdFired = false;
      return;
    }

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
  }, true);
}

function installAll(panel) {
  for (const binding of panel?._lightBindings?.values?.() || []) {
    installLightMarkerQuickControl(panel, binding);
  }
}

if (!proto.__ha3dLightMarkerQuickControlV1) {
  proto.__ha3dLightMarkerQuickControlV1 = true;

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

  const originalConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = originalConnected?.apply(this, args);
    queueMicrotask(() => installAll(this));
    return result;
  };
}
