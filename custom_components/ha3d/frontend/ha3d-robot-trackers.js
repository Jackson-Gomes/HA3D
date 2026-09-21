/*
 * HA3D robot trackers. Independent Three.js implementation.
 * UX ideas: Easy Floorplan (MIT) and Home Assistant 3D Floorplan Extended
 * (ISC). No source code or assets from either project are included.
 */
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
// Keep robot meshes in the same Three.js universe as the viewer. Importing a
// second ESM copy looks identical, but Three rejects its Object3D instances.
const THREE = Panel.HA3D_THREE;
if (!THREE) throw new Error("HA3D Three.js runtime was not registered");
const proto = Panel.prototype;

const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
const id = () => `robot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const offline = (state) => !state || ["unknown", "unavailable"].includes(state.state);

function getPosition(hass, entityId) {
  const state = hass?.states?.[entityId];
  if (offline(state)) return null;
  let source = state.attributes || {};
  if (![source.x, source.y, source.a].some((value) => value !== undefined)) {
    try { source = { ...source, ...JSON.parse(state.state) }; } catch (_error) { /* attributes are the normal source */ }
  }
  const embedded = source.vacuum_position || source.position;
  if (embedded && typeof embedded === "object") source = { ...source, ...embedded };
  const x = Number(source.x); const y = Number(source.y); const heading = Number(source.a ?? source.heading ?? source.angle);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, heading: Number.isFinite(heading) ? heading : 0, changed: state.last_updated || state.last_changed } : null;
}

function normalized(point, calibration) {
  let x = point.x; let y = point.y;
  if (calibration.swap_xy) [x, y] = [y, x];
  if (calibration.invert_x) x = -x;
  if (calibration.invert_y) y = -y;
  return { x, y };
}

function transformFor(calibration) {
  const aRaw = calibration.raw_a; const aModel = calibration.model_a;
  const bRaw = calibration.raw_b; const bModel = calibration.model_b;
  if (!aRaw || !aModel || !bRaw || !bModel) return null;
  const a = normalized({ x: aRaw[0], y: aRaw[1] }, calibration);
  const b = normalized({ x: bRaw[0], y: bRaw[1] }, calibration);
  const dx = b.x - a.x; const dy = b.y - a.y;
  const mx = bModel[0] - aModel[0]; const mz = bModel[1] - aModel[1];
  const rawLength = Math.hypot(dx, dy); const modelLength = Math.hypot(mx, mz);
  if (rawLength < 0.00001 || modelLength < 0.00001) return null;
  const scale = modelLength / rawLength;
  const rotation = Math.atan2(mz, mx) - Math.atan2(dy, dx);
  const cos = Math.cos(rotation) * scale; const sin = Math.sin(rotation) * scale;
  return { cos, sin, tx: aModel[0] - (cos * a.x - sin * a.y), tz: aModel[1] - (sin * a.x + cos * a.y) };
}

function mapPosition(position, calibration) {
  const transform = transformFor(calibration);
  if (!transform) return null;
  const point = normalized(position, calibration);
  return new THREE.Vector3(transform.cos * point.x - transform.sin * point.y + transform.tx, 0, transform.sin * point.x + transform.cos * point.y + transform.tz);
}

function mapHeading(degrees, calibration) {
  let x = Math.cos(THREE.MathUtils.degToRad(degrees)); let y = Math.sin(THREE.MathUtils.degToRad(degrees));
  if (calibration.swap_xy) [x, y] = [y, x];
  if (calibration.invert_x) x = -x;
  if (calibration.invert_y) y = -y;
  const transform = transformFor(calibration);
  if (!transform) return 0;
  return Math.atan2(transform.sin * x + transform.cos * y, transform.cos * x - transform.sin * y) + THREE.MathUtils.degToRad(number(calibration.heading_offset));
}

function makeIcon(name) {
  const root = new THREE.Group(); root.name = `HA3D_Robot_${name}`;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.10, 28), new THREE.MeshStandardMaterial({ color: 0x4fc3f7, metalness: 0.25, roughness: 0.32 }));
  body.castShadow = true; body.position.y = 0.06; root.add(body);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 4), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x174c62, emissiveIntensity: 0.35 }));
  arrow.rotation.x = Math.PI / 2; arrow.position.set(0, 0.08, -0.16); root.add(arrow);
  root.userData.ha3dRobotIcon = true;
  return root;
}

function findObject(model, name) {
  let result;
  model?.traverse((item) => { if (!result && (item.name === name || item.userData?.ha3dOriginalNodeName === name)) result = item; });
  return result;
}

if (!proto.__ha3dRobotTrackersV1) {
  proto.__ha3dRobotTrackersV1 = true;

  const shell = proto._renderShell;
  proto._renderShell = function (...args) {
    shell.apply(this, args);
    const style = document.createElement("style");
    style.textContent = `#robotsButton.active{background:#176b44}#ha3dRobots{display:none;position:absolute;z-index:41;top:68px;right:12px;width:min(400px,calc(100vw - 24px));max-height:calc(100vh - 86px);overflow:auto;padding:14px;border-radius:16px}#ha3dRobots.open{display:block}.ha3dRobotRow{border-top:1px solid #ffffff1b;padding:11px 0}.ha3dRobotRow:first-child{border-top:0}.ha3dRobotRow strong{font-size:13px}.ha3dRobotMeta{font-size:11px;opacity:.68;margin:4px 0 8px}.ha3dRobotGrid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ha3dRobotGrid label{font-size:11px;opacity:.8}.ha3dRobotGrid input,.ha3dRobotGrid select{box-sizing:border-box;width:100%;margin-top:4px;padding:7px;border-radius:8px;border:1px solid #ffffff2b;background:#111;color:inherit;font:inherit}.ha3dRobotActions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.ha3dRobotActions button{padding:7px 9px;font-size:11px}.ha3dRobotHint{font-size:11px;opacity:.68;line-height:1.35;margin:6px 0 10px}.ha3dRobotStatus{font-size:11px;color:#8bd7ff;margin-top:6px}`;
    this.shadowRoot.append(style);
    const button = document.createElement("button"); button.id = "robotsButton"; button.className = "secondary"; button.type = "button"; button.textContent = "Robôs";
    button.addEventListener("click", () => { const panel = this.shadowRoot.querySelector("#ha3dRobots"); panel.classList.toggle("open"); button.classList.toggle("active", panel.classList.contains("open")); this._renderRobotsPanel(); });
    this.shadowRoot.querySelector("#actions").prepend(button);
    const panel = document.createElement("section"); panel.id = "ha3dRobots"; panel.className = "glass"; this.shadowRoot.querySelector("#root").append(panel);
  };

  const loadModel = proto._loadModel;
  proto._loadModel = async function (...args) { const result = await loadModel.apply(this, args); this._rebuildRobots(); return result; };
  const loadConfig = proto._loadConfig;
  proto._loadConfig = async function (...args) { const result = await loadConfig.apply(this, args); this._rebuildRobots(); return result; };
  const update = proto._updateLightMarkers;
  proto._updateLightMarkers = function (...args) { update.apply(this, args); this._updateRobots(); };

  proto._robotObjects = function () { return this._robotEntries || new Map(); };
  proto._rebuildRobots = function () {
    if (!this._scene) return;
    for (const entry of this._robotObjects().values()) {
      if (entry.icon?.parent) entry.icon.parent.remove(entry.icon);
      if (entry.object && entry.base) { entry.object.position.copy(entry.base.position); entry.object.rotation.copy(entry.base.rotation); }
    }
    this._robotEntries = new Map();
    for (const config of this._config?.robots || []) {
      const entry = { config, target: new THREE.Vector3(), lastFrame: performance.now(), lastReceived: 0 };
      if (config.display === "object" && config.object_name) {
        entry.object = findObject(this._model, config.object_name);
        if (entry.object) entry.base = { position: entry.object.position.clone(), rotation: entry.object.rotation.clone() };
      }
      if (!entry.object) { entry.icon = makeIcon(config.name || config.id); this._scene.add(entry.icon); }
      this._robotEntries.set(config.id, entry);
    }
    this._updateRobots(true);
  };

  proto._updateRobots = function (snap = false) {
    const now = performance.now();
    for (const entry of this._robotObjects().values()) {
      const { config } = entry; const position = getPosition(this._hass, config.position_entity); const vacuum = this._hass?.states?.[config.vacuum_entity];
      const root = entry.object || entry.icon; if (!root) continue;
      const visibleStates = config.visible_states || ["cleaning", "returning", "docked", "paused"];
      const available = !offline(vacuum) && Boolean(position) && visibleStates.includes(vacuum.state);
      const mapped = position && mapPosition(position, config.calibration || {});
      if (mapped) {
        entry.target.copy(mapped); entry.target.y = number(config.floor_y);
        if (!entry.lastReceived || entry.lastStamp !== position.changed) { entry.lastStamp = position.changed; entry.lastReceived = now; }
        entry.heading = mapHeading(position.heading, config.calibration || {});
      }
      const stale = now - entry.lastReceived > number(config.stale_after_s, 45) * 1000;
      root.visible = available && !stale && Boolean(mapped || entry.lastReceived);
      if (!root.visible || !entry.lastReceived) continue;
      const dt = Math.min(0.1, Math.max(0.001, (now - entry.lastFrame) / 1000)); entry.lastFrame = now;
      const alpha = snap ? 1 : 1 - Math.exp(-dt / Math.max(0.08, number(config.smoothing_ms, 1600) / 1000));
      if (entry.icon) { entry.icon.position.lerp(entry.target, alpha); entry.icon.rotation.y = THREE.MathUtils.lerp(entry.icon.rotation.y, entry.heading, alpha); }
      else {
        // A GLB object is normally nested below the model root; positions from
        // calibration are world-space, so convert them back into its parent.
        const localTarget = root.parent ? root.parent.worldToLocal(entry.target.clone()) : entry.target;
        root.position.lerp(localTarget, alpha); root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, entry.heading, alpha);
      }
      const status = this.shadowRoot?.querySelector(`[data-robot-id="${CSS.escape(config.id)}"] [data-status]`);
      if (status && position) status.textContent = `Ao vivo: X ${Math.round(position.x)} · Y ${Math.round(position.y)} · direção ${Math.round(position.heading)}°`;
    }
  };

  proto._robotChoices = function (selected = "") {
    return Object.entries(this._hass?.states || {}).sort(([a], [b]) => a.localeCompare(b)).map(([entity, state]) => `<option value="${esc(entity)}" ${entity === selected ? "selected" : ""}>${esc(state.attributes?.friendly_name || entity)} — ${esc(entity)}</option>`).join("");
  };
  proto._renderRobotsPanel = function () {
    const panel = this.shadowRoot.querySelector("#ha3dRobots"); if (!panel) return;
    const robots = this._config?.robots || [];
    panel.innerHTML = `<div class="ha3dEditorHead"><h3>Robôs</h3></div><p class="ha3dRobotHint">Escolha o aspirador e o sensor com posição. Para calibrar, coloque o robô em dois locais e mova os marcadores A e B com a tríade do Editor.</p><div class="ha3dRobotActions"><button id="ha3dAddRobot" type="button">Adicionar robô</button></div><div class="ha3dRobotStatus" id="ha3dRobotAddStatus"></div>${robots.map((robot) => this._robotRow(robot)).join("") || '<p class="ha3dRobotHint">Nenhum robô configurado.</p>'}`;
    panel.querySelector("#ha3dAddRobot").addEventListener("click", () => this._addRobot());
    robots.forEach((robot) => this._wireRobotRow(robot));
  };
  proto._robotRow = function (robot) {
    const c = robot.calibration || {}; const ready = transformFor(c);
    return `<div class="ha3dRobotRow" data-robot-id="${esc(robot.id)}"><strong>${esc(robot.name || "Robô")}</strong><div class="ha3dRobotMeta">${ready ? "Calibrado" : "Calibração pendente"} · ${esc(robot.position_entity)}</div><div class="ha3dRobotGrid"><label>Nome<input data-field="name" value="${esc(robot.name || "")}"></label><label>Representação<select data-field="display"><option value="icon" ${robot.display !== "object" ? "selected" : ""}>Ícone 3D</option><option value="object" ${robot.display === "object" ? "selected" : ""}>Objeto do GLB</option></select></label><label>Entidade do robô<select data-field="vacuum_entity">${this._robotChoices(robot.vacuum_entity)}</select></label><label>Sensor de posição<select data-field="position_entity">${this._robotChoices(robot.position_entity)}</select></label><label>Objeto GLB<input data-field="object_name" value="${esc(robot.object_name || "")}" placeholder="Nome do objeto"></label><label>Altura do piso Y<input data-field="floor_y" type="number" step="0.01" value="${number(robot.floor_y)}"></label><label>Suavização (ms)<input data-field="smoothing_ms" type="number" min="0" value="${number(robot.smoothing_ms, 1600)}"></label><label>Posição antiga (s)<input data-field="stale_after_s" type="number" min="5" value="${number(robot.stale_after_s, 45)}"></label><label><input data-field="swap_xy" type="checkbox" ${c.swap_xy ? "checked" : ""}> Trocar X/Y</label><label><input data-field="invert_x" type="checkbox" ${c.invert_x ? "checked" : ""}> Inverter X</label><label><input data-field="invert_y" type="checkbox" ${c.invert_y ? "checked" : ""}> Inverter Y</label><label>Correção de direção °<input data-field="heading_offset" type="number" value="${number(c.heading_offset)}"></label></div><div class="ha3dRobotActions"><button data-action="selected">Usar objeto selecionado</button><button data-action="start-a">Capturar A</button><button data-action="save-a">Salvar A</button><button data-action="start-b">Capturar B</button><button data-action="save-b">Salvar B</button><button data-action="save">Salvar robô</button><button data-action="delete" class="secondary">Excluir</button></div><div class="ha3dRobotStatus" data-status></div></div>`;
  };
  proto._addRobot = async function () {
    const status = this.shadowRoot?.querySelector("#ha3dRobotAddStatus");
    const button = this.shadowRoot?.querySelector("#ha3dAddRobot");
    if (button) button.disabled = true;
    if (status) status.textContent = "Criando robô…";
    const vacuum = Object.keys(this._hass?.states || {}).find((item) => item.startsWith("vacuum.")) || "vacuum.example";
    const position = Object.keys(this._hass?.states || {}).find((item) => item.includes("vacuum_position")) || "sensor.example_position";
    const robots = [...(this._config?.robots || []), { id: id(), name: "Novo robô", vacuum_entity: vacuum, position_entity: position, display: "icon", floor_y: 0, visible_states: ["cleaning", "returning", "docked", "paused"], smoothing_ms: 1600, stale_after_s: 45, calibration: { swap_xy: false, invert_x: false, invert_y: false, heading_offset: 0 } }];
    try {
      await this._saveConfigPatch({ robots });
      if (!this._config?.robots?.some((robot) => robot.id === robots.at(-1).id)) {
        throw new Error("O Home Assistant ainda não carregou o suporte a robôs. Reinicie o Home Assistant após atualizar o HA3D.");
      }
      this._rebuildRobots(); this._renderRobotsPanel();
    } catch (error) {
      if (status) status.textContent = `Não foi possível criar: ${error.message || error}`;
      if (button) button.disabled = false;
      console.error("HA3D: unable to add robot", error);
    }
  };
  proto._robotFromRow = function (robot, row) {
    const get = (name) => row.querySelector(`[data-field="${name}"]`); const c = { ...(robot.calibration || {}) };
    for (const key of ["swap_xy", "invert_x", "invert_y"]) c[key] = get(key).checked;
    c.heading_offset = number(get("heading_offset").value);
    return { ...robot, name: get("name").value.trim() || "Robô", display: get("display").value, vacuum_entity: get("vacuum_entity").value, position_entity: get("position_entity").value, object_name: get("object_name").value.trim(), floor_y: number(get("floor_y").value), smoothing_ms: clamp(number(get("smoothing_ms").value, 1600), 0, 60000), stale_after_s: clamp(number(get("stale_after_s").value, 45), 5, 3600), calibration: c };
  };
  proto._wireRobotRow = function (robot) {
    const row = this.shadowRoot.querySelector(`[data-robot-id="${CSS.escape(robot.id)}"]`); if (!row) return; const status = row.querySelector("[data-status]");
    const updateStatus = (text) => { status.textContent = text; };
    row.querySelector('[data-action="selected"]').addEventListener("click", () => { const selected = this._selectedObject; if (!selected) return updateStatus("Selecione um objeto do GLB no Editor primeiro."); row.querySelector('[data-field="object_name"]').value = selected.userData?.ha3dOriginalNodeName || selected.name; row.querySelector('[data-field="display"]').value = "object"; updateStatus("Objeto selecionado aplicado."); });
    for (const point of ["a", "b"]) {
      row.querySelector(`[data-action="start-${point}"]`).addEventListener("click", () => { const draft = this._robotFromRow(robot, row); this._robotStartPoint(draft, point, updateStatus); });
      row.querySelector(`[data-action="save-${point}"]`).addEventListener("click", () => this._robotSavePoint(robot.id, point, updateStatus));
    }
    row.querySelector('[data-action="save"]').addEventListener("click", async () => { const changed = this._robotFromRow(robot, row); const robots = (this._config.robots || []).map((item) => item.id === robot.id ? changed : item); try { await this._saveConfigPatch({ robots }); this._rebuildRobots(); this._renderRobotsPanel(); this._setStatus("Robô salvo"); } catch (error) { updateStatus(`Erro: ${error.message || error}`); } });
    row.querySelector('[data-action="delete"]').addEventListener("click", async () => { const robots = (this._config.robots || []).filter((item) => item.id !== robot.id); await this._saveConfigPatch({ robots }); this._rebuildRobots(); this._renderRobotsPanel(); });
  };
  proto._robotStartPoint = function (draft, point, status) {
    const raw = getPosition(this._hass, draft.position_entity); if (!raw) return status("O sensor não traz X/Y agora. Confira a entidade de posição.");
    if (this._robotCalibrationMarker?.parent) this._robotCalibrationMarker.parent.remove(this._robotCalibrationMarker);
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12), new THREE.MeshStandardMaterial({ color: point === "a" ? 0xffa726 : 0xab47bc, emissive: point === "a" ? 0x6a3100 : 0x3c104d, emissiveIntensity: 0.45 }));
    marker.name = `HA3D calibration ${point.toUpperCase()}`; marker.position.copy(this._selectedObject?.getWorldPosition?.(new THREE.Vector3()) || this._controls.target); marker.position.y = number(draft.floor_y); this._scene.add(marker);
    this._robotCalibrationMarker = marker; this._robotCalibration = { id: draft.id, point, raw: [raw.x, raw.y], draft }; this._transformControls?.attach(marker); this._transformControls.enabled = true; this._transformControls.visible = true; this._transformControls.setMode("translate");
    status(`Ponto ${point.toUpperCase()} capturado. Arraste a esfera ${point === "a" ? "laranja" : "roxa"} até o centro físico do robô e clique “Salvar ${point.toUpperCase()}”.`);
  };
  proto._robotSavePoint = async function (robotId, point, status) {
    const active = this._robotCalibration; if (!active || active.id !== robotId || active.point !== point || !this._robotCalibrationMarker) return status(`Clique “Capturar ${point.toUpperCase()}” antes.`);
    const robots = (this._config?.robots || []).map((robot) => { if (robot.id !== robotId) return robot; const calibration = { ...(robot.calibration || {}) }; calibration[`raw_${point}`] = active.raw; calibration[`model_${point}`] = [this._robotCalibrationMarker.position.x, this._robotCalibrationMarker.position.z]; return { ...this._robotFromRow(robot, this.shadowRoot.querySelector(`[data-robot-id="${CSS.escape(robotId)}"]`)), calibration }; });
    this._transformControls?.detach(); this._robotCalibrationMarker.parent?.remove(this._robotCalibrationMarker); this._robotCalibrationMarker = null; this._robotCalibration = null;
    try { await this._saveConfigPatch({ robots }); this._rebuildRobots(); this._renderRobotsPanel(); this._setStatus(`Ponto ${point.toUpperCase()} salvo`); } catch (error) { status(`Erro: ${error.message || error}`); }
  };
}
