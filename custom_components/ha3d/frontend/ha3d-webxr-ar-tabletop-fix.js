import "./ha3d-panel.js";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const THREE = Panel.HA3D_THREE;
if (!THREE) throw new Error("HA3D Three.js runtime was not registered");

const proto = Panel.prototype;
const TARGET_WIDTH_METERS = 1.0;
const TABLETOP_BOTTOM_METERS = 0.75;
const DISTANCE_METERS = 1.25;

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

  // The apartment contains many nearby meshes. A single exported mesh/helper far
  // away must not expand the bounds enough to turn the whole model into a dot.
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

function applyRobustTabletop(panel) {
  const root = panel?._ha3dAR3Root;
  const model = panel?._model;
  if (!root || !model || !panel._ha3dXRPresenting) return false;

  // Preserve an explicitly restored/persisted placement or a table snap/user move.
  if (
    panel._ha3dAR3Anchor
    || panel._ha3dAR3AnchorHandle
    || panel._ha3dAR3ManualMoved
    || panel._ha3dAR3TableSnapped
  ) return false;

  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  const box = robustModelBounds(model);
  if (!box || box.isEmpty()) return false;
  const size = box.getSize(new THREE.Vector3());
  const horizontal = Math.max(size.x, size.z) || Math.max(size.x, size.y, size.z) || 1;
  const scale = TARGET_WIDTH_METERS / horizontal;
  const center = box.getCenter(new THREE.Vector3());

  root.scale.setScalar(scale);
  root.position.set(
    -center.x * scale,
    TABLETOP_BOTTOM_METERS - box.min.y * scale,
    -DISTANCE_METERS - center.z * scale,
  );
  root.updateMatrixWorld(true);

  console.info("[HA3D AR] robust tabletop placement", {
    sourceSize: size.toArray(),
    scale,
    targetWidthMeters: TARGET_WIDTH_METERS,
    bottomMeters: TABLETOP_BOTTOM_METERS,
    distanceMeters: DISTANCE_METERS,
  });
  return true;
}

if (!proto.__ha3dARTabletopBoundsFix) {
  proto.__ha3dARTabletopBoundsFix = true;
  const originalToggle = proto._ha3dToggleXR;
  if (typeof originalToggle === "function") {
    proto._ha3dToggleXR = async function (...args) {
      const wasPresenting = Boolean(this._ha3dXRPresenting);
      const result = await originalToggle.apply(this, args);
      if (!wasPresenting && this._ha3dXRPresenting) applyRobustTabletop(this);
      return result;
    };
  }
}
