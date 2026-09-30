import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const POLL_MS = 200;
const PAUSED_POLL_MS = 650;
const CORE_FALLBACK_SIGNATURE = "canvas::Entidade indisponível:";

function selectedRuntime(panel) {
  const id = panel?._selectedObject?.userData?.ha3dMediaPanelId;
  return id ? panel?._ha3dMediaPanels?.get?.(id) || null : null;
}

function stopMjpeg(runtime) {
  const state = runtime?._ha3dMjpeg;
  if (!state) return;
  state.active = false;
  if (state.timer) window.clearTimeout(state.timer);
  state.timer = 0;
  if (state.image) {
    state.image.onload = null;
    state.image.onerror = null;
    state.image.removeAttribute("src");
  }
  runtime._ha3dMjpeg = null;
}

function stopAll(panel) {
  for (const runtime of panel?._ha3dMediaPanels?.values?.() || []) stopMjpeg(runtime);
}

function schedule(state, callback, delay) {
  if (!state.active) return;
  if (state.timer) window.clearTimeout(state.timer);
  state.timer = window.setTimeout(callback, delay);
}

function installMjpeg(panel, runtime) {
  if (!runtime?.config || runtime.config.source_type !== "mjpeg") {
    stopMjpeg(runtime);
    return;
  }

  const url = String(runtime.config.url || "").trim();
  const existing = runtime._ha3dMjpeg;
  if (existing?.active && existing.url === url) return;
  stopMjpeg(runtime);

  if (runtime.video) {
    try { runtime.video.pause?.(); } catch (_error) {}
    try { runtime.video.removeAttribute?.("src"); } catch (_error) {}
    try { runtime.video.load?.(); } catch (_error) {}
    runtime.video = null;
  }

  try { runtime.texture?.dispose?.(); } catch (_error) {}

  const image = new Image();
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  runtime.texture = texture;
  runtime.sourceSignature = CORE_FALLBACK_SIGNATURE;
  if (runtime._ha3dScreenPowered === false) runtime.material.map = null;
  else runtime.material.map = texture;
  runtime.material.color?.setHex?.(runtime._ha3dScreenPowered === false ? 0x000000 : 0xffffff);
  runtime.material.needsUpdate = true;

  const state = {
    active: true,
    url,
    image,
    texture,
    timer: 0,
    sequence: -1,
    failures: 0,
    busy: false,
  };
  runtime._ha3dMjpeg = state;

  image.onload = () => {
    if (!state.active || runtime._ha3dMjpeg !== state) return;
    texture.needsUpdate = true;
  };
  image.onerror = () => {
    state.failures += 1;
  };

  const poll = async () => {
    state.timer = 0;
    if (!state.active || runtime._ha3dMjpeg !== state) return;

    const canFetch = Boolean(
      runtime.config.enabled !== false
      && runtime.group?.visible !== false
      && runtime._ha3dScreenPowered !== false
      && url,
    );
    if (!canFetch || state.busy) {
      schedule(state, poll, PAUSED_POLL_MS);
      return;
    }

    state.busy = true;
    try {
      const payload = await panel._hass.callApi(
        "GET",
        `ha3d/mjpeg/frame/${encodeURIComponent(runtime.config.id)}`,
      );
      if (!state.active || runtime._ha3dMjpeg !== state) return;
      if (payload?.data && Number(payload.sequence) !== state.sequence) {
        state.sequence = Number(payload.sequence);
        state.failures = 0;
        image.src = `data:${payload.content_type || "image/jpeg"};base64,${payload.data}`;
      }
    } catch (error) {
      state.failures += 1;
      if (state.failures === 3) {
        console.warn("[HA3D] MJPEG stream unavailable", runtime.config.id, error);
      }
    } finally {
      state.busy = false;
      schedule(state, poll, state.failures ? PAUSED_POLL_MS : POLL_MS);
    }
  };

  poll();
}

function installAll(panel) {
  for (const runtime of panel?._ha3dMediaPanels?.values?.() || []) installMjpeg(panel, runtime);
}

function updateMjpegFormVisibility(panel) {
  const body = panel?.shadowRoot?.querySelector("#ha3dEditorBody");
  const select = body?.querySelector("#ha3dMpSource");
  if (!body || !select) return;
  const mjpeg = select.value === "mjpeg";
  const entityRow = body.querySelector("#ha3dMpEntity")?.closest?.(".ha3dRow");
  const attributeRow = body.querySelector("#ha3dMpAttribute")?.closest?.(".ha3dRow");
  if (entityRow) entityRow.style.display = mjpeg ? "none" : "";
  if (attributeRow) attributeRow.style.display = mjpeg ? "none" : "";
  const url = body.querySelector("#ha3dMpUrl");
  if (url && mjpeg) url.placeholder = "http://192.168.0.216:8080";
}

function decorateEditor(panel) {
  const runtime = selectedRuntime(panel);
  const body = panel?.shadowRoot?.querySelector("#ha3dEditorBody");
  const select = body?.querySelector("#ha3dMpSource");
  if (!runtime || !body || !select) return;

  if (!select.querySelector('option[value="mjpeg"]')) {
    const option = document.createElement("option");
    option.value = "mjpeg";
    option.textContent = "MJPEG ao vivo";
    select.appendChild(option);
  }
  if (runtime.config.source_type === "mjpeg") select.value = "mjpeg";

  if (!select.dataset.ha3dMjpegUi) {
    select.dataset.ha3dMjpegUi = "1";
    select.addEventListener("change", () => updateMjpegFormVisibility(panel));
  }

  updateMjpegFormVisibility(panel);
}

if (!proto.__ha3dMjpegV1) {
  proto.__ha3dMjpegV1 = true;

  const oldLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    stopAll(this);
    const result = await oldLoadModel?.apply(this, args);
    installAll(this);
    return result;
  };

  const oldSyncLightStates = proto._syncLightStates;
  proto._syncLightStates = function (...args) {
    const result = oldSyncLightStates?.apply(this, args);
    installAll(this);
    return result;
  };

  const oldRenderEditorForm = proto._renderEditorForm;
  proto._renderEditorForm = async function (...args) {
    const result = await oldRenderEditorForm?.apply(this, args);
    decorateEditor(this);
    return result;
  };

  const oldSelectMediaPanel = proto._selectMediaPanel;
  proto._selectMediaPanel = function (...args) {
    const result = oldSelectMediaPanel?.apply(this, args);
    queueMicrotask(() => decorateEditor(this));
    return result;
  };

  const oldSaveMediaPanelForm = proto._saveMediaPanelForm;
  proto._saveMediaPanelForm = async function (id, ...args) {
    const body = this.shadowRoot?.querySelector("#ha3dEditorBody");
    const source = body?.querySelector("#ha3dMpSource");
    if (!body || !source || source.value !== "mjpeg") {
      stopMjpeg(this._ha3dMediaPanels?.get?.(id));
      return oldSaveMediaPanelForm?.call(this, id, ...args);
    }

    const url = String(body.querySelector("#ha3dMpUrl")?.value || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      this._setStatus?.("MJPEG precisa de um endereço http:// ou https:// da rede local");
      return;
    }

    // Reuse the proven media-panel form persistence for all transform/options.
    // It does not know the new source yet, so save once as video then atomically
    // switch only source_type to mjpeg in the persisted configuration.
    source.value = "video";
    await oldSaveMediaPanelForm?.call(this, id, ...args);

    const saved = this._config?.media_panels?.find?.((item) => item.id === id);
    if (!saved) return;
    const mjpegConfig = {
      ...saved,
      source_type: "mjpeg",
      entity_id: null,
      image_attribute: "",
      url,
    };
    const panels = this._config.media_panels.map((item) => item.id === id ? mjpegConfig : item);

    try {
      this._config = await this._hass.callApi("POST", "ha3d/media_panels", { media_panels: panels });
      const runtime = this._ha3dMediaPanels?.get?.(id);
      if (runtime) {
        runtime.config = mjpegConfig;
        installMjpeg(this, runtime);
      }
      this._selectMediaPanel?.(id);
      queueMicrotask(() => decorateEditor(this));
      this._setStatus?.(`MJPEG ativo: ${mjpegConfig.name || id}`);
    } catch (error) {
      this._setStatus?.(`Erro ao salvar MJPEG: ${error.message || error}`);
    }
  };

  const oldConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = oldConnected?.apply(this, args);
    queueMicrotask(() => {
      installAll(this);
      decorateEditor(this);
    });
    return result;
  };

  const oldDisconnected = proto.disconnectedCallback;
  proto.disconnectedCallback = function (...args) {
    stopAll(this);
    return oldDisconnected?.apply(this, args);
  };
}
