// Compact vacuum controls anchored to the HA3D vacuum marker.
// Mirrors the proven Kindle dashboard workflow without changing robot tracking/rendering.
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

const ROBOT_ENTITY = "vacuum.xiaomi_us_1213069013_ov43gb";
const STATUS = {
  battery: "sensor.xiaomi_us_1213069013_ov43gb_battery_level_p_3_1",
  activity: "sensor.xiaomi_us_1213069013_ov43gb_sweep_mop_status_p_2_96",
  charging: "sensor.xiaomi_us_1213069013_ov43gb_charging_state_p_3_2",
  room: "sensor.xiaomi_robot_vacuum_h50_vacuum_room_name",
};

const ROOMS = [
  { entity: "switch.robo_sala_aspirar", label: "Sala", icon: "mdi:sofa-outline" },
  { entity: "switch.robo_quarto_aspirar", label: "Quarto", icon: "mdi:bed-outline" },
  { entity: "switch.robo_escritorio_aspirar", label: "Escritório", icon: "mdi:desk" },
  { entity: "switch.robo_quarto_crianca_aspirar", label: "Quarto criança", icon: "mdi:teddy-bear" },
  { entity: "switch.robo_cozinha_aspirar", label: "Cozinha", icon: "mdi:countertop-outline" },
  { entity: "switch.robo_corredor_aspirar", label: "Corredor", icon: "mdi:door-open" },
  { entity: "switch.robo_banheiro_joca_aspirar", label: "Banheiro Joca", icon: "mdi:shower" },
  { entity: "switch.robo_sacada_aspirar", label: "Sacada", icon: "mdi:balcony" },
  { entity: "switch.robo_banheiro_1_aspirar", label: "Banheiro 1", icon: "mdi:shower-head" },
];

function isVacuum(entity) {
  return String(entity || "").startsWith("vacuum.");
}

function prettyState(value) {
  const state = String(value ?? "").trim();
  const labels = {
    on: "Ligado",
    off: "Desligado",
    unavailable: "Indisponível",
    unknown: "Desconhecido",
    idle: "Parado",
    docked: "Na base",
    cleaning: "Limpando",
    returning: "Voltando",
    paused: "Pausado",
    charging: "Carregando",
  };
  return labels[state.toLowerCase()] || state || "—";
}

function state(panel, entity) {
  return panel?._hass?.states?.[entity] || null;
}

function stateText(panel, entity) {
  return prettyState(state(panel, entity)?.state);
}

function icon(name, size = 19) {
  const el = document.createElement("ha-icon");
  el.setAttribute("icon", name);
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.setProperty("--mdc-icon-size", `${size}px`);
  el.style.pointerEvents = "none";
  return el;
}

function ensureStyle(panel) {
  if (!panel?.shadowRoot || panel.shadowRoot.querySelector("#ha3dRobotControlStyle")) return;
  const style = document.createElement("style");
  style.id = "ha3dRobotControlStyle";
  style.textContent = `
    #ha3dRobotControl{
      position:absolute;
      z-index:48;
      display:none;
      width:min(430px,calc(100vw - 24px));
      max-height:min(72vh,650px);
      overflow:auto;
      padding:10px;
      border-radius:17px;
      background:color-mix(in srgb,var(--card-background-color,#15171d) 94%,transparent);
      border:1px solid rgba(255,255,255,.15);
      box-shadow:0 14px 42px rgba(0,0,0,.42);
      backdrop-filter:blur(18px);
      -webkit-backdrop-filter:blur(18px);
      pointer-events:auto;
      overscroll-behavior:contain;
    }
    #ha3dRobotControl.open{display:block}
    .ha3dRobotHead{display:flex;align-items:center;gap:9px;padding:1px 2px 8px}
    .ha3dRobotHeadIcon{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(255,255,255,.08)}
    .ha3dRobotHeadText{min-width:0;flex:1}
    .ha3dRobotTitle{font-size:14px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ha3dRobotSub{font-size:10px;opacity:.63;margin-top:2px}
    .ha3dRobotClose{width:32px;height:32px;min-height:32px;padding:0;border-radius:10px;background:#24262c}
    .ha3dRobotSection{padding-top:9px;margin-top:2px;border-top:1px solid rgba(255,255,255,.10)}
    .ha3dRobotSectionTitle{font-size:11px;font-weight:750;opacity:.72;margin:0 2px 7px;text-transform:uppercase;letter-spacing:.04em}
    .ha3dRobotStatusGrid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px}
    .ha3dRobotStatus{min-width:0;padding:7px 5px;border-radius:10px;background:#22252b;border:1px solid rgba(255,255,255,.08);text-align:center}
    .ha3dRobotStatus ha-icon{opacity:.78}
    .ha3dRobotStatusLabel{font-size:9px;opacity:.58;margin-top:3px}
    .ha3dRobotStatusValue{font-size:10px;font-weight:700;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ha3dRobotRooms{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
    .ha3dRobotRoom{
      position:relative;min-height:58px;padding:7px 5px;border-radius:11px;background:#24262c;
      border:1px solid rgba(255,255,255,.10);display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:3px;font-size:10px;font-weight:650;text-align:center;
    }
    .ha3dRobotRoom.selected{
      background:color-mix(in srgb,var(--primary-color,#03a9f4) 25%,#24262c);
      border-color:color-mix(in srgb,var(--primary-color,#03a9f4) 72%,transparent);
    }
    .ha3dRobotRoomCheck{display:none;position:absolute;right:5px;top:3px;font-size:11px;font-weight:900}
    .ha3dRobotRoom.selected .ha3dRobotRoomCheck{display:block}
    .ha3dRobotActions{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .ha3dRobotAction{min-height:39px;padding:8px;border-radius:11px;background:#24262c;display:flex;align-items:center;justify-content:center;gap:7px;font-size:11px}
    .ha3dRobotAction.primary{background:color-mix(in srgb,var(--primary-color,#03a9f4) 72%,#18202a)}
    .ha3dRobotAction.danger{background:#332727}
    @media(max-width:600px){
      #ha3dRobotControl{width:min(390px,calc(100vw - 16px));padding:8px;max-height:76vh}
      .ha3dRobotStatusGrid{grid-template-columns:repeat(3,minmax(0,1fr))}
      .ha3dRobotRooms{grid-template-columns:repeat(3,minmax(0,1fr))}
    }
  `;
  panel.shadowRoot.appendChild(style);
}

function ensureMenu(panel) {
  const root = panel?.shadowRoot?.querySelector("#root");
  if (!root) return null;
  ensureStyle(panel);

  let menu = panel.shadowRoot.querySelector("#ha3dRobotControl");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "ha3dRobotControl";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Controle do aspirador robô");
  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  menu.addEventListener("click", (event) => event.stopPropagation());
  root.appendChild(menu);

  if (!root.__ha3dRobotControlOutsideBound) {
    root.__ha3dRobotControlOutsideBound = true;
    root.addEventListener("pointerdown", (event) => {
      const open = panel.shadowRoot?.querySelector("#ha3dRobotControl.open");
      if (!open || open.contains(event.target)) return;
      open.classList.remove("open");
      panel._ha3dRobotControlBinding = null;
    });
  }
  return menu;
}

function positionMenu(panel) {
  const menu = panel?.shadowRoot?.querySelector("#ha3dRobotControl.open");
  const marker = panel?._ha3dRobotControlBinding?.marker;
  const root = panel?.shadowRoot?.querySelector("#root");
  if (!menu || !marker || !root) return;

  const rr = root.getBoundingClientRect();
  const mr = marker.getBoundingClientRect();
  const pr = menu.getBoundingClientRect();
  const margin = 10;

  let left = mr.left - rr.left + mr.width / 2 - pr.width / 2;
  left = Math.max(margin, Math.min(left, rr.width - pr.width - margin));

  let top = mr.top - rr.top - pr.height - 10;
  if (top < margin) top = mr.bottom - rr.top + 10;
  top = Math.max(margin, Math.min(top, rr.height - pr.height - margin));

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

async function call(panel, domain, service, target) {
  if (!panel?._hass?.callService) throw new Error("Home Assistant indisponível");
  return panel._hass.callService(domain, service, {}, target);
}

function addStatusCard(host, mdi, label, value) {
  const card = document.createElement("div");
  card.className = "ha3dRobotStatus";
  card.appendChild(icon(mdi, 18));

  const name = document.createElement("div");
  name.className = "ha3dRobotStatusLabel";
  name.textContent = label;

  const stateValue = document.createElement("div");
  stateValue.className = "ha3dRobotStatusValue";
  stateValue.textContent = value;
  stateValue.title = value;

  card.append(name, stateValue);
  host.appendChild(card);
}

function refreshMenu(panel) {
  const menu = panel?.shadowRoot?.querySelector("#ha3dRobotControl.open");
  const binding = panel?._ha3dRobotControlBinding;
  if (!menu || !binding) return;

  const entity = binding.entity || ROBOT_ENTITY;
  const robot = state(panel, entity) || state(panel, ROBOT_ENTITY);
  const title = robot?.attributes?.friendly_name || binding.name || "Aspirador robô";

  menu.replaceChildren();

  const head = document.createElement("div");
  head.className = "ha3dRobotHead";
  const headIcon = document.createElement("div");
  headIcon.className = "ha3dRobotHeadIcon";
  headIcon.appendChild(icon("mdi:robot-vacuum", 23));

  const headText = document.createElement("div");
  headText.className = "ha3dRobotHeadText";
  const titleNode = document.createElement("div");
  titleNode.className = "ha3dRobotTitle";
  titleNode.textContent = title;
  const sub = document.createElement("div");
  sub.className = "ha3dRobotSub";
  sub.textContent = "Controle rápido · HA3D";
  headText.append(titleNode, sub);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "ha3dRobotClose";
  close.title = "Fechar";
  close.appendChild(icon("mdi:close", 18));
  close.addEventListener("click", () => {
    menu.classList.remove("open");
    panel._ha3dRobotControlBinding = null;
  });
  head.append(headIcon, headText, close);
  menu.appendChild(head);

  const statusSection = document.createElement("div");
  statusSection.className = "ha3dRobotSection";
  const statusTitle = document.createElement("div");
  statusTitle.className = "ha3dRobotSectionTitle";
  statusTitle.textContent = "Status";
  const statusGrid = document.createElement("div");
  statusGrid.className = "ha3dRobotStatusGrid";
  addStatusCard(statusGrid, "mdi:robot-vacuum", "Estado", prettyState(robot?.state));

  const batteryRaw = state(panel, STATUS.battery)?.state;
  const batteryValue = batteryRaw && !["unknown","unavailable"].includes(batteryRaw) ? `${batteryRaw}%` : prettyState(batteryRaw);
  addStatusCard(statusGrid, "mdi:battery", "Bateria", batteryValue);
  addStatusCard(statusGrid, "mdi:robot-vacuum-variant", "Atividade", stateText(panel, STATUS.activity));
  addStatusCard(statusGrid, "mdi:battery-charging", "Carga", stateText(panel, STATUS.charging));
  addStatusCard(statusGrid, "mdi:map-marker", "Cômodo", stateText(panel, STATUS.room));
  statusSection.append(statusTitle, statusGrid);
  menu.appendChild(statusSection);

  const roomsSection = document.createElement("div");
  roomsSection.className = "ha3dRobotSection";
  const roomsTitle = document.createElement("div");
  roomsTitle.className = "ha3dRobotSectionTitle";
  roomsTitle.textContent = "Selecione os cômodos";
  const roomsGrid = document.createElement("div");
  roomsGrid.className = "ha3dRobotRooms";

  for (const room of ROOMS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ha3dRobotRoom";
    const selected = state(panel, room.entity)?.state === "on";
    button.classList.toggle("selected", selected);
    button.title = room.entity;

    const check = document.createElement("span");
    check.className = "ha3dRobotRoomCheck";
    check.textContent = "✓";
    button.append(check, icon(room.icon, 20));
    const label = document.createElement("span");
    label.textContent = room.label;
    button.appendChild(label);

    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await call(panel, "switch", "toggle", { entity_id: room.entity });
      } catch (error) {
        console.error("[HA3D] robot room toggle failed", room.entity, error);
      } finally {
        button.disabled = false;
        setTimeout(() => refreshMenu(panel), 180);
      }
    });
    roomsGrid.appendChild(button);
  }
  roomsSection.append(roomsTitle, roomsGrid);
  menu.appendChild(roomsSection);

  const actionsSection = document.createElement("div");
  actionsSection.className = "ha3dRobotSection";
  const actionsTitle = document.createElement("div");
  actionsTitle.className = "ha3dRobotSectionTitle";
  actionsTitle.textContent = "Ação";
  const actions = document.createElement("div");
  actions.className = "ha3dRobotActions";

  const specs = [
    { label: "Aspirar", icon: "mdi:vacuum", cls: "primary", run: () => call(panel, "script", "turn_on", { entity_id: "script.aspirar_comodos_selecionados" }) },
    { label: "Passar pano", icon: "mdi:spray-bottle", cls: "primary", run: () => call(panel, "script", "turn_on", { entity_id: "script.passar_pano_comodos_selecionados" }) },
    { label: "Limpar seleção", icon: "mdi:selection-remove", cls: "", run: () => call(panel, "switch", "turn_off", { entity_id: ROOMS.map((room) => room.entity) }) },
    { label: "Voltar base", icon: "mdi:home-import-outline", cls: "danger", run: () => call(panel, "script", "turn_on", { entity_id: "script.desligar_robo" }) },
  ];

  for (const spec of specs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ha3dRobotAction ${spec.cls}`;
    button.appendChild(icon(spec.icon, 19));
    const label = document.createElement("span");
    label.textContent = spec.label;
    button.appendChild(label);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await spec.run();
      } catch (error) {
        console.error("[HA3D] robot action failed", spec.label, error);
      } finally {
        button.disabled = false;
        setTimeout(() => refreshMenu(panel), 250);
      }
    });
    actions.appendChild(button);
  }

  actionsSection.append(actionsTitle, actions);
  menu.appendChild(actionsSection);
  requestAnimationFrame(() => positionMenu(panel));
}

function openMenu(panel, binding) {
  const menu = ensureMenu(panel);
  if (!menu) return;
  panel._ha3dRobotControlBinding = binding;
  menu.classList.add("open");
  refreshMenu(panel);
  requestAnimationFrame(() => positionMenu(panel));
}

function bindVacuumMarkers(panel) {
  ensureMenu(panel);
  for (const [entity, binding] of panel?._lightBindings?.entries?.() || []) {
    if (!isVacuum(entity) || !binding?.marker) continue;
    const marker = binding.marker;
    if (marker.__ha3dRobotControlBound) continue;
    marker.__ha3dRobotControlBound = true;

    marker.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openMenu(panel, { ...binding, entity });
    }, true);
  }
}

function collectPanels(root, found = new Set()) {
  if (!root?.querySelectorAll) return found;
  for (const element of root.querySelectorAll("*")) {
    if (element.localName === "ha3d-panel") found.add(element);
    if (element.shadowRoot) collectPanels(element.shadowRoot, found);
  }
  return found;
}

function installExisting() {
  for (const panel of collectPanels(document)) bindVacuumMarkers(panel);
}

if (!proto.__ha3dRobotControlPopoverV1) {
  proto.__ha3dRobotControlPopoverV1 = true;

  const oldConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = oldConnected?.apply(this, args);
    queueMicrotask(() => bindVacuumMarkers(this));
    requestAnimationFrame(() => bindVacuumMarkers(this));
    return result;
  };

  const oldBind = proto._bindEntityLightMarkers;
  proto._bindEntityLightMarkers = function (...args) {
    const result = oldBind?.apply(this, args);
    queueMicrotask(() => bindVacuumMarkers(this));
    return result;
  };

  const oldUpdateMarkers = proto._updateLightMarkers;
  proto._updateLightMarkers = function (...args) {
    const result = oldUpdateMarkers?.apply(this, args);
    if (this.shadowRoot?.querySelector("#ha3dRobotControl.open")) positionMenu(this);
    return result;
  };

  const hassDescriptor = Object.getOwnPropertyDescriptor(proto, "hass");
  if (hassDescriptor?.set) {
    Object.defineProperty(proto, "hass", {
      configurable: true,
      enumerable: hassDescriptor.enumerable,
      get: hassDescriptor.get,
      set(value) {
        hassDescriptor.set.call(this, value);
        queueMicrotask(() => {
          bindVacuumMarkers(this);
          refreshMenu(this);
        });
      },
    });
  }

  queueMicrotask(installExisting);
  requestAnimationFrame(installExisting);
  setTimeout(installExisting, 500);
}
