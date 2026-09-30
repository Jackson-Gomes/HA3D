const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const MOVE_CANCEL_PX = 10;
const QUICK_TAP_MS = 600;

function objectKey(object) {
  return String(object?.userData?.ha3dOriginalNodeName || object?.name || "").trim();
}

function isNormalModelObject(object) {
  return Boolean(
    object
    && !object.userData?.ha3dEditorHelper
    && !object.userData?.ha3dVirtualLightId
    && !object.userData?.ha3dMediaPanelId
    && !object.userData?.ha3dFloatingWidgetId
    && !object.userData?.ha3dRobotCalibration
  );
}

function sceneMenuEntities(panel, key) {
  const value = panel?._config?.advanced_bindings?.[key]?.actions?.scene_menu;
  if (!Array.isArray(value)) return [];
  return value
    .filter((entity) => typeof entity === "string" && entity.startsWith("scene.") && panel?._hass?.states?.[entity])
    .slice(0, 40);
}

function allScenes(panel) {
  return Object.entries(panel?._hass?.states || {})
    .filter(([entity]) => entity.startsWith("scene."))
    .sort(([a, as], [b, bs]) => {
      const an = as?.attributes?.friendly_name || a;
      const bn = bs?.attributes?.friendly_name || b;
      return an.localeCompare(bn, undefined, { numeric: true, sensitivity: "base" });
    });
}

function ensureStyle(panel) {
  const root = panel?.shadowRoot;
  if (!root || root.querySelector("#ha3dObjectSceneMenuStyle")) return;
  const style = document.createElement("style");
  style.id = "ha3dObjectSceneMenuStyle";
  style.textContent = `
    #ha3dObjectSceneMenu{
      position:absolute;z-index:74;display:none;min-width:190px;max-width:min(310px,calc(100vw - 24px));
      padding:8px;border-radius:16px;background:color-mix(in srgb,var(--card-background-color,#15171d) 94%,transparent);
      border:1px solid rgba(255,255,255,.14);box-shadow:0 14px 38px rgba(0,0,0,.42);
      backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);pointer-events:auto;
    }
    #ha3dObjectSceneMenu.open{display:block}
    #ha3dObjectSceneMenu .ha3dObjectSceneTitle{padding:5px 8px 8px;font-size:12px;font-weight:700;opacity:.82;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #ha3dObjectSceneMenu .ha3dObjectSceneList{display:grid;gap:5px;max-height:min(360px,58vh);overflow:auto}
    #ha3dObjectSceneMenu .ha3dObjectSceneAction{width:100%;min-height:40px;padding:8px 10px;border-radius:11px;text-align:left;background:#24262c;border:1px solid rgba(255,255,255,.10);color:var(--primary-text-color,#fff);font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #ha3dObjectSceneMenu .ha3dObjectSceneAction:hover{background:#30333a}
    #ha3dObjectSceneMenu .ha3dObjectSceneAction:disabled{opacity:.55}
    #ha3dObjectSceneEditor{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.12)}
    #ha3dObjectSceneEditor .ha3dObjectSceneChecks{display:grid;gap:5px;max-height:220px;overflow:auto;padding:6px;border:1px solid rgba(255,255,255,.12);border-radius:10px}
    #ha3dObjectSceneEditor .ha3dObjectSceneCheck{display:flex;gap:8px;align-items:center;min-height:30px;font-size:12px}
    #ha3dObjectSceneEditor .ha3dObjectSceneActions{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}
  `;
  root.appendChild(style);
}

function ensureRuntimeMenu(panel) {
  const root = panel?.shadowRoot?.querySelector("#root");
  if (!root) return null;
  ensureStyle(panel);
  let menu = panel.shadowRoot.querySelector("#ha3dObjectSceneMenu");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "ha3dObjectSceneMenu";
  menu.setAttribute("role", "menu");
  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  menu.addEventListener("click", (event) => event.stopPropagation());
  root.appendChild(menu);

  if (!root.__ha3dObjectSceneMenuCloseHook) {
    root.__ha3dObjectSceneMenuCloseHook = true;
    root.addEventListener("pointerdown", (event) => {
      const active = panel.shadowRoot?.querySelector("#ha3dObjectSceneMenu.open");
      if (!active || active.contains(event.target)) return;
      active.classList.remove("open");
    }, true);
  }

  return menu;
}

function positionMenu(panel, menu, clientX, clientY) {
  const root = panel?.shadowRoot?.querySelector("#root");
  if (!root || !menu) return;
  const rr = root.getBoundingClientRect();
  const mr = menu.getBoundingClientRect();
  const margin = 12;
  let left = clientX - rr.left + 10;
  let top = clientY - rr.top + 10;
  if (left + mr.width > rr.width - margin) left = clientX - rr.left - mr.width - 10;
  if (top + mr.height > rr.height - margin) top = clientY - rr.top - mr.height - 10;
  menu.style.left = `${Math.max(margin, Math.min(left, rr.width - mr.width - margin))}px`;
  menu.style.top = `${Math.max(margin, Math.min(top, rr.height - mr.height - margin))}px`;
}

function openRuntimeMenu(panel, object, entities, event) {
  const menu = ensureRuntimeMenu(panel);
  if (!menu || !entities.length) return;
  const key = objectKey(object) || "Objeto";
  menu.replaceChildren();

  const title = document.createElement("div");
  title.className = "ha3dObjectSceneTitle";
  title.textContent = key;
  menu.appendChild(title);

  const list = document.createElement("div");
  list.className = "ha3dObjectSceneList";
  menu.appendChild(list);

  for (const entity of entities) {
    const state = panel._hass?.states?.[entity];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ha3dObjectSceneAction";
    button.setAttribute("role", "menuitem");
    button.textContent = state?.attributes?.friendly_name || entity;
    button.title = entity;
    button.addEventListener("click", async (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      button.disabled = true;
      try {
        await panel._hass?.callService?.("scene", "turn_on", {}, { entity_id: entity });
        menu.classList.remove("open");
        panel._setStatus?.(`Cena executada: ${state?.attributes?.friendly_name || entity}`);
      } catch (error) {
        console.error("[HA3D] object scene action failed", entity, error);
        panel._setStatus?.(`Falha ao executar ${state?.attributes?.friendly_name || entity}`);
        button.disabled = false;
      }
    });
    list.appendChild(button);
  }

  menu.classList.add("open");
  requestAnimationFrame(() => positionMenu(panel, menu, event.clientX, event.clientY));
}

function editorObject(panel) {
  const object = panel?._selectedObject;
  return isNormalModelObject(object) ? object : null;
}

function installEditorUi(panel) {
  const object = editorObject(panel);
  const body = panel?.shadowRoot?.querySelector("#ha3dEditorBody");
  if (!object || !body || body.querySelector("#ha3dObjectSceneEditor")) return;
  ensureStyle(panel);

  const key = objectKey(object);
  if (!key) return;
  const selected = new Set(sceneMenuEntities(panel, key));
  const scenes = allScenes(panel);

  const box = document.createElement("div");
  box.id = "ha3dObjectSceneEditor";
  box.className = "ha3dRow";

  const label = document.createElement("label");
  label.textContent = "Menu de cenas neste objeto";
  box.appendChild(label);

  const hint = document.createElement("span");
  hint.className = "ha3dHint";
  hint.textContent = "Opcional. Marque as cenas que devem aparecer ao tocar neste objeto no modo normal.";
  box.appendChild(hint);

  const checks = document.createElement("div");
  checks.className = "ha3dObjectSceneChecks";
  if (!scenes.length) {
    const empty = document.createElement("span");
    empty.className = "ha3dHint";
    empty.textContent = "Nenhuma scene.* encontrada no Home Assistant.";
    checks.appendChild(empty);
  }
  for (const [entity, state] of scenes) {
    const row = document.createElement("label");
    row.className = "ha3dObjectSceneCheck";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.sceneEntity = entity;
    input.checked = selected.has(entity);
    const text = document.createElement("span");
    text.textContent = state?.attributes?.friendly_name || entity;
    text.title = entity;
    row.append(input, text);
    checks.appendChild(row);
  }
  box.appendChild(checks);

  const actions = document.createElement("div");
  actions.className = "ha3dObjectSceneActions";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Salvar menu de cenas";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary";
  remove.textContent = "Remover menu";
  actions.append(save, remove);
  box.appendChild(actions);

  save.addEventListener("click", () => panel._saveObjectSceneMenu?.(key));
  remove.addEventListener("click", () => panel._removeObjectSceneMenu?.(key));
  body.appendChild(box);
}

function readSelectedScenes(panel) {
  return [...(panel?.shadowRoot?.querySelectorAll?.("#ha3dObjectSceneEditor input[data-scene-entity]:checked") || [])]
    .map((input) => input.dataset.sceneEntity)
    .filter((entity) => entity?.startsWith("scene."));
}

async function persistSceneMenu(panel, key, entities) {
  const advanced = { ...(panel?._config?.advanced_bindings || {}) };
  const base = { ...(advanced[key] || {}) };
  const actions = { ...(base.actions || {}) };

  if (entities.length) actions.scene_menu = [...new Set(entities)].slice(0, 40);
  else delete actions.scene_menu;

  if (Object.keys(actions).length) base.actions = actions;
  else delete base.actions;

  if (Object.keys(base).length) advanced[key] = base;
  else delete advanced[key];

  await panel._saveConfigPatch?.({ advanced_bindings: advanced });
}

function installCanvasTap(panel) {
  const canvas = panel?._renderer?.domElement;
  if (!canvas || canvas.__ha3dObjectSceneTapV1) return;
  canvas.__ha3dObjectSceneTapV1 = true;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let moved = false;

  canvas.addEventListener("pointerdown", (event) => {
    if (panel._editorMode || event.button > 0 || !event.isPrimary) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startedAt = performance.now();
    moved = false;
  });

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId || moved) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_CANCEL_PX) moved = true;
  });

  const reset = () => {
    pointerId = null;
    moved = false;
    startedAt = 0;
  };

  canvas.addEventListener("pointercancel", reset);
  canvas.addEventListener("pointerup", (event) => {
    if (event.pointerId !== pointerId) return reset();
    const elapsed = performance.now() - startedAt;
    const wasMoved = moved;
    reset();

    if (panel._editorMode || wasMoved || elapsed > QUICK_TAP_MS) return;
    if (performance.now() < (panel._ha3dSuppressTapUntil || 0)) return;
    if (panel.shadowRoot?.querySelector("#root")?.classList?.contains("ha3d-idle-xray")) return;

    const object = panel._pickObject?.(event);
    if (!isNormalModelObject(object)) return;
    const key = objectKey(object);
    const entities = sceneMenuEntities(panel, key);
    if (!entities.length) return;

    event.preventDefault();
    event.stopPropagation();
    panel._ha3dSuppressTapUntil = performance.now() + 350;
    openRuntimeMenu(panel, object, entities, event);
  });
}

if (!proto.__ha3dObjectSceneMenuV1) {
  proto.__ha3dObjectSceneMenuV1 = true;

  proto._saveObjectSceneMenu = async function (key = objectKey(editorObject(this))) {
    if (!key) return;
    const entities = readSelectedScenes(this);
    if (!entities.length) {
      this._setStatus?.("Marque pelo menos uma cena ou use Remover menu");
      return;
    }
    try {
      await persistSceneMenu(this, key, entities);
      this._setStatus?.(`Menu de cenas salvo em ${key}`);
      await this._renderEditorForm?.();
    } catch (error) {
      this._setStatus?.(`Erro ao salvar menu de cenas: ${error.message || error}`);
    }
  };

  proto._removeObjectSceneMenu = async function (key = objectKey(editorObject(this))) {
    if (!key) return;
    try {
      await persistSceneMenu(this, key, []);
      this._setStatus?.(`Menu de cenas removido de ${key}`);
      await this._renderEditorForm?.();
    } catch (error) {
      this._setStatus?.(`Erro ao remover menu de cenas: ${error.message || error}`);
    }
  };

  const oldRenderEditorForm = proto._renderEditorForm;
  proto._renderEditorForm = async function (...args) {
    const result = await oldRenderEditorForm?.apply(this, args);
    installEditorUi(this);
    return result;
  };

  // Removing an entity binding must not accidentally remove an independently
  // configured scene menu from the same object.
  const oldRemoveEditorBinding = proto._removeEditorBinding;
  proto._removeEditorBinding = async function (...args) {
    const object = editorObject(this);
    const key = objectKey(object);
    const preserved = key ? sceneMenuEntities(this, key) : [];
    const result = await oldRemoveEditorBinding?.apply(this, args);
    if (key && preserved.length && !sceneMenuEntities(this, key).length) {
      try {
        await persistSceneMenu(this, key, preserved);
        await this._renderEditorForm?.();
      } catch (error) {
        console.error("[HA3D] failed to preserve object scene menu", key, error);
      }
    }
    return result;
  };

  const oldInitViewer = proto._initViewer;
  proto._initViewer = function (...args) {
    const result = oldInitViewer?.apply(this, args);
    installCanvasTap(this);
    ensureRuntimeMenu(this);
    return result;
  };

  const oldLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await oldLoadModel?.apply(this, args);
    installCanvasTap(this);
    ensureRuntimeMenu(this);
    return result;
  };

  const oldConnected = proto.connectedCallback;
  proto.connectedCallback = function (...args) {
    const result = oldConnected?.apply(this, args);
    queueMicrotask(() => {
      installCanvasTap(this);
      ensureRuntimeMenu(this);
    });
    return result;
  };
}
