const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const THREE = Panel.HA3D_THREE;
if (!THREE) throw new Error("HA3D Three.js runtime was not registered");

const proto = Panel.prototype;
const CLEANING = "cleaning";
const states = new WeakMap();

function stateFor(entry) {
  let state = states.get(entry);
  if (!state) {
    state = {
      stamp: null,
      sampleAt: 0,
      sampleTarget: null,
      intervalMs: 0,
      velocity: new THREE.Vector3(),
      lastFrame: performance.now(),
    };
    states.set(entry, state);
  }
  return state;
}

function worldToLocalTarget(root, target) {
  if (!root?.parent) return target;
  root.parent.updateWorldMatrix?.(true, false);
  return root.parent.worldToLocal(target.clone());
}

function appendCadence(panel, entry, intervalMs) {
  if (!intervalMs || intervalMs < 100) return;
  const id = entry?.config?.id;
  if (!id) return;
  const live = panel.shadowRoot?.querySelector(`[data-robot-id="${CSS.escape(id)}"] [data-live]`);
  if (!live) return;
  const text = ` · atualização ~${(intervalMs / 1000).toFixed(1)} s`;
  if (!live.textContent.includes("atualização ~")) live.textContent += text;
}

function applyContinuity(panel, entry, now) {
  const root = entry?.object || entry?.icon;
  const config = entry?.config;
  if (!root || !config || !entry?.target || !entry?.lastStamp) return;

  const state = stateFor(entry);
  const vacuum = panel?._hass?.states?.[config.vacuum_entity];
  const cleaning = vacuum?.state === CLEANING && root.visible;

  if (state.stamp !== entry.lastStamp) {
    if (state.sampleAt && state.sampleTarget) {
      const interval = Math.max(100, now - state.sampleAt);
      state.intervalMs = state.intervalMs
        ? THREE.MathUtils.lerp(state.intervalMs, interval, 0.28)
        : interval;
      state.velocity.copy(entry.target).sub(state.sampleTarget).multiplyScalar(1000 / interval);
    }
    state.stamp = entry.lastStamp;
    state.sampleAt = now;
    state.sampleTarget = entry.target.clone();
  }

  appendCadence(panel, entry, state.intervalMs);
  if (!cleaning) {
    state.velocity.set(0, 0, 0);
    state.lastFrame = now;
    return;
  }

  const predicted = entry.target.clone();
  if (state.intervalMs >= 250 && state.velocity.lengthSq() > 1e-10) {
    const ageMs = Math.max(0, now - state.sampleAt);
    const horizonMs = Math.min(ageMs, state.intervalMs * 0.72, 2800);
    predicted.addScaledVector(state.velocity, horizonMs / 1000);
  }

  const dt = Math.min(0.05, Math.max(0.001, (now - state.lastFrame) / 1000));
  state.lastFrame = now;

  // The stock tracker defaults to 1600 ms, which adds visible lag on top of
  // an already sparse HA position sensor. While cleaning, catch up faster but
  // still exponentially smooth every rendered frame.
  const configuredTau = Math.max(0.08, Number(config.smoothing_ms || 1600) / 1000);
  const cadenceTau = state.intervalMs ? Math.max(0.22, Math.min(0.70, state.intervalMs / 1000 * 0.16)) : 0.45;
  const tau = Math.min(configuredTau, cadenceTau);
  const alpha = 1 - Math.exp(-dt / tau);
  const localTarget = worldToLocalTarget(root, predicted);
  root.position.lerp(localTarget, alpha);
  root.updateMatrixWorld?.(true);
}

if (!proto.__ha3dRobotMotionContinuityV1) {
  proto.__ha3dRobotMotionContinuityV1 = true;

  const oldUpdate = proto._updateRobots;
  proto._updateRobots = function (...args) {
    const result = oldUpdate?.apply(this, args);
    const now = performance.now();
    for (const entry of this._robotObjects?.().values?.() || []) applyContinuity(this, entry, now);
    return result;
  };
}
