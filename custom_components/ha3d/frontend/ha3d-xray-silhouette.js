import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function isXrayActive(panel) {
  return Boolean(panel?.shadowRoot?.querySelector("#root")?.classList.contains("ha3d-idle-xray"));
}

function makeSilhouetteMaterial(color, baseOpacity = 0.008, rimOpacity = 0.72) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uBaseOpacity: { value: baseOpacity },
      uRimOpacity: { value: rimOpacity },
    },
    vertexShader: `
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uBaseOpacity;
      uniform float uRimOpacity;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
        float rim = 1.0 - clamp(facing, 0.0, 1.0);
        rim = smoothstep(0.72, 0.97, rim);
        rim = pow(rim, 2.2);
        float alpha = mix(uBaseOpacity, uRimOpacity, rim);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function ensureMaterials(panel) {
  if (!panel._ha3dXraySilhouetteMaterial) {
    panel._ha3dXraySilhouetteMaterial = makeSilhouetteMaterial(0x4de7ff, 0.008, 0.72);
  }
  if (!panel._ha3dXraySilhouetteOpenMaterial) {
    panel._ha3dXraySilhouetteOpenMaterial = makeSilhouetteMaterial(0xff596b, 0.015, 0.88);
  }
}

function isDoorWindowSensor(entity, state) {
  if (!String(entity || "").startsWith("binary_sensor.")) return false;
  const deviceClass = String(state?.attributes?.device_class || "").toLowerCase();
  if (["window", "door", "opening"].includes(deviceClass)) return true;
  const objectId = String(entity).slice("binary_sensor.".length).toLowerCase();
  return /(^|_)(janela|porta|window|door)(_|$)/.test(objectId);
}

function collectMeshes(object, target) {
  if (!object) return;
  if (object.isMesh && !object.userData?.ha3dXrayOverlay) target.add(object);
  object.traverse?.((child) => {
    if (child === object) return;
    if (child.isMesh && !child.userData?.ha3dXrayOverlay) target.add(child);
  });
}

function openAlertMeshes(panel) {
  const result = new Set();
  const states = panel._hass?.states || {};
  for (const [entity, objects] of panel._objectsByEntity?.entries?.() || []) {
    const state = states[entity];
    if (!isDoorWindowSensor(entity, state) || state?.state !== "on") continue;
    for (const object of objects || []) collectMeshes(object, result);
  }
  return result;
}

function hideLegacyEdges(panel) {
  panel?._model?.traverse?.((object) => {
    if (object?.userData?.ha3dXrayOverlay || object?.name === "__HA3D_XRAY_EDGES__") {
      object.visible = false;
    }
  });
}

function applySilhouette(panel) {
  if (!isXrayActive(panel) || !panel?._model) return;
  ensureMaterials(panel);
  hideLegacyEdges(panel);
  const alerts = openAlertMeshes(panel);

  panel._model.traverse((object) => {
    if (!object.isMesh || object.userData?.ha3dXrayOverlay) return;
    object.material = alerts.has(object)
      ? panel._ha3dXraySilhouetteOpenMaterial
      : panel._ha3dXraySilhouetteMaterial;
    object.renderOrder = 1;
    object.castShadow = false;
    object.receiveShadow = false;
  });
}

function install(panel) {
  ensureMaterials(panel);
  const root = panel?.shadowRoot?.querySelector("#root");
  if (!root) return;

  if (!root.__ha3dXraySilhouetteObserver) {
    const observer = new MutationObserver(() => {
      if (isXrayActive(panel)) queueMicrotask(() => applySilhouette(panel));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    root.__ha3dXraySilhouetteObserver = observer;
  }

  if (isXrayActive(panel)) queueMicrotask(() => applySilhouette(panel));
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
  for (const panel of collectPanels(document)) install(panel);
}

if (!proto.__ha3dXraySilhouetteV1) {
  proto.__ha3dXraySilhouetteV1 = true;

  const originalConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = originalConnected?.apply(this, args);
    queueMicrotask(() => install(this));
    return result;
  };

  const originalLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await originalLoadModel?.apply(this, args);
    queueMicrotask(() => install(this));
    return result;
  };

  const hassDescriptor = Object.getOwnPropertyDescriptor(proto, "hass");
  if (hassDescriptor?.set) {
    Object.defineProperty(proto, "hass", {
      configurable: hassDescriptor.configurable ?? true,
      enumerable: hassDescriptor.enumerable ?? false,
      get: hassDescriptor.get,
      set(value) {
        hassDescriptor.set.call(this, value);
        if (isXrayActive(this)) queueMicrotask(() => applySilhouette(this));
      },
    });
  }

  queueMicrotask(installOnExistingPanels);
  requestAnimationFrame(installOnExistingPanels);
  setTimeout(installOnExistingPanels, 250);
  setTimeout(installOnExistingPanels, 1000);
}
