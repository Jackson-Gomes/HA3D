import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const FIX_VERSION = "20260919-6";
const TV_LIGHT_ENTITY = "light.luz_da_tv";
const TV_MEDIA_ENTITIES = [
  "media_player.tv_da_sala_de_estar",
  "media_player.sala_de_estar_tv_da_sala",
];
const PRINTER_ENTITY = "switch.impressora_3d_socket_1";
const LAMP_ENTITY = "light.escritorio_tomada_escritorio_socket_1";

function normalize(value) {
  return String(value || "")
    .replace(/^LightNode_/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function findEntity(hass, candidates) {
  const states = hass?.states || {};
  const usable = candidates.find((entity) => {
    const state = states[entity];
    return state && !["unknown", "unavailable"].includes(state.state);
  });
  return usable || candidates.find((entity) => states[entity]) || null;
}

function findAnchor(model, entity, aliases = []) {
  const exactTarget = normalize(entity);
  const targets = new Set(aliases.map(normalize));
  let exact = null;
  let alias = null;
  model?.traverse((object) => {
    const name = normalize(object.name);
    if (!name) return;
    if (name === exactTarget) exact ||= object;
    else if (targets.has(name)) alias ||= object;
  });
  return exact || alias;
}

function isTvLampLight(light) {
  const name = normalize(light?.name);
  return name.includes("tv") || name.includes("televisao") || name.includes("television");
}

function makeHardMarker(panel, entity, title, aliases = [], glyph = "💡") {
  if (!panel._hass?.states?.[entity] || panel._lightBindings?.has(entity)) return;
  const anchor = panel._objectsByEntity?.get(entity)?.[0] || findAnchor(panel._model, entity, aliases);
  if (!anchor) return;
  panel._makeLightMarker(entity, title, anchor, null);
  const binding = panel._lightBindings.get(entity);
  if (binding?.marker) binding.marker.textContent = glyph;
}

function configurePhysicalShadow(light, on) {
  if (!light) return;
  light.castShadow = Boolean(on);
  if (!on || !light.shadow) return;
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
  if (light.distance > 0 && light.shadow.camera) {
    light.shadow.camera.near = Math.max(0.02, Math.min(0.5, light.distance * 0.02));
    light.shadow.camera.far = light.distance;
    light.shadow.camera.updateProjectionMatrix();
  }
  light.shadow.needsUpdate = true;
}

if (!proto.__ha3dTvWallFixV6) {
  proto.__ha3dTvWallFixV6 = true;

  // The GLB lamp above the TV is a normal Home Assistant light.
  // It is NOT the television/media_player.
  const originalMappingForLight = proto._mappingForLight;
  proto._mappingForLight = function (light) {
    if (isTvLampLight(light) && this._hass?.states?.[TV_LIGHT_ENTITY]) {
      return {
        entity: TV_LIGHT_ENTITY,
        name: this._hass.states[TV_LIGHT_ENTITY]?.attributes?.friendly_name || "Luz da TV",
      };
    }

    const name = normalize(light?.name);
    if (name.includes("abajur") && this._hass?.states?.[LAMP_ENTITY]) {
      return {
        entity: LAMP_ENTITY,
        name: this._hass.states[LAMP_ENTITY]?.attributes?.friendly_name || "Abajur escritório",
      };
    }

    return originalMappingForLight.call(this, light);
  };

  // Preserve the old circular marker style. Add only the non-light devices that
  // the old light-only marker pass does not create by itself.
  const originalBindEntityMarkers = proto._bindEntityLightMarkers;
  proto._bindEntityLightMarkers = function (...args) {
    const result = originalBindEntityMarkers.apply(this, args);

    makeHardMarker(
      this,
      PRINTER_ENTITY,
      this._hass?.states?.[PRINTER_ENTITY]?.attributes?.friendly_name || "Impressora 3D",
      [PRINTER_ENTITY, "impressora 3d", "printer 3d", "printer"],
      "🖨️",
    );

    makeHardMarker(
      this,
      LAMP_ENTITY,
      this._hass?.states?.[LAMP_ENTITY]?.attributes?.friendly_name || "Abajur escritório",
      [LAMP_ENTITY, "abajur", "abajur escritorio"],
      "💡",
    );

    const tvMediaEntity = findEntity(this._hass, TV_MEDIA_ENTITIES);
    if (tvMediaEntity && !this._lightBindings?.has(tvMediaEntity)) {
      makeHardMarker(
        this,
        tvMediaEntity,
        this._hass?.states?.[tvMediaEntity]?.attributes?.friendly_name || "TV da sala",
        [tvMediaEntity, "tv", "televisao", "television"],
        "📺",
      );
    }

    this._boundCount = this._lightBindings?.size || this._boundCount;
    const meta = this.shadowRoot?.querySelector("#meta");
    if (meta) meta.textContent = `${this._boundCount} vínculos`;
    return result;
  };

  // The pre-Astra frontend intentionally restored every unbound GLB light.
  // That creates phantom illumination when HA says all physical lights are off.
  // From now on only HA-bound model lights may emit; the global scene fill is
  // separate and is not part of _modelLights.
  proto._restoreUnboundModelLights = function () {
    const boundLights = new Set(
      [...(this._lightBindings?.values?.() || [])]
        .map((binding) => binding.light)
        .filter(Boolean),
    );

    for (const light of this._modelLights || []) {
      if (boundLights.has(light)) continue;
      light.intensity = 0;
      light.castShadow = false;
    }
  };

  const originalSyncLightStates = proto._syncLightStates;
  proto._syncLightStates = function (...args) {
    const result = originalSyncLightStates.apply(this, args);

    // Make sure every HA-bound physical light has wall-blocking shadows when on.
    for (const binding of this._lightBindings?.values?.() || []) {
      if (!binding.light) continue;
      const state = this._hass?.states?.[binding.entity];
      if (!state) continue;
      const on = state.state === "on" && !["unknown", "unavailable"].includes(state.state);
      configurePhysicalShadow(binding.light, on);
    }

    // media_player TV is visual state only. It never drives the physical TV lamp.
    const tvMediaEntity = findEntity(this._hass, TV_MEDIA_ENTITIES);
    const tvBinding = tvMediaEntity ? this._lightBindings?.get(tvMediaEntity) : null;
    const tvState = tvMediaEntity ? this._hass?.states?.[tvMediaEntity] : null;
    if (tvBinding && tvState) {
      const unavailable = ["unknown", "unavailable"].includes(tvState.state);
      const active = !unavailable && ["on", "playing", "paused", "idle"].includes(tvState.state);
      tvBinding.marker?.classList.toggle("on", active);
      tvBinding.marker?.classList.toggle("unavailable", unavailable);
      if (tvBinding.marker) {
        tvBinding.marker.title = unavailable
          ? `${tvBinding.name || "TV da sala"} — indisponível`
          : tvBinding.name || "TV da sala";
      }
      // Defensive: a media_player marker must never own a GLB physical light.
      if (tvBinding.light) {
        tvBinding.light.intensity = 0;
        tvBinding.light.castShadow = false;
        tvBinding.light = null;
      }
    }

    return result;
  };

  const originalLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await originalLoadModel.apply(this, args);

    this._model?.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material) material.shadowSide = THREE.DoubleSide;
      }
    });

    // Re-sync once after the wall occluders are prepared.
    this._syncLightStates?.();
    this.setAttribute("data-ha3d-tv-fix", FIX_VERSION);
    return result;
  };
}
