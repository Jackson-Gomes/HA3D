import * as THREE from "https://esm.sh/three@0.180.0";

// glTF uses metres and a punctual light's local -Z as its emission direction.
// Optional ha3d extras: direction [x,y,z], distance (metres), state_entity.
export function prepareLight(light, state, metadata = {}) {
  const television = state?.attributes?.device_class === "tv"
    || ["mdi:television", "mdi:television-classic"].includes(state?.attributes?.icon);
  const convert = light.isPointLight && (television || metadata.direction);
  if (light.userData.ha3dLightPrepared && !convert) return light;
  if (convert) {
    const spot = new THREE.SpotLight(light.color, 0);
    spot.name = light.name;
    spot.position.copy(light.position);
    spot.quaternion.copy(light.quaternion);
    spot.scale.copy(light.scale);
    spot.userData = { ...light.userData };
    spot.angle = Math.PI / 3;
    spot.penumbra = 0.4;
    const direction = new THREE.Vector3(0, 0, -1);
    if (Array.isArray(metadata.direction) && metadata.direction.length === 3 && metadata.direction.every(Number.isFinite)) {
      direction.fromArray(metadata.direction);
      if (direction.lengthSq() === 0) direction.set(0, 0, -1);
    }
    spot.target.position.copy(direction.normalize());
    // A child target preserves the source node's orientation under transforms.
    spot.add(spot.target);
    const parent = light.parent;
    parent?.add(spot);
    parent?.remove(light);
    light.shadow?.dispose();
    light = spot;
  }
  const requestedRange = Number(metadata.distance);
  const exportedRange = Number(light.userData.ha3dBaseDistance);
  if (light.isPointLight || light.isSpotLight) {
    light.distance = requestedRange > 0 ? Math.min(requestedRange, 30)
      : exportedRange > 0 ? Math.min(exportedRange, 30) : television ? 3 : 6;
    light.decay = 2;
  }
  if (light.shadow) {
    const mapSize = globalThis.matchMedia?.("(pointer: coarse)").matches ? 256 : 512;
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.bias = -0.0001;
    light.shadow.normalBias = 0.01;
    light.shadow.camera.near = 0.02;
    light.shadow.camera.far = light.distance || 30;
    light.shadow.camera.updateProjectionMatrix();
    // Models are static. Camera movement and brightness changes do not require
    // re-rendering their shadow maps. Reallocate only on activation/model load.
    light.shadow.autoUpdate = false;
    light.shadow.needsUpdate = true;
  }
  light.userData.ha3dLightPrepared = true;
  return light;
}

export function prepareOccluders(model) {
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      // Thin walls block from both sides, without changing their visible side.
      if (material) material.shadowSide = THREE.DoubleSide;
    }
  });
}

// Point shadows cost six faces. Never let an over-budget source shine through
// walls: defer its physical illumination while retaining its real HA marker.
export function applyShadowBudget(lights, faceBudget = 48) {
  let remaining = faceBudget;
  let deferred = 0;
  // Device lighting before decorative fill; spots before six-face point maps.
  const ordered = [...lights].sort((a, b) =>
    Number(Boolean(b.userData.ha3dCandidate)) - Number(Boolean(a.userData.ha3dCandidate))
    || Number(a.isPointLight === true) - Number(b.isPointLight === true));
  for (const light of ordered) {
    const intensity = light.userData.ha3dDesiredIntensity || 0;
    const cost = light.isPointLight ? 6 : 1;
    const enabled = intensity > 0 && Boolean(light.shadow) && remaining >= cost;
    if (enabled) {
      remaining -= cost;
      if (!light.castShadow) light.shadow.needsUpdate = true;
    } else {
      if (intensity > 0) deferred += 1;
      // Release inactive targets; the budget bounds allocated memory too.
      if (light.shadow?.map) {
        light.shadow.dispose();
        light.shadow.map = null;
        light.shadow.mapPass = null;
      }
    }
    light.castShadow = enabled;
    light.visible = enabled;
    light.intensity = enabled ? intensity : 0;
  }
  return deferred;
}
