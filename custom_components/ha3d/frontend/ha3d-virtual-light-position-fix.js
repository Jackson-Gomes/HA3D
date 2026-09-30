import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

function selectedLightRuntime(panel) {
  const id = panel?._selectedObject?.userData?.ha3dVirtualLightId;
  return id ? panel?._ha3dVirtualLights?.get?.(id) || null : null;
}

function alignLightPivot(panel, runtime = selectedLightRuntime(panel)) {
  const handle = runtime?.handle;
  const pivot = panel?._ha3dTransformPivot;
  if (!handle || !pivot || !panel?._editorMode) return;

  handle.updateMatrixWorld(true);
  const worldPosition = handle.getWorldPosition(new THREE.Vector3());
  if (pivot.parent) {
    pivot.parent.updateMatrixWorld(true);
    pivot.position.copy(pivot.parent.worldToLocal(worldPosition.clone()));
  } else {
    pivot.position.copy(worldPosition);
  }
  pivot.quaternion.identity();
  pivot.scale.set(1, 1, 1);
  pivot.updateMatrixWorld(true);

  panel._ha3dTransformTarget = handle;
  panel._transformControls?.attach?.(pivot);
  if (panel._transformControls) {
    panel._transformControls.enabled = true;
    panel._transformControls.visible = true;
  }
}

function pickVirtualLight(panel, event) {
  if (!panel?._editorMode || !panel?._ha3dVirtualLightPickables?.length || !panel?._renderer || !panel?._camera) return null;
  const rect = panel._renderer.domElement.getBoundingClientRect();
  panel._pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  panel._raycaster.setFromCamera(panel._pointer, panel._camera);
  const hit = panel._raycaster.intersectObjects(
    panel._ha3dVirtualLightPickables.filter((item) => item?.visible),
    false,
  )[0]?.object;
  return hit?.userData?.ha3dVirtualLightHandle || null;
}

if (!proto.__ha3dVirtualLightPositionFixV1) {
  proto.__ha3dVirtualLightPositionFixV1 = true;

  const oldPickObject = proto._pickObject;
  proto._pickObject = function (event) {
    return pickVirtualLight(this, event) || oldPickObject?.call(this, event) || null;
  };

  const oldSelectForEditor = proto._selectForEditor;
  proto._selectForEditor = function (object) {
    const result = oldSelectForEditor?.call(this, object);
    if (selectedLightRuntime(this)) queueMicrotask(() => alignLightPivot(this));
    return result;
  };

  const oldRenderEditorForm = proto._renderEditorForm;
  proto._renderEditorForm = async function (...args) {
    const result = await oldRenderEditorForm?.apply(this, args);
    if (selectedLightRuntime(this)) queueMicrotask(() => alignLightPivot(this));
    return result;
  };

  const oldToggleEditor = proto._toggleEditor;
  proto._toggleEditor = function (...args) {
    const result = oldToggleEditor?.apply(this, args);
    if (this._editorMode && selectedLightRuntime(this)) queueMicrotask(() => alignLightPivot(this));
    return result;
  };
}
