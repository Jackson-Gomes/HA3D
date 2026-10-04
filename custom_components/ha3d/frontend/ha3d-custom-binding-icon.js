// Optional per-binding MDI marker icon.
// Imported late so a configured icon can override fixed/default artwork without
// changing entity behavior, scene menus, or any 3D/media rendering.
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

function namesForObject(object) {
  const names = [];
  const original = String(object?.userData?.ha3dOriginalNodeName || "").trim();
  const current = String(object?.name || "").trim();
  if (original) names.push(original);
  if (current && current !== original) names.push(current);
  return names;
}

function configuredIcon(panel, entity, binding) {
  const advanced = panel?._config?.advanced_bindings || {};
  const objects = [binding?.anchor, ...(panel?._objectsByEntity?.get?.(entity) || [])].filter(Boolean);
  const seen = new Set();

  for (const start of objects) {
    let object = start;
    while (object) {
      if (!seen.has(object)) {
        seen.add(object);
        for (const name of namesForObject(object)) {
          const raw = String(advanced?.[name]?.marker_icon || "").trim();
          if (raw) return raw.includes(":") ? raw : `mdi:${raw}`;
        }
      }
      if (object === panel?._model) break;
      object = object.parent;
    }
  }
  return "";
}

function apply(panel) {
  for (const [entity, binding] of panel?._lightBindings?.entries?.() || []) {
    const marker = binding?.marker;
    if (!marker) continue;
    const iconName = configuredIcon(panel, entity, binding);
    if (!iconName) continue;

    let icon = marker.querySelector("ha-icon[data-ha3d-custom-binding-icon]");
    if (!icon) {
      marker.replaceChildren();
      icon = document.createElement("ha-icon");
      icon.dataset.ha3dCustomBindingIcon = "";
      icon.setAttribute("aria-hidden", "true");
      icon.style.width = "22px";
      icon.style.height = "22px";
      icon.style.pointerEvents = "none";
      icon.style.setProperty("--mdc-icon-size", "22px");
      marker.style.display = "grid";
      marker.style.placeItems = "center";
      marker.appendChild(icon);
    }
    icon.setAttribute("icon", iconName);
  }
}

if (!proto.__ha3dCustomBindingIconV1) {
  proto.__ha3dCustomBindingIconV1 = true;

  const oldBind = proto._bindEntityLightMarkers;
  proto._bindEntityLightMarkers = function (...args) {
    const result = oldBind?.apply(this, args);
    queueMicrotask(() => apply(this));
    return result;
  };

  const oldRenderEditor = proto._renderEditorForm;
  proto._renderEditorForm = async function (...args) {
    const result = await oldRenderEditor?.apply(this, args);
    queueMicrotask(() => apply(this));
    return result;
  };

  const hassDescriptor = Object.getOwnPropertyDescriptor(proto, "hass");
  if (hassDescriptor?.set) {
    Object.defineProperty(proto, "hass", {
      configurable: hassDescriptor.configurable ?? true,
      enumerable: hassDescriptor.enumerable ?? false,
      get: hassDescriptor.get,
      set(value) {
        hassDescriptor.set.call(this, value);
        queueMicrotask(() => apply(this));
      },
    });
  }
}
