const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function rootFor(panel) {
  return panel?.shadowRoot?.querySelector("#root") || null;
}

function visibleModeBlocksZones(panel) {
  if (panel?._editorMode) return true;
  const root = rootFor(panel);
  if (!root) return false;

  if (root.classList.contains("ha3d-idle-xray")) return true;

  if (root.classList.contains("ha3d-cinematic-active")) {
    const startedAt = Number(panel?.__ha3dZoneCinematicStartedAt || 0);
    const staleByTime = startedAt > 0 && performance.now() - startedAt > 10000;

    if ((!panel?._cinematicActive && !panel?._ha3dCinematicPrepActive) || staleByTime) {
      panel._cinematicActive = false;
      panel._cameraAnimating = false;
      if (panel._controls) panel._controls.enabled = true;
      root.classList.remove("ha3d-cinematic-active");
      panel.__ha3dZoneCinematicStartedAt = 0;
      scheduleRecovery(panel);
      return false;
    }
    return true;
  }

  return false;
}

function recoverZones(panel) {
  if (!panel?.isConnected) return;

  const root = rootFor(panel);
  if (
    root?.classList.contains("ha3d-cinematic-active") &&
    !panel._cinematicActive &&
    !panel._ha3dCinematicPrepActive
  ) {
    root.classList.remove("ha3d-cinematic-active");
  }

  install(panel);
  panel._ha3dRebuildViewZones?.();
}

function scheduleRecovery(panel) {
  queueMicrotask(() => recoverZones(panel));
  requestAnimationFrame(() => recoverZones(panel));
  setTimeout(() => recoverZones(panel), 80);
  setTimeout(() => recoverZones(panel), 260);
}

function isUiTarget(target) {
  if (!target?.closest) return false;
  return Boolean(target.closest(
    "button,input,label,select,textarea,a,#topbar,#viewsPanel,#markers,#markerFilterBar,#scenePrefixMenu,#customViewsDrawer,.ha3dFloatCard",
  ));
}

function zoneHitForEvent(panel, event) {
  const canvas = panel?._renderer?.domElement;
  const meshes = [...(panel?._ha3dBottomViewZones?.values?.() || [])];
  if (
    !canvas ||
    !meshes.length ||
    !panel?._camera ||
    !panel?._raycaster ||
    !panel?._pointer
  ) return null;

  const rect = canvas.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  ) return null;

  panel._pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  panel._raycaster.setFromCamera(panel._pointer, panel._camera);

  const zoneHit = panel._raycaster.intersectObjects(meshes, false)[0];
  if (!zoneHit) return null;

  const sceneScale = Math.max(0.001, Number(panel._modelScale) || 10);
  const modelHit = panel._model
    ? panel._raycaster
        .intersectObject(panel._model, true)
        .find((hit) => !hit.object?.userData?.ha3dEditorHelper)
    : null;
  if (modelHit && modelHit.distance + sceneScale * 0.004 < zoneHit.distance) return null;

  return zoneHit;
}

function animateZoneView(panel, view, duration = 900) {
  if (
    !view?.position ||
    !view?.target ||
    !panel?._camera ||
    !panel?._controls ||
    visibleModeBlocksZones(panel)
  ) return false;

  const token = (panel.__ha3dZoneCameraToken || 0) + 1;
  panel.__ha3dZoneCameraToken = token;

  const startPos = panel._camera.position.clone();
  const startTarget = panel._controls.target.clone();
  const startUp = panel._camera.up.clone();
  const targetPos = panel._camera.position.clone().fromArray(view.position);
  const targetTarget = panel._controls.target.clone().fromArray(view.target);
  const targetUp = panel._camera.up.clone().fromArray(view.up || [0, 1, 0]);

  const started = performance.now();
  const oldDamping = panel._controls.enableDamping;
  const ease = (t) => {
    const x = Math.max(0, Math.min(1, t));
    return x * x * x * (x * (x * 6 - 15) + 10);
  };

  // The floor shortcut owns this camera transition. A stale Cinematic flag
  // must not prevent a valid zone tap after the visual mode has already ended.
  panel._cameraAnimating = true;
  panel._controls.enabled = false;
  panel._controls.enableDamping = false;

  const finish = () => {
    if (panel.__ha3dZoneCameraToken !== token) return;
    panel._camera.position.copy(targetPos);
    panel._controls.target.copy(targetTarget);
    panel._camera.up.copy(targetUp);
    panel._camera.lookAt(panel._controls.target);
    panel._controls.enabled = true;
    panel._controls.enableDamping = oldDamping;
    panel._cameraAnimating = false;
    panel._controls.update();
  };

  const frame = (now) => {
    if (panel.__ha3dZoneCameraToken !== token || !panel.isConnected) return;

    // A newly started visible Cinematic/Idle mode owns the camera again.
    if (visibleModeBlocksZones(panel)) {
      panel._controls.enabled = true;
      panel._controls.enableDamping = oldDamping;
      panel._cameraAnimating = false;
      return;
    }

    const t = Math.min(1, (now - started) / duration);
    const u = ease(t);
    panel._camera.position.lerpVectors(startPos, targetPos, u);
    panel._controls.target.lerpVectors(startTarget, targetTarget, u);
    panel._camera.up.lerpVectors(startUp, targetUp, u).normalize();
    panel._camera.lookAt(panel._controls.target);

    if (t < 1) requestAnimationFrame(frame);
    else finish();
  };

  requestAnimationFrame(frame);
  return true;
}

function activateZone(panel, id) {
  const saved = (panel._customViews || []).find((item) => String(item.id) === String(id));
  if (!saved?.view) return false;

  // If Cinematic left internal flags behind, clear only those invisible
  // leftovers. Visible Cinematic/Idle states are blocked above.
  const root = rootFor(panel);
  if (!root?.classList.contains("ha3d-cinematic-active")) {
    panel._cinematicActive = false;
    if (!panel._ha3dCinematicPrepPromise) panel._ha3dCinematicPrepActive = false;
  }
  if (!root?.classList.contains("ha3d-idle-xray")) {
    panel._ha3dIdleActive = false;
    panel._ha3dIdleExitSequence = false;
  }

  return animateZoneView(panel, saved.view);
}

function beginZonePointer(panel, event, zoneHit) {
  const id = zoneHit?.object?.userData?.ha3dViewZoneId;
  if (!id) return false;

  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;

  event.preventDefault();
  event.stopImmediatePropagation();

  const finish = (upEvent) => {
    if (upEvent.pointerId !== pointerId) return;
    window.removeEventListener("pointerup", finish, true);
    window.removeEventListener("pointercancel", finish, true);
    if (Math.hypot(upEvent.clientX - startX, upEvent.clientY - startY) > 10) return;
    if (visibleModeBlocksZones(panel)) return;
    activateZone(panel, id);
  };

  window.addEventListener("pointerup", finish, true);
  window.addEventListener("pointercancel", finish, true);
  return true;
}

function installRootFallback(panel) {
  const root = rootFor(panel);
  if (!root || root.__ha3dViewZoneRootFallbackV3) return;
  root.__ha3dViewZoneRootFallbackV3 = true;

  root.addEventListener("pointerdown", (event) => {
    if (isUiTarget(event.target) || visibleModeBlocksZones(panel)) return;
    const zoneHit = zoneHitForEvent(panel, event);
    if (!zoneHit) return;
    beginZonePointer(panel, event, zoneHit);
  }, true);
}

function installCanvasFallback(panel) {
  const canvas = panel?._renderer?.domElement;
  if (!canvas || canvas.__ha3dViewZoneCanvasFallbackV3) return;
  canvas.__ha3dViewZoneCanvasFallbackV3 = true;

  canvas.addEventListener("pointerdown", (event) => {
    if (visibleModeBlocksZones(panel)) return;
    const zoneHit = zoneHitForEvent(panel, event);
    if (!zoneHit) return;
    beginZonePointer(panel, event, zoneHit);
  }, true);
}

function install(panel) {
  installRootFallback(panel);
  installCanvasFallback(panel);
}

if (!proto.__ha3dViewZoneXrayFixV3) {
  proto.__ha3dViewZoneXrayFixV3 = true;

  const oldConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = oldConnected?.apply(this, args);
    queueMicrotask(() => install(this));
    requestAnimationFrame(() => install(this));
    setTimeout(() => install(this), 250);
    return result;
  };

  const oldLoad = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await oldLoad?.apply(this, args);
    install(this);
    return result;
  };

  const oldRestore = proto._restoreCinematicUi;
  proto._restoreCinematicUi = function (...args) {
    const result = oldRestore?.apply(this, args);
    this.__ha3dZoneCinematicStartedAt = 0;
    scheduleRecovery(this);
    return result;
  };

  const oldSetFocus = proto._setCinematicMarkerFocus;
  proto._setCinematicMarkerFocus = function (...args) {
    const result = oldSetFocus?.apply(this, args);
    this.__ha3dZoneCinematicStartedAt = performance.now();
    const root = rootFor(this);
    if (root && !root.__ha3dViewZoneCinematicObserverV3) {
      const observer = new MutationObserver(() => {
        if (!root.classList.contains("ha3d-cinematic-active")) scheduleRecovery(this);
      });
      observer.observe(root, { attributes: true, attributeFilter: ["class"] });
      root.__ha3dViewZoneCinematicObserverV3 = observer;
    }
    return result;
  };
}
