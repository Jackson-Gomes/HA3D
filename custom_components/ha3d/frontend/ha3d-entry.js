// Stable HA3D entrypoint.
// The registered Home Assistant panel can keep this URL forever; every page
// load pulls the mutable frontend modules with a fresh cache-busting token.
const token = Date.now();

await import(`./ha3d-graphics.js?v=${token}`);
await import(`./ha3d-scene.js?v=${token}`);
