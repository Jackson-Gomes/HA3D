const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function installSkpUi(panel) {
  const root = panel?.shadowRoot;
  if (!root) return;

  const uploadButton = root.querySelector("#uploadButton");
  const fileInput = root.querySelector("#fileInput");
  const emptyUploadButton = root.querySelector("#emptyUploadButton");
  const emptyParagraph = root.querySelector("#emptyCard p");

  if (uploadButton) uploadButton.textContent = "Subir GLB/SKP";
  if (emptyUploadButton) emptyUploadButton.textContent = "Escolher GLB/SKP";
  if (fileInput) fileInput.accept = ".glb,.skp,model/gltf-binary,application/octet-stream";
  if (emptyParagraph) {
    emptyParagraph.innerHTML = "Suba um arquivo <strong>GLB</strong> ou <strong>SKP</strong>. SKP é convertido automaticamente para GLB dentro do Home Assistant.";
  }
}

if (!proto.__ha3dSkpImportV1) {
  proto.__ha3dSkpImportV1 = true;

  const oldRenderShell = proto._renderShell;
  proto._renderShell = function (...args) {
    const result = oldRenderShell?.apply(this, args);
    queueMicrotask(() => installSkpUi(this));
    return result;
  };

  const oldLoadConfig = proto._loadConfig;
  proto._loadConfig = async function (...args) {
    const result = await oldLoadConfig?.apply(this, args);
    installSkpUi(this);
    if (!this._config?.model_url) this._setStatus?.("Envie um modelo GLB ou SKP");
    return result;
  };

  const oldUploadModel = proto._uploadModel;
  proto._uploadModel = async function (file) {
    const name = String(file?.name || "");
    const lower = name.toLowerCase();

    if (lower.endsWith(".glb")) return oldUploadModel?.call(this, file);
    if (!lower.endsWith(".skp")) {
      this._setStatus?.("Selecione um arquivo .glb ou .skp");
      return;
    }
    if (!this._hass?.user?.is_admin) return;

    const form = new FormData();
    form.append("file", file, name);
    this._setStatus?.(`Enviando e convertendo ${name}…`);
    this._setUploadEnabled?.(false);

    try {
      const response = await this._hass.fetchWithAuth("/api/ha3d/model/skp", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) {
        const detail = result?.message ? `${result.error}: ${result.message}` : (result?.error || `HTTP ${response.status}`);
        throw new Error(detail);
      }

      this._config = {
        ...(this._config || {}),
        model_url: result.model_url,
        model_revision: result.model_revision,
      };
      await this._loadModel(this._versionedModelUrl(result.model_url, result.model_revision));
      this._setStatus?.(`SKP convertido · ${(Number(result.bytes || 0) / 1048576).toFixed(1)} MB · pronto`);
    } catch (error) {
      console.error("[HA3D] SKP import", error);
      this._setStatus?.(`Falha ao importar SKP: ${error.message || error}`);
    } finally {
      this._setUploadEnabled?.(true);
    }
  };
}
