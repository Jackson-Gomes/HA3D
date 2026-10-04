// UI-only TV control for media_player TV bindings.
// Uses the existing Android TV Remote entity and the Tuya power scene.
// Does not modify LightMedia, robot/map runtime, or the vacuum menu.
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const TV_MEDIA_ENTITY = "media_player.sala_de_estar_tv_da_sala";
const TV_REMOTE_ENTITY = "remote.sala_de_estar_tv_da_sala";
const TV_POWER_SCENE = "scene.ligar_tv";

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
      position:absolute;z-index:82;display:none;width:min(420px,calc(100vw - 18px));
      max-height:min(82vh,720px);overflow:auto;padding:10px;border-radius:18px;
      background:color-mix(in srgb,var(--card-background-color,#15171d) 95%,transparent);
      border:1px solid rgba(255,255,255,.15);box-shadow:0 14px 42px rgba(0,0,0,.42);
      backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);pointer-events:auto;
    }
    #ha3dTvMenu.open{display:block}
    .h3tvHead{display:flex;align-items:center;gap:9px;padding:1px 2px 8px}
    .h3tvHeadIcon{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(255,255,255,.08)}
    .h3tvHeadText{min-width:0;flex:1}.h3tvTitle{font-size:14px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .h3tvSub{font-size:10px;opacity:.62;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .h3tvClose{width:32px;height:32px;min-height:32px;padding:0;border-radius:10px;background:#24262c}
    .h3tvSection{padding-top:9px;margin-top:2px;border-top:1px solid rgba(255,255,255,.10)}
    .h3tvSection:first-of-type{border-top:0;padding-top:0}
    .h3tvSectionTitle{font-size:10px;font-weight:750;opacity:.66;margin:0 2px 7px;text-transform:uppercase;letter-spacing:.05em}
    .h3tvTop{display:grid;grid-template-columns:1fr 1fr;gap:7px}
    .h3tvBtn{border:1px solid rgba(255,255,255,.10);background:#2a2d34;color:var(--primary-text-color,#fff);border-radius:12px;min-height:42px;padding:7px;display:flex;align-items:center;justify-content:center;gap:6px;font-size:10px;font-weight:700}
    .h3tvBtn:active{transform:translateY(1px)}
    .h3tvBtn.power{background:color-mix(in srgb,#d63d3d 72%,#24262c)}
    .h3tvControls{display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:stretch}
    .h3tvDpad{display:grid;grid-template-columns:46px 46px 46px;grid-template-rows:46px 46px 46px;gap:4px;justify-content:center;align-items:center;padding:3px}
    .h3tvDpad .up{grid-column:2;grid-row:1}.h3tvDpad .left{grid-column:1;grid-row:2}.h3tvDpad .right{grid-column:3;grid-row:2}.h3tvDpad .down{grid-column:2;grid-row:3}
    .h3tvRound{width:46px;height:46px;min-height:46px;padding:0;border-radius:50%}
    .h3tvQuick{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
    .h3tvMini{min-height:49px;padding:6px 4px;border-radius:11px;background:#262930;border:1px solid rgba(255,255,255,.09);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:9px;font-weight:700;text-align:center}
    .h3tvTouchpad{
      position:relative;height:150px;border-radius:15px;overflow:hidden;touch-action:none;user-select:none;
      background:
        radial-gradient(circle at center,rgba(255,255,255,.055),transparent 34%),
        linear-gradient(180deg,#22252b,#1b1d22);
      border:1px solid rgba(255,255,255,.10);
      display:flex;align-items:center;justify-content:center;
    }
    .h3tvTouchpad::before{
      content:"";position:absolute;inset:10px;border-radius:12px;border:1px dashed rgba(255,255,255,.09);pointer-events:none
    }
    .h3tvTouchpadHint{font-size:11px;opacity:.50;text-align:center;line-height:1.35;pointer-events:none}
    .h3tvTouchpadHint ha-icon{display:block;margin:0 auto 5px}
    .h3tvTouchpad.active{background:color-mix(in srgb,var(--primary-color,#03a9f4) 13%,#1d2026)}
    .h3tvKeyboardRow{display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center}
    .h3tvInput{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.16);background:#111319;color:var(--primary-text-color,#fff);border-radius:11px;padding:11px;font-size:15px;outline:none}
    .h3tvKeyAction{width:44px;height:42px;min-height:42px;padding:0;border-radius:11px}
    .h3tvKeyboardHelp{font-size:10px;opacity:.58;margin-top:6px;line-height:1.35}
    .h3tvState{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;padding:7px 9px;border-radius:10px;background:rgba(255,255,255,.05);font-size:10px}
    .h3tvState strong{font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    @media(max-width:600px){
      #ha3dTvMenu{width:min(400px,calc(100vw - 14px));padding:8px}
      .h3tvControls{grid-template-columns:142px 1fr;gap:8px}
      .h3tvTouchpad{height:140px}
    }
    @media(max-width:390px){
      .h3tvControls{grid-template-columns:1fr}
      .h3tvDpad{order:2}
      .h3tvQuick{grid-template-columns:repeat(4,minmax(0,1fr))}
      .h3tvMini{min-height:46px}
    }
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

function queueRemote(panel, command, extra = {}) {
  const run = () => call(panel, "remote", "send_command", TV_REMOTE_ENTITY, { command, ...extra });
  const previous = panel.__ha3dTvRemoteQueue || Promise.resolve();
  panel.__ha3dTvRemoteQueue = previous.catch(() => {}).then(run);
  return panel.__ha3dTvRemoteQueue;
}

function sendRemote(panel, command, extra = {}) {
  return queueRemote(panel, command, extra);
}

function sendTextChars(panel, text) {
  for (const char of Array.from(text || "")) {
    queueRemote(panel, `text:${char}`);
  }
}

function sendDelete(panel, count = 1) {
  for (let i = 0; i < count; i += 1) queueRemote(panel, "DEL");
}

function button(label, mdi, className = "h3tvBtn") {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  if (mdi) el.appendChild(icon(mdi, className.includes("h3tvMini") ? 19 : 20));
  if (label) {
    const span = document.createElement("span");
    span.textContent = label;
    el.appendChild(span);
  }
  return el;
}

function commonPrefixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function wireLiveKeyboard(panel, input) {
  let previousValue = "";

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendRemote(panel, "ENTER");
    }
  });

  input.addEventListener("input", () => {
    const nextValue = input.value;
    if (nextValue === previousValue) return;

    const prefix = commonPrefixLength(previousValue, nextValue);
    const removed = previousValue.length - prefix;
    const added = nextValue.slice(prefix);

    if (removed > 0) sendDelete(panel, removed);
    if (added) sendTextChars(panel, added);

    previousValue = nextValue;
  });

  input.addEventListener("focus", () => {
    previousValue = input.value || "";
  });

  input.__ha3dResetLiveKeyboard = () => {
    previousValue = input.value || "";
  };
}

function wireTouchpad(panel, pad) {
  let startX = 0;
  let startY = 0;
  let activePointer = null;

  const finish = (event) => {
    if (activePointer === null || event.pointerId !== activePointer) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const distance = Math.hypot(dx, dy);

    pad.classList.remove("active");
    try { pad.releasePointerCapture(event.pointerId); } catch (_) {}
    activePointer = null;

    if (distance < 14) {
      sendRemote(panel, "DPAD_CENTER");
      return;
    }

    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const command = horizontal
      ? (dx > 0 ? "DPAD_RIGHT" : "DPAD_LEFT")
      : (dy > 0 ? "DPAD_DOWN" : "DPAD_UP");

    const repeats = Math.max(1, Math.min(5, Math.ceil(distance / 55)));
    sendRemote(panel, command, { num_repeats: repeats, delay_secs: 0.08 });
  };

  pad.addEventListener("pointerdown", (event) => {
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    pad.classList.add("active");
    try { pad.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
  });

  pad.addEventListener("pointerup", finish);
  pad.addEventListener("pointercancel", () => {
    pad.classList.remove("active");
    activePointer = null;
  });
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

  const powerSection = document.createElement("div");
  powerSection.className = "h3tvSection";
  const top = document.createElement("div");
  top.className = "h3tvTop";

  const power = button("Power", "mdi:power", "h3tvBtn power");
  power.title = "Liga/desliga pela cena Tuya";
  power.onclick = async () => {
    power.disabled = true;
    try { await call(panel, "scene", "turn_on", TV_POWER_SCENE); }
    finally { power.disabled = false; }
  };

  const keyboardFocus = button("Abrir teclado", "mdi:keyboard-outline");
  top.append(power, keyboardFocus);
  powerSection.appendChild(top);
  menu.appendChild(powerSection);

  const controlsSection = document.createElement("div");
  controlsSection.className = "h3tvSection";
  const controlsTitle = document.createElement("div");
  controlsTitle.className = "h3tvSectionTitle";
  controlsTitle.textContent = "Controle";
  const controls = document.createElement("div");
  controls.className = "h3tvControls";

  const dpad = document.createElement("div");
  dpad.className = "h3tvDpad";
  const dpadButtons = [
    ["up", "mdi:chevron-up", "DPAD_UP", "Cima"],
    ["left", "mdi:chevron-left", "DPAD_LEFT", "Esquerda"],
    ["right", "mdi:chevron-right", "DPAD_RIGHT", "Direita"],
    ["down", "mdi:chevron-down", "DPAD_DOWN", "Baixo"],
  ];
  for (const [cls, mdi, command, label] of dpadButtons) {
    const b = button("", mdi, `h3tvBtn h3tvRound ${cls}`);
    b.title = label;
    b.onclick = () => sendRemote(panel, command);
    dpad.appendChild(b);
  }

  const quick = document.createElement("div");
  quick.className = "h3tvQuick";
  const quickButtons = [
    ["Voltar", "mdi:arrow-u-left-top", "BACK"],
    ["Home", "mdi:home-outline", "HOME"],
    ["Config.", "mdi:cog-outline", "SETTINGS"],
    ["Busca", "mdi:magnify", "SEARCH"],
    ["Vol +", "mdi:volume-plus", "VOLUME_UP"],
    ["Mute", "mdi:volume-mute", "MUTE"],
    ["Play", "mdi:play-pause", "MEDIA_PLAY_PAUSE"],
    ["Vol -", "mdi:volume-minus", "VOLUME_DOWN"],
  ];
  for (const [label, mdi, command] of quickButtons) {
    const b = button(label, mdi, "h3tvMini");
    if (command === "SEARCH") {
      b.onclick = async () => {
        await sendRemote(panel, command);
        setTimeout(() => {
          const input = panel.shadowRoot?.querySelector("#ha3dTvLiveInput");
          input?.focus?.();
        }, 300);
      };
    } else {
      b.onclick = () => sendRemote(panel, command);
    }
    quick.appendChild(b);
  }

  controls.append(dpad, quick);
  controlsSection.append(controlsTitle, controls);
  menu.appendChild(controlsSection);

  const touchSection = document.createElement("div");
  touchSection.className = "h3tvSection";
  const touchTitle = document.createElement("div");
  touchTitle.className = "h3tvSectionTitle";
  touchTitle.textContent = "Touchpad";
  const touchpad = document.createElement("div");
  touchpad.className = "h3tvTouchpad";
  const hint = document.createElement("div");
  hint.className = "h3tvTouchpadHint";
  hint.appendChild(icon("mdi:gesture-swipe", 25));
  const hintText = document.createElement("div");
  hintText.textContent = "Arraste para navegar · toque para selecionar";
  hint.appendChild(hintText);
  touchpad.appendChild(hint);
  wireTouchpad(panel, touchpad);
  touchSection.append(touchTitle, touchpad);
  menu.appendChild(touchSection);

  const keyboardSection = document.createElement("div");
  keyboardSection.className = "h3tvSection";
  const keyboardTitle = document.createElement("div");
  keyboardTitle.className = "h3tvSectionTitle";
  keyboardTitle.textContent = "Teclado ao vivo";
  const keyboardRow = document.createElement("div");
  keyboardRow.className = "h3tvKeyboardRow";

  const input = document.createElement("input");
  input.id = "ha3dTvLiveInput";
  input.className = "h3tvInput";
  input.type = "text";
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  input.placeholder = "Digite aqui";

  const del = button("", "mdi:backspace-outline", "h3tvBtn h3tvKeyAction");
  del.title = "Apagar";
  del.onclick = () => {
    if (input.value.length) {
      input.value = input.value.slice(0, -1);
      input.__ha3dResetLiveKeyboard?.();
    }
    sendRemote(panel, "DEL");
    input.focus();
  };

  const enter = button("", "mdi:keyboard-return", "h3tvBtn h3tvKeyAction");
  enter.title = "Enter";
  enter.onclick = () => {
    sendRemote(panel, "ENTER");
    input.focus();
  };

  wireLiveKeyboard(panel, input);
  keyboardRow.append(input, del, enter);

  const keyboardHelp = document.createElement("div");
  keyboardHelp.className = "h3tvKeyboardHelp";
  keyboardHelp.textContent = "Cada letra é enviada imediatamente para o campo que estiver selecionado na TV. Backspace apaga uma letra por vez.";

  keyboardSection.append(keyboardTitle, keyboardRow, keyboardHelp);
  menu.appendChild(keyboardSection);

  keyboardFocus.onclick = () => {
    input.focus();
    requestAnimationFrame(() => position(panel, marker));
  };

  const stateLine = document.createElement("div");
  stateLine.className = "h3tvState";
  const left = document.createElement("span");
  left.textContent = "Estado";
  const right = document.createElement("strong");
  right.textContent = pretty(tv?.state);
  stateLine.append(left, right);
  menu.appendChild(stateLine);

  menu.classList.add("open");
  requestAnimationFrame(() => position(panel, marker));
}

function install(panel) {
  const markers = panel?.shadowRoot?.querySelector("#markers");
  if (!markers || markers.__ha3dTvBindingMenu2) return;
  markers.__ha3dTvBindingMenu2 = true;

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

if (!proto.__ha3dTvBindingMenu2) {
  proto.__ha3dTvBindingMenu2 = true;

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
