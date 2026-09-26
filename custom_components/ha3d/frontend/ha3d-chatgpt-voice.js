const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const STORE = "ha3d_chatgpt_voice_v1";
const VS_ENTITY = "vs-satellite-entity";
const VS_CONFIG = "vs-panel-config";
const WAKE = "WAKE_WORD_DETECTED";
const DEFAULT_SHORTCUT = "HA Voz";
const COOLDOWN = 7000;
const NATIVE_RESTART_MS = 800;
let activePanel = null;
let hookTimer = null;
let lastLaunch = 0;
let nativeWake = null;

const appleMobile = () => /iPhone|iPad|iPod/i.test(navigator.userAgent || "")
  || (navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints) > 1);
const android = () => /Android/i.test(navigator.userAgent || "");

function defaults() {
  return {
    auto: true,
    cancelAssist: true,
    wakeEnabled: true,
    launcher: appleMobile() ? "shortcut" : (android() ? "app" : "web"),
    shortcut: DEFAULT_SHORTCUT,
    custom: "",
  };
}

function readCfg() {
  const base = defaults();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE) || "null") || {};
    return {
      ...base,
      ...parsed,
      auto: parsed.auto !== false,
      cancelAssist: parsed.cancelAssist !== false,
      wakeEnabled: parsed.wakeEnabled !== false,
    };
  } catch (_) { return base; }
}

function writeCfg(cfg) {
  try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (_) { /* storage disabled */ }
}

function targetUrl(cfg) {
  if (cfg.launcher === "shortcut") {
    const name = String(cfg.shortcut || DEFAULT_SHORTCUT).trim() || DEFAULT_SHORTCUT;
    return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
  }
  if (cfg.launcher === "app") return "chatgpt://";
  if (cfg.launcher === "custom") return String(cfg.custom || "").trim();
  return "https://chatgpt.com/";
}

function setStatus(panel, text, state = "idle") {
  const root = panel?.shadowRoot;
  if (!root) return;
  const label = root.querySelector("#ha3dGptStatus");
  const button = root.querySelector("#ha3dGptButton");
  if (label) label.textContent = text;
  if (button) button.dataset.state = state;
}

function stopVoiceSatellitePipelineSoon() {
  const session = window.__vsSession;
  if (!session) return;
  const stop = () => {
    try {
      const result = session.pipeline?.stop?.();
      result?.catch?.(() => {});
    } catch (_) { /* visibility teardown is the fallback */ }
  };
  setTimeout(stop, 0);
  setTimeout(stop, 250);
}

async function releaseWakeMic() {
  if (!nativeWake) return;
  try { await nativeWake.stop({ releaseMic: true, sendEnd: true }); } catch (_) { /* best effort */ }
}

function launch(panel, source = "manual", force = false) {
  const cfg = readCfg();
  if (!force && !cfg.auto) return;
  const now = Date.now();
  if (!force && now - lastLaunch < COOLDOWN) return;
  const url = targetUrl(cfg);
  if (!url) return setStatus(panel, "Configure a URL", "error");
  lastLaunch = now;
  if (source === "voice-satellite" && cfg.cancelAssist) stopVoiceSatellitePipelineSoon();
  releaseWakeMic();
  setStatus(panel, "Wake detectado · abrindo ChatGPT…", "wake");
  setTimeout(() => {
    try { window.location.assign(url); }
    catch (_) { window.location.href = url; }
  }, 80);
  // If the OS/browser refuses the handoff and the page stays visible, re-arm.
  setTimeout(() => {
    if (document.visibilityState === "visible") ensureWake(activePanel);
  }, 2500);
}

function emitWake(source) {
  window.dispatchEvent(new CustomEvent("ha3d-chatgpt-wake", { detail: { source } }));
}

function installSessionHook(panel) {
  const session = window.__vsSession;
  if (!session || typeof session.setState !== "function") return false;
  if (!session.__ha3dGptWakeHook) {
    const original = session.setState.bind(session);
    session.setState = function (next) {
      const previous = this.currentState;
      const result = original(next);
      if (next === WAKE && previous !== WAKE) emitWake("voice-satellite");
      return result;
    };
    session.__ha3dGptWakeHook = true;
  }
  nativeWake?.stop({ releaseMic: true, sendEnd: true });
  setStatus(panel, "Wake pronto · Voice Satellite", "ready");
  return true;
}

function satelliteEntity(hass) {
  let id = null;
  try {
    id = localStorage.getItem(VS_ENTITY);
    if (!id) id = JSON.parse(localStorage.getItem(VS_CONFIG) || "{}")?.satellite_entity || null;
  } catch (_) { id = null; }
  return id && hass?.states?.[id] ? id : null;
}

function fallbackWatch(panel, hass) {
  if (window.__vsSession || nativeWake?.running) return;
  const id = satelliteEntity(hass);
  if (!id) return;
  const next = hass.states[id]?.state || null;
  const previous = panel._ha3dGptVsState;
  panel._ha3dGptVsState = next;
  if (next === "listening" && previous && previous !== "listening") emitWake("assist-satellite-fallback");
}

class NativeHaWake {
  constructor(panel) {
    this.panel = panel;
    this.hass = null;
    this.context = null;
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.sink = null;
    this.handlerId = null;
    this.buffer = [];
    this.unsubscribe = null;
    this.unsubscribePromise = null;
    this.running = false;
    this.starting = false;
    this.detected = false;
    this.restartTimer = null;
  }

  update(panel, hass) {
    this.panel = panel || this.panel;
    this.hass = hass || this.hass;
  }

  async start() {
    if (this.running || this.starting || window.__vsSession || !readCfg().wakeEnabled) return;
    if (document.visibilityState === "hidden") return;
    if (!this.hass?.connection?.subscribeMessage) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus(this.panel, "Microfone indisponível neste navegador", "error");
      return;
    }
    if (!window.isSecureContext) {
      setStatus(this.panel, "Wake word requer HTTPS", "error");
      return;
    }

    this.starting = true;
    this.detected = false;
    this.buffer = [];
    this.handlerId = null;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error("AudioContext indisponível");
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.context = new AudioCtx();
      await this.context.resume();
      this.source = this.context.createMediaStreamSource(this.stream);
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      this.sink = this.context.createGain();
      this.sink.gain.value = 0;
      this.processor.onaudioprocess = (event) => this.onAudio(event);
      this.source.connect(this.processor);
      this.processor.connect(this.sink);
      this.sink.connect(this.context.destination);
      this.running = true;
      setStatus(this.panel, "Conectando wake word do HA…", "idle");

      const options = {
        type: "assist_pipeline/run",
        start_stage: "wake_word",
        end_stage: "stt",
        input: { sample_rate: this.context.sampleRate, timeout: 300, audio_seconds_to_buffer: 1.5 },
      };
      this.unsubscribePromise = this.hass.connection.subscribeMessage((event) => this.onPipelineEvent(event), options);
      this.unsubscribePromise.then((unsub) => { this.unsubscribe = unsub; }).catch((error) => this.fail(error));
    } catch (error) {
      await this.stop({ releaseMic: true, sendEnd: false });
      const message = error?.name === "NotAllowedError" ? "Permita o microfone para ativar o wake word" : `Wake indisponível: ${error?.message || error}`;
      setStatus(this.panel, message, "error");
    } finally {
      this.starting = false;
    }
  }

  onAudio(event) {
    if (!this.running) return;
    const samples = event.inputBuffer.getChannelData(0);
    const chunk = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      chunk[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    if (this.handlerId == null) {
      this.buffer.push(chunk);
      if (this.buffer.length > 30) this.buffer.shift();
    } else {
      this.send(chunk);
    }
  }

  send(chunk) {
    if (this.handlerId == null) return;
    const socket = this.hass?.connection?.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.binaryType = "arraybuffer";
    const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const data = new Uint8Array(1 + bytes.length);
    data[0] = this.handlerId;
    data.set(bytes, 1);
    socket.send(data);
  }

  onPipelineEvent(event) {
    if (!this.running) return;
    if (event.type === "run-start") {
      this.handlerId = event.data?.runner_data?.stt_binary_handler_id ?? null;
      if (this.handlerId != null) {
        for (const chunk of this.buffer) this.send(chunk);
        this.buffer = [];
      }
      setStatus(this.panel, "Ouvindo wake word pelo Home Assistant", "ready");
      return;
    }
    if (event.type === "wake_word-start") {
      setStatus(this.panel, "Ouvindo wake word pelo Home Assistant", "ready");
      return;
    }
    if (event.type === "wake_word-end") {
      this.detected = true;
      setStatus(this.panel, "Wake word detectado", "wake");
      this.stop({ releaseMic: true, sendEnd: true }).finally(() => emitWake("ha-assist-pipeline"));
      return;
    }
    if (event.type === "error") {
      const message = event.data?.message || event.data?.code || "pipeline indisponível";
      this.fail(new Error(message));
      return;
    }
    if (event.type === "run-end" && !this.detected) this.scheduleRestart();
  }

  fail(error) {
    if (this.detected) return;
    const message = String(error?.message || error || "");
    const missingWake = /wake|pipeline/i.test(message);
    setStatus(this.panel, missingWake ? `Wake do HA indisponível · ${message}` : `Wake: ${message}`, "error");
    this.scheduleRestart(5000);
  }

  scheduleRestart(delay = NATIVE_RESTART_MS) {
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(async () => {
      await this.stop({ releaseMic: true, sendEnd: true });
      if (!this.detected && document.visibilityState === "visible") this.start();
    }, delay);
  }

  async stop({ releaseMic = true, sendEnd = true } = {}) {
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const wasRunning = this.running;
    this.running = false;
    if (sendEnd && wasRunning && this.handlerId != null) this.send(new Int16Array());
    try {
      if (this.unsubscribe) await this.unsubscribe();
      else if (this.unsubscribePromise) {
        const unsub = await Promise.race([
          this.unsubscribePromise.catch(() => null),
          new Promise((resolve) => setTimeout(() => resolve(null), 250)),
        ]);
        if (unsub) await unsub();
      }
    } catch (_) { /* already closed */ }
    this.unsubscribe = null;
    this.unsubscribePromise = null;
    this.handlerId = null;
    this.buffer = [];
    if (this.processor) this.processor.onaudioprocess = null;
    try { this.source?.disconnect(); } catch (_) {}
    try { this.processor?.disconnect(); } catch (_) {}
    try { this.sink?.disconnect(); } catch (_) {}
    this.source = null;
    this.processor = null;
    this.sink = null;
    if (releaseMic) {
      try { this.stream?.getTracks()?.forEach((track) => track.stop()); } catch (_) {}
      try { await this.context?.close(); } catch (_) {}
      this.stream = null;
      this.context = null;
    }
  }
}

function ensureWake(panel) {
  if (!panel || !readCfg().wakeEnabled) return;
  if (installSessionHook(panel)) return;
  if (hookTimer == null) {
    hookTimer = setInterval(() => {
      if (activePanel && installSessionHook(activePanel)) {
        clearInterval(hookTimer);
        hookTimer = null;
      }
    }, 1500);
  }
  if (!nativeWake) nativeWake = new NativeHaWake(panel);
  nativeWake.update(panel, panel._hass);
  nativeWake.start();
}

function syncForm(panel) {
  const r = panel.shadowRoot;
  const c = readCfg();
  r.querySelector("#ha3dGptWakeEnabled").checked = c.wakeEnabled;
  r.querySelector("#ha3dGptAuto").checked = c.auto;
  r.querySelector("#ha3dGptCancel").checked = c.cancelAssist;
  r.querySelector("#ha3dGptLauncher").value = c.launcher;
  r.querySelector("#ha3dGptShortcut").value = c.shortcut || DEFAULT_SHORTCUT;
  r.querySelector("#ha3dGptCustom").value = c.custom || "";
  r.querySelector("#ha3dGptShortcutRow").hidden = c.launcher !== "shortcut";
  r.querySelector("#ha3dGptCustomRow").hidden = c.launcher !== "custom";
}

function saveForm(panel) {
  const r = panel.shadowRoot;
  const cfg = {
    wakeEnabled: r.querySelector("#ha3dGptWakeEnabled").checked,
    auto: r.querySelector("#ha3dGptAuto").checked,
    cancelAssist: r.querySelector("#ha3dGptCancel").checked,
    launcher: r.querySelector("#ha3dGptLauncher").value,
    shortcut: r.querySelector("#ha3dGptShortcut").value.trim() || DEFAULT_SHORTCUT,
    custom: r.querySelector("#ha3dGptCustom").value.trim(),
  };
  writeCfg(cfg);
  syncForm(panel);
  if (!cfg.wakeEnabled) nativeWake?.stop({ releaseMic: true, sendEnd: true });
  else ensureWake(panel);
  setStatus(panel, "Configuração salva", "ready");
}

function installUi(panel) {
  const r = panel?.shadowRoot;
  if (!r || r.querySelector("#ha3dGptDock")) return;
  const style = document.createElement("style");
  style.textContent = `
    #ha3dGptDock{position:absolute;left:max(14px,env(safe-area-inset-left));bottom:max(14px,env(safe-area-inset-bottom));z-index:95;display:flex;gap:7px;align-items:center;pointer-events:auto}
    #ha3dGptButton{width:50px;height:50px;padding:0;border-radius:50%;font-size:22px;background:#15171de8;border:1px solid #ffffff2d}#ha3dGptButton[data-state=wake]{animation:gptPulse .7s infinite alternate}#ha3dGptButton[data-state=error]{box-shadow:0 0 0 2px #ff665577}
    #ha3dGptMeta{display:flex;align-items:center;gap:5px;padding:5px 6px 5px 10px;border-radius:12px;background:#15171de8;border:1px solid #ffffff1f;backdrop-filter:blur(14px)}#ha3dGptStatus{font-size:11px;max-width:48vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#ha3dGptSettings{width:32px;height:32px;padding:0;background:#ffffff12}
    #ha3dGptPanel{display:none;position:absolute;left:0;bottom:62px;width:min(350px,calc(100vw - 28px));padding:12px;border-radius:15px;background:#11141af5;border:1px solid #ffffff26;box-shadow:0 12px 35px #0008}#ha3dGptPanel.open{display:block}#ha3dGptPanel h3{margin:0 0 8px;font-size:14px}.gptRow{display:grid;gap:4px;margin:8px 0}.gptCheck{display:flex;gap:7px;align-items:center;font-size:11px;margin:7px 0}.gptRow label,.gptHint{font-size:10px;opacity:.7}.gptRow select,.gptRow input{width:100%;min-height:35px;padding:7px;border-radius:8px;border:1px solid #ffffff26;background:#0d0f14;color:#fff}.gptActions{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}.gptActions button{flex:1;min-width:80px;padding:8px;font-size:11px}@keyframes gptPulse{to{transform:scale(1.08);box-shadow:0 0 0 7px #4fd59a22}}
  `;
  r.appendChild(style);

  const dock = document.createElement("div");
  dock.id = "ha3dGptDock";
  dock.innerHTML = `
    <button id="ha3dGptButton" class="secondary" data-state="idle" title="ChatGPT Voice">◉</button>
    <div id="ha3dGptMeta"><span id="ha3dGptStatus">Inicializando wake word…</span><button id="ha3dGptSettings" class="secondary" title="Configurar">⚙</button></div>
    <div id="ha3dGptPanel">
      <h3>ChatGPT Voice</h3>
      <label class="gptCheck"><input id="ha3dGptWakeEnabled" type="checkbox"> Dashboard fica ouvindo o wake word</label>
      <label class="gptCheck"><input id="ha3dGptAuto" type="checkbox"> Abrir ChatGPT ao detectar o wake word</label>
      <label class="gptCheck"><input id="ha3dGptCancel" type="checkbox"> Encerrar Assist no handoff</label>
      <div class="gptRow"><label>Como abrir</label><select id="ha3dGptLauncher"><option value="shortcut">Atalho do iOS</option><option value="app">App ChatGPT</option><option value="web">ChatGPT Web</option><option value="custom">URL personalizada</option></select></div>
      <div id="ha3dGptShortcutRow" class="gptRow"><label>Nome do Atalho</label><input id="ha3dGptShortcut" type="text"><div class="gptHint">O Atalho deve executar “Iniciar conversa por voz” do ChatGPT. Padrão: HA Voz.</div></div>
      <div id="ha3dGptCustomRow" class="gptRow"><label>URL</label><input id="ha3dGptCustom" type="url" placeholder="meuapp://..."></div>
      <div class="gptHint">Se Voice Satellite estiver instalado, ele é usado. Caso contrário, o HA3D usa diretamente o pipeline oficial Assist para enviar o microfone ao wake word do Home Assistant.</div>
      <div class="gptActions"><button id="ha3dGptWakeStart">Ativar wake</button><button id="ha3dGptTest">Testar GPT</button><button id="ha3dGptSave">Salvar</button><button id="ha3dGptClose" class="secondary">Fechar</button></div>
    </div>`;
  (r.querySelector("#root") || r).appendChild(dock);

  const panelEl = dock.querySelector("#ha3dGptPanel");
  dock.querySelector("#ha3dGptButton").onclick = (e) => { e.stopPropagation(); launch(panel, "manual", true); };
  dock.querySelector("#ha3dGptSettings").onclick = (e) => { e.stopPropagation(); syncForm(panel); panelEl.classList.toggle("open"); };
  dock.querySelector("#ha3dGptLauncher").onchange = () => saveForm(panel);
  dock.querySelector("#ha3dGptWakeStart").onclick = () => { saveForm(panel); ensureWake(panel); };
  dock.querySelector("#ha3dGptSave").onclick = () => saveForm(panel);
  dock.querySelector("#ha3dGptClose").onclick = () => panelEl.classList.remove("open");
  dock.querySelector("#ha3dGptTest").onclick = () => { saveForm(panel); launch(panel, "manual", true); };
  syncForm(panel);
}

if (!window.__ha3dGptWakeListener) {
  window.__ha3dGptWakeListener = true;
  window.addEventListener("ha3d-chatgpt-wake", (e) => launch(activePanel, e.detail?.source || "wake"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") nativeWake?.stop({ releaseMic: true, sendEnd: true });
    else if (activePanel) setTimeout(() => ensureWake(activePanel), 350);
  });
}

if (!proto.__ha3dGptVoicePatch) {
  proto.__ha3dGptVoicePatch = true;
  const connected = proto.connectedCallback;
  proto.connectedCallback = function () {
    connected.call(this);
    activePanel = this;
    queueMicrotask(() => { installUi(this); ensureWake(this); if (this._hass) fallbackWatch(this, this._hass); });
  };
  const disconnected = proto.disconnectedCallback;
  proto.disconnectedCallback = function () {
    if (activePanel === this) activePanel = null;
    nativeWake?.stop({ releaseMic: true, sendEnd: true });
    return disconnected?.call(this);
  };
  const hass = Object.getOwnPropertyDescriptor(proto, "hass");
  if (hass?.set) Object.defineProperty(proto, "hass", {
    configurable: true,
    enumerable: hass.enumerable,
    get: hass.get,
    set(value) {
      hass.set.call(this, value);
      activePanel = this;
      if (nativeWake) nativeWake.update(this, value);
      queueMicrotask(() => { installUi(this); ensureWake(this); fallbackWatch(this, value); });
    },
  });
}
