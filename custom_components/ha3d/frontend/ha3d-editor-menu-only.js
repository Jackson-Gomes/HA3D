// Final safety layer: object editing may only be entered from the explicit Editor button.
// This module is intentionally imported last so earlier interaction modules cannot bypass it.
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function armEditorButton(panel) {
  const button = panel?.shadowRoot?.querySelector("#editorButton");
  if (!button || button.__ha3dMenuOnlyEditorGuard) return;
  button.__ha3dMenuOnlyEditorGuard = true;

  // Capture runs before the existing button listener that calls _toggleEditor().
  button.addEventListener("click", () => {
    panel._ha3dEditorMenuAuthorization = performance.now() + 500;
  }, true);
}

function ensure(panel) {
  armEditorButton(panel);
}

if (!proto.__ha3dEditorMenuOnlyV1) {
  proto.__ha3dEditorMenuOnlyV1 = true;

  const previousToggleEditor = proto._toggleEditor;
  proto._toggleEditor = function (...args) {
    // Leaving edit mode is always allowed.
    if (this._editorMode) {
      this._ha3dEditorMenuAuthorization = 0;
      return previousToggleEditor?.apply(this, args);
    }

    // Entering edit mode requires a fresh click on the explicit Editor button.
    const authorizedUntil = Number(this._ha3dEditorMenuAuthorization || 0);
    this._ha3dEditorMenuAuthorization = 0;
    if (performance.now() > authorizedUntil) {
      return;
    }

    return previousToggleEditor?.apply(this, args);
  };

  const previousConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = previousConnected?.apply(this, args);
    queueMicrotask(() => ensure(this));
    requestAnimationFrame(() => ensure(this));
    setTimeout(() => ensure(this), 250);
    return result;
  };

  const previousWireUi = proto._wireUi;
  proto._wireUi = function (...args) {
    const result = previousWireUi?.apply(this, args);
    queueMicrotask(() => ensure(this));
    return result;
  };

  // Existing panels may already be mounted when this last module loads.
  queueMicrotask(() => {
    const walk = (root) => {
      if (!root?.querySelectorAll) return;
      for (const element of root.querySelectorAll("*")) {
        if (element.localName === "ha3d-panel") ensure(element);
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    walk(document);
  });
}
