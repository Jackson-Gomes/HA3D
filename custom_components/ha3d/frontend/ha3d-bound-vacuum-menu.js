// Opt-in-by-binding vacuum menu.
// This module never changes robot tracking, map rendering, robot transforms, or HA state hooks.
// Any ordinary HA3D object bound to a vacuum.* entity gets this compact control menu.
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

const STATUS_ENTITIES = {
  battery: "sensor.xiaomi_us_1213069013_ov43gb_battery_level_p_3_1",
  activity: "sensor.xiaomi_us_1213069013_ov43gb_sweep_mop_status_p_2_96",
  charging: "sensor.xiaomi_us_1213069013_ov43gb_charging_state_p_3_2",
  room: "sensor.xiaomi_robot_vacuum_h50_vacuum_room_name",
};

function mdi(name, size = 19) {
  const icon = document.createElement("ha-icon");
  icon.setAttribute("icon", name);
  icon.style.width = `${size}px`;
  icon.style.height = `${size}px`;
  icon.style.setProperty("--mdc-icon-size", `${size}px`);
  icon.style.pointerEvents = "none";
  return icon;
}

function textState(panel, entity) {
  const state = panel?._hass?.states?.[entity]?.state;
  if (!state) return "—";
  const labels = {
    on: "Ligado", off: "Desligado", unavailable: "Indisponível", unknown: "—",
    idle: "Parado", docked: "Na base", cleaning: "Limpando", returning: "Voltando",
    paused: "Pausado", charging: "Carregando",
  };
  return labels[String(state).toLowerCase()] || String(state);
}

function bindingForMarker(panel, marker) {
  for (const [entity, binding] of panel?._lightBindings?.entries?.() || []) {
    if (binding?.marker === marker) return { entity, binding };
  }
  return null;
}

function ensureStyle(panel) {
  if (panel.shadowRoot?.querySelector("#ha3dBoundVacuumMenuStyle")) return;
  const style = document.createElement("style");
  style.id = "ha3dBoundVacuumMenuStyle";
  style.textContent = `
    #ha3dBoundVacuumMenu{
      position:absolute;z-index:49;display:none;width:min(420px,calc(100vw - 20px));
      max-height:min(74vh,640px);overflow:auto;padding:10px;border-radius:17px;
      background:color-mix(in srgb,var(--card-background-color,#15171d) 94%,transparent);
      border:1px solid rgba(255,255,255,.15);box-shadow:0 14px 42px rgba(0,0,0,.42);
      backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);pointer-events:auto;
      overscroll-behavior:contain;
    }
    #ha3dBoundVacuumMenu.open{display:block}
    .h3rvHead{display:flex;align-items:center;gap:9px;padding:1px 2px 8px}
    .h3rvHeadIcon{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(255,255,255,.08)}
    .h3rvHeadText{min-width:0;flex:1}.h3rvTitle{font-size:14px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .h3rvSub{font-size:10px;opacity:.62;margin-top:2px}.h3rvClose{width:32px;height:32px;min-height:32px;padding:0;border-radius:10px;background:#24262c}
    .h3rvSection{padding-top:9px;margin-top:2px;border-top:1px solid rgba(255,255,255,.10)}
    .h3rvSectionTitle{font-size:10px;font-weight:750;opacity:.66;margin:0 2px 7px;text-transform:uppercase;letter-spacing:.05em}
    .h3rvStatusGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}
    .h3rvStatus{min-width:0;padding:7px 5px;border-radius:10px;background:#22252b;border:1px solid rgba(255,255,255,.08);text-align:center}
    .h3rvStatusLabel{font-size:9px;opacity:.56;margin-top:3px}.h3rvStatusValue{font-size:10px;font-weight:700;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .h3rvRooms{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
    .h3rvRoom{position:relative;min-height:57px;padding:7px 4px;border-radius:11px;background:#24262c;border:1px solid rgba(255,255,255,.10);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:10px;font-weight:650;text-align:center}
    .h3rvRoom.selected{background:color-mix(in srgb,var(--primary-color,#03a9f4) 24%,#24262c);border-color:color-mix(in srgb,var(--primary-color,#03a9f4) 72%,transparent)}
    .h3rvCheck{position:absolute;top:3px;right:5px;font-size:10px;font-weight:900;opacity:0}.h3rvRoom.selected .h3rvCheck{opacity:1}
    .h3rvActions{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .h3rvAction{min-height:39px;padding:8px;border-radius:11px;background:#24262c;display:flex;align-items:center;justify-content:center;gap:7px;font-size:11px}
    .h3rvAction.primary{background:color-mix(in srgb,var(--primary-color,#03a9f4) 72%,#18202a)}
    @media(max-width:600px){#ha3dBoundVacuumMenu{width:min(390px,calc(100vw - 14px));padding:8px}.h3rvStatusGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  panel.shadowRoot.appendChild(style);
}

function ensureMenu(panel) {
  const root = panel.shadowRoot?.querySelector("#root");
  if (!root) return null;
  ensureStyle(panel);
  let menu = panel.shadowRoot.querySelector("#ha3dBoundVacuumMenu");
  if (menu) return menu;
  menu = document.createElement("div");
  menu.id = "ha3dBoundVacuumMenu";
  menu.addEventListener("pointerdown", e => e.stopPropagation());
  menu.addEventListener("click", e => e.stopPropagation());
  root.appendChild(menu);

  root.addEventListener("pointerdown", (event) => {
    const open = panel.shadowRoot?.querySelector("#ha3dBoundVacuumMenu.open");
    if (open && !open.contains(event.target)) open.classList.remove("open");
  });
  return menu;
}

function place(panel, marker) {
  const menu = panel.shadowRoot?.querySelector("#ha3dBoundVacuumMenu.open");
  const root = panel.shadowRoot?.querySelector("#root");
  if (!menu || !root || !marker) return;
  const rr=root.getBoundingClientRect(), mr=marker.getBoundingClientRect(), pr=menu.getBoundingClientRect();
  const m=10;
  let left=mr.left-rr.left+mr.width/2-pr.width/2;
  left=Math.max(m,Math.min(left,rr.width-pr.width-m));
  let top=mr.top-rr.top-pr.height-10;
  if(top<m) top=mr.bottom-rr.top+10;
  top=Math.max(m,Math.min(top,rr.height-pr.height-m));
  menu.style.left=`${left}px`; menu.style.top=`${top}px`;
}

async function service(panel, domain, name, entityId) {
  return panel._hass?.callService?.(domain, name, {}, { entity_id: entityId });
}

function statusCard(host, iconName, label, value) {
  const box=document.createElement("div"); box.className="h3rvStatus"; box.appendChild(mdi(iconName,18));
  const l=document.createElement("div"); l.className="h3rvStatusLabel"; l.textContent=label;
  const v=document.createElement("div"); v.className="h3rvStatusValue"; v.textContent=value; v.title=value;
  box.append(l,v); host.appendChild(box);
}

function render(panel, entity, marker) {
  const menu=ensureMenu(panel); if(!menu) return;
  const robot=panel._hass?.states?.[entity];
  const title=robot?.attributes?.friendly_name || entity;
  menu.replaceChildren();

  const head=document.createElement("div"); head.className="h3rvHead";
  const hi=document.createElement("div"); hi.className="h3rvHeadIcon"; hi.appendChild(mdi("mdi:robot-vacuum",23));
  const ht=document.createElement("div"); ht.className="h3rvHeadText";
  const tt=document.createElement("div"); tt.className="h3rvTitle"; tt.textContent=title;
  const sub=document.createElement("div"); sub.className="h3rvSub"; sub.textContent="Controle do robô";
  ht.append(tt,sub);
  const close=document.createElement("button"); close.type="button"; close.className="h3rvClose"; close.appendChild(mdi("mdi:close",18)); close.onclick=()=>menu.classList.remove("open");
  head.append(hi,ht,close); menu.appendChild(head);

  const ss=document.createElement("div"); ss.className="h3rvSection";
  const st=document.createElement("div"); st.className="h3rvSectionTitle"; st.textContent="Status";
  const sg=document.createElement("div"); sg.className="h3rvStatusGrid";
  statusCard(sg,"mdi:robot-vacuum","Estado",textState(panel,entity));
  const battery=panel._hass?.states?.[STATUS_ENTITIES.battery]?.state;
  statusCard(sg,"mdi:battery","Bateria",battery && !["unknown","unavailable"].includes(battery) ? `${battery}%` : "—");
  statusCard(sg,"mdi:map-marker","Cômodo",textState(panel,STATUS_ENTITIES.room));
  statusCard(sg,"mdi:robot-vacuum-variant","Atividade",textState(panel,STATUS_ENTITIES.activity));
  ss.append(st,sg); menu.appendChild(ss);

  const rs=document.createElement("div"); rs.className="h3rvSection";
  const rt=document.createElement("div"); rt.className="h3rvSectionTitle"; rt.textContent="Cômodos";
  const rg=document.createElement("div"); rg.className="h3rvRooms";
  for(const [switchEntity,label,iconName] of ROOM_SWITCHES){
    const b=document.createElement("button"); b.type="button"; b.className="h3rvRoom";
    b.classList.toggle("selected",panel._hass?.states?.[switchEntity]?.state==="on");
    const check=document.createElement("span"); check.className="h3rvCheck"; check.textContent="✓";
    const lab=document.createElement("span"); lab.textContent=label;
    b.append(check,mdi(iconName,20),lab);
    b.onclick=async()=>{ b.disabled=true; try{await service(panel,"switch","toggle",switchEntity);} finally{b.disabled=false; setTimeout(()=>render(panel,entity,marker),150);} };
    rg.appendChild(b);
  }
  rs.append(rt,rg); menu.appendChild(rs);

  const as=document.createElement("div"); as.className="h3rvSection";
  const at=document.createElement("div"); at.className="h3rvSectionTitle"; at.textContent="Ações";
  const ag=document.createElement("div"); ag.className="h3rvActions";
  const actions=[
    ["Aspirar","mdi:vacuum","script","turn_on","script.aspirar_comodos_selecionados","primary"],
    ["Passar pano","mdi:spray-bottle","script","turn_on","script.passar_pano_comodos_selecionados","primary"],
    ["Limpar seleção","mdi:selection-remove","switch","turn_off",ROOM_SWITCHES.map(x=>x[0]),""],
    ["Voltar à base","mdi:home-import-outline","script","turn_on","script.desligar_robo",""],
  ];
  for(const [label,iconName,domain,name,target,cls] of actions){
    const b=document.createElement("button"); b.type="button"; b.className=`h3rvAction ${cls}`; b.append(mdi(iconName,19));
    const span=document.createElement("span"); span.textContent=label; b.appendChild(span);
    b.onclick=async()=>{b.disabled=true; try{await service(panel,domain,name,target);} finally{b.disabled=false; setTimeout(()=>render(panel,entity,marker),220);}};
    ag.appendChild(b);
  }
  as.append(at,ag); menu.appendChild(as);

  menu.classList.add("open");
  requestAnimationFrame(()=>place(panel,marker));
}

function install(panel) {
  const markers=panel.shadowRoot?.querySelector("#markers");
  if(!markers || markers.__ha3dBoundVacuumMenuV1) return;
  markers.__ha3dBoundVacuumMenuV1=true;

  // Event delegation only: no robot hooks, no HA state setter, no tracker/map overrides.
  markers.addEventListener("click",(event)=>{
    if(panel._editorMode) return;
    const marker=event.target?.closest?.(".lightMarker");
    if(!marker) return;
    const found=bindingForMarker(panel,marker);
    if(!found || !String(found.entity).startsWith("vacuum.")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    render(panel,found.entity,marker);
  },true);
}

if(!proto.__ha3dBoundVacuumMenuV1){
  proto.__ha3dBoundVacuumMenuV1=true;
  const oldWire=proto._wireUi;
  proto._wireUi=function(...args){const result=oldWire?.apply(this,args); queueMicrotask(()=>install(this)); return result;};
  const oldConnected=proto.connectedCallback;
  proto.connectedCallback=function(...args){const result=oldConnected?.apply(this,args); queueMicrotask(()=>install(this)); requestAnimationFrame(()=>install(this)); return result;};
}
