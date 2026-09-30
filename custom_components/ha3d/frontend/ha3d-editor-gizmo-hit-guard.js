const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const GUARD_MS = 320;

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function pointerNdc(panel, event) {
  const canvas = panel?._renderer?.domElement;
  if (!canvas || !event) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
  };
}

function transformPicker(panel) {
  const controls = panel?._transformControls;
  if (!controls || !controls.object || controls.visible === false || controls.enabled === false) return null;
  const helper = controls.getHelper?.();
  const gizmo = helper?.children?.find?.((child) => child?.isTransformControlsGizmo)
    || helper?.children?.find?.((child) => child?.picker);
  const mode = controls.getMode?.() || controls.mode || "translate";
  return gizmo?.picker?.[mode] || null;
}

function pointerHitsGizmo(panel, event) {
  if (!panel?._editorMode) return false;
  const controls = panel?._transformControls;
  if (!controls?.object || controls.visible === false || controls.enabled === false) return false;

  if (controls.dragging || panel._ha3dGizmoPointerActive) return true;
  if (controls.axis) return true;

  const ndc = pointerNdc(panel, event);
  const picker = transformPicker(panel);
  const camera = panel?._camera;
  if (!ndc || !picker || !camera) return false;

  try {
    const raycaster = controls.getRaycaster?.() || panel._raycaster;
    if (!raycaster) return false;
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObject(picker, true).length > 0;
  } catch (error) {
    console.warn("[HA3D] gizmo hit-test failed", error);
    return false;
  }
}

function armGuard(panel) {
  panel._ha3dSuppressModelPickUntil = Math.max(
    Number(panel._ha3dSuppressModelPickUntil || 0),
    nowMs() + GUARD_MS,
  );
  panel._ha3dGizmoHardGuardUntil = nowMs() + GUARD_MS;
}

function shouldBlockScenePick(panel, event) {
  if (!panel?._editorMode) return false;
  if (nowMs() < Number(panel._ha3dGizmoHardGuardUntil || 0)) return true;
  if (pointerHitsGizmo(panel, event)) {
    armGuard(panel);
    return true;
  }
  return false;
}

function installControlEvents(panel) {
  const controls = panel?._transformControls;
  if (!controls || controls.userData?.ha3dHardGizmoGuardV1) return;
  controls.userData ||= {};
  controls.userData.ha3dHardGizmoGuardV1 = true;

  controls.addEventListener("mouseDown", () => {
    panel._ha3dGizmoPointerActive = true;
    armGuard(panel);
  });
  controls.addEventListener("dragging-changed", (event) => {
    panel._ha3dGizmoPointerActive = Boolean(event.value);
    armGuard(panel);
  });
  controls.addEventListener("mouseUp", () => {
    panel._ha3dGizmoPointerActive = false;
    armGuard(panel);
  });
}

if (!proto.__ha3dEditorGizmoHitGuardV1) {
  proto.__ha3dEditorGizmoHitGuardV1 = true;

  const oldInitViewer = proto._initViewer;
  proto._initViewer = function (...args) {
    const result = oldInitViewer?.apply(this, args);
    queueMicrotask(() => installControlEvents(this));
    return result;
  };

  const oldSelectForEditor = proto._selectForEditor;
  proto._selectForEditor = function (...args) {
    const result = oldSelectForEditor?.apply(this, args);
    installControlEvents(this);
    return result;
  };

  const oldPickObject = proto._pickObject;
  proto._pickObject = function (event) {
    if (shouldBlockScenePick(this, event)) return null;
    return oldPickObject?.call(this, event) || null;
  };

  const oldPick = proto._pick;
  proto._pick = function (event) {
    if (shouldBlockScenePick(this, event)) return;
    return oldPick?.call(this, event);
  };

  const oldBeginObjectDrag = proto._beginObjectDrag;
  proto._beginObjectDrag = function (event, object) {
    if (shouldBlockScenePick(this, event)) return;
    return oldBeginObjectDrag?.call(this, event, object);
  };
}
