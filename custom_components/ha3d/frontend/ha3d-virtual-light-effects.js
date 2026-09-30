import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const DEFAULT_A = "#3a7bff";
const DEFAULT_B = "#754dff";
const MEDIA_SAMPLE_MS = 200;
const SAMPLE_SIZE = 8;

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

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function mediaSourceElement(runtime) {
  if (runtime?._ha3dMjpeg?.image?.complete && runtime._ha3dMjpeg.image.naturalWidth > 0) {
    return runtime._ha3dMjpeg.image;
  }
  if (runtime?.video && runtime.video.readyState >= 2 && runtime.video.videoWidth > 0) {
    return runtime.video;
  }
  const image = runtime?.texture?.image;
  if (!image) return null;
  if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) {
    return image.complete && image.naturalWidth > 0 ? image : null;
  }
  if (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) return image;
  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) return image;
  return null;
}

function mediaIsActive(runtime) {
  return Boolean(
    runtime?.config?.enabled !== false
    && runtime?.group?.visible !== false
    && runtime?._ha3dScreenPowered !== false,
  );
}

function sampleMedia(runtime, timeMs) {
  if (!mediaIsActive(runtime)) return null;
  const cached = runtime._ha3dMediaLightSample;
  if (cached && Number(timeMs) - cached.at < MEDIA_SAMPLE_MS) return cached.value;

  const source = mediaSourceElement(runtime);
  if (!source) return null;

  let canvas = runtime._ha3dMediaLightCanvas;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    runtime._ha3dMediaLightCanvas = canvas;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  try {
    ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    ctx.drawImage(source, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;

    // Luminance follows the whole frame, while color is deliberately weighted
    // toward chromatic pixels. A plain RGB average makes movies with white text,
    // bright skies or neutral backgrounds collapse to an almost white Spot.
    let lumSum = 0;
    let alphaSum = 0;
    let wr = 0;
    let wg = 0;
    let wb = 0;
    let colorWeight = 0;
    let saturationSum = 0;

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] / 255;
      if (alpha <= 0) continue;

      const r = data[index] / 255;
      const g = data[index + 1] / 255;
      const b = data[index + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max > 0.001 ? (max - min) / max : 0;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      lumSum += luminance * alpha;
      alphaSum += alpha;
      saturationSum += saturation * alpha;

      // Neutral pixels keep a small vote, but saturated pixels dominate color.
      // Dark colored pixels still count, without allowing black to steer hue.
      const chromaWeight = alpha
        * (0.08 + 3.4 * Math.pow(saturation, 1.7))
        * (0.28 + 0.72 * Math.sqrt(max));
      wr += r * chromaWeight;
      wg += g * chromaWeight;
      wb += b * chromaWeight;
      colorWeight += chromaWeight;
    }

    if (!(alphaSum > 0) || !(colorWeight > 0)) return null;

    const luminance = clamp01(lumSum / alphaSum);
    let r = clamp01(wr / colorWeight);
    let g = clamp01(wg / colorWeight);
    let b = clamp01(wb / colorWeight);

    // Give the light a little more chroma than the raw frame average. This is
    // intentionally modest: it should feel like light from the image, not RGB FX.
    const averageSaturation = clamp01(saturationSum / alphaSum);
    const boost = 1.15 + 0.65 * averageSaturation;
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = clamp01(gray + (r - gray) * boost);
    g = clamp01(gray + (g - gray) * boost);
    b = clamp01(gray + (b - gray) * boost);

    const value = { r, g, b, luminance };
    runtime._ha3dMediaLightSample = { at: Number(timeMs), value };
    return value;
  } catch (_error) {
    runtime._ha3dMediaLightSample = { at: Number(timeMs), value: null };
    return null;
  }
}

function updateMediaImageEffect(panel, runtime, timeMs) {
  const config = runtime?.config;
  const light = runtime?.light;
  if (!config || !light || config.effect !== "media_image") return false;

  const state = effectiveState(panel, config);
  const media = config.media_panel_id ? panel?._ha3dMediaPanels?.get?.(config.media_panel_id) : null;
  if (!state.on || !mediaIsActive(media)) {
    light.intensity = 0;
    light.castShadow = false;
    return true;
  }

  const sample = sampleMedia(media, timeMs);
  if (!sample) {
    light.intensity = 0;
    light.castShadow = false;
    return true;
  }

  const targetIntensity = Math.max(0, Number(config.intensity) || 0) * state.brightness * sample.luminance;
  const effectState = runtime._ha3dMediaImageEffect || {
    color: new THREE.Color().setRGB(sample.r, sample.g, sample.b, THREE.SRGBColorSpace),
    intensity: targetIntensity,
    at: Number(timeMs),
  };
  runtime._ha3dMediaImageEffect = effectState;

  const elapsed = Math.max(1, Math.min(250, Number(timeMs) - Number(effectState.at || timeMs)));
  const alpha = 1 - Math.exp(-elapsed / 140);
  const targetColor = new THREE.Color().setRGB(sample.r, sample.g, sample.b, THREE.SRGBColorSpace);
  effectState.color.lerp(targetColor, alpha);
  effectState.intensity += (targetIntensity - effectState.intensity) * alpha;
  effectState.at = Number(timeMs);

  light.color.copy(effectState.color);
  light.intensity = Math.max(0, effectState.intensity);
  light.castShadow = Boolean(config.cast_shadow && light.intensity > 0);
  return true;
}

function updateEffects(panel, timeMs) {
  for (const runtime of panel?._ha3dVirtualLights?.values?.() || []) {
    const config = runtime?.config;
    const light = runtime?.light;
    if (!config || !light) continue;

    if (updateMediaImageEffect(panel, runtime, timeMs)) continue;
    if (config.effect !== "tv_flicker") continue;

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

if (!proto.__ha3dVirtualLightEffectsV4) {
  proto.__ha3dVirtualLightEffectsV4 = true;

  const oldUpdateLightMarkers = proto._updateLightMarkers;
  proto._updateLightMarkers = function (...args) {
    const result = oldUpdateLightMarkers?.apply(this, args);
    updateEffects(this, performance.now());
    return result;
  };
}
