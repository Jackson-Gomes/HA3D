const GLOBAL_LIGHT_KEY = "ha3d_global_light_pct_v1";
const Panel = customElements.get("ha3d-panel");

if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function readGlobalLight() {
  const saved = Number(localStorage.getItem(GLOBAL_LIGHT_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(100, saved)) : 50;
}

function ensureSceneState(panel) {
  if (panel._ha3dSceneStateReady) return;
  panel._ha3dSceneStateReady = true;
  panel._globalLightPct = readGlobalLight();
}

if (!proto.__ha3dSceneLightTunedV2) {
  proto.__ha3dSceneLightTunedV2 = true;

  const originalConnectedCallback = proto.connectedCallback;
  proto.connectedCallback = function () {
    ensureSceneState(this);
    originalConnectedCallback.call(this);
    queueMicrotask(() => {
      this._installGlobalLightControl?.();
      this._applyGlobalLight?.(this._globalLightPct, false);
    });
  };

  const originalInitViewer = proto._initViewer;
  proto._initViewer = function (...args) {
    ensureSceneState(this);
    const result = originalInitViewer.apply(this, args);
    const hemi = this._scene?.children?.find((item) => item?.isHemisphereLight);
    if (hemi) {
      this._ha3dGlobalLight = hemi;
      if (!Number.isFinite(hemi.userData?.ha3dBaseIntensity)) {
        hemi.userData.ha3dBaseIntensity = hemi.intensity || 0.55;
      }
      this._applyGlobalLight?.(this._globalLightPct, false);
    }
    return result;
  };

  const originalRestoreUnboundModelLights = proto._restoreUnboundModelLights;
  proto._restoreUnboundModelLights = function (...args) {
    const result = originalRestoreUnboundModelLights.apply(this, args);

    const boundLights = new Set(
      [...(this._lightBindings?.values?.() || [])]
        .map((binding) => binding.light)
        .filter(Boolean),
    );

    for (const light of this._modelLights || []) {
      if (boundLights.has(light)) continue;
      if (!Number.isFinite(light.userData?.ha3dFillBaseIntensity)) {
        light.userData.ha3dFillBaseIntensity = light.intensity || 0;
      }
      light.intensity = light.userData.ha3dFillBaseIntensity * 0.30;
      light.castShadow = false;
    }

    return result;
  };

  proto._applyGlobalLight = function (value, persist = true) {
    ensureSceneState(this);
    const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    this._globalLightPct = pct;
    if (persist) localStorage.setItem(GLOBAL_LIGHT_KEY, String(pct));

    const hemi = this._ha3dGlobalLight || this._scene?.children?.find((item) => item?.isHemisphereLight);
    if (hemi) {
      this._ha3dGlobalLight = hemi;
      if (!Number.isFinite(hemi.userData?.ha3dBaseIntensity)) {
        hemi.userData.ha3dBaseIntensity = hemi.intensity || 0.55;
      }
      // 50% reproduces the original HA3D ambient level. 100% doubles it.
      hemi.intensity = hemi.userData.ha3dBaseIntensity * (pct / 50);
    }

    const slider = this.shadowRoot?.querySelector("#globalLightSlider");
    const label = this.shadowRoot?.querySelector("#globalLightValue");
    if (slider) slider.value = String(pct);
    if (label) label.textContent = `${pct}%`;
  };

  proto._installGlobalLightControl = function () {
    ensureSceneState(this);
    if (!this.shadowRoot || this.shadowRoot.querySelector("#globalLightSection")) return;

    const viewsPanel = this.shadowRoot.querySelector("#viewsPanel");
    if (!viewsPanel) return;

    const style = document.createElement("style");
    style.textContent = `
      #globalLightSection{margin:10px 0 0;padding:11px 1px 2px;border-top:1px solid rgba(255,255,255,.11)}
      .globalLightHeader{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
      .globalLightTitle{font-size:13px;font-weight:700}.globalLightValue{font-size:12px;opacity:.72;white-space:nowrap}
      .globalLightSlider{width:100%;accent-color:var(--primary-color,#03a9f4)}
      .globalLightHint{font-size:11px;opacity:.62;line-height:1.4;margin-top:7px}
    `;
    this.shadowRoot.appendChild(style);

    const section = document.createElement("div");
    section.id = "globalLightSection";
    section.innerHTML = `
      <div class="globalLightHeader">
        <span class="globalLightTitle">Luz geral</span>
        <span id="globalLightValue" class="globalLightValue">${this._globalLightPct}%</span>
      </div>
      <input id="globalLightSlider" class="globalLightSlider" type="range" min="0" max="100" step="5" value="${this._globalLightPct}">
      <div class="globalLightHint">Ajusta apenas a iluminação ambiente do viewer. Não altera as luzes reais do Home Assistant.</div>
    `;

    const graphics = viewsPanel.querySelector("#graphicsSection");
    const saveButton = viewsPanel.querySelector("#saveViewButton");
    if (graphics?.nextSibling) viewsPanel.insertBefore(section, graphics.nextSibling);
    else if (saveButton) viewsPanel.insertBefore(section, saveButton);
    else viewsPanel.appendChild(section);

    section.querySelector("#globalLightSlider")?.addEventListener("input", (event) => {
      this._applyGlobalLight?.(Number(event.target.value), true);
    });

    this._applyGlobalLight?.(this._globalLightPct, false);
  };
}
