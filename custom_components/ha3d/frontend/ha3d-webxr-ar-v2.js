import "./ha3d-panel.js";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const THREE = Panel.HA3D_THREE;
if (!THREE) throw new Error("HA3D Three.js runtime was not registered");

const proto = Panel.prototype;
const ANCHOR_KEY = "ha3d_webxr_anchor_v1";
const TARGET_SIZE = 1.0;
const DEFAULT_Y = 1.0;
const DEFAULT_Z = -1.25;
const ROOM_CAPTURE_DELAY = 4500;

function ensure(panel) {
  panel._ha3dAR2Controllers ||= [];
  panel._ha3dAR2Active ||= new Map();
  panel._ha3dAR2Root ||= null;
  panel._ha3dAR2Children ||= [];
  panel._ha3dAR2Single ||= null;
  panel._ha3dAR2Dual ||= null;
  panel._ha3dAR2Anchor ||= null;
  panel._ha3dAR2AnchorHandle ||= null;
  panel._ha3dAR2AnchorPending ||= false;
  panel._ha3dAR2AnchorCreating ||= false;
  panel._ha3dAR2AnchorRestoring ||= false;
  panel._ha3dAR2ManualMoved ||= false;
  panel._ha3dAR2TableSnapped ||= false;
  panel._ha3dAR2PlaneCount ||= 0;
  panel._ha3dAR2RoomCaptureTimer ||= 0;
  panel._ha3dAR2RoomCaptureRequested ||= false;
}

function savedAnchor() {
  try {
    const value = JSON.parse(localStorage.getItem(ANCHOR_KEY) || "null");
    return value && typeof value === "object" ? value : null;
  } catch (_error) {
    return null;
  }
}

function saveAnchor(handle, scale) {
  if (!handle) return;
  localStorage.setItem(ANCHOR_KEY, JSON.stringify({ handle, scale: Number(scale) || null, savedAt: Date.now() }));
}

function forgetAnchor() {
  localStorage.removeItem(ANCHOR_KEY);
}

function setButton(panel, text, state = "ready", detail = text) {
  const button = panel.shadowRoot?.querySelector("#xrButton");
  if (!button) return;
  button.textContent = text;
  button.disabled = state === "error";
  button.title = detail;
  button.setAttribute("aria-label", detail);
  button.classList.toggle("ha3d-xr-ready", state === "ready");
  button.classList.toggle("ha3d-xr-warning", state === "warning");
  button.classList.toggle("ha3d-xr-error", state === "error");
}

function buildRoot(panel) {
  ensure(panel);
  if (panel._ha3dAR2Root || !panel._scene) return panel._ha3dAR2Root;
  const root = new THREE.Group();
  root.name = "HA3D_AR_ContentRoot";
  root.userData.ha3dARContentRoot = true;
  panel._scene.add(root);
  panel._ha3dAR2Root = root;
  adoptSceneContent(panel);
  return root;
}

function adoptSceneContent(panel) {
  const root = panel._ha3dAR2Root;
  if (!root || !panel._scene) return;
  const children = panel._scene.children.filter((child) =>
    child !== root && child !== panel._camera && !child.isCamera && !child.isLight && !child.userData?.ha3dXRInput
  );
  for (const child of children) {
    if (!panel._ha3dAR2Children.includes(child)) panel._ha3dAR2Children.push(child);
    root.add(child);
  }
}

function restoreRoot(panel) {
  const root = panel._ha3dAR2Root;
  if (!root || !panel._scene) return;
  for (const child of panel._ha3dAR2Children || []) {
    if (child.parent === root) {
      root.remove(child);
      panel._scene.add(child);
    }
  }
  panel._scene.remove(root);
  panel._ha3dAR2Root = null;
  panel._ha3dAR2Children = [];
}

function prepareContent(panel) {
  if (!panel._model || !panel._scene) return false;
  panel._scene.background = null;
  panel._renderer?.setClearAlpha?.(0);
  const root = buildRoot(panel);
  if (!root) return false;
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(panel._model);
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z) || 1;
  root.scale.setScalar(TARGET_SIZE / maxSize);
  root.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(panel._model);
  const center = scaledBox.getCenter(new THREE.Vector3());
  root.position.set(-center.x, DEFAULT_Y - center.y, DEFAULT_Z - center.z);

  const saved = savedAnchor();
  if (saved?.handle && Number.isFinite(Number(saved.scale)) && Number(saved.scale) > 0) {
    root.scale.setScalar(Number(saved.scale));
  }
  root.updateMatrixWorld(true);
  return true;
}

function rayLine() {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const material = new THREE.LineBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.8, depthTest: false });
  const line = new THREE.Line(geometry, material);
  line.name = "HA3D_AR_Ray";
  line.scale.z = 2.5;
  line.renderOrder = 10000;
  line.userData.ha3dXRRay = true;
  return line;
}

function worldPosition(object) {
  return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
}

function hitsContent(panel, controller) {
  const root = panel._ha3dAR2Root;
  if (!root) return false;
  const rotation = new THREE.Matrix4().extractRotation(controller.matrixWorld);
  const raycaster = new THREE.Raycaster();
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rotation);
  return raycaster.intersectObject(root, true).some((hit) => !hit.object.userData?.ha3dXRRay);
}

function beginSingle(panel, controller) {
  const root = panel._ha3dAR2Root;
  if (!root || !controller) return;
  const local = root.getWorldPosition(new THREE.Vector3()).applyMatrix4(controller.matrixWorld.clone().invert());
  panel._ha3dAR2Single = { controller, local };
  panel._ha3dAR2Dual = null;
}

function beginDual(panel) {
  const root = panel._ha3dAR2Root;
  const active = [...panel._ha3dAR2Active.values()];
  if (!root || active.length < 2) return;
  const a = worldPosition(active[0]);
  const b = worldPosition(active[1]);
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  const delta = b.clone().sub(a);
  panel._ha3dAR2Dual = {
    controllers: [active[0], active[1]],
    distance: Math.max(delta.length(), 0.01),
    angle: Math.atan2(delta.z, delta.x),
    scale: root.scale.x,
    quaternion: root.quaternion.clone(),
    offset: root.position.clone().sub(midpoint),
  };
  panel._ha3dAR2Single = null;
}

function updateGrab(panel) {
  const root = panel._ha3dAR2Root;
  if (!root) return;
  if (panel._ha3dAR2Active.size >= 2 && panel._ha3dAR2Dual) {
    const grab = panel._ha3dAR2Dual;
    const a = worldPosition(grab.controllers[0]);
    const b = worldPosition(grab.controllers[1]);
    const midpoint = a.clone().add(b).multiplyScalar(0.5);
    const delta = b.clone().sub(a);
    const factor = THREE.MathUtils.clamp(Math.max(delta.length(), 0.01) / grab.distance, 0.25, 4);
    const angle = Math.atan2(delta.z, delta.x) - grab.angle;
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    root.scale.setScalar(grab.scale * factor);
    root.quaternion.copy(yaw).multiply(grab.quaternion);
    root.position.copy(grab.offset.clone().multiplyScalar(factor).applyQuaternion(yaw).add(midpoint));
    root.updateMatrixWorld(true);
    return;
  }
  const grab = panel._ha3dAR2Single;
  if (panel._ha3dAR2Active.size === 1 && grab?.controller) {
    root.position.copy(grab.local.clone().applyMatrix4(grab.controller.matrixWorld));
    root.updateMatrixWorld(true);
  }
}

function detachAnchor(panel) {
  const anchor = panel._ha3dAR2Anchor;
  const handle = panel._ha3dAR2AnchorHandle;
  panel._ha3dAR2Anchor = null;
  panel._ha3dAR2AnchorHandle = null;
  panel._ha3dAR2AnchorPending = false;
  forgetAnchor();
  try { anchor?.delete?.(); } catch (_error) {}
  if (handle && panel._ha3dXRSession?.deletePersistentAnchor) {
    panel._ha3dXRSession.deletePersistentAnchor(handle).catch(() => {});
  }
}

function selectStart(panel, controller) {
  const index = Number(controller.userData.ha3dIndex ?? 0);
  if (!hitsContent(panel, controller)) return;
  if (!panel._ha3dAR2Active.size) detachAnchor(panel);
  panel._ha3dAR2ManualMoved = true;
  panel._ha3dAR2Active.set(index, controller);
  if (panel._ha3dAR2Active.size >= 2) beginDual(panel);
  else beginSingle(panel, controller);
}

function selectEnd(panel, controller) {
  const index = Number(controller.userData.ha3dIndex ?? 0);
  if (!panel._ha3dAR2Active.has(index)) return;
  panel._ha3dAR2Active.delete(index);
  if (panel._ha3dAR2Active.size >= 2) beginDual(panel);
  else if (panel._ha3dAR2Active.size === 1) beginSingle(panel, [...panel._ha3dAR2Active.values()][0]);
  else {
    panel._ha3dAR2Single = null;
    panel._ha3dAR2Dual = null;
    panel._ha3dAR2AnchorPending = true;
  }
}

function setupInputs(panel) {
  cleanupInputs(panel);
  for (let i = 0; i < 2; i += 1) {
    const controller = panel._renderer.xr.getController(i);
    controller.userData.ha3dIndex = i;
    controller.userData.ha3dXRInput = true;
    controller.visible = false;
    controller.add(rayLine());
    const start = () => selectStart(panel, controller);
    const end = () => selectEnd(panel, controller);
    const connected = () => { controller.visible = true; };
    const disconnected = () => { controller.visible = false; selectEnd(panel, controller); };
    controller.userData.ha3dAR2Start = start;
    controller.userData.ha3dAR2End = end;
    controller.userData.ha3dAR2Connected = connected;
    controller.userData.ha3dAR2Disconnected = disconnected;
    controller.addEventListener("selectstart", start);
    controller.addEventListener("selectend", end);
    controller.addEventListener("connected", connected);
    controller.addEventListener("disconnected", disconnected);
    panel._scene.add(controller);
    panel._ha3dAR2Controllers.push(controller);
  }
}

function cleanupInputs(panel) {
  ensure(panel);
  for (const controller of panel._ha3dAR2Controllers) {
    const u = controller.userData;
    if (u.ha3dAR2Start) controller.removeEventListener("selectstart", u.ha3dAR2Start);
    if (u.ha3dAR2End) controller.removeEventListener("selectend", u.ha3dAR2End);
    if (u.ha3dAR2Connected) controller.removeEventListener("connected", u.ha3dAR2Connected);
    if (u.ha3dAR2Disconnected) controller.removeEventListener("disconnected", u.ha3dAR2Disconnected);
    for (const child of [...controller.children]) {
      if (!child.userData?.ha3dXRRay) continue;
      child.geometry?.dispose?.();
      child.material?.dispose?.();
      controller.remove(child);
    }
    controller.parent?.remove(controller);
  }
  panel._ha3dAR2Controllers = [];
  panel._ha3dAR2Active.clear();
  panel._ha3dAR2Single = null;
  panel._ha3dAR2Dual = null;
}

async function restoreAnchor(panel, session) {
  const saved = savedAnchor();
  if (!saved?.handle || typeof session?.restorePersistentAnchor !== "function") return false;
  panel._ha3dAR2AnchorRestoring = true;
  try {
    const anchor = await session.restorePersistentAnchor(saved.handle);
    panel._ha3dAR2Anchor = anchor;
    panel._ha3dAR2AnchorHandle = saved.handle;
    if (Number.isFinite(Number(saved.scale)) && Number(saved.scale) > 0) panel._ha3dAR2Root?.scale.setScalar(Number(saved.scale));
    console.info("[HA3D AR] persistent anchor restored");
    return true;
  } catch (error) {
    console.warn("[HA3D AR] persistent anchor restore failed", error);
    forgetAnchor();
    panel._ha3dAR2Anchor = null;
    panel._ha3dAR2AnchorHandle = null;
    return false;
  } finally {
    panel._ha3dAR2AnchorRestoring = false;
  }
}

function applyAnchor(panel, frame) {
  const anchor = panel._ha3dAR2Anchor;
  const root = panel._ha3dAR2Root;
  const space = panel._renderer.xr.getReferenceSpace?.();
  if (!anchor?.anchorSpace || !root || !space || !frame?.getPose) return false;
  const pose = frame.getPose(anchor.anchorSpace, space);
  if (!pose) return false;
  root.position.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
  root.quaternion.set(pose.transform.orientation.x, pose.transform.orientation.y, pose.transform.orientation.z, pose.transform.orientation.w);
  root.updateMatrixWorld(true);
  return true;
}

function createAnchorIfNeeded(panel, frame) {
  if (!panel._ha3dAR2AnchorPending || panel._ha3dAR2AnchorCreating || panel._ha3dAR2Active.size) return;
  const root = panel._ha3dAR2Root;
  const space = panel._renderer.xr.getReferenceSpace?.();
  if (!root || !space || typeof frame?.createAnchor !== "function" || typeof XRRigidTransform === "undefined") {
    panel._ha3dAR2AnchorPending = false;
    return;
  }
  panel._ha3dAR2AnchorPending = false;
  panel._ha3dAR2AnchorCreating = true;
  const transform = new XRRigidTransform(
    { x: root.position.x, y: root.position.y, z: root.position.z },
    { x: root.quaternion.x, y: root.quaternion.y, z: root.quaternion.z, w: root.quaternion.w },
  );
  frame.createAnchor(transform, space).then(async (anchor) => {
    panel._ha3dAR2Anchor = anchor;
    if (typeof anchor?.requestPersistentHandle === "function") {
      try {
        const handle = await anchor.requestPersistentHandle();
        panel._ha3dAR2AnchorHandle = handle;
        saveAnchor(handle, root.scale.x);
        console.info("[HA3D AR] persistent anchor saved");
      } catch (error) {
        console.warn("[HA3D AR] anchor persistence unavailable", error);
      }
    }
  }).catch((error) => console.warn("[HA3D AR] anchor creation failed", error)).finally(() => {
    panel._ha3dAR2AnchorCreating = false;
  });
}

function planeArea(plane) {
  const points = Array.from(plane?.polygon || []);
  if (!points.length) return 0;
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, Number(point.x) || 0); maxX = Math.max(maxX, Number(point.x) || 0);
    minZ = Math.min(minZ, Number(point.z) || 0); maxZ = Math.max(maxZ, Number(point.z) || 0);
  }
  return Math.max(0, maxX - minX) * Math.max(0, maxZ - minZ);
}

function bestTable(panel, frame) {
  const planes = frame?.detectedPlanes;
  const space = panel._renderer.xr.getReferenceSpace?.();
  if (!planes || !space) return null;
  panel._ha3dAR2PlaneCount = planes.size ?? Array.from(planes).length;
  const viewer = frame.getViewerPose?.(space)?.views?.[0]?.transform?.position;
  let best = null;
  for (const plane of planes) {
    if (plane.orientation && plane.orientation !== "horizontal") continue;
    const pose = frame.getPose?.(plane.planeSpace, space);
    if (!pose) continue;
    const p = pose.transform.position;
    const label = String(plane.semanticLabel || "").toLowerCase();
    const isTable = /(table|desk)/.test(label);
    if (!isTable && (p.y < 0.35 || p.y > 1.45)) continue;
    const area = planeArea(plane);
    if (!isTable && area > 0 && area < 0.20) continue;
    const distance = viewer ? Math.hypot(p.x - viewer.x, p.z - viewer.z) : Math.hypot(p.x, p.z);
    if (distance > 3.0) continue;
    const score = (isTable ? 100 : 0) + Math.min(area, 4) * 4 - distance * 5 - Math.abs(p.y - 0.78) * 3;
    if (!best || score > best.score) best = { plane, pose, score };
  }
  return best;
}

function snapToTable(panel, candidate) {
  const root = panel._ha3dAR2Root;
  if (!root || !panel._model || !candidate?.pose) return false;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(panel._model);
  const center = box.getCenter(new THREE.Vector3());
  const p = candidate.pose.transform.position;
  root.position.set(
    p.x + (root.position.x - center.x),
    p.y + (root.position.y - box.min.y) + 0.01,
    p.z + (root.position.z - center.z),
  );
  root.updateMatrixWorld(true);
  panel._ha3dAR2TableSnapped = true;
  panel._ha3dAR2AnchorPending = true;
  console.info("[HA3D AR] snapped to", candidate.plane.semanticLabel || "horizontal plane");
  return true;
}

function scheduleRoomCapture(panel, session) {
  clearTimeout(panel._ha3dAR2RoomCaptureTimer);
  panel._ha3dAR2RoomCaptureRequested = false;
  if (typeof session?.initiateRoomCapture !== "function") return;
  panel._ha3dAR2RoomCaptureTimer = setTimeout(() => {
    if (!panel._ha3dXRPresenting || panel._ha3dAR2Anchor || panel._ha3dAR2PlaneCount > 0 || panel._ha3dAR2RoomCaptureRequested) return;
    panel._ha3dAR2RoomCaptureRequested = true;
    session.initiateRoomCapture().catch((error) => console.warn("[HA3D AR] room capture not completed", error));
  }, ROOM_CAPTURE_DELAY);
}

function frameUpdate(panel) {
  if (!panel._ha3dXRPresenting) return;
  ensure(panel);
  adoptSceneContent(panel);
  const frame = panel._renderer?.xr?.getFrame?.();
  if (!frame || panel._ha3dAR2AnchorRestoring) return;
  if (panel._ha3dAR2Active.size) {
    updateGrab(panel);
    return;
  }
  if (panel._ha3dAR2Anchor && applyAnchor(panel, frame)) return;
  if (!panel._ha3dAR2ManualMoved && !panel._ha3dAR2TableSnapped) {
    const candidate = bestTable(panel, frame);
    if (candidate) snapToTable(panel, candidate);
  }
  createAnchorIfNeeded(panel, frame);
}

function installRenderHook(panel) {
  const renderer = panel?._renderer;
  if (!renderer?.render || renderer.__ha3dAR2Hook) return;
  renderer.__ha3dAR2Hook = true;
  const render = renderer.render.bind(renderer);
  renderer.render = (...args) => {
    frameUpdate(panel);
    return render(...args);
  };
}

function cleanup(panel) {
  ensure(panel);
  clearTimeout(panel._ha3dAR2RoomCaptureTimer);
  cleanupInputs(panel);
  panel._ha3dAR2RoomCaptureTimer = 0;
  panel._ha3dAR2RoomCaptureRequested = false;
  panel._ha3dAR2AnchorPending = false;
  panel._ha3dAR2AnchorCreating = false;
  panel._ha3dAR2AnchorRestoring = false;
  panel._ha3dAR2ManualMoved = false;
  panel._ha3dAR2TableSnapped = false;
  panel._ha3dAR2PlaneCount = 0;
  panel._ha3dAR2Anchor = null;
  panel._ha3dAR2AnchorHandle = null;
  restoreRoot(panel);
}

const originalResize = proto._resize;
if (originalResize && !proto.__ha3dAR2ResizeGuard) {
  proto.__ha3dAR2ResizeGuard = true;
  proto._resize = function (...args) {
    if (this._renderer?.xr?.isPresenting) return;
    return originalResize.apply(this, args);
  };
}

proto._ha3dToggleXR = async function () {
  ensure(this);
  if (this._ha3dXRPresenting) {
    await this._ha3dXRSession?.end?.();
    return;
  }
  if (!this._renderer || !this._model || !window.isSecureContext || !navigator.xr?.requestSession) {
    await this._ha3dProbeXR?.();
    return;
  }

  const original = {
    background: this._scene?.background ?? null,
    clearAlpha: this._renderer.getClearAlpha?.() ?? 1,
    controlsEnabled: this._controls?.enabled,
    controlsDamping: this._controls?.enableDamping,
    cameraAnimating: this._cameraAnimating,
  };
  this._ha3dAR2Restore = original;

  try {
    setButton(this, "Abrindo AR…", "warning", "Solicitando passthrough ao Meta Quest Browser");
    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["local-floor"],
      optionalFeatures: ["bounded-floor", "unbounded", "hand-tracking", "plane-detection", "anchors", "layers"],
    });

    this._ha3dXRSession = session;
    this._ha3dXRPresenting = true;
    this._cameraAnimating = true;
    if (this._controls) {
      this._controls.enabled = false;
      this._controls.enableDamping = false;
    }
    prepareContent(this);
    this.shadowRoot?.querySelector("#root")?.classList.add("ha3d-xr-presenting");
    this.shadowRoot?.querySelector("#viewsPanel")?.classList.remove("open");

    this._renderer.xr.enabled = true;
    this._renderer.xr.setReferenceSpaceType?.("local-floor");
    this._renderer.xr.setFramebufferScaleFactor?.(1.0);
    await this._renderer.xr.setSession(session);
    this._renderer.xr.setFoveation?.(0.55);
    installRenderHook(this);
    setupInputs(this);
    await restoreAnchor(this, session);
    scheduleRoomCapture(this, session);

    const blend = this._renderer.xr.getEnvironmentBlendMode?.();
    setButton(this, "Sair da AR", "ready", `AR ativa · ${blend || "passthrough"} · mãos/controles · planos/anchors quando disponíveis`);

    session.addEventListener("end", () => {
      this._ha3dXRSession = null;
      this._ha3dXRPresenting = false;
      this.shadowRoot?.querySelector("#root")?.classList.remove("ha3d-xr-presenting");
      cleanup(this);
      if (this._scene) this._scene.background = original.background;
      this._renderer?.setClearAlpha?.(original.clearAlpha);
      if (this._controls) {
        this._controls.enabled = original.controlsEnabled !== false;
        this._controls.enableDamping = original.controlsDamping !== false;
        this._controls.update?.();
      }
      this._cameraAnimating = original.cameraAnimating;
      this._ha3dIdleLastActivity = Date.now();
      setButton(this, "Entrar em AR", "ready", "WebXR immersive-ar disponível");
    }, { once: true });
  } catch (error) {
    console.error("[HA3D AR] session failed", error);
    this._ha3dXRSession = null;
    this._ha3dXRPresenting = false;
    this.shadowRoot?.querySelector("#root")?.classList.remove("ha3d-xr-presenting");
    cleanup(this);
    if (this._scene) this._scene.background = original.background;
    this._renderer?.setClearAlpha?.(original.clearAlpha);
    if (this._controls) {
      this._controls.enabled = original.controlsEnabled !== false;
      this._controls.enableDamping = original.controlsDamping !== false;
      this._controls.update?.();
    }
    this._cameraAnimating = original.cameraAnimating;
    setButton(this, "Erro na AR", "error", `${error?.name || "Erro"}: ${error?.message || "falha ao iniciar immersive-ar"}`);
    setTimeout(() => this._ha3dProbeXR?.(), 2600);
  }
};

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
