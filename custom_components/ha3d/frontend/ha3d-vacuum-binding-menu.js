// UI-only vacuum menu for objects bound to vacuum.*.
// Does not touch robot tracking, map overlay, position, calibration or runtime hooks.
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const ROOMS = [
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

function icon(name, size = 19) {
  const el = document.createElement("ha-icon");
  el.setAttribute("icon", name);
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.pointerEvents = "none";
  el.style.setProperty("--mdc-icon-size", `${size}px`);
  return el;
}

function state(panel, entity) {
  return panel?._hass?.states?.[entity] || null;
}

function pretty(value) {
  const raw = String(value ?? "").trim();
  const labels = {
    on: "Ligado", off: "Desligado", unavailable: "Indisponível", unknown: "—",
    idle: "Parado", docked: "Na base", cleaning: "Limpando", returning: "Voltando",
    paused: "Pausado", charging: "Carregando",
  };
  return labels[raw.toLowerCase()] || raw || "—";
}

function findBinding(panel, marker) {
  for (const [entity, binding] of panel?._lightBindings?.entries?.() || []) {
    if (binding?.marker === marker) return { entity, binding };
  }
  return null;
}

function ensureStyle(panel) {
  if (!panel?.shadowRoot || panel.shadowRoot.querySelector("#ha3dVacuumMenuStyle")) return;
  const style = document.createElement("style");
  style.id = "ha3dVacuumMenuStyle";
  style.textContent = `
    #ha3dVacuumMenu{
      position:absolute;z-index:80;display:none;width:min(420px,calc(100vw - 20px));
      max-height:min(74vh,640px);overflow:auto;padding:10px;border-radius:17px;
      background:color-mix(in srgb,var(--card-background-color,#15171d) 94%,transparent);
      border:1px solid rgba(255,255,255,.15);box-shadow:0 14px 42px rgba(0,0,0,.42);
      backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);pointer-events:auto;
    }
    #ha3dVacuumMenu.open{display:block}
    .h3vrHead{display:flex;align-items:center;gap:9px;padding:1px 2px 8px}
    .h3vrHeadIcon{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(255,255,255,.08)}
    .h3vrHeadText{min-width:0;flex:1}.h3vrTitle{font-size:14px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .h3vrSub{font-size:10px;opacity:.62;margin-top:2px}.h3vrClose{width:32px;height:32px;min-height:32px;padding:0;border-radius:10px;background:#24262c}
    .h3vrSection{padding-top:9px;margin-top:2px;border-top:1px solid rgba(255,255,255,.10)}
    .h3vrSectionTitle{font-size:10px;font-weight:750;opacity:.66;margin:0 2px 7px;text-transform:uppercase;letter-spacing:.05em}
    .h3vrStatusGrid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px}
    .h3vrStatus{min-width:0;padding:7px 5px;border-radius:10px;background:#22252b;border:1px solid rgba(255,255,255,.08);text-align:center}
    .h3vrStatusLabel{font-size:9px;opacity:.56;margin-top:3px}.h3vrStatusValue{font-size:10px;font-weight:700;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .h3vrRooms{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
    .h3vrRoom{position:relative;min-height:57px;padding:7px 4px;border-radius:11px;background:#24262c;border:1px solid rgba(255,255,255,.10);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:10px;font-weight:650;text-align:center}
    .h3vrRoom.selected{background:color-mix(in srgb,var(--primary-color,#03a9f4) 24%,#24262c);border-color:color-mix(in srgb,var(--primary-color,#03a9f4) 72%,transparent)}
    .h3vrCheck{position:absolute;top:3px;right:5px;font-size:10px;font-weight:900;opacity:0}.h3vrRoom.selected .h3vrCheck{opacity:1}
    .h3vrActions{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .h3vrAction{min-height:39px;padding:8px;border-radius:11px;background:#24262c;display:flex;align-items:center;justify-content:center;gap:7px;font-size:11px}
    .h3vrAction.primary{background:color-mix(in srgb,var(--primary-color,#03a9f4) 72%,#18202a)}
    @media(max-width:600px){#ha3dVacuumMenu{width:min(390px,calc(100vw - 14px));padding:8px}.h3vrStatusGrid{grid-template-columns:repeat(3,minmax(0,1fr))}}
  `;
  panel.shadowRoot.appendChild(style);
}

function ensureMenu(panel) {
  const root = panel?.shadowRoot?.querySelector("#root");
  if (!root) return null;
  ensureStyle(panel);
  let menu = panel.shadowRoot.querySelector("#ha3dVacuumMenu");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "ha3dVacuumMenu";
  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  menu.addEventListener("click", (event) => event.stopPropagation());
  root.appendChild(menu);

  if (!root.__ha3dVacuumMenuOutside) {
    root.__ha3dVacuumMenuOutside = true;
    root.addEventListener("pointerdown", (event) => {
      const open = panel.shadowRoot?.querySelector("#ha3dVacuumMenu.open");
      if (open && !open.contains(event.target)) open.classList.remove("open");
    }, true);
  }
  return menu;
}

function position(panel, marker) {
  const menu = panel?.shadowRoot?.querySelector("#ha3dVacuumMenu.open");
  const root = panel?.shadowRoot?.querySelector("#root");
  if (!menu || !root || !marker) return;
  const rr = root.getBoundingClientRect(), mr = marker.getBoundingClientRect(), pr = menu.getBoundingClientRect();
  const margin = 10;
  let left = mr.left - rr.left + mr.width / 2 - pr.width / 2;
  left = Math.max(margin, Math.min(left, rr.width - pr.width - margin));
  let top = mr.top - rr.top - pr.height - 10;
  if (top < margin) top = mr.bottom - rr.top + 10;
  top = Math.max(margin, Math.min(top, rr.height - pr.height - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

async function service(panel, domain, name, entityId) {
  return panel._hass?.callService?.(domain, name, {}, { entity_id: entityId });
}

function addStatus(host, mdi, label, value) {
  const card = document.createElement("div");
  card.className = "h3vrStatus";
  card.appendChild(icon(mdi, 18));
  const l = document.createElement("div"); l.className = "h3vrStatusLabel"; l.textContent = label;
  const v = document.createElement("div"); v.className = "h3vrStatusValue"; v.textContent = value; v.title = value;
  card.append(l, v);
  host.appendChild(card);
}

function render(panel, entity, marker) {
  const menu = ensureMenu(panel);
  if (!menu) return;
  const robot = state(panel, entity);
  menu.replaceChildren();

  const head = document.createElement("div"); head.className = "h3vrHead";
  const hi = document.createElement("div"); hi.className = "h3vrHeadIcon"; hi.appendChild(icon("mdi:robot-vacuum", 23));
  const ht = document.createElement("div"); ht.className = "h3vrHeadText";
  const title = document.createElement("div"); title.className = "h3vrTitle"; title.textContent = robot?.attributes?.friendly_name || entity;
  const sub = document.createElement("div"); sub.className = "h3vrSub"; sub.textContent = "Controle rápido";
  ht.append(title, sub);
  const close = document.createElement("button"); close.type = "button"; close.className = "h3vrClose"; close.appendChild(icon("mdi:close", 18)); close.onclick = () => menu.classList.remove("open");
  head.append(hi, ht, close); menu.appendChild(head);

  const ss = document.createElement("div"); ss.className = "h3vrSection";
  const st = document.createElement("div"); st.className = "h3vrSectionTitle"; st.textContent = "Status";
  const sg = document.createElement("div"); sg.className = "h3vrStatusGrid";
  addStatus(sg, "mdi:robot-vacuum", "Estado", pretty(robot?.state));
  const battery = state(panel, STATUS.battery)?.state;
  addStatus(sg, "mdi:battery", "Bateria", battery && !["unknown","unavailable"].includes(String(battery)) ? `${battery}%` : "—");
  addStatus(sg, "mdi:robot-vacuum-variant", "Atividade", pretty(state(panel, STATUS.activity)?.state));
  addStatus(sg, "mdi:battery-charging", "Carga", pretty(state(panel, STATUS.charging)?.state));
  addStatus(sg, "mdi:map-marker", "Cômodo", pretty(state(panel, STATUS.room)?.state));
  ss.append(st, sg); menu.appendChild(ss);

  const rs = document.createElement("div"); rs.className = "h3vrSection";
  const rt = document.createElement("div"); rt.className = "h3vrSectionTitle"; rt.textContent = "Selecione os cômodos";
  const rg = document.createElement("div"); rg.className = "h3vrRooms";
  for (const [switchEntity, label, mdi] of ROOMS) {
    const button = document.createElement("button"); button.type = "button"; button.className = "h3vrRoom";
    button.classList.toggle("selected", state(panel, switchEntity)?.state === "on");
    const check = document.createElement("span"); check.className = "h3vrCheck"; check.textContent = "✓";
    const name = document.createElement("span"); name.textContent = label;
    button.append(check, icon(mdi, 20), name);
    button.onclick = async () => {
      button.disabled = true;
      try { await service(panel, "switch", "toggle", switchEntity); }
      finally { button.disabled = false; setTimeout(() => render(panel, entity, marker), 160); }
    };
    rg.appendChild(button);
  }
  rs.append(rt, rg); menu.appendChild(rs);

  const as = document.createElement("div"); as.className = "h3vrSection";
  const at = document.createElement("div"); at.className = "h3vrSectionTitle"; at.textContent = "Ação";
  const ag = document.createElement("div"); ag.className = "h3vrActions";
  const actions = [
    ["Aspirar", "mdi:vacuum", "script", "turn_on", "script.aspirar_comodos_selecionados", "primary"],
    ["Passar pano", "mdi:spray-bottle", "script", "turn_on", "script.passar_pano_comodos_selecionados", "primary"],
    ["Limpar seleção", "mdi:selection-remove", "switch", "turn_off", ROOMS.map((room) => room[0]), ""],
    ["Voltar base", "mdi:home-import-outline", "script", "turn_on", "script.desligar_robo", ""],
  ];
  for (const [label, mdi, domain, name, target, cls] of actions) {
    const button = document.createElement("button"); button.type = "button"; button.className = `h3vrAction ${cls}`;
    button.appendChild(icon(mdi, 19)); const text = document.createElement("span"); text.textContent = label; button.appendChild(text);
    button.onclick = async () => {
      button.disabled = true;
      try { await service(panel, domain, name, target); }
      finally { button.disabled = false; setTimeout(() => render(panel, entity, marker), 220); }
    };
    ag.appendChild(button);
  }
  as.append(at, ag); menu.appendChild(as);

  menu.classList.add("open");
  requestAnimationFrame(() => position(panel, marker));
}

function install(panel) {
  const markers = panel?.shadowRoot?.querySelector("#markers");
  if (!markers || markers.__ha3dVacuumBindingMenuBeta12) return;
  markers.__ha3dVacuumBindingMenuBeta12 = true;

  markers.addEventListener("click", (event) => {
    if (panel._editorMode) return;
    const marker = event.target?.closest?.(".lightMarker");
    if (!marker) return;
    const found = findBinding(panel, marker);
    if (!found || !String(found.entity).startsWith("vacuum.")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    render(panel, found.entity, marker);
  }, true);
}

if (!proto.__ha3dVacuumBindingMenuBeta12) {
  proto.__ha3dVacuumBindingMenuBeta12 = true;
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
