const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

function selectedRuntime(panel) {
  const id = panel?._selectedObject?.userData?.ha3dVirtualLightId;
  return id ? panel?._ha3dVirtualLights?.get?.(id) || null : null;
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
      </select>
      <span class="ha3dHint">Funciona em Point e Spot. Você escolhe as duas cores e o tempo de um ciclo completo.</span>
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
  `;

  const actions = body.querySelector(".ha3dEditorActions");
  if (actions) body.insertBefore(host, actions);
  else body.appendChild(host);
}

if (!proto.__ha3dVirtualLightOptionsV1) {
  proto.__ha3dVirtualLightOptionsV1 = true;

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
      runtime.config = {
        ...runtime.config,
        show_marker: Boolean(body.querySelector("#ha3dVlShowMarker")?.checked),
        effect: body.querySelector("#ha3dVlEffect")?.value === "tv_flicker" ? "tv_flicker" : "none",
        flicker_color_a: body.querySelector("#ha3dVlFlickerColorA")?.value || "#3a7bff",
        flicker_color_b: body.querySelector("#ha3dVlFlickerColorB")?.value || "#754dff",
        flicker_period_ms: Math.max(50, Math.min(60000, Number(body.querySelector("#ha3dVlFlickerPeriod")?.value) || 1200)),
      };
    }
    return oldSaveVirtualLightForm?.call(this, id, ...args);
  };
}
