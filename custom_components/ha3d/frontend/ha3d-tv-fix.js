import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const FIX_VERSION = "20260919-8";
const TV_LIGHT_ENTITY = "light.luz_da_tv";
const TV_MEDIA_ENTITIES = [
  "media_player.tv_da_sala_de_estar",
  "media_player.sala_de_estar_tv_da_sala",
];
const LAMP_ENTITY = "light.escritorio_tomada_escritorio_socket_1";

function normalize(value) {
  return String(value || "")
    .replace(/^LightNode_/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function findEntityByNodeName(hass, nodeName) {
  const target = normalize(nodeName);
  if (!target) return null;
  const matches = Object.keys(hass?.states || {}).filter((entity) => normalize(entity) === target);
  return matches.length === 1 ? matches[0] : null;
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

function glyphFor(entity, state) {
  const domain = entity.split(".")[0];
  const icon = String(state?.attributes?.icon || "").toLowerCase();
  if (icon.includes("printer")) return "🖨️";
  if (icon.includes("xbox") || icon.includes("gamepad")) return "🎮";
  if (icon.includes("television") || domain === "media_player") return "📺";
  if (domain === "light") return "💡";
  if (domain === "switch" || domain === "input_boolean") return "🔌";
  if (domain === "vacuum") return "🤖";
  if (domain === "climate") return "❄️";
  if (domain === "fan") return "🌀";
  if (domain === "lock") return "🔒";
  if (domain === "cover") return "🪟";
  if (domain === "binary_sensor") return "◉";
  if (domain === "sensor") return "●";
  return "●";
}

function visualOn(entity, state) {
  if (!state || ["unknown", "unavailable"].includes(state.state)) return false;
  const domain = entity.split(".")[0];
  if (domain === "media_player") return ["on", "playing", "paused", "idle"].includes(state.state);
  if (domain === "vacuum") return ["cleaning", "returning", "spot_cleaning"].includes(state.state);
  if (domain === "climate") return !["off", "unavailable", "unknown"].includes(state.state);
  if (domain === "cover") return ["open", "opening", "closing"].includes(state.state);
  if (domain === "lock") return state.state === "unlocked";
  return state.state === "on";
}

function makeMarker(panel, entity, anchor, glyph = null) {
  const state = panel._hass?.states?.[entity];
  if (!state || panel._lightBindings?.has(entity) || !anchor) return;
  panel._makeLightMarker(
    entity,
    state.attributes?.friendly_name || entity,
    anchor,
    null,
  );
  const binding = panel._lightBindings.get(entity);
  if (binding?.marker) binding.marker.textContent = glyph || glyphFor(entity, state);
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

if (!proto.__ha3dCompatibilityV8) {
  proto.__ha3dCompatibilityV8 = true;

  const originalIndexBindings = proto._indexBindings;
  proto._indexBindings = function (...args) {
    const result = originalIndexBindings.apply(this, args);

    // Recover exact entity_id bindings even when GLTFLoader sanitizes dots or underscores.
    this._model?.traverse((object) => {
      const entity = findEntityByNodeName(this._hass, object.name);
      if (!entity) return;
      object.userData.ha3dEntityId = entity;
      if (!this._objectsByEntity.has(entity)) this._objectsByEntity.set(entity, []);
      const list = this._objectsByEntity.get(entity);
      if (!list.includes(object)) list.push(object);
    });

    return result;
  };

  const originalMappingForLight = proto._mappingForLight;
  proto._mappingForLight = function (light) {
    // Exact entity name on the GLB light always wins.
    const exact = findEntityByNodeName(this._hass, light?.name);
    if (exact?.startsWith("light.")) {
      return {
        entity: exact,
        name: this._hass.states[exact]?.attributes?.friendly_name || exact,
      };
    }

    // Alias used by the current APT GLB.
    const lightName = normalize(light?.name);
    if (lightName.includes("abajur") && this._hass?.states?.[LAMP_ENTITY]) {
      return {
        entity: LAMP_ENTITY,
        name: this._hass.states[LAMP_ENTITY]?.attributes?.friendly_name || "Abajur escritório",
      };
    }

    // The lamp physically above the TV is light.luz_da_tv, never the media_player.
    if (isTvLampLight(light) && this._hass?.states?.[TV_LIGHT_ENTITY]) {
      return {
        entity: TV_LIGHT_ENTITY,
        name: this._hass.states[TV_LIGHT_ENTITY]?.attributes?.friendly_name || "Luz da TV",
      };
    }

    return originalMappingForLight.call(this, light);
  };

  const originalBindEntityMarkers = proto._bindEntityLightMarkers;
  proto._bindEntityLightMarkers = function (...args) {
    const result = originalBindEntityMarkers.apply(this, args);

    // Generic markers: every GLB node that matches a Home Assistant entity_id.
    this._model?.traverse((object) => {
      const entity = object.userData?.ha3dEntityId || findEntityByNodeName(this._hass, object.name);
      if (!entity) return;
      makeMarker(this, entity, object);
    });

    // Keep the known GLB aliases while exact entity naming is phased in.
    if (this._hass?.states?.[LAMP_ENTITY] && !this._lightBindings?.has(LAMP_ENTITY)) {
      const anchor = findAnchor(this._model, LAMP_ENTITY, ["abajur", "abajur escritorio"]);
      makeMarker(this, LAMP_ENTITY, anchor, "💡");
    }

    const tvMediaEntity = findEntity(this._hass, TV_MEDIA_ENTITIES);
    if (tvMediaEntity && !this._lightBindings?.has(tvMediaEntity)) {
      const anchor = findAnchor(this._model, tvMediaEntity, ["tv", "televisao", "television"]);
      makeMarker(this, tvMediaEntity, anchor, "📺");
    }

    this._boundCount = this._lightBindings?.size || 0;
    const meta = this.shadowRoot?.querySelector("#meta");
    if (meta) meta.textContent = `${this._boundCount} vínculos`;
    return result;
  };

  // Unbound physical GLB lights stay off. Global scene fill is separate.
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

    for (const [entity, binding] of this._lightBindings?.entries?.() || []) {
      const state = this._hass?.states?.[entity];
      if (!state) continue;
      const unavailable = ["unknown", "unavailable"].includes(state.state);
      const on = visualOn(entity, state);

      binding.marker?.classList.toggle("on", on && !unavailable);
      binding.marker?.classList.toggle("unavailable", unavailable);
      if (binding.marker) {
        binding.marker.textContent = glyphFor(entity, state);
        binding.marker.title = unavailable
          ? `${state.attributes?.friendly_name || entity} — indisponível`
          : state.attributes?.friendly_name || entity;
      }

      if (binding.light) {
        const isPhysicalLight = entity.startsWith("light.");
        if (!isPhysicalLight) {
          binding.light.intensity = 0;
          binding.light.castShadow = false;
          binding.light = null;
          continue;
        }
        configurePhysicalShadow(binding.light, state.state === "on" && !unavailable);
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

    this._syncLightStates?.();
    this.setAttribute("data-ha3d-fix", FIX_VERSION);
    return result;
  };
}
