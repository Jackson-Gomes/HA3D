import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const MAX_MEDIA_PANELS = 100;
const IMAGE_ATTRS = [
  "entity_picture",
  "media_image_url",
  "image",
  "image_url",
  "app_icon",
  "icon_url",
  "thumbnail",
  "poster",
];

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function panelConfig(panel) {
  return Array.isArray(panel?._config?.media_panels) ? panel._config.media_panels : [];
}

function selectedRuntime(panel) {
  const id = panel?._selectedObject?.userData?.ha3dMediaPanelId;
  return id ? panel?._ha3dMediaPanels?.get?.(id) || null : null;
}

function nextId(panel) {
  const used = new Set(panelConfig(panel).map((item) => item.id));
  let index = 1;
  while (used.has(`media_${index}`)) index += 1;
  return `media_${index}`;
}

function selectedCenter(panel) {
  const selected = panel?._selectedObject;
  if (selected && !selected.userData?.ha3dMediaPanelId && !selected.userData?.ha3dVirtualLightId) {
    const box = new THREE.Box3().setFromObject(selected);
    if (!box.isEmpty()) return box.getCenter(new THREE.Vector3());
  }
  return panel?._controls?.target?.clone?.() || new THREE.Vector3();
}

function normalizeUrl(panel, value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith("/")) return panel?._hass?.hassUrl?.(url) || url;
  return panel?._hass?.hassUrl?.(`/${url.replace(/^\/+/, "")}`) || `/${url.replace(/^\/+/, "")}`;
}

function disposeTexture(texture) {
  try { texture?.dispose?.(); } catch (_error) {}
}

function disposeRuntime(runtime) {
  if (!runtime) return;
  if (runtime.video) {
    try { runtime.video.pause(); } catch (_error) {}
    runtime.video.removeAttribute("src");
    try { runtime.video.load(); } catch (_error) {}
  }
  disposeTexture(runtime.texture);
  runtime.group?.traverse?.((node) => {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) node.material.forEach((item) => item?.dispose?.());
    else node.material?.dispose?.();
  });
  runtime.group?.removeFromParent?.();
}

function canvasTexture(title, subtitle = "") {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 432;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101318";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#202733";
  ctx.fillRect(18, 18, canvas.width - 36, canvas.height - 36);
  ctx.fillStyle = "#f3f6fb";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "600 52px sans-serif";
  const main = String(title || "Mídia").slice(0, 30);
  ctx.fillText(main, canvas.width / 2, canvas.height / 2 - 24);
  if (subtitle) {
    ctx.fillStyle = "#aeb9ca";
    ctx.font = "32px sans-serif";
    ctx.fillText(String(subtitle).slice(0, 44), canvas.width / 2, canvas.height / 2 + 54);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function entitySource(panel, config) {
  const state = config.entity_id ? panel?._hass?.states?.[config.entity_id] : null;
  if (!state) return { kind: "canvas", title: "Entidade indisponível", subtitle: config.entity_id || "" };
  const attrs = state.attributes || {};
  const preferred = String(config.image_attribute || "").trim();
  const keys = preferred ? [preferred, ...IMAGE_ATTRS.filter((key) => key !== preferred)] : IMAGE_ATTRS;
  for (const key of keys) {
    const value = attrs[key];
    if (typeof value === "string" && value.trim()) {
      return {
        kind: "image",
        url: normalizeUrl(panel, value),
        signature: `${key}:${value}`,
      };
    }
  }
  const app = attrs.app_name || attrs.source || attrs.media_title || attrs.friendly_name || config.entity_id;
  const detail = attrs.media_title && attrs.media_title !== app ? attrs.media_title : state.state;
  return {
    kind: "canvas",
    title: app,
    subtitle: detail,
    signature: `canvas:${app}:${detail}`,
  };
}

function desiredSource(panel, config) {
  if (config.source_type === "video") {
    const url = normalizeUrl(panel, config.url);
    return { kind: "video", url, signature: `video:${url}` };
  }
  if (config.source_type === "image") {
    const url = normalizeUrl(panel, config.url);
    return { kind: "image", url, signature: `image:${url}` };
  }
  return entitySource(panel, config);
}

function applyTexture(runtime, texture) {
  disposeTexture(runtime.texture);
  runtime.texture = texture;
  runtime.material.map = texture || null;
  runtime.material.needsUpdate = true;
}

function setFallback(runtime, title, subtitle = "") {
  if (runtime.video) {
    try { runtime.video.pause(); } catch (_error) {}
    runtime.video = null;
  }
  applyTexture(runtime, canvasTexture(title, subtitle));
}

function loadImage(panel, runtime, source) {
  if (!source.url) {
    setFallback(runtime, "Sem imagem", runtime.config.name || runtime.config.id);
    return;
  }
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  loader.load(
    source.url,
    (texture) => {
      if (runtime.sourceSignature !== source.signature) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      applyTexture(runtime, texture);
    },
    undefined,
    () => {
      if (runtime.sourceSignature === source.signature) setFallback(runtime, "Imagem indisponível", runtime.config.name || runtime.config.id);
    },
  );
}

function loadVideo(runtime, source) {
  if (!source.url) {
    setFallback(runtime, "Sem vídeo", runtime.config.name || runtime.config.id);
    return;
  }
  if (runtime.video) {
    try { runtime.video.pause(); } catch (_error) {}
  }
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.playsInline = true;
  video.muted = runtime.config.muted !== false;
  video.loop = runtime.config.loop !== false;
  video.autoplay = runtime.config.autoplay !== false;
  video.preload = "metadata";
  video.src = source.url;
  runtime.video = video;
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  applyTexture(runtime, texture);
  if (video.autoplay) video.play().catch(() => {});
}

function syncRuntimeSource(panel, runtime, force = false) {
  const source = desiredSource(panel, runtime.config);
  const signature = source.signature || `${source.kind}:${source.url || ""}:${source.title || ""}:${source.subtitle || ""}`;
  if (!force && runtime.sourceSignature === signature) return;
  runtime.sourceSignature = signature;

  if (source.kind === "video") loadVideo(runtime, source);
  else if (source.kind === "image") loadImage(panel, runtime, source);
  else setFallback(runtime, source.title, source.subtitle);
}

function createRuntime(panel, config) {
  const group = new THREE.Group();
  group.name = `HA3D_MediaPanel_${config.id}`;
  group.userData.ha3dMediaPanelId = config.id;
  group.userData.ha3dEditorHelper = true;
  group.position.fromArray(config.position || [0, 0, 0]);
  const rotation = config.rotation || [0, 0, 0];
  group.rotation.set(finite(rotation[0]), finite(rotation[1]), finite(rotation[2]));
  group.scale.fromArray(config.scale || [1, 1, 1]);

  const width = Math.max(0.05, finite(config.width, 1.6));
  const height = Math.max(0.05, finite(config.height, 0.9));
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: clamp(config.opacity ?? 1, 0, 1),
    side: config.double_sided === false ? THREE.FrontSide : THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.name = `HA3D_MediaPanelSurface_${config.id}`;
  mesh.userData.ha3dMediaPanelHandle = group;
  group.add(mesh);

  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ depthTest: false, transparent: true, opacity: 0.9 }),
  );
  border.renderOrder = 1002;
  border.userData.ha3dEditorHelper = true;
  border.visible = Boolean(panel._editorMode);
  group.add(border);

  group.visible = config.enabled !== false;
  panel._scene.add(group);
  const runtime = { config, group, mesh, material, border, texture: null, video: null, sourceSignature: "" };
  syncRuntimeSource(panel, runtime, true);
  return runtime;
}

function rebuild(panel) {
  if (!panel?._scene) return;
  for (const runtime of panel._ha3dMediaPanels?.values?.() || []) disposeRuntime(runtime);
  panel._ha3dMediaPanels = new Map();
  panel._ha3dMediaPanelPickables = [];
  for (const config of panelConfig(panel).slice(0, MAX_MEDIA_PANELS)) {
    if (!config?.id) continue;
    const runtime = createRuntime(panel, config);
    panel._ha3dMediaPanels.set(config.id, runtime);
    panel._ha3dMediaPanelPickables.push(runtime.mesh);
  }
  refreshChooser(panel);
}

function syncStates(panel) {
  for (const runtime of panel?._ha3dMediaPanels?.values?.() || []) {
    runtime.group.visible = runtime.config.enabled !== false;
    runtime.material.opacity = clamp(runtime.config.opacity ?? 1, 0, 1);
    syncRuntimeSource(panel, runtime, false);
  }
}

function setEditorVisibility(panel) {
  for (const runtime of panel?._ha3dMediaPanels?.values?.() || []) runtime.border.visible = Boolean(panel._editorMode);
}

function entityOptions(panel) {
  return Object.entries(panel?._hass?.states || {})
    .filter(([entityId, state]) => {
      const domain = entityId.split(".")[0];
      if (["media_player", "camera", "image"].includes(domain)) return true;
      return IMAGE_ATTRS.some((key) => typeof state?.attributes?.[key] === "string" && state.attributes[key]);
    })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([entityId, state]) => `<option value="${escapeHtml(entityId)}">${escapeHtml(state.attributes?.friendly_name || entityId)}</option>`)
    .join("");
}

function refreshChooser(panel) {
  const select = panel?.shadowRoot?.querySelector("#ha3dMediaPanelSelect");
  if (!select) return;
  const current = panel?._selectedObject?.userData?.ha3dMediaPanelId || "";
  select.replaceChildren(new Option("Telas de mídia…", ""));
  for (const config of panelConfig(panel)) select.appendChild(new Option(config.name || config.id, config.id));
  select.value = current;
}

function installToolbar(panel) {
  const editor = panel?.shadowRoot?.querySelector("#ha3dEditor");
  if (!editor || panel.shadowRoot.querySelector("#ha3dMediaPanelToolbar")) return;
  const anchor = panel.shadowRoot.querySelector("#ha3dVirtualLightToolbar") || editor.querySelector(".ha3dTransform");
  if (!anchor) return;
  const row = document.createElement("div");
  row.id = "ha3dMediaPanelToolbar";
  row.style.cssText = "display:grid;grid-template-columns:1fr auto;gap:6px;margin:8px 0";
  row.innerHTML = `
    <select id="ha3dMediaPanelSelect" title="Selecionar tela" style="min-width:0;padding:7px;border-radius:8px;background:#111;color:inherit;border:1px solid #ffffff2b"></select>
    <button id="ha3dAddMediaPanel" class="secondary" type="button">+ Tela</button>
  `;
  anchor.insertAdjacentElement("afterend", row);
  row.querySelector("#ha3dAddMediaPanel")?.addEventListener("click", () => panel._createMediaPanel?.());
  row.querySelector("#ha3dMediaPanelSelect")?.addEventListener("change", (event) => {
    if (event.target.value) panel._selectMediaPanel?.(event.target.value);
  });
  refreshChooser(panel);
}

function renderForm(panel, runtime) {
  const body = panel?.shadowRoot?.querySelector("#ha3dEditorBody");
  if (!body || !runtime) return;
  const config = runtime.config;
  const p = runtime.group.position;
  const r = runtime.group.rotation;
  const s = runtime.group.scale;
  body.innerHTML = `
    <div class="ha3dRow"><label>Tela de mídia</label><input id="ha3dMpName" value="${escapeHtml(config.name || config.id)}"></div>
    <div class="ha3dRow"><label>Fonte</label><select id="ha3dMpSource"><option value="entity" ${config.source_type === "entity" ? "selected" : ""}>Imagem de entidade</option><option value="image" ${config.source_type === "image" ? "selected" : ""}>URL de imagem</option><option value="video" ${config.source_type === "video" ? "selected" : ""}>URL de vídeo</option></select></div>
    <div class="ha3dRow"><label>Entidade Home Assistant</label><input id="ha3dMpEntity" list="ha3dMpEntities" autocomplete="off" placeholder="media_player.tv" value="${escapeHtml(config.entity_id || "")}"><datalist id="ha3dMpEntities">${entityOptions(panel)}</datalist><span class="ha3dHint">Usa automaticamente entity_picture, media_image_url, image e atributos equivalentes. Se não houver imagem, mostra app_name/source/media_title.</span></div>
    <div class="ha3dRow"><label>Atributo de imagem (opcional)</label><input id="ha3dMpAttribute" placeholder="entity_picture" value="${escapeHtml(config.image_attribute || "")}"><span class="ha3dHint">Preencha apenas se quiser forçar um atributo específico da entidade.</span></div>
    <div class="ha3dRow"><label>URL de imagem/vídeo</label><input id="ha3dMpUrl" placeholder="/local/video.mp4 ou https://..." value="${escapeHtml(config.url || "")}"></div>
    <div class="ha3dRow"><label>Tamanho L / A</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><input id="ha3dMpWidth" type="number" min="0.05" step="0.05" value="${finite(config.width, 1.6)}"><input id="ha3dMpHeight" type="number" min="0.05" step="0.05" value="${finite(config.height, 0.9)}"></div></div>
    <div class="ha3dRow"><label>Opacidade</label><input id="ha3dMpOpacity" type="number" min="0" max="1" step="0.05" value="${clamp(config.opacity ?? 1, 0, 1)}"></div>
    <div class="ha3dRow"><label>Posição X / Y / Z</label><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px"><input id="ha3dMpPx" type="number" step="0.01" value="${p.x.toFixed(4)}"><input id="ha3dMpPy" type="number" step="0.01" value="${p.y.toFixed(4)}"><input id="ha3dMpPz" type="number" step="0.01" value="${p.z.toFixed(4)}"></div></div>
    <div class="ha3dRow"><label>Rotação X / Y / Z (graus)</label><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px"><input id="ha3dMpRx" type="number" step="1" value="${(r.x * 180 / Math.PI).toFixed(2)}"><input id="ha3dMpRy" type="number" step="1" value="${(r.y * 180 / Math.PI).toFixed(2)}"><input id="ha3dMpRz" type="number" step="1" value="${(r.z * 180 / Math.PI).toFixed(2)}"></div></div>
    <div class="ha3dRow"><label>Escala X / Y / Z</label><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px"><input id="ha3dMpSx" type="number" min="0.01" step="0.05" value="${s.x.toFixed(3)}"><input id="ha3dMpSy" type="number" min="0.01" step="0.05" value="${s.y.toFixed(3)}"><input id="ha3dMpSz" type="number" min="0.01" step="0.05" value="${s.z.toFixed(3)}"></div></div>
    <div class="ha3dRow"><label><input id="ha3dMpEnabled" type="checkbox" ${config.enabled !== false ? "checked" : ""}> Visível</label><label><input id="ha3dMpDouble" type="checkbox" ${config.double_sided === false ? "" : "checked"}> Dupla face</label><label><input id="ha3dMpMuted" type="checkbox" ${config.muted === false ? "" : "checked"}> Vídeo sem som</label><label><input id="ha3dMpLoop" type="checkbox" ${config.loop === false ? "" : "checked"}> Repetir vídeo</label><label><input id="ha3dMpAutoplay" type="checkbox" ${config.autoplay === false ? "" : "checked"}> Autoplay</label></div>
    <div class="ha3dEditorActions"><button id="ha3dMpSave" type="button">Salvar tela</button><button id="ha3dMpDuplicate" class="secondary" type="button">Duplicar</button><button id="ha3dMpDelete" class="secondary" type="button">Remover</button></div>
  `;
  body.querySelector("#ha3dMpSave")?.addEventListener("click", () => panel._saveMediaPanelForm?.(config.id));
  body.querySelector("#ha3dMpDuplicate")?.addEventListener("click", () => panel._duplicateMediaPanel?.(config.id));
  body.querySelector("#ha3dMpDelete")?.addEventListener("click", () => panel._removeMediaPanel?.(config.id));
}

function numberField(body, id, fallback) {
  return finite(body.querySelector(id)?.value, fallback);
}

async function save(panel, panels, status) {
  panel._config = await panel._hass.callApi("POST", "ha3d/media_panels", { media_panels: panels });
  panel._setStatus?.(status);
}

function pickMediaPanel(panel, event) {
  if (!panel?._editorMode || !panel?._ha3dMediaPanelPickables?.length) return null;
  const rect = panel._renderer.domElement.getBoundingClientRect();
  panel._pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  panel._raycaster.setFromCamera(panel._pointer, panel._camera);
  const hit = panel._raycaster.intersectObjects(
    panel._ha3dMediaPanelPickables.filter((item) => item?.visible && item?.parent?.visible),
    false,
  )[0]?.object;
  return hit?.userData?.ha3dMediaPanelHandle || null;
}

if (!proto.__ha3dMediaPanelsV1) {
  proto.__ha3dMediaPanelsV1 = true;

  const oldRenderShell = proto._renderShell;
  proto._renderShell = function (...args) {
    const result = oldRenderShell?.apply(this, args);
    installToolbar(this);
    return result;
  };

  const oldLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await oldLoadModel?.apply(this, args);
    rebuild(this);
    return result;
  };

  const oldSyncLightStates = proto._syncLightStates;
  proto._syncLightStates = function (...args) {
    const result = oldSyncLightStates?.apply(this, args);
    syncStates(this);
    return result;
  };

  const oldToggleEditor = proto._toggleEditor;
  proto._toggleEditor = function (...args) {
    const result = oldToggleEditor?.apply(this, args);
    setEditorVisibility(this);
    refreshChooser(this);
    return result;
  };

  const oldPickObject = proto._pickObject;
  proto._pickObject = function (event) {
    return pickMediaPanel(this, event) || oldPickObject?.call(this, event) || null;
  };

  const oldRenderEditorForm = proto._renderEditorForm;
  proto._renderEditorForm = async function (...args) {
    const runtime = selectedRuntime(this);
    if (runtime) {
      renderForm(this, runtime);
      return;
    }
    return oldRenderEditorForm?.apply(this, args);
  };

  const oldSelectForEditor = proto._selectForEditor;
  proto._selectForEditor = function (object) {
    const result = oldSelectForEditor?.call(this, object);
    const runtime = selectedRuntime(this);
    if (runtime) {
      this._setStatus?.(`Tela de mídia: ${runtime.config.name || runtime.config.id}`);
      refreshChooser(this);
    }
    return result;
  };

  const oldPersistSelectedTransform = proto._persistSelectedTransform;
  proto._persistSelectedTransform = async function (...args) {
    const runtime = selectedRuntime(this);
    if (!runtime) return oldPersistSelectedTransform?.apply(this, args);
    const panels = panelConfig(this).map((item) => item.id === runtime.config.id ? {
      ...item,
      position: runtime.group.position.toArray(),
      rotation: [runtime.group.rotation.x, runtime.group.rotation.y, runtime.group.rotation.z],
      scale: runtime.group.scale.toArray(),
    } : item);
    try {
      await save(this, panels, `Posição da tela salva: ${runtime.config.name || runtime.config.id}`);
      runtime.config = this._config.media_panels.find((item) => item.id === runtime.config.id) || runtime.config;
      renderForm(this, runtime);
    } catch (error) {
      this._setStatus?.(`Erro ao salvar tela: ${error.message || error}`);
    }
  };

  proto._createMediaPanel = async function () {
    if (!this._hass?.user?.is_admin) return;
    const panels = panelConfig(this);
    if (panels.length >= MAX_MEDIA_PANELS) return this._setStatus?.(`Limite de ${MAX_MEDIA_PANELS} telas`);
    const id = nextId(this);
    const center = selectedCenter(this);
    const config = {
      id,
      name: `Tela ${id.split("_").pop()}`,
      source_type: "entity",
      entity_id: null,
      image_attribute: "",
      url: "",
      position: center.toArray(),
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      width: Math.max(0.5, finite(this._modelScale, 10) * 0.16),
      height: Math.max(0.28, finite(this._modelScale, 10) * 0.09),
      opacity: 1,
      enabled: true,
      double_sided: true,
      muted: true,
      loop: true,
      autoplay: true,
    };
    try {
      await save(this, [...panels, config], `Tela criada: ${config.name}`);
      rebuild(this);
      this._selectMediaPanel?.(id);
    } catch (error) {
      this._setStatus?.(`Erro ao criar tela: ${error.message || error}`);
    }
  };

  proto._selectMediaPanel = function (id) {
    const runtime = this._ha3dMediaPanels?.get(id);
    if (!runtime) return;
    this._selectForEditor?.(runtime.group);
    refreshChooser(this);
  };

  proto._saveMediaPanelForm = async function (id) {
    const runtime = this._ha3dMediaPanels?.get(id);
    const body = this.shadowRoot?.querySelector("#ha3dEditorBody");
    if (!runtime || !body) return;
    const sourceType = ["entity", "image", "video"].includes(body.querySelector("#ha3dMpSource")?.value)
      ? body.querySelector("#ha3dMpSource").value : "entity";
    const entityId = body.querySelector("#ha3dMpEntity")?.value?.trim() || null;
    if (sourceType === "entity" && entityId && !this._hass?.states?.[entityId]) {
      return this._setStatus?.(`Entidade não encontrada: ${entityId}`);
    }
    const updated = {
      ...runtime.config,
      name: body.querySelector("#ha3dMpName")?.value?.trim() || id,
      source_type: sourceType,
      entity_id: entityId,
      image_attribute: body.querySelector("#ha3dMpAttribute")?.value?.trim() || "",
      url: body.querySelector("#ha3dMpUrl")?.value?.trim() || "",
      width: Math.max(0.05, numberField(body, "#ha3dMpWidth", 1.6)),
      height: Math.max(0.05, numberField(body, "#ha3dMpHeight", 0.9)),
      opacity: clamp(numberField(body, "#ha3dMpOpacity", 1), 0, 1),
      position: [numberField(body, "#ha3dMpPx", runtime.group.position.x), numberField(body, "#ha3dMpPy", runtime.group.position.y), numberField(body, "#ha3dMpPz", runtime.group.position.z)],
      rotation: [numberField(body, "#ha3dMpRx", 0), numberField(body, "#ha3dMpRy", 0), numberField(body, "#ha3dMpRz", 0)].map((value) => value * Math.PI / 180),
      scale: [numberField(body, "#ha3dMpSx", runtime.group.scale.x), numberField(body, "#ha3dMpSy", runtime.group.scale.y), numberField(body, "#ha3dMpSz", runtime.group.scale.z)].map((value) => Math.max(0.01, value)),
      enabled: Boolean(body.querySelector("#ha3dMpEnabled")?.checked),
      double_sided: Boolean(body.querySelector("#ha3dMpDouble")?.checked),
      muted: Boolean(body.querySelector("#ha3dMpMuted")?.checked),
      loop: Boolean(body.querySelector("#ha3dMpLoop")?.checked),
      autoplay: Boolean(body.querySelector("#ha3dMpAutoplay")?.checked),
    };
    try {
      await save(this, panelConfig(this).map((item) => item.id === id ? updated : item), `Tela salva: ${updated.name}`);
      rebuild(this);
      this._selectMediaPanel?.(id);
    } catch (error) {
      this._setStatus?.(`Erro ao salvar tela: ${error.message || error}`);
    }
  };

  proto._duplicateMediaPanel = async function (id) {
    const source = panelConfig(this).find((item) => item.id === id);
    if (!source) return;
    const newId = nextId(this);
    const offset = Math.max(0.15, finite(this._modelScale, 10) * 0.025);
    const copy = {
      ...source,
      id: newId,
      name: `${source.name || source.id} cópia`,
      position: [finite(source.position?.[0]) + offset, finite(source.position?.[1]), finite(source.position?.[2]) + offset],
      rotation: [...(source.rotation || [0, 0, 0])],
      scale: [...(source.scale || [1, 1, 1])],
    };
    try {
      await save(this, [...panelConfig(this), copy], `Tela duplicada: ${copy.name}`);
      rebuild(this);
      this._selectMediaPanel?.(newId);
    } catch (error) {
      this._setStatus?.(`Erro ao duplicar tela: ${error.message || error}`);
    }
  };

  proto._removeMediaPanel = async function (id) {
    const runtime = this._ha3dMediaPanels?.get(id);
    const name = runtime?.config?.name || id;
    try {
      await save(this, panelConfig(this).filter((item) => item.id !== id), `Tela removida: ${name}`);
      if (this._selectedObject?.userData?.ha3dMediaPanelId === id) {
        this._selectedObject = null;
        this._ha3dTransformTarget = null;
        this._transformControls?.detach?.();
        if (this._ha3dSelectionBox) this._ha3dSelectionBox.visible = false;
      }
      rebuild(this);
      const body = this.shadowRoot?.querySelector("#ha3dEditorBody");
      if (body) body.innerHTML = '<p class="ha3dHint">Selecione um objeto 3D, uma luz virtual ou uma tela de mídia para editar.</p>';
    } catch (error) {
      this._setStatus?.(`Erro ao remover tela: ${error.message || error}`);
    }
  };
}
