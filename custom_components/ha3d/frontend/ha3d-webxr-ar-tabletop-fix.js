import "./ha3d-panel.js";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const THREE = Panel.HA3D_THREE;
if (!THREE) throw new Error("HA3D Three.js runtime was not registered");

const proto = Panel.prototype;
const TARGET_WIDTH_METERS = 1.0;
const DISTANCE_FROM_VIEWER_METERS = 0.75;
const CENTER_BELOW_EYES_METERS = 0.05;
const AR_EXPOSURE = 0.55;
const ICON_SIZE_METERS = 0.075;
const LEGACY_ANCHOR_KEY = "ha3d_webxr_anchor_v2";

function ensureFixState(panel) {
  panel._ha3dARTabletopNeedsViewerPlacement ??= false;
  panel._ha3dARTabletopLocalCenter ||= null;
  panel._ha3dARTabletopScale ||= 1;
  panel._ha3dARBetterActive ||= new Map();
  panel._ha3dARBetterSingle ||= null;
  panel._ha3dARBetterDual ||= null;
  panel._ha3dARIconSprites ||= new Map();
  panel._ha3dARIconTextures ||= new Map();
  panel._ha3dARLastIconSync ||= 0;
  panel._ha3dARDisplayRestore ||= null;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function unionBounds(items) {
  const box = new THREE.Box3();
  for (const item of items) box.union(item.box);
  return box;
}

function collectMeshBounds(model) {
  const items = [];
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (!object?.isMesh || object.visible === false || !object.geometry) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox?.();
    const localBox = object.geometry.boundingBox;
    if (!localBox || localBox.isEmpty()) return;

    const box = localBox.clone().applyMatrix4(object.matrixWorld);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const values = [center.x, center.y, center.z, size.x, size.y, size.z];
    if (!values.every(Number.isFinite)) return;
    if (Math.max(size.x, size.y, size.z) <= 1e-7) return;
    items.push({ box, center, size });
  });
  return items;
}

function robustModelBounds(model) {
  const items = collectMeshBounds(model);
  if (!items.length) return new THREE.Box3().setFromObject(model);
  if (items.length < 4) return unionBounds(items);

  const center = new THREE.Vector3(
    median(items.map((item) => item.center.x)),
    median(items.map((item) => item.center.y)),
    median(items.map((item) => item.center.z)),
  );
  const distances = items.map((item) => item.center.distanceTo(center));
  const medianDistance = median(distances);
  const mad = median(distances.map((distance) => Math.abs(distance - medianDistance)));
  const meshSizes = items.map((item) => Math.max(item.size.x, item.size.y, item.size.z));
  const medianMeshSize = Math.max(median(meshSizes), 1e-6);

  const distanceLimit = Math.max(
    medianDistance + Math.max(mad, medianDistance * 0.02) * 12,
    medianDistance * 5,
    medianMeshSize * 30,
    1e-4,
  );

  let kept = items.filter((item) => item.center.distanceTo(center) <= distanceLimit);
  if (kept.length < Math.max(3, Math.ceil(items.length * 0.6))) {
    kept = [...items]
      .sort((a, b) => a.center.distanceTo(center) - b.center.distanceTo(center))
      .slice(0, Math.max(3, Math.ceil(items.length * 0.9)));
  }

  const box = unionBounds(kept);
  console.info("[HA3D AR] robust tabletop bounds", {
    meshes: items.length,
    kept: kept.length,
    rejected: items.length - kept.length,
    distanceLimit,
  });
  return box;
}

function deleteCurrentAnchor(panel, forgetLocal = true) {
  const anchor = panel?._ha3dAR3Anchor;
  const handle = panel?._ha3dAR3AnchorHandle;
  panel._ha3dAR3Anchor = null;
  panel._ha3dAR3AnchorHandle = null;
  panel._ha3dAR3AnchorPending = false;
  panel._ha3dAR3AnchorRestoring = false;
  try { anchor?.delete?.(); } catch (_error) {}
  if (handle && panel?._ha3dXRSession?.deletePersistentAnchor) {
    panel._ha3dXRSession.deletePersistentAnchor(handle).catch(() => {});
  }
  if (forgetLocal) {
    try { localStorage.removeItem(LEGACY_ANCHOR_KEY); } catch (_error) {}
  }
}

function prepareViewerRelativeTabletop(panel) {
  ensureFixState(panel);
  const root = panel?._ha3dAR3Root;
  const model = panel?._model;
  if (!root || !model || !panel._ha3dXRPresenting) return false;

  // Every AR session starts from the current viewer pose. Anchors are still used
  // after a manual move, but are intentionally discarded on the next session.
  deleteCurrentAnchor(panel, true);

  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  const box = robustModelBounds(model);
  if (!box || box.isEmpty()) return false;
  const size = box.getSize(new THREE.Vector3());
  const horizontal = Math.max(size.x, size.z) || Math.max(size.x, size.y, size.z) || 1;
  const scale = TARGET_WIDTH_METERS / horizontal;

  panel._ha3dARTabletopLocalCenter = box.getCenter(new THREE.Vector3());
  panel._ha3dARTabletopScale = scale;
  panel._ha3dARTabletopNeedsViewerPlacement = true;
  root.scale.setScalar(scale);
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);

  panel._ha3dAR3ManualMoved = true;
  panel._ha3dAR3TableSnapped = false;
  clearTimeout(panel._ha3dAR3RoomCaptureTimer);
  panel._ha3dAR3RoomCaptureTimer = 0;
  panel._ha3dAR3RoomCaptureRequested = true;

  console.info("[HA3D AR] viewer-relative tabletop armed", {
    sourceSize: size.toArray(),
    scale,
    targetWidthMeters: TARGET_WIDTH_METERS,
  });
  return true;
}

function placeInFrontOfViewer(panel, frame) {
  ensureFixState(panel);
  if (!panel._ha3dARTabletopNeedsViewerPlacement || !panel._ha3dXRPresenting) return false;
  const root = panel._ha3dAR3Root;
  const center = panel._ha3dARTabletopLocalCenter;
  const space = panel._renderer?.xr?.getReferenceSpace?.();
  const pose = space ? frame?.getViewerPose?.(space) : null;
  const transform = pose?.views?.[0]?.transform;
  if (!root || !center || !transform) return false;

  const head = new THREE.Vector3(
    transform.position.x,
    transform.position.y,
    transform.position.z,
  );
  const q = new THREE.Quaternion(
    transform.orientation.x,
    transform.orientation.y,
    transform.orientation.z,
    transform.orientation.w,
  );
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  else forward.normalize();

  const targetCenter = head.clone().addScaledVector(forward, DISTANCE_FROM_VIEWER_METERS);
  targetCenter.y = head.y - CENTER_BELOW_EYES_METERS;
  const scale = Number(panel._ha3dARTabletopScale) || root.scale.x || 1;

  root.position.copy(targetCenter).sub(center.clone().multiplyScalar(scale));
  root.updateMatrixWorld(true);
  panel._ha3dARTabletopNeedsViewerPlacement = false;

  console.info("[HA3D AR] tabletop placed from viewer pose", {
    head: head.toArray(),
    targetCenter: targetCenter.toArray(),
    distanceMeters: DISTANCE_FROM_VIEWER_METERS,
    centerBelowEyesMeters: CENTER_BELOW_EYES_METERS,
  });
  return true;
}

function applyARDisplayTuning(panel) {
  ensureFixState(panel);
  const renderer = panel?._renderer;
  if (!renderer || panel._ha3dARDisplayRestore) return;
  panel._ha3dARDisplayRestore = {
    exposure: Number(renderer.toneMappingExposure) || 1,
  };
  renderer.toneMappingExposure = AR_EXPOSURE;
}

function restoreARDisplayTuning(panel) {
  const renderer = panel?._renderer;
  const restore = panel?._ha3dARDisplayRestore;
  if (renderer && restore) renderer.toneMappingExposure = restore.exposure;
  if (panel) panel._ha3dARDisplayRestore = null;
}

function pulse(controller, intensity = 0.28, duration = 32) {
  try {
    const actuator = controller?.userData?.ha3dInputSource?.gamepad?.hapticActuators?.[0];
    actuator?.pulse?.(intensity, duration);
  } catch (_error) {}
}

function controllerWorldPosition(controller) {
  return new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
}

function beginSingleGrab(panel, controller) {
  const root = panel._ha3dAR3Root;
  if (!root || !controller) return;
  panel._ha3dARBetterSingle = {
    controller,
    controllerStart: controllerWorldPosition(controller),
    rootStart: root.position.clone(),
  };
  panel._ha3dARBetterDual = null;
}

function beginDualGrab(panel) {
  const root = panel._ha3dAR3Root;
  const active = [...(panel._ha3dARBetterActive?.values?.() || [])];
  if (!root || active.length < 2) return;
  const a = controllerWorldPosition(active[0]);
  const b = controllerWorldPosition(active[1]);
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  const delta = b.clone().sub(a);
  panel._ha3dARBetterDual = {
    controllers: [active[0], active[1]],
    distance: Math.max(delta.length(), 0.01),
    angle: Math.atan2(delta.z, delta.x),
    scale: root.scale.x,
    quaternion: root.quaternion.clone(),
    offset: root.position.clone().sub(midpoint),
  };
  panel._ha3dARBetterSingle = null;
}

function updateBetterGrab(panel) {
  const root = panel?._ha3dAR3Root;
  const active = panel?._ha3dARBetterActive;
  if (!root || !active?.size) return;

  if (active.size >= 2 && panel._ha3dARBetterDual) {
    const grab = panel._ha3dARBetterDual;
    const a = controllerWorldPosition(grab.controllers[0]);
    const b = controllerWorldPosition(grab.controllers[1]);
    const midpoint = a.clone().add(b).multiplyScalar(0.5);
    const delta = b.clone().sub(a);
    const factor = THREE.MathUtils.clamp(Math.max(delta.length(), 0.01) / grab.distance, 0.35, 3.0);
    const angle = Math.atan2(delta.z, delta.x) - grab.angle;
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    root.scale.setScalar(grab.scale * factor);
    root.quaternion.copy(yaw).multiply(grab.quaternion);
    root.position.copy(midpoint).add(grab.offset.clone().multiplyScalar(factor).applyQuaternion(yaw));
    root.updateMatrixWorld(true);
    return;
  }

  const grab = panel._ha3dARBetterSingle;
  if (active.size === 1 && grab?.controller) {
    // Translation-only single-hand grab: wrist rotation no longer swings the
    // whole apartment around the controller.
    const current = controllerWorldPosition(grab.controller);
    root.position.copy(grab.rootStart).add(current.sub(grab.controllerStart));
    root.updateMatrixWorld(true);
  }
}

function glyphForEntity(entity) {
  const [domain, objectId = ""] = String(entity || "").toLowerCase().split(".", 2);
  if (domain === "light") return "💡";
  if (domain === "switch") return /(printer|impressora)/.test(objectId) ? "🖨️" : "🔌";
  if (domain === "media_player") return /(tv|televis)/.test(objectId) ? "📺" : "▶️";
  if (domain === "climate") return "❄️";
  if (domain === "vacuum") return "🤖";
  if (domain === "cover") return "🪟";
  if (domain === "lock") return "🔒";
  if (domain === "camera") return "📷";
  if (domain === "script") return "▶️";
  if (domain === "button") return "●";
  return "●";
}

function iconTexture(panel, glyph) {
  ensureFixState(panel);
  if (panel._ha3dARIconTextures.has(glyph)) return panel._ha3dARIconTextures.get(glyph);
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20,24,30,0.90)";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(255,255,255,0.88)";
  ctx.stroke();
  ctx.font = "58px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "white";
  ctx.fillText(glyph, 64, 67);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  panel._ha3dARIconTextures.set(glyph, texture);
  return texture;
}

function updateXRIconPositions(panel, now = performance.now()) {
  ensureFixState(panel);
  const scene = panel?._scene;
  const bindings = panel?._lightBindings;
  if (!scene || !bindings) return;

  if (now - panel._ha3dARLastIconSync > 500) {
    panel._ha3dARLastIconSync = now;
    const wanted = new Set();
    for (const [entity, binding] of bindings.entries()) {
      const anchor = binding?.anchor;
      if (!anchor?.getWorldPosition) continue;
      wanted.add(entity);
      if (!panel._ha3dARIconSprites.has(entity)) {
        const material = new THREE.SpriteMaterial({
          map: iconTexture(panel, glyphForEntity(entity)),
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.name = `HA3D_AR_Icon_${entity}`;
        sprite.userData.ha3dXRInput = true;
        sprite.userData.ha3dXRIcon = true;
        sprite.userData.ha3dEntityId = entity;
        sprite.renderOrder = 20000;
        sprite.scale.setScalar(ICON_SIZE_METERS);
        scene.add(sprite);
        panel._ha3dARIconSprites.set(entity, sprite);
      }
    }
    for (const [entity, sprite] of panel._ha3dARIconSprites.entries()) {
      if (wanted.has(entity)) continue;
      sprite.material?.dispose?.();
      sprite.parent?.remove(sprite);
      panel._ha3dARIconSprites.delete(entity);
    }
  }

  const states = panel._hass?.states || {};
  for (const [entity, sprite] of panel._ha3dARIconSprites.entries()) {
    const binding = bindings.get(entity);
    const anchor = binding?.anchor;
    if (!anchor?.getWorldPosition) continue;
    anchor.getWorldPosition(sprite.position);
    sprite.position.y += 0.08;
    const state = states[entity]?.state;
    sprite.material.opacity = state === "unavailable" || state === "unknown" ? 0.42 : state === "off" ? 0.72 : 1.0;
  }
}

function raycastXRIcon(panel, controller) {
  const sprites = [...(panel?._ha3dARIconSprites?.values?.() || [])];
  if (!sprites.length || !controller) return null;
  const rotation = new THREE.Matrix4().extractRotation(controller.matrixWorld);
  const raycaster = new THREE.Raycaster();
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rotation).normalize();
  raycaster.camera = panel._renderer?.xr?.getCamera?.(panel._camera) || panel._camera;
  const hit = raycaster.intersectObjects(sprites, false)[0];
  return hit?.object?.userData?.ha3dEntityId || null;
}

async function activateEntity(panel, entity, controller) {
  const hass = panel?._hass;
  if (!hass || !entity) return false;
  const [domain] = entity.split(".", 1);
  try {
    if (["light", "switch", "input_boolean"].includes(domain)) {
      await hass.callService(domain, "toggle", { entity_id: entity });
    } else if (domain === "button") {
      await hass.callService("button", "press", { entity_id: entity });
    } else if (domain === "script") {
      await hass.callService("script", "turn_on", { entity_id: entity });
    } else if (domain === "media_player") {
      const state = hass.states?.[entity]?.state;
      await hass.callService("media_player", state === "off" ? "turn_on" : "media_play_pause", { entity_id: entity });
    } else {
      return false;
    }
    pulse(controller, 0.45, 50);
    return true;
  } catch (error) {
    console.warn("[HA3D AR] entity action failed", entity, error);
    return false;
  }
}

function grabStart(panel, controller) {
  if (!panel._ha3dXRPresenting || !panel._ha3dAR3Root) return;
  ensureFixState(panel);

  const entity = raycastXRIcon(panel, controller);
  if (entity) {
    activateEntity(panel, entity, controller);
    return;
  }

  const active = panel._ha3dARBetterActive;
  const index = Number(controller.userData.ha3dIndex ?? 0);
  if (active.has(index)) return;

  if (!active.size) deleteCurrentAnchor(panel, true);
  panel._ha3dAR3ManualMoved = true;
  panel._ha3dAR3TableSnapped = false;
  panel._ha3dAR3Active?.clear?.();
  active.set(index, controller);
  pulse(controller, 0.32, 38);
  if (active.size >= 2) beginDualGrab(panel);
  else beginSingleGrab(panel, controller);
}

function grabEnd(panel, controller) {
  ensureFixState(panel);
  const active = panel._ha3dARBetterActive;
  const index = Number(controller.userData.ha3dIndex ?? 0);
  if (!active.has(index)) return;
  active.delete(index);
  pulse(controller, 0.18, 24);

  if (active.size >= 2) beginDualGrab(panel);
  else if (active.size === 1) beginSingleGrab(panel, [...active.values()][0]);
  else {
    panel._ha3dARBetterSingle = null;
    panel._ha3dARBetterDual = null;
    panel._ha3dAR3AnchorPending = true;
  }
}

function installGrabOverride(panel) {
  ensureFixState(panel);
  panel._ha3dAR3Active?.clear?.();
  for (const controller of panel?._ha3dAR3Controllers || []) {
    const u = controller.userData || {};
    if (u.ha3dAR3Start) controller.removeEventListener("selectstart", u.ha3dAR3Start);
    if (u.ha3dAR3End) controller.removeEventListener("selectend", u.ha3dAR3End);

    const start = () => grabStart(panel, controller);
    const end = () => grabEnd(panel, controller);
    u.ha3dAR3Start = start;
    u.ha3dAR3End = end;
    controller.addEventListener("selectstart", start);
    controller.addEventListener("selectend", end);
    controller.visible = true;
  }
}

function cleanupBetterXR(panel) {
  ensureFixState(panel);
  panel._ha3dARBetterActive.clear();
  panel._ha3dARBetterSingle = null;
  panel._ha3dARBetterDual = null;
  panel._ha3dARTabletopNeedsViewerPlacement = false;
  restoreARDisplayTuning(panel);
  for (const sprite of panel._ha3dARIconSprites.values()) {
    sprite.material?.dispose?.();
    sprite.parent?.remove(sprite);
  }
  panel._ha3dARIconSprites.clear();
  for (const texture of panel._ha3dARIconTextures.values()) texture.dispose?.();
  panel._ha3dARIconTextures.clear();
}

function installRuntimeHook(panel) {
  const renderer = panel?._renderer;
  if (!renderer?.render || renderer.__ha3dARViewerPlacementFixV3) return;
  renderer.__ha3dARViewerPlacementFixV3 = true;
  const render = renderer.render.bind(renderer);
  renderer.render = (...args) => {
    if (panel._ha3dXRPresenting) {
      const frame = renderer.xr?.getFrame?.();
      if (frame && panel._ha3dARTabletopNeedsViewerPlacement) placeInFrontOfViewer(panel, frame);
      updateBetterGrab(panel);
      updateXRIconPositions(panel);
    }
    return render(...args);
  };
}

if (!proto.__ha3dARTabletopViewerFixV3) {
  proto.__ha3dARTabletopViewerFixV3 = true;

  const originalInitViewer = proto._initViewer;
  if (typeof originalInitViewer === "function") {
    proto._initViewer = function (...args) {
      const result = originalInitViewer.apply(this, args);
      queueMicrotask(() => installRuntimeHook(this));
      return result;
    };
  }

  const originalToggle = proto._ha3dToggleXR;
  if (typeof originalToggle === "function") {
    proto._ha3dToggleXR = async function (...args) {
      const wasPresenting = Boolean(this._ha3dXRPresenting);
      const result = await originalToggle.apply(this, args);

      if (!wasPresenting && this._ha3dXRPresenting) {
        installRuntimeHook(this);
        installGrabOverride(this);
        applyARDisplayTuning(this);
        prepareViewerRelativeTabletop(this);
        updateXRIconPositions(this, performance.now() + 1000);
        this._ha3dXRSession?.addEventListener("end", () => cleanupBetterXR(this), { once: true });
      }
      return result;
    };
  }
}

function collect(root, found = new Set()) {
  if (!root) return found;
  if (root.localName === "ha3d-panel") found.add(root);
  if (!root.querySelectorAll) return found;
  for (const element of root.querySelectorAll("*")) {
    if (element.localName === "ha3d-panel") found.add(element);
    if (element.shadowRoot) collect(element.shadowRoot, found);
  }
  return found;
}

function installExisting() {
  for (const panel of collect(document)) installRuntimeHook(panel);
}

queueMicrotask(installExisting);
requestAnimationFrame(installExisting);
setTimeout(installExisting, 250);
setTimeout(installExisting, 1000);
