const CUSTOM_VIEWS_KEY = "ha3d_custom_views_v1";
const MIN_FOV = 20;
const MAX_FOV = 90;
const DEFAULT_FOV = 45;

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function clampFov(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_FOV;
  return Math.max(MIN_FOV, Math.min(MAX_FOV, numeric));
}

function currentFov(panel) {
  return clampFov(panel?._camera?.fov ?? DEFAULT_FOV);
}

function syncLensUi(panel) {
  const slider = panel.shadowRoot?.querySelector("#cameraLensSlider");
  const value = panel.shadowRoot?.querySelector("#cameraLensValue");
  if (!slider || !value) return;

  const fov = Math.round(currentFov(panel));
  slider.value = String(fov);
  value.textContent = `${fov}°`;
}

function setFov(panel, value) {
  if (!panel?._camera) return;
  const fov = clampFov(value);
  panel._camera.fov = fov;
  panel._camera.updateProjectionMatrix?.();
  syncLensUi(panel);
}

function ensureLensControl(panel) {
  const viewsPanel = panel.shadowRoot?.querySelector("#viewsPanel");
  if (!viewsPanel) return false;

  if (!panel.shadowRoot.querySelector("#ha3dCameraLensStyle")) {
    const style = document.createElement("style");
    style.id = "ha3dCameraLensStyle";
    style.textContent = `
      #cameraLensControl{
        margin-top:10px;
        padding:10px 10px 9px;
        border-radius:12px;
        background:#202229;
        border:1px solid rgba(255,255,255,.09);
      }
      #cameraLensHeader{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        margin-bottom:7px;
        font-size:12px;
        font-weight:700;
      }
      #cameraLensValue{
        min-width:38px;
        text-align:right;
        opacity:.78;
        font-variant-numeric:tabular-nums;
      }
      #cameraLensSlider{
        width:100%;
        margin:0;
        accent-color:var(--primary-color,#03a9f4);
        cursor:pointer;
      }
      #cameraLensScale{
        display:flex;
        justify-content:space-between;
        margin-top:4px;
        font-size:10px;
        opacity:.52;
      }
    `;
    panel.shadowRoot.appendChild(style);
  }

  let control = panel.shadowRoot.querySelector("#cameraLensControl");
  if (!control) {
    control = document.createElement("div");
    control.id = "cameraLensControl";
    control.innerHTML = `
      <div id="cameraLensHeader">
        <span>Lente / FOV</span>
        <span id="cameraLensValue">45°</span>
      </div>
      <input id="cameraLensSlider" type="range" min="${MIN_FOV}" max="${MAX_FOV}" step="1" value="${DEFAULT_FOV}" aria-label="Lente da câmera em graus">
      <div id="cameraLensScale"><span>${MIN_FOV}°</span><span>${MAX_FOV}°</span></div>
    `;

    const saveButton = viewsPanel.querySelector("#saveViewButton");
    viewsPanel.insertBefore(control, saveButton || null);
  }

  const slider = control.querySelector("#cameraLensSlider");
  if (slider && !slider.__ha3dLensBound) {
    slider.__ha3dLensBound = true;
    slider.addEventListener("input", (event) => {
      event.stopPropagation();
      setFov(panel, event.target.value);
    });
  }

  syncLensUi(panel);
  return true;
}

function persistCustomViews(panel) {
  try {
    localStorage.setItem(CUSTOM_VIEWS_KEY, JSON.stringify(panel._customViews || []));
  } catch (error) {
    console.warn("[HA3D] Failed to persist custom-view FOV", error);
  }
}

function collectPanels(root, found = new Set()) {
  if (!root?.querySelectorAll) return found;
  for (const element of root.querySelectorAll("*")) {
    if (element.localName === "ha3d-panel") found.add(element);
    if (element.shadowRoot) collectPanels(element.shadowRoot, found);
  }
  return found;
}

function installOnExistingPanels() {
  for (const panel of collectPanels(document)) ensureLensControl(panel);
}

if (!proto.__ha3dCameraLensV1) {
  proto.__ha3dCameraLensV1 = true;

  const originalConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = originalConnected?.apply(this, args);
    queueMicrotask(() => ensureLensControl(this));
    requestAnimationFrame(() => ensureLensControl(this));
    return result;
  };

  const originalLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await originalLoadModel?.apply(this, args);
    ensureLensControl(this);
    syncLensUi(this);
    return result;
  };

  // Add the current lens only to newly saved custom views. Native/default
  // camera presets keep their existing behavior and do not force a FOV.
  const originalSaveCurrentView = proto._saveCurrentView;
  proto._saveCurrentView = function (...args) {
    const before = new Set((this._customViews || []).map((item) => item.id));
    const result = originalSaveCurrentView?.apply(this, args);
    const added = (this._customViews || []).find((item) => !before.has(item.id));
    if (added?.view) {
      added.view.fov = currentFov(this);
      persistCustomViews(this);
      this._renderCustomViews?.();
    }
    return result;
  };

  // Custom views created from now on may carry a FOV. Old custom views and
  // built-in presets do not, so they continue to use the current lens.
  const originalAnimateCameraTo = proto._animateCameraTo;
  proto._animateCameraTo = function (view, ...args) {
    if (Number.isFinite(Number(view?.fov))) setFov(this, view.fov);
    const result = originalAnimateCameraTo?.call(this, view, ...args);
    syncLensUi(this);
    return result;
  };

  queueMicrotask(installOnExistingPanels);
  requestAnimationFrame(installOnExistingPanels);
  setTimeout(installOnExistingPanels, 250);
  setTimeout(installOnExistingPanels, 1000);
}
