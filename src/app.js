import {HA3D_CONFIG} from "./config.js";import {HA3DViewer} from "./viewer.js";import {HomeAssistantAdapter} from "./home-assistant.js";
const app=document.querySelector("#app"),status=document.querySelector("#status");const ha=new HomeAssistantAdapter();const viewer=new HA3DViewer(app,HA3D_CONFIG.viewer);
viewer.renderer.domElement.addEventListener("click",e=>{const obj=viewer.pick(e.clientX,e.clientY);if(obj)status.textContent="Objeto: "+(obj.name||"(sem nome)")});
(async()=>{try{status.textContent="Carregando modelo…";await viewer.loadModel(HA3D_CONFIG.model);status.textContent="HA3D pronto"}catch(e){console.warn("[HA3D]",e);status.textContent="HA3D pronto — coloque models/home.glb"}})();
window.HA3D={viewer,ha,config:HA3D_CONFIG};