// Stable HA3D frontend entrypoint.
// Frontend-only changes can be picked up with Redownload + app/page reload;
// changing dependency query tokens does not require re-registering the HA panel.
import "./ha3d-graphics.js?v=frontend-2";
import "./ha3d-scene.js?v=frontend-2";
import "./ha3d-entity-markers.js?v=entity-markers-1";
