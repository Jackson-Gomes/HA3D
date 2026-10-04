// Compact controls for any object explicitly bound to a vacuum.* entity.
// IMPORTANT: this module is UI-only. It never touches robot tracking, map
// overlay, robot transforms, calibration, runtime state, or renderer hooks.
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const ROOM_SWITCHES = [
  ["switch.robo_sala_aspirar", "Sala", "mdi:sofa-outline"],
  ["switch.robo_quarto_aspirar", "Quarto", "mdi:bed-outline"],
  ["switch.robo_escritorio_aspirar", "Escritório", "mdi:desk"],
  ["switch.robo_quarto_crianca_aspirar", "Quarto criança", "mdi:teddy-bear"],
  ["switch.robo_cozinha_aspirar", "Cozinha", "mdi:countertop-outline"],
  ["switch.robo_corredor_aspirar", "Corredor", "mdi:door-open"],
  ["switch.robo_banheiro_joca_aspirar", "Banheiro Joca", "mdi:shower"],
  ["switch.robo_sacada_aspirar", "Sacada", "mdi:balcony"],
  ["switch.robo_banheiro_1_aspirar", "Banheiro 1", "mdi:shower-head"],
];

const STATUS = {
  battery: "sensor.xiaomi_us_1213069013_ov43gb_battery_level_p_3_1",
  activity: "sensor.xiaomi_us_1213069013_ov43gb_sweep_mop_status_p_2_96",
  charging: "sensor.xiaomi_us_1213069013_ov43gb_charging_state_p_3_2",
  room: "sensor.xiaomi_robot_vacuum_h50_vacuum_room_name",
};

function makeIcon(name, size = 19) {
  const icon = document.createElement("ha-icon");
  icon.setAttribute("icon", name);
  icon.style.width = `${size}px`;
  icon.style.height = `${size}px`;
  icon.style.pointerEvents = "none";
  icon.style.setProperty("--mdc-icon-size", `${size}px`);
  return icon;
}

function state(panel, entity) {
  return panel?._hass?.states?.[entity] || null;
}

function labelState(value) {
  const raw = String(value ?? "").trim();
  const labels = {
    on: "Ligado",
    off: "Desligado",
    unavailable: "Indisponível",
    unknown: "—",
    idle: "Parado",
    docked: "Na base",
    cleaning: "Limpando",
    returning: "Voltando",
    paused: "Pausado",
    charging: "Carregando",
  };
  return labels[raw.toLowerCase()] || raw || "—";
}

function bindingFromMarker(panel, marker) {
  for (const [entity, binding] of panel?._lightBindings?.entries?.() || []) {
    if (binding?.marker === marker) return { entity, binding };
  }
  return null;
}

function ensureStyle(panel) {
  if (!panel?.shadowRoot || panel.shadowRoot.querySelector("#ha3dVacuumBindingMenuStyle")) return;
  const style = document.createElement("style");
  style.id = "ha3dVacuumBindingMenuStyle";
  style.textContent = `
    #ha3dVacuumBindingMenu{
      position:absolute;z-index:49;display:none;width:min(420px,calc(100vw - 20px));
      max-height:min(74vh,640px);overflow:auto;padding:10px;border-radius:17px;
      background:color-mix(in srgb,var(--card-background-color,#15171d) 94%,transparent);
      border:1px solid rgba(255,255,255,.15);box-shadow:0 14px 42px rgba(0,0,0,.42);
      backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);pointer-events:auto;
      overscroll-behavior:contain;
    }
    #ha3dVacuumBindingMenu.open{display:block}
    .h3dvHead{display:flex;align-items:center;gap:9px;padding:1px 2px 8px}
    .h3dvHeadIcon{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(255,255,255,.08)}
    .h3dvHeadText{min-width:0;flex:1}
    .h3dvTitle{font-size:14px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .h3dvSub{font-size:10px;opacity:.62;margin-top:2px}
    .h3dvClose{width:32px;height:32px;min-height:32px;padding:0;border-radius:10px;background:#24262c}
    .h3dvSection{padding-top:9px;margin-top:2px;border-top:1px solid rgba(255,255,255,.10)}
    .h3dvSectionTitle{font-size:10px;font-weight:750;opacity:.66;margin:0 2px 7px;text-transform:uppercase;letter-spacing:.05em}
    .h3dvStatusGrid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px}
    .h3dvStatus{min-width:0;padding:7px 5px;border-radius:10px;background:#22252b;border:1px solid rgba(255,255,255,.08);text-align:center}
    .h3dvStatusLabel{font-size:9px;opacity:.56;margin-top:3px}
    .h3dvStatusValue{font-size:10px;font-weight:700;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .h3dvRooms{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
    .h3dvRoom{position:relative;min-height:57px;padding:7px 4px;border-radius:11px;background:#24262c;border:1px solid rgba(255,255,255,.10);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:10px;font-weight:650;text-align:center}
    .h3dvRoom.selected{background:color-mix(in srgb,var(--primary-color,#03a9f4) 24%,#24262c);border-color:color-mix(in srgb,var(--primary-color,#03a9f4) 72%,transparent)}
    .h3dvCheck{position:absolute;top:3px;right:5px;font-size:10px;font-weight:900;opacity:0}
    .h3dvRoom.selected .h3dvCheck{opacity:1}
    .h3dvActions{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .h3dvAction{min-height:39px;padding:8px;border-radius:11px;background:#24262c;display:flex;align-items:center;justify-content:center;gap:7px;font-size:11px}
    .h3dvAction.primary{background:color-mix(in srgb,var(--primary-color,#03a9f4) 72%,#18202a)}
    @media(max-width:600px){
      #ha3dVacuumBindingMenu{width:min(390px,calc(100vw - 14px));padding:8px}
      .h3dvStatusGrid{grid-template-columns:repeat(3,minmax(0,1fr))}
    }
  `;
  panel.shadowRoot.appendChild(style);
}

function ensureMenu(panel) {
  const root = panel?.shadowRoot?.querySelector("#root");
  if (!root) return null;
  ensureStyle(panel);

  let menu = panel.shadowRoot.querySelector("#ha3dVacuumBindingMenu");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "ha3dVacuumBindingMenu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Controle do aspirador robô");
  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  menu.addEventListener("click", (event) => event.stopPropagation());
  root.appendChild(menu);

  if (!root.__ha3dVacuumBindingMenuOutsideV1) {
    root.__ha3dVacuumBindingMenuOutsideV1 = true;
    root.addEventListener("pointerdown", (event) => {
      const open = panel.shadowRoot?.querySelector("#ha3dVacuumBindingMenu.open");
      if (!open || open.contains(event.target)) return;
      open.classList.remove("open");
    });
  }
  return menu;
}

function positionMenu(panel, marker) {
  const menu = panel?.shadowRoot?.querySelector("#ha3dVacuumBindingMenu.open");
  const root = panel?.shadowRoot?.querySelector("#root");
  if (!menu || !root || !marker) return;

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

async function call(panel, domain, service, entityId) {
  if (!panel?._hass?.callService) throw new Error("Home Assistant indisponível");
  return panel._hass.callService(domain, service, {}, { entity_id: entityId });
}

function addStatus(host, iconName, label, value) {
  const card = document.createElement("div");
  card.className = "h3dvStatus";
  card.appendChild(makeIcon(iconName, 18));

  const labelNode = document.createElement("div");
  labelNode.className = "h3dvStatusLabel";
  labelNode.textContent = label;

  const valueNode = document.createElement("div");
  valueNode.className = "h3dvStatusValue";
  valueNode.textContent = value;
  valueNode.title = value;

  card.append(labelNode, valueNode);
  host.appendChild(card);
}

function renderMenu(panel, entity, marker) {
  const menu = ensureMenu(panel);
  if (!menu) return;

  const robot = state(panel, entity);
  const title = robot?.attributes?.friendly_name || entity;
  menu.replaceChildren();

  const head = document.createElement("div");
  head.className = "h3dvHead";

  const headIcon = document.createElement("div");
  headIcon.className = "h3dvHeadIcon";
  headIcon.appendChild(makeIcon("mdi:robot-vacuum", 23));

  const headText = document.createElement("div");
  headText.className = "h3dvHeadText";

  const titleNode = document.createElement("div");
  titleNode.className = "h3dvTitle";
  titleNode.textContent = title;

  const sub = document.createElement("div");
  sub.className = "h3dvSub";
  sub.textContent = "Controle rápido";

  headText.append(titleNode, sub);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "h3dvClose";
  close.title = "Fechar";
  close.appendChild(makeIcon("mdi:close", 18));
  close.addEventListener("click", () => menu.classList.remove("open"));

  head.append(headIcon, headText, close);
  menu.appendChild(head);

  const statusSection = document.createElement("div");
  statusSection.className = "h3dvSection";

  const statusTitle = document.createElement("div");
  statusTitle.className = "h3dvSectionTitle";
  statusTitle.textContent = "Status";

  const statusGrid = document.createElement("div");
  statusGrid.className = "h3dvStatusGrid";

  addStatus(statusGrid, "mdi:robot-vacuum", "Estado", labelState(robot?.state));

  const battery = state(panel, STATUS.battery)?.state;
  const batteryText = battery && !["unknown", "unavailable"].includes(String(battery))
    ? `${battery}%`
    : "—";
  addStatus(statusGrid, "mdi:battery", "Bateria", batteryText);
  addStatus(statusGrid, "mdi:robot-vacuum-variant", "Atividade", labelState(state(panel, STATUS.activity)?.state));
  addStatus(statusGrid, "mdi:battery-charging", "Carga", labelState(state(panel, STATUS.charging)?.state));
  addStatus(statusGrid, "mdi:map-marker", "Cômodo", labelState(state(panel, STATUS.room)?.state));

  statusSection.append(statusTitle, statusGrid);
  menu.appendChild(statusSection);

  const roomsSection = document.createElement("div");
  roomsSection.className = "h3dvSection";

  const roomsTitle = document.createElement("div");
  roomsTitle.className = "h3dvSectionTitle";
  roomsTitle.textContent = "Selecione os cômodos";

  const rooms = document.createElement("div");
  rooms.className = "h3dvRooms";

  for (const [switchEntity, label, iconName] of ROOM_SWITCHES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "h3dvRoom";
    button.classList.toggle("selected", state(panel, switchEntity)?.state === "on");

    const check = document.createElement("span");
    check.className = "h3dvCheck";
    check.textContent = "✓";

    const text = document.createElement("span");
    text.textContent = label;

    button.append(check, makeIcon(iconName, 20), text);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await call(panel, "switch", "toggle", switchEntity);
      } catch (error) {
        console.error("[HA3D] vacuum room toggle failed", switchEntity, error);
      } finally {
        button.disabled = false;
        setTimeout(() => renderMenu(panel, entity, marker), 150);
      }
    });

    rooms.appendChild(button);
  }

  roomsSection.append(roomsTitle, rooms);
  menu.appendChild(roomsSection);

  const actionSection = document.createElement("div");
  actionSection.className = "h3dvSection";

  const actionTitle = document.createElement("div");
  actionTitle.className = "h3dvSectionTitle";
  actionTitle.textContent = "Ação";

  const actions = document.createElement("div");
  actions.className = "h3dvActions";

  const specs = [
    ["Aspirar", "mdi:vacuum", "script", "turn_on", "script.aspirar_comodos_selecionados", "primary"],
    ["Passar pano", "mdi:spray-bottle", "script", "turn_on", "script.passar_pano_comodos_selecionados", "primary"],
    ["Limpar seleção", "mdi:selection-remove", "switch", "turn_off", ROOM_SWITCHES.map((item) => item[0]), ""],
    ["Voltar base", "mdi:home-import-outline", "script", "turn_on", "script.desligar_robo", ""],
  ];

  for (const [label, iconName, domain, service, target, className] of specs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `h3dvAction ${className}`;
    button.appendChild(makeIcon(iconName, 19));

    const text = document.createElement("span");
    text.textContent = label;
    button.appendChild(text);

    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await call(panel, domain, service, target);
      } catch (error) {
        console.error("[HA3D] vacuum menu action failed", label, error);
      } finally {
        button.disabled = false;
        setTimeout(() => renderMenu(panel, entity, marker), 220);
      }
    });

    actions.appendChild(button);
  }

  actionSection.append(actionTitle, actions);
  menu.appendChild(actionSection);

  menu.classList.add("open");
  requestAnimationFrame(() => positionMenu(panel, marker));
}

function install(panel) {
  const markers = panel?.shadowRoot?.querySelector("#markers");
  if (!markers || markers.__ha3dVacuumBindingMenuV1) return;
  markers.__ha3dVacuumBindingMenuV1 = true;

  // Delegation on the existing marker layer only. No robot subsystem hooks.
  markers.addEventListener("click", (event) => {
    if (panel._editorMode) return;
    const marker = event.target?.closest?.(".lightMarker");
    if (!marker) return;

    const found = bindingFromMarker(panel, marker);
    if (!found || !String(found.entity).startsWith("vacuum.")) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    renderMenu(panel, found.entity, marker);
  }, true);
}

if (!proto.__ha3dVacuumBindingMenuV1) {
  proto.__ha3dVacuumBindingMenuV1 = true;

  const oldWireUi = proto._wireUi;
  proto._wireUi = function (...args) {
    const result = oldWireUi?.apply(this, args);
    queueMicrotask(() => install(this));
    return result;
  };

  const oldConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = oldConnected?.apply(this, args);
    queueMicrotask(() => install(this));
    requestAnimationFrame(() => install(this));
    return result;
  };
}
