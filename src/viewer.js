import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import {OrbitControls} from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js";
import {GLTFLoader} from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";
export class HA3DViewer{
constructor(container,options={}){
this.container=container;this.scene=new THREE.Scene();this.scene.background=new THREE.Color(options.background??0x101014);
this.camera=new THREE.PerspectiveCamera(55,1,.01,5000);this.camera.position.set(4,4,4);
this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=options.exposure??1;container.appendChild(this.renderer.domElement);
this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;
this.scene.add(new THREE.HemisphereLight(0xffffff,0x303040,2));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(5,10,5);this.scene.add(sun);
this.loader=new GLTFLoader();this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.model=null;
this.resize=()=>{const w=container.clientWidth,h=container.clientHeight;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false)};addEventListener("resize",this.resize);this.resize();this.renderer.setAnimationLoop(()=>{this.controls.update();this.renderer.render(this.scene,this.camera)});
}
async loadModel(url){const gltf=await this.loader.loadAsync(url);if(this.model)this.scene.remove(this.model);this.model=gltf.scene;this.scene.add(this.model);this.fit(this.model);return this.model}
fit(object){const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),max=Math.max(size.x,size.y,size.z)||1;this.controls.target.copy(center);this.camera.near=max/1000;this.camera.far=max*100;this.camera.position.copy(center).add(new THREE.Vector3(max*.9,max*.7,max*.9));this.camera.updateProjectionMatrix();this.controls.update()}
pick(clientX,clientY){const r=this.renderer.domElement.getBoundingClientRect();this.pointer.set(((clientX-r.left)/r.width)*2-1,-((clientY-r.top)/r.height)*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);return this.raycaster.intersectObject(this.model,true)[0]?.object??null}
}