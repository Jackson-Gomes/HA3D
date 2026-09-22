import * as THREE from "https://esm.sh/three@0.180.0";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const GENERIC_ROOT_NAMES = new Set([
  "scene",
  "root",
  "model",
  "gltf_scene_root_node",
  "sketchup",
]);

function safeName(object) {
  return String(object?.userData?.ha3dOriginalNodeName || object?.name || "").trim();
}

function isGenericWrapper(object) {
  return GENERIC_ROOT_NAMES.has(safeName(object).toLowerCase());
}

function logicalRoots(panel) {
  const model = panel?._model;
  if (!model) return [];

  let roots = [...model.children];
  if (roots.length === 1 && roots[0]?.children?.length > 1 && isGenericWrapper(roots[0])) {
    roots = [...roots[0].children];
  }
  return roots.filter(Boolean);
}

function rememberBaseTransform(object) {
  if (!object?.userData || object.userData.ha3dBaseTransformV1) return;
  object.userData.ha3dBaseTransformV1 = {
    position: object.position.toArray(),
    rotation: object.rotation.toArray(),
    scale: object.scale.toArray(),
  };
}

function annotateLogicalRoots(panel) {
  const model = panel?._model;
  if (!model) return [];

  const roots = logicalRoots(panel);
  for (const root of roots) {
    root.userData ||= {};
    root.userData.ha3dLogicalRoot = true;
    root.userData.ha3dOriginalNodeName ||= root.name || "";
    rememberBaseTransform(root);

    root.traverse((node) => {
      node.userData ||= {};
      node.userData.ha3dLogicalRootObject = root;
    });
  }
  panel._ha3dLogicalRoots = roots;
  return roots;
}

function resolveLogicalRoot(panel, object) {
  if (!object || !panel?._model) return object || null;
  if (object.userData?.ha3dLogicalRootObject) return object.userData.ha3dLogicalRootObject;

  let node = object;
  while (node && node !== panel._model) {
    if (node.userData?.ha3dLogicalRoot) return node;
    if (node.parent === panel._model) return node;
    node = node.parent;
  }
  return object;
}

function objectKey(object) {
  return safeName(object) || object?.uuid || "";
}

function transformPayload(object) {
  return {
    position: object.position.toArray(),
    rotation: object.rotation.toArray(),
    scale: object.scale.toArray(),
  };
}

function applyTransform(object, value) {
  if (!object || !value) return;
  if (Array.isArray(value.position)) object.position.fromArray(value.position);
  if (Array.isArray(value.rotation)) object.rotation.fromArray(value.rotation);
  if (Array.isArray(value.scale)) object.scale.fromArray(value.scale);
  object.updateMatrixWorld(true);
}

function countMeshes(object) {
  let count = 0;
  object?.traverse?.((node) => { if (node.isMesh) count += 1; });
  return count;
}

function ensureSelectionBox(panel, object = panel?._selectedObject) {
  if (!panel?._scene) return null;
  const target = resolveLogicalRoot(panel, object);

  if (!target || !panel._editorMode) {
    if (panel._ha3dSelectionBox) panel._ha3dSelectionBox.visible = false;
    return panel._ha3dSelectionBox || null;
  }

  if (!panel._ha3dSelectionBox) {
    panel._ha3dSelectionBox = new THREE.BoxHelper(target, 0x4fc3f7);
    panel._ha3dSelectionBox.name = "HA3D_EditorSelectionBox";
    panel._ha3dSelectionBox.userData.ha3dEditorHelper = true;
    panel._scene.add(panel._ha3dSelectionBox);
  } else {
    panel._ha3dSelectionBox.setFromObject(target);
  }
  panel._ha3dSelectionBox.visible = true;
  panel._ha3dSelectionBox.update();
  return panel._ha3dSelectionBox;
}

function syncPreciseInputs(panel) {
  const object = resolveLogicalRoot(panel, panel?._selectedObject);
  const root = panel?.shadowRoot;
  if (!object || !root) return;
  const values = {
    px: object.position.x,
    py: object.position.y,
    pz: object.position.z,
  };
  for (const [key, value] of Object.entries(values)) {
    const input = root.querySelector(`[data-ha3d-transform="${key}"]`);
    if (input && document.activeElement !== input) input.value = Number(value).toFixed(4);
  }
}

function installPreciseControls(panel) {
  const body = panel?.shadowRoot?.querySelector("#ha3dEditorBody");
  const object = resolveLogicalRoot(panel, panel?._selectedObject);
  if (!body || !object || body.querySelector("#ha3dPreciseTransform")) return;

  const section = document.createElement("div");
  section.id = "ha3dPreciseTransform";
  section.innerHTML = `
    <div class="ha3dRow">
      <label>Posição precisa do objeto completo</label>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
        <input data-ha3d-transform="px" type="number" step="0.01" title="Posição X">
        <input data-ha3d-transform="py" type="number" step="0.01" title="Posição Y (altura)">
        <input data-ha3d-transform="pz" type="number" step="0.01" title="Posição Z">
      </div>
      <span class="ha3dHint">X / Y / Z locais. O arraste livre mantém a altura; use Y ou o eixo vertical da tríade para subir/descer.</span>
    </div>
    <div class="ha3dEditorActions">
      <button id="ha3dApplyPreciseTransform" class="secondary" type="button">Aplicar posição</button>
      <button id="ha3dResetObjectTransform" class="secondary" type="button">Restaurar posição do GLB</button>
    </div>
  `;
  body.prepend(section);
  syncPreciseInputs(panel);

  section.querySelector("#ha3dApplyPreciseTransform")?.addEventListener("click", async () => {
    const selected = resolveLogicalRoot(panel, panel._selectedObject);
    if (!selected) return;
    const read = (key, fallback) => {
      const value = Number(section.querySelector(`[data-ha3d-transform="${key}"]`)?.value);
      return Number.isFinite(value) ? value : fallback;
    };
    selected.position.set(
      read("px", selected.position.x),
      read("py", selected.position.y),
      read("pz", selected.position.z),
    );
    selected.updateMatrixWorld(true);
    ensureSelectionBox(panel, selected);
    await panel._persistSelectedTransform?.();
  });

  section.querySelector("#ha3dResetObjectTransform")?.addEventListener("click", async () => {
    const selected = resolveLogicalRoot(panel, panel._selectedObject);
    const base = selected?.userData?.ha3dBaseTransformV1;
    if (!selected || !base) return;

    applyTransform(selected, base);
    const key = objectKey(selected);
    const positions = { ...(panel._config?.object_positions || {}) };
    delete positions[key];
    try {
      await panel._saveConfigPatch?.({ object_positions: positions });
      ensureSelectionBox(panel, selected);
      syncPreciseInputs(panel);
      panel._setStatus?.("Posição original do GLB restaurada");
    } catch (error) {
      panel._setStatus?.(`Erro ao restaurar posição: ${error.message || error}`);
    }
  });
}

if (!proto.__ha3dEditorLogicalRootV1) {
  proto.__ha3dEditorLogicalRootV1 = true;

  // Apply persisted transforms only to logical GLB nodes, never to generated
  // primitive meshes. Legacy per-piece transforms are intentionally ignored so
  // a previously moved primitive cannot keep an object visually disassembled.
  proto._applySavedObjectPositions = function () {
    const saved = this._config?.object_positions || {};
    const roots = annotateLogicalRoots(this);
    for (const root of roots) {
      const key = objectKey(root);
      const value = saved[key];
      if (value) applyTransform(root, value);
    }
  };

  const oldLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    const result = await oldLoadModel?.apply(this, args);
    annotateLogicalRoots(this);
    ensureSelectionBox(this, null);
    return result;
  };

  // Raycast still hits the exact triangle, but editor selection resolves that
  // hit to the exported GLB object that owns all of its material primitives.
  proto._pickObject = function (event) {
    if (!this._model) return null;
    const rect = this._renderer.domElement.getBoundingClientRect();
    this._pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._pointer, this._camera);
    const hit = this._raycaster.intersectObject(this._model, true)
      .find((item) => !item.object?.userData?.ha3dEditorHelper);
    return resolveLogicalRoot(this, hit?.object || null);
  };

  const oldSelectForEditor = proto._selectForEditor;
  proto._selectForEditor = function (object) {
    const root = resolveLogicalRoot(this, object);
    if (!root) return;
    const result = oldSelectForEditor?.call(this, root);
    this._selectedObject = root;
    this._transformControls?.attach?.(root);
    ensureSelectionBox(this, root);
    syncPreciseInputs(this);
    const pieces = countMeshes(root);
    const name = objectKey(root) || "objeto";
    this._setStatus?.(`Selecionado: ${name}${pieces > 1 ? ` · ${pieces} partes` : ""}`);
    return result;
  };

  // Free drag is floor-plan oriented: keep the object's world-space height and
  // move it over the X/Z plane. Vertical placement remains available through
  // the TransformControls Y axis or the precise Y field.
  proto._beginObjectDrag = function (event, object) {
    const root = resolveLogicalRoot(this, object);
    if (!root || !this._editorMode) return;

    const orbitWasEnabled = this._controls?.enabled !== false;
    if (this._controls) this._controls.enabled = false;
    this._ha3dEditorDirectDrag = true;

    root.updateMatrixWorld(true);
    const startWorld = root.getWorldPosition(new THREE.Vector3());
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -startWorld.y);
    const point = new THREE.Vector3();

    const setPointer = (pointerEvent) => {
      const rect = this._renderer.domElement.getBoundingClientRect();
      this._pointer.set(
        ((pointerEvent.clientX - rect.left) / rect.width) * 2 - 1,
        -((pointerEvent.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this._raycaster.setFromCamera(this._pointer, this._camera);
    };

    setPointer(event);
    if (!this._raycaster.ray.intersectPlane(plane, point)) {
      this._ha3dEditorDirectDrag = false;
      if (this._controls) this._controls.enabled = orbitWasEnabled;
      return;
    }
    const offset = startWorld.clone().sub(point);

    const move = (moveEvent) => {
      setPointer(moveEvent);
      if (!this._raycaster.ray.intersectPlane(plane, point)) return;
      const worldTarget = point.clone().add(offset);
      worldTarget.y = startWorld.y;
      const parent = root.parent;
      root.position.copy(parent ? parent.worldToLocal(worldTarget.clone()) : worldTarget);
      root.updateMatrixWorld(true);
      ensureSelectionBox(this, root);
      syncPreciseInputs(this);
    };

    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this._ha3dEditorDirectDrag = false;
      if (this._controls && !this._transformControls?.dragging) this._controls.enabled = orbitWasEnabled;
      await this._persistSelectedTransform?.();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", up, { once: true });
  };

  const oldPersistSelectedTransform = proto._persistSelectedTransform;
  proto._persistSelectedTransform = async function (...args) {
    const root = resolveLogicalRoot(this, this._selectedObject);
    if (!root) return oldPersistSelectedTransform?.apply(this, args);
    this._selectedObject = root;
    const key = objectKey(root);
    if (!key) return;
    const positions = {
      ...(this._config?.object_positions || {}),
      [key]: transformPayload(root),
    };
    try {
      await this._saveConfigPatch?.({ object_positions: positions });
      ensureSelectionBox(this, root);
      syncPreciseInputs(this);
      this._setStatus?.("Transformação do objeto completo salva");
    } catch (error) {
      this._setStatus?.(`Erro ao salvar transformação: ${error.message || error}`);
    }
  };

  const oldRenderEditorForm = proto._renderEditorForm;
  proto._renderEditorForm = async function (...args) {
    const result = await oldRenderEditorForm?.apply(this, args);
    installPreciseControls(this);
    return result;
  };

  const oldToggleEditor = proto._toggleEditor;
  proto._toggleEditor = function (...args) {
    const result = oldToggleEditor?.apply(this, args);
    if (!this._editorMode) {
      if (this._ha3dSelectionBox) this._ha3dSelectionBox.visible = false;
    } else if (this._selectedObject) {
      ensureSelectionBox(this, this._selectedObject);
    }
    return result;
  };

  const oldInitViewer = proto._initViewer;
  proto._initViewer = function (...args) {
    const result = oldInitViewer?.apply(this, args);
    queueMicrotask(() => {
      this._transformControls?.addEventListener?.("objectChange", () => {
        ensureSelectionBox(this, this._selectedObject);
        syncPreciseInputs(this);
      });
    });
    return result;
  };
}
