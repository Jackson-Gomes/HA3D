import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const DEFAULT_A = "#3a7bff";
const DEFAULT_B = "#754dff";

function effectiveState(panel, config) {
  if (config?.entity_id) {
    const state = panel?._hass?.states?.[config.entity_id];
    if (!state || state.state === "unknown" || state.state === "unavailable") return { on: false, brightness: 1 };
    const brightness = Number(state.attributes?.brightness);
    return {
      on: state.state === "on",
      brightness: Number.isFinite(brightness) ? Math.max(0, Math.min(1, brightness / 255)) : 1,
    };
  }
  return { on: config?.enabled !== false, brightness: 1 };
}

function safeColor(value, fallback) {
  try { return new THREE.Color(value || fallback); } catch (_error) { return new THREE.Color(fallback); }
}

function updateEffects(panel, timeMs) {
  for (const runtime of panel?._ha3dVirtualLights?.values?.() || []) {
    const config = runtime?.config;
    const light = runtime?.light;
    if (!config || !light || config.effect !== "tv_flicker") continue;

    const state = effectiveState(panel, config);
    if (!state.on) {
      light.intensity = 0;
      continue;
    }

    const base = Math.max(0, Number(config.intensity) || 0) * state.brightness;
    if (!(base > 0)) {
      light.intensity = 0;
      continue;
    }

    const periodMs = Math.max(50, Math.min(60000, Number(config.flicker_period_ms) || 1200));
    const phase = (Number(timeMs || 0) % periodMs) / periodMs;
    const angle = phase * Math.PI * 2;

    const colorWave = 0.5 + 0.5 * Math.sin(angle + 0.28 * Math.sin(angle * 0.47));
    const flicker = 0.84 + 0.16 * (0.5 + 0.5 * Math.sin(angle * 3.6 + 0.5 * Math.sin(angle * 1.7)));

    const colorA = safeColor(config.flicker_color_a, DEFAULT_A);
    const colorB = safeColor(config.flicker_color_b, DEFAULT_B);
    light.intensity = base * flicker;
    light.color.copy(colorA).lerp(colorB, colorWave);
    light.castShadow = Boolean(config.cast_shadow && light.intensity > 0);
  }
}

if (!proto.__ha3dVirtualLightEffectsV2) {
  proto.__ha3dVirtualLightEffectsV2 = true;

  const oldUpdateLightMarkers = proto._updateLightMarkers;
  proto._updateLightMarkers = function (...args) {
    const result = oldUpdateLightMarkers?.apply(this, args);
    updateEffects(this, performance.now());
    return result;
  };
}
