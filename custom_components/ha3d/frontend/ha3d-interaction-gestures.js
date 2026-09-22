const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const HOLD_MS = 650;
const MOVE_CANCEL_PX = 10;

function objectKey(object) {
  return String(object?.userData?.ha3dOriginalNodeName || object?.name || "").trim();
}

function isEditorHelper(object) {
  return Boolean(
    object?.userData?.ha3dEditorHelper
    || object?.userData?.ha3dFloatingWidgetId
    || object?.userData?.ha3dVirtualLightId
  );
}

function sameLockedObject(panel, object) {
  const locked = panel?._ha3dEditorLockedObject;
  if (!locked || !object) return !locked;
  if (object === locked) return true;
  if (object.userData?.ha3dLogicalRootObject === locked) return true;
  let node = object.parent;
  while (node) {
    if (node === locked) return true;
    node = node.parent;
  }
  return false;
}

function updateLockBadge(panel) {
  const header = panel?.shadowRoot?.querySelector("#ha3dEditor .ha3dEditorHead");
  if (!header) return;
  let badge = header.querySelector("#ha3dEditorLockBadge");
  if (!panel._editorMode || !panel._ha3dEditorLockedObject) {
    badge?.remove?.();
    return;
  }
  if (!badge) {
    badge = document.createElement("span");
    badge.id = "ha3dEditorLockBadge";
    badge.style.cssText = "font-size:10px;padding:3px 7px;border:1px solid rgba(77,231,255,.4);border-radius:99px;color:#9af4ff;background:rgba(3,35,49,.72);white-space:nowrap";
    header.insertBefore(badge, header.querySelector("button"));
  }
  const name = objectKey(panel._ha3dEditorLockedObject) || "objeto";
  badge.textContent = `🔒 ${name}`;
}

function temporarilyMakeInspectable(panel, object, callback) {
  const key = objectKey(object);
  if (!key) return callback();
  panel._config ||= {};
  const original = Array.isArray(panel._config.floating_widgets) ? panel._config.floating_widgets : [];
  const already = original.some((item) => item?.enabled !== false && item?.anchor === key);
  if (already) return callback();
  const fake = {
    id: `__inspect__${key}`,
    name: "Inspeção",
    type: "text",
    anchor: key,
    text: "",
    enabled: true,
    visibility: "click",
  };
  panel._config.floating_widgets = [...original, fake];
  try {
    return callback();
  } finally {
    panel._config.floating_widgets = original;
  }
}

function installCardGuard(panel) {
  const layer = panel?.shadowRoot?.querySelector("#ha3dFloatingWidgetLayer");
  if (!layer || layer.dataset.ha3dIconOnlyEntities === "1") return;
  layer.dataset.ha3dIconOnlyEntities = "1";
  layer.addEventListener("click", (event) => {
    if (!event.target?.closest?.(".ha3dFloatCard")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

function installLongPress(panel) {
  const canvas = panel?._renderer?.domElement;
  if (!canvas || canvas.dataset.ha3dGestureLock === "1") return;
  canvas.dataset.ha3dGestureLock = "1";

  canvas.addEventListener("pointerdown", (event) => {
    if (panel._editorMode || panel._robotCalibrationMarker || event.button > 0) return;
    const object = panel._pickObject?.(event);
    if (!object || isEditorHelper(object)) return;

    const startX = event.clientX;
    const startY = event.clientY;
    let fired = false;
    let timer = 0;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      timer = 0;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
    const move = (moveEvent) => {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > MOVE_CANCEL_PX) cleanup();
    };
    const release = () => cleanup();

    timer = setTimeout(() => {
      fired = true;
      cleanup();
      panel._ha3dSuppressTapUntil = performance.now() + 700;
      panel._ha3dEditorLockedObject = object;
      if (!panel._editorMode) panel._toggleEditor?.();
      panel._selectForEditor?.(object);
      updateLockBadge(panel);
      const name = objectKey(object) || "objeto";
      panel._setStatus?.(`Editor travado em: ${name}`);
    }, HOLD_MS);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release, { once: true });
    window.addEventListener("pointercancel", release, { once: true });
  });
}

if (!proto.__ha3dInteractionGesturesV1) {
  proto.__ha3dInteractionGesturesV1 = true;

  // Geometry never opens/toggles Home Assistant entities anymore. Entity
  // interaction is intentionally owned by the on-screen HA markers only.
  proto._runEntityAction = async function () {};

  const oldWireUi = proto._wireUi;
  proto._wireUi = function (...args) {
    const result = oldWireUi?.apply(this, args);
    installLongPress(this);
    installCardGuard(this);
    return result;
  };

  const oldConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = oldConnected?.apply(this, args);
    queueMicrotask(() => {
      installLongPress(this);
      installCardGuard(this);
      updateLockBadge(this);
    });
    return result;
  };

  const oldPick = proto._pick;
  proto._pick = function (event) {
    if (this._robotCalibrationMarker) return;

    if (this._editorMode) {
      const object = this._pickObject?.(event);
      if (this._ha3dEditorLockedObject && object && !isEditorHelper(object) && !sameLockedObject(this, object)) return;
      return oldPick?.call(this, event);
    }

    if (performance.now() < (this._ha3dSuppressTapUntil || 0)) return;

    // Single click on geometry is deliberately neutral. A double click is the
    // explicit inspection gesture and reuses the floating-widget inspector.
    if (Number(event?.detail || 0) < 2) return;
    const object = this._pickObject?.(event);
    if (!object) return oldPick?.call(this, event);
    return temporarilyMakeInspectable(this, object, () => oldPick?.call(this, event));
  };

  const oldSelectForEditor = proto._selectForEditor;
  proto._selectForEditor = function (object, ...args) {
    if (
      this._editorMode
      && this._ha3dEditorLockedObject
      && object
      && !isEditorHelper(object)
      && !sameLockedObject(this, object)
    ) {
      this._setStatus?.(`Editor travado em: ${objectKey(this._ha3dEditorLockedObject) || "objeto"}`);
      updateLockBadge(this);
      return this._selectedObject;
    }
    const result = oldSelectForEditor?.call(this, object, ...args);
    updateLockBadge(this);
    return result;
  };

  const oldBeginObjectDrag = proto._beginObjectDrag;
  proto._beginObjectDrag = function (event, object, ...args) {
    if (
      this._editorMode
      && this._ha3dEditorLockedObject
      && object
      && !isEditorHelper(object)
      && !sameLockedObject(this, object)
    ) return;
    return oldBeginObjectDrag?.call(this, event, object, ...args);
  };

  const oldToggleEditor = proto._toggleEditor;
  proto._toggleEditor = function (...args) {
    const wasEditing = Boolean(this._editorMode);
    const result = oldToggleEditor?.apply(this, args);
    if (wasEditing && !this._editorMode) this._ha3dEditorLockedObject = null;
    updateLockBadge(this);
    installCardGuard(this);
    return result;
  };

  const oldLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    this._ha3dEditorLockedObject = null;
    const result = await oldLoadModel?.apply(this, args);
    updateLockBadge(this);
    return result;
  };
}
