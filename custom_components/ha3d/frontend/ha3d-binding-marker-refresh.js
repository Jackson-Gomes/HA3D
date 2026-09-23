const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function objectKey(object) {
  return String(object?.userData?.ha3dOriginalNodeName || object?.name || "").trim();
}

function prioritizeRootForEntity(panel, root, entityId) {
  if (!root || !entityId || !panel?._objectsByEntity) return;

  // A manual binding is authoritative for the selected logical object. Remove
  // that root from any previous entity bucket, then place it first in the new
  // bucket so marker creation uses it as the visual anchor.
  for (const [entity, objects] of [...panel._objectsByEntity.entries()]) {
    const filtered = (objects || []).filter((object) => object !== root);
    if (filtered.length) panel._objectsByEntity.set(entity, filtered);
    else panel._objectsByEntity.delete(entity);
  }

  root.userData ||= {};
  root.userData.ha3dEntityId = entityId;
  const current = panel._objectsByEntity.get(entityId) || [];
  panel._objectsByEntity.set(entityId, [root, ...current.filter((object) => object !== root)]);
  panel._boundCount = panel._objectsByEntity.size;
}

function rebuildMarkersForManualBinding(panel, root, entityId) {
  if (!panel?._model || !root || !entityId) return;

  // Re-run the normal index first so every pre-existing/automatic binding is
  // preserved, then make the freshly saved manual binding the primary anchor.
  panel._indexBindings?.();
  prioritizeRootForEntity(panel, root, entityId);

  panel._clearMarkers?.();
  panel._bindModelLights?.();
  panel._bindEntityLightMarkers?.();
  panel._bindAdvancedMarkers?.();

  // A light may already have created its marker through LightNode mapping.
  // Manual binding still owns the marker position, so re-anchor it explicitly.
  const binding = panel._lightBindings?.get?.(entityId);
  if (binding) {
    binding.anchor = root;
    binding.ha3dAnchorBounds = null;
  }

  panel._syncLightStates?.();
  panel._updateLightMarkers?.();
  const meta = panel.shadowRoot?.querySelector("#meta");
  if (meta) meta.textContent = `${panel._lightBindings?.size || 0} vínculos`;
}

if (!proto.__ha3dBindingMarkerRefreshV1) {
  proto.__ha3dBindingMarkerRefreshV1 = true;

  const oldSaveEditorBinding = proto._saveEditorBinding;
  proto._saveEditorBinding = async function (...args) {
    const root = this._selectedObject;
    const key = objectKey(root);
    const body = this.shadowRoot?.querySelector("#ha3dEditorBody");
    const requestedEntity = String(body?.querySelector("#ha3dEntity")?.value || "").trim();

    const result = await oldSaveEditorBinding?.apply(this, args);
    if (!root || !key || !requestedEntity) return result;

    // Only force the marker when persistence actually succeeded. This avoids
    // showing a temporary icon for a binding rejected by the backend.
    if (this._config?.bindings?.[key] !== requestedEntity) return result;

    rebuildMarkersForManualBinding(this, root, requestedEntity);
    this._setStatus?.(`Binding salvo · ícone ancorado em ${key}`);
    return result;
  };
}
