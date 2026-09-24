import "./ha3d-panel.js";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const THREE = Panel.HA3D_THREE;
if (!THREE) throw new Error("HA3D Three.js runtime was not registered");

const proto = Panel.prototype;

const DEADZONE = 0.16;
const MOVE_SPEED_MPS = 0.70;
const ROTATE_SPEED_RAD = Math.PI * 0.78;
const SCALE_SPEED = 1.15;
const MIN_SCALE_FACTOR = 0.30;
const MAX_SCALE_FACTOR = 3.50;
const ICON_HIT_RADIUS_METERS = 0.115;
const ICON_HOVER_SCALE = 1.32;
const RECENTER_DISTANCE_METERS = 0.75;
const RECENTER_BELOW_EYES_METERS = 0.05;
const AR_EXPOSURE = 0.72;
const ANCHOR_KEY = "ha3d_webxr_anchor_v2";

function ensure(panel) {
  panel._ha3dGameControllers ||= new Set();
  panel._ha3dGameGrab ||= new Map();
  panel._ha3dGameLightState ||= new Map();
  panel._ha3dGameLastLightScale ??= NaN;
  panel._ha3dGameLastFrameTime ??= 0;
  panel._ha3dGameWasMoving ??= false;
  panel._ha3dGameRightStickPressed ??= false;
  panel._ha3dGameHover ||= new Set();
}

function pulse(controller, intensity = 0.28, duration = 30) {
  try {
    controller?.userData?.ha3dInputSource?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, duration);
  } catch (_error) {}
}

function curvedAxis(value) {
  const raw = Number(value) || 0;
  const magnitude = Math.abs(raw);
  if (magnitude <= DEADZONE) return 0;
  const normalized = Math.min(1, (magnitude - DEADZONE) / (1 - DEADZONE));
  return Math.sign(raw) * normalized * normalized;
}

function stickAxes(inputSource) {
  const axes = inputSource?.gamepad?.axes || [];
  if (axes.length >= 4) return [curvedAxis(axes[2]), curvedAxis(axes[3])];
  if (axes.length >= 2) return [curvedAxis(axes[0]), curvedAxis(axes[1])];
  return [0, 0];
}

function controllerSource(controller) {
  return controller?.userData?.ha3dInputSource || null;
}

function findHandedController(panel, handedness) {
  const controllers = panel?._ha3dAR3Controllers || [];
  let fallback = null;
  for (const controller of controllers) {
    const source = controllerSource(controller);
    if (!source?.gamepad) continue;
    if (source.handedness === handedness) return controller;
    const index = Number(controller.userData?.ha3dIndex ?? -1);
    if (!fallback && ((handedness === "left" && index === 0) || (handedness === "right" && index === 1))) {
      fallback = controller;
    }
  }
  return fallback;
}

function controllerWorldPosition(controller) {
  controller?.updateMatrixWorld?.(true);
  return new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
}

function detachAnchor(panel) {
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
  try { localStorage.removeItem(ANCHOR_KEY); } catch (_error) {}
}

function beginTransform(panel) {
  if (!panel?._ha3dXRPresenting) return;
  if (panel._ha3dAR3Anchor || panel._ha3dAR3AnchorHandle) detachAnchor(panel);
  panel._ha3dAR3ManualMoved = true;
  panel._ha3dAR3TableSnapped = false;
  panel._ha3dAR3AnchorPending = false;
}

function finishTransform(panel) {
  if (!panel?._ha3dXRPresenting) return;
  panel._ha3dAR3AnchorPending = true;
}

function localModelCenter(panel) {
  if (panel?._ha3dARTabletopLocalCenter?.isVector3) return panel._ha3dARTabletopLocalCenter.clone();
  const root = panel?._ha3dAR3Root;
  const model = panel?._model;
  if (!root || !model) return new THREE.Vector3();
  const inverse = root.matrixWorld.clone().invert();
  const box = new THREE.Box3().setFromObject(model);
  return box.getCenter(new THREE.Vector3()).applyMatrix4(inverse);
}

function worldModelCenter(panel) {
  const root = panel?._ha3dAR3Root;
  if (!root) return new THREE.Vector3();
  const local = localModelCenter(panel);
  return local.multiply(root.scale).applyQuaternion(root.quaternion).add(root.position);
}

function preserveCenterAfterTransform(panel, centerWorld) {
  const root = panel?._ha3dAR3Root;
  if (!root) return;
  const offset = localModelCenter(panel).multiply(root.scale).applyQuaternion(root.quaternion);
  root.position.copy(centerWorld).sub(offset);
  root.updateMatrixWorld(true);
}

function viewerBasis(panel, frame) {
  const space = panel?._renderer?.xr?.getReferenceSpace?.();
  const pose = space ? frame?.getViewerPose?.(space) : null;
  const transform = pose?.views?.[0]?.transform;
  if (!transform) return null;

  const head = new THREE.Vector3(transform.position.x, transform.position.y, transform.position.z);
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
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  right.y = 0;
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  else right.normalize();
  return { head, forward, right };
}

function recenter(panel, frame) {
  const root = panel?._ha3dAR3Root;
  const basis = viewerBasis(panel, frame);
  if (!root || !basis) return false;
  beginTransform(panel);
  const target = basis.head.clone().addScaledVector(basis.forward, RECENTER_DISTANCE_METERS);
  target.y = basis.head.y - RECENTER_BELOW_EYES_METERS;
  preserveCenterAfterTransform(panel, target);
  finishTransform(panel);
  pulse(findHandedController(panel, "right"), 0.38, 45);
  return true;
}

function applyJoystickTransform(panel, frame, dt) {
  ensure(panel);
  const root = panel?._ha3dAR3Root;
  if (!root) return;

  const left = findHandedController(panel, "left");
  const right = findHandedController(panel, "right");
  const [lx, ly] = stickAxes(controllerSource(left));
  const [rx, ry] = stickAxes(controllerSource(right));
  const rightGamepad = controllerSource(right)?.gamepad;
  const stickPressed = Boolean(rightGamepad?.buttons?.[3]?.pressed);
  const recenterPressed = stickPressed && !panel._ha3dGameRightStickPressed;
  panel._ha3dGameRightStickPressed = stickPressed;

  const moving = Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0.0001;
  if (moving && !panel._ha3dGameWasMoving) beginTransform(panel);

  if (moving) {
    const basis = viewerBasis(panel, frame);
    if (basis) {
      if (lx || ly) {
        root.position.addScaledVector(basis.right, lx * MOVE_SPEED_MPS * dt);
        root.position.addScaledVector(basis.forward, -ly * MOVE_SPEED_MPS * dt);
      }

      if (rx) {
        const center = worldModelCenter(panel);
        const yaw = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          -rx * ROTATE_SPEED_RAD * dt,
        );
        root.quaternion.premultiply(yaw).normalize();
        preserveCenterAfterTransform(panel, center);
      }

      if (ry) {
        const center = worldModelCenter(panel);
        const baseScale = Math.max(Number(panel._ha3dARTabletopScale) || root.scale.x || 1, 1e-6);
        const minScale = baseScale * MIN_SCALE_FACTOR;
        const maxScale = baseScale * MAX_SCALE_FACTOR;
        const factor = Math.exp(-ry * SCALE_SPEED * dt);
        const nextScale = THREE.MathUtils.clamp(root.scale.x * factor, minScale, maxScale);
        root.scale.setScalar(nextScale);
        preserveCenterAfterTransform(panel, center);
      }
      root.updateMatrixWorld(true);
    }
  }

  if (!moving && panel._ha3dGameWasMoving) finishTransform(panel);
  panel._ha3dGameWasMoving = moving;

  if (recenterPressed) recenter(panel, frame);
}

function rayFromController(controller) {
  if (!controller) return null;
  controller.updateMatrixWorld?.(true);
  const rotation = new THREE.Matrix4().extractRotation(controller.matrixWorld);
  const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
  const direction = new THREE.Vector3(0, 0, -1).applyMatrix4(rotation).normalize();
  return { origin, direction };
}

function iconHit(panel, controller, radius = ICON_HIT_RADIUS_METERS) {
  const ray = rayFromController(controller);
  const sprites = panel?._ha3dARIconSprites;
  if (!ray || !sprites?.size) return null;

  let best = null;
  const point = new THREE.Vector3();
  const closest = new THREE.Vector3();
  for (const [entity, sprite] of sprites.entries()) {
    if (!sprite?.visible) continue;
    sprite.getWorldPosition(point);
    const toPoint = point.clone().sub(ray.origin);
    const along = toPoint.dot(ray.direction);
    if (along <= 0 || along > 4.0) continue;
    closest.copy(ray.direction).multiplyScalar(along).add(ray.origin);
    const distance = closest.distanceTo(point);
    if (distance > radius) continue;
    const score = distance + along * 0.002;
    if (!best || score < best.score) best = { entity, score };
  }
  return best?.entity || null;
}

function updateIconHover(panel) {
  ensure(panel);
  const hovered = new Set();
  for (const controller of panel?._ha3dAR3Controllers || []) {
    const entity = iconHit(panel, controller, ICON_HIT_RADIUS_METERS * 1.15);
    if (entity) hovered.add(entity);
  }

  for (const [entity, sprite] of panel?._ha3dARIconSprites || []) {
    const base = 0.075;
    const target = hovered.has(entity) ? base * ICON_HOVER_SCALE : base;
    const current = Number(sprite.scale?.x) || base;
    const next = THREE.MathUtils.lerp(current, target, 0.28);
    sprite.scale.setScalar(next);
    if (sprite.material?.color) sprite.material.color.setHex(hovered.has(entity) ? 0x7ee7ff : 0xffffff);
  }
  panel._ha3dGameHover = hovered;
}

async function activateEntity(panel, entity, controller) {
  const hass = panel?._hass;
  if (!hass || !entity) return false;
  const [domain] = String(entity).split(".", 1);
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
    } else if (domain === "climate") {
      const state = hass.states?.[entity]?.state;
      await hass.callService("climate", state === "off" ? "turn_on" : "turn_off", { entity_id: entity });
    } else {
      return false;
    }
    pulse(controller, 0.48, 55);
    return true;
  } catch (error) {
    console.warn("[HA3D AR] XR icon action failed", entity, error);
    pulse(controller, 0.12, 80);
    return false;
  }
}

function startGripDrag(panel, controller) {
  if (!panel?._ha3dXRPresenting || !panel._ha3dAR3Root || !controller) return;
  ensure(panel);
  beginTransform(panel);
  const index = Number(controller.userData?.ha3dIndex ?? 0);
  panel._ha3dGameGrab.set(index, {
    controller,
    controllerStart: controllerWorldPosition(controller),
    rootStart: panel._ha3dAR3Root.position.clone(),
  });
  pulse(controller, 0.30, 35);
}

function endGripDrag(panel, controller) {
  ensure(panel);
  const index = Number(controller?.userData?.ha3dIndex ?? 0);
  if (!panel._ha3dGameGrab.has(index)) return;
  panel._ha3dGameGrab.delete(index);
  if (!panel._ha3dGameGrab.size && !panel._ha3dGameWasMoving) finishTransform(panel);
  pulse(controller, 0.16, 22);
}

function updateGripDrag(panel) {
  ensure(panel);
  const root = panel?._ha3dAR3Root;
  if (!root || !panel._ha3dGameGrab.size) return;
  const grab = panel._ha3dGameGrab.values().next().value;
  if (!grab?.controller) return;
  const current = controllerWorldPosition(grab.controller);
  root.position.copy(grab.rootStart).add(current.sub(grab.controllerStart));
  root.updateMatrixWorld(true);
}

function installControllerEvents(panel) {
  ensure(panel);
  for (const controller of panel?._ha3dAR3Controllers || []) {
    const u = controller.userData || {};

    if (u.ha3dAR3Start) controller.removeEventListener("selectstart", u.ha3dAR3Start);
    if (u.ha3dAR3End) controller.removeEventListener("selectend", u.ha3dAR3End);
    if (u.ha3dGameSqueezeStart) controller.removeEventListener("squeezestart", u.ha3dGameSqueezeStart);
    if (u.ha3dGameSqueezeEnd) controller.removeEventListener("squeezeend", u.ha3dGameSqueezeEnd);

    const selectStart = () => {
      const entity = iconHit(panel, controller);
      if (entity) {
        activateEntity(panel, entity, controller);
        return;
      }
      // Hand tracking has no thumbsticks/grip button: pinch remains a translation fallback.
      if (!controllerSource(controller)?.gamepad) startGripDrag(panel, controller);
    };
    const selectEnd = () => {
      if (!controllerSource(controller)?.gamepad) endGripDrag(panel, controller);
    };
    const squeezeStart = () => startGripDrag(panel, controller);
    const squeezeEnd = () => endGripDrag(panel, controller);

    u.ha3dAR3Start = selectStart;
    u.ha3dAR3End = selectEnd;
    u.ha3dGameSqueezeStart = squeezeStart;
    u.ha3dGameSqueezeEnd = squeezeEnd;
    controller.addEventListener("selectstart", selectStart);
    controller.addEventListener("selectend", selectEnd);
    controller.addEventListener("squeezestart", squeezeStart);
    controller.addEventListener("squeezeend", squeezeEnd);
    panel._ha3dGameControllers.add(controller);
  }
}

function cleanupControllerEvents(panel) {
  ensure(panel);
  for (const controller of panel._ha3dGameControllers) {
    const u = controller.userData || {};
    if (u.ha3dAR3Start) controller.removeEventListener("selectstart", u.ha3dAR3Start);
    if (u.ha3dAR3End) controller.removeEventListener("selectend", u.ha3dAR3End);
    if (u.ha3dGameSqueezeStart) controller.removeEventListener("squeezestart", u.ha3dGameSqueezeStart);
    if (u.ha3dGameSqueezeEnd) controller.removeEventListener("squeezeend", u.ha3dGameSqueezeEnd);
    delete u.ha3dGameSqueezeStart;
    delete u.ha3dGameSqueezeEnd;
  }
  panel._ha3dGameControllers.clear();
  panel._ha3dGameGrab.clear();
}

function captureLightState(panel) {
  ensure(panel);
  if (panel._ha3dGameLightState.size) return;
  for (const light of panel?._modelLights || []) {
    panel._ha3dGameLightState.set(light, {
      base: Number(light.userData?.ha3dBaseIntensity || 0),
      mediaBase: Number(light.userData?.ha3dMediaBaseIntensity || 0),
      hasMediaBase: Object.prototype.hasOwnProperty.call(light.userData || {}, "ha3dMediaBaseIntensity"),
      distance: Number(light.distance || 0),
    });
  }
}

function lightScaleFactor(light, scale) {
  if (light?.isPointLight || light?.isSpotLight) {
    const decay = Number(light.decay);
    const exponent = Number.isFinite(decay) && decay > 0 ? THREE.MathUtils.clamp(decay, 0.5, 2.5) : 2;
    return Math.pow(Math.max(scale, 1e-4), exponent);
  }
  if (light?.isRectAreaLight) return Math.pow(Math.max(scale, 1e-4), 2);
  return 1;
}

function updateMiniatureLighting(panel, force = false) {
  ensure(panel);
  const root = panel?._ha3dAR3Root;
  if (!root) return;
  captureLightState(panel);
  const scale = Math.max(Number(root.scale?.x) || 1, 1e-4);
  if (!force && Number.isFinite(panel._ha3dGameLastLightScale) && Math.abs(scale - panel._ha3dGameLastLightScale) < 0.0005) return;
  panel._ha3dGameLastLightScale = scale;

  const boundLights = new Set();
  for (const binding of panel?._lightBindings?.values?.() || []) {
    for (const light of binding?.lights || []) if (light) boundLights.add(light);
  }

  for (const [light, state] of panel._ha3dGameLightState.entries()) {
    const factor = lightScaleFactor(light, scale);
    light.userData.ha3dBaseIntensity = state.base * factor;
    if (state.hasMediaBase) light.userData.ha3dMediaBaseIntensity = state.mediaBase * factor;
    if ((light.isPointLight || light.isSpotLight) && state.distance > 0) light.distance = state.distance * scale;
    if (!boundLights.has(light)) light.intensity = state.base * factor;
  }

  // HA-bound lights use ha3dBaseIntensity, so resync once whenever the miniature scale changes.
  panel._syncLightStates?.();
  for (const [light, state] of panel._ha3dGameLightState.entries()) {
    if (boundLights.has(light)) continue;
    light.intensity = state.base * lightScaleFactor(light, scale);
  }
}

function restoreMiniatureLighting(panel) {
  ensure(panel);
  for (const [light, state] of panel._ha3dGameLightState.entries()) {
    light.userData.ha3dBaseIntensity = state.base;
    if (state.hasMediaBase) light.userData.ha3dMediaBaseIntensity = state.mediaBase;
    else delete light.userData.ha3dMediaBaseIntensity;
    if (light.isPointLight || light.isSpotLight) light.distance = state.distance;
  }
  panel._ha3dGameLightState.clear();
  panel._ha3dGameLastLightScale = NaN;
  panel._syncLightStates?.();
  panel._restoreUnboundModelLights?.();
}

function configureARVisuals(panel) {
  const renderer = panel?._renderer;
  if (renderer) renderer.toneMappingExposure = AR_EXPOSURE;
  updateMiniatureLighting(panel, true);
}

function frameUpdate(panel) {
  if (!panel?._ha3dXRPresenting) return;
  ensure(panel);
  const renderer = panel._renderer;
  const frame = renderer?.xr?.getFrame?.();
  const now = performance.now();
  let dt = panel._ha3dGameLastFrameTime ? (now - panel._ha3dGameLastFrameTime) / 1000 : 1 / 72;
  panel._ha3dGameLastFrameTime = now;
  dt = THREE.MathUtils.clamp(dt, 1 / 144, 0.05);

  if (frame) applyJoystickTransform(panel, frame, dt);
  updateGripDrag(panel);
  updateIconHover(panel);
  updateMiniatureLighting(panel);
}

function installRenderHook(panel) {
  const renderer = panel?._renderer;
  if (!renderer?.render || renderer.__ha3dARGameControlsV1) return;
  renderer.__ha3dARGameControlsV1 = true;
  const render = renderer.render.bind(renderer);
  renderer.render = (...args) => {
    frameUpdate(panel);
    return render(...args);
  };
}

function cleanup(panel) {
  ensure(panel);
  cleanupControllerEvents(panel);
  restoreMiniatureLighting(panel);
  panel._ha3dGameLastFrameTime = 0;
  panel._ha3dGameWasMoving = false;
  panel._ha3dGameRightStickPressed = false;
  panel._ha3dGameHover.clear();
}

if (!proto.__ha3dARGameControlsV1) {
  proto.__ha3dARGameControlsV1 = true;

  const originalInitViewer = proto._initViewer;
  if (typeof originalInitViewer === "function") {
    proto._initViewer = function (...args) {
      const result = originalInitViewer.apply(this, args);
      queueMicrotask(() => installRenderHook(this));
      return result;
    };
  }

  const originalToggle = proto._ha3dToggleXR;
  if (typeof originalToggle === "function") {
    proto._ha3dToggleXR = async function (...args) {
      const wasPresenting = Boolean(this._ha3dXRPresenting);
      const result = await originalToggle.apply(this, args);
      if (!wasPresenting && this._ha3dXRPresenting) {
        installRenderHook(this);
        installControllerEvents(this);
        configureARVisuals(this);
        this._ha3dXRSession?.addEventListener("end", () => cleanup(this), { once: true });
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
  for (const panel of collect(document)) installRenderHook(panel);
}

queueMicrotask(installExisting);
requestAnimationFrame(installExisting);
setTimeout(installExisting, 250);
setTimeout(installExisting, 1000);
