import * as THREE from "https://esm.sh/three@0.180.0";
import { applyShadowBudget } from "./ha3d-lighting.js?v=20260919-3";

const RECOVERY_VERSION = "20260919-4";
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const MEDIA_ACTIVE = new Set(["on", "playing", "paused", "idle"]);

function rawNodeName(object) {
  return object?.userData?.ha3dNodeName ?? object?.userData?.name ?? object?.name ?? "";
}

function stripLightPrefix(value) {
  return String(value || "").replace(/^LightNode_/i, "");
}

function normalize(value) {
  return stripLightPrefix(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_./:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compact(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, "");
}

function simplified(value) {
  const stop = new Set(["luz", "light", "lamp", "lampada", "iluminacao", "node", "mesh", "device", "dispositivo", "da", "do", "de", "das", "dos"]);
  return normalize(value).split(" ").filter((token) => token && !stop.has(token)).join(" ");
}

function stateAliases(entity, state) {
  const result = new Set();
  const objectId = entity.split(".")[1] || entity;
  const friendly = state?.attributes?.friendly_name || "";
  for (const value of [entity, objectId, friendly]) {
    if (!value) continue;
    result.add(compact(value));
    result.add(compact(simplified(value)));
  }
  return [...result].filter(Boolean);
}

function buildAliasIndex(hass) {
  const index = new Map();
  for (const [entity, state] of Object.entries(hass?.states || {})) {
    for (const alias of stateAliases(entity, state)) {
      if (!index.has(alias)) index.set(alias, []);
      index.get(alias).push(entity);
    }
  }
  return index;
}

function resolveEntity(name, hass, explicit = null, allowFuzzy = false) {
  const forced = stripLightPrefix(explicit);
  if (ENTITY_ID.test(forced)) return forced;

  const stripped = stripLightPrefix(name);
  if (ENTITY_ID.test(stripped)) return stripped;

  const states = hass?.states || {};
  if (!Object.keys(states).length) return null;

  // GLTFLoader may sanitize the dot in entity_id. Compact comparison recovers it.
  const exactCompact = compact(stripped);
  const aliasIndex = buildAliasIndex(hass);
  const direct = aliasIndex.get(exactCompact) || [];
  if (direct.length === 1) return direct[0];

  const simpleCompact = compact(simplified(stripped));
  const simple = aliasIndex.get(simpleCompact) || [];
  if (simple.length === 1) return simple[0];

  if (!allowFuzzy) return null;

  // Final generic fallback: the node tokens must be a unique subset of one HA alias.
  const nodeTokens = new Set(simplified(stripped).split(" ").filter(Boolean));
  if (!nodeTokens.size) return null;
  const scored = [];
  for (const [entity, state] of Object.entries(states)) {
    let best = 0;
    for (const alias of [simplified(entity.split(".")[1] || entity), simplified(state?.attributes?.friendly_name || "")]) {
      const tokens = new Set(alias.split(" ").filter(Boolean));
      if ([...nodeTokens].every((token) => tokens.has(token))) {
        best = Math.max(best, 50 + nodeTokens.size * 5 - Math.max(0, tokens.size - nodeTokens.size));
      }
    }
    if (best) scored.push([entity, best]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0][1] === scored[1][1]) return null;
  return scored[0][0];
}

function addCandidate(candidates, owners, object, entity) {
  if (!entity) return;
  if (!candidates.has(entity)) {
    candidates.set(entity, { entity, objects: [], lights: [], metadata: {} });
  }
  const candidate = candidates.get(entity);
  if (!candidate.objects.includes(object)) candidate.objects.push(object);
  const name = rawNodeName(object);
  const physical = /^LightNode_/i.test(name) || object.isLight;
  if (!candidate.anchor || (!physical && !candidate.deviceAnchor)) candidate.anchor = object;
  if (!physical) candidate.deviceAnchor = true;
  candidate.metadata = physical
    ? { ...(object.userData?.ha3d || {}), ...candidate.metadata }
    : { ...candidate.metadata, ...(object.userData?.ha3d || {}) };
  owners.set(object, candidate);
}

function linkDescendantLights(candidate, object) {
  object?.traverse?.((child) => {
    if (!child.isLight || candidate.lights.includes(child)) return;
    candidate.lights.push(child);
    child.userData.ha3dCandidate = candidate.entity;
  });
}

function similarity(a, b) {
  const aa = new Set(simplified(a).split(" ").filter(Boolean));
  const bb = new Set(simplified(b).split(" ").filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  const intersection = [...aa].filter((token) => bb.has(token)).length;
  return intersection / Math.max(aa.size, bb.size);
}

function reliableMediaSource(hass, entity, state) {
  if (!state?.attributes?.assumed_state) return { entity, state };

  const registry = hass?.entities || {};
  const currentRegistry = registry?.[entity];
  const currentDevice = currentRegistry?.device_id;
  const currentName = `${entity} ${state?.attributes?.friendly_name || ""}`;
  let best = null;

  for (const [candidateEntity, candidateState] of Object.entries(hass?.states || {})) {
    if (candidateEntity === entity || !candidateEntity.startsWith("media_player.")) continue;
    if (!candidateState || ["unknown", "unavailable"].includes(candidateState.state)) continue;
    if (candidateState.attributes?.assumed_state === true) continue;

    let score = similarity(currentName, `${candidateEntity} ${candidateState.attributes?.friendly_name || ""}`) * 100;
    if (currentDevice && registry?.[candidateEntity]?.device_id === currentDevice) score += 200;
    if (candidateState.attributes?.device_class === "tv") score += 20;

    if (!best || score > best.score) best = { entity: candidateEntity, state: candidateState, score };
  }

  return best && best.score >= 45 ? best : { entity, state };
}

function isMediaOn(state) {
  return Boolean(state && !["unknown", "unavailable", "off", "standby"].includes(state.state) && MEDIA_ACTIVE.has(state.state));
}

if (!proto.__ha3dRecoveryV4) {
  proto.__ha3dRecoveryV4 = true;

  const originalCollectModelLights = proto._collectModelLights;
  proto._collectModelLights = function (...args) {
    const result = originalCollectModelLights.apply(this, args);
    for (const light of this._modelLights || []) {
      if (!(Number(light.userData?.ha3dBaseIntensity) > 0)) {
        // Keep the old viewer behavior: exported zero-intensity helper lights
        // are still usable as HA-controlled physical lights.
        light.userData.ha3dBaseIntensity = 40;
      }
    }
    return result;
  };

  proto._indexBindings = function () {
    this._objectsByEntity.clear();
    this._pendingBindings = new Map();
    this._ha3dUnresolvedCandidates = [];
    const owners = new Map();
    const config = this._config || {};
    const autoBind = config.auto_bind !== false;

    this._model?.traverse((object) => {
      const name = rawNodeName(object);
      if (!name) return;
      const explicit = config.bindings?.[name] ?? config.bindings?.[object.name];
      const lightNode = /^LightNode_/i.test(name);
      const entity = explicit
        ? resolveEntity(name, this._hass, explicit, true)
        : autoBind ? resolveEntity(name, this._hass, null, lightNode) : null;

      if (entity) {
        addCandidate(this._pendingBindings, owners, object, entity);
      } else if (
        autoBind &&
        (/^LightNode_/i.test(name) || /^(light|switch|media_player|vacuum|climate|cover|lock|fan|binary_sensor|sensor|button)[._]/i.test(name))
      ) {
        this._ha3dUnresolvedCandidates.push(object);
      }
    });

    this._model?.traverse((light) => {
      if (!light.isLight) return;
      for (let node = light; node; node = node.parent) {
        const candidate = owners.get(node);
        if (candidate) {
          if (!candidate.lights.includes(light)) candidate.lights.push(light);
          light.userData.ha3dCandidate = candidate.entity;
          break;
        }
        if (node === this._model) break;
      }
    });

    for (const light of this._modelLights || []) {
      light.userData.ha3dDesiredIntensity = light.userData.ha3dCandidate
        ? 0
        : (light.userData.ha3dBaseIntensity || 0) * 0.30;
    }
  };

  const originalResolvePending = proto._resolvePendingBindings;
  proto._resolvePendingBindings = function (...args) {
    if (this._model && this._hass && this._ha3dUnresolvedCandidates?.length) {
      const stillPending = [];
      for (const object of this._ha3dUnresolvedCandidates) {
        const name = rawNodeName(object);
        const entity = resolveEntity(name, this._hass, null, /^LightNode_/i.test(name));
        if (!entity) {
          stillPending.push(object);
          continue;
        }

        let candidate = this._pendingBindings.get(entity);
        if (!candidate) {
          candidate = { entity, objects: [], lights: [], metadata: {} };
          this._pendingBindings.set(entity, candidate);
        }
        if (!candidate.objects.includes(object)) candidate.objects.push(object);
        const physical = /^LightNode_/i.test(name) || object.isLight;
        if (!candidate.anchor || (!physical && !candidate.deviceAnchor)) candidate.anchor = object;
        if (!physical) candidate.deviceAnchor = true;
        candidate.metadata = { ...candidate.metadata, ...(object.userData?.ha3d || {}) };
        linkDescendantLights(candidate, object);
      }
      this._ha3dUnresolvedCandidates = stillPending;
    }

    const result = originalResolvePending.apply(this, args);

    // Some HA themes/builds take a moment to upgrade <ha-icon>; keep markers
    // visible even while the icon web component is loading.
    for (const binding of this._lightBindings?.values?.() || []) {
      if (!binding.marker) continue;
      binding.marker.style.opacity = "1";
      binding.marker.style.display = "grid";
    }
    return result;
  };

  const originalSync = proto._syncLightStates;
  proto._syncLightStates = function (...args) {
    const result = originalSync.apply(this, args);

    // If the GLB points at an assumed media_player entity, prefer a reliable
    // sibling entity from the same HA device (or a uniquely similar TV entity).
    for (const binding of this._lightBindings?.values?.() || []) {
      if (!binding.entity?.startsWith("media_player.") || !binding.lights?.length) continue;
      const reported = this._hass?.states?.[binding.entity];
      const source = reliableMediaSource(this._hass, binding.entity, reported);
      if (!source?.state || source.entity === binding.entity) continue;

      const active = isMediaOn(source.state);
      for (const light of binding.lights) {
        const base = Number(light.userData?.ha3dBaseIntensity) > 0 ? light.userData.ha3dBaseIntensity : 40;
        light.userData.ha3dDesiredIntensity = active ? base : 0;
      }
      binding.marker?.classList.toggle("on", active);
      binding.marker?.classList.toggle("unavailable", false);
      binding.marker?.setAttribute("data-ha3d-state-source", source.entity);
    }

    // Give bound lights enough budget to remain useful on phones while still
    // requiring real shadows for physical lights.
    const mobile = window.matchMedia?.("(pointer: coarse)").matches;
    applyShadowBudget(this._modelLights || [], mobile ? 48 : 96);
    return result;
  };

  const originalMoreInfo = proto._openNativeMoreInfo;
  proto._openNativeMoreInfo = function (entityId) {
    originalMoreInfo.call(this, entityId);
    try {
      const root = document.querySelector("home-assistant");
      root?.dispatchEvent(new CustomEvent("hass-more-info", {
        detail: { entityId },
        bubbles: true,
        composed: true,
      }));
    } catch (_error) {}
  };

  // Scene module runs before this recovery module. Keep its positional global
  // light, but use it only as fill: no global shadow map and a stronger baseline.
  const originalEnsureGlobal = proto._ensureGlobalDirectionalLight;
  if (originalEnsureGlobal) {
    proto._ensureGlobalDirectionalLight = function (...args) {
      const light = originalEnsureGlobal.apply(this, args);
      if (light) {
        light.castShadow = false;
        light.shadow?.dispose?.();
      }
      return light;
    };
  }

  const originalApplyGlobal = proto._applyGlobalLightSettings;
  if (originalApplyGlobal) {
    proto._applyGlobalLightSettings = function (...args) {
      const result = originalApplyGlobal.apply(this, args);
      const pct = Math.max(0, Math.min(100, Number(this._globalLightPct ?? 50)));
      const scale = pct / 50;
      if (this._ha3dGlobalAmbient) {
        const base = Number(this._ha3dGlobalAmbient.userData?.ha3dBaseIntensity) || 0.55;
        this._ha3dGlobalAmbient.intensity = base * scale;
      }
      if (this._ha3dGlobalDirectional) {
        this._ha3dGlobalDirectional.castShadow = false;
        this._ha3dGlobalDirectional.intensity = 0.35 * scale;
        this._ha3dGlobalDirectional.shadow?.dispose?.();
      }
      return result;
    };
  }

  const originalLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await originalLoadModel.apply(this, args);
    this.setAttribute("data-ha3d-recovery", RECOVERY_VERSION);
    this._setStatus?.(`Pronto · ${RECOVERY_VERSION} · ${this._boundCount} vínculos`);
    return result;
  };
}
