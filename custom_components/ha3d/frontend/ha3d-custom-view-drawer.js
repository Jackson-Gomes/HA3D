const CUSTOM_VIEWS_KEY = "ha3d_custom_views_v1";
const SAVED_VIEWS_API = "ha3d/saved_views";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function readLocalViews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_VIEWS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function cacheViews(views) {
  try {
    localStorage.setItem(CUSTOM_VIEWS_KEY, JSON.stringify(Array.isArray(views) ? views : []));
  } catch (_error) {}
}

function cleanName(value, fallback) {
  const name = String(value ?? "").trim();
  return (name || fallback).slice(0, 80);
}

function askViewName(currentName, fallback) {
  const result = window.prompt("Nome da vista personalizada", currentName || fallback);
  if (result === null) return null;
  return cleanName(result, fallback);
}

function applyViews(panel, views) {
  panel._customViews = Array.isArray(views) ? views : [];
  panel._config = { ...(panel._config || {}), saved_views: panel._customViews };
  cacheViews(panel._customViews);
  panel._ha3dSharedViewsUpdated?.();
}

async function persistViews(panel, views) {
  if (!panel?._hass?.callApi) return false;
  try {
    const result = await panel._hass.callApi("POST", SAVED_VIEWS_API, { saved_views: views });
    applyViews(panel, result?.saved_views || views);
    renderPanelList(panel);
    renderDrawer(panel);
    panel._setStatus?.("Vistas salvas no Home Assistant");
    return true;
  } catch (error) {
    console.error("[HA3D] shared views save", error);
    panel._setStatus?.(`Erro ao salvar vistas: ${error.message || error}`);
    return false;
  }
}

async function refreshSharedViews(panel, migrateLocal = false) {
  if (!panel?._hass?.callApi || panel.__ha3dViewsSyncing) return;
  panel.__ha3dViewsSyncing = true;
  try {
    let result = await panel._hass.callApi("GET", SAVED_VIEWS_API);
    let views = Array.isArray(result?.saved_views) ? result.saved_views : [];

    const local = migrateLocal ? readLocalViews() : [];

    if (migrateLocal && !result?.initialized && local.length) {
      result = await panel._hass.callApi("POST", SAVED_VIEWS_API, { saved_views: local });
      views = Array.isArray(result?.saved_views) ? result.saved_views : local;
      panel._setStatus?.(`${views.length} vista(s) migrada(s) para o Home Assistant`);
    } else if (migrateLocal && !result?.layout_initialized && local.length && views.length) {
      const localById = new Map(local.map((item) => [String(item?.id), item]));
      let migrated = false;
      const merged = views.map((view) => {
        const cached = localById.get(String(view?.id));
        if (!cached) return view;
        const next = { ...view };
        if (!next.zone && cached.zone) {
          next.zone = cached.zone;
          migrated = true;
        }
        if (!Object.prototype.hasOwnProperty.call(next, "quick_access") && typeof cached.quick_access === "boolean") {
          next.quick_access = cached.quick_access;
          migrated = true;
        }
        return next;
      });
      if (migrated) {
        result = await panel._hass.callApi("POST", SAVED_VIEWS_API, { saved_views: merged });
        views = Array.isArray(result?.saved_views) ? result.saved_views : merged;
        panel._setStatus?.("Atalhos de vistas migrados para o Home Assistant");
      }
    }

    applyViews(panel, views);
    renderPanelList(panel);
    renderDrawer(panel);
  } catch (error) {
    console.error("[HA3D] shared views load", error);
    if (!Array.isArray(panel._customViews) || !panel._customViews.length) {
      applyViews(panel, readLocalViews());
    }
    renderPanelList(panel);
    renderDrawer(panel);
  } finally {
    panel.__ha3dViewsSyncing = false;
  }
}

async function renameView(panel, id) {
  const saved = panel._customViews?.find?.((item) => item.id === id);
  if (!saved) return;

  const nextName = askViewName(saved.name, saved.name || "Vista personalizada");
  if (nextName === null || nextName === saved.name) return;

  const next = (panel._customViews || []).map((item) =>
    item.id === id ? { ...item, name: nextName } : item
  );
  await persistViews(panel, next);
}

async function removeView(panel, id) {
  const next = (panel._customViews || []).filter((item) => item.id !== id);
  await persistViews(panel, next);
}

function ensureStyle(panel) {
  if (!panel.shadowRoot || panel.shadowRoot.querySelector("#ha3dCustomViewDrawerStyle")) return;

  const style = document.createElement("style");
  style.id = "ha3dCustomViewDrawerStyle";
  style.textContent = `
    #customViewsDrawer{
      position:absolute;
      left:50%;
      bottom:calc(max(14px,env(safe-area-inset-bottom)) + 58px);
      transform:translateX(-50%);
      z-index:34;
      display:none;
      width:min(330px,calc(100vw - 24px));
      max-height:min(46vh,420px);
      overflow:auto;
      padding:10px;
      border-radius:16px;
      background:color-mix(in srgb,var(--card-background-color,#15171d) 92%,transparent);
      border:1px solid rgba(255,255,255,.14);
      box-shadow:0 12px 34px rgba(0,0,0,.38);
      backdrop-filter:blur(18px);
      -webkit-backdrop-filter:blur(18px);
      pointer-events:auto;
    }
    #customViewsDrawer.open{display:block}
    #customViewsDrawer .customDrawerTitle{
      padding:3px 4px 9px;
      font-size:12px;
      font-weight:750;
      opacity:.8;
    }
    #customViewsDrawerList{display:grid;gap:6px}
    #customViewsDrawer .customDrawerRow{
      display:grid;
      grid-template-columns:minmax(0,1fr) 38px 38px;
      gap:6px;
    }
    #customViewsDrawer .customDrawerOpen{
      min-width:0;
      min-height:38px;
      padding:8px 10px;
      text-align:left;
      background:#24262c;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    #customViewsDrawer .customDrawerEdit,
    #customViewsDrawer .customDrawerDelete{
      width:38px;
      min-height:38px;
      padding:0;
      display:grid;
      place-items:center;
      background:#293343;
    }
    #customViewsDrawer .customDrawerDelete{background:#3a2424}
    #customViewsDrawer .customDrawerEmpty{
      padding:12px 8px;
      font-size:12px;
      opacity:.62;
      text-align:center;
    }
    #customViewsDrawerButton.active{
      background:color-mix(in srgb,var(--primary-color,#03a9f4) 28%,transparent);
      border-color:color-mix(in srgb,var(--primary-color,#03a9f4) 62%,transparent);
    }
    #viewsPanel .customRow{grid-template-columns:minmax(0,1fr) 40px 40px!important}
    #viewsPanel .customRow .ha3dRenameView{
      width:40px;
      padding:0;
      background:#293343;
    }
    #root.ha3d-idle-xray #customViewsDrawer,
    #root.ha3d-cinematic-active #customViewsDrawer{
      display:none!important;
    }
    @media(max-width:600px){
      #customViewsDrawer{
        bottom:calc(max(9px,env(safe-area-inset-bottom)) + 52px);
        width:min(320px,calc(100vw - 18px));
      }
    }
  `;
  panel.shadowRoot.appendChild(style);
}

function renderPanelList(panel) {
  const host = panel.shadowRoot?.querySelector("#customViews");
  if (!host) return;

  host.replaceChildren();
  for (const saved of panel._customViews || []) {
    const row = document.createElement("div");
    row.className = "customRow";

    const open = document.createElement("button");
    open.type = "button";
    open.textContent = saved.name || "Vista personalizada";
    open.title = saved.name || "Vista personalizada";
    open.addEventListener("click", () => panel._animateCameraTo?.(saved.view));

    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "ha3dRenameView";
    rename.textContent = "✎";
    rename.title = "Renomear vista";
    rename.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void renameView(panel, saved.id);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Excluir vista";
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void removeView(panel, saved.id);
    });

    row.append(open, rename, remove);
    host.appendChild(row);
  }
}

function renderDrawer(panel) {
  const drawer = panel.shadowRoot?.querySelector("#customViewsDrawer");
  const list = panel.shadowRoot?.querySelector("#customViewsDrawerList");
  if (!drawer || !list) return;

  list.replaceChildren();
  const views = panel._customViews || [];

  if (!views.length) {
    const empty = document.createElement("div");
    empty.className = "customDrawerEmpty";
    empty.textContent = "Nenhuma vista personalizada";
    list.appendChild(empty);
    return;
  }

  for (const saved of views) {
    const row = document.createElement("div");
    row.className = "customDrawerRow";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "customDrawerOpen";
    open.textContent = saved.name || "Vista personalizada";
    open.title = saved.name || "Vista personalizada";
    open.addEventListener("click", (event) => {
      event.stopPropagation();
      panel._animateCameraTo?.(saved.view);
      drawer.classList.remove("open");
      panel.shadowRoot?.querySelector("#customViewsDrawerButton")?.classList.remove("active");
    });

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "customDrawerEdit";
    edit.textContent = "✎";
    edit.title = "Renomear vista";
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      void renameView(panel, saved.id);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "customDrawerDelete";
    remove.textContent = "×";
    remove.title = "Excluir vista";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      void removeView(panel, saved.id);
    });

    row.append(open, edit, remove);
    list.appendChild(row);
  }
}

function bindTopViewsRefresh(panel) {
  const button = panel.shadowRoot?.querySelector("#viewsButton");
  if (!button || button.__ha3dSharedViewsRefreshBound) return;
  button.__ha3dSharedViewsRefreshBound = true;
  button.addEventListener("click", () => {
    void refreshSharedViews(panel, false);
  });
}

function ensureDrawer(panel) {
  const root = panel.shadowRoot?.querySelector("#root");
  const bar = panel.shadowRoot?.querySelector("#markerFilterBar");
  if (!root || !bar) return false;

  ensureStyle(panel);
  bindTopViewsRefresh(panel);

  let button = panel.shadowRoot.querySelector("#customViewsDrawerButton");
  if (!button) {
    button = document.createElement("button");
    button.id = "customViewsDrawerButton";
    button.className = "markerFilterButton";
    button.type = "button";
    button.textContent = "▤";
    button.title = "Vistas personalizadas";
    button.setAttribute("aria-label", "Vistas personalizadas");
    bar.appendChild(button);
  }

  let drawer = panel.shadowRoot.querySelector("#customViewsDrawer");
  if (!drawer) {
    drawer = document.createElement("div");
    drawer.id = "customViewsDrawer";
    drawer.className = "glass";
    drawer.innerHTML = `
      <div class="customDrawerTitle">Vistas personalizadas</div>
      <div id="customViewsDrawerList"></div>
    `;
    drawer.addEventListener("pointerdown", (event) => event.stopPropagation());
    drawer.addEventListener("click", (event) => event.stopPropagation());
    root.appendChild(drawer);
  }

  if (!button.__ha3dCustomViewsDrawerBound) {
    button.__ha3dCustomViewsDrawerBound = true;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = !drawer.classList.contains("open");
      drawer.classList.toggle("open", open);
      button.classList.toggle("active", open);
      if (open) void refreshSharedViews(panel, false);
    });
  }

  if (!root.__ha3dCustomViewsDrawerCloseBound) {
    root.__ha3dCustomViewsDrawerCloseBound = true;
    root.addEventListener("pointerdown", (event) => {
      const activeDrawer = panel.shadowRoot?.querySelector("#customViewsDrawer.open");
      const activeButton = panel.shadowRoot?.querySelector("#customViewsDrawerButton");
      if (!activeDrawer) return;
      if (activeDrawer.contains(event.target) || activeButton?.contains?.(event.target)) return;
      activeDrawer.classList.remove("open");
      activeButton?.classList.remove("active");
    });
  }

  renderPanelList(panel);
  renderDrawer(panel);
  return true;
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
  for (const panel of collectPanels(document)) ensureDrawer(panel);
}

if (!proto.__ha3dCustomViewDrawerV2) {
  proto.__ha3dCustomViewDrawerV2 = true;

  proto._saveCurrentView = async function () {
    if (!this._model) return;

    const fallback = `Vista ${(this._customViews || []).length + 1}`;
    const name = askViewName(fallback, fallback);
    if (name === null) return;

    const next = [
      ...(this._customViews || []),
      {
        id: `${Date.now()}`,
        name,
        view: this._captureCameraView(),
      },
    ];
    await persistViews(this, next);
  };

  proto._renderCustomViews = function () {
    renderPanelList(this);
    ensureDrawer(this);
    renderDrawer(this);
  };

  const originalLoadConfig = proto._loadConfig;
  proto._loadConfig = async function (...args) {
    const result = await originalLoadConfig?.apply(this, args);
    await refreshSharedViews(this, true);
    return result;
  };

  const originalConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = originalConnected?.apply(this, args);
    queueMicrotask(() => ensureDrawer(this));
    requestAnimationFrame(() => ensureDrawer(this));
    return result;
  };

  const originalBindMarkers = proto._bindEntityLightMarkers;
  proto._bindEntityLightMarkers = function (...args) {
    const result = originalBindMarkers?.apply(this, args);
    ensureDrawer(this);
    return result;
  };

  queueMicrotask(installOnExistingPanels);
  requestAnimationFrame(installOnExistingPanels);
  setTimeout(installOnExistingPanels, 250);
  setTimeout(installOnExistingPanels, 1000);
  setTimeout(installOnExistingPanels, 2500);
}
