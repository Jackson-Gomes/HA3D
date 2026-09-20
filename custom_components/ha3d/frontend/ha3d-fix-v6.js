const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const FIX_VERSION = "20260919-6";
const TV_LIGHT_ENTITY = "light.luz_da_tv";
const TV_ENTITIES = [
  "media_player.tv_da_sala_de_estar",
  "media_player.sala_de_estar_tv_da_sala",
];

function normalize(value) {
  return String(value || "")
    .replace(/^LightNode_/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function isTvLight(light) {
  const name = normalize(light?.name);
  return name.includes("tv") || name.includes("televisao") || name.includes("television");
}

function findReliableTvState(hass) {
  const states = hass?.states || {};
  for (const entity of TV_ENTITIES) {
    const state = states[entity];
    if (
      state &&
      !["unknown", "unavailable"].includes(state.state) &&
      state.attributes?.assumed_state !== true
    ) {
      return { entity, state };
    }
  }
  for (const entity of TV_ENTITIES) {
    if (states[entity]) return { entity, state: states[entity] };
  }
  return null;
}

if (!proto.__ha3dFixV6) {
  proto.__ha3dFixV6 = true;

  // Restore the exact pre-Astra semantic binding: the GLB light named TV
  // remains the Home Assistant light entity. Only its physical emission below
  // follows the television state.
  const previousMappingForLight = proto._mappingForLight;
  proto._mappingForLight = function (light) {
    if (isTvLight(light) && this._hass?.states?.[TV_LIGHT_ENTITY]) {
      return {
        entity: TV_LIGHT_ENTITY,
        name: this._hass.states[TV_LIGHT_ENTITY]?.attributes?.friendly_name || "Luz da TV",
      };
    }
    return previousMappingForLight.call(this, light);
  };

  // The old viewer intentionally restored every unbound GLB light. That is why
  // a room could remain visibly lit while every HA light entity was OFF.
  // Keep the old visuals, but fail closed for physical GLB lights: only a light
  // explicitly bound to Home Assistant may emit.
  const previousRestoreUnbound = proto._restoreUnboundModelLights;
  proto._restoreUnboundModelLights = function (...args) {
    const result = previousRestoreUnbound.apply(this, args);
    const bound = new Set(
      [...(this._lightBindings?.values?.() || [])]
        .map((binding) => binding.light)
        .filter(Boolean),
    );
    for (const light of this._modelLights || []) {
      if (bound.has(light)) continue;
      light.intensity = 0;
      light.castShadow = false;
    }
    return result;
  };

  // v5 temporarily created a separate TV device marker. Remove only those
  // temporary media_player markers so the UI returns to the pre-Astra style.
  const previousBindEntityMarkers = proto._bindEntityLightMarkers;
  proto._bindEntityLightMarkers = function (...args) {
    const result = previousBindEntityMarkers.apply(this, args);
    for (const entity of TV_ENTITIES) {
      const binding = this._lightBindings?.get(entity);
      if (!binding) continue;
      binding.marker?.remove?.();
      this._lightBindings.delete(entity);
    }
    this._boundCount = this._lightBindings?.size || 0;
    const meta = this.shadowRoot?.querySelector("#meta");
    if (meta) meta.textContent = `${this._boundCount} vínculos`;
    return result;
  };

  const previousSync = proto._syncLightStates;
  proto._syncLightStates = function (...args) {
    const result = previousSync.apply(this, args);

    const tv = findReliableTvState(this._hass);
    const binding = this._lightBindings?.get(TV_LIGHT_ENTITY);
    if (binding?.light && tv?.state) {
      const unavailable = ["unknown", "unavailable"].includes(tv.state.state);
      const on = !unavailable && ["on", "playing", "paused", "idle"].includes(tv.state.state);
      const base = Number(binding.light.userData?.ha3dBaseIntensity) > 0
        ? binding.light.userData.ha3dBaseIntensity
        : 40;

      // Keep the marker itself representing light.luz_da_tv exactly as before.
      // Only the 3D light emission follows the real television power/state.
      binding.light.intensity = on ? base : 0;
      binding.light.castShadow = on;
      if (binding.light.shadow) {
        binding.light.shadow.mapSize.set(512, 512);
        binding.light.shadow.bias = -0.0005;
        binding.light.shadow.normalBias = 0.02;
        binding.light.shadow.camera.near = 0.02;
        binding.light.shadow.camera.far = binding.light.distance || 4;
        binding.light.shadow.camera.updateProjectionMatrix();
        binding.light.shadow.needsUpdate = true;
      }
    }

    return result;
  };

  const previousLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await previousLoadModel.apply(this, args);
    this.setAttribute("data-ha3d-fix", FIX_VERSION);
    return result;
  };
}
