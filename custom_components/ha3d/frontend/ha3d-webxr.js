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
  panel._ha3dXRDiagnostic = "Inicializando WebXR";
}

function installXRStyle(panel) {
  if (!panel.shadowRoot || panel.shadowRoot.querySelector("#ha3dWebXRStyle")) return;
  const style = document.createElement("style");
  style.id = "ha3dWebXRStyle";
  style.textContent = `
    #xrButton{display:inline-flex;align-items:center;justify-content:center;gap:7px;background:#2b2e35}
    #xrButton.ha3d-xr-ready{background:#183f68}
    #xrButton.ha3d-xr-warning{background:#493b22;color:#fff3c2}
    #xrButton.ha3d-xr-error{background:#552828;color:#ffd1d1}
    #root.ha3d-xr-presenting > :not(#stage){opacity:0!important;pointer-events:none!important}
    #root.ha3d-xr-presenting #stage{inset:0!important}
  `;
  panel.shadowRoot.appendChild(style);
}

function setXRButton(panel, { enabled = false, text = "VR", state = "warning", detail = "" } = {}) {
  const button = panel.shadowRoot?.querySelector("#xrButton");
  if (!button) return;
  panel._ha3dXRDiagnostic = detail || text;
  button.textContent = text;
  button.disabled = !enabled;
  button.title = detail || text;
  button.dataset.xrState = state;
  button.classList.toggle("ha3d-xr-ready", state === "ready");
  button.classList.toggle("ha3d-xr-warning", state === "warning");
  button.classList.toggle("ha3d-xr-error", state === "error");
}

function installXRButton(panel) {
  ensureXRState(panel);
  installXRStyle(panel);
  if (!panel.shadowRoot || panel.shadowRoot.querySelector("#xrButton")) return;

  const actions = panel.shadowRoot.querySelector("#actions");
  if (!actions) return;

  const button = document.createElement("button");
  button.id = "xrButton";
  button.type = "button";
  button.className = "secondary ha3d-xr-warning";
  button.textContent = "XR verificando…";
  button.title = "Verificando suporte WebXR";
  button.disabled = true;
  button.addEventListener("click", () => panel._ha3dToggleXR?.());
  actions.prepend(button);

  panel._ha3dProbeXR?.();
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

if (!proto.__ha3dWebXRPatchedV2) {
  proto.__ha3dWebXRPatchedV2 = true;

  const originalConnectedCallback = proto.connectedCallback;
  proto.connectedCallback = function () {
    ensureXRState(this);
    originalConnectedCallback.call(this);
    queueMicrotask(() => installXRButton(this));
  };

  const originalDisconnectedCallback = proto.disconnectedCallback;
  proto.disconnectedCallback = function () {
    const session = this._ha3dXRSession;
    this._ha3dXRSession = null;
    if (session && session.end) session.end().catch?.(() => {});
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
        detail: `WebXR requer contexto seguro. Origem atual: ${location.origin}`,
      });
      console.warn("[HA3D XR] insecure context", location.origin);
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
      console.warn("[HA3D XR] navigator.xr unavailable", navigator.userAgent);
      return false;
    }

    try {
      const supported = await navigator.xr.isSessionSupported(XR_SESSION_MODE);
      this._ha3dXRSupport = Boolean(supported);
      if (supported) {
        setXRButton(this, {
          enabled: true,
          text: "Entrar no VR",
          state: "ready",
          detail: "WebXR immersive-vr disponível",
        });
      } else {
        setXRButton(this, {
          enabled: false,
          text: "VR não suportado",
          state: "warning",
          detail: "navigator.xr existe, mas immersive-vr retornou false",
        });
      }
      return supported;
    } catch (error) {
      console.warn("[HA3D XR] support probe failed", error);
      this._ha3dXRSupport = false;
      const securityBlocked = error?.name === "SecurityError";
      setXRButton(this, {
        enabled: false,
        text: securityBlocked ? "XR bloqueado" : "Erro WebXR",
        state: "error",
        detail: securityBlocked
          ? "WebXR foi bloqueado por segurança/Permissions-Policy (xr-spatial-tracking)"
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
        detail: "Solicitando sessão immersive-vr ao Meta Quest Browser",
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

      setXRButton(this, {
        enabled: true,
        text: "Sair do VR",
        state: "ready",
        detail: "Sessão WebXR ativa",
      });

      session.addEventListener("end", () => {
        this._ha3dXRSession = null;
        this._ha3dXRPresenting = false;
        this.shadowRoot?.querySelector("#root")?.classList.remove("ha3d-xr-presenting");
        restoreDesktopCamera(this);
        this._ha3dIdleLastActivity = Date.now();
        setXRButton(this, {
          enabled: true,
          text: "Entrar no VR",
          state: "ready",
          detail: "WebXR immersive-vr disponível",
        });
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
        detail = "WebXR foi bloqueado por segurança/Permissions-Policy (xr-spatial-tracking)";
      }

      setXRButton(this, { enabled: false, text: message, state: "error", detail });
      setTimeout(() => {
        if (!this._ha3dXRPresenting) this._ha3dProbeXR?.();
      }, 2600);
    }
  };
}
