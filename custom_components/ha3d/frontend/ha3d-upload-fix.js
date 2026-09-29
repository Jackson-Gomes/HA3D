const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const MAX_MODEL_BYTES = 512 * 1024 * 1024;

function mib(bytes) {
  return (Number(bytes || 0) / 1048576).toFixed(1);
}

if (!proto.__ha3dUploadFixV1) {
  proto.__ha3dUploadFixV1 = true;

  proto._uploadModel = async function (file) {
    if (!this._hass?.user?.is_admin) return;
    if (!file?.name?.toLowerCase().endsWith(".glb")) {
      this._setStatus?.("Selecione um arquivo .glb");
      return;
    }
    if (Number(file.size || 0) > MAX_MODEL_BYTES) {
      this._setStatus?.(`GLB muito grande: ${mib(file.size)} MiB · máximo 512 MiB`);
      return;
    }

    const form = new FormData();
    form.append("file", file, file.name);
    this._setStatus?.(`Enviando ${file.name} · ${mib(file.size)} MiB…`);
    this._setUploadEnabled?.(false);

    try {
      const response = await this._hass.fetchWithAuth("/api/ha3d/model", {
        method: "POST",
        body: form,
      });

      const text = await response.text();
      let result = null;
      if (text) {
        try {
          result = JSON.parse(text);
        } catch (_error) {
          result = null;
        }
      }

      if (!response.ok) {
        const detail = result?.error || text.trim() || response.statusText || "falha no upload";
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }
      if (!result?.model_url) {
        throw new Error("Resposta inválida do servidor após o upload");
      }

      this._config = {
        ...(this._config || {}),
        model_url: result.model_url,
        model_revision: result.model_revision,
      };
      await this._loadModel(this._versionedModelUrl(result.model_url, result.model_revision));
      this._setStatus?.(`GLB atualizado · ${mib(result.bytes || file.size)} MiB`);
    } catch (error) {
      console.error("[HA3D] upload", error);
      this._setStatus?.(`Falha no upload: ${error.message || error}`);
    } finally {
      this._setUploadEnabled?.(true);
    }
  };
}
