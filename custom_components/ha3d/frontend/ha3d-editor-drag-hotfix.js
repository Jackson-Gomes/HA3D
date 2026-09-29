const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const DIRECT_DRAG_CLICK_GUARD_MS = 320;
const STICKY_VIRTUAL_LIGHT_RADIUS_PX = 44;

function ensureTransformHelper(panel) {
  const controls = panel?._transformControls;
  const scene = panel?._scene;
  if (!controls || !scene) return null;

  const helper = controls.getHelper?.() || controls;
  if (helper?.isObject3D && helper.parent !== scene) scene.add(helper);
  if (helper?.isObject3D) helper.visible = Boolean(panel._editorMode && panel._selectedObject);
  return helper;
}

function currentMode(panel) {
  return panel?._transformControls?.getMode?.() || panel?._transformControls?.mode || "translate";
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function isVirtualLight(object) {
  return Boolean(object?.userData?.ha3dVirtualLightId);
}

function pointerNearSelectedVirtualLight(panel, event) {
  const object = panel?._selectedObject;
  const camera = panel?._camera;
  const canvas = panel?._renderer?.domElement;
  if (!isVirtualLight(object) || !camera || !canvas || !object?.position?.clone) return false;

  const point = object.position.clone();
  object.getWorldPosition?.(point);
  point.project?.(camera);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.z < -1 || point.z > 1) return false;

  const rect = canvas.getBoundingClientRect();
  const screenX = rect.left + (point.x * 0.5 + 0.5) * rect.width;
  const screenY = rect.top + (-point.y * 0.5 + 0.5) * rect.height;
  return Math.hypot(event.clientX - screenX, event.clientY - screenY) <= STICKY_VIRTUAL_LIGHT_RADIUS_PX;
}

function guardTrailingCanvasPick(panel) {
  panel._ha3dSuppressModelPickUntil = Math.max(
    panel._ha3dSuppressModelPickUntil || 0,
    nowMs() + DIRECT_DRAG_CLICK_GUARD_MS,
  );
}

if (!proto.__ha3dEditorDragHotfixV2) {
  proto.__ha3dEditorDragHotfixV2 = true;

  const oldInitViewer = proto._initViewer;
  proto._initViewer = function (...args) {
    const result = oldInitViewer?.apply(this, args);
    queueMicrotask(() => ensureTransformHelper(this));
    return result;
  };

  const oldLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await oldLoadModel?.apply(this, args);
    queueMicrotask(() => ensureTransformHelper(this));
    return result;
  };

  const oldSelectForEditor = proto._selectForEditor;
  proto._selectForEditor = function (object) {
    const result = oldSelectForEditor?.call(this, object);
    const helper = ensureTransformHelper(this);
    if (object && this._transformControls) {
      this._transformControls.attach?.(object);
      this._transformControls.enabled = true;
      this._transformControls.visible = true;
      if (helper?.isObject3D) helper.visible = true;
    }
    return result;
  };

  const oldToggleEditor = proto._toggleEditor;
  proto._toggleEditor = function (...args) {
    const result = oldToggleEditor?.apply(this, args);
    const helper = ensureTransformHelper(this);
    if (!this._editorMode) {
      this._transformControls?.detach?.();
      if (this._transformControls) {
        this._transformControls.enabled = false;
        this._transformControls.visible = false;
      }
      if (helper?.isObject3D) helper.visible = false;
      if (this._controls) this._controls.enabled = true;
    }
    return result;
  };

  const oldBeginObjectDrag = proto._beginObjectDrag;
  proto._beginObjectDrag = function (event, object) {
    if (!object || !this._editorMode) return;

    const orbitWasEnabled = this._controls?.enabled !== false;
    if (this._controls) this._controls.enabled = false;
    this._ha3dEditorDirectDrag = true;

    const restore = () => {
      window.removeEventListener("pointerup", restore, true);
      window.removeEventListener("pointercancel", restore, true);
      this._ha3dEditorDirectDrag = false;
      guardTrailingCanvasPick(this);
      if (this._controls && !this._transformControls?.dragging) {
        this._controls.enabled = orbitWasEnabled;
      }
    };

    window.addEventListener("pointerup", restore, true);
    window.addEventListener("pointercancel", restore, true);

    return oldBeginObjectDrag?.call(this, event, object);
  };

  const oldWireUi = proto._wireUi;
  proto._wireUi = function (...args) {
    const result = oldWireUi?.apply(this, args);
    const canvas = this._renderer?.domElement;
    if (!canvas || canvas.__ha3dEditorDirectDragV2) return result;
    canvas.__ha3dEditorDirectDragV2 = true;

    canvas.addEventListener("pointerdown", (event) => {
      if (!this._editorMode || event.button !== 0 || this._robotCalibrationMarker) return;

      // TransformControls owns axis-constrained drags. Never repick through the gizmo.
      if (this._transformControls?.axis || this._transformControls?.dragging || this._ha3dGizmoPointerActive) return;
      if (currentMode(this) !== "translate") return;

      const selected = this._selectedObject || null;
      const picked = this._pickObject?.(event) || null;
      let object = picked;

      // Virtual-light helpers are visually small. If the pointer is still close to the
      // selected light, keep that light locked instead of falling through to geometry behind it.
      if (isVirtualLight(selected) && !isVirtualLight(picked) && pointerNearSelectedVirtualLight(this, event)) {
        object = selected;
      }
      if (!object) return;

      this._selectForEditor?.(object);

      // object-root replaces _beginObjectDrag after this module is loaded, so install the
      // click guard here as well. It prevents the trailing browser click from selecting the
      // object now exposed behind the item that was just moved.
      const finishDirectDrag = () => guardTrailingCanvasPick(this);
      window.addEventListener("pointerup", finishDirectDrag, { capture: true, once: true });
      window.addEventListener("pointercancel", finishDirectDrag, { capture: true, once: true });

      this._beginObjectDrag?.(event, object);
      event.preventDefault();
    });

    return result;
  };

  queueMicrotask(() => {
    const walk = (root) => {
      if (!root?.querySelectorAll) return;
      for (const el of root.querySelectorAll("*")) {
        if (el.localName === "ha3d-panel") ensureTransformHelper(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
  });
}
