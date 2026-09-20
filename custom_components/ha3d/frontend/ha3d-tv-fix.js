import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const GENERIC_BINDING_VERSION = "20260919-11";
const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const TOUCH_DEVICE = globalThis.matchMedia?.("(pointer: coarse)")?.matches || globalThis.navigator?.maxTouchPoints > 0;
const SHADOW_MAP_SIZE = TOUCH_DEVICE ? 256 : 512;

function originalNodeName(object) {
  return object?.userData?.ha3dOriginalName || object?.name || "";
}

function entityFromRawName(name) {
  const value = String(name || "");
  const stripped = value.startsWith("LightNode_") ? value.slice("LightNode_".length) : value;
  return ENTITY_ID.test(stripped) ? stripped : null;
}

function loaderSafeName(value) {
  return String(value || "").replace(/[\[\]\.:/]/g, "").replace(/\s/g, "_");
}

function entityFromNode(panel, object) {
  const raw = originalNodeName(object);
  const explicit = panel._config?.bindings || {};
  const explicitEntity = explicit[raw] || explicit[object?.name];
  if (ENTITY_ID.test(String(explicitEntity || ""))) return explicitEntity;
  if (panel._config?.auto_bind === false) return null;

  const direct = entityFromRawName(raw);
  if (direct) return direct;

  // Fallback only for names already sanitized by GLTFLoader. It is resolved
  // lazily and uniquely, so hass.states does not need to exist on frame one.
  const states = panel._hass?.states || {};
  const safe = String(object?.name || "");
  const candidates = Object.keys(states).filter((entity) => loaderSafeName(entity) === safe);
  return candidates.length === 1 ? candidates[0] : null;
}

function isPhysicalNode(object) {
  const raw = originalNodeName(object);
  return raw.startsWith("LightNode_") || Boolean(object?.isLight);
}

function markerGlyph(entity, state) {
  const domain = String(entity || "").split(".")[0];
  const icon = String(state?.attributes?.icon || "").toLowerCase();
  if (icon.includes("printer")) return "🖨️";
  if (icon.includes("gamepad") || icon.includes("xbox")) return "🎮";
  const glyphs = {
    light: "💡",
    media_player: "📺",
    switch: "⏻",
    input_boolean: "⏻",
    vacuum: "🤖",
    climate: "❄️",
    fan: "🌀",
    lock: "🔒",
    cover: "▤",
    binary_sensor: "◉",
    sensor: "●",
    button: "●",
  };
  return glyphs[domain] || "●";
}

function visualOn(entity, state) {
  if (!state || state.state === "unknown" || state.state === "unavailable") return false;
  const domain = String(entity || "").split(".")[0];
  if (domain === "media_player") return ["on", "playing", "paused", "idle"].includes(state.state);
  if (domain === "vacuum") return ["cleaning", "returning", "spot_cleaning"].includes(state.state);
  if (domain === "climate") return state.state !== "off";
  if (domain === "cover") return ["open", "opening", "closing"].includes(state.state);
  if (domain === "lock") return state.state === "unlocked";
  if (domain === "binary_sensor") return state.state === "on";
  return state.state === "on";
}

function metadataStateEntity(panel, entity, anchor) {
  const configured = panel._config?.state_entities?.[entity] || panel._config?.state_entity?.[entity];
  if (ENTITY_ID.test(String(configured || ""))) return configured;

  let node = anchor;
  while (node && node !== panel._model?.parent) {
    const meta = node.userData?.ha3d || {};
    const candidate = meta.state_entity || node.userData?.state_entity;
    if (ENTITY_ID.test(String(candidate || ""))) return candidate;
    if (node === panel._model) break;
    node = node.parent;
  }
  return entity;
}

function configureShadow(light, enabled) {
  if (!light) return;
  light.castShadow = Boolean(enabled);
  if (!enabled || !light.shadow) return;
  light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.02;
  if (light.shadow.camera) {
    const distance = Number(light.distance || 0);
    light.shadow.camera.near = 0.02;
    if (distance > 0) light.shadow.camera.far = Math.max(0.5, distance);
    light.shadow.camera.updateProjectionMatrix();
  }
  light.shadow.needsUpdate = true;
}

function ensureFiniteDistance(light, domain) {
  if (!light || !("distance" in light)) return;
  if (!(Number(light.distance) > 0)) light.distance = domain === "media_player" ? 3 : 6;
  light.distance = Math.min(Number(light.distance) || 6, 30);
}

function makeDirectionalMediaLight(panel, source, entity) {
  if (!source?.isPointLight || String(entity).split(".")[0] !== "media_player") return source;
  if (source.userData?.ha3dDirectionalReplacement) return source.userData.ha3dDirectionalReplacement;

  const spot = new THREE.SpotLight(
    source.color?.clone?.() || new THREE.Color(0xffffff),
    0,
    Number(source.distance || 3) || 3,
    Math.PI / 3,
    0.55,
    1.5,
  );
  spot.name = `${source.name || "Light"}__HA3DSpot`;
  spot.position.copy(source.position);
  spot.quaternion.copy(source.quaternion);
  spot.userData.ha3dBaseIntensity = source.userData.ha3dBaseIntensity || 1;
  spot.userData.ha3dOriginalColor = source.userData.ha3dOriginalColor?.clone?.() || source.color?.clone?.() || new THREE.Color(0xffffff);
  spot.userData.ha3dBaseDistance = Number(source.distance || 3) || 3;

  const target = new THREE.Object3D();
  target.name = `${spot.name}__target`;
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(source.quaternion).normalize();
  target.position.copy(source.position).add(forward.multiplyScalar(Math.max(1, spot.distance * 0.7)));

  const parent = source.parent || panel._model;
  parent.add(spot);
  parent.add(target);
  spot.target = target;
  source.intensity = 0;
  source.castShadow = false;
  source.userData.ha3dDirectionalReplacement = spot;
  return spot;
}

function collectAssociatedLights(panel, entity) {
  const result = [];
  for (const light of panel._modelLights || []) {
    let node = light;
    while (node && node !== panel._model?.parent) {
      const owner = node.userData?.ha3dEntityId || entityFromNode(panel, node);
      if (owner === entity) {
        result.push(makeDirectionalMediaLight(panel, light, entity));
        break;
      }
      if (node === panel._model) break;
      node = node.parent;
    }
  }
  return [...new Set(result)];
}

if (!proto.__ha3dGenericBindingV11) {
  proto.__ha3dGenericBindingV11 = true;

  const originalInitViewer = proto._initViewer;
  proto._initViewer = function (...args) {
    const result = originalInitViewer.apply(this, args);
    const loader = this._loader;
    if (loader?.loadAsync && !loader.__ha3dOriginalNameHook) {
      loader.__ha3dOriginalNameHook = true;
      const loadAsync = loader.loadAsync.bind(loader);
      loader.loadAsync = async (...loadArgs) => {
        const gltf = await loadAsync(...loadArgs);
        gltf.scene?.traverse((object) => {
          const index = gltf.parser?.associations?.get(object)?.nodes;
          const name = gltf.parser?.json?.nodes?.[index]?.name;
          if (name) object.userData.ha3dOriginalName = name;
        });
        return gltf;
      };
    }
    return result;
  };

  proto._indexBindings = function () {
    this._objectsByEntity.clear();
    this._boundCount = 0;

    this._model?.traverse((object) => {
      const entity = entityFromNode(this, object);
      if (!entity) return;
      object.userData.ha3dEntityId = entity;
      if (!this._objectsByEntity.has(entity)) this._objectsByEntity.set(entity, []);
      this._objectsByEntity.get(entity).push(object);
    });

    this._boundCount = this._objectsByEntity.size;
  };

  // Disable the old house-specific fallback list. Physical lights are owned
  // only by an entity-id node or LightNode_<entity_id> in their parent chain.
  proto._mappingForLight = function (light) {
    let node = light;
    while (node && node !== this._model?.parent) {
      const entity = node.userData?.ha3dEntityId || entityFromNode(this, node);
      if (entity) {
        const state = this._hass?.states?.[entity];
        return { entity, name: state?.attributes?.friendly_name || entity };
      }
      if (node === this._model) break;
      node = node.parent;
    }
    return null;
  };

  proto._bindModelLights = function () {
    // Markers are created in _bindEntityLightMarkers so the ordinary entity
    // object wins as anchor when both it and LightNode_<entity_id> exist.
    this.__ha3dLightsByEntity = new Map();
    for (const entity of this._objectsByEntity.keys()) {
      const lights = collectAssociatedLights(this, entity);
      if (lights.length) this.__ha3dLightsByEntity.set(entity, lights);
    }
  };

  proto._makeLightMarker = function (entity, name, anchor, light = null) {
    const existing = this._lightBindings.get(entity);
    if (existing) {
      if (light && !existing.lights.includes(light)) existing.lights.push(light);
      return existing;
    }

    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "lightMarker";
    marker.textContent = markerGlyph(entity, this._hass?.states?.[entity]);
    marker.title = name || entity;
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      this._openNativeMoreInfo(entity);
    });
    this.shadowRoot.querySelector("#markers").appendChild(marker);

    const lights = light ? [light] : [...(this.__ha3dLightsByEntity?.get(entity) || [])];
    const binding = {
      entity,
      name: name || entity,
      anchor,
      light: lights[0] || null,
      lights,
      marker,
      stateEntity: metadataStateEntity(this, entity, anchor),
    };
    this._lightBindings.set(entity, binding);
    return binding;
  };

  proto._bindEntityLightMarkers = function () {
    for (const [entity, objects] of this._objectsByEntity.entries()) {
      if (!objects.length) continue;
      const anchor = objects.find((object) => !isPhysicalNode(object)) || objects[0];
      const state = this._hass?.states?.[entity];
      const binding = this._makeLightMarker(entity, state?.attributes?.friendly_name || entity, anchor, null);
      const associated = this.__ha3dLightsByEntity?.get(entity) || [];
      for (const light of associated) {
        if (!binding.lights.includes(light)) binding.lights.push(light);
      }
      binding.light = binding.lights[0] || null;
      binding.stateEntity = metadataStateEntity(this, entity, anchor);
    }
    this._boundCount = this._lightBindings.size;
    const meta = this.shadowRoot?.querySelector("#meta");
    if (meta) meta.textContent = `${this._boundCount} vínculos`;
  };

  proto._restoreUnboundModelLights = function () {
    const bound = new Set();
    for (const binding of this._lightBindings.values()) {
      for (const light of binding.lights || []) bound.add(light);
    }
    for (const light of this._modelLights || []) {
      const replacement = light.userData?.ha3dDirectionalReplacement;
      if (replacement && bound.has(replacement)) continue;
      if (bound.has(light)) continue;
      // Preserve decorative/global GLB lighting exactly as the functional viewer did.
      light.intensity = light.userData.ha3dBaseIntensity || 0;
      light.color.copy(light.userData.ha3dOriginalColor || new THREE.Color(0xffffff));
      light.castShadow = Boolean(light.userData.ha3dOriginalCastShadow);
    }
  };

  proto._syncLightStates = function () {
    if (!this._hass || !this._lightBindings.size) return;
    for (const binding of this._lightBindings.values()) {
      const displayState = this._hass.states?.[binding.entity];
      const physicalState = this._hass.states?.[binding.stateEntity || binding.entity] || displayState;
      const unavailable = !displayState || displayState.state === "unavailable" || displayState.state === "unknown";
      const active = visualOn(binding.entity, physicalState);
      const attrs = physicalState?.attributes || {};
      const brightness = Number.isFinite(Number(attrs.brightness)) ? Number(attrs.brightness) : 255;

      binding.marker.classList.toggle("on", Boolean(active && !unavailable));
      binding.marker.classList.toggle("unavailable", unavailable);
      binding.marker.textContent = markerGlyph(binding.entity, displayState);
      binding.name = displayState?.attributes?.friendly_name || binding.entity;
      binding.marker.title = unavailable ? `${binding.name} — indisponível` : binding.name;

      for (const light of binding.lights || []) {
        const domain = binding.entity.split(".")[0];
        ensureFiniteDistance(light, domain);
        const base = light.userData.ha3dBaseIntensity || 1;
        light.intensity = active && physicalState ? base * Math.max(0.05, brightness / 255) : 0;

        const rgb = attrs.rgb_color;
        const hs = attrs.hs_color;
        if (Array.isArray(rgb) && rgb.length >= 3) {
          light.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
        } else if (Array.isArray(hs) && hs.length >= 2) {
          light.color.setHSL((((Number(hs[0]) % 360) + 360) % 360) / 360, Math.max(0, Math.min(100, Number(hs[1]))) / 100, 0.5);
        } else {
          light.color.copy(light.userData.ha3dOriginalColor || new THREE.Color(0xffffff));
        }
        configureShadow(light, Boolean(active && physicalState));
      }
    }
  };

  const originalHassDescriptor = Object.getOwnPropertyDescriptor(proto, "hass");
  if (originalHassDescriptor?.set && originalHassDescriptor?.get) {
    Object.defineProperty(proto, "hass", {
      configurable: true,
      get: originalHassDescriptor.get,
      set(value) {
        originalHassDescriptor.set.call(this, value);
        // If the model was loaded before a complete states map arrived, retry
        // generic name resolution without rebuilding the viewer or GLB.
        if (this._model) {
          const before = [...this._objectsByEntity.keys()].sort().join("|");
          this._indexBindings();
          const after = [...this._objectsByEntity.keys()].sort().join("|");
          if (after !== before || this._lightBindings.size !== this._objectsByEntity.size) {
            this._clearMarkers();
            this._bindModelLights();
            this._bindEntityLightMarkers();
            this._restoreUnboundModelLights();
          }
          this._syncLightStates();
        }
      },
    });
  }

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
    if (this._renderer?.shadowMap) this._renderer.shadowMap.enabled = true;
    this._syncLightStates();
    this.setAttribute("data-ha3d-binding", GENERIC_BINDING_VERSION);
    return result;
  };
}
