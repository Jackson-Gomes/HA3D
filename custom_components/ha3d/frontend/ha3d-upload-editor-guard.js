const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const UI_GUARD_MS = 520;

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function armEditorUiGuard(panel, duration = UI_GUARD_MS) {
  panel._ha3dEditorUiGuardUntil = Math.max(
    Number(panel._ha3dEditorUiGuardUntil) || 0,
    nowMs() + duration,
  );
}

function editorUiGuardActive(panel) {
  return nowMs() < (Number(panel?._ha3dEditorUiGuardUntil) || 0);
}

function installEditorUiGuard(panel) {
  const editor = panel?.shadowRoot?.querySelector("#ha3dEditor");
  if (!editor || editor.dataset.ha3dUiGuard === "1") return;
  editor.dataset.ha3dUiGuard = "1";

  const arm = () => armEditorUiGuard(panel);
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "change", "input", "focusin"]) {
    editor.addEventListener(type, arm, { capture: true });
  }
}

async function responseJsonOrText(response) {
  const text = await response.text();
  if (!text) return { payload: null, text: "" };
  try {
    return { payload: JSON.parse(text), text };
  } catch (_error) {
    return { payload: null, text };
  }
}

if (!proto.__ha3dUploadEditorGuardV1) {
  proto.__ha3dUploadEditorGuardV1 = true;

  const oldWireUi = proto._wireUi;
  proto._wireUi = function (...args) {
    const result = oldWireUi?.apply(this, args);
    queueMicrotask(() => installEditorUiGuard(this));
    return result;
  };

  const oldSelectVirtualLight = proto._selectVirtualLight;
  if (oldSelectVirtualLight) {
    proto._selectVirtualLight = function (...args) {
      armEditorUiGuard(this, 700);
      const result = oldSelectVirtualLight.apply(this, args);
      queueMicrotask(() => installEditorUiGuard(this));
      return result;
    };
  }

  const oldPickObject = proto._pickObject;
  proto._pickObject = function (event) {
    if (this._editorMode && editorUiGuardActive(this)) {
      return this._selectedObject || null;
    }
    return oldPickObject?.call(this, event) || null;
  };

  const oldPick = proto._pick;
  proto._pick = function (event) {
    if (this._editorMode && editorUiGuardActive(this)) return;
    return oldPick?.call(this, event);
  };

  proto._uploadModel = async function (file) {
    if (!this._hass?.user?.is_admin) return;
    if (!file?.name?.toLowerCase?.().endsWith(".glb")) {
      this._setStatus?.("Selecione um arquivo .glb");
      return;
    }

    const form = new FormData();
    form.append("file", file, file.name);
    const replacing = Boolean(this._config?.model_url || this._model);
    this._setStatus?.(`${replacing ? "Substituindo" : "Enviando"} ${file.name}…`);
    this._setUploadEnabled?.(false);

    try {
      const response = await this._hass.fetchWithAuth("/api/ha3d/model", {
        method: "POST",
        body: form,
      });
      const { payload, text } = await responseJsonOrText(response);

      if (!response.ok) {
        const serverError = payload?.error;
        const plain = String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        throw new Error(serverError || plain.slice(0, 180) || `HTTP ${response.status}`);
      }
      if (!payload?.model_url) {
        throw new Error("Resposta inválida ao substituir o GLB");
      }

      this._config = {
        ...(this._config || {}),
        model_url: payload.model_url,
        model_revision: payload.model_revision,
      };
      await this._loadModel(this._versionedModelUrl(payload.model_url, payload.model_revision));
      this._setStatus?.(`GLB substituído · ${file.name}`);
    } catch (error) {
      console.error("[HA3D] upload", error);
      this._setStatus?.(`Falha no upload: ${error?.message || error}`);
    } finally {
      this._setUploadEnabled?.(true);
    }
  };
}
