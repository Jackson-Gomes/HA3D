const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const RELEASE_GUARD_MS = 360;
const VIRTUAL_LIGHT_STICKY_RADIUS_PX = 76;

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function isVirtualLight(object) {
  return Boolean(object?.userData?.ha3dVirtualLightId);
}

function pointerNearObject(panel, event, object, radiusPx) {
  const camera = panel?._camera;
  const canvas = panel?._renderer?.domElement;
  if (!camera || !canvas || !object?.position?.clone || !event) return false;

  const point = object.position.clone();
  object.getWorldPosition?.(point);
  point.project?.(camera);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.z < -1 || point.z > 1) return false;

  const rect = canvas.getBoundingClientRect();
  const screenX = rect.left + (point.x * 0.5 + 0.5) * rect.width;
  const screenY = rect.top + (-point.y * 0.5 + 0.5) * rect.height;
  return Math.hypot(event.clientX - screenX, event.clientY - screenY) <= radiusPx;
}

function controlsOwnPointer(panel) {
  const controls = panel?._transformControls;
  return Boolean(
    controls?.dragging
    || controls?.axis
    || panel?._ha3dGizmoPointerActive
    || panel?._ha3dEditorDirectDrag
  );
}

function lockSelection(panel, object = panel?._selectedObject) {
  if (!panel?._editorMode || !object) return;
  panel._ha3dSelectionLockActive = true;
  panel._ha3dSelectionLockObject = object;
}

function releaseSelectionLater(panel) {
  panel._ha3dSelectionReleaseGuardUntil = nowMs() + RELEASE_GUARD_MS;
  const object = panel._ha3dSelectionLockObject || panel._selectedObject || null;
  globalThis.setTimeout(() => {
    if (panel._ha3dSelectionLockObject !== object) return;
    panel._ha3dSelectionLockActive = false;
    panel._ha3dSelectionLockObject = null;
  }, RELEASE_GUARD_MS);
}

function selectionOwnsPointer(panel, event) {
  const selected = panel?._selectedObject;
  if (!panel?._editorMode || !selected) return false;
  if (panel._ha3dSelectionLockActive && panel._ha3dSelectionLockObject === selected) return true;
  if (controlsOwnPointer(panel)) return true;
  return isVirtualLight(selected) && pointerNearObject(panel, event, selected, VIRTUAL_LIGHT_STICKY_RADIUS_PX);
}

function installTransformLock(panel) {
  const controls = panel?._transformControls;
  if (!controls || controls.userData?.ha3dSelectionLockV1) return;
  controls.userData ||= {};
  controls.userData.ha3dSelectionLockV1 = true;

  controls.addEventListener("mouseDown", () => lockSelection(panel));
  controls.addEventListener("dragging-changed", (event) => {
    if (event.value) lockSelection(panel);
    else releaseSelectionLater(panel);
  });
  controls.addEventListener("mouseUp", () => releaseSelectionLater(panel));
}

if (!proto.__ha3dEditorSelectionLockV1) {
  proto.__ha3dEditorSelectionLockV1 = true;

  const oldInitViewer = proto._initViewer;
  proto._initViewer = function (...args) {
    const result = oldInitViewer?.apply(this, args);
    queueMicrotask(() => installTransformLock(this));
    return result;
  };

  const oldSelectForEditor = proto._selectForEditor;
  proto._selectForEditor = function (object) {
    if (
      this._ha3dSelectionLockActive
      && this._ha3dSelectionLockObject
      && object
      && object !== this._ha3dSelectionLockObject
    ) {
      return;
    }
    const result = oldSelectForEditor?.call(this, object);
    installTransformLock(this);
    return result;
  };

  const oldPickObject = proto._pickObject;
  proto._pickObject = function (event) {
    const selected = this._selectedObject || null;
    if (selected && selectionOwnsPointer(this, event)) return selected;
    if (selected && nowMs() < (this._ha3dSelectionReleaseGuardUntil || 0)) return selected;
    return oldPickObject?.call(this, event) || null;
  };

  const oldBeginObjectDrag = proto._beginObjectDrag;
  proto._beginObjectDrag = function (event, object) {
    const target = this._selectedObject || object || null;
    if (target) lockSelection(this, target);

    const release = () => releaseSelectionLater(this);
    window.addEventListener("pointerup", release, { capture: true, once: true });
    window.addEventListener("pointercancel", release, { capture: true, once: true });
    return oldBeginObjectDrag?.call(this, event, target || object);
  };

  const oldPick = proto._pick;
  proto._pick = function (event) {
    if (nowMs() < (this._ha3dSelectionReleaseGuardUntil || 0)) return;
    if (this._ha3dSelectionLockActive) return;
    return oldPick?.call(this, event);
  };

  const oldSelectVirtualLight = proto._selectVirtualLight;
  if (oldSelectVirtualLight) {
    proto._selectVirtualLight = function (id) {
      const result = oldSelectVirtualLight.call(this, id);
      installTransformLock(this);
      const selected = this._selectedObject;
      if (isVirtualLight(selected)) {
        this._ha3dSelectionReleaseGuardUntil = nowMs() + 120;
      }
      return result;
    };
  }
}
