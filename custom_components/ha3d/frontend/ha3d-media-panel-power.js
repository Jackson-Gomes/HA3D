const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const OFF_STATES = new Set(["off", "standby", "unknown", "unavailable"]);
const POWER_DOMAINS = new Set(["media_player", "light", "switch", "input_boolean", "binary_sensor"]);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function selectedRuntime(panel) {
  const id = panel?._selectedObject?.userData?.ha3dMediaPanelId;
  return id ? panel?._ha3dMediaPanels?.get?.(id) || null : null;
}

function defaultPowerEntity(config) {
  if (config?.power_entity_id) return config.power_entity_id;
  if (config?.source_type === "entity" && String(config?.entity_id || "").startsWith("media_player.")) {
    return config.entity_id;
  }
  return null;
}

function stateIsActive(entityId, state) {
  if (!state) return false;
  const value = String(state.state || "").toLowerCase();
  if (entityId?.startsWith("media_player.")) return !OFF_STATES.has(value);
  if (["light.", "switch.", "input_boolean.", "binary_sensor."].some((prefix) => entityId?.startsWith(prefix))) {
    return value === "on";
  }
  return !OFF_STATES.has(value);
}

function syncVideoPlayback(runtime, powered) {
  const video = runtime?.video;
  if (!video) return;

  if (!powered || runtime.config.enabled === false || runtime.config.autoplay === false) {
    try { video.pause?.(); } catch (_error) {}
    return;
  }

  try { video.play?.().catch?.(() => {}); } catch (_error) {}
}

function syncScreenBlackout(runtime, powered) {
  if (!runtime?.material) return;
  // Preserve the existing texture/video. Black material color hides it like a
  // powered-off TV, so turning the entity back on restores the same source.
  runtime.material.color?.setHex?.(powered ? 0xffffff : 0x000000);
  runtime.material.needsUpdate = true;
}

function applyPower(panel, runtime) {
  if (!runtime?.group || !runtime?.config) return;

  const powerEntity = defaultPowerEntity(runtime.config);
  const powered = !powerEntity || stateIsActive(powerEntity, panel?._hass?.states?.[powerEntity]);

  // The physical TV remains visible when off: only its display goes black.
  runtime.group.visible = runtime.config.enabled !== false;
  syncScreenBlackout(runtime, powered);
  syncVideoPlayback(runtime, powered);
}

function syncAll(panel) {
  for (const runtime of panel?._ha3dMediaPanels?.values?.() || []) applyPower(panel, runtime);
}

function powerOptions(panel) {
  return Object.entries(panel?._hass?.states || {})
    .filter(([entityId]) => POWER_DOMAINS.has(entityId.split(".")[0]))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entityId, state]) => {
      const friendly = state?.attributes?.friendly_name || entityId;
      return `<option value="${escapeHtml(entityId)}">${escapeHtml(friendly)}</option>`;
    })
    .join("");
}

function installPowerField(panel) {
  const runtime = selectedRuntime(panel);
  const body = panel?.shadowRoot?.querySelector("#ha3dEditorBody");
  if (!runtime || !body || body.querySelector("#ha3dMpPowerEntity")) return;

  const config = runtime.config;
  const sourceRow = body.querySelector("#ha3dMpEntity")?.closest?.(".ha3dRow")
    || body.querySelector("#ha3dMpUrl")?.closest?.(".ha3dRow")
    || body.firstElementChild;

  const row = document.createElement("div");
  row.className = "ha3dRow";
  row.innerHTML = `
    <label>Liga/desliga com</label>
    <input id="ha3dMpPowerEntity" list="ha3dMpPowerEntities" autocomplete="off"
      placeholder="media_player.tv_da_sala" value="${escapeHtml(config.power_entity_id || "")}">
    <datalist id="ha3dMpPowerEntities">${powerOptions(panel)}</datalist>
    <span class="ha3dHint">Opcional. TV/media player: playing, paused e idle = ligada; off, standby e unavailable = tela preta. Luz/switch: segue on/off.</span>
  `;
  sourceRow?.insertAdjacentElement?.("afterend", row);
}

if (!proto.__ha3dMediaPanelPowerV3) {
  proto.__ha3dMediaPanelPowerV3 = true;

  const oldRenderEditorForm = proto._renderEditorForm;
  proto._renderEditorForm = async function (...args) {
    const result = await oldRenderEditorForm?.apply(this, args);
    installPowerField(this);
    return result;
  };

  const oldSaveMediaPanelForm = proto._saveMediaPanelForm;
  proto._saveMediaPanelForm = async function (id, ...args) {
    const runtime = this._ha3dMediaPanels?.get?.(id);
    const input = this.shadowRoot?.querySelector("#ha3dMpPowerEntity");
    if (runtime && input) {
      const value = input.value.trim();
      if (value && !this._hass?.states?.[value]) {
        this._setStatus?.(`Entidade de liga/desliga não encontrada: ${value}`);
        return;
      }
      runtime.config.power_entity_id = value || null;
    }
    const result = await oldSaveMediaPanelForm?.call(this, id, ...args);
    syncAll(this);
    return result;
  };

  const oldSyncLightStates = proto._syncLightStates;
  proto._syncLightStates = function (...args) {
    const result = oldSyncLightStates?.apply(this, args);
    syncAll(this);
    return result;
  };

  const oldToggleEditor = proto._toggleEditor;
  proto._toggleEditor = function (...args) {
    const result = oldToggleEditor?.apply(this, args);
    syncAll(this);
    if (this._editorMode) queueMicrotask(() => installPowerField(this));
    return result;
  };

  const oldSelectMediaPanel = proto._selectMediaPanel;
  proto._selectMediaPanel = function (...args) {
    const result = oldSelectMediaPanel?.apply(this, args);
    queueMicrotask(() => installPowerField(this));
    return result;
  };

  const oldLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await oldLoadModel?.apply(this, args);
    syncAll(this);
    return result;
  };
}
