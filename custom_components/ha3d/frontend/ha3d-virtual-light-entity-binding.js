import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const MEDIA_OFF_STATES = new Set(["off", "standby", "unknown", "unavailable"]);
const DEFAULT_A = "#3a7bff";
const DEFAULT_B = "#754dff";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function isMediaPlayer(entityId) {
  return String(entityId || "").startsWith("media_player.");
}

function mediaPlayerIsOn(state) {
  if (!state) return false;
  return !MEDIA_OFF_STATES.has(String(state.state || "").toLowerCase());
}

function safeColor(value, fallback = "#ffffff") {
  try { return new THREE.Color(value || fallback); }
  catch (_error) { return new THREE.Color(fallback); }
}

function populateEntityList(panel) {
  const root = panel?.shadowRoot;
  const datalist = root?.querySelector("#ha3dVlEntities");
  if (!datalist) return;

  const states = Object.entries(panel?._hass?.states || {})
    .filter(([entityId]) => entityId.startsWith("light.") || entityId.startsWith("media_player."))
    .sort(([a], [b]) => a.localeCompare(b));

  datalist.innerHTML = states.map(([entityId, state]) => {
    const friendly = state?.attributes?.friendly_name || entityId;
    const type = entityId.startsWith("media_player.") ? "TV / Media Player" : "Luz";
    return `<option value="${escapeHtml(entityId)}">${escapeHtml(`${friendly} · ${type}`)}</option>`;
  }).join("");

  const input = root.querySelector("#ha3dVlEntity");
  if (input) input.placeholder = "light.sala ou media_player.tv_sala";

  const row = input?.closest?.(".ha3dRow");
  const hint = row?.querySelector?.(".ha3dHint");
  if (hint) hint.textContent = "Pode vincular a light.* ou media_player.*. Para TV, playing/paused/idle contam como ligada; off/standby como desligada.";
}

function applyMediaPlayerRuntime(panel, runtime, timeMs) {
  const config = runtime?.config;
  const light = runtime?.light;
  if (!config || !light || !isMediaPlayer(config.entity_id)) return;

  const state = panel?._hass?.states?.[config.entity_id];
  const on = mediaPlayerIsOn(state);
  if (!on) {
    light.intensity = 0;
    light.castShadow = false;
    return;
  }

  const base = Math.max(0, Number(config.intensity) || 0);
  light.distance = Math.max(0, Number(config.distance) || 0);
  light.decay = Math.max(0, Number(config.decay) || 0);

  if (config.effect === "tv_flicker") {
    const periodMs = Math.max(50, Math.min(60000, Number(config.flicker_period_ms) || 1200));
    const phase = (Number(timeMs || 0) % periodMs) / periodMs;
    const angle = phase * Math.PI * 2;
    const colorWave = 0.5 + 0.5 * Math.sin(angle + 0.28 * Math.sin(angle * 0.47));
    const flicker = 0.84 + 0.16 * (0.5 + 0.5 * Math.sin(angle * 3.6 + 0.5 * Math.sin(angle * 1.7)));
    const colorA = safeColor(config.flicker_color_a, DEFAULT_A);
    const colorB = safeColor(config.flicker_color_b, DEFAULT_B);
    light.intensity = base * flicker;
    light.color.copy(colorA).lerp(colorB, colorWave);
  } else {
    light.intensity = base;
    light.color.copy(safeColor(config.color, "#ffffff"));
  }

  light.castShadow = Boolean(config.cast_shadow && light.intensity > 0);
}

function syncMediaPlayerLights(panel, timeMs = performance.now()) {
  for (const runtime of panel?._ha3dVirtualLights?.values?.() || []) {
    applyMediaPlayerRuntime(panel, runtime, timeMs);
  }
}

if (!proto.__ha3dVirtualLightEntityBindingV1) {
  proto.__ha3dVirtualLightEntityBindingV1 = true;

  const oldRenderEditorForm = proto._renderEditorForm;
  proto._renderEditorForm = async function (...args) {
    const result = await oldRenderEditorForm?.apply(this, args);
    populateEntityList(this);
    return result;
  };

  const oldSyncLightStates = proto._syncLightStates;
  proto._syncLightStates = function (...args) {
    const result = oldSyncLightStates?.apply(this, args);
    syncMediaPlayerLights(this);
    return result;
  };

  const oldUpdateLightMarkers = proto._updateLightMarkers;
  proto._updateLightMarkers = function (...args) {
    const result = oldUpdateLightMarkers?.apply(this, args);
    syncMediaPlayerLights(this, performance.now());
    return result;
  };
}
