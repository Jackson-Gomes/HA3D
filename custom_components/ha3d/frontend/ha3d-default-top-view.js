import * as THREE from "https://esm.sh/three@0.180.0";

// Keep the initial/default camera visually superior while avoiding OrbitControls
// pole lock. A camera almost exactly over the Y axis (89°) barely moves during
// azimuth rotation, and using Z as camera.up makes controls behave differently
// from every other HA3D view. 84° + Y-up stays visually top-down but orbits
// freely and consistently.
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const TOP_AZ_DEG = 0;
const TOP_EL_DEG = 84;
const TOP_DISTANCE = 1.48;
const TOP_UP = [0, 1, 0];

function topViewFor(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z) || 1;
  const az = THREE.MathUtils.degToRad(TOP_AZ_DEG);
  const el = THREE.MathUtils.degToRad(TOP_EL_DEG);
  const r = max * TOP_DISTANCE;
  const position = center.clone().add(
    new THREE.Vector3(
      Math.cos(el) * Math.cos(az) * r,
      Math.sin(el) * r,
      Math.cos(el) * Math.sin(az) * r,
    ),
  );
  return { position: position.toArray(), target: center.toArray(), up: TOP_UP };
}

if (!proto.__ha3dDefaultTopViewV2) {
  proto.__ha3dDefaultTopViewV2 = true;

  const originalFit = proto._fit;
  proto._fit = function (object) {
    originalFit.call(this, object);
    const view = topViewFor(object);
    this._controls.target.fromArray(view.target);
    this._camera.position.fromArray(view.position);
    this._camera.up.fromArray(view.up);
    this._camera.lookAt(this._controls.target);
    this._camera.updateProjectionMatrix();
    this._controls.update();

    // "Padrão" returns to the same free top view used at startup.
    this._defaultView = this._captureCameraView();
  };

  const originalApplyCameraView = proto._applyCameraView;
  proto._applyCameraView = function (name) {
    if (name !== "top") return originalApplyCameraView.call(this, name);
    if (!this._model || this._cameraAnimating) return;
    this._animateCameraTo(topViewFor(this._model));
  };
}
