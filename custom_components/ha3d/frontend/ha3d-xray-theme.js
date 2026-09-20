import * as THREE from "https://esm.sh/three@0.180.0";

const XRAY_KEY = "ha3d_xray_theme_v1";
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const meshState = new WeakMap();

function ensureState(panel) {
  if (typeof panel._ha3dXrayEnabled !== "boolean") {
    panel._ha3dXrayEnabled = localStorage.getItem(XRAY_KEY) === "1";
  }

  if (!panel._ha3dXrayMaterial) {
    panel._ha3dXrayMaterial = new THREE.MeshBasicMaterial({
      color: 0x0bbcff,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
  }

  if (!panel._ha3dXrayEdgeMaterial) {
    panel._ha3dXrayEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0x4de7ff,
      transparent: true,
      opacity: 0.82,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }
}

function ensureStyle(panel) {
  if (!panel.shadowRoot || panel.shadowRoot.querySelector("#ha3dXrayThemeStyle")) return;
  const style = document.createElement("style");
  style.id = "ha3dXrayThemeStyle";
  style.textContent = `
    #xrayThemeButton{
      min-width:42px;
      padding-left:12px;
      padding-right:12px;
      transition:background .18s ease,border-color .18s ease,box-shadow .18s ease,color .18s ease;
    }
    #xrayThemeButton.active{
      color:#dffaff;
      background:rgba(0,145,205,.72);
      border-color:rgba(77,231,255,.88);
      box-shadow:0 0 18px rgba(0,196,255,.38), inset 0 0 12px rgba(77,231,255,.10);
    }
  `;
  panel.shadowRoot.appendChild(style);
}

function syncButton(panel) {
  const button = panel.shadowRoot?.querySelector("#xrayThemeButton");
  if (!button) return;
  const enabled = Boolean(panel._ha3dXrayEnabled);
  button.classList.toggle("active", enabled);
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
  button.title = enabled ? "Desativar tema X-Ray" : "Ativar tema X-Ray";
}

function ensureButton(panel) {
  const actions = panel.shadowRoot?.querySelector("#actions");
  if (!actions) return false;

  ensureState(panel);
  ensureStyle(panel);

  let button = panel.shadowRoot.querySelector("#xrayThemeButton");
  if (!button) {
    button = document.createElement("button");
    button.id = "xrayThemeButton";
    button.className = "secondary";
    button.type = "button";
    button.textContent = "◈";
    button.setAttribute("aria-label", "Tema X-Ray");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setEnabled(panel, !panel._ha3dXrayEnabled);
    });

    const upload = panel.shadowRoot.querySelector("#uploadButton");
    if (upload?.parentNode === actions) actions.insertBefore(button, upload);
    else actions.appendChild(button);
  }

  syncButton(panel);
  return true;
}

function ensureMeshXray(panel, mesh) {
  let state = meshState.get(mesh);
  if (!state) {
    state = {
      material: mesh.material,
      renderOrder: mesh.renderOrder,
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      edge: null,
    };
    meshState.set(mesh, state);
  }

  if (!state.edge && mesh.geometry?.attributes?.position) {
    try {
      const geometry = new THREE.EdgesGeometry(mesh.geometry, 28);
      const edge = new THREE.LineSegments(geometry, panel._ha3dXrayEdgeMaterial);
      edge.name = "__HA3D_XRAY_EDGES__";
      edge.userData.ha3dXrayOverlay = true;
      edge.frustumCulled = mesh.frustumCulled;
      edge.renderOrder = 3;
      edge.visible = false;
      mesh.add(edge);
      state.edge = edge;
    } catch (error) {
      console.warn("[HA3D] X-Ray edges skipped", mesh.name, error);
    }
  }

  return state;
}

function applyModel(panel, enabled) {
  ensureState(panel);
  const model = panel._model;
  if (!model) return;

  model.traverse((object) => {
    if (!object.isMesh || object.userData?.ha3dXrayOverlay) return;

    // Keep normal mode almost free: edge geometry is created only after the
    // user enables X-Ray for the first time.
    let state = meshState.get(object);
    if (enabled) state = ensureMeshXray(panel, object);
    else if (!state) return;

    if (enabled) {
      object.material = panel._ha3dXrayMaterial;
      object.renderOrder = 1;
      object.castShadow = false;
      object.receiveShadow = false;
      if (state.edge) state.edge.visible = true;
    } else {
      object.material = state.material;
      object.renderOrder = state.renderOrder;
      object.castShadow = state.castShadow;
      object.receiveShadow = state.receiveShadow;
      if (state.edge) state.edge.visible = false;
    }
  });
}

function applyBackground(panel, enabled) {
  if (!panel._scene) return;

  if (!panel._ha3dXrayBackgroundCaptured) {
    panel._ha3dXrayBackgroundCaptured = true;
    panel._ha3dXrayOriginalBackground = panel._scene.background?.clone?.() ?? panel._scene.background ?? null;
  }

  if (enabled) {
    panel._scene.background = new THREE.Color(0x01070b);
  } else {
    const original = panel._ha3dXrayOriginalBackground;
    panel._scene.background = original?.clone?.() ?? original ?? null;
  }
}

function applyTheme(panel) {
  ensureState(panel);
  const enabled = Boolean(panel._ha3dXrayEnabled);
  applyBackground(panel, enabled);
  applyModel(panel, enabled);
  syncButton(panel);
}

function setEnabled(panel, enabled) {
  ensureState(panel);
  panel._ha3dXrayEnabled = Boolean(enabled);
  localStorage.setItem(XRAY_KEY, panel._ha3dXrayEnabled ? "1" : "0");
  applyTheme(panel);
}

function disposeOldModel(model) {
  if (!model) return;
  const edges = [];
  model.traverse((object) => {
    if (!object.isMesh) return;
    const state = meshState.get(object);
    if (state?.edge) edges.push([object, state.edge]);
  });
  for (const [mesh, edge] of edges) {
    mesh.remove(edge);
    edge.geometry?.dispose?.();
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
  for (const panel of collectPanels(document)) {
    ensureState(panel);
    ensureButton(panel);
    applyTheme(panel);
  }
}

if (!proto.__ha3dXrayThemeV1) {
  proto.__ha3dXrayThemeV1 = true;

  const originalConnectedCallback = proto.connectedCallback;
  proto.connectedCallback = function () {
    ensureState(this);
    originalConnectedCallback?.call(this);
    queueMicrotask(() => {
      ensureButton(this);
      applyTheme(this);
    });
  };

  const originalLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const previousModel = this._model;
    const result = await originalLoadModel.apply(this, args);
    if (previousModel && previousModel !== this._model) disposeOldModel(previousModel);
    ensureButton(this);
    applyTheme(this);
    return result;
  };

  const originalInitViewer = proto._initViewer;
  proto._initViewer = function (...args) {
    const result = originalInitViewer?.apply(this, args);
    applyBackground(this, Boolean(this._ha3dXrayEnabled));
    return result;
  };

  queueMicrotask(installOnExistingPanels);
  requestAnimationFrame(installOnExistingPanels);
  setTimeout(installOnExistingPanels, 250);
  setTimeout(installOnExistingPanels, 1000);
}
