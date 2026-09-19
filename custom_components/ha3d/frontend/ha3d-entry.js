import "./ha3d-graphics.js?v=0.1.7";

// Entry module for the HA3D panel. Keeping this file as the registered
// Home Assistant module gives us a stable cache-busting point while the
// base viewer and optional behaviors stay split into smaller modules.
const Panel = customElements.get("ha3d-panel");

if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

if (!proto.__ha3dSceneLightTuned) {
  proto.__ha3dSceneLightTuned = true;

  const originalRestoreUnboundModelLights = proto._restoreUnboundModelLights;
  proto._restoreUnboundModelLights = function (...args) {
    const result = originalRestoreUnboundModelLights.apply(this, args);

    // Keep GLB/global lights only as a soft fill. HA-bound physical lights
    // retain their normal scale and continue following Home Assistant state.
    const boundLights = new Set(
      [...(this._lightBindings?.values?.() || [])]
        .map((binding) => binding.light)
        .filter(Boolean),
    );

    for (const light of this._modelLights || []) {
      if (boundLights.has(light)) continue;
      light.intensity *= 0.30;
      light.castShadow = false;
    }

    return result;
  };
}
