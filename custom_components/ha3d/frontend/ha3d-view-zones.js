import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const VIEWS_KEY = "ha3d_custom_views_v1";
const LONG_PRESS_MS = 620;

function persistViews(panel) {
  localStorage.setItem(VIEWS_KEY, JSON.stringify(panel._customViews || []));
}

function savedView(panel, id) {
  return (panel._customViews || []).find((item) => String(item.id) === String(id)) || null;
}

function modelMetrics(panel) {
  if (!panel?._model) return { center: new THREE.Vector3(), minY: 0, maxY: 1, scale: 10 };
  const box = new THREE.Box3().setFromObject(panel._model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = Math.max(size.x, size.y, size.z) || 10;
  return { center, minY: box.min.y, maxY: box.max.y, scale };
}

function zoneDefaults(panel) {
  const metrics = modelMetrics(panel);
  return {
    x: metrics.center.x,
    z: metrics.center.z,
    y: metrics.minY + metrics.scale * 0.006,
    width: metrics.scale * 0.18,
    depth: metrics.scale * 0.18,
    show: true,
  };
}

function normalizeZone(panel, value) {
  const defaults = zoneDefaults(panel);
  const src = value || {};
  const number = (key, fallback) => Number.isFinite(Number(src[key])) ? Number(src[key]) : fallback;
  return {
    x: number("x", defaults.x),
    z: number("z", defaults.z),
    y: number("y", defaults.y),
    width: Math.max(0.001, Math.abs(number("width", defaults.width))),
    depth: Math.max(0.001, Math.abs(number("depth", defaults.depth))),
    show: src.show !== false,
  };
}

function ensureStyle(panel) {
  if (!panel?.shadowRoot || panel.shadowRoot.querySelector("#ha3dViewZonesStyle")) return;
  const style = document.createElement("style");
  style.id = "ha3dViewZonesStyle";
  style.textContent = `
    #customViewsDrawerButton,#customViewsDrawer{display:none!important}
    #viewsPanel{width:min(390px,calc(100vw - 24px))}
    #viewsPanel .customViews{display:grid;gap:7px}
    #viewsPanel .customRow{
      display:grid!important;
      grid-template-columns:minmax(0,1fr) 36px 38px 38px!important;
      gap:6px;
      align-items:center;
    }
    #viewsPanel .ha3dViewQuick{
      width:36px;height:36px;display:grid;place-items:center;
      border-radius:10px;background:#20242b;border:1px solid rgba(255,255,255,.1)
    }
    #viewsPanel .ha3dViewQuick input{width:18px;height:18px;margin:0}
    #viewsPanel .ha3dViewEdit,#viewsPanel .ha3dViewDelete{
      width:38px;min-height:38px;padding:0;display:grid;place-items:center
    }
    #viewsPanel .ha3dViewEdit{background:#293343}
    #viewsPanel .ha3dViewDelete{background:#3a2424}
    #ha3dViewZoneEditor{
      display:none;margin-top:10px;padding:10px;border-radius:13px;
      background:rgba(16,18,23,.72);border:1px solid rgba(255,255,255,.12)
    }
    #ha3dViewZoneEditor.open{display:block}
    #ha3dViewZoneEditor h4{margin:0 0 8px;font-size:13px}
    #ha3dViewZoneEditor .vzRow{display:grid;gap:5px;margin:8px 0}
    #ha3dViewZoneEditor label{font-size:11px;opacity:.78}
    #ha3dViewZoneEditor input[type=text],#ha3dViewZoneEditor input[type=number]{
      width:100%;padding:7px;border-radius:8px;border:1px solid #ffffff2b;background:#111;color:inherit
    }
    #ha3dViewZoneEditor input[type=range]{width:100%}
    #ha3dViewZoneEditor .vzGrid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
    #ha3dViewZoneEditor .vzActions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
    #ha3dViewZoneEditor .vzHint{font-size:10px;opacity:.62;line-height:1.35}
    #ha3dViewZoneEditor .vzCheck{display:flex;align-items:center;gap:7px;font-size:11px}
    #ha3dViewZoneEditor .vzValue{font-size:10px;opacity:.7;text-align:right}
  `;
  panel.shadowRoot.appendChild(style);
}

function disposeZoneMesh(mesh) {
  if (!mesh) return;
  mesh.parent?.remove(mesh);
  mesh.geometry?.dispose?.();
  mesh.material?.dispose?.();
  mesh.traverse?.((child) => {
    if (child === mesh) return;
    child.geometry?.dispose?.();
    child.material?.dispose?.();
  });
}

function rebuildZoneMeshes(panel) {
  if (!panel?._scene) return;
  panel._ha3dViewZoneMeshes ||= new Map();
  for (const mesh of panel._ha3dViewZoneMeshes.values()) disposeZoneMesh(mesh);
  panel._ha3dViewZoneMeshes.clear();

  for (const view of panel._customViews || []) {
    if (!view.zone) continue;
    view.zone = normalizeZone(panel, view.zone);
    const zone = view.zone;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0x4fc3f7,
      transparent: true,
      opacity: zone.show ? 0.16 : 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `HA3D_ViewZone_${view.id}`;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(zone.x, zone.y, zone.z);
    mesh.scale.set(zone.width, zone.depth, 1);
    mesh.renderOrder = 8;
    mesh.userData.ha3dEditorHelper = true;
    mesh.userData.ha3dViewZoneId = String(view.id);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x8ad9ff, transparent: true, opacity: zone.show ? 0.72 : 0 }),
    );
    edges.position.z = 0.001;
    edges.userData.ha3dEditorHelper = true;
    mesh.add(edges);

    panel._scene.add(mesh);
    panel._ha3dViewZoneMeshes.set(String(view.id), mesh);
  }
}

function updateZoneMesh(panel, view) {
  if (!view?.zone) return;
  view.zone = normalizeZone(panel, view.zone);
  let mesh = panel._ha3dViewZoneMeshes?.get?.(String(view.id));
  if (!mesh) {
    rebuildZoneMeshes(panel);
    mesh = panel._ha3dViewZoneMeshes?.get?.(String(view.id));
  }
  if (!mesh) return;
  const zone = view.zone;
  mesh.position.set(zone.x, zone.y, zone.z);
  mesh.scale.set(zone.width, zone.depth, 1);
  mesh.material.opacity = zone.show ? 0.16 : 0;
  const edges = mesh.children?.[0];
  if (edges?.material) edges.material.opacity = zone.show ? 0.72 : 0;
}

function setQuickAccess(panel, id, checked) {
  for (const view of panel._customViews || []) view.quick_access = checked && String(view.id) === String(id);
  persistViews(panel);
  panel._renderCustomViews?.();
}

function activateQuickAccess(panel) {
  const quick = (panel._customViews || []).find((view) => view.quick_access && view.view);
  if (quick) panel._animateCameraTo?.(quick.view);
  else panel._applyCameraView?.("default");
}

function panelBounds(panel) {
  const metrics = modelMetrics(panel);
  return {
    min: metrics.minY - metrics.scale * 0.15,
    max: metrics.maxY + metrics.scale * 0.15,
    step: Math.max(metrics.scale / 500, 0.001),
    moveStep: Math.max(metrics.scale / 200, 0.005),
  };
}

function pointOnZonePlane(panel, event, y) {
  const canvas = panel?._renderer?.domElement;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  panel._pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  panel._raycaster.setFromCamera(panel._pointer, panel._camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
  const point = new THREE.Vector3();
  return panel._raycaster.ray.intersectPlane(plane, point) ? point : null;
}

function startZoneDrawing(panel, viewId) {
  const view = savedView(panel, viewId);
  if (!view) return;
  if (!view.zone) view.zone = zoneDefaults(panel);
  view.zone.show = true;
  panel._ha3dZoneDrawViewId = String(viewId);
  updateZoneMesh(panel, view);
  panel._setStatus?.("Zona da vista: arraste no piso para desenhar o retângulo");
}

function installCanvasZoneGestures(panel) {
  const canvas = panel?._renderer?.domElement;
  if (!canvas || canvas.__ha3dViewZonesBound) return;
  canvas.__ha3dViewZonesBound = true;

  canvas.addEventListener("pointerdown", (event) => {
    const drawId = panel._ha3dZoneDrawViewId;
    if (drawId) {
      const view = savedView(panel, drawId);
      if (!view) { panel._ha3dZoneDrawViewId = null; return; }
      if (!view.zone) view.zone = zoneDefaults(panel);
      const start = pointOnZonePlane(panel, event, view.zone.y);
      if (!start) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const minimum = modelMetrics(panel).scale * 0.01;
      const pointerId = event.pointerId;

      const move = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const point = pointOnZonePlane(panel, moveEvent, view.zone.y);
        if (!point) return;
        view.zone.x = (start.x + point.x) / 2;
        view.zone.z = (start.z + point.z) / 2;
        view.zone.width = Math.max(minimum, Math.abs(point.x - start.x));
        view.zone.depth = Math.max(minimum, Math.abs(point.z - start.z));
        view.zone.show = true;
        updateZoneMesh(panel, view);
      };
      const up = (upEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", up, true);
        panel._ha3dZoneDrawViewId = null;
        persistViews(panel);
        updateZoneMesh(panel, view);
        renderZoneEditor(panel, view.id);
        panel._setStatus?.(`Zona vinculada à vista ${view.name || "personalizada"}`);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", up, true);
      return;
    }

    if (panel._editorMode || panel._robotCalibrationMarker || panel._cameraAnimating) return;
    const meshes = [...(panel._ha3dViewZoneMeshes?.values?.() || [])];
    if (!meshes.length) return;
    const rect = canvas.getBoundingClientRect();
    panel._pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    panel._raycaster.setFromCamera(panel._pointer, panel._camera);
    const hit = panel._raycaster.intersectObjects(meshes, false)[0];
    const id = hit?.object?.userData?.ha3dViewZoneId;
    if (!id) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    event.preventDefault();
    event.stopImmediatePropagation();

    const up = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      const moved = Math.hypot(upEvent.clientX - startX, upEvent.clientY - startY);
      if (moved > 10) return;
      const view = savedView(panel, id);
      if (view?.view) panel._animateCameraTo?.(view.view);
    };
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  }, true);
}

function renderZoneEditor(panel, id) {
  const editor = panel.shadowRoot?.querySelector("#ha3dViewZoneEditor");
  const view = savedView(panel, id);
  if (!editor || !view) return;
  panel._ha3dEditingViewId = String(id);
  const limits = panelBounds(panel);
  const zone = view.zone ? normalizeZone(panel, view.zone) : null;
  if (zone) view.zone = zone;

  editor.classList.add("open");
  editor.innerHTML = `
    <h4>Editar vista</h4>
    <div class="vzRow"><label>Nome</label><input id="vzName" type="text" value="${String(view.name || "Vista").replaceAll('"','&quot;')}"></div>
    <label class="vzCheck"><input id="vzQuick" type="checkbox" ${view.quick_access ? "checked" : ""}> Acesso rápido pelo botão Vistas</label>
    <label class="vzCheck"><input id="vzShow" type="checkbox" ${zone?.show !== false ? "checked" : ""} ${zone ? "" : "disabled"}> Mostrar retângulo no piso</label>
    <div class="vzRow">
      <label>Altura da zona</label>
      <input id="vzY" type="range" min="${limits.min}" max="${limits.max}" step="${limits.step}" value="${zone?.y ?? zoneDefaults(panel).y}" ${zone ? "" : "disabled"}>
      <span id="vzYValue" class="vzValue">${Number(zone?.y ?? zoneDefaults(panel).y).toFixed(3)}</span>
    </div>
    <div class="vzGrid">
      <div class="vzRow"><label>X</label><input id="vzX" type="number" step="${limits.moveStep}" value="${zone?.x ?? zoneDefaults(panel).x}" ${zone ? "" : "disabled"}></div>
      <div class="vzRow"><label>Z</label><input id="vzZ" type="number" step="${limits.moveStep}" value="${zone?.z ?? zoneDefaults(panel).z}" ${zone ? "" : "disabled"}></div>
      <div class="vzRow"><label>Largura</label><input id="vzW" type="number" min="${limits.moveStep}" step="${limits.moveStep}" value="${zone?.width ?? zoneDefaults(panel).width}" ${zone ? "" : "disabled"}></div>
      <div class="vzRow"><label>Profundidade</label><input id="vzD" type="number" min="${limits.moveStep}" step="${limits.moveStep}" value="${zone?.depth ?? zoneDefaults(panel).depth}" ${zone ? "" : "disabled"}></div>
    </div>
    <div class="vzHint">O retângulo pode ficar quase na altura do piso. Mesmo oculto, a área continua clicável para abrir esta vista.</div>
    <div class="vzActions">
      <button id="vzDraw" type="button">${zone ? "Redesenhar retângulo" : "Criar retângulo"}</button>
      <button id="vzCapture" class="secondary" type="button">Atualizar câmera</button>
      <button id="vzClose" class="secondary" type="button">Fechar edição</button>
    </div>
  `;

  const update = () => {
    const current = savedView(panel, id);
    if (!current?.zone) return;
    current.zone = normalizeZone(panel, {
      ...current.zone,
      x: Number(editor.querySelector("#vzX")?.value),
      z: Number(editor.querySelector("#vzZ")?.value),
      y: Number(editor.querySelector("#vzY")?.value),
      width: Number(editor.querySelector("#vzW")?.value),
      depth: Number(editor.querySelector("#vzD")?.value),
      show: Boolean(editor.querySelector("#vzShow")?.checked),
    });
    editor.querySelector("#vzYValue").textContent = current.zone.y.toFixed(3);
    persistViews(panel);
    updateZoneMesh(panel, current);
  };

  editor.querySelector("#vzName")?.addEventListener("change", (event) => {
    view.name = String(event.target.value || "Vista").trim().slice(0, 80) || "Vista";
    persistViews(panel);
    panel._renderCustomViews?.();
    renderZoneEditor(panel, id);
  });
  editor.querySelector("#vzQuick")?.addEventListener("change", (event) => setQuickAccess(panel, id, event.target.checked));
  for (const selector of ["#vzShow", "#vzY", "#vzX", "#vzZ", "#vzW", "#vzD"]) {
    editor.querySelector(selector)?.addEventListener("input", update);
    editor.querySelector(selector)?.addEventListener("change", update);
  }
  editor.querySelector("#vzDraw")?.addEventListener("click", () => startZoneDrawing(panel, id));
  editor.querySelector("#vzCapture")?.addEventListener("click", () => {
    const current = savedView(panel, id);
    if (!current) return;
    current.view = panel._captureCameraView?.() || current.view;
    persistViews(panel);
    panel._setStatus?.(`Câmera atual salva em ${current.name || "vista"}`);
  });
  editor.querySelector("#vzClose")?.addEventListener("click", () => {
    editor.classList.remove("open");
    panel._ha3dEditingViewId = null;
    panel._ha3dZoneDrawViewId = null;
  });
}

function renderCustomViews(panel) {
  ensureStyle(panel);
  const host = panel.shadowRoot?.querySelector("#customViews");
  if (!host) return;
  host.replaceChildren();

  for (const view of panel._customViews || []) {
    const row = document.createElement("div");
    row.className = "customRow";

    const open = document.createElement("button");
    open.type = "button";
    open.textContent = view.name || "Vista personalizada";
    open.title = view.name || "Vista personalizada";
    open.addEventListener("click", () => {
      if (view.view) panel._animateCameraTo?.(view.view);
      panel.shadowRoot?.querySelector("#viewsPanel")?.classList.remove("open");
    });

    const quick = document.createElement("label");
    quick.className = "ha3dViewQuick";
    quick.title = "Usar como acesso rápido";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(view.quick_access);
    checkbox.setAttribute("aria-label", "Acesso rápido");
    checkbox.addEventListener("change", () => setQuickAccess(panel, view.id, checkbox.checked));
    quick.appendChild(checkbox);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ha3dViewEdit";
    edit.textContent = "✎";
    edit.title = "Editar vista e zona no piso";
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      renderZoneEditor(panel, view.id);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ha3dViewDelete";
    remove.textContent = "×";
    remove.title = "Excluir vista";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      panel._customViews = (panel._customViews || []).filter((item) => String(item.id) !== String(view.id));
      persistViews(panel);
      rebuildZoneMeshes(panel);
      renderCustomViews(panel);
      const editor = panel.shadowRoot?.querySelector("#ha3dViewZoneEditor");
      if (panel._ha3dEditingViewId === String(view.id)) editor?.classList.remove("open");
    });

    row.append(open, quick, edit, remove);
    host.appendChild(row);
  }

  let editor = panel.shadowRoot?.querySelector("#ha3dViewZoneEditor");
  if (!editor) {
    editor = document.createElement("div");
    editor.id = "ha3dViewZoneEditor";
    host.insertAdjacentElement("afterend", editor);
  }
}

function openViewsPanel(panel) {
  const viewsPanel = panel.shadowRoot?.querySelector("#viewsPanel");
  if (!viewsPanel) return;
  renderCustomViews(panel);
  viewsPanel.classList.add("open");
}

function installViewsButton(panel) {
  ensureStyle(panel);
  let button = panel.shadowRoot?.querySelector("#viewsButton");
  if (!button || button.dataset.ha3dViewHub === "1") return;

  // Clone removes the original simple-click toggle listener installed by the
  // base panel. From here, tap is quick access and long-press opens the menu.
  const clone = button.cloneNode(true);
  clone.dataset.ha3dViewHub = "1";
  clone.title = "Vistas · toque: acesso rápido · segure: menu";
  clone.setAttribute("aria-label", clone.title);
  button.replaceWith(clone);
  button = clone;

  let held = false;
  let timer = null;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    held = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      held = true;
      openViewsPanel(panel);
    }, LONG_PRESS_MS);
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      if (!held) activateQuickAccess(panel);
      held = false;
    };
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
}

function ensureViewHub(panel) {
  if (!panel?.shadowRoot) return;
  ensureStyle(panel);
  renderCustomViews(panel);
  installViewsButton(panel);
  installCanvasZoneGestures(panel);
  rebuildZoneMeshes(panel);
}

if (!proto.__ha3dViewZonesV1) {
  proto.__ha3dViewZonesV1 = true;

  // This intentionally supersedes the old drawer renderer so all custom-view
  // creation/editing lives in the main Vistas panel.
  proto._renderCustomViews = function () {
    renderCustomViews(this);
  };

  const oldConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = oldConnected?.apply(this, args);
    queueMicrotask(() => ensureViewHub(this));
    requestAnimationFrame(() => ensureViewHub(this));
    return result;
  };

  const oldLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await oldLoadModel?.apply(this, args);
    ensureViewHub(this);
    return result;
  };
}
