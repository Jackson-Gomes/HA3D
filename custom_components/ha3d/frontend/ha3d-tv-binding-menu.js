// UI-only TV remote menu for objects bound to a TV media_player.*.
// Reuses the exact entities/commands from the Kindle dashboard and does not touch LightMedia.
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const TV_MEDIA_ENTITY = "media_player.sala_de_estar_tv_da_sala";
const TV_REMOTE_ENTITY = "remote.sala_de_estar_tv_da_sala";
const TV_POWER_SCENE = "scene.ligar_tv";
const TV_TEXT_ENTITY = "text.kindle_tv_texto";
const TV_TEXT_SCRIPT = "script.kindle_tv_enviar_texto";
const TV_TEXT_ENTER_SCRIPT = "script.kindle_tv_enviar_texto_enter";

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
    on: "Ligada",
    off: "Desligada",
    idle: "Parada",
    playing: "Reproduzindo",
    paused: "Pausada",
    unavailable: "Indisponível",
    unknown: "—",
  };
  return labels[raw.toLowerCase()] || raw || "—";
}

function findBinding(panel, marker) {
  for (const [entity, binding] of panel?._lightBindings?.entries?.() || []) {
    if (binding?.marker === marker) return { entity, binding };
  }
  return null;
}

function isTvBinding(panel, entity) {
  if (!String(entity).startsWith("media_player.")) return false;
  const st = state(panel, entity);
  return entity === TV_MEDIA_ENTITY || st?.attributes?.device_class === "tv";
}

function ensureStyle(panel) {
  if (!panel?.shadowRoot || panel.shadowRoot.querySelector("#ha3dTvMenuStyle")) return;
  const style = document.createElement("style");
  style.id = "ha3dTvMenuStyle";
  style.textContent = `
    #ha3dTvMenu{
      position:absolute;z-index:82;display:none;width:min(292px,calc(100vw - 18px));
      max-height:min(82vh,720px);overflow:auto;padding:10px;border-radius:22px;
      background:color-mix(in srgb,var(--card-background-color,#111318) 96%,transparent);
      border:1px solid rgba(255,255,255,.15);box-shadow:0 16px 46px rgba(0,0,0,.46);
      backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);pointer-events:auto;
    }
    #ha3dTvMenu.open{display:block}
    .h3tvHead{display:flex;align-items:center;gap:9px;padding:1px 2px 9px}
    .h3tvHeadIcon{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(255,255,255,.08)}
    .h3tvHeadText{min-width:0;flex:1}.h3tvTitle{font-size:14px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .h3tvSub{font-size:10px;opacity:.62;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .h3tvClose{width:32px;height:32px;min-height:32px;padding:0;border-radius:10px;background:#24262c}
    .h3tvRemote{margin:0 auto;padding:10px 10px 12px;border-radius:22px;background:linear-gradient(180deg,#202228,#17191e);border:1px solid rgba(255,255,255,.09)}
    .h3tvTop{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:9px}
    .h3tvBtn{border:1px solid rgba(255,255,255,.10);background:#2a2d34;color:var(--primary-text-color,#fff);border-radius:12px;min-height:42px;padding:7px;display:flex;align-items:center;justify-content:center;gap:6px;font-size:10px;font-weight:700}
    .h3tvBtn:active{transform:translateY(1px)}
    .h3tvBtn.power{background:color-mix(in srgb,#d63d3d 72%,#24262c)}
    .h3tvBtn.round{width:50px;height:50px;min-height:50px;padding:0;border-radius:50%}
    .h3tvBtn.ok{width:55px;height:55px;min-height:55px;padding:0;border-radius:50%;font-size:11px}
    .h3tvDpad{display:grid;grid-template-columns:58px 58px 58px;grid-template-rows:50px 58px 50px;gap:4px;justify-content:center;align-items:center;margin:5px auto 10px}
    .h3tvDpad .up{grid-column:2;grid-row:1}.h3tvDpad .left{grid-column:1;grid-row:2}.h3tvDpad .ok{grid-column:2;grid-row:2}.h3tvDpad .right{grid-column:3;grid-row:2}.h3tvDpad .down{grid-column:2;grid-row:3}
    .h3tvNav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:7px}
    .h3tvMedia{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:7px}
    .h3tvMini{min-height:48px;padding:6px 2px;border-radius:11px;background:#262930;border:1px solid rgba(255,255,255,.09);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:9px;font-weight:700;text-align:center}
    .h3tvKeyboard{display:none;margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.10)}
    .h3tvKeyboard.open{display:block}
    .h3tvInput{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.16);background:#111319;color:var(--primary-text-color,#fff);border-radius:11px;padding:10px;font-size:13px;outline:none}
    .h3tvKeyboardActions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}
    .h3tvState{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;padding:7px 9px;border-radius:10px;background:rgba(255,255,255,.05);font-size:10px}
    .h3tvState strong{font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    @media(max-width:500px){#ha3dTvMenu{width:min(284px,calc(100vw - 12px));padding:8px}.h3tvRemote{padding:8px}}
  `;
  panel.shadowRoot.appendChild(style);
}

function ensureMenu(panel) {
  const root = panel?.shadowRoot?.querySelector("#root");
  if (!root) return null;
  ensureStyle(panel);
  let menu = panel.shadowRoot.querySelector("#ha3dTvMenu");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "ha3dTvMenu";
  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  menu.addEventListener("click", (event) => event.stopPropagation());
  root.appendChild(menu);

  if (!root.__ha3dTvMenuOutside) {
    root.__ha3dTvMenuOutside = true;
    root.addEventListener("pointerdown", (event) => {
      const open = panel.shadowRoot?.querySelector("#ha3dTvMenu.open");
      if (open && !open.contains(event.target)) open.classList.remove("open");
    }, true);
  }
  return menu;
}

function position(panel, marker) {
  const menu = panel?.shadowRoot?.querySelector("#ha3dTvMenu.open");
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

async function call(panel, domain, serviceName, entityId, data = {}) {
  return panel._hass?.callService?.(domain, serviceName, data, { entity_id: entityId });
}

async function sendRemote(panel, command) {
  return call(panel, "remote", "send_command", TV_REMOTE_ENTITY, { command });
}

function button(label, mdi, className = "h3tvBtn") {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.appendChild(icon(mdi, className.includes("h3tvMini") ? 19 : 20));
  if (label) {
    const span = document.createElement("span");
    span.textContent = label;
    el.appendChild(span);
  }
  return el;
}

function render(panel, entity, marker) {
  const menu = ensureMenu(panel);
  if (!menu) return;
  const tv = state(panel, entity);
  menu.replaceChildren();

  const vacuum = panel.shadowRoot?.querySelector("#ha3dVacuumMenu.open");
  if (vacuum) vacuum.classList.remove("open");

  const head = document.createElement("div");
  head.className = "h3tvHead";

  const hi = document.createElement("div");
  hi.className = "h3tvHeadIcon";
  hi.appendChild(icon("mdi:television", 23));

  const ht = document.createElement("div");
  ht.className = "h3tvHeadText";
  const title = document.createElement("div");
  title.className = "h3tvTitle";
  title.textContent = tv?.attributes?.friendly_name || entity;
  const sub = document.createElement("div");
  sub.className = "h3tvSub";
  sub.textContent = `${pretty(tv?.state)} · ${tv?.attributes?.app_name || "Controle remoto"}`;
  ht.append(title, sub);

  const close = button("", "mdi:close", "h3tvClose");
  close.onclick = () => menu.classList.remove("open");
  head.append(hi, ht, close);
  menu.appendChild(head);

  const remote = document.createElement("div");
  remote.className = "h3tvRemote";

  const top = document.createElement("div");
  top.className = "h3tvTop";

  const power = button("Power", "mdi:power", "h3tvBtn power");
  power.title = "Liga/desliga pela cena Tuya";
  power.onclick = async () => {
    power.disabled = true;
    try { await call(panel, "scene", "turn_on", TV_POWER_SCENE); }
    finally { power.disabled = false; }
  };

  const keyboardToggle = button("Teclado", "mdi:keyboard-outline");
  top.append(power, keyboardToggle);
  remote.appendChild(top);

  const dpad = document.createElement("div");
  dpad.className = "h3tvDpad";
  const dpadButtons = [
    ["up", "mdi:chevron-up", "DPAD_UP", "Cima"],
    ["left", "mdi:chevron-left", "DPAD_LEFT", "Esquerda"],
    ["ok", "", "DPAD_CENTER", "OK"],
    ["right", "mdi:chevron-right", "DPAD_RIGHT", "Direita"],
    ["down", "mdi:chevron-down", "DPAD_DOWN", "Baixo"],
  ];
  for (const [cls, mdi, command, label] of dpadButtons) {
    const b = button(cls === "ok" ? "OK" : "", mdi || "mdi:circle-outline", `h3tvBtn round ${cls}`);
    if (cls === "ok") b.classList.add("ok");
    b.title = label;
    b.onclick = () => sendRemote(panel, command);
    dpad.appendChild(b);
  }
  remote.appendChild(dpad);

  const nav = document.createElement("div");
  nav.className = "h3tvNav";
  const navButtons = [
    ["Voltar", "mdi:arrow-u-left-top", "BACK"],
    ["Home", "mdi:home-outline", "HOME"],
    ["Config.", "mdi:cog-outline", "SETTINGS"],
    ["Busca", "mdi:magnify", "SEARCH"],
  ];
  for (const [label, mdi, command] of navButtons) {
    const b = button(label, mdi, "h3tvMini");
    b.onclick = () => sendRemote(panel, command);
    nav.appendChild(b);
  }
  remote.appendChild(nav);

  const media = document.createElement("div");
  media.className = "h3tvMedia";
  const mediaButtons = [
    ["Vol +", "mdi:volume-plus", "VOLUME_UP"],
    ["Mute", "mdi:volume-mute", "MUTE"],
    ["Play", "mdi:play-pause", "MEDIA_PLAY_PAUSE"],
    ["Vol -", "mdi:volume-minus", "VOLUME_DOWN"],
  ];
  for (const [label, mdi, command] of mediaButtons) {
    const b = button(label, mdi, "h3tvMini");
    b.onclick = () => sendRemote(panel, command);
    media.appendChild(b);
  }
  remote.appendChild(media);

  const keyboard = document.createElement("div");
  keyboard.className = "h3tvKeyboard";

  const input = document.createElement("input");
  input.className = "h3tvInput";
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = "Digite na TV";

  const keyboardActions = document.createElement("div");
  keyboardActions.className = "h3tvKeyboardActions";

  const send = button("Enviar", "mdi:send");
  send.onclick = async () => {
    const value = input.value;
    await call(panel, "text", "set_value", TV_TEXT_ENTITY, { value });
    setTimeout(() => call(panel, "script", "turn_on", TV_TEXT_SCRIPT), 120);
  };

  const sendEnter = button("Enviar + Enter", "mdi:keyboard-return");
  sendEnter.onclick = async () => {
    const value = input.value;
    await call(panel, "text", "set_value", TV_TEXT_ENTITY, { value });
    setTimeout(() => call(panel, "script", "turn_on", TV_TEXT_ENTER_SCRIPT), 120);
  };

  keyboardActions.append(send, sendEnter);
  keyboard.append(input, keyboardActions);
  remote.appendChild(keyboard);

  keyboardToggle.onclick = () => {
    keyboard.classList.toggle("open");
    if (keyboard.classList.contains("open")) setTimeout(() => input.focus(), 20);
    requestAnimationFrame(() => position(panel, marker));
  };

  const stateLine = document.createElement("div");
  stateLine.className = "h3tvState";
  const left = document.createElement("span");
  left.textContent = "Estado";
  const right = document.createElement("strong");
  right.textContent = pretty(tv?.state);
  stateLine.append(left, right);
  remote.appendChild(stateLine);

  menu.appendChild(remote);
  menu.classList.add("open");
  requestAnimationFrame(() => position(panel, marker));
}

function install(panel) {
  const markers = panel?.shadowRoot?.querySelector("#markers");
  if (!markers || markers.__ha3dTvBindingMenu1) return;
  markers.__ha3dTvBindingMenu1 = true;

  markers.addEventListener("click", (event) => {
    if (panel._editorMode) return;
    const marker = event.target?.closest?.(".lightMarker");
    if (!marker) return;

    const found = findBinding(panel, marker);
    if (!found || !isTvBinding(panel, found.entity)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    render(panel, found.entity, marker);
  }, true);
}

if (!proto.__ha3dTvBindingMenu1) {
  proto.__ha3dTvBindingMenu1 = true;

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
