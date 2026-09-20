import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const FIX_VERSION = "20260919-10";

// Three.js GLTFLoader sanitizes characters such as the dot in entity_id names.
// We compensate only for that loader transformation. There are no aliases,
// friendly-name guesses or house-specific mappings here.
function loaderSafeName(value) {
  return String(value || "")
    .replace(/[\[\]\.:/]/g, "")
    .replace(/\s/g, "_");
}

function entityFromNodeName(hass, nodeName) {
  const states = hass?.states || {};
  if (!nodeName) return null;

  // True exact match first.
  if (states[nodeName]) return nodeName;

  // Compensate only for GLTFLoader name sanitization. Require uniqueness.
  const matches = Object.keys(states).filter((entity) => loaderSafeName(entity) === nodeName);
  return matches.length === 1 ? matches[0] : null;
}

function markerGlyph(entity, state) {
  const domain = entity.split(".")[0];
  const icon = String(state?.attributes?.icon || "").toLowerCase();
  if (icon.includes("printer")) return "🖨️";
  if (icon.includes("xbox") || icon.includes("gamepad")) return "🎮";
  if (domain === "light") return "💡";
  if (domain === "media_player") return "📺";
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
  if (!state || state.state === "unknown" || state.state === "unavailable") return false;
  const domain = entity.split(".")[0];
  if (domain === "media_player") return ["on", "playing", "paused", "idle"].includes(state.state);
  if (domain === "vacuum") return ["cleaning", "returning", "spot_cleaning"].includes(state.state);
  if (domain === "climate") return state.state !== "off";
  if (domain === "cover") return ["open", "opening", "closing"].includes(state.state);
  if (domain === "lock") return state.state === "unlocked";
  return state.state === "on";
}

function configureShadow(light, enabled) {
  if (!light) return;
  light.castShadow = Boolean(enabled);
  if (!enabled || !light.shadow) return;
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

if (!proto.__ha3dExactEntityBindingV10) {
  proto.__ha3dExactEntityBindingV10 = true;

  const originalIndexBindings = proto._indexBindings;
  proto._indexBindings = function (...args) {
    originalIndexBindings.apply(this, args);

    const states = this._hass?.states || {};
    this._model?.traverse((object) => {
      const entity = entityFromNodeName(this._hass, object.name);
      if (!entity || !states[entity]) return;

      object.userData.ha3dEntityId = entity;
      if (!this._objectsByEntity.has(entity)) {
        this._objectsByEntity.set(entity, []);
      }
      const objects = this._objectsByEntity.get(entity);
      if (!objects.includes(object)) objects.push(object);
    });

    this._boundCount = this._objectsByEntity.size;
  };

  // Physical GLB lights bind only through an exact entity-id node in their
  // parent chain. No "sala", "TV", "abajur" or other guessed names.
  proto._directLightMapping = function (light) {
    const states = this._hass?.states || {};
    let node = light;
    while (node && node !== this._model?.parent) {
      const entity = node.userData?.ha3dEntityId || entityFromNodeName(this._hass, node.name);
      if (entity?.startsWith("light.") && states[entity]) {
        return {
          entity,
          name: states[entity].attributes?.friendly_name || entity,
        };
      }
      if (node === this._model) break;
      node = node.parent;
    }
    return null;
  };

  proto._mappingForLight = function (light) {
    return this._directLightMapping(light);
  };

  const originalBindEntityMarkers = proto._bindEntityLightMarkers;
  proto._bindEntityLightMarkers = function (...args) {
    originalBindEntityMarkers.apply(this, args);
    const states = this._hass?.states || {};

    // Same circular marker style as the pre-Astra frontend, for every domain.
    for (const [entity, objects] of this._objectsByEntity.entries()) {
      if (this._lightBindings.has(entity) || !objects.length || !states[entity]) continue;
      this._makeLightMarker(
        entity,
        states[entity].attributes?.friendly_name || entity,
        objects[0],
        null,
      );
      const binding = this._lightBindings.get(entity);
      if (binding?.marker) binding.marker.textContent = markerGlyph(entity, states[entity]);
    }

    this._boundCount = this._lightBindings.size;
    const meta = this.shadowRoot?.querySelector("#meta");
    if (meta) meta.textContent = `${this._boundCount} vínculos`;
  };

  // No phantom GLB illumination: an unbound physical light is always off.
  // The global scene light is separate and is not part of _modelLights.
  proto._restoreUnboundModelLights = function () {
    const boundLights = new Set(
      [...this._lightBindings.values()].map((binding) => binding.light).filter(Boolean),
    );
    for (const light of this._modelLights || []) {
      if (boundLights.has(light)) continue;
      light.intensity = 0;
      light.castShadow = false;
    }
  };

  const originalSyncLightStates = proto._syncLightStates;
  proto._syncLightStates = function (...args) {
    originalSyncLightStates.apply(this, args);

    for (const [entity, binding] of this._lightBindings.entries()) {
      const state = this._hass?.states?.[entity];
      if (!state) continue;
      const unavailable = state.state === "unknown" || state.state === "unavailable";
      const on = visualOn(entity, state);

      binding.marker?.classList.toggle("on", on && !unavailable);
      binding.marker?.classList.toggle("unavailable", unavailable);
      if (binding.marker) {
        binding.marker.textContent = markerGlyph(entity, state);
        binding.marker.title = unavailable
          ? `${state.attributes?.friendly_name || entity} — indisponível`
          : state.attributes?.friendly_name || entity;
      }

      // Only light.* entities can control physical GLB lights.
      if (binding.light) {
        if (!entity.startsWith("light.")) {
          binding.light.intensity = 0;
          binding.light.castShadow = false;
          binding.light = null;
          continue;
        }
        configureShadow(binding.light, state.state === "on" && !unavailable);
      }
    }
  };

  const originalLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await originalLoadModel.apply(this, args);

    // Physical lights use real wall occlusion. The global scene light remains
    // shadow-free in the restored pre-Astra scene module.
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
