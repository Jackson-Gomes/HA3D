import "./ha3d-panel.js";

const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const XR_SESSION_MODE = "immersive-vr";

function ensureXRState(panel) {
  if (panel._ha3dXRReady) return;
  panel._ha3dXRReady = true;
  panel._ha3dXRPresenting = false;
  panel._ha3dXRSession = null;
  panel._ha3dXRSupport = null;
  panel._ha3dXRRestore = null;
  panel._ha3dXRDiagnostic = "XR carregado";
}

function installXRStyle(panel) {
  if (!panel.shadowRoot || panel.shadowRoot.querySelector("#ha3dWebXRStyle")) return;
  const style = document.createElement("style");
  style.id = "ha3dWebXRStyle";
  style.textContent = `
    #xrButton{
      position:absolute!important;
      top:max(14px,env(safe-area-inset-top))!important;
      right:max(14px,env(safe-area-inset-right))!important;
      z-index:2147483000!important;
      display:inline-flex!important;
      align-items:center!important;
      justify-content:center!important;
      min-height:42px!important;
      padding:10px 14px!important;
      border-radius:13px!important;
      border:1px solid rgba(255,255,255,.22)!important;
      box-shadow:0 7px 28px rgba(0,0,0,.42)!important;
      backdrop-filter:blur(10px);
      -webkit-backdrop-filter:blur(10px);
      opacity:1!important;
      pointer-events:auto!important;
      font:600 13px system-ui,sans-serif!important;
      color:#fff!important;
      background:#493b22!important;
    }
    #xrButton.ha3d-xr-ready{background:#164d7b!important}
    #xrButton.ha3d-xr-warning{background:#493b22!important;color:#fff3c2!important}
    #xrButton.ha3d-xr-error{background:#682f2f!important;color:#ffe1e1!important}
    #root.ha3d-xr-presenting > :not(#stage){opacity:0!important;pointer-events:none!important}
    #root.ha3d-xr-presenting #stage{inset:0!important}
  `;
  panel.shadowRoot.appendChild(style);
}

function setXRButton(panel, { enabled = false, text = "XR", state = "warning", detail = "" } = {}) {
  const button = panel.shadowRoot?.querySelector("#xrButton");
  if (!button) return;
  panel._ha3dXRDiagnostic = detail || text;
  button.textContent = text;
  button.disabled = !enabled;
  button.title = detail || text;
  button.setAttribute("aria-label", detail || text);
  button.dataset.xrState = state;
  button.classList.toggle("ha3d-xr-ready", state === "ready");
  button.classList.toggle("ha3d-xr-warning", state === "warning");
  button.classList.toggle("ha3d-xr-error", state === "error");
}

function installXRButton(panel) {
  ensureXRState(panel);
  installXRStyle(panel);
  if (!panel.shadowRoot) return false;

  let button = panel.shadowRoot.querySelector("#xrButton");
  if (!button) {
    const root = panel.shadowRoot.querySelector("#root");
    if (!root) return false;
    button = document.createElement("button");
    button.id = "xrButton";
    button.type = "button";
    button.className = "ha3d-xr-warning";
    button.textContent = "XR carregado";
    button.title = "Módulo WebXR do HA3D carregado";
    button.disabled = true;
    button.addEventListener("click", () => panel._ha3dToggleXR?.());
    root.appendChild(button);
  }

  panel._ha3dProbeXR?.();
  return true;
}

function scheduleXRInstall(panel) {
  const install = () => installXRButton(panel);
  queueMicrotask(install);
  requestAnimationFrame(install);
  setTimeout(install, 250);
  setTimeout(install, 1000);
}

function collectHa3dPanels(root, found = new Set()) {
  if (!root) return found;
  if (root.localName === "ha3d-panel") found.add(root);
  if (!root.querySelectorAll) return found;

  for (const element of root.querySelectorAll("*")) {
    if (element.localName === "ha3d-panel") found.add(element);
    if (element.shadowRoot) collectHa3dPanels(element.shadowRoot, found);
  }
  return found;
}

function installOnExistingPanels() {
  for (const panel of collectHa3dPanels(document)) {
    ensureXRState(panel);
    scheduleXRInstall(panel);
  }
}

function captureXRRestore(panel) {
  return {
    cameraPosition: panel._camera?.position?.clone?.(),
    cameraQuaternion: panel._camera?.quaternion?.clone?.(),
    cameraUp: panel._camera?.up?.clone?.(),
    controlsTarget: panel._controls?.target?.clone?.(),
    controlsEnabled: panel._controls?.enabled,
    controlsDamping: panel._controls?.enableDamping,
    cameraAnimating: Boolean(panel._cameraAnimating),
  };
}

function restoreDesktopCamera(panel) {
  const state = panel._ha3dXRRestore;
  if (!state) return;
  if (panel._camera) {
    if (state.cameraPosition) panel._camera.position.copy(state.cameraPosition);
    if (state.cameraQuaternion) panel._camera.quaternion.copy(state.cameraQuaternion);
    if (state.cameraUp) panel._camera.up.copy(state.cameraUp);
  }
  if (panel._controls) {
    if (state.controlsTarget) panel._controls.target.copy(state.controlsTarget);
    panel._controls.enabled = state.controlsEnabled !== false;
    panel._controls.enableDamping = state.controlsDamping !== false;
    panel._controls.update?.();
  }
  panel._cameraAnimating = state.cameraAnimating;
  panel._ha3dXRRestore = null;
}

function pauseDesktopCameraSystems(panel) {
  panel._ha3dXRRestore = captureXRRestore(panel);
  panel._cameraAnimating = true;

  clearTimeout(panel._cinematicBatchTimer);
  clearTimeout(panel._cinematicDrainTimer);
  panel._cinematicPending?.clear?.();
  if (Array.isArray(panel._cinematicQueue)) panel._cinematicQueue.length = 0;
  panel._cinematicActive = false;

  if (panel._ha3dIdleRaf) cancelAnimationFrame(panel._ha3dIdleRaf);
  panel._ha3dIdleRaf = 0;
  panel._ha3dIdleLastActivity = Date.now();
  panel._ha3dIdleResumeAt = 0;

  if (panel._controls) {
    panel._controls.enabled = false;
    panel._controls.enableDamping = false;
  }
}

if (!proto.__ha3dWebXRPatchedV4) {
  proto.__ha3dWebXRPatchedV4 = true;

  const originalConnectedCallback = proto.connectedCallback;
  proto.connectedCallback = function () {
    ensureXRState(this);
    const result = originalConnectedCallback.call(this);
    scheduleXRInstall(this);
    return result;
  };

  const originalDisconnectedCallback = proto.disconnectedCallback;
  proto.disconnectedCallback = function () {
    const session = this._ha3dXRSession;
    this._ha3dXRSession = null;
    if (session?.end) session.end().catch?.(() => {});
    return originalDisconnectedCallback?.call(this);
  };

  const originalUpdateLightMarkers = proto._updateLightMarkers;
  if (originalUpdateLightMarkers) {
    proto._updateLightMarkers = function (...args) {
      if (this._ha3dXRPresenting) return;
      return originalUpdateLightMarkers.apply(this, args);
    };
  }

  proto._ha3dProbeXR = async function () {
    ensureXRState(this);
    installXRStyle(this);

    if (!window.isSecureContext) {
      this._ha3dXRSupport = false;
      setXRButton(this, {
        enabled: false,
        text: "VR exige HTTPS",
        state: "warning",
        detail: `WebXR requer HTTPS. Origem: ${location.origin}`,
      });
      return false;
    }

    if (!navigator.xr?.isSessionSupported) {
      this._ha3dXRSupport = false;
      setXRButton(this, {
        enabled: false,
        text: "WebXR indisponível",
        state: "error",
        detail: "navigator.xr não está disponível neste contexto do navegador",
      });
      return false;
    }

    try {
      const supported = await navigator.xr.isSessionSupported(XR_SESSION_MODE);
      this._ha3dXRSupport = Boolean(supported);
      setXRButton(this, supported
        ? { enabled: true, text: "Entrar no VR", state: "ready", detail: "WebXR immersive-vr disponível" }
        : { enabled: false, text: "VR não suportado", state: "warning", detail: "immersive-vr retornou false" });
      return supported;
    } catch (error) {
      console.warn("[HA3D XR] support probe failed", error);
      this._ha3dXRSupport = false;
      const blocked = error?.name === "SecurityError";
      setXRButton(this, {
        enabled: false,
        text: blocked ? "XR bloqueado" : "Erro WebXR",
        state: "error",
        detail: blocked
          ? "Bloqueado por segurança/Permissions-Policy xr-spatial-tracking"
          : `Falha ao verificar immersive-vr: ${error?.name || "erro"}`,
      });
      return false;
    }
  };

  proto._ha3dToggleXR = async function () {
    ensureXRState(this);
    if (this._ha3dXRPresenting) {
      await this._ha3dXRSession?.end?.();
      return;
    }

    if (!this._renderer || !window.isSecureContext || !navigator.xr?.requestSession) {
      await this._ha3dProbeXR?.();
      return;
    }

    try {
      setXRButton(this, {
        enabled: false,
        text: "Abrindo VR…",
        state: "warning",
        detail: "Solicitando immersive-vr ao Meta Quest Browser",
      });

      const session = await navigator.xr.requestSession(XR_SESSION_MODE, {
        requiredFeatures: ["local-floor"],
        optionalFeatures: ["bounded-floor", "hand-tracking", "layers"],
      });

      this._ha3dXRSession = session;
      pauseDesktopCameraSystems(this);
      this._ha3dXRPresenting = true;
      this.shadowRoot?.querySelector("#root")?.classList.add("ha3d-xr-presenting");
      this.shadowRoot?.querySelector("#viewsPanel")?.classList.remove("open");

      this._renderer.xr.enabled = true;
      this._renderer.xr.setReferenceSpaceType?.("local-floor");
      this._renderer.xr.setFramebufferScaleFactor?.(0.85);
      await this._renderer.xr.setSession(session);
      this._renderer.xr.setFoveation?.(0.65);

      setXRButton(this, { enabled: true, text: "Sair do VR", state: "ready", detail: "Sessão WebXR ativa" });

      session.addEventListener("end", () => {
        this._ha3dXRSession = null;
        this._ha3dXRPresenting = false;
        this.shadowRoot?.querySelector("#root")?.classList.remove("ha3d-xr-presenting");
        restoreDesktopCamera(this);
        this._ha3dIdleLastActivity = Date.now();
        setXRButton(this, { enabled: true, text: "Entrar no VR", state: "ready", detail: "WebXR immersive-vr disponível" });
      }, { once: true });
    } catch (error) {
      console.error("[HA3D XR] session failed", error);
      this._ha3dXRSession = null;
      this._ha3dXRPresenting = false;
      this.shadowRoot?.querySelector("#root")?.classList.remove("ha3d-xr-presenting");
      restoreDesktopCamera(this);

      let message = "Falha ao abrir VR";
      let detail = `requestSession falhou: ${error?.name || "erro"}`;
      if (error?.name === "NotSupportedError") {
        message = "VR não suportado";
        detail = "O navegador recusou immersive-vr ou algum recurso obrigatório";
      } else if (error?.name === "SecurityError") {
        message = "XR bloqueado";
        detail = "Bloqueado por segurança/Permissions-Policy xr-spatial-tracking";
      }

      setXRButton(this, { enabled: false, text: message, state: "error", detail });
      setTimeout(() => {
        if (!this._ha3dXRPresenting) this._ha3dProbeXR?.();
      }, 2600);
    }
  };
}

// Home Assistant can upgrade <ha3d-panel> synchronously while ha3d-panel.js is
// imported, before this module gets a chance to patch connectedCallback. Apply
// XR to any panel instance that is already alive, including panels nested in
// Home Assistant shadow roots.
queueMicrotask(installOnExistingPanels);
requestAnimationFrame(installOnExistingPanels);
setTimeout(installOnExistingPanels, 250);
setTimeout(installOnExistingPanels, 1000);
setTimeout(installOnExistingPanels, 2500);
