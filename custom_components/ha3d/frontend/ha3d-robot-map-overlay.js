/*
 * Xiaomi Map Extractor overlay for HA3D robot tracking.
 * Test layer: keeps the existing robot calibration path intact and stores the
 * overlay transform locally in the browser while the feature is validated.
 */
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const THREE = Panel.HA3D_THREE;
if (!THREE) throw new Error("HA3D Three.js runtime was not registered");
const proto = Panel.prototype;

const MAP_ENTITY = "image.xiaomi_robot_vacuum_h50_live_map";
const STORAGE_KEY = "ha3d_xiaomi_map_overlay_v1";
const DEFAULTS = Object.freeze({ visible: false, x: 0, z: 0, y: 0.02, scale: 0.025, rotation: 0, opacity: 0.55 });
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function readAll() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch (_error) {
    return {};
  }
}

function settingsFor(robotId) {
  const all = readAll();
  return { ...DEFAULTS, ...(all[robotId] || {}) };
}

function saveSettings(robotId, value) {
  const all = readAll();
  all[robotId] = {
    visible: Boolean(value.visible),
    x: num(value.x), z: num(value.z), y: num(value.y, DEFAULTS.y),
    scale: clamp(num(value.scale, DEFAULTS.scale), 0.0001, 10),
    rotation: num(value.rotation),
    opacity: clamp(num(value.opacity, DEFAULTS.opacity), 0, 1),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return all[robotId];
}

function getPosition(hass, entityId) {
  const state = hass?.states?.[entityId];
  if (!state || ["unknown", "unavailable"].includes(state.state)) return null;
  let source = state.attributes || {};
  if (![source.x, source.y, source.a].some((value) => value !== undefined)) {
    try { source = { ...source, ...JSON.parse(state.state) }; } catch (_error) { /* normal */ }
  }
  const embedded = source.vacuum_position || source.position;
  if (embedded && typeof embedded === "object") source = { ...source, ...embedded };
  const x = Number(source.x); const y = Number(source.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function mapCalibration(hass) {
  const state = hass?.states?.[MAP_ENTITY];
  const points = state?.attributes?.calibration_points;
  if (!Array.isArray(points) || points.length < 3) return null;
  const p = points.slice(0, 3).map((point) => ({
    x: Number(point?.vacuum?.x), y: Number(point?.vacuum?.y),
    u: Number(point?.map?.x), v: Number(point?.map?.y),
  }));
  if (p.some((item) => ![item.x, item.y, item.u, item.v].every(Number.isFinite))) return null;

  const [a, b, c] = p;
  const det = a.x * (b.y - c.y) - a.y * (b.x - c.x) + (b.x * c.y - b.y * c.x);
  if (Math.abs(det) < 1e-9) return null;
  const solve = (qa, qb, qc) => {
    const A = (qa * (b.y - c.y) - a.y * (qb - qc) + (qb * c.y - b.y * qc)) / det;
    const B = (a.x * (qb - qc) - qa * (b.x - c.x) + (b.x * qc - qb * c.x)) / det;
    const C = (a.x * (b.y * qc - qb * c.y) - a.y * (b.x * qc - qb * c.x) + qa * (b.x * c.y - b.y * c.x)) / det;
    return [A, B, C];
  };
  const [ux, uy, ut] = solve(a.u, b.u, c.u);
  const [vx, vy, vt] = solve(a.v, b.v, c.v);
  return { ux, uy, ut, vx, vy, vt };
}

function floorVector(u, v, height, plane = "xz") {
  if (plane === "xy") return new THREE.Vector3(u, v, height);
  if (plane === "yz") return new THREE.Vector3(height, u, v);
  return new THREE.Vector3(u, height, v);
}

function pixelToFloor(position, calibration, settings, imageSize) {
  if (!position || !calibration || !imageSize?.width || !imageSize?.height) return null;
  const px = calibration.ux * position.x + calibration.uy * position.y + calibration.ut;
  const py = calibration.vx * position.x + calibration.vy * position.y + calibration.vt;
  const scale = num(settings.scale, DEFAULTS.scale);
  const u = (px - imageSize.width / 2) * scale;
  const v = (py - imageSize.height / 2) * scale;
  const r = THREE.MathUtils.degToRad(num(settings.rotation));
  const cos = Math.cos(r); const sin = Math.sin(r);
  return { x: num(settings.x) + u * cos - v * sin, z: num(settings.z) + u * sin + v * cos };
}

function disposeMap(entry) {
  const mesh = entry?.ha3dMapOverlay;
  if (!mesh) return;
  mesh.parent?.remove(mesh);
  mesh.geometry?.dispose?.();
  mesh.material?.map?.dispose?.();
  mesh.material?.dispose?.();
  entry.ha3dMapOverlay = null;
  entry.ha3dMapUrl = null;
  entry.ha3dMapSize = null;
}

function applyPlane(mesh, settings, size, plane = "xz") {
  const scale = num(settings.scale, DEFAULTS.scale);
  mesh.scale.set(size.width * scale, size.height * scale, 1);
  mesh.position.copy(floorVector(num(settings.x), num(settings.z), num(settings.y, DEFAULTS.y), plane));
  mesh.rotation.set(0, 0, 0);
  const angle = THREE.MathUtils.degToRad(num(settings.rotation));
  if (plane === "xz") { mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = angle; }
  else if (plane === "xy") mesh.rotation.z = angle;
  else { mesh.rotation.y = Math.PI / 2; mesh.rotation.z = angle; }
  mesh.material.opacity = clamp(num(settings.opacity, DEFAULTS.opacity), 0, 1);
  mesh.visible = Boolean(settings.visible);
}

function statusText(panel, entry) {
  const mapState = panel._hass?.states?.[MAP_ENTITY];
  if (!mapState) return "Mapa Xiaomi não encontrado no Home Assistant.";
  if (!mapState.attributes?.entity_picture) return "Mapa encontrado, mas sem entity_picture.";
  if (!mapCalibration(panel._hass)) return "Mapa encontrado, mas calibration_points não estão disponíveis.";
  if (!entry?.ha3dMapSize) return "Carregando imagem do mapa…";
  return `Mapa pronto · ${entry.ha3dMapSize.width}×${entry.ha3dMapSize.height}px · ajuste até coincidir com o piso.`;
}

function ensureMap(panel, entry) {
  if (!entry) return;
  const settings = settingsFor(entry.config.id);
  const state = panel._hass?.states?.[MAP_ENTITY];
  const picture = state?.attributes?.entity_picture;
  if (!settings.visible || !picture || !panel._scene) {
    if (entry.ha3dMapOverlay) entry.ha3dMapOverlay.visible = false;
    return;
  }

  if (entry.ha3dMapOverlay && entry.ha3dMapUrl === picture) {
    applyPlane(entry.ha3dMapOverlay, settings, entry.ha3dMapSize || { width: 1, height: 1 }, entry.config.floor_plane || "xz");
    return;
  }

  disposeMap(entry);
  entry.ha3dMapUrl = picture;
  const loader = new THREE.TextureLoader();
  loader.load(picture, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    const image = texture.image || {};
    entry.ha3dMapSize = { width: image.naturalWidth || image.width || 1, height: image.naturalHeight || image.height || 1 };
    const material = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, opacity: settings.opacity,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.name = "HA3D_Xiaomi_H50_Map_Overlay";
    mesh.renderOrder = 8000;
    mesh.userData.ha3dRobotMapOverlay = true;
    mesh.raycast = () => {};
    entry.ha3dMapOverlay = mesh;
    panel._scene.add(mesh);
    applyPlane(mesh, settingsFor(entry.config.id), entry.ha3dMapSize, entry.config.floor_plane || "xz");
    updateRobotFromMap(panel, entry, true);
    refreshStatus(panel, entry.config.id);
  }, undefined, (error) => {
    console.warn("HA3D: unable to load Xiaomi map overlay", error);
    refreshStatus(panel, entry.config.id, "Falha ao carregar a imagem do mapa.");
  });
}

function updateRobotFromMap(panel, entry, snap = false) {
  if (!entry) return;
  const settings = settingsFor(entry.config.id);
  if (!settings.visible || !entry.ha3dMapSize) return;
  const calibration = mapCalibration(panel._hass);
  const position = getPosition(panel._hass, entry.config.position_entity);
  const mapped = pixelToFloor(position, calibration, settings, entry.ha3dMapSize);
  const root = entry.object || entry.icon;
  if (!root || !mapped) return;

  const vacuum = panel._hass?.states?.[entry.config.vacuum_entity];
  const visibleStates = entry.config.visible_states || ["cleaning", "returning", "docked", "paused", "idle"];
  const available = vacuum && !["unknown", "unavailable"].includes(vacuum.state) && visibleStates.includes(vacuum.state);
  root.visible = Boolean(available);
  if (!available) return;

  const target = floorVector(mapped.x, mapped.z, num(entry.config.floor_y), entry.config.floor_plane || "xz");
  entry.target?.copy?.(target);
  if (entry.icon) {
    if (snap || !entry.icon.position.lengthSq()) entry.icon.position.copy(target);
    else entry.icon.position.lerp(target, 0.22);
  } else if (entry.object) {
    const local = entry.object.parent ? entry.object.parent.worldToLocal(target.clone()) : target;
    if (snap) entry.object.position.copy(local); else entry.object.position.lerp(local, 0.22);
  }
}

function refreshStatus(panel, robotId, forced = "") {
  const row = panel.shadowRoot?.querySelector(`[data-robot-id="${CSS.escape(robotId)}"]`);
  const output = row?.querySelector("[data-map-status]");
  const entry = panel._robotEntries?.get(robotId);
  if (output) output.textContent = forced || statusText(panel, entry);
}

function modelRange(panel, axis) {
  if (!panel._model) return [-25, 25];
  const box = new THREE.Box3().setFromObject(panel._model);
  if (box.isEmpty()) return [-25, 25];
  const min = axis === "x" ? box.min.x : box.min.z;
  const max = axis === "x" ? box.max.x : box.max.z;
  const span = Math.max(2, max - min);
  return [min - span * 0.6, max + span * 0.6];
}

function control(label, key, value, min, max, step) {
  return `<label class="ha3dMapControl"><span>${label}</span><input type="range" data-map-range="${key}" min="${min}" max="${max}" step="${step}" value="${value}"><input type="number" data-map-value="${key}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function installUi(panel) {
  if (!panel.shadowRoot) return;
  if (!panel.shadowRoot.querySelector("#ha3dMapOverlayStyle")) {
    const style = document.createElement("style");
    style.id = "ha3dMapOverlayStyle";
    style.textContent = `
      .ha3dMapOverlayBox{margin-top:10px;padding:10px;border:1px solid #58b9e055;border-radius:10px;background:#0a222c}
      .ha3dMapOverlayBox summary{cursor:pointer;font-size:12px;font-weight:700}
      .ha3dMapToggle{display:flex;align-items:center;gap:7px;margin:9px 0;font-size:12px}
      .ha3dMapControl{display:grid;grid-template-columns:64px 1fr 76px;gap:7px;align-items:center;margin:6px 0;font-size:11px}
      .ha3dMapControl input[type=range]{width:100%;margin:0;padding:0}
      .ha3dMapControl input[type=number]{width:76px!important;margin:0!important;padding:5px!important}
      .ha3dMapStatus{font-size:10px;opacity:.72;line-height:1.3;margin-top:7px}
      .ha3dMapActions{display:flex;gap:7px;margin-top:8px}.ha3dMapActions button{padding:6px 8px;font-size:11px}
    `;
    panel.shadowRoot.appendChild(style);
  }

  for (const [robotId, entry] of panel._robotEntries?.entries?.() || []) {
    const row = panel.shadowRoot.querySelector(`[data-robot-id="${CSS.escape(robotId)}"]`);
    if (!row || row.querySelector("[data-map-overlay-box]")) continue;
    const settings = settingsFor(robotId);
    const [minX, maxX] = modelRange(panel, "x");
    const [minZ, maxZ] = modelRange(panel, "z");
    const box = document.createElement("details");
    box.className = "ha3dMapOverlayBox";
    box.dataset.mapOverlayBox = "";
    box.open = true;
    box.innerHTML = `
      <summary>Mapa Xiaomi / Map Extractor</summary>
      <label class="ha3dMapToggle"><input type="checkbox" data-map-visible ${settings.visible ? "checked" : ""}> Mostrar mapa no piso e usar para posição do robô</label>
      ${control("X", "x", settings.x, minX, maxX, 0.02)}
      ${control("Z", "z", settings.z, minZ, maxZ, 0.02)}
      ${control("Altura", "y", settings.y, -2, 5, 0.01)}
      ${control("Escala", "scale", settings.scale, 0.001, 0.12, 0.001)}
      ${control("Rotação", "rotation", settings.rotation, -180, 180, 1)}
      ${control("Opacidade", "opacity", settings.opacity, 0, 1, 0.05)}
      <div class="ha3dMapActions"><button type="button" data-map-reset class="secondary">Resetar ajuste</button></div>
      <div class="ha3dMapStatus" data-map-status></div>`;

    const live = row.querySelector("[data-live]");
    if (live) row.insertBefore(box, live); else row.appendChild(box);

    const commit = (key, raw) => {
      const current = settingsFor(robotId);
      current[key] = key === "visible" ? Boolean(raw) : num(raw, current[key]);
      const saved = saveSettings(robotId, current);
      const range = box.querySelector(`[data-map-range="${key}"]`);
      const value = box.querySelector(`[data-map-value="${key}"]`);
      if (range && range.value !== String(saved[key])) range.value = String(saved[key]);
      if (value && value.value !== String(saved[key])) value.value = String(saved[key]);
      ensureMap(panel, entry);
      if (entry.ha3dMapOverlay && entry.ha3dMapSize) applyPlane(entry.ha3dMapOverlay, saved, entry.ha3dMapSize, entry.config.floor_plane || "xz");
      updateRobotFromMap(panel, entry, true);
      refreshStatus(panel, robotId);
    };

    box.querySelector("[data-map-visible]").addEventListener("change", (event) => commit("visible", event.target.checked));
    for (const key of ["x", "z", "y", "scale", "rotation", "opacity"]) {
      box.querySelector(`[data-map-range="${key}"]`).addEventListener("input", (event) => commit(key, event.target.value));
      box.querySelector(`[data-map-value="${key}"]`).addEventListener("input", (event) => commit(key, event.target.value));
    }
    box.querySelector("[data-map-reset]").addEventListener("click", () => {
      saveSettings(robotId, DEFAULTS);
      box.remove();
      if (entry.ha3dMapOverlay) entry.ha3dMapOverlay.visible = false;
      installUi(panel);
      refreshStatus(panel, robotId);
    });
    ensureMap(panel, entry);
    refreshStatus(panel, robotId);
  }
}

if (!proto.__ha3dRobotMapOverlayV1) {
  proto.__ha3dRobotMapOverlayV1 = true;

  const originalRender = proto._renderRobotsPanel;
  proto._renderRobotsPanel = function (...args) {
    const result = originalRender?.apply(this, args);
    queueMicrotask(() => installUi(this));
    return result;
  };

  const originalRebuild = proto._rebuildRobots;
  proto._rebuildRobots = function (...args) {
    for (const entry of this._robotEntries?.values?.() || []) disposeMap(entry);
    const result = originalRebuild?.apply(this, args);
    queueMicrotask(() => {
      for (const entry of this._robotEntries?.values?.() || []) ensureMap(this, entry);
      installUi(this);
    });
    return result;
  };

  const originalUpdate = proto._updateRobots;
  proto._updateRobots = function (...args) {
    const result = originalUpdate?.apply(this, args);
    const snap = Boolean(args[0]);
    for (const entry of this._robotEntries?.values?.() || []) {
      ensureMap(this, entry);
      updateRobotFromMap(this, entry, snap);
    }
    return result;
  };

  queueMicrotask(() => {
    const walk = (root) => {
      for (const element of root?.querySelectorAll?.("*") || []) {
        if (element.localName === "ha3d-panel") { installUi(element); element._rebuildRobots?.(); }
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    walk(document);
  });
}
