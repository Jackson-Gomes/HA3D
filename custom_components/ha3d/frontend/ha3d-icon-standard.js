// HA3D MDI icon standardization layer.
// Keeps existing marker/button behavior and only replaces visual glyphs with ha-icon/MDI.

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function objectId(entity) {
  return String(entity || "").split(".", 2)[1] || "";
}

function mdiForEntity(entity, state) {
  const domain = String(entity || "").split(".", 1)[0];
  const id = objectId(entity).toLowerCase();
  const deviceClass = String(state?.attributes?.device_class || "").toLowerCase();
  const on = state?.state === "on";

  if (domain === "light") return on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline";
  if (domain === "switch") {
    if (/(impressora|printer)/.test(id)) return "mdi:printer-3d-nozzle";
    return on ? "mdi:toggle-switch" : "mdi:toggle-switch-off-outline";
  }
  if (domain === "media_player") {
    if (/(xbox|playstation|console|game|gaming)/.test(id)) return "mdi:gamepad-variant";
    if (/(alexa|echo|speaker|som|audio)/.test(id)) return "mdi:speaker";
    if (/(tv|televis|television)/.test(id)) return "mdi:television";
    return "mdi:play-circle-outline";
  }
  if (domain === "vacuum") return "mdi:robot-vacuum";
  if (domain === "climate") return "mdi:thermostat";
  if (domain === "camera") return "mdi:cctv";
  if (domain === "lock") return on ? "mdi:lock-open-variant" : "mdi:lock";
  if (domain === "cover") return on ? "mdi:window-open" : "mdi:window-closed";
  if (domain === "fan") return "mdi:fan";
  if (domain === "scene") return "mdi:palette-outline";
  if (domain === "script") return "mdi:script-text-play-outline";
  if (domain === "automation") return "mdi:robot-outline";
  if (domain === "person") return "mdi:account";
  if (domain === "device_tracker") return "mdi:map-marker";
  if (domain === "weather") return "mdi:weather-partly-cloudy";
  if (domain === "alarm_control_panel") return "mdi:shield-home-outline";

  if (domain === "binary_sensor") {
    if (deviceClass === "window" || /(^|_)(janela|window)(_|$)/.test(id)) {
      return on ? "mdi:window-open" : "mdi:window-closed";
    }
    if (deviceClass === "door" || deviceClass === "opening" || /(^|_)(porta|door)(_|$)/.test(id)) {
      return on ? "mdi:door-open" : "mdi:door-closed";
    }
    if (deviceClass === "motion" || deviceClass === "occupancy" || deviceClass === "presence") return "mdi:motion-sensor";
    return on ? "mdi:radiobox-marked" : "mdi:radiobox-blank";
  }

  if (domain === "sensor") return "mdi:gauge";
  if (domain === "button") return "mdi:gesture-tap-button";
  return "mdi:circle-outline";
}

function renderMdiIntoButton(button, iconName) {
  if (!button || !iconName) return;
  let icon = button.querySelector("ha-icon[data-ha3d-standard-mdi]");
  if (!icon) {
    button.replaceChildren();
    icon = document.createElement("ha-icon");
    icon.dataset.ha3dStandardMdi = "";
    icon.style.width = "22px";
    icon.style.height = "22px";
    icon.style.pointerEvents = "none";
    button.appendChild(icon);
  }
  icon.setAttribute("icon", iconName);
}

function applyMarkerIcons(panel) {
  const states = panel._hass?.states || {};
  for (const [entity, binding] of panel._lightBindings?.entries?.() || []) {
    if (!binding?.marker) continue;
    const state = states[entity];
    renderMdiIntoButton(binding.marker, mdiForEntity(entity, state));
  }
}

const UI_ICONS = {
  viewsButton: "mdi:cog-outline",
  uploadButton: "mdi:cube-send",
  emptyUploadButton: "mdi:cube-send",
  saveViewButton: "mdi:content-save-outline",
  echoModeButton: "mdi:monitor-speaker",
  customViewsDrawerButton: "mdi:view-carousel-outline",
};

function applyInterfaceIcons(panel) {
  if (!panel.shadowRoot) return;

  for (const [id, mdi] of Object.entries(UI_ICONS)) {
    const button = panel.shadowRoot.querySelector(`#${id}`);
    if (!button) continue;
    renderMdiIntoButton(button, mdi);
  }

  const filterBar = panel.shadowRoot.querySelector("#markerFilterBar");
  if (filterBar) {
    const lights = filterBar.querySelector('[data-marker-filter="lights"]');
    const devices = filterBar.querySelector('[data-marker-filter="devices"]');
    const allNone = filterBar.querySelector('[data-marker-filter="allnone"]');
    if (lights) renderMdiIntoButton(lights, "mdi:lightbulb-group-outline");
    if (devices) renderMdiIntoButton(devices, "mdi:power-plug-outline");
    if (allNone) {
      const mode = panel._ha3dMarkerFilterMode || "all";
      renderMdiIntoButton(allNone, mode === "all" ? "mdi:eye-off-outline" : "mdi:eye-outline");
    }
  }

  for (const button of panel.shadowRoot.querySelectorAll("#viewsPanel [data-view]")) {
    const view = button.dataset.view;
    const map = {
      default: "mdi:home-outline",
      top: "mdi:arrow-down-bold-box-outline",
      a1: "mdi:camera-control",
      a2: "mdi:camera-control",
      a3: "mdi:camera-control",
      a4: "mdi:camera-control",
      low: "mdi:camera-marker-outline",
    };
    if (!button.dataset.ha3dOriginalLabel) button.dataset.ha3dOriginalLabel = button.textContent || "";
    const label = button.dataset.ha3dOriginalLabel;
    button.replaceChildren();
    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", map[view] || "mdi:camera-outline");
    icon.style.width = "18px";
    icon.style.height = "18px";
    icon.style.marginRight = "6px";
    icon.style.verticalAlign = "middle";
    icon.style.pointerEvents = "none";
    const text = document.createElement("span");
    text.textContent = label;
    button.append(icon, text);
  }
}

function applyAll(panel) {
  applyMarkerIcons(panel);
  applyInterfaceIcons(panel);
}

function collectPanels(root, found = new Set()) {
  if (!root?.querySelectorAll) return found;
  for (const element of root.querySelectorAll("*")) {
    if (element.localName === "ha3d-panel") found.add(element);
    if (element.shadowRoot) collectPanels(element.shadowRoot, found);
  }
  return found;
}

function installOnExistingPanels() {
  for (const panel of collectPanels(document)) applyAll(panel);
}

if (!proto.__ha3dIconStandardV1) {
  proto.__ha3dIconStandardV1 = true;

  const originalConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = originalConnected?.apply(this, args);
    queueMicrotask(() => applyAll(this));
    requestAnimationFrame(() => applyAll(this));
    return result;
  };

  const originalBindMarkers = proto._bindEntityLightMarkers;
  proto._bindEntityLightMarkers = function (...args) {
    const result = originalBindMarkers?.apply(this, args);
    queueMicrotask(() => applyAll(this));
    return result;
  };

  const originalRenderCustomViews = proto._renderCustomViews;
  proto._renderCustomViews = function (...args) {
    const result = originalRenderCustomViews?.apply(this, args);
    queueMicrotask(() => applyInterfaceIcons(this));
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
        queueMicrotask(() => applyAll(this));
      },
    });
  }

  const originalRestoreCinematicUi = proto._restoreCinematicUi;
  proto._restoreCinematicUi = function (...args) {
    const result = originalRestoreCinematicUi?.apply(this, args);
    queueMicrotask(() => applyInterfaceIcons(this));
    return result;
  };

  queueMicrotask(installOnExistingPanels);
  requestAnimationFrame(installOnExistingPanels);
  setTimeout(installOnExistingPanels, 250);
  setTimeout(installOnExistingPanels, 1000);
  setTimeout(installOnExistingPanels, 2500);
}
