import "./ha3d-cinematic.js?v=20260919-3";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

if (!proto.__ha3dCinematicUiLateInstall) {
  proto.__ha3dCinematicUiLateInstall = true;

  const hassDescriptor = Object.getOwnPropertyDescriptor(proto, "hass");
  if (hassDescriptor?.set) {
    Object.defineProperty(proto, "hass", {
      configurable: true,
      enumerable: hassDescriptor.enumerable,
      get: hassDescriptor.get,
      set(value) {
        hassDescriptor.set.call(this, value);
        queueMicrotask(() => this._installCinematicControls?.());
      },
    });
  }

  const originalConnectedCallback = proto.connectedCallback;
  proto.connectedCallback = function () {
    originalConnectedCallback.call(this);
    queueMicrotask(() => this._installCinematicControls?.());
  };
}
