const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;

function hideEmptyOverlay(panel) {
  const empty = panel?.shadowRoot?.querySelector?.("#empty");
  if (empty) {
    empty.style.display = "none";
    empty.hidden = true;
    empty.setAttribute("aria-hidden", "true");
  }
}

function modelIsRenderable(panel) {
  const model = panel?._model;
  const scene = panel?._scene;
  if (!model || !scene) return false;
  if (model.parent === scene) return true;
  return Array.isArray(scene.children) && scene.children.includes(model);
}

if (!proto.__ha3dNoEmptyOverlayV1) {
  proto.__ha3dNoEmptyOverlayV1 = true;

  const oldRenderShell = proto._renderShell;
  proto._renderShell = function (...args) {
    const result = oldRenderShell?.apply(this, args);
    const style = document.createElement("style");
    style.textContent = "#empty{display:none!important}";
    this.shadowRoot?.append?.(style);
    hideEmptyOverlay(this);
    return result;
  };

  proto._showEmpty = function () {
    hideEmptyOverlay(this);
  };

  const oldLoadModel = proto._loadModel;
  proto._loadModel = async function (...args) {
    try {
      const result = await oldLoadModel?.apply(this, args);
      hideEmptyOverlay(this);
      return result;
    } catch (error) {
      hideEmptyOverlay(this);
      if (!modelIsRenderable(this)) throw error;
      console.error("[HA3D] auxiliary module failed after model load; scene preserved", error);
      const bindings = Number(this._boundCount) || 0;
      const lights = Number(this._modelLights?.length) || 0;
      this._setStatus?.(`Pronto · ${bindings} vínculos · ${lights} luzes 3D`);
      return undefined;
    }
  };

  const oldLoadConfig = proto._loadConfig;
  proto._loadConfig = async function (...args) {
    try {
      const result = await oldLoadConfig?.apply(this, args);
      hideEmptyOverlay(this);
      if (!this._config?.model_url && !this._model) this._setStatus?.("Nenhum GLB configurado · use Subir GLB");
      return result;
    } finally {
      hideEmptyOverlay(this);
    }
  };
}
