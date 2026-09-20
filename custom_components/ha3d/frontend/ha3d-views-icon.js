// Replace the Vistas text button with a compact gear icon.
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

function applyViewsIcon(panel) {
  const button = panel?.shadowRoot?.querySelector("#viewsButton");
  if (!button) return false;
  button.textContent = "⚙️";
  button.title = "Vistas";
  button.setAttribute("aria-label", "Vistas");
  return true;
}

const proto = Panel.prototype;
if (!proto.__ha3dViewsIconV1) {
  proto.__ha3dViewsIconV1 = true;

  const originalConnectedCallback = proto.connectedCallback;
  proto.connectedCallback = function () {
    originalConnectedCallback?.call(this);
    queueMicrotask(() => applyViewsIcon(this));
  };

  const originalBindMarkers = proto._bindEntityLightMarkers;
  proto._bindEntityLightMarkers = function (...args) {
    const result = originalBindMarkers?.apply(this, args);
    applyViewsIcon(this);
    return result;
  };

  queueMicrotask(() => {
    const panels = document.querySelectorAll("ha3d-panel");
    for (const panel of panels) applyViewsIcon(panel);
  });
}
