const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

function selectedMediaId(panel) {
  return panel?._selectedObject?.userData?.ha3dMediaPanelId || "";
}

function accepted(kind) {
  return kind === "video"
    ? "video/mp4,video/webm,video/ogg,.mp4,.webm,.ogv,.ogg"
    : "image/jpeg,image/png,image/webp,image/gif,image/avif,.jpg,.jpeg,.png,.webp,.gif,.avif";
}

async function uploadMedia(panel, kind, file, id) {
  if (!panel?._hass?.user?.is_admin || !file || !id) return;
  const body = panel.shadowRoot?.querySelector("#ha3dEditorBody");
  if (!body) return;

  const form = new FormData();
  form.append("file", file, file.name);
  panel._setStatus?.(`Enviando ${kind === "video" ? "vídeo" : "imagem"}: ${file.name}…`);

  try {
    const response = await panel._hass.fetchWithAuth("/api/ha3d/media/upload", {
      method: "POST",
      body: form,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);

    const source = body.querySelector("#ha3dMpSource");
    const url = body.querySelector("#ha3dMpUrl");
    if (source) source.value = result.kind === "video" ? "video" : "image";
    if (url) url.value = result.url || "";

    await panel._saveMediaPanelForm?.(id);
    panel._setStatus?.(`${result.kind === "video" ? "Vídeo" : "Imagem"} aplicado à tela`);
  } catch (error) {
    console.error("[HA3D] media upload failed", error);
    panel._setStatus?.(`Erro no upload: ${error.message || error}`);
  }
}

function addUploadControls(panel) {
  const id = selectedMediaId(panel);
  if (!id) return;
  const body = panel?.shadowRoot?.querySelector("#ha3dEditorBody");
  const urlInput = body?.querySelector("#ha3dMpUrl");
  if (!body || !urlInput || body.querySelector("#ha3dMediaUploadControls")) return;

  const row = document.createElement("div");
  row.id = "ha3dMediaUploadControls";
  row.className = "ha3dRow";
  row.innerHTML = `
    <label>Arquivo local</label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <button id="ha3dUploadImage" class="secondary" type="button">Subir imagem</button>
      <button id="ha3dUploadVideo" class="secondary" type="button">Subir vídeo</button>
    </div>
    <input id="ha3dUploadImageInput" type="file" accept="${accepted("image")}" style="display:none">
    <input id="ha3dUploadVideoInput" type="file" accept="${accepted("video")}" style="display:none">
    <span class="ha3dHint">O arquivo fica salvo no Home Assistant e a tela continua funcionando após reiniciar.</span>
  `;

  urlInput.closest?.(".ha3dRow")?.insertAdjacentElement("afterend", row);

  const imageInput = row.querySelector("#ha3dUploadImageInput");
  const videoInput = row.querySelector("#ha3dUploadVideoInput");
  row.querySelector("#ha3dUploadImage")?.addEventListener("click", () => imageInput?.click());
  row.querySelector("#ha3dUploadVideo")?.addEventListener("click", () => videoInput?.click());

  imageInput?.addEventListener("change", async () => {
    const file = imageInput.files?.[0];
    imageInput.value = "";
    if (file) await uploadMedia(panel, "image", file, id);
  });
  videoInput?.addEventListener("change", async () => {
    const file = videoInput.files?.[0];
    videoInput.value = "";
    if (file) await uploadMedia(panel, "video", file, id);
  });

  const source = body.querySelector("#ha3dMpSource");
  if (source) {
    for (const option of source.options || []) {
      if (option.value === "image") option.textContent = "Imagem (URL ou upload)";
      if (option.value === "video") option.textContent = "Vídeo (URL ou upload)";
      if (option.value === "entity") option.textContent = "Entidade do Home Assistant";
    }
  }
}

if (!proto.__ha3dMediaUploadV1) {
  proto.__ha3dMediaUploadV1 = true;

  const oldRenderEditorForm = proto._renderEditorForm;
  proto._renderEditorForm = async function (...args) {
    const result = await oldRenderEditorForm?.apply(this, args);
    addUploadControls(this);
    return result;
  };

  const oldSelectForEditor = proto._selectForEditor;
  proto._selectForEditor = function (...args) {
    const result = oldSelectForEditor?.apply(this, args);
    queueMicrotask(() => addUploadControls(this));
    return result;
  };
}
