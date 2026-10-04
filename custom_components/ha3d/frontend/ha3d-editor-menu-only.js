// Final editor-entry guard.
// Entering object edit mode is allowed only from the explicit Editor button.
// Leaving edit mode remains allowed from any existing UI path.
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

function arm(panel) {
  const button = panel?.shadowRoot?.querySelector("#editorButton");
  if (!button || button.__ha3dEditorMenuOnlyV1) return;
  button.__ha3dEditorMenuOnlyV1 = true;
  button.addEventListener("click", () => {
    panel._ha3dEditorMenuAuthorizationUntil = performance.now() + 500;
  }, true);
}

if (!proto.__ha3dEditorMenuOnlyV1) {
  proto.__ha3dEditorMenuOnlyV1 = true;

  const oldToggleEditor = proto._toggleEditor;
  proto._toggleEditor = function (...args) {
    if (this._editorMode) {
      this._ha3dEditorMenuAuthorizationUntil = 0;
      return oldToggleEditor?.apply(this, args);
    }

    const allowedUntil = Number(this._ha3dEditorMenuAuthorizationUntil || 0);
    this._ha3dEditorMenuAuthorizationUntil = 0;
    if (performance.now() > allowedUntil) return;
    return oldToggleEditor?.apply(this, args);
  };

  const oldConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = oldConnected?.apply(this, args);
    queueMicrotask(() => arm(this));
    requestAnimationFrame(() => arm(this));
    setTimeout(() => arm(this), 250);
    return result;
  };

  const oldWireUi = proto._wireUi;
  proto._wireUi = function (...args) {
    const result = oldWireUi?.apply(this, args);
    queueMicrotask(() => arm(this));
    return result;
  };

  queueMicrotask(() => {
    const walk = (root) => {
      if (!root?.querySelectorAll) return;
      for (const element of root.querySelectorAll("*")) {
        if (element.localName === "ha3d-panel") arm(element);
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    walk(document);
  });
}
