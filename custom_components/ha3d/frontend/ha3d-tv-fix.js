import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const FIX_VERSION = "20260919-5";
const TV_ENTITIES = [
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
    return state && !["unknown", "unavailable"].includes(state.state) && state.attributes?.assumed_state !== true;
  });
  return usable || candidates.find((entity) => states[entity]) || null;
}

function findAnchor(model, entity, aliases = []) {
  const targets = new Set([normalize(entity), ...aliases.map(normalize)]);
  let exact = null;
  let alias = null;
  model?.traverse((object) => {
    const name = normalize(object.name);
    if (!name) return;
    if (name === normalize(entity)) exact ||= object;
    else if (targets.has(name)) alias ||= object;
  });
  return exact || alias;
}

function isTvLight(light) {
  const name = normalize(light?.name);
  return name.includes("tv") || name.includes("televisao") || name.includes("television");
}

function convertTvPointToSpot(panel) {
  panel._modelLights = (panel._modelLights || []).map((light) => {
    if (!light?.isPointLight || !isTvLight(light)) return light;

    const spot = new THREE.SpotLight(light.color.clone(), 0);
    spot.name = light.name;
    spot.position.copy(light.position);
    spot.quaternion.copy(light.quaternion);
    spot.scale.copy(light.scale);
    spot.userData = { ...light.userData, ha3dTvDirectional: true };
    spot.angle = Math.PI / 3;
    spot.penumbra = 0.45;
    spot.decay = 2;
    spot.distance = Number(light.userData?.ha3dBaseDistance) > 0
      ? light.userData.ha3dBaseDistance
      : 3;

    spot.target.position.set(0, 0, -1);
    spot.add(spot.target);

    const parent = light.parent;
    parent?.add(spot);
    parent?.remove(light);
    return spot;
  });
}

function makeHardMarker(panel, entity, title, aliases = [], glyph = "💡") {
  if (!panel._hass?.states?.[entity] || panel._lightBindings?.has(entity)) return;
  const anchor = panel._objectsByEntity?.get(entity)?.[0] || findAnchor(panel._model, entity, aliases);
  if (!anchor) return;
  panel._makeLightMarker(entity, title, anchor, null);
  const binding = panel._lightBindings.get(entity);
  if (binding?.marker) binding.marker.textContent = glyph;
}

if (!proto.__ha3dTvWallFixV5) {
  proto.__ha3dTvWallFixV5 = true;

  const originalBindModelLights = proto._bindModelLights;
  proto._bindModelLights = function (...args) {
    convertTvPointToSpot(this);
    return originalBindModelLights.apply(this, args);
  };

  const originalMappingForLight = proto._mappingForLight;
  proto._mappingForLight = function (light) {
    if (isTvLight(light)) {
      const tvEntity = findEntity(this._hass, TV_ENTITIES);
      if (tvEntity) {
        return {
          entity: tvEntity,
          name: this._hass.states[tvEntity]?.attributes?.friendly_name || "TV da sala",
        };
      }
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

  const originalBindEntityMarkers = proto._bindEntityLightMarkers;
  proto._bindEntityLightMarkers = function (...args) {
    const result = originalBindEntityMarkers.apply(this, args);

    makeHardMarker(
      this,
      PRINTER_ENTITY,
      this._hass?.states?.[PRINTER_ENTITY]?.attributes?.friendly_name || "Impressora 3D",
      ["impressora 3d", "printer 3d", "printer"],
      "🖨️",
    );

    makeHardMarker(
      this,
      LAMP_ENTITY,
      this._hass?.states?.[LAMP_ENTITY]?.attributes?.friendly_name || "Abajur escritório",
      ["abajur", "abajur escritorio"],
      "💡",
    );

    const tvEntity = findEntity(this._hass, TV_ENTITIES);
    if (tvEntity && !this._lightBindings?.has(tvEntity)) {
      makeHardMarker(
        this,
        tvEntity,
        this._hass?.states?.[tvEntity]?.attributes?.friendly_name || "TV da sala",
        ["tv", "televisao", "television"],
        "📺",
      );
    }

    this._boundCount = this._lightBindings?.size || this._boundCount;
    const meta = this.shadowRoot?.querySelector("#meta");
    if (meta) meta.textContent = `${this._boundCount} vínculos`;
    return result;
  };

  const originalSyncLightStates = proto._syncLightStates;
  proto._syncLightStates = function (...args) {
    const result = originalSyncLightStates.apply(this, args);

    const tvEntity = findEntity(this._hass, TV_ENTITIES);
    const binding = tvEntity ? this._lightBindings?.get(tvEntity) : null;
    const state = tvEntity ? this._hass?.states?.[tvEntity] : null;
    if (binding && state) {
      const unavailable = ["unknown", "unavailable"].includes(state.state);
      const on = !unavailable && ["on", "playing", "paused", "idle"].includes(state.state);
      const brightness = Number.isFinite(Number(state.attributes?.brightness))
        ? Number(state.attributes.brightness)
        : 255;

      if (binding.light) {
        const base = Number(binding.light.userData?.ha3dBaseIntensity) > 0
          ? binding.light.userData.ha3dBaseIntensity
          : 40;
        binding.light.intensity = on ? base * Math.max(0.05, brightness / 255) : 0;
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

      binding.marker?.classList.toggle("on", on);
      binding.marker?.classList.toggle("unavailable", unavailable);
      if (binding.marker) {
        binding.marker.title = unavailable
          ? `${binding.name || "TV da sala"} — indisponível`
          : binding.name || "TV da sala";
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

    this.setAttribute("data-ha3d-tv-fix", FIX_VERSION);
    return result;
  };
}
