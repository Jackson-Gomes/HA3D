import { test, expect } from "@playwright/test";

for (const type of ["point", "tv"]) {
  test(`${type}: rendered wall blocks light, with an unoccluded positive control`, async ({ page }) => {
    await page.goto("/tests/fixture.html");
    await page.waitForFunction(() => window.ready);
    const pixels = await page.evaluate(type => {
      const scene = new THREE.Scene();
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);
      // Thin, single-sided exported wall: shadowSide must block both directions.
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), new THREE.MeshStandardMaterial());
      wall.rotation.y = -Math.PI / 2;
      wall.position.set(0, 3, 0);
      scene.add(wall);
      lighting.prepareOccluders(scene);
      let light = new THREE.PointLight(0xffffff, 30);
      light.position.set(-2, 2, 0);
      scene.add(light);
      light = lighting.prepareLight(light, type === "tv" ? { attributes: { device_class: "tv" } } : null,
        type === "tv" ? { direction: [1, -.5, 0], distance: 10 } : { distance: 10 });
      light.userData.ha3dDesiredIntensity = 30;
      lighting.applyShadowBudget([light], 12);
      const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, .1, 20);
      camera.position.set(0, 10, 0);
      camera.up.set(0, 0, -1);
      camera.lookAt(0, 0, 0);
      const renderer = new THREE.WebGLRenderer();
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setSize(256, 256);
      const target = new THREE.WebGLRenderTarget(256, 256);
      renderer.setRenderTarget(target);
      const read = x => {
        const pixel = new Uint8Array(4);
        renderer.readRenderTargetPixels(target, x, 128, 1, 1, pixel);
        return pixel[0];
      };
      renderer.render(scene, camera);
      const blocked = read(192); // floor at x=+2, behind wall
      wall.castShadow = false;
      light.shadow.needsUpdate = true;
      renderer.render(scene, camera);
      const open = read(192);
      const rear = read(16); // x=-3.5, behind the TV emission direction
      target.dispose(); renderer.dispose(); light.shadow.dispose();
      return { blocked, open, rear };
    }, type);
    expect(pixels.open).toBeGreaterThan(10);
    expect(pixels.blocked).toBeLessThan(pixels.open * .2);
    if (type === "tv") expect(pixels.rear).toBeLessThan(2);
  });
}
