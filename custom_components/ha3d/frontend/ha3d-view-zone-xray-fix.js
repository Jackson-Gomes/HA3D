const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function visuallyBlocked(panel) {
  const root = panel?.shadowRoot?.querySelector("#root");
  if (panel?._editorMode) return true;
  if (panel?._ha3dIdleActive || panel?._ha3dIdleExitSequence || panel?._ha3dCinematicPrepActive) return true;
  if (root?.classList.contains("ha3d-idle-xray")) return true;
  if (root?.classList.contains("ha3d-cinematic-active")) return true;

  // A real camera animation normally disables OrbitControls. If the internal
  // _cameraAnimating flag is stale after X-Ray/Cinematic but controls are back
  // on, do not let that stale flag kill the floor shortcuts.
  if (panel?._cameraAnimating && panel?._controls?.enabled === false) return true;
  return false;
}

function install(panel) {
  const canvas = panel?._renderer?.domElement;
  if (!canvas || canvas.__ha3dViewZoneXrayFix) return;
  canvas.__ha3dViewZoneXrayFix = true;

  canvas.addEventListener("pointerdown", (event) => {
    if (visuallyBlocked(panel)) return;

    const meshes = [...(panel?._ha3dBottomViewZones?.values?.() || [])];
    if (!meshes.length || !panel?._camera || !panel?._raycaster || !panel?._pointer) return;

    const rect = canvas.getBoundingClientRect();
    panel._pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    panel._raycaster.setFromCamera(panel._pointer, panel._camera);

    const zoneHit = panel._raycaster.intersectObjects(meshes, false)[0];
    if (!zoneHit) return;

    const sceneScale = Math.max(0.001, Number(panel._modelScale) || 10);
    const modelHit = panel._model
      ? panel._raycaster
          .intersectObject(panel._model, true)
          .find((hit) => !hit.object?.userData?.ha3dEditorHelper)
      : null;
    if (modelHit && modelHit.distance + sceneScale * 0.004 < zoneHit.distance) return;

    const id = zoneHit.object?.userData?.ha3dViewZoneId;
    if (!id) return;

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
      if (visuallyBlocked(panel)) return;
      const view = (panel._customViews || []).find((item) => String(item.id) === String(id));
      if (view?.view) panel._animateCameraTo?.(view.view);
    };

    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
  }, true);
}

if (!proto.__ha3dViewZoneXrayFixV1) {
  proto.__ha3dViewZoneXrayFixV1 = true;

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
    queueMicrotask(() => install(this));
    return result;
  };
}
