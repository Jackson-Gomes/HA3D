import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const FIRST_MIN_MS = 9000;
const FIRST_MAX_MS = 15000;
const NEXT_MIN_MS = 18000;
const NEXT_MAX_MS = 32000;
const MOVE_IN_MS = 1700;
const SCAN_MS = 2100;
const HOLD_MIN_MS = 900;
const HOLD_MAX_MS = 1500;
const MOVE_OUT_MS = 1700;
const ABORT_RETURN_MS = 650;
const USER_QUIET_MS = 5500;
const ORBIT_SPEED = 0.000025;
const EVALUATE_MS = 500;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function ease(t) {
  return t * t * (3 - 2 * t);
}

function isXrayActive(panel) {
  // The idle controller is the source of truth. During X-Ray transitions the
  // CSS class can lag the controller state by a frame, so requiring both
  // signals could keep autonomous exploration permanently disarmed.
  const idleActive = panel?._ha3dIdleActive === true;
  const rootHasXray = panel?.shadowRoot?.querySelector("#root")?.classList.contains("ha3d-idle-xray") === true;
  return Boolean(idleActive || rootHasXray);
}

function explorationState(panel) {
  if (!panel._ha3dAiExploration) {
    panel._ha3dAiExploration = {
      active: false,
      wasXray: false,
      dueAt: 0,
      lastUserActivity: 0,
      lastEntity: null,
      recentEntities: [],
      raf: 0,
      cameraRaf: 0,
      lastEvaluate: 0,
      abortRequested: false,
      installedActivity: false,
    };
  }
  return panel._ha3dAiExploration;
}

function hasAnomalyPriority(panel) {
  const anomalies = panel._ha3dOrganicTelemetry?.anomalies;
  if (anomalies instanceof Map && anomalies.size > 0) return true;
  const inspection = panel._ha3dAiInspectionFocus;
  return Boolean(inspection?.active || inspection?.pendingEntity || panel._ha3dAiFocusActive);
}

function calloutBusy(panel) {
  const blue = panel.shadowRoot?.querySelector("#ha3dTelemetryCard");
  return Boolean(
    blue?.classList.contains("visible") || panel._ha3dOrganicTelemetry?.currentEntity,
  );
}

function modelFrame(panel) {
  try {
    const box = new THREE.Box3().setFromObject(panel._model);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      return {
        box,
        center: box.getCenter(new THREE.Vector3()),
        scale: Math.max(size.x, size.y, size.z, 1),
      };
    }
  } catch (_error) {}
  return {
    box: null,
    center: panel._controls?.target?.clone?.() || new THREE.Vector3(),
    scale: 10,
  };
}

function objectBounds(object) {
  try {
    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty()) return box;
  } catch (_error) {}
  return null;
}

function candidateObjects(panel) {
  const map = panel._objectsByEntity;
  if (!(map instanceof Map)) return [];

  const { scale } = modelFrame(panel);
  const candidates = [];
  const seenObjects = new Set();

  for (const [entity, rawObjects] of map.entries()) {
    if (!panel._hass?.states?.[entity]) continue;
    const objects = Array.isArray(rawObjects) ? rawObjects : [rawObjects];
    const object = objects.find((item) => item?.isObject3D && item.visible !== false);
    if (!object || seenObjects.has(object.uuid)) continue;

    const box = objectBounds(object);
    if (!box) continue;
    const size = box.getSize(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxSize) || maxSize <= 0) continue;
    if (maxSize > scale * 0.62) continue;

    seenObjects.add(object.uuid);
    candidates.push({ entity, object, box });
  }

  return candidates;
}

function chooseCandidate(panel) {
  const st = explorationState(panel);
  const candidates = candidateObjects(panel);
  if (!candidates.length) return null;

  const recent = new Set(st.recentEntities);
  let pool = candidates.filter((item) => !recent.has(item.entity));
  if (!pool.length) pool = candidates.filter((item) => item.entity !== st.lastEntity);
  if (!pool.length) pool = candidates;

  return pool[Math.floor(Math.random() * pool.length)];
}

function scheduleNext(panel, first = false) {
  const st = explorationState(panel);
  const min = first ? FIRST_MIN_MS : NEXT_MIN_MS;
  const max = first ? FIRST_MAX_MS : NEXT_MAX_MS;
  st.dueAt = Date.now() + randomBetween(min, max);
}

function pauseIdleOrbit(panel) {
  if (panel._ha3dIdleRaf) cancelAnimationFrame(panel._ha3dIdleRaf);
  panel._ha3dIdleRaf = 0;
}

function resumeIdleOrbit(panel) {
  if (!panel._ha3dIdleActive || !isXrayActive(panel) || !panel._ha3dIdleOrbit) return;
  const orbit = panel._ha3dIdleOrbit;
  orbit.last = performance.now();
  orbit.angle = Math.atan2(
    panel._camera.position.z - orbit.center.z,
    panel._camera.position.x - orbit.center.x,
  );

  const frame = (now) => {
    const st = explorationState(panel);
    if (
      !panel._ha3dIdleActive ||
      !isXrayActive(panel) ||
      st.active ||
      panel._ha3dAiFocusActive
    ) {
      panel._ha3dIdleRaf = 0;
      return;
    }

    const delta = Math.min(80, Math.max(0, now - (orbit.last || now)));
    orbit.last = now;
    orbit.angle += delta * ORBIT_SPEED;
    panel._camera.position.set(
      orbit.center.x + Math.cos(orbit.angle) * orbit.radius,
      orbit.center.y + orbit.height,
      orbit.center.z + Math.sin(orbit.angle) * orbit.radius,
    );
    panel._controls.target.copy(orbit.center);
    panel._camera.up.set(0, 1, 0);
    panel._camera.lookAt(orbit.center);
    panel._ha3dIdleRaf = requestAnimationFrame(frame);
  };

  panel._ha3dIdleRaf = requestAnimationFrame(frame);
}

function shouldAbort(panel) {
  const st = explorationState(panel);
  return Boolean(
    st.abortRequested ||
      !panel.isConnected ||
      !isXrayActive(panel) ||
      hasAnomalyPriority(panel) ||
      performance.now() - st.lastUserActivity < USER_QUIET_MS,
  );
}

function animateCamera(panel, fromPos, toPos, fromTarget, toTarget, duration, allowAbort = true) {
  return new Promise((resolve) => {
    const st = explorationState(panel);
    const started = performance.now();

    const frame = (now) => {
      if (allowAbort && shouldAbort(panel)) {
        st.cameraRaf = 0;
        resolve(false);
        return;
      }
      if (!panel.isConnected || !panel._camera || !panel._controls) {
        st.cameraRaf = 0;
        resolve(false);
        return;
      }

      const t = Math.max(0, Math.min(1, (now - started) / duration));
      const k = ease(t);
      panel._camera.position.lerpVectors(fromPos, toPos, k);
      panel._controls.target.lerpVectors(fromTarget, toTarget, k);
      panel._camera.up.set(0, 1, 0);
      panel._camera.lookAt(panel._controls.target);

      if (t < 1) st.cameraRaf = requestAnimationFrame(frame);
      else {
        st.cameraRaf = 0;
        resolve(true);
      }
    };

    st.cameraRaf = requestAnimationFrame(frame);
  });
}

function delayWhileAllowed(panel, duration) {
  return new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      if (shouldAbort(panel)) {
        resolve(false);
        return;
      }
      if (performance.now() - started >= duration) {
        resolve(true);
        return;
      }
      setTimeout(tick, 80);
    };
    tick();
  });
}

function computeViews(panel, candidate, savedPos) {
  const frame = modelFrame(panel);
  const center = candidate.box.getCenter(new THREE.Vector3());
  const size = candidate.box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, frame.scale * 0.012) * 0.5;

  let direction = savedPos.clone().sub(center);
  let distance = direction.length();
  if (distance < 0.001) {
    direction.set(1, 0.7, 1).normalize();
    distance = frame.scale;
  } else {
    direction.normalize();
  }

  const ideal = Math.max(radius * 5.5, frame.scale * 0.27);
  const focusDistance = Math.max(distance * 0.42, Math.min(distance * 0.72, ideal));
  const focusPos = center.clone().add(direction.clone().multiplyScalar(focusDistance));
  focusPos.y += frame.scale * 0.035;

  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, direction).normalize();
  if (side.lengthSq() < 0.001) side.set(1, 0, 0);
  const sign = Math.random() < 0.5 ? -1 : 1;
  const sideAmount = Math.min(frame.scale * 0.075, focusDistance * 0.16) * sign;
  const scanPos = focusPos.clone().add(side.clone().multiplyScalar(sideAmount));
  scanPos.y += randomBetween(-0.012, 0.018) * frame.scale;

  const focusTarget = center.clone();
  focusTarget.y += Math.min(radius * 0.16, frame.scale * 0.018);
  const scanTarget = focusTarget.clone().add(side.multiplyScalar(frame.scale * 0.012 * sign));

  return { focusPos, focusTarget, scanPos, scanTarget };
}

async function returnToOrbit(panel, savedPos, savedTarget, fast = false) {
  if (!panel.isConnected || !isXrayActive(panel)) return;
  await animateCamera(
    panel,
    panel._camera.position.clone(),
    savedPos,
    panel._controls.target.clone(),
    savedTarget,
    fast ? ABORT_RETURN_MS : MOVE_OUT_MS,
    false,
  );
}

async function startExploration(panel) {
  const st = explorationState(panel);
  if (st.active || !isXrayActive(panel) || hasAnomalyPriority(panel) || calloutBusy(panel)) return false;
  if (performance.now() - st.lastUserActivity < USER_QUIET_MS) return false;

  const candidate = chooseCandidate(panel);
  if (!candidate) return false;

  st.active = true;
  st.abortRequested = false;
  panel._ha3dAiExplorationActive = true;
  panel._ha3dAiExplorationTarget = candidate.entity;

  const savedPos = panel._camera.position.clone();
  const savedTarget = panel._controls.target.clone();
  const { focusPos, focusTarget, scanPos, scanTarget } = computeViews(panel, candidate, savedPos);

  pauseIdleOrbit(panel);

  let completed = false;
  try {
    if (!await animateCamera(panel, savedPos, focusPos, savedTarget, focusTarget, MOVE_IN_MS)) return false;
    if (!await delayWhileAllowed(panel, randomBetween(350, 700))) return false;
    if (!await animateCamera(
      panel,
      panel._camera.position.clone(),
      scanPos,
      panel._controls.target.clone(),
      scanTarget,
      SCAN_MS,
    )) return false;
    if (!await delayWhileAllowed(panel, randomBetween(HOLD_MIN_MS, HOLD_MAX_MS))) return false;
    completed = true;
    return true;
  } finally {
    const fast = !completed || st.abortRequested || hasAnomalyPriority(panel);
    await returnToOrbit(panel, savedPos, savedTarget, fast);

    st.active = false;
    st.abortRequested = false;
    panel._ha3dAiExplorationActive = false;
    panel._ha3dAiExplorationTarget = null;

    st.lastEntity = candidate.entity;
    st.recentEntities = [candidate.entity, ...st.recentEntities.filter((item) => item !== candidate.entity)].slice(0, 3);
    scheduleNext(panel, false);
    resumeIdleOrbit(panel);
  }
}

function evaluate(panel) {
  const st = explorationState(panel);
  const xray = isXrayActive(panel);

  if (!xray) {
    st.wasXray = false;
    st.dueAt = 0;
    if (st.active) st.abortRequested = true;
    return;
  }

  if (!st.wasXray) {
    st.wasXray = true;
    scheduleNext(panel, true);
    return;
  }

  if (st.active) {
    if (hasAnomalyPriority(panel)) st.abortRequested = true;
    return;
  }

  if (!st.dueAt) scheduleNext(panel, false);
  if (Date.now() < st.dueAt) return;

  if (
    hasAnomalyPriority(panel) ||
    calloutBusy(panel) ||
    performance.now() - st.lastUserActivity < USER_QUIET_MS
  ) {
    st.dueAt = Date.now() + randomBetween(3500, 6500);
    return;
  }

  st.dueAt = 0;
  startExploration(panel).then((started) => {
    if (!started && isXrayActive(panel) && !explorationState(panel).dueAt) {
      explorationState(panel).dueAt = Date.now() + randomBetween(5000, 9000);
    }
  });
}

function frame(panel, now) {
  const st = explorationState(panel);
  if (!panel.isConnected) {
    st.raf = 0;
    return;
  }

  if (now - st.lastEvaluate >= EVALUATE_MS) {
    st.lastEvaluate = now;
    evaluate(panel);
  }

  st.raf = requestAnimationFrame((time) => frame(panel, time));
}

function installActivity(panel) {
  const st = explorationState(panel);
  if (st.installedActivity) return;
  const target = panel._renderer?.domElement || panel.shadowRoot?.querySelector("#stage") || panel.shadowRoot;
  if (!target?.addEventListener) return;

  const mark = () => {
    st.lastUserActivity = performance.now();
    if (st.active) st.abortRequested = true;
  };
  target.addEventListener("pointerdown", mark, { passive: true });
  target.addEventListener("wheel", mark, { passive: true });
  target.addEventListener("touchstart", mark, { passive: true });
  st.installedActivity = true;
}

function install(panel) {
  if (!panel?.shadowRoot) return;
  installActivity(panel);
  const st = explorationState(panel);
  panel._ha3dAiExplorationAbort = () => {
    st.abortRequested = true;
  };
  if (!st.raf) st.raf = requestAnimationFrame((time) => frame(panel, time));
}

function cleanup(panel) {
  const st = explorationState(panel);
  if (st.raf) cancelAnimationFrame(st.raf);
  if (st.cameraRaf) cancelAnimationFrame(st.cameraRaf);
  st.raf = 0;
  st.cameraRaf = 0;
  st.active = false;
  st.abortRequested = true;
  panel._ha3dAiExplorationActive = false;
  panel._ha3dAiExplorationTarget = null;
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

if (!proto.__ha3dAiAutonomousExplorationV1) {
  proto.__ha3dAiAutonomousExplorationV1 = true;

  const originalConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = originalConnected?.apply(this, args);
    queueMicrotask(() => install(this));
    return result;
  };

  const originalDisconnected = proto.disconnectedCallback;
  proto.disconnectedCallback = function (...args) {
    cleanup(this);
    return originalDisconnected?.apply(this, args);
  };

  const originalLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await originalLoadModel?.apply(this, args);
    queueMicrotask(() => install(this));
    return result;
  };

  queueMicrotask(installOnExistingPanels);
  requestAnimationFrame(installOnExistingPanels);
  setTimeout(installOnExistingPanels, 350);
}
