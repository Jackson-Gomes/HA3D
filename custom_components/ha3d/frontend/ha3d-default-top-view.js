import * as THREE from "https://esm.sh/three@0.180.0";

// Keep the proven viewer intact; only make the initial/default camera match the
// existing "Superior" preset exactly.
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

if (!proto.__ha3dDefaultTopViewV1) {
  proto.__ha3dDefaultTopViewV1 = true;

  const originalFit = proto._fit;

  proto._fit = function (object) {
    originalFit.call(this, object);

    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z) || 1;

    // Same values used by _applyCameraView("top").
    const az = THREE.MathUtils.degToRad(0);
    const el = THREE.MathUtils.degToRad(89);
    const r = max * 1.48;
    const position = center.clone().add(
      new THREE.Vector3(
        Math.cos(el) * Math.cos(az) * r,
        Math.sin(el) * r,
        Math.cos(el) * Math.sin(az) * r,
      ),
    );

    this._controls.target.copy(center);
    this._camera.position.copy(position);
    this._camera.up.set(0, 0, -1);
    this._camera.lookAt(center);
    this._camera.updateProjectionMatrix();
    this._controls.update();

    // "Padrão" now returns to the same top view used at startup.
    this._defaultView = this._captureCameraView();
  };
}
