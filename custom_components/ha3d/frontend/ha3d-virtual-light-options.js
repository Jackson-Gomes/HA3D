const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function selectedRuntime(panel) {
  const id = panel?._selectedObject?.userData?.ha3dVirtualLightId;
  return id ? panel?._ha3dVirtualLights?.get?.(id) || null : null;
}

function mediaPanelOptions(panel, selectedId) {
  const panels = Array.isArray(panel?._config?.media_panels) ? panel._config.media_panels : [];
  const options = ['<option value="">Escolha uma Tela de mídia…</option>'];
  for (const media of panels) {
    if (!media?.id) continue;
    options.push(`<option value="${escapeHtml(media.id)}" ${media.id === selectedId ? "selected" : ""}>${escapeHtml(media.name || media.id)}</option>`);
  }
  return options.join("");
}

function updateEffectVisibility(body) {
  if (!body) return;
  const effect = body.querySelector("#ha3dVlEffect")?.value || "none";
  const flicker = body.querySelector("#ha3dVlFlickerOptions");
  const media = body.querySelector("#ha3dVlMediaImageOptions");
  if (flicker) flicker.style.display = effect === "tv_flicker" ? "" : "none";
  if (media) media.style.display = effect === "media_image" ? "" : "none";
}

function installExtraFields(panel) {
  const runtime = selectedRuntime(panel);
  const body = panel?.shadowRoot?.querySelector("#ha3dEditorBody");
  if (!runtime || !body || body.querySelector("#ha3dVlShowMarker")) return;

  const config = runtime.config || {};
  const host = document.createElement("div");
  host.id = "ha3dVlExtraOptions";
  host.innerHTML = `
    <div class="ha3dRow">
      <label>Mostrar ícone</label>
      <label style="display:flex;align-items:center;gap:8px"><input id="ha3dVlShowMarker" type="checkbox" ${config.show_marker === false ? "" : "checked"}> Exibir marcador sobre a luz</label>
      <span class="ha3dHint">O modo cinematográfico usa somente luzes com este ícone visível.</span>
    </div>
    <div class="ha3dRow">
      <label>Efeito da luz</label>
      <select id="ha3dVlEffect">
        <option value="none" ${(config.effect || "none") === "none" ? "selected" : ""}>Nenhum</option>
        <option value="tv_flicker" ${config.effect === "tv_flicker" ? "selected" : ""}>Cintilação tipo TV</option>
        <option value="media_image" ${config.effect === "media_image" ? "selected" : ""}>Iluminação da imagem</option>
      </select>
      <span class="ha3dHint">A Iluminação da imagem usa a cor e a luminosidade da Tela de mídia escolhida. A Intensidade acima continua sendo o valor máximo do Spot.</span>
    </div>
    <div class="ha3dRow" id="ha3dVlFlickerOptions">
      <label>Cores da cintilação</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <input id="ha3dVlFlickerColorA" type="color" value="${config.flicker_color_a || "#3a7bff"}" title="Cor A">
        <input id="ha3dVlFlickerColorB" type="color" value="${config.flicker_color_b || "#754dff"}" title="Cor B">
      </div>
      <label>Tempo da cintilação (ms)</label>
      <input id="ha3dVlFlickerPeriod" type="number" min="50" max="60000" step="50" value="${Number(config.flicker_period_ms) || 1200}">
      <span class="ha3dHint">Ex.: 1200 ms = 1,2 s para completar a variação entre as cores.</span>
    </div>
    <div class="ha3dRow" id="ha3dVlMediaImageOptions">
      <label>Tela que ilumina o Spot</label>
      <select id="ha3dVlMediaPanel">${mediaPanelOptions(panel, config.media_panel_id || "")}</select>
      <span class="ha3dHint">Funciona com vídeo, MJPEG, imagem e imagens vindas de entidade. TV desligada ou X-Ray apaga este efeito.</span>
    </div>
  `;

  const actions = body.querySelector(".ha3dEditorActions");
  if (actions) body.insertBefore(host, actions);
  else body.appendChild(host);

  body.querySelector("#ha3dVlEffect")?.addEventListener("change", () => updateEffectVisibility(body));
  updateEffectVisibility(body);
}

if (!proto.__ha3dVirtualLightOptionsV2) {
  proto.__ha3dVirtualLightOptionsV2 = true;

  const oldRenderEditorForm = proto._renderEditorForm;
  proto._renderEditorForm = async function (...args) {
    const result = await oldRenderEditorForm?.apply(this, args);
    installExtraFields(this);
    return result;
  };

  const oldSaveVirtualLightForm = proto._saveVirtualLightForm;
  proto._saveVirtualLightForm = async function (id, ...args) {
    const runtime = this._ha3dVirtualLights?.get?.(id);
    const body = this.shadowRoot?.querySelector("#ha3dEditorBody");
    if (runtime && body) {
      const selectedEffect = body.querySelector("#ha3dVlEffect")?.value || "none";
      const effect = ["tv_flicker", "media_image"].includes(selectedEffect) ? selectedEffect : "none";
      const mediaPanelId = body.querySelector("#ha3dVlMediaPanel")?.value || "";
      if (effect === "media_image" && !mediaPanelId) {
        this._setStatus?.("Escolha qual Tela de mídia deve iluminar o Spot");
        return;
      }
      runtime.config = {
        ...runtime.config,
        show_marker: Boolean(body.querySelector("#ha3dVlShowMarker")?.checked),
        effect,
        flicker_color_a: body.querySelector("#ha3dVlFlickerColorA")?.value || "#3a7bff",
        flicker_color_b: body.querySelector("#ha3dVlFlickerColorB")?.value || "#754dff",
        flicker_period_ms: Math.max(50, Math.min(60000, Number(body.querySelector("#ha3dVlFlickerPeriod")?.value) || 1200)),
        ...(effect === "media_image" ? { media_panel_id: mediaPanelId } : {}),
      };
      if (effect !== "media_image") delete runtime.config.media_panel_id;
    }
    return oldSaveVirtualLightForm?.call(this, id, ...args);
  };
}
