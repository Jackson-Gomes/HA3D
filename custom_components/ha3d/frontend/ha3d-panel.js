import * as THREE from "https://esm.sh/three@0.180.0";
import { OrbitControls } from "https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";
import { FRONTEND_VERSION, entityIdFromName, restoreNodeNames, indexCandidates, visualState, iconFor } from "./ha3d-bindings.js?v=20260919-3";
import { prepareLight, prepareOccluders, applyShadowBudget } from "./ha3d-lighting.js?v=20260919-3";

const LIGHT_INTENSITY_SCALE = 0.40;
const CUSTOM_VIEWS_KEY = "ha3d_custom_views_v1";

function ease(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

class HA3DPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._panel = null;
    this._config = null;
    this._model = null;
    this._modelLights = [];
    this._objectsByEntity = new Map();
    this._lightBindings = new Map();
    this._pendingBindings = new Map();
    this._markerPoint = new THREE.Vector3();
    this._boundCount = 0;
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._resizeObserver = null;
    this._initialized = false;
    this._cameraAnimating = false;
    this._customViews = this._readCustomViews();
  }

  set hass(value) {
    this._hass = value;
    if (this.isConnected) {
      this._updateAdminUi();
      this._resolvePendingBindings();
      this._syncLightStates();
      if (value && this._waitingForHass) {
        this._waitingForHass = false;
        this._loadConfig();
      }
    }
  }

  get hass() {
    return this._hass;
  }

  set panel(value) {
    this._panel = value;
  }

  set narrow(_value) {}
  set route(_value) {}

  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;
    this._renderShell();
    this._initViewer();
    this._wireUi();
    this._renderCustomViews();
    this._waitForHassAndLoad();
  }

  disconnectedCallback() {
    this._resizeObserver?.disconnect();
    this._renderer?.setAnimationLoop(null);
    this._renderer?.dispose();
  }

  _renderShell() {
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;width:100%;height:100%;min-height:100vh;background:#111;color:var(--primary-text-color,#fff);font-family:var(--paper-font-body1_-_font-family,system-ui,sans-serif);overflow:hidden}
        *{box-sizing:border-box}#root{position:relative;width:100%;height:100vh;overflow:hidden}#stage{position:absolute;inset:0}
        canvas{display:block;width:100%;height:100%;touch-action:none}
        #topbar{position:absolute;top:max(12px,env(safe-area-inset-top));left:max(12px,env(safe-area-inset-left));right:max(12px,env(safe-area-inset-right));display:flex;align-items:center;gap:10px;z-index:20;pointer-events:none}
        .glass{background:color-mix(in srgb,var(--card-background-color,#15171d) 88%,transparent);border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 35px rgba(0,0,0,.28);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
        #brand{pointer-events:auto;min-width:0;padding:10px 14px;border-radius:14px;display:flex;align-items:baseline;gap:10px}
        #brand strong{font-size:15px;letter-spacing:.02em}#status{opacity:.7;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        #actions{margin-left:auto;display:flex;gap:8px;pointer-events:auto}
        button{appearance:none;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:10px 13px;background:color-mix(in srgb,var(--primary-color,#03a9f4) 82%,#111);color:#fff;font:inherit;font-weight:600;cursor:pointer}
        button.secondary{background:rgba(30,32,39,.88)}button:disabled{opacity:.45;cursor:default}
        #empty{position:absolute;inset:0;display:grid;place-items:center;z-index:10;pointer-events:none}
        #emptyCard{width:min(520px,calc(100vw - 36px));padding:28px;border-radius:22px;text-align:center;pointer-events:auto}
        #emptyCard h2{margin:0 0 8px;font-size:22px}#emptyCard p{margin:0 0 18px;opacity:.72;line-height:1.45}#emptyCard code{font-size:12px;opacity:.9}
        #markers{position:absolute;inset:0;z-index:12;pointer-events:none}
        .lightMarker{position:absolute;width:34px;height:34px;min-height:34px;padding:0;border-radius:50%;transform:translate(-50%,-50%);font-size:18px;background:#202020e8;border:1px solid #666;color:#bbb;box-shadow:0 3px 12px #0008;backdrop-filter:blur(6px);pointer-events:auto}
        .lightMarker.on{background:#f3c94be8;border-color:#ffe993;color:#111;box-shadow:0 0 14px #ffd84f99}.lightMarker.unavailable{border-color:#a34b42;color:#ffb1a8}
        .lightMarker{display:grid;place-items:center}.lightMarker ha-icon{--mdc-icon-size:20px;width:20px;height:20px;pointer-events:none}.lightMarker.assumed{border-style:dashed}.lightMarker:hover,.lightMarker:focus-visible{outline:2px solid #fff;outline-offset:2px}
        #viewsPanel{display:none;position:absolute;top:max(66px,calc(env(safe-area-inset-top) + 58px));right:max(12px,env(safe-area-inset-right));z-index:30;width:min(320px,calc(100vw - 24px));padding:12px;border-radius:16px}
        #viewsPanel.open{display:block}.viewsTitle{font-size:14px;font-weight:700;margin:1px 2px 10px}.viewGrid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.viewGrid button{background:#24262c;font-size:12px;min-height:38px;padding:7px 8px}.saveView{width:100%;margin-top:9px;background:#18304a}.customViews{display:grid;gap:7px;margin-top:9px}.customRow{display:grid;grid-template-columns:1fr auto;gap:6px}.customRow button:first-child{text-align:left;background:#24262c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.customRow button:last-child{width:40px;padding:0;background:#3a2424}
        #meta{position:absolute;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:15;padding:8px 10px;border-radius:12px;font-size:11px;opacity:.75;pointer-events:none}
        input[type=file]{display:none}
        @media(max-width:600px){#brand{max-width:42vw}#brand strong{font-size:14px}#status{display:none}#actions button{padding:10px 11px}#meta{display:none}}
      </style>
      <div id="root">
        <div id="stage"></div>
        <div id="markers"></div>
        <div id="topbar">
          <div id="brand" class="glass"><strong>HA3D</strong><span id="status">Iniciando…</span></div>
          <div id="actions">
            <button id="viewsButton" class="secondary" type="button">Vistas</button>
            <button id="uploadButton" type="button">Subir GLB</button>
            <input id="fileInput" type="file" accept=".glb,model/gltf-binary">
          </div>
        </div>
        <div id="viewsPanel" class="glass">
          <div class="viewsTitle">Vistas da câmera</div>
          <div class="viewGrid">
            <button data-view="default" type="button">Padrão</button>
            <button data-view="top" type="button">Superior</button>
            <button data-view="a1" type="button">Ângulo 1</button>
            <button data-view="a2" type="button">Ângulo 2</button>
            <button data-view="a3" type="button">Ângulo 3</button>
            <button data-view="a4" type="button">Ângulo 4</button>
            <button data-view="low" type="button">Baixa</button>
          </div>
          <button id="saveViewButton" class="saveView" type="button">Salvar vista atual</button>
          <div id="customViews" class="customViews"></div>
        </div>
        <div id="empty"><div id="emptyCard" class="glass"><h2>Seu Home Assistant em 3D</h2><p>Suba um arquivo GLB. Objetos cujo nome seja um <code>entity_id</code> existente serão vinculados automaticamente.</p><button id="emptyUploadButton" type="button">Escolher GLB</button></div></div>
        <div id="meta" class="glass">0 vínculos</div>
      </div>
    `;
  }

  _initViewer() {
    const stage = this.shadowRoot.querySelector("#stage");
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x111111);
    this._camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
    this._camera.position.set(7, 7, 7);

    this._renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 0.95;
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.appendChild(this._renderer.domElement);

    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.08;

    const ambient = new THREE.HemisphereLight(0xfff4e6, 0x556070, 0.55);
    ambient.castShadow = false;
    this._scene.add(ambient);

    this._loader = new GLTFLoader();
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(stage);
    this._resize();

    this._renderer.setAnimationLoop(() => {
      if (!this._cameraAnimating) this._controls.update();
      this._updateLightMarkers();
      this._renderer.render(this._scene, this._camera);
    });
  }

  _wireUi() {
    const fileInput = this.shadowRoot.querySelector("#fileInput");
    const choose = () => fileInput.click();
    this.shadowRoot.querySelector("#uploadButton").addEventListener("click", choose);
    this.shadowRoot.querySelector("#emptyUploadButton").addEventListener("click", choose);
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) await this._uploadModel(file);
    });

    const viewsPanel = this.shadowRoot.querySelector("#viewsPanel");
    this.shadowRoot.querySelector("#viewsButton").addEventListener("click", (event) => {
      event.stopPropagation();
      viewsPanel.classList.toggle("open");
    });
    this.shadowRoot.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => this._applyCameraView(button.dataset.view));
    });
    this.shadowRoot.querySelector("#saveViewButton").addEventListener("click", () => this._saveCurrentView());
    this.shadowRoot.querySelector("#root").addEventListener("pointerdown", (event) => {
      if (!viewsPanel.contains(event.target) && event.target.id !== "viewsButton") viewsPanel.classList.remove("open");
    });

    this._renderer.domElement.addEventListener("click", (event) => this._pick(event));
    this._updateAdminUi();
  }

  async _waitForHassAndLoad() {
    if (!this._hass) {
      this._waitingForHass = true;
      this._setStatus("Home Assistant indisponível");
      return;
    }
    await this._loadConfig();
  }

  async _loadConfig() {
    try {
      this._setStatus("Lendo configuração…");
      this._config = await this._hass.callApi("GET", "ha3d/config");
      if (this._config?.model_url) await this._loadModel(this._config.model_url);
      else {
        this._showEmpty(true);
        this._setStatus("Envie um modelo GLB");
      }
    } catch (error) {
      console.error("[HA3D] config", error);
      this._showEmpty(true);
      this._setStatus("Erro ao carregar configuração");
    }
  }

  async _uploadModel(file) {
    if (!this._hass?.user?.is_admin) return;
    if (!file.name.toLowerCase().endsWith(".glb")) {
      this._setStatus("Selecione um arquivo .glb");
      return;
    }
    const form = new FormData();
    form.append("file", file, file.name);
    this._setStatus(`Enviando ${file.name}…`);
    this._setUploadEnabled(false);
    try {
      const response = await this._hass.fetchWithAuth("/api/ha3d/model", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      this._config = { ...(this._config || {}), model_url: result.model_url };
      await this._loadModel(`${result.model_url}?v=${Date.now()}`);
    } catch (error) {
      console.error("[HA3D] upload", error);
      this._setStatus(`Falha no upload: ${error.message || error}`);
    } finally {
      this._setUploadEnabled(true);
    }
  }

  async _loadModel(url) {
    this._setStatus("Carregando modelo 3D…");
    const gltf = await this._loader.loadAsync(url);
    if (this._model) {
      this._scene.remove(this._model);
      this._disposeModel();
    }
    this._clearMarkers();

    this._model = gltf.scene;
    restoreNodeNames(gltf);
    this._collectModelLights(this._model);
    this._scene.add(this._model);

    prepareOccluders(this._model);

    this._indexBindings();
    this._fit(this._model);
    this._bindModelLights();
    this._bindEntityLightMarkers();
    this._restoreUnboundModelLights();
    this._syncLightStates();

    this._showEmpty(false);
    this._setStatus(`Pronto · ${FRONTEND_VERSION} · ${this._boundCount} vínculos`);
    this.setAttribute("data-ha3d-version", FRONTEND_VERSION);
  }

  _disposeModel() {
    const resources = new Set();
    for (const group of this._graphicsTextureGroups || []) {
      for (const slot of group.slots) resources.add(slot.texture);
    }
    this._model?.traverse((object) => {
      if (object.geometry) resources.add(object.geometry);
      object.shadow?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
      }
    });
    for (const resource of resources) resource.dispose();
    this._graphicsTextureGroups = [];
  }

  _collectModelLights(object) {
    this._modelLights = [];
    object.traverse((light) => {
      if (!light.isLight) return;
      const originalIntensity = Number(light.intensity || 0);
      light.userData.ha3dBaseIntensity = Math.max(0, originalIntensity * LIGHT_INTENSITY_SCALE);
      light.userData.ha3dOriginalIntensity = originalIntensity;
      light.userData.ha3dOriginalColor = light.color?.clone?.() || new THREE.Color(0xffffff);
      light.userData.ha3dOriginalCastShadow = Boolean(light.castShadow);
      light.userData.ha3dBaseDistance = Number(light.distance || 0);
      light.intensity = 0;
      light.castShadow = false;
      this._modelLights.push(light);
    });
  }

  _indexBindings() {
    this._objectsByEntity.clear();
    this._pendingBindings = indexCandidates(this._model, this._config || {});
    // Entity-named lights stay dark while HA is still resolving the entity.
    for (const light of this._modelLights) {
      light.userData.ha3dDesiredIntensity = light.userData.ha3dCandidate
        ? 0 : light.userData.ha3dBaseIntensity * 0.3;
    }
  }

  _resolvePendingBindings() {
    if (!this._model || !this._hass) return;
    for (const [entity, candidate] of this._pendingBindings) {
      const state = this._hass.states?.[entity];
      if (!state) continue;
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "lightMarker";
      const icon = document.createElement("ha-icon");
      icon.setAttribute("aria-hidden", "true");
      marker.appendChild(icon);
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        this._openNativeMoreInfo(entity);
      });
      this.shadowRoot.querySelector("#markers").appendChild(marker);
      const binding = { ...candidate, marker, icon, light: null };
      binding.lights = candidate.lights.map((original) => {
        const light = prepareLight(original, state, candidate.metadata);
        const index = this._modelLights.indexOf(original);
        if (index !== -1) this._modelLights[index] = light;
        if (binding.anchor === original) binding.anchor = light;
        return light;
      });
      binding.light = binding.lights[0] || null; // cinematic compatibility
      for (const object of candidate.objects) object.userData.ha3dEntityId = entity;
      this._objectsByEntity.set(entity, candidate.objects);
      this._lightBindings.set(entity, binding);
      this._pendingBindings.delete(entity);
    }
    this._boundCount = this._lightBindings.size;
  }

  _bindModelLights() {
    this._resolvePendingBindings();
  }

  _bindEntityLightMarkers() {
    // All domains are resolved together; no duplicate marker for LightNode_.
  }

  _restoreUnboundModelLights() {
    this._modelLights = this._modelLights.map((light) =>
      light.userData.ha3dCandidate ? light : prepareLight(light, null));
  }

  _syncLightStates() {
    for (const binding of this._lightBindings.values()) {
      const state = this._hass?.states?.[binding.entity];
      const sourceEntity = entityIdFromName(binding.metadata.state_entity) || binding.entity;
      const source = this._hass?.states?.[sourceEntity];
      const visual = visualState(binding.entity, state);
      const physical = visualState(sourceEntity, source);
      // HA publishes immutable state objects. Only changed entities touch DOM.
      if (binding.lastState !== state || binding.lastSource !== source || !binding.synced) {
        binding.lastState = state;
        binding.lastSource = source;
        binding.synced = true;
        binding.name = state?.attributes?.friendly_name || binding.entity;
        binding.icon.setAttribute("icon", iconFor(binding.entity, state));
        binding.marker.classList.toggle("on", visual.on && !visual.unavailable);
        binding.marker.classList.toggle("unavailable", visual.unavailable);
        binding.marker.classList.toggle("assumed", visual.assumed);
        binding.marker.title = binding.name + (visual.unavailable ? " — indisponível" : visual.assumed ? " — estado presumido" : "");
        binding.marker.setAttribute("aria-label", binding.marker.title);
        binding.marker.dataset.state = state?.state || "unavailable";
        // Metadata can arrive after a minimal initial state. Convert once then.
        binding.lights = binding.lights.map((original) => {
          const light = prepareLight(original, state, binding.metadata);
          if (light !== original) {
            this._modelLights[this._modelLights.indexOf(original)] = light;
            if (binding.anchor === original) binding.anchor = light;
          }
          const attrs = source?.attributes || {};
          light.userData.ha3dDesiredIntensity = physical.emits && !visual.unavailable
            ? light.userData.ha3dBaseIntensity * physical.level : 0;
          const rgb = attrs.rgb_color;
          const hs = attrs.hs_color;
          if (Array.isArray(rgb) && rgb.length >= 3 && rgb.every(Number.isFinite)) {
            light.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
          } else if (Array.isArray(hs) && hs.length >= 2 && hs.every(Number.isFinite)) {
            light.color.setHSL((((hs[0] % 360) + 360) % 360) / 360, Math.max(0, Math.min(100, hs[1])) / 100, 0.5);
          } else {
            light.color.copy(light.userData.ha3dOriginalColor);
          }
          return light;
        });
        binding.light = binding.lights[0] || null;
      }
    }
    const mobile = window.matchMedia?.("(pointer: coarse)").matches;
    const deferred = applyShadowBudget(this._modelLights, mobile ? 24 : 48);
    const meta = this.shadowRoot?.querySelector("#meta");
    if (meta) meta.textContent = `${this._boundCount} vínculos · ${this._pendingBindings.size} pendentes${deferred ? ` · ${deferred} luzes 3D limitadas` : ""}`;
  }

  _updateLightMarkers() {
    if (!this._lightBindings.size || !this._camera) return;
    const stage = this.shadowRoot.querySelector("#stage");
    const point = this._markerPoint;
    for (const binding of this._lightBindings.values()) {
      binding.anchor.getWorldPosition(point);
      point.project(this._camera);
      const visible = point.z > -1 && point.z < 1 && Math.abs(point.x) <= 1.15 && Math.abs(point.y) <= 1.15;
      binding.marker.style.visibility = visible ? "visible" : "hidden";
      if (!visible) continue;
      binding.marker.style.left = `${(point.x * 0.5 + 0.5) * stage.clientWidth}px`;
      binding.marker.style.top = `${(-point.y * 0.5 + 0.5) * stage.clientHeight}px`;
    }
  }

  _clearMarkers() {
    this._pendingBindings.clear();
    this._lightBindings.clear();
    const markers = this.shadowRoot?.querySelector("#markers");
    if (markers) markers.innerHTML = "";
  }

  _pick(event) {
    if (!this._model) return;
    const rect = this._renderer.domElement.getBoundingClientRect();
    this._pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(this._pointer, this._camera);
    const hit = this._raycaster.intersectObject(this._model, true)[0]?.object;
    let node = hit;
    while (node && !node.userData?.ha3dEntityId) node = node.parent;
    if (node?.userData?.ha3dEntityId) this._openNativeMoreInfo(node.userData.ha3dEntityId);
  }

  _openNativeMoreInfo(entityId) {
    if (!entityId) return;
    const detail = { entityId };
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail, bubbles: true, composed: true }));

  }

  _fit(object) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z) || 1;
    this._controls.target.copy(center);
    this._camera.near = Math.max(max / 10000, 0.01);
    this._camera.far = max * 50;
    this._camera.position.set(center.x + max * 0.75, center.y + max * 0.75, center.z + max * 0.75);
    this._camera.up.set(0, 1, 0);
    this._camera.updateProjectionMatrix();
    this._controls.update();
    this._defaultView = this._captureCameraView();
  }

  _captureCameraView() {
    return {
      position: [this._camera.position.x, this._camera.position.y, this._camera.position.z],
      target: [this._controls.target.x, this._controls.target.y, this._controls.target.z],
      up: [this._camera.up.x, this._camera.up.y, this._camera.up.z],
    };
  }

  _applyCameraView(name) {
    if (!this._model || this._cameraAnimating) return;
    if (name === "default" && this._defaultView) {
      this._animateCameraTo(this._defaultView);
      return;
    }

    const box = new THREE.Box3().setFromObject(this._model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z) || 1;
    const presets = {
      top: { az: 0, el: 89, dist: 1.48, up: [0, 0, -1] },
      a1: { az: 35, el: 43, dist: 1.26 },
      a2: { az: 125, el: 43, dist: 1.26 },
      a3: { az: 215, el: 43, dist: 1.26 },
      a4: { az: 305, el: 43, dist: 1.26 },
      low: { az: 35, el: 27, dist: 1.18 },
    };
    const preset = presets[name];
    if (!preset) return;
    const az = THREE.MathUtils.degToRad(preset.az);
    const el = THREE.MathUtils.degToRad(preset.el);
    const r = max * preset.dist;
    const position = center.clone().add(new THREE.Vector3(Math.cos(el) * Math.cos(az) * r, Math.sin(el) * r, Math.cos(el) * Math.sin(az) * r));
    this._animateCameraTo({ position: position.toArray(), target: center.toArray(), up: preset.up || [0, 1, 0] });
  }

  _animateCameraTo(view, duration = 900) {
    if (!view?.position || !view?.target || this._cameraAnimating) return;
    const startPos = this._camera.position.clone();
    const startTarget = this._controls.target.clone();
    const startUp = this._camera.up.clone();
    const targetPos = new THREE.Vector3(...view.position);
    const targetTarget = new THREE.Vector3(...view.target);
    const targetUp = new THREE.Vector3(...(view.up || [0, 1, 0]));
    const started = performance.now();
    const oldDamping = this._controls.enableDamping;
    this._cameraAnimating = true;
    this._controls.enabled = false;
    this._controls.enableDamping = false;

    const frame = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const u = ease(t);
      this._camera.position.lerpVectors(startPos, targetPos, u);
      this._controls.target.lerpVectors(startTarget, targetTarget, u);
      this._camera.up.lerpVectors(startUp, targetUp, u).normalize();
      this._camera.lookAt(this._controls.target);
      if (t < 1) {
        requestAnimationFrame(frame);
        return;
      }
      this._camera.position.copy(targetPos);
      this._controls.target.copy(targetTarget);
      this._camera.up.copy(targetUp);
      this._camera.lookAt(this._controls.target);
      this._controls.enabled = true;
      this._controls.enableDamping = oldDamping;
      this._cameraAnimating = false;
      this._controls.update();
    };
    requestAnimationFrame(frame);
  }

  _readCustomViews() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CUSTOM_VIEWS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  _saveCurrentView() {
    if (!this._model) return;
    const name = `Vista ${this._customViews.length + 1}`;
    this._customViews.push({ id: `${Date.now()}`, name, view: this._captureCameraView() });
    localStorage.setItem(CUSTOM_VIEWS_KEY, JSON.stringify(this._customViews));
    this._renderCustomViews();
  }

  _renderCustomViews() {
    const host = this.shadowRoot?.querySelector("#customViews");
    if (!host) return;
    host.innerHTML = "";
    for (const saved of this._customViews) {
      const row = document.createElement("div");
      row.className = "customRow";
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = saved.name;
      open.addEventListener("click", () => this._animateCameraTo(saved.view));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Excluir vista";
      remove.addEventListener("click", () => {
        this._customViews = this._customViews.filter((item) => item.id !== saved.id);
        localStorage.setItem(CUSTOM_VIEWS_KEY, JSON.stringify(this._customViews));
        this._renderCustomViews();
      });
      row.append(open, remove);
      host.appendChild(row);
    }
  }

  _resize() {
    if (!this._renderer) return;
    const stage = this.shadowRoot.querySelector("#stage");
    const width = Math.max(stage.clientWidth, 1);
    const height = Math.max(stage.clientHeight, 1);
    this._camera.aspect = width / height;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(width, height, false);
  }

  _updateAdminUi() {
    if (!this.shadowRoot) return;
    const isAdmin = Boolean(this._hass?.user?.is_admin);
    this.shadowRoot.querySelector("#uploadButton").style.display = isAdmin ? "inline-block" : "none";
    this.shadowRoot.querySelector("#emptyUploadButton").style.display = isAdmin ? "inline-block" : "none";
  }

  _setUploadEnabled(enabled) {
    for (const selector of ["#uploadButton", "#emptyUploadButton"]) {
      const button = this.shadowRoot.querySelector(selector);
      if (button) button.disabled = !enabled;
    }
  }

  _showEmpty(show) {
    this.shadowRoot.querySelector("#empty").style.display = show ? "grid" : "none";
  }

  _setStatus(text) {
    const node = this.shadowRoot?.querySelector("#status");
    if (node) node.textContent = text;
  }
}

if (!customElements.get("ha3d-panel")) customElements.define("ha3d-panel", HA3DPanel);
