import "./ha3d-panel.js";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const THREE = Panel.HA3D_THREE;
if (!THREE) throw new Error("HA3D Three.js runtime was not registered");

const proto = Panel.prototype;
const TARGET_WIDTH_METERS = 1.0;
const DISTANCE_FROM_VIEWER_METERS = 1.0;
const CENTER_BELOW_EYES_METERS = 0.25;
const LEGACY_ANCHOR_KEY = "ha3d_webxr_anchor_v2";
const ANCHOR_MIGRATION_KEY = "ha3d_webxr_beta10_anchor_migrated";

function ensureFixState(panel) {
  panel._ha3dARTabletopNeedsViewerPlacement ??= false;
  panel._ha3dARTabletopLocalCenter ||= null;
  panel._ha3dARTabletopScale ||= 1;
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

function migrateOldPlacementOnce(panel) {
  try {
    if (localStorage.getItem(ANCHOR_MIGRATION_KEY) === "1") return;
    deleteCurrentAnchor(panel, true);
    localStorage.setItem(ANCHOR_MIGRATION_KEY, "1");
    console.info("[HA3D AR] beta.10 cleared stale pre-viewer-relative anchor once");
  } catch (_error) {
    deleteCurrentAnchor(panel, false);
  }
}

function prepareViewerRelativeTabletop(panel) {
  ensureFixState(panel);
  const root = panel?._ha3dAR3Root;
  const model = panel?._model;
  if (!root || !model || !panel._ha3dXRPresenting) return false;

  // A placement restored after beta.10 was made by the user and should win.
  if (panel._ha3dAR3Anchor || panel._ha3dAR3AnchorHandle) return false;

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

  // Do not let automatic plane snapping move the model before the user grabs it.
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

function installPlacementRenderHook(panel) {
  const renderer = panel?._renderer;
  if (!renderer?.render || renderer.__ha3dARViewerPlacementFix) return;
  renderer.__ha3dARViewerPlacementFix = true;
  const render = renderer.render.bind(renderer);
  renderer.render = (...args) => {
    if (panel._ha3dXRPresenting && panel._ha3dARTabletopNeedsViewerPlacement) {
      const frame = renderer.xr?.getFrame?.();
      if (frame) placeInFrontOfViewer(panel, frame);
    }
    return render(...args);
  };
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
  const local = root.getWorldPosition(new THREE.Vector3())
    .applyMatrix4(controller.matrixWorld.clone().invert());
  panel._ha3dAR3Single = { controller, local };
  panel._ha3dAR3Dual = null;
}

function beginDualGrab(panel) {
  const root = panel._ha3dAR3Root;
  const active = [...(panel._ha3dAR3Active?.values?.() || [])];
  if (!root || active.length < 2) return;
  const a = controllerWorldPosition(active[0]);
  const b = controllerWorldPosition(active[1]);
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  const delta = b.clone().sub(a);
  panel._ha3dAR3Dual = {
    controllers: [active[0], active[1]],
    distance: Math.max(delta.length(), 0.01),
    angle: Math.atan2(delta.z, delta.x),
    scale: root.scale.x,
    quaternion: root.quaternion.clone(),
    offset: root.position.clone().sub(midpoint),
  };
  panel._ha3dAR3Single = null;
}

function grabStart(panel, controller) {
  if (!panel._ha3dXRPresenting || !panel._ha3dAR3Root) return;
  const active = panel._ha3dAR3Active;
  if (!active) return;
  const index = Number(controller.userData.ha3dIndex ?? 0);
  if (active.has(index)) return;

  if (!active.size) deleteCurrentAnchor(panel, true);
  panel._ha3dAR3ManualMoved = true;
  panel._ha3dAR3TableSnapped = false;
  active.set(index, controller);
  pulse(controller, 0.32, 38);
  if (active.size >= 2) beginDualGrab(panel);
  else beginSingleGrab(panel, controller);
}

function grabEnd(panel, controller) {
  const active = panel._ha3dAR3Active;
  if (!active) return;
  const index = Number(controller.userData.ha3dIndex ?? 0);
  if (!active.has(index)) return;
  active.delete(index);
  pulse(controller, 0.18, 24);

  if (active.size >= 2) beginDualGrab(panel);
  else if (active.size === 1) beginSingleGrab(panel, [...active.values()][0]);
  else {
    panel._ha3dAR3Single = null;
    panel._ha3dAR3Dual = null;
    panel._ha3dAR3AnchorPending = true;
  }
}

function installGrabOverride(panel) {
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

    // Always show the controller ray. Grabbing no longer requires hitting a mesh:
    // primary trigger/pinch picks up the whole tabletop from anywhere.
    controller.visible = true;
  }
}

if (!proto.__ha3dARTabletopViewerFixV2) {
  proto.__ha3dARTabletopViewerFixV2 = true;

  const originalInitViewer = proto._initViewer;
  if (typeof originalInitViewer === "function") {
    proto._initViewer = function (...args) {
      const result = originalInitViewer.apply(this, args);
      queueMicrotask(() => installPlacementRenderHook(this));
      return result;
    };
  }

  const originalToggle = proto._ha3dToggleXR;
  if (typeof originalToggle === "function") {
    proto._ha3dToggleXR = async function (...args) {
      const wasPresenting = Boolean(this._ha3dXRPresenting);
      const result = await originalToggle.apply(this, args);

      if (!wasPresenting && this._ha3dXRPresenting) {
        migrateOldPlacementOnce(this);
        installPlacementRenderHook(this);
        installGrabOverride(this);
        prepareViewerRelativeTabletop(this);
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
  for (const panel of collect(document)) installPlacementRenderHook(panel);
}

queueMicrotask(installExisting);
requestAnimationFrame(installExisting);
setTimeout(installExisting, 250);
setTimeout(installExisting, 1000);
