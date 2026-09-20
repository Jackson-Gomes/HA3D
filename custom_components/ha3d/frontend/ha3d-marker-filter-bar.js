// Bottom marker filter bar: lights, devices, and all/none.
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function ensureFilterState(panel) {
  if (!panel._ha3dMarkerFilterMode) panel._ha3dMarkerFilterMode = "all";
}

function shouldShowEntity(entity, mode) {
  if (mode === "none") return false;
  if (mode === "all") return true;
  const domain = String(entity || "").split(".", 1)[0];
  if (mode === "lights") return domain === "light";
  if (mode === "devices") return domain !== "light";
  return true;
}

function syncFilterButtons(panel) {
  const bar = panel.shadowRoot?.querySelector("#markerFilterBar");
  if (!bar) return;

  const mode = panel._ha3dMarkerFilterMode || "all";
  for (const button of bar.querySelectorAll("[data-marker-filter]")) {
    const filter = button.dataset.markerFilter;
    const active =
      filter === mode ||
      (filter === "allnone" && (mode === "all" || mode === "none"));
    button.classList.toggle("active", active);
  }

  const allNone = bar.querySelector('[data-marker-filter="allnone"]');
  if (allNone) {
    allNone.textContent = mode === "all" ? "Nada" : "Tudo";
    allNone.title = mode === "all" ? "Ocultar todos os marcadores" : "Mostrar todos os marcadores";
  }
}

function applyMarkerFilter(panel) {
  ensureFilterState(panel);
  if (panel._cinematicActive) return;

  const mode = panel._ha3dMarkerFilterMode;
  for (const [entity, binding] of panel._lightBindings?.entries?.() || []) {
    if (!binding?.marker) continue;
    binding.marker.style.display = shouldShowEntity(entity, mode) ? "" : "none";
  }

  syncFilterButtons(panel);
}

function setFilterMode(panel, mode) {
  ensureFilterState(panel);
  panel._ha3dMarkerFilterMode = mode;
  applyMarkerFilter(panel);
}

function installFilterBar(panel) {
  const root = panel.shadowRoot?.querySelector("#root");
  if (!root || panel.shadowRoot.querySelector("#markerFilterBar")) return;

  const style = document.createElement("style");
  style.textContent = `
    #markerFilterBar{
      position:absolute;
      left:50%;
      bottom:max(14px,env(safe-area-inset-bottom));
      transform:translateX(-50%);
      z-index:24;
      display:flex;
      align-items:center;
      gap:6px;
      padding:6px;
      border-radius:16px;
      background:color-mix(in srgb,var(--card-background-color,#15171d) 88%,transparent);
      border:1px solid rgba(255,255,255,.12);
      box-shadow:0 8px 28px rgba(0,0,0,.30);
      backdrop-filter:blur(16px);
      -webkit-backdrop-filter:blur(16px);
      pointer-events:auto;
      transition:opacity .22s ease;
    }
    .markerFilterButton{
      min-height:34px;
      padding:7px 11px;
      border-radius:11px;
      border:1px solid transparent;
      background:transparent;
      color:var(--primary-text-color,#fff);
      font-size:12px;
      font-weight:650;
      white-space:nowrap;
      box-shadow:none;
    }
    .markerFilterButton:hover{background:rgba(255,255,255,.08)}
    .markerFilterButton.active{
      background:color-mix(in srgb,var(--primary-color,#03a9f4) 28%,transparent);
      border-color:color-mix(in srgb,var(--primary-color,#03a9f4) 62%,transparent);
    }
    #root.ha3d-cinematic-active #markerFilterBar{opacity:0;pointer-events:none}
    @media(max-width:600px){
      #markerFilterBar{bottom:max(9px,env(safe-area-inset-bottom));gap:3px;padding:4px}
      .markerFilterButton{padding:7px 9px;font-size:11px}
    }
  `;
  panel.shadowRoot.appendChild(style);

  const bar = document.createElement("div");
  bar.id = "markerFilterBar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Filtros de marcadores");
  bar.innerHTML = `
    <button class="markerFilterButton" data-marker-filter="lights" type="button">💡 Lâmpadas</button>
    <button class="markerFilterButton" data-marker-filter="devices" type="button">Aparelhos</button>
    <button class="markerFilterButton" data-marker-filter="allnone" type="button">Nada</button>
  `;

  bar.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-marker-filter]");
    if (!button) return;
    event.stopPropagation();

    const filter = button.dataset.markerFilter;
    if (filter === "allnone") {
      setFilterMode(panel, panel._ha3dMarkerFilterMode === "all" ? "none" : "all");
      return;
    }

    setFilterMode(panel, filter);
  });

  root.appendChild(bar);
  applyMarkerFilter(panel);
}

if (!proto.__ha3dMarkerFilterBarV1) {
  proto.__ha3dMarkerFilterBarV1 = true;

  const originalConnectedCallback = proto.connectedCallback;
  proto.connectedCallback = function () {
    ensureFilterState(this);
    originalConnectedCallback?.call(this);
    queueMicrotask(() => installFilterBar(this));
  };

  const originalBindMarkers = proto._bindEntityLightMarkers;
  proto._bindEntityLightMarkers = function (...args) {
    const result = originalBindMarkers?.apply(this, args);
    applyMarkerFilter(this);
    return result;
  };

  const originalRestoreCinematicUi = proto._restoreCinematicUi;
  proto._restoreCinematicUi = function (...args) {
    const result = originalRestoreCinematicUi?.apply(this, args);
    applyMarkerFilter(this);
    return result;
  };
}
