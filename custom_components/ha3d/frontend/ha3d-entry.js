import "./ha3d-cinematic.js";

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

    // The generic viewer restores non-HA lights from the GLB so baked/global
    // scene illumination is not black. The original 40% scale was too strong
    // for APT0307 on mobile, so keep those scene lights at ~18% of export
    // intensity while HA-bound physical lights retain their normal scale.
    const boundLights = new Set(
      [...(this._lightBindings?.values?.() || [])]
        .map((binding) => binding.light)
        .filter(Boolean),
    );

    for (const light of this._modelLights || []) {
      if (boundLights.has(light)) continue;
      light.intensity *= 0.45;
      light.castShadow = false;
    }

    return result;
  };
}
