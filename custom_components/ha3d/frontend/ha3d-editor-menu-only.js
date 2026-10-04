// Final editor-entry guard for LightMedia beta12.
// Geometry never opens edit mode. Entering edit mode requires the explicit Editor button.
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

function armEditorButton(panel) {
  const button = panel?.shadowRoot?.querySelector("#editorButton");
  if (!button || button.__ha3dMenuOnlyEditorBeta12) return;
  button.__ha3dMenuOnlyEditorBeta12 = true;
  button.addEventListener("click", () => {
    panel._ha3dEditorMenuAuthorizationUntil = performance.now() + 500;
  }, true);
}

if (!proto.__ha3dMenuOnlyEditorBeta12) {
  proto.__ha3dMenuOnlyEditorBeta12 = true;

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

  const oldWireUi = proto._wireUi;
  proto._wireUi = function (...args) {
    const result = oldWireUi?.apply(this, args);
    queueMicrotask(() => armEditorButton(this));
    return result;
  };

  const oldConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = oldConnected?.apply(this, args);
    queueMicrotask(() => armEditorButton(this));
    requestAnimationFrame(() => armEditorButton(this));
    setTimeout(() => armEditorButton(this), 250);
    return result;
  };

  queueMicrotask(() => {
    const walk = (root) => {
      if (!root?.querySelectorAll) return;
      for (const element of root.querySelectorAll("*")) {
        if (element.localName === "ha3d-panel") armEditorButton(element);
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    walk(document);
  });
}
