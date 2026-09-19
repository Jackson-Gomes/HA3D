import * as THREE from "https://esm.sh/three@0.180.0";
import "./ha3d-ui.js?v=0.1.7";

const GRAPHICS_QUALITY_KEY = "ha3d_texture_quality_pct_v1";
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function readQuality() {
  const saved = Number(localStorage.getItem(GRAPHICS_QUALITY_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(100, saved)) : 100;
}

function ensureGraphicsState(panel) {
  if (panel._ha3dGraphicsReady) return;
  panel._ha3dGraphicsReady = true;
  panel._graphicsQuality = readQuality();
  panel._graphicsTextureGroups = [];
}

function meshTextureScore(mesh) {
  try {
    const geometry = mesh.geometry;
    if (!geometry) return 1;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const size = geometry.boundingBox?.getSize(new THREE.Vector3()) || new THREE.Vector3(1, 1, 1);
    const worldScale = mesh.getWorldScale(new THREE.Vector3(1, 1, 1));
    size.multiply(worldScale);
    const xy = Math.abs(size.x * size.y);
    const xz = Math.abs(size.x * size.z);
    const yz = Math.abs(size.y * size.z);
    return Math.max(xy, xz, yz, size.length(), 0.0001);
  } catch (_error) {
    return 1;
  }
}

if (!proto.__ha3dGraphicsPatched) {
  proto.__ha3dGraphicsPatched = true;

  const originalConnectedCallback = proto.connectedCallback;
  proto.connectedCallback = function () {
    ensureGraphicsState(this);
    originalConnectedCallback.call(this);
    queueMicrotask(() => this._installGraphicsControls?.());
  };

  const originalLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    ensureGraphicsState(this);
    const result = await originalLoadModel.apply(this, args);
    this._collectGraphicsTextures?.();
    this._applyGraphicsQuality?.(this._graphicsQuality, false);
    return result;
  };

  proto._installGraphicsControls = function () {
    ensureGraphicsState(this);
    if (!this.shadowRoot || this.shadowRoot.querySelector("#graphicsPanel")) return;

    const style = document.createElement("style");
    style.textContent = `
      #graphicsPanel{display:none;position:absolute;top:max(66px,calc(env(safe-area-inset-top) + 58px));right:max(12px,env(safe-area-inset-right));z-index:31;width:min(330px,calc(100vw - 24px));padding:14px;border-radius:16px}
      #graphicsPanel.open{display:block}.graphicsTitle{font-size:14px;font-weight:700;margin:1px 2px 12px}.graphicsRow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}.graphicsLabel{font-size:13px;font-weight:650}.graphicsValue{font-size:12px;opacity:.72;white-space:nowrap}.graphicsSlider{width:100%;accent-color:var(--primary-color,#03a9f4)}.graphicsHint{font-size:11px;opacity:.62;line-height:1.4;margin-top:8px}
      #root.ha3d-cinematic-active #graphicsPanel{opacity:0!important;pointer-events:none!important}
    `;
    this.shadowRoot.appendChild(style);

    const actions = this.shadowRoot.querySelector("#actions");
    const uploadButton = this.shadowRoot.querySelector("#uploadButton");
    if (actions && !this.shadowRoot.querySelector("#graphicsButton")) {
      const button = document.createElement("button");
      button.id = "graphicsButton";
      button.className = "secondary";
      button.type = "button";
      button.textContent = "Gráficos";
      actions.insertBefore(button, uploadButton || null);
    }

    const panel = document.createElement("div");
    panel.id = "graphicsPanel";
    panel.className = "glass";
    panel.innerHTML = `
      <div class="graphicsTitle">Qualidade gráfica</div>
      <div class="graphicsRow"><span class="graphicsLabel">Texturas</span><span id="graphicsTextureValue" class="graphicsValue">100%</span></div>
      <input id="graphicsTextureSlider" class="graphicsSlider" type="range" min="0" max="100" step="5" value="${this._graphicsQuality}">
      <div id="graphicsTextureStatus" class="graphicsHint">Aguardando modelo 3D…</div>
      <div class="graphicsHint">100% mantém todas as texturas base. Reduza para aliviar memória/GPU em celulares, TVs ou navegadores mais limitados.</div>
    `;

    const root = this.shadowRoot.querySelector("#root");
    const viewsPanel = this.shadowRoot.querySelector("#viewsPanel");
    root?.appendChild(panel);

    const button = this.shadowRoot.querySelector("#graphicsButton");
    const slider = panel.querySelector("#graphicsTextureSlider");

    button?.addEventListener("click", (event) => {
      event.stopPropagation();
      viewsPanel?.classList.remove("open");
      panel.classList.toggle("open");
    });

    slider?.addEventListener("input", () => {
      this._applyGraphicsQuality?.(Number(slider.value), true);
    });

    root?.addEventListener("pointerdown", (event) => {
      if (!panel.contains(event.target) && event.target?.id !== "graphicsButton") panel.classList.remove("open");
    });

    this._updateGraphicsUi?.();
  };

  proto._collectGraphicsTextures = function () {
    ensureGraphicsState(this);
    this._graphicsTextureGroups = [];
    if (!this._model) {
      this._updateGraphicsUi?.();
      return;
    }

    const groups = new Map();
    this._model.updateMatrixWorld(true);

    this._model.traverse((mesh) => {
      if (!mesh?.isMesh) return;
      const score = meshTextureScore(mesh);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      for (const material of materials) {
        const texture = material?.map;
        if (!material || !texture) continue;
        const key = texture.source?.uuid || texture.image?.src || texture.uuid;
        if (!key) continue;
        let group = groups.get(key);
        if (!group) {
          group = { key, score: 0, slots: new Map() };
          groups.set(key, group);
        }
        group.score += score;
        if (!group.slots.has(material.uuid)) group.slots.set(material.uuid, { material, texture });
      }
    });

    this._graphicsTextureGroups = [...groups.values()]
      .map((group) => ({ ...group, slots: [...group.slots.values()] }))
      .sort((a, b) => b.score - a.score);

    this._updateGraphicsUi?.();
  };

  proto._applyGraphicsQuality = function (quality, persist = true) {
    ensureGraphicsState(this);
    const pct = Math.max(0, Math.min(100, Math.round(Number(quality) || 0)));
    this._graphicsQuality = pct;
    if (persist) localStorage.setItem(GRAPHICS_QUALITY_KEY, String(pct));

    const groups = this._graphicsTextureGroups || [];
    const enabledCount = pct >= 100 ? groups.length : Math.round(groups.length * pct / 100);

    groups.forEach((group, index) => {
      const enabled = index < enabledCount;
      for (const slot of group.slots) {
        if (slot.material.map !== (enabled ? slot.texture : null)) {
          slot.material.map = enabled ? slot.texture : null;
          slot.material.needsUpdate = true;
        }
      }
    });

    this._updateGraphicsUi?.();
  };

  proto._updateGraphicsUi = function () {
    if (!this.shadowRoot) return;
    const slider = this.shadowRoot.querySelector("#graphicsTextureSlider");
    const value = this.shadowRoot.querySelector("#graphicsTextureValue");
    const status = this.shadowRoot.querySelector("#graphicsTextureStatus");
    if (slider) slider.value = String(this._graphicsQuality ?? 100);
    if (value) value.textContent = `${this._graphicsQuality ?? 100}%`;

    const total = this._graphicsTextureGroups?.length || 0;
    if (!status) return;
    if (!this._model) {
      status.textContent = "Aguardando modelo 3D…";
      return;
    }
    const enabled = (this._graphicsQuality ?? 100) >= 100
      ? total
      : Math.round(total * (this._graphicsQuality ?? 100) / 100);
    status.textContent = `Texturas base ativas: ${enabled}/${total}`;
  };
}
