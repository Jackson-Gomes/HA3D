const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function entityDomain(entityId) {
  return String(entityId || "").split(".", 1)[0];
}

function formatState(panel, entityId, reading = null) {
  const state = panel?._hass?.states?.[entityId];
  if (!state) return null;

  let value;
  if (reading?.attribute) value = state.attributes?.[reading.attribute];
  else value = state.state;
  if (value === undefined || value === null || value === "") return null;

  if (["unknown", "unavailable"].includes(String(value))) return "—";

  const unit = !reading?.attribute ? state.attributes?.unit_of_measurement : null;
  const numeric = Number(value);
  const text = Number.isFinite(numeric)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(numeric)
    : String(value);
  return unit ? `${text} ${unit}` : text;
}

function advancedConfig(panel, entityId) {
  return Object.values(panel?._config?.advanced_bindings || {})
    .find((item) => item?.entity_id === entityId) || null;
}

function ensureStyle(panel) {
  if (!panel?.shadowRoot || panel.shadowRoot.querySelector("#ha3dSensorValueStyle")) return;
  const style = document.createElement("style");
  style.id = "ha3dSensorValueStyle";
  style.textContent = `
    .lightMarker{overflow:visible}
    .lightMarker .ha3dSensorValue{
      position:absolute;
      left:50%;
      top:calc(100% + 5px);
      transform:translateX(-50%);
      display:block;
      min-width:max-content;
      max-width:190px;
      padding:3px 7px;
      border-radius:999px;
      background:rgba(18,20,25,.90);
      border:1px solid rgba(255,255,255,.16);
      box-shadow:0 3px 10px rgba(0,0,0,.32);
      color:var(--primary-text-color,#fff);
      font:600 11px/1.2 system-ui,sans-serif;
      white-space:nowrap;
      pointer-events:none;
      backdrop-filter:blur(7px);
      -webkit-backdrop-filter:blur(7px);
    }
    .lightMarker.ha3dSensorMarker{border-color:rgba(128,200,255,.72)}
    @media(max-width:600px){.lightMarker .ha3dSensorValue{font-size:10px;padding:3px 6px}}
  `;
  panel.shadowRoot.appendChild(style);
}

function syncSensorValue(panel, entityId, binding) {
  const marker = binding?.marker;
  if (!marker) return;
  const domain = entityDomain(entityId);
  const config = advancedConfig(panel, entityId);
  const readings = Array.isArray(config?.readings) ? config.readings : [];
  const primaryIsSensor = domain === "sensor" || domain === "binary_sensor";
  if (!primaryIsSensor && !readings.length) {
    marker.querySelector(".ha3dSensorValue")?.remove();
    marker.classList.remove("ha3dSensorMarker");
    return;
  }

  const values = [];
  if (primaryIsSensor) {
    const primary = formatState(panel, entityId);
    if (primary) values.push(primary);
  }
  for (const reading of readings) {
    const item = typeof reading === "string" ? { entity_id: reading } : reading;
    if (!item?.entity_id) continue;
    const value = formatState(panel, item.entity_id, item);
    if (value) values.push(value);
  }

  let label = marker.querySelector(".ha3dSensorValue");
  if (!values.length) {
    label?.remove();
    marker.classList.remove("ha3dSensorMarker");
    return;
  }

  if (!label) {
    label = document.createElement("span");
    label.className = "ha3dSensorValue";
    marker.appendChild(label);
  }
  label.textContent = values.join(" · ");
  marker.classList.toggle("ha3dSensorMarker", primaryIsSensor);
}

function syncAll(panel) {
  ensureStyle(panel);
  for (const [entityId, binding] of panel?._lightBindings?.entries?.() || []) {
    syncSensorValue(panel, entityId, binding);
  }
}

if (!proto.__ha3dSensorValuesV1) {
  proto.__ha3dSensorValuesV1 = true;

  const oldSync = proto._syncLightStates;
  proto._syncLightStates = function (...args) {
    const result = oldSync?.apply(this, args);
    syncAll(this);
    return result;
  };

  const oldBindAdvanced = proto._bindAdvancedMarkers;
  if (oldBindAdvanced) {
    proto._bindAdvancedMarkers = function (...args) {
      const result = oldBindAdvanced.apply(this, args);
      syncAll(this);
      return result;
    };
  }

  const hassDescriptor = Object.getOwnPropertyDescriptor(proto, "hass");
  if (hassDescriptor?.set) {
    Object.defineProperty(proto, "hass", {
      configurable: true,
      enumerable: hassDescriptor.enumerable,
      get: hassDescriptor.get,
      set(value) {
        hassDescriptor.set.call(this, value);
        queueMicrotask(() => syncAll(this));
      },
    });
  }
}
