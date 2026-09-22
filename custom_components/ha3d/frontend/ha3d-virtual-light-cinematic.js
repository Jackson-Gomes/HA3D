const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const TOKEN_PREFIX = "__ha3d_virtual_light__:";

function tokenFor(id) {
  return `${TOKEN_PREFIX}${id}`;
}

function idFromToken(value) {
  const text = String(value || "");
  return text.startsWith(TOKEN_PREFIX) ? text.slice(TOKEN_PREFIX.length) : null;
}

function virtualConfigs(panel) {
  return Array.isArray(panel?._config?.virtual_lights) ? panel._config.virtual_lights : [];
}

function virtualIdsForEntity(panel, entity) {
  return virtualConfigs(panel)
    .filter((item) => item?.entity_id === entity && item?.id)
    .map((item) => item.id);
}

function ensureLocalState(panel) {
  panel._ha3dVirtualCinematicLocalState ||= new Map();
  return panel._ha3dVirtualCinematicLocalState;
}

function localVirtualState(config) {
  return config?.enabled === false ? "off" : "on";
}

function installSyntheticBindings(panel, entities) {
  const installed = [];
  const bindings = panel?._lightBindings;
  if (!bindings?.set) return installed;

  for (const entity of entities || []) {
    const id = idFromToken(entity);
    if (!id) continue;
    const runtime = panel._ha3dVirtualLights?.get?.(id);
    if (!runtime?.handle) continue;

    const had = bindings.has(entity);
    const previous = bindings.get(entity);
    const marker = panel._ha3dVirtualLightMarkers?.get?.(id) || document.createElement("span");
    bindings.set(entity, {
      entity,
      name: runtime.config?.name || id,
      anchor: runtime.handle,
      light: runtime.light || null,
      lights: runtime.light ? [runtime.light] : [],
      marker,
      ha3dVirtualCinematic: true,
    });
    installed.push({ entity, had, previous });
  }

  return installed;
}

function restoreSyntheticBindings(panel, installed) {
  const bindings = panel?._lightBindings;
  if (!bindings) return;
  for (const item of installed) {
    if (item.had) bindings.set(item.entity, item.previous);
    else bindings.delete(item.entity);
  }
}

function updateVirtualMarkerFocus(panel, entities) {
  const focusedIds = new Set((entities || []).map(idFromToken).filter(Boolean));
  for (const [id, marker] of panel?._ha3dVirtualLightMarkers?.entries?.() || []) {
    marker.style.display = focusedIds.has(id) ? "" : "none";
  }
}

function restoreVirtualMarkers(panel) {
  for (const marker of panel?._ha3dVirtualLightMarkers?.values?.() || []) {
    marker.style.display = "";
  }
}

if (!proto.__ha3dVirtualLightCinematicV1) {
  proto.__ha3dVirtualLightCinematicV1 = true;

  // When an HA entity owns one or more runtime-created lights, cinematic focus
  // should target those lights instead of the old GLB/entity anchor.
  const oldQueue = proto._queueCinematicFocus;
  proto._queueCinematicFocus = function (entity, ...args) {
    if (!idFromToken(entity)) {
      const ids = virtualIdsForEntity(this, entity);
      if (ids.length) {
        let result;
        for (const id of ids) result = oldQueue?.call(this, tokenFor(id), ...args);
        return result;
      }
    }
    return oldQueue?.call(this, entity, ...args);
  };

  // Unbound virtual lights can still be toggled locally from their marker. They
  // have no HA entity to trigger the original cinematic state detector, so keep
  // a tiny state cache for those lights only.
  const oldSync = proto._syncLightStates;
  proto._syncLightStates = function (...args) {
    const stateCache = ensureLocalState(this);
    const changed = [];
    const activeIds = new Set();

    for (const config of virtualConfigs(this)) {
      if (!config?.id || config.entity_id) continue;
      activeIds.add(config.id);
      const next = localVirtualState(config);
      const previous = stateCache.get(config.id);
      if (
        this._cinematicEnabled &&
        (previous === "on" || previous === "off") &&
        previous !== next
      ) {
        changed.push(tokenFor(config.id));
      }
      stateCache.set(config.id, next);
    }

    for (const id of [...stateCache.keys()]) {
      if (!activeIds.has(id)) stateCache.delete(id);
    }

    const result = oldSync?.apply(this, args);
    for (const token of changed) this._queueCinematicFocus?.(token);
    return result;
  };

  // Reuse the proven cinematic camera path by exposing virtual light handles as
  // temporary bindings only while _runCinematicFocus resolves its anchors.
  const oldRun = proto._runCinematicFocus;
  proto._runCinematicFocus = function (entities, ...args) {
    const list = Array.isArray(entities) ? entities : [];
    const installed = installSyntheticBindings(this, list);
    try {
      return oldRun?.call(this, entities, ...args);
    } finally {
      restoreSyntheticBindings(this, installed);
    }
  };

  const oldMarkerFocus = proto._setCinematicMarkerFocus;
  proto._setCinematicMarkerFocus = function (entities, ...args) {
    const result = oldMarkerFocus?.call(this, entities, ...args);
    updateVirtualMarkerFocus(this, entities);
    return result;
  };

  const oldRestoreUi = proto._restoreCinematicUi;
  proto._restoreCinematicUi = function (...args) {
    const result = oldRestoreUi?.apply(this, args);
    restoreVirtualMarkers(this);
    return result;
  };
}
