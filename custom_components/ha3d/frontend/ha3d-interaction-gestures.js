const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

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

if (!proto.__ha3dInteractionGesturesV3) {
  proto.__ha3dInteractionGesturesV3 = true;

  // Geometry in normal view never toggles Home Assistant entities directly.
  // Normal click inspection is handled by ha3d-object-inspection.
  // Object editing is entered only through the explicit editor menu/button.
  proto._runEntityAction = async function () {};

  const oldWireUi = proto._wireUi;
  proto._wireUi = function (...args) {
    const result = oldWireUi?.apply(this, args);
    installCardGuard(this);
    return result;
  };

  const oldConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = oldConnected?.apply(this, args);
    queueMicrotask(() => installCardGuard(this));
    return result;
  };
}
