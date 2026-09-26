const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");

const proto = Panel.prototype;
const STORE = "ha3d_chatgpt_browser_v1";
const TARGET_RATE = 48000;
const DEFAULT_SESSION_SECONDS = 120;
const NATIVE_RESTART_MS = 900;

let activePanel = null;
let runtime = null;

function readCfg() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null") || {};
    return {
      wakeEnabled: saved.wakeEnabled !== false,
      sessionSeconds: Number.isFinite(Number(saved.sessionSeconds)) ? Math.max(0, Number(saved.sessionSeconds)) : DEFAULT_SESSION_SECONDS,
    };
  } catch (_) {
    return { wakeEnabled: true, sessionSeconds: DEFAULT_SESSION_SECONDS };
  }
}

function writeCfg(cfg) {
  try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (_) {}
}

function setStatus(panel, text, state = "idle") {
  const r = panel?.shadowRoot;
  if (!r) return;
  const label = r.querySelector("#ha3dGptStatus");
  const button = r.querySelector("#ha3dGptButton");
  if (label) label.textContent = text;
  if (button) button.dataset.state = state;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function supervisor(hass, endpoint, method = "get", data = undefined) {
  const msg = { type: "supervisor/api", endpoint, method };
  if (data !== undefined) msg.data = data;
  return hass.callWS(msg);
}

async function listAddons(hass) {
  const result = await supervisor(hass, "/addons", "get");
  return Array.isArray(result?.addons) ? result.addons : [];
}

function addonMatches(addon, kind) {
  const name = String(addon?.name || "").toLowerCase();
  const slug = String(addon?.slug || "").toLowerCase();
  if (kind === "bridge") return name === "ha3d chatgpt audio bridge" || slug.endsWith("ha3d_chatgpt_audio_bridge");
  if (kind === "chromium") return name === "chromium" || slug.endsWith("_chromium") || slug === "chromium";
  return false;
}

async function findAddonInfo(panel, kind, startIfNeeded = true) {
  const hass = panel?._hass;
  if (!hass?.callWS) throw new Error("Home Assistant indisponível");
  const addons = await listAddons(hass);
  const addon = addons.find((item) => addonMatches(item, kind));
  if (!addon) throw new Error(kind === "bridge" ? "Instale HA3D ChatGPT Audio Bridge" : "Instale o add-on Chromium");

  let info = await supervisor(hass, `/addons/${addon.slug}/info`, "get");
  if (startIfNeeded && info?.state !== "started") {
    await supervisor(hass, `/addons/${addon.slug}/start`, "post");
    for (let i = 0; i < 12; i += 1) {
      await delay(500);
      info = await supervisor(hass, `/addons/${addon.slug}/info`, "get");
      if (info?.state === "started" && info?.ingress_url) break;
    }
  }
  return info;
}

function ingressWsUrl(ingressUrl) {
  const url = new URL(ingressUrl, window.location.origin);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
  return url.toString();
}

async function connectBridge(panel) {
  setStatus(panel, "Conectando bridge de áudio…", "idle");
  const info = await findAddonInfo(panel, "bridge", true);
  if (!info?.ingress_url) throw new Error("Bridge sem ingress");
  const ws = new WebSocket(ingressWsUrl(info.ingress_url));
  ws.binaryType = "arraybuffer";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      reject(new Error("timeout ao conectar no bridge"));
    }, 8000);
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "hello" && msg.ready) {
          clearTimeout(timer);
          resolve(ws);
        }
      } catch (_) {}
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("falha no WebSocket do bridge"));
    };
  });
}

function ensureBrowserUi(panel) {
  const r = panel?.shadowRoot;
  if (!r) return null;
  let overlay = r.querySelector("#ha3dGptBrowserOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "ha3dGptBrowserOverlay";
  overlay.innerHTML = `
    <iframe id="ha3dGptBrowserFrame" title="ChatGPT no Home Assistant" allow="autoplay; clipboard-read; clipboard-write"></iframe>
    <button id="ha3dGptBrowserClose" class="secondary" title="Voltar ao HA3D">×</button>`;
  (r.querySelector("#root") || r).appendChild(overlay);
  overlay.querySelector("#ha3dGptBrowserClose").onclick = () => overlay.classList.remove("open");
  return overlay;
}

async function ensureChromium(panel, show = false) {
  const info = await findAddonInfo(panel, "chromium", true);
  if (!info?.ingress_url) throw new Error("Chromium sem ingress");
  const overlay = ensureBrowserUi(panel);
  const frame = overlay.querySelector("#ha3dGptBrowserFrame");
  const full = new URL(info.ingress_url, window.location.origin).toString();
  if (frame.src !== full) frame.src = full;
  if (show) overlay.classList.add("open");
  return info;
}

async function prepareChromium(panel) {
  setStatus(panel, "Preparando Chromium…", "idle");
  const info = await findAddonInfo(panel, "chromium", true);
  const opts = { ...(info?.options || {}) };
  opts.CHROMIUM_APP_URL = "https://chatgpt.com/";
  opts.WEB_AUDIO = "1";
  const args = String(opts.CHROMIUM_CUSTOM_ARGS || "").trim();
  const autoplay = "--autoplay-policy=no-user-gesture-required";
  opts.CHROMIUM_CUSTOM_ARGS = args.includes(autoplay) ? args : `${args} ${autoplay}`.trim();
  await supervisor(panel._hass, `/addons/${info.slug}/options`, "post", { options: opts });
  await supervisor(panel._hass, `/addons/${info.slug}/restart`, "post");
  await delay(2500);
  setStatus(panel, "Chromium preparado · faça login uma vez", "ready");
  await ensureChromium(panel, true);
}

function resampleInt16(input, fromRate, toRate = TARGET_RATE) {
  if (!input?.length || fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const a = Math.floor(pos);
    const b = Math.min(input.length - 1, a + 1);
    const f = pos - a;
    out[i] = Math.round(input[a] * (1 - f) + input[b] * f);
  }
  return out;
}

class Ha3DChatGPTBrowser {
  constructor(panel) {
    this.panel = panel;
    this.hass = panel?._hass || null;
    this.stream = null;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.sink = null;
    this.mode = "idle";
    this.handlerId = null;
    this.wakeBuffer = [];
    this.unsubscribe = null;
    this.unsubscribePromise = null;
    this.bridge = null;
    this.startingWake = false;
    this.sessionTimer = null;
  }

  update(panel, hass) {
    this.panel = panel || this.panel;
    this.hass = hass || this.hass;
  }

  async ensureMic() {
    if (this.stream?.active && this.context && this.processor) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microfone indisponível neste navegador");
    if (!window.isSecureContext) throw new Error("Microfone requer HTTPS");

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("AudioContext indisponível");
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
  }

  onAudio(event) {
    if (this.mode !== "wake" && this.mode !== "chatgpt") return;
    const samples = event.inputBuffer.getChannelData(0);
    const chunk = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      chunk[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    if (this.mode === "wake") {
      if (this.handlerId == null) {
        this.wakeBuffer.push(chunk);
        if (this.wakeBuffer.length > 30) this.wakeBuffer.shift();
      } else {
        this.sendWakeChunk(chunk);
      }
      return;
    }

    if (this.mode === "chatgpt" && this.bridge?.readyState === WebSocket.OPEN) {
      const out = resampleInt16(chunk, this.context.sampleRate, TARGET_RATE);
      try { this.bridge.send(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)); } catch (_) {}
    }
  }

  sendWakeChunk(chunk) {
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

  async startWake() {
    if (!readCfg().wakeEnabled || this.startingWake || this.mode === "chatgpt") return;
    if (!this.hass?.connection?.subscribeMessage) return;
    this.startingWake = true;
    try {
      await this.ensureMic();
      await this.stopPipeline(false);
      this.mode = "wake";
      this.handlerId = null;
      this.wakeBuffer = [];
      setStatus(this.panel, "Conectando wake word do HA…", "idle");
      const options = {
        type: "assist_pipeline/run",
        start_stage: "wake_word",
        end_stage: "stt",
        input: { sample_rate: this.context.sampleRate, timeout: 300, audio_seconds_to_buffer: 1.5 },
      };
      this.unsubscribePromise = this.hass.connection.subscribeMessage((event) => this.onPipelineEvent(event), options);
      this.unsubscribePromise.then((unsub) => { this.unsubscribe = unsub; }).catch((error) => this.failWake(error));
    } catch (error) {
      const msg = error?.name === "NotAllowedError" ? "Permita o microfone para ativar o wake word" : String(error?.message || error);
      setStatus(this.panel, msg, "error");
      this.mode = "idle";
    } finally {
      this.startingWake = false;
    }
  }

  onPipelineEvent(event) {
    if (this.mode !== "wake") return;
    if (event.type === "run-start") {
      this.handlerId = event.data?.runner_data?.stt_binary_handler_id ?? null;
      if (this.handlerId != null) {
        for (const chunk of this.wakeBuffer) this.sendWakeChunk(chunk);
        this.wakeBuffer = [];
      }
      setStatus(this.panel, "Wake pronto · microfone permanece no HA3D", "ready");
      return;
    }
    if (event.type === "wake_word-start") {
      setStatus(this.panel, "Ouvindo wake word…", "ready");
      return;
    }
    if (event.type === "wake_word-end") {
      setStatus(this.panel, "Wake detectado · conectando ChatGPT no HA…", "wake");
      this.beginChatGPT().catch((error) => this.failChatGPT(error));
      return;
    }
    if (event.type === "error") {
      this.failWake(new Error(event.data?.message || event.data?.code || "pipeline indisponível"));
      return;
    }
    if (event.type === "run-end") {
      setTimeout(() => {
        if (this.mode === "wake") this.startWake();
      }, NATIVE_RESTART_MS);
    }
  }

  async stopPipeline(sendEnd = true) {
    if (sendEnd && this.handlerId != null) this.sendWakeChunk(new Int16Array());
    try {
      if (this.unsubscribe) await this.unsubscribe();
      else if (this.unsubscribePromise) {
        const unsub = await Promise.race([
          this.unsubscribePromise.catch(() => null),
          delay(250).then(() => null),
        ]);
        if (unsub) await unsub();
      }
    } catch (_) {}
    this.unsubscribe = null;
    this.unsubscribePromise = null;
    this.handlerId = null;
    this.wakeBuffer = [];
  }

  failWake(error) {
    if (this.mode !== "wake") return;
    setStatus(this.panel, `Wake indisponível · ${error?.message || error}`, "error");
    this.stopPipeline(false).finally(() => {
      this.mode = "idle";
      setTimeout(() => this.startWake(), 5000);
    });
  }

  async beginChatGPT() {
    if (this.mode === "chatgpt") return;
    await this.ensureMic();
    await this.stopPipeline(true);
    this.mode = "idle";

    const ws = await connectBridge(this.panel);
    this.bridge = ws;
    ws.onclose = () => {
      if (this.mode === "chatgpt") this.failChatGPT(new Error("bridge desconectou"));
    };
    ws.send(JSON.stringify({ type: "start", sample_rate: TARGET_RATE, channels: 1, format: "s16le" }));
    this.mode = "chatgpt";
    setStatus(this.panel, "ChatGPT no HA · enviando microfone", "wake");

    ensureChromium(this.panel, false).catch((error) => {
      setStatus(this.panel, `Áudio conectado · ${error.message}`, "error");
    });

    clearTimeout(this.sessionTimer);
    const seconds = readCfg().sessionSeconds;
    if (seconds > 0) this.sessionTimer = setTimeout(() => this.stopChatGPT(true), seconds * 1000);
  }

  failChatGPT(error) {
    setStatus(this.panel, `ChatGPT no HA indisponível · ${error?.message || error}`, "error");
    this.stopChatGPT(false).finally(() => setTimeout(() => this.startWake(), 1800));
  }

  async stopChatGPT(rearm = true) {
    clearTimeout(this.sessionTimer);
    this.sessionTimer = null;
    const ws = this.bridge;
    this.bridge = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" }));
        ws.close();
      } catch (_) {}
    }
    if (this.mode === "chatgpt") this.mode = "idle";
    if (rearm && readCfg().wakeEnabled) {
      setStatus(this.panel, "Conversa encerrada · rearmando wake…", "idle");
      await delay(350);
      await this.startWake();
    }
  }

  async manualToggle() {
    if (this.mode === "chatgpt") return this.stopChatGPT(true);
    return this.beginChatGPT();
  }

  async shutdown() {
    clearTimeout(this.sessionTimer);
    await this.stopPipeline(true);
    await this.stopChatGPT(false);
    this.mode = "idle";
    if (this.processor) this.processor.onaudioprocess = null;
    try { this.source?.disconnect(); } catch (_) {}
    try { this.processor?.disconnect(); } catch (_) {}
    try { this.sink?.disconnect(); } catch (_) {}
    try { this.stream?.getTracks()?.forEach((track) => track.stop()); } catch (_) {}
    try { await this.context?.close(); } catch (_) {}
    this.stream = null;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.sink = null;
  }
}

async function testBridge(panel) {
  try {
    const ws = await connectBridge(panel);
    ws.send(JSON.stringify({ type: "start", sample_rate: TARGET_RATE, channels: 1, format: "s16le" }));
    await delay(200);
    ws.send(JSON.stringify({ type: "stop" }));
    ws.close();
    setStatus(panel, "Bridge de áudio OK", "ready");
  } catch (error) {
    setStatus(panel, `Bridge: ${error.message}`, "error");
  }
}

function saveForm(panel) {
  const r = panel.shadowRoot;
  const cfg = {
    wakeEnabled: r.querySelector("#ha3dGptWakeEnabled").checked,
    sessionSeconds: Math.max(0, Number(r.querySelector("#ha3dGptSessionSeconds").value || DEFAULT_SESSION_SECONDS)),
  };
  writeCfg(cfg);
  if (!cfg.wakeEnabled && runtime?.mode === "wake") runtime.stopPipeline(true).then(() => { runtime.mode = "idle"; });
  if (cfg.wakeEnabled && runtime?.mode === "idle") runtime.startWake();
  setStatus(panel, "Configuração salva", "ready");
}

function syncForm(panel) {
  const c = readCfg();
  const r = panel.shadowRoot;
  r.querySelector("#ha3dGptWakeEnabled").checked = c.wakeEnabled;
  r.querySelector("#ha3dGptSessionSeconds").value = c.sessionSeconds;
}

function installUi(panel) {
  const r = panel?.shadowRoot;
  if (!r || r.querySelector("#ha3dGptDock")) return;

  const style = document.createElement("style");
  style.textContent = `
    #ha3dGptDock{position:absolute;left:max(14px,env(safe-area-inset-left));bottom:max(14px,env(safe-area-inset-bottom));z-index:115;display:flex;gap:7px;align-items:center;pointer-events:auto}
    #ha3dGptButton{width:50px;height:50px;padding:0;border-radius:50%;font-size:22px;background:#15171de8;border:1px solid #ffffff2d}#ha3dGptButton[data-state=wake]{animation:gptPulse .7s infinite alternate}#ha3dGptButton[data-state=error]{box-shadow:0 0 0 2px #ff665577}
    #ha3dGptMeta{display:flex;align-items:center;gap:5px;padding:5px 6px 5px 10px;border-radius:12px;background:#15171de8;border:1px solid #ffffff1f;backdrop-filter:blur(14px)}#ha3dGptStatus{font-size:11px;max-width:48vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#ha3dGptBrowser,#ha3dGptSettings{width:32px;height:32px;padding:0;background:#ffffff12}
    #ha3dGptPanel{display:none;position:absolute;left:0;bottom:62px;width:min(360px,calc(100vw - 28px));padding:12px;border-radius:15px;background:#11141af5;border:1px solid #ffffff26;box-shadow:0 12px 35px #0008}#ha3dGptPanel.open{display:block}#ha3dGptPanel h3{margin:0 0 8px;font-size:14px}.gptRow{display:grid;gap:4px;margin:8px 0}.gptCheck{display:flex;gap:7px;align-items:center;font-size:11px;margin:7px 0}.gptHint{font-size:10px;opacity:.7}.gptRow input{width:100%;min-height:35px;padding:7px;border-radius:8px;border:1px solid #ffffff26;background:#0d0f14;color:#fff}.gptActions{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}.gptActions button{flex:1;min-width:100px;padding:8px;font-size:11px}
    #ha3dGptBrowserOverlay{position:absolute;inset:0;z-index:114;background:#050608;opacity:0;pointer-events:none;transition:opacity .18s ease}#ha3dGptBrowserOverlay.open{opacity:1;pointer-events:auto}#ha3dGptBrowserFrame{position:absolute;width:1px;height:1px;left:0;bottom:0;border:0;opacity:.01}#ha3dGptBrowserOverlay.open #ha3dGptBrowserFrame{inset:0;width:100%;height:100%;opacity:1}#ha3dGptBrowserClose{position:absolute;right:max(12px,env(safe-area-inset-right));top:max(12px,env(safe-area-inset-top));z-index:2;width:42px;height:42px;border-radius:50%;font-size:25px;background:#111c}
    @keyframes gptPulse{to{transform:scale(1.08);box-shadow:0 0 0 7px #4fd59a22}}
  `;
  r.appendChild(style);

  const dock = document.createElement("div");
  dock.id = "ha3dGptDock";
  dock.innerHTML = `
    <button id="ha3dGptButton" class="secondary" data-state="idle" title="Iniciar/parar conversa">◉</button>
    <div id="ha3dGptMeta"><span id="ha3dGptStatus">Inicializando ChatGPT no HA…</span><button id="ha3dGptBrowser" class="secondary" title="Abrir Chromium no HA">▣</button><button id="ha3dGptSettings" class="secondary" title="Configurar">⚙</button></div>
    <div id="ha3dGptPanel">
      <h3>ChatGPT no Home Assistant · experimental</h3>
      <label class="gptCheck"><input id="ha3dGptWakeEnabled" type="checkbox"> Ouvir wake word pelo Home Assistant</label>
      <div class="gptRow"><label class="gptHint">Tempo máximo da conversa (segundos, 0 = manual)</label><input id="ha3dGptSessionSeconds" type="number" min="0" step="10"></div>
      <div class="gptHint">O microfone fica no HA3D. Após o wake, o mesmo stream é enviado ao microfone virtual do Chromium que roda chatgpt.com dentro do HA. Nenhum Atalho ou app ChatGPT é aberto no iPad.</div>
      <div class="gptActions"><button id="ha3dGptWakeStart">Ativar wake</button><button id="ha3dGptOpenBrowser">Abrir ChatGPT no HA</button><button id="ha3dGptPrepareBrowser">Preparar Chromium</button><button id="ha3dGptTestBridge">Testar bridge</button><button id="ha3dGptStop">Parar / rearmar</button><button id="ha3dGptSave">Salvar</button><button id="ha3dGptClose" class="secondary">Fechar</button></div>
    </div>`;
  (r.querySelector("#root") || r).appendChild(dock);

  const panelEl = dock.querySelector("#ha3dGptPanel");
  dock.querySelector("#ha3dGptButton").onclick = () => runtime?.manualToggle();
  dock.querySelector("#ha3dGptBrowser").onclick = () => ensureChromium(panel, true).catch((e) => setStatus(panel, e.message, "error"));
  dock.querySelector("#ha3dGptSettings").onclick = () => { syncForm(panel); panelEl.classList.toggle("open"); };
  dock.querySelector("#ha3dGptWakeStart").onclick = () => { saveForm(panel); runtime?.startWake(); };
  dock.querySelector("#ha3dGptOpenBrowser").onclick = () => ensureChromium(panel, true).catch((e) => setStatus(panel, e.message, "error"));
  dock.querySelector("#ha3dGptPrepareBrowser").onclick = () => prepareChromium(panel).catch((e) => setStatus(panel, e.message, "error"));
  dock.querySelector("#ha3dGptTestBridge").onclick = () => testBridge(panel);
  dock.querySelector("#ha3dGptStop").onclick = () => runtime?.stopChatGPT(true);
  dock.querySelector("#ha3dGptSave").onclick = () => saveForm(panel);
  dock.querySelector("#ha3dGptClose").onclick = () => panelEl.classList.remove("open");
  syncForm(panel);
}

function attach(panel, hass = panel?._hass) {
  activePanel = panel;
  installUi(panel);
  if (!runtime) runtime = new Ha3DChatGPTBrowser(panel);
  runtime.update(panel, hass);
  if (readCfg().wakeEnabled && runtime.mode === "idle") runtime.startWake();
}

if (!proto.__ha3dGptBrowserPatch) {
  proto.__ha3dGptBrowserPatch = true;
  const connected = proto.connectedCallback;
  proto.connectedCallback = function () {
    connected.call(this);
    queueMicrotask(() => attach(this, this._hass));
  };

  const disconnected = proto.disconnectedCallback;
  proto.disconnectedCallback = function () {
    if (activePanel === this) activePanel = null;
    runtime?.shutdown();
    runtime = null;
    return disconnected?.call(this);
  };

  const hassDescriptor = Object.getOwnPropertyDescriptor(proto, "hass");
  if (hassDescriptor?.set) Object.defineProperty(proto, "hass", {
    configurable: true,
    enumerable: hassDescriptor.enumerable,
    get: hassDescriptor.get,
    set(value) {
      hassDescriptor.set.call(this, value);
      queueMicrotask(() => attach(this, value));
    },
  });
}
