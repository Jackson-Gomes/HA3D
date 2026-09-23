const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const THREE = Panel.HA3D_THREE;
if (!THREE) throw new Error("HA3D Three.js runtime was not registered");

const proto = Panel.prototype;
const CLEANING_STATE = "cleaning";
const EFFECT_COLOR = 0x4de7ff;

function disposeMaterial(material) {
  if (!material) return;
  if (Array.isArray(material)) material.forEach((item) => item?.dispose?.());
  else material.dispose?.();
}

function disposeEffect(effect) {
  if (!effect) return;
  effect.root?.removeFromParent?.();
  effect.root?.traverse?.((node) => {
    node.geometry?.dispose?.();
    disposeMaterial(node.material);
  });
}

function disposeAll(panel) {
  for (const effect of panel._ha3dRobotCleaningEffects?.values?.() || []) disposeEffect(effect);
  panel._ha3dRobotCleaningEffects = new Map();
}

function effectSize(panel, source) {
  const sceneScale = Math.max(0.001, Number(panel?._modelScale) || 10);
  const fallback = sceneScale * 0.022;
  if (!source) return fallback;
  try {
    const size = new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3());
    const footprint = Math.max(size.x, size.z, Math.min(size.y, sceneScale * 0.08));
    if (Number.isFinite(footprint) && footprint > sceneScale * 0.002 && footprint < sceneScale * 0.2) {
      return Math.max(sceneScale * 0.012, Math.min(sceneScale * 0.038, footprint * 0.58));
    }
  } catch (_error) {}
  return fallback;
}

function xrayMaterial(opacity) {
  return new THREE.MeshBasicMaterial({
    color: EFFECT_COLOR,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function makeEffect(panel, entry) {
  const source = entry?.object || entry?.icon;
  const radius = effectSize(panel, source);
  const root = new THREE.Group();
  root.name = `HA3D_RobotCleaningPulse_${entry?.config?.id || entry?.config?.name || "robot"}`;
  root.visible = false;
  root.userData.ha3dRobotCleaningEffect = true;

  // Simple ghost silhouette. It deliberately does not clone the user's GLB:
  // this keeps the overlay lightweight and guarantees visibility through walls.
  const bodyMaterial = xrayMaterial(0.34);
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, Math.max(radius * 0.30, 0.012), 32),
    bodyMaterial,
  );
  body.position.y = Math.max(radius * 0.22, 0.01);
  body.renderOrder = 1800;
  body.userData.ha3dRobotCleaningEffect = true;
  root.add(body);

  const coreMaterial = xrayMaterial(0.62);
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, Math.max(radius * 0.34, 0.014), 20),
    coreMaterial,
  );
  core.position.y = Math.max(radius * 0.29, 0.012);
  core.renderOrder = 1801;
  core.userData.ha3dRobotCleaningEffect = true;
  root.add(core);

  // Two expanding floor rings create a soft radar pulse.
  const ringGeometryA = new THREE.RingGeometry(radius * 1.10, radius * 1.18, 48);
  const ringGeometryB = new THREE.RingGeometry(radius * 1.10, radius * 1.18, 48);
  const ringMaterialA = xrayMaterial(0.30);
  const ringMaterialB = xrayMaterial(0.22);
  const ringA = new THREE.Mesh(ringGeometryA, ringMaterialA);
  const ringB = new THREE.Mesh(ringGeometryB, ringMaterialB);
  for (const ring of [ringA, ringB]) {
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = Math.max(radius * 0.045, 0.002);
    ring.renderOrder = 1799;
    ring.userData.ha3dRobotCleaningEffect = true;
    root.add(ring);
  }

  // Very subtle vertical beacon. It helps locate the vacuum under furniture,
  // while remaining much dimmer than the floor pulse.
  const beamHeight = Math.max(radius * 2.8, (Number(panel?._modelScale) || 10) * 0.045);
  const beamMaterial = xrayMaterial(0.075);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(Math.max(radius * 0.035, 0.004), Math.max(radius * 0.055, 0.006), beamHeight, 12, 1, true),
    beamMaterial,
  );
  beam.position.y = beamHeight * 0.5;
  beam.renderOrder = 1798;
  beam.userData.ha3dRobotCleaningEffect = true;
  root.add(beam);

  panel._scene?.add(root);
  return {
    root,
    source,
    radius,
    bodyMaterial,
    coreMaterial,
    ringA,
    ringB,
    ringMaterialA,
    ringMaterialB,
    beamMaterial,
  };
}

function ensureEffects(panel) {
  panel._ha3dRobotCleaningEffects ||= new Map();
  const entries = panel._robotObjects?.() || new Map();
  const liveIds = new Set();

  for (const [key, entry] of entries.entries()) {
    const effectKey = String(entry?.config?.id || key);
    liveIds.add(effectKey);
    const source = entry?.object || entry?.icon;
    let effect = panel._ha3dRobotCleaningEffects.get(effectKey);
    if (!effect || effect.source !== source || !effect.root?.parent) {
      if (effect) disposeEffect(effect);
      effect = makeEffect(panel, entry);
      panel._ha3dRobotCleaningEffects.set(effectKey, effect);
    }
  }

  for (const [key, effect] of [...panel._ha3dRobotCleaningEffects.entries()]) {
    if (liveIds.has(key)) continue;
    disposeEffect(effect);
    panel._ha3dRobotCleaningEffects.delete(key);
  }
}

function cleaningActive(panel, entry) {
  const entityId = entry?.config?.vacuum_entity;
  if (!entityId) return false;
  const state = panel?._hass?.states?.[entityId];
  return state?.state === CLEANING_STATE && Boolean((entry.object || entry.icon)?.visible);
}

function syncEffect(panel, entry, effect, now) {
  const source = entry?.object || entry?.icon;
  const active = cleaningActive(panel, entry) && Boolean(source);
  effect.root.visible = active;
  if (!active) return;

  source.updateWorldMatrix?.(true, false);
  source.getWorldPosition(effect.root.position);
  source.getWorldQuaternion(effect.root.quaternion);

  const seconds = now * 0.001;
  const wave = 0.5 + 0.5 * Math.sin(seconds * Math.PI * 1.35);
  effect.bodyMaterial.opacity = 0.28 + wave * 0.10;
  effect.coreMaterial.opacity = 0.54 + wave * 0.14;
  effect.beamMaterial.opacity = 0.045 + wave * 0.045;

  const pulse = (ring, material, phaseOffset) => {
    const phase = (seconds * 0.48 + phaseOffset) % 1;
    const scale = THREE.MathUtils.lerp(0.92, 2.15, phase);
    ring.scale.setScalar(scale);
    material.opacity = Math.max(0, (1 - phase) * 0.32);
  };
  pulse(effect.ringA, effect.ringMaterialA, 0);
  pulse(effect.ringB, effect.ringMaterialB, 0.5);
}

function syncAll(panel, now = performance.now()) {
  if (!panel?._scene) return;
  ensureEffects(panel);
  const entries = panel._robotObjects?.() || new Map();
  for (const [key, entry] of entries.entries()) {
    const effectKey = String(entry?.config?.id || key);
    const effect = panel._ha3dRobotCleaningEffects?.get?.(effectKey);
    if (effect) syncEffect(panel, entry, effect, now);
  }
}

function startLoop(panel) {
  if (panel._ha3dRobotCleaningPulseRaf) return;
  const frame = (now) => {
    if (!panel.isConnected) {
      panel._ha3dRobotCleaningPulseRaf = 0;
      return;
    }
    syncAll(panel, now);
    panel._ha3dRobotCleaningPulseRaf = requestAnimationFrame(frame);
  };
  panel._ha3dRobotCleaningPulseRaf = requestAnimationFrame(frame);
}

function stopLoop(panel) {
  if (panel._ha3dRobotCleaningPulseRaf) cancelAnimationFrame(panel._ha3dRobotCleaningPulseRaf);
  panel._ha3dRobotCleaningPulseRaf = 0;
}

if (!proto.__ha3dRobotCleaningPulseV1) {
  proto.__ha3dRobotCleaningPulseV1 = true;

  const oldConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = oldConnected?.apply(this, args);
    queueMicrotask(() => { syncAll(this); startLoop(this); });
    return result;
  };

  const oldDisconnected = proto.disconnectedCallback;
  proto.disconnectedCallback = function (...args) {
    stopLoop(this);
    disposeAll(this);
    return oldDisconnected?.apply(this, args);
  };

  const oldRebuild = proto._rebuildRobots;
  proto._rebuildRobots = function (...args) {
    disposeAll(this);
    const result = oldRebuild?.apply(this, args);
    syncAll(this);
    return result;
  };

  const oldUpdate = proto._updateRobots;
  proto._updateRobots = function (...args) {
    const result = oldUpdate?.apply(this, args);
    syncAll(this);
    return result;
  };

  const oldLoad = proto._loadModel;
  proto._loadModel = async function (...args) {
    disposeAll(this);
    const result = await oldLoad?.apply(this, args);
    syncAll(this);
    startLoop(this);
    return result;
  };
}
