import * as THREE from "https://esm.sh/three@0.180.0";
import { OrbitControls } from "https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";

const TOGGLE_DOMAINS = new Set(["light", "switch", "input_boolean", "fan"]);

class HA3DPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._panel = null;
    this._config = null;
    this._model = null;
    this._selectedEntity = null;
    this._boundCount = 0;
    this._objectsByEntity = new Map();
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._resizeObserver = null;
    this._initialized = false;
  }

  set hass(value) {
    this._hass = value;
    if (this.isConnected) {
      this._updateAdminUi();
      this._updateSelectionUi();
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
        :host {
          display: block;
          width: 100%;
          height: 100%;
          min-height: 100vh;
          background: #0a0b0e;
          color: var(--primary-text-color, #fff);
          font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif);
          overflow: hidden;
        }
        * { box-sizing: border-box; }
        #root { position: relative; width: 100%; height: 100vh; overflow: hidden; }
        #stage { position: absolute; inset: 0; }
        canvas { display: block; width: 100%; height: 100%; touch-action: none; }
        #topbar {
          position: absolute;
          top: max(12px, env(safe-area-inset-top));
          left: max(12px, env(safe-area-inset-left));
          right: max(12px, env(safe-area-inset-right));
          display: flex;
          align-items: center;
          gap: 10px;
          z-index: 5;
          pointer-events: none;
        }
        .glass {
          background: color-mix(in srgb, var(--card-background-color, #15171d) 88%, transparent);
          border: 1px solid rgba(255,255,255,.12);
          box-shadow: 0 10px 35px rgba(0,0,0,.28);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
        }
        #brand {
          pointer-events: auto;
          min-width: 0;
          padding: 10px 14px;
          border-radius: 14px;
          display: flex;
          align-items: baseline;
          gap: 10px;
        }
        #brand strong { font-size: 15px; letter-spacing: .02em; }
        #status { opacity: .7; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #actions { margin-left: auto; display: flex; gap: 8px; pointer-events: auto; }
        button {
          appearance: none;
          border: 1px solid rgba(255,255,255,.14);
          border-radius: 12px;
          padding: 10px 13px;
          background: color-mix(in srgb, var(--primary-color, #03a9f4) 82%, #111);
          color: #fff;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }
        button.secondary { background: rgba(30,32,39,.88); }
        button:disabled { opacity: .45; cursor: default; }
        #empty {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          z-index: 2;
          pointer-events: none;
        }
        #emptyCard {
          width: min(520px, calc(100vw - 36px));
          padding: 28px;
          border-radius: 22px;
          text-align: center;
          pointer-events: auto;
        }
        #emptyCard h2 { margin: 0 0 8px; font-size: 22px; }
        #emptyCard p { margin: 0 0 18px; opacity: .72; line-height: 1.45; }
        #emptyCard code { font-size: 12px; opacity: .9; }
        #selection {
          position: absolute;
          left: 50%;
          bottom: max(18px, env(safe-area-inset-bottom));
          transform: translateX(-50%);
          z-index: 5;
          min-width: min(430px, calc(100vw - 28px));
          max-width: calc(100vw - 28px);
          border-radius: 16px;
          padding: 12px 14px;
          display: none;
          align-items: center;
          gap: 12px;
        }
        #selection.visible { display: flex; }
        #entityText { min-width: 0; flex: 1; }
        #entityName { font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #entityState { margin-top: 2px; font-size: 12px; opacity: .68; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #meta {
          position: absolute;
          right: max(12px, env(safe-area-inset-right));
          bottom: max(12px, env(safe-area-inset-bottom));
          z-index: 3;
          padding: 8px 10px;
          border-radius: 12px;
          font-size: 11px;
          opacity: .75;
          pointer-events: none;
        }
        input[type=file] { display: none; }
        @media (max-width: 600px) {
          #brand { max-width: 58vw; }
          #brand strong { font-size: 14px; }
          #status { display: none; }
          #selection { bottom: max(12px, env(safe-area-inset-bottom)); }
          #meta { display: none; }
        }
      </style>
      <div id="root">
        <div id="stage"></div>
        <div id="topbar">
          <div id="brand" class="glass"><strong>HA3D</strong><span id="status">Iniciando…</span></div>
          <div id="actions">
            <button id="uploadButton" type="button">Subir GLB</button>
            <input id="fileInput" type="file" accept=".glb,model/gltf-binary">
          </div>
        </div>
        <div id="empty">
          <div id="emptyCard" class="glass">
            <h2>Seu Home Assistant em 3D</h2>
            <p>Suba um arquivo GLB. Objetos cujo nome seja um <code>entity_id</code> existente serão vinculados automaticamente.</p>
            <button id="emptyUploadButton" type="button">Escolher GLB</button>
          </div>
        </div>
        <div id="selection" class="glass">
          <div id="entityText"><div id="entityName"></div><div id="entityState"></div></div>
          <button id="toggleButton" type="button">Alternar</button>
          <button id="closeSelection" class="secondary" type="button">Fechar</button>
        </div>
        <div id="meta" class="glass">0 vínculos</div>
      </div>
    `;
  }

  _initViewer() {
    const stage = this.shadowRoot.querySelector("#stage");
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x0a0b0e);

    this._camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);
    this._camera.position.set(4, 4, 4);

    this._renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1;
    stage.appendChild(this._renderer.domElement);

    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.08;

    this._scene.add(new THREE.HemisphereLight(0xffffff, 0x30343d, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(5, 10, 7);
    this._scene.add(sun);

    this._loader = new GLTFLoader();
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(stage);
    this._resize();
    this._renderer.setAnimationLoop(() => {
      this._controls.update();
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
    this.shadowRoot.querySelector("#toggleButton").addEventListener("click", () => this._toggleSelected());
    this.shadowRoot.querySelector("#closeSelection").addEventListener("click", () => this._selectEntity(null));
    this._renderer.domElement.addEventListener("click", (event) => this._pick(event));
    this._updateAdminUi();
  }

  async _waitForHassAndLoad() {
    for (let i = 0; i < 100 && !this._hass; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!this._hass) {
      this._setStatus("Home Assistant indisponível");
      return;
    }
    await this._loadConfig();
  }

  async _loadConfig() {
    try {
      this._setStatus("Lendo configuração…");
      this._config = await this._hass.callApi("GET", "ha3d/config");
      if (this._config?.model_url) {
        await this._loadModel(this._config.model_url);
      } else {
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
      const response = await this._hass.fetchWithAuth("/api/ha3d/model", {
        method: "POST",
        body: form,
      });
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
    if (this._model) this._scene.remove(this._model);
    this._model = gltf.scene;
    this._scene.add(this._model);
    this._indexBindings();
    this._fit(this._model);
    this._showEmpty(false);
    this._setStatus(`Pronto · ${this._boundCount} vínculos`);
  }

  _indexBindings() {
    this._objectsByEntity.clear();
    this._boundCount = 0;
    const explicit = this._config?.bindings || {};
    const autoBind = this._config?.auto_bind !== false;
    const states = this._hass?.states || {};

    this._model?.traverse((object) => {
      if (!object.name) return;
      const entityId = explicit[object.name] || (autoBind && states[object.name] ? object.name : null);
      if (!entityId || !states[entityId]) return;
      object.userData.ha3dEntityId = entityId;
      if (!this._objectsByEntity.has(entityId)) {
        this._objectsByEntity.set(entityId, []);
        this._boundCount += 1;
      }
      this._objectsByEntity.get(entityId).push(object);
    });

    this.shadowRoot.querySelector("#meta").textContent = `${this._boundCount} vínculos`;
  }

  _pick(event) {
    if (!this._model) return;
    const rect = this._renderer.domElement.getBoundingClientRect();
    this._pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._pointer, this._camera);
    const hit = this._raycaster.intersectObject(this._model, true)[0]?.object;
    let node = hit;
    while (node && !node.userData?.ha3dEntityId) node = node.parent;
    this._selectEntity(node?.userData?.ha3dEntityId || null);
  }

  _selectEntity(entityId) {
    this._selectedEntity = entityId;
    this._updateSelectionUi();
  }

  _updateSelectionUi() {
    if (!this.shadowRoot) return;
    const panel = this.shadowRoot.querySelector("#selection");
    const stateObj = this._selectedEntity ? this._hass?.states?.[this._selectedEntity] : null;
    if (!stateObj) {
      panel?.classList.remove("visible");
      return;
    }

    const friendly = stateObj.attributes?.friendly_name || stateObj.entity_id;
    this.shadowRoot.querySelector("#entityName").textContent = friendly;
    this.shadowRoot.querySelector("#entityState").textContent = `${stateObj.entity_id} · ${stateObj.state}`;
    const domain = stateObj.entity_id.split(".", 1)[0];
    this.shadowRoot.querySelector("#toggleButton").style.display = TOGGLE_DOMAINS.has(domain) ? "inline-block" : "none";
    panel.classList.add("visible");
  }

  async _toggleSelected() {
    if (!this._selectedEntity || !this._hass) return;
    try {
      await this._hass.callService("homeassistant", "toggle", { entity_id: this._selectedEntity });
    } catch (error) {
      console.error("[HA3D] toggle", error);
      this._setStatus(`Falha ao controlar ${this._selectedEntity}`);
    }
  }

  _fit(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z) || 1;
    this._controls.target.copy(center);
    this._camera.near = Math.max(max / 5000, 0.01);
    this._camera.far = max * 100;
    this._camera.position.copy(center).add(new THREE.Vector3(max * 0.9, max * 0.72, max * 0.9));
    this._camera.updateProjectionMatrix();
    this._controls.update();
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
    for (const id of ["#uploadButton", "#emptyUploadButton"]) {
      const button = this.shadowRoot.querySelector(id);
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

if (!customElements.get("ha3d-panel")) {
  customElements.define("ha3d-panel", HA3DPanel);
}
