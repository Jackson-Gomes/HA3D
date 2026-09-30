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

function isXrayActive(panel) {
  return Boolean(panel?.shadowRoot?.querySelector("#root")?.classList?.contains("ha3d-idle-xray"));
}

function syncVideoPlayback(runtime, shouldPlay) {
  const video = runtime?.video;
  if (!video) return;

  const wanted = Boolean(shouldPlay && runtime.config.enabled !== false && runtime.config.autoplay !== false);
  if (runtime._ha3dWantedPlaying === wanted) return;
  runtime._ha3dWantedPlaying = wanted;

  if (!wanted) {
    try { video.pause?.(); } catch (_error) {}
    return;
  }

  try { video.play?.().catch?.(() => {}); } catch (_error) {}
}

function syncScreenBlackout(runtime, powered) {
  const material = runtime?.material;
  if (!material) return;

  if (!powered) {
    // Hard blackout: physically detach the image/video texture from the material.
    // This prevents VideoTexture frames from remaining visible even if another
    // runtime layer updates the texture while the TV entity is off.
    if (material.map !== null) material.map = null;
    material.color?.setHex?.(0x000000);
    material.needsUpdate = true;
    runtime._ha3dScreenPowered = false;
    return;
  }

  // Restore whichever texture is currently owned by the media panel runtime.
  // runtime.texture is updated by image/video source changes, so this also
  // handles sources that loaded while the TV was powered off.
  const wantedMap = runtime.texture || null;
  if (material.map !== wantedMap) material.map = wantedMap;
  material.color?.setHex?.(0xffffff);
  material.needsUpdate = true;
  runtime._ha3dScreenPowered = true;
}

function applyPower(panel, runtime) {
  if (!runtime?.group || !runtime?.config) return;

  const powerEntity = defaultPowerEntity(runtime.config);
  const powered = !powerEntity || stateIsActive(powerEntity, panel?._hass?.states?.[powerEntity]);
  const xray = isXrayActive(panel);

  // X-Ray owns scene visibility: media screens must disappear completely while
  // the scanner/X-Ray presentation is active.
  runtime.group.visible = runtime.config.enabled !== false && !xray;

  // Power state owns the screen contents independently of visibility.
  syncScreenBlackout(runtime, powered);
  syncVideoPlayback(runtime, powered && !xray);
}

function syncAll(panel) {
  for (const runtime of panel?._ha3dMediaPanels?.values?.() || []) applyPower(panel, runtime);
}

function installFrameGuard(panel) {
  const renderer = panel?._renderer;
  if (!renderer?.render || renderer.__ha3dMediaPanelPowerFrameGuardV4) return;
  renderer.__ha3dMediaPanelPowerFrameGuardV4 = true;

  const originalRender = renderer.render.bind(renderer);
  renderer.render = (...args) => {
    syncAll(panel);
    return originalRender(...args);
  };
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
    <span class="ha3dHint">Opcional. TV/media player: playing, paused e idle = ligada; off, standby e unavailable = tela preta. No X-Ray a tela desaparece.</span>
  `;
  sourceRow?.insertAdjacentElement?.("afterend", row);
}

if (!proto.__ha3dMediaPanelPowerV4) {
  proto.__ha3dMediaPanelPowerV4 = true;

  const oldInitViewer = proto._initViewer;
  proto._initViewer = function (...args) {
    const result = oldInitViewer?.apply(this, args);
    installFrameGuard(this);
    return result;
  };

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
    installFrameGuard(this);
    syncAll(this);
    return result;
  };

  const oldConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = oldConnected?.apply(this, args);
    queueMicrotask(() => {
      installFrameGuard(this);
      syncAll(this);
    });
    return result;
  };
}
