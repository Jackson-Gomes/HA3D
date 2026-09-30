const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const HOLD_MS = 550;
const MOVE_CANCEL_PX = 10;

function isLightEntity(entityId) {
  return typeof entityId === "string" && entityId.startsWith("light.");
}

function bindingForMarker(panel, marker) {
  if (!marker) return null;
  for (const binding of panel?._lightBindings?.values?.() || []) {
    if (binding?.marker === marker && isLightEntity(binding?.entity)) return binding;
  }
  return null;
}

function markerFromEvent(event) {
  const target = event?.target;
  return target?.closest?.(".lightMarker") || null;
}

async function toggleLight(panel, binding) {
  const entityId = binding?.entity;
  if (!isLightEntity(entityId)) return;
  const state = panel?._hass?.states?.[entityId];
  if (!state || state.state === "unavailable" || state.state === "unknown") {
    panel?._setStatus?.(`${binding.name || entityId} indisponível`);
    return;
  }

  try {
    await panel._hass.callService("light", "toggle", { entity_id: entityId });
  } catch (error) {
    console.error("[HA3D] light quick toggle", entityId, error);
    panel?._setStatus?.(`Falha ao alternar ${binding.name || entityId}`);
  }
}

function installDelegatedQuickControl(panel) {
  const root = panel?.shadowRoot;
  if (!root || root.__ha3dLightQuickControlV3) return;
  root.__ha3dLightQuickControlV3 = true;

  let activePointerId = null;
  let activeMarker = null;
  let activeBinding = null;
  let startX = 0;
  let startY = 0;
  let moved = false;
  let holdFired = false;
  let timer = 0;

  const clearTimer = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };

  const reset = () => {
    clearTimer();
    activePointerId = null;
    activeMarker = null;
    activeBinding = null;
    moved = false;
    holdFired = false;
  };

  root.addEventListener("pointerdown", (event) => {
    if (event.button > 0 || !event.isPrimary) return;
    const marker = markerFromEvent(event);
    const binding = bindingForMarker(panel, marker);
    if (!binding) return;

    // Capture the gesture before any marker-level legacy listener can run.
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();

    activePointerId = event.pointerId;
    activeMarker = marker;
    activeBinding = binding;
    startX = event.clientX;
    startY = event.clientY;
    moved = false;
    holdFired = false;
    clearTimer();

    try { marker.setPointerCapture?.(event.pointerId); } catch (_error) {}

    timer = window.setTimeout(() => {
      timer = 0;
      if (activePointerId !== event.pointerId || moved || !activeBinding) return;
      holdFired = true;
      panel._openNativeMoreInfo?.(activeBinding.entity);
    }, HOLD_MS);
  }, true);

  root.addEventListener("pointermove", (event) => {
    if (activePointerId !== event.pointerId || !activeBinding || holdFired) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_CANCEL_PX) {
      moved = true;
      clearTimer();
    }
  }, true);

  root.addEventListener("pointerup", async (event) => {
    if (activePointerId !== event.pointerId || !activeBinding) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    clearTimer();

    const marker = activeMarker;
    const binding = activeBinding;
    const shouldToggle = !holdFired && !moved;

    try { marker?.releasePointerCapture?.(event.pointerId); } catch (_error) {}
    reset();

    if (shouldToggle) await toggleLight(panel, binding);
  }, true);

  root.addEventListener("pointercancel", (event) => {
    if (activePointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    reset();
  }, true);

  // This is the hard stop for the old marker click => more-info behavior.
  // Because it runs on the shadow root during capture, target listeners never see it.
  root.addEventListener("click", (event) => {
    const marker = markerFromEvent(event);
    const binding = bindingForMarker(panel, marker);
    if (!binding) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
  }, true);

  root.addEventListener("contextmenu", (event) => {
    const marker = markerFromEvent(event);
    const binding = bindingForMarker(panel, marker);
    if (!binding) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
  }, true);
}

function annotateLightMarkers(panel) {
  for (const binding of panel?._lightBindings?.values?.() || []) {
    if (!isLightEntity(binding?.entity) || !binding?.marker) continue;
    binding.marker.dataset.ha3dLightQuickControl = "3";
    binding.marker.style.touchAction = "manipulation";
    binding.marker.setAttribute(
      "aria-label",
      `${binding.name || binding.entity}: toque para ligar/desligar; segure para abrir controles`,
    );
  }
}

function installAll(panel) {
  installDelegatedQuickControl(panel);
  annotateLightMarkers(panel);
}

if (!proto.__ha3dLightMarkerQuickControlV3) {
  proto.__ha3dLightMarkerQuickControlV3 = true;

  const originalRenderShell = proto._renderShell;
  proto._renderShell = function (...args) {
    const result = originalRenderShell?.apply(this, args);
    installAll(this);
    return result;
  };

  const originalMakeLightMarker = proto._makeLightMarker;
  proto._makeLightMarker = function (...args) {
    const binding = originalMakeLightMarker.apply(this, args);
    installAll(this);
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
