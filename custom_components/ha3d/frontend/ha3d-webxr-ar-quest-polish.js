import "./ha3d-panel.js";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const THREE = Panel.HA3D_THREE;
if (!THREE) throw new Error("HA3D Three.js runtime was not registered");

const proto = Panel.prototype;
const ICON_PICK_RADIUS = 0.11;
const MENU_PICK_RADIUS = 0.047;
const MENU_OFFSET_RIGHT = 0.17;
const MENU_OFFSET_UP = 0.10;
const MENU_SPACING = 0.064;
const XR_FRAMEBUFFER_SCALE = 0.82;
const XR_FOVEATION = 1.0;

function ensure(panel) {
  panel._ha3dQuestIconTextures ||= new Map();
  panel._ha3dQuestMenu ||= null;
  panel._ha3dQuestPerfRestore ||= null;
}

function glyphForEntity(entity) {
  const [domain, objectId = ""] = String(entity || "").toLowerCase().split(".", 2);
  if (domain === "light") return "💡";
  if (domain === "switch") return /(printer|impressora)/.test(objectId) ? "🖨️" : "🔌";
  if (domain === "media_player") return /(tv|televis)/.test(objectId) ? "📺" : "▶";
  if (domain === "climate") return "❄";
  if (domain === "vacuum") return "🤖";
  if (domain === "cover") return "▤";
  if (domain === "lock") return "🔒";
  if (domain === "fan") return "◉";
  if (domain === "camera") return "📷";
  if (domain === "script" || domain === "scene") return "▶";
  if (domain === "button" || domain === "input_button") return "●";
  return "•";
}

function compactIconTexture(panel, entity) {
  ensure(panel);
  const glyph = glyphForEntity(entity);
  if (panel._ha3dQuestIconTextures.has(glyph)) return panel._ha3dQuestIconTextures.get(glyph);

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 35, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20,24,30,0.92)";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  ctx.font = "40px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "white";
  ctx.fillText(glyph, 64, 66);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  panel._ha3dQuestIconTextures.set(glyph, texture);
  return texture;
}

function applyCompactIcons(panel) {
  ensure(panel);
  for (const [entity, sprite] of panel?._ha3dARIconSprites || []) {
    if (!sprite?.material || sprite.userData?.ha3dQuestCompactIcon) continue;
    sprite.material.map = compactIconTexture(panel, entity);
    sprite.material.needsUpdate = true;
    sprite.userData.ha3dQuestCompactIcon = true;
  }
}

function rayFromController(controller) {
  if (!controller) return null;
  controller.updateMatrixWorld?.(true);
  const rotation = new THREE.Matrix4().extractRotation(controller.matrixWorld);
  return {
    origin: new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld),
    direction: new THREE.Vector3(0, 0, -1).applyMatrix4(rotation).normalize(),
  };
}

function pointHit(ray, point, radius, maxDistance = 4) {
  if (!ray || !point) return null;
  const toPoint = point.clone().sub(ray.origin);
  const along = toPoint.dot(ray.direction);
  if (along <= 0 || along > maxDistance) return null;
  const closest = ray.direction.clone().multiplyScalar(along).add(ray.origin);
  const distance = closest.distanceTo(point);
  if (distance > radius) return null;
  return { distance, along, score: distance + along * 0.002 };
}

function iconHit(panel, controller) {
  const ray = rayFromController(controller);
  if (!ray) return null;
  let best = null;
  const point = new THREE.Vector3();
  for (const [entity, sprite] of panel?._ha3dARIconSprites || []) {
    if (!sprite?.visible) continue;
    sprite.getWorldPosition(point);
    const hit = pointHit(ray, point, ICON_PICK_RADIUS);
    if (hit && (!best || hit.score < best.score)) best = { entity, score: hit.score };
  }
  return best?.entity || null;
}

function friendlyName(panel, entity) {
  return panel?._hass?.states?.[entity]?.attributes?.friendly_name || entity;
}

function shortText(value, max = 22) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function menuTexture(label, header = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const x = 8;
  const y = 8;
  const w = canvas.width - 16;
  const h = canvas.height - 16;
  const r = 28;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = header ? "rgba(9,20,28,0.96)" : "rgba(25,30,38,0.96)";
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = header ? "rgba(86,222,255,0.9)" : "rgba(255,255,255,0.35)";
  ctx.stroke();
  ctx.fillStyle = "white";
  ctx.font = header ? "600 38px system-ui, sans-serif" : "500 40px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(shortText(label, header ? 26 : 23), 256, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeMenuSprite(label, header = false) {
  const texture = menuTexture(label, header);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 30000;
  sprite.scale.set(header ? 0.25 : 0.22, header ? 0.062 : 0.055, 1);
  sprite.userData.ha3dQuestMenuTexture = texture;
  return sprite;
}

function menuActions(panel, entity) {
  const stateObj = panel?._hass?.states?.[entity];
  const [domain] = String(entity || "").split(".", 1);
  const actions = [];

  if (domain === "climate") {
    const temp = Number(stateObj?.attributes?.temperature);
    actions.push({ id: "power", label: stateObj?.state === "off" ? "⏻ Ligar" : "⏻ Desligar" });
    actions.push({ id: "temp_down", label: Number.isFinite(temp) ? `− Temperatura ${temp}°` : "− Temperatura" });
    actions.push({ id: "temp_up", label: "+ Temperatura" });
  } else if (domain === "media_player") {
    actions.push({ id: "power", label: stateObj?.state === "off" ? "⏻ Ligar" : "⏻ Desligar" });
    actions.push({ id: "play_pause", label: "⏯ Play / Pause" });
    actions.push({ id: "volume_down", label: "🔉 Volume −" });
    actions.push({ id: "volume_up", label: "🔊 Volume +" });
  } else if (domain === "vacuum") {
    actions.push({ id: "start", label: "▶ Limpar" });
    actions.push({ id: "pause", label: "Ⅱ Pausar" });
    actions.push({ id: "return_to_base", label: "⌂ Voltar à base" });
  } else if (domain === "cover") {
    actions.push({ id: "open_cover", label: "▲ Abrir" });
    actions.push({ id: "stop_cover", label: "■ Parar" });
    actions.push({ id: "close_cover", label: "▼ Fechar" });
  } else if (domain === "lock") {
    actions.push({ id: stateObj?.state === "locked" ? "unlock" : "lock", label: stateObj?.state === "locked" ? "🔓 Destrancar" : "🔒 Trancar" });
  } else if (domain === "fan") {
    const pct = Number(stateObj?.attributes?.percentage);
    actions.push({ id: "power", label: stateObj?.state === "off" ? "⏻ Ligar" : "⏻ Desligar" });
    actions.push({ id: "fan_down", label: Number.isFinite(pct) ? `− Velocidade ${pct}%` : "− Velocidade" });
    actions.push({ id: "fan_up", label: "+ Velocidade" });
  } else {
    actions.push({ id: "noop", label: `Estado: ${stateObj?.state ?? "?"}` });
  }

  actions.push({ id: "close", label: "✕ Fechar" });
  return actions;
}

function closeMenu(panel) {
  ensure(panel);
  const menu = panel._ha3dQuestMenu;
  if (!menu) return;
  for (const item of menu.items || []) {
    item.sprite?.parent?.remove(item.sprite);
    item.sprite?.material?.dispose?.();
    item.sprite?.userData?.ha3dQuestMenuTexture?.dispose?.();
  }
  menu.header?.parent?.remove(menu.header);
  menu.header?.material?.dispose?.();
  menu.header?.userData?.ha3dQuestMenuTexture?.dispose?.();
  panel._ha3dQuestMenu = null;
}

function openMenu(panel, entity, controller) {
  ensure(panel);
  if (panel._ha3dQuestMenu?.entity === entity) {
    closeMenu(panel);
    pulse(controller, 0.16, 25);
    return;
  }
  closeMenu(panel);
  const scene = panel?._scene;
  if (!scene) return;

  const state = panel?._hass?.states?.[entity]?.state;
  const header = makeMenuSprite(`${friendlyName(panel, entity)} · ${state ?? "?"}`, true);
  scene.add(header);
  const items = menuActions(panel, entity).map((action) => {
    const sprite = makeMenuSprite(action.label, false);
    sprite.userData.ha3dQuestMenuAction = action.id;
    scene.add(sprite);
    return { action: action.id, sprite };
  });
  panel._ha3dQuestMenu = { entity, header, items, hovered: null };
  pulse(controller, 0.32, 36);
}

function menuHit(panel, controller) {
  const menu = panel?._ha3dQuestMenu;
  const ray = rayFromController(controller);
  if (!menu || !ray) return null;
  let best = null;
  const point = new THREE.Vector3();
  for (const item of menu.items || []) {
    item.sprite.getWorldPosition(point);
    const hit = pointHit(ray, point, MENU_PICK_RADIUS);
    if (hit && (!best || hit.score < best.score)) best = { item, score: hit.score };
  }
  return best?.item || null;
}

function updateMenuLayout(panel) {
  const menu = panel?._ha3dQuestMenu;
  const icon = panel?._ha3dARIconSprites?.get?.(menu?.entity);
  const renderer = panel?._renderer;
  if (!menu || !icon || !renderer?.xr) return;

  const camera = renderer.xr.getCamera?.(panel._camera) || panel._camera;
  camera.updateMatrixWorld?.(true);
  const q = camera.getWorldQuaternion(new THREE.Quaternion());
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();
  const anchor = icon.getWorldPosition(new THREE.Vector3());
  const origin = anchor.clone().addScaledVector(right, MENU_OFFSET_RIGHT).addScaledVector(up, MENU_OFFSET_UP);

  menu.header.position.copy(origin);
  for (let i = 0; i < menu.items.length; i += 1) {
    menu.items[i].sprite.position.copy(origin).addScaledVector(up, -(i + 1) * MENU_SPACING);
  }
}

function updateMenuHover(panel) {
  const menu = panel?._ha3dQuestMenu;
  if (!menu) return;
  let hovered = null;
  for (const controller of panel?._ha3dAR3Controllers || []) {
    const item = menuHit(panel, controller);
    if (item) {
      hovered = item;
      break;
    }
  }
  for (const item of menu.items) {
    item.sprite.material.color.setHex(item === hovered ? 0x78e8ff : 0xffffff);
    const target = item === hovered ? 1.10 : 1.0;
    const current = Number(item.sprite.userData.ha3dQuestHoverScale || 1);
    const next = THREE.MathUtils.lerp(current, target, 0.3);
    item.sprite.userData.ha3dQuestHoverScale = next;
    item.sprite.scale.set(0.22 * next, 0.055 * next, 1);
  }
  menu.hovered = hovered;
}

async function directAction(panel, entity, controller) {
  const hass = panel?._hass;
  if (!hass || !entity) return false;
  const [domain] = String(entity).split(".", 1);
  try {
    if (["light", "switch", "input_boolean", "automation"].includes(domain)) {
      await hass.callService(domain, "toggle", { entity_id: entity });
    } else if (domain === "button" || domain === "input_button") {
      await hass.callService(domain, "press", { entity_id: entity });
    } else if (domain === "script" || domain === "scene") {
      await hass.callService(domain, "turn_on", { entity_id: entity });
    } else {
      return false;
    }
    pulse(controller, 0.44, 46);
    return true;
  } catch (error) {
    console.warn("[HA3D AR] direct XR action failed", entity, error);
    pulse(controller, 0.12, 70);
    return false;
  }
}

function domainNeedsMenu(entity) {
  const [domain] = String(entity || "").split(".", 1);
  return !["light", "switch", "input_boolean", "automation", "button", "input_button", "script", "scene"].includes(domain);
}

async function runMenuAction(panel, item, controller) {
  const menu = panel?._ha3dQuestMenu;
  const entity = menu?.entity;
  const hass = panel?._hass;
  if (!menu || !entity || !item || !hass) return;
  const [domain] = entity.split(".", 1);
  const state = hass.states?.[entity];
  const attrs = state?.attributes || {};
  const action = item.action;

  try {
    if (action === "close") {
      closeMenu(panel);
      pulse(controller, 0.14, 22);
      return;
    }
    if (action === "noop") {
      pulse(controller, 0.10, 18);
      return;
    }
    if (action === "power") {
      await hass.callService(domain, state?.state === "off" ? "turn_on" : "turn_off", { entity_id: entity });
    } else if (domain === "climate" && (action === "temp_down" || action === "temp_up")) {
      const current = Number(attrs.temperature);
      const min = Number.isFinite(Number(attrs.min_temp)) ? Number(attrs.min_temp) : 16;
      const max = Number.isFinite(Number(attrs.max_temp)) ? Number(attrs.max_temp) : 30;
      const target = THREE.MathUtils.clamp((Number.isFinite(current) ? current : 22) + (action === "temp_up" ? 1 : -1), min, max);
      await hass.callService("climate", "set_temperature", { entity_id: entity, temperature: target });
    } else if (domain === "media_player" && action === "play_pause") {
      await hass.callService("media_player", "media_play_pause", { entity_id: entity });
    } else if (domain === "media_player" && action === "volume_down") {
      await hass.callService("media_player", "volume_down", { entity_id: entity });
    } else if (domain === "media_player" && action === "volume_up") {
      await hass.callService("media_player", "volume_up", { entity_id: entity });
    } else if (domain === "vacuum" && ["start", "pause", "return_to_base"].includes(action)) {
      await hass.callService("vacuum", action, { entity_id: entity });
    } else if (domain === "cover" && ["open_cover", "stop_cover", "close_cover"].includes(action)) {
      await hass.callService("cover", action, { entity_id: entity });
    } else if (domain === "lock" && ["lock", "unlock"].includes(action)) {
      await hass.callService("lock", action, { entity_id: entity });
    } else if (domain === "fan" && (action === "fan_down" || action === "fan_up")) {
      const current = Number(attrs.percentage);
      const target = THREE.MathUtils.clamp((Number.isFinite(current) ? current : 50) + (action === "fan_up" ? 10 : -10), 0, 100);
      await hass.callService("fan", "set_percentage", { entity_id: entity, percentage: target });
    }
    pulse(controller, 0.42, 42);
  } catch (error) {
    console.warn("[HA3D AR] XR menu action failed", entity, action, error);
    pulse(controller, 0.12, 80);
  }
}

function installSelectOverride(panel) {
  ensure(panel);
  for (const controller of panel?._ha3dAR3Controllers || []) {
    const u = controller.userData || {};
    const baseStart = u.ha3dAR3Start;
    if (!baseStart || baseStart.__ha3dQuestPolish) continue;
    controller.removeEventListener("selectstart", baseStart);

    const start = () => {
      const menuItem = menuHit(panel, controller);
      if (menuItem) {
        runMenuAction(panel, menuItem, controller);
        return;
      }

      const entity = iconHit(panel, controller);
      if (entity) {
        if (domainNeedsMenu(entity)) openMenu(panel, entity, controller);
        else {
          closeMenu(panel);
          directAction(panel, entity, controller);
        }
        return;
      }

      if (panel._ha3dQuestMenu) closeMenu(panel);
      baseStart();
    };
    start.__ha3dQuestPolish = true;
    start.__ha3dQuestBaseStart = baseStart;
    u.ha3dAR3Start = start;
    controller.addEventListener("selectstart", start);
  }
}

function prepareXRPerformance(panel) {
  const xr = panel?._renderer?.xr;
  if (!xr || panel?._ha3dXRPresenting) return;
  try { xr.setFramebufferScaleFactor?.(XR_FRAMEBUFFER_SCALE); } catch (_error) {}
  try { xr.setFoveation?.(XR_FOVEATION); } catch (_error) {}
}

function enterXRPerformance(panel) {
  ensure(panel);
  const renderer = panel?._renderer;
  if (!renderer || panel._ha3dQuestPerfRestore) return;
  panel._ha3dQuestPerfRestore = {
    shadowEnabled: Boolean(renderer.shadowMap?.enabled),
    shadowAutoUpdate: renderer.shadowMap?.autoUpdate,
  };
  if (renderer.shadowMap) {
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.autoUpdate = false;
  }
  try { renderer.xr?.setFoveation?.(XR_FOVEATION); } catch (_error) {}
}

function restoreXRPerformance(panel) {
  const renderer = panel?._renderer;
  const restore = panel?._ha3dQuestPerfRestore;
  if (renderer?.shadowMap && restore) {
    renderer.shadowMap.enabled = restore.shadowEnabled;
    renderer.shadowMap.autoUpdate = restore.shadowAutoUpdate;
  }
  if (panel) panel._ha3dQuestPerfRestore = null;
}

function cleanup(panel) {
  closeMenu(panel);
  restoreXRPerformance(panel);
  for (const texture of panel?._ha3dQuestIconTextures?.values?.() || []) texture.dispose?.();
  panel?._ha3dQuestIconTextures?.clear?.();
}

function installRenderHook(panel) {
  const renderer = panel?._renderer;
  if (!renderer?.render || renderer.__ha3dQuestPolishV1) return;
  renderer.__ha3dQuestPolishV1 = true;
  const render = renderer.render.bind(renderer);
  renderer.render = (...args) => {
    if (panel._ha3dXRPresenting) {
      applyCompactIcons(panel);
      installSelectOverride(panel);
      updateMenuLayout(panel);
      updateMenuHover(panel);
    }
    return render(...args);
  };
}

if (!proto.__ha3dQuestPolishV1) {
  proto.__ha3dQuestPolishV1 = true;

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
      if (!wasPresenting) prepareXRPerformance(this);
      const result = await originalToggle.apply(this, args);
      if (!wasPresenting && this._ha3dXRPresenting) {
        installRenderHook(this);
        installSelectOverride(this);
        enterXRPerformance(this);
        applyCompactIcons(this);
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
