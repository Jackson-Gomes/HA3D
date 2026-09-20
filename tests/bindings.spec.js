import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixture.html");
  await page.waitForFunction(() => window.ready);
});
async function load(page, states = {}) {
  await page.evaluate(states => window.makePanel(states), states);
  await expect(page.locator("ha3d-panel")).toHaveAttribute("data-ha3d-version", "20260919-3");
}
const state = (value, attributes = {}) => ({ state: value, attributes });

test("real GLB exact names, delayed states, paired and duplicate LightNodes", async ({ page }) => {
  await load(page);
  expect(await page.evaluate(() => panel._pendingBindings.size)).toBe(7);
  expect(await page.evaluate(() => panel._modelLights.every(l => l.intensity === 0))).toBe(true);
  await page.evaluate(() => { panel.hass = { ...panel.hass, states: { "light.fixture": { state: "on", attributes: {} } } }; });
  expect(await page.evaluate(() => ({ count: panel._lightBindings.size, lights: panel._lightBindings.get("light.fixture").lights.length, active: panel._lightBindings.get("light.fixture").lights.every(l => l.intensity > 0), anchor: panel._lightBindings.get("light.fixture").anchor.userData.ha3dNodeName }))).toEqual({ count: 1, lights: 2, active: true, anchor: "light.fixture" });
  await expect(page.locator(".lightMarker")).toHaveCount(1);
});

test("off, on, zero brightness, unknown, unavailable and removal are synchronized", async ({ page }) => {
  await load(page, { "light.fixture": state("off") });
  for (const [value, brightness, active] of [["on", 255, true], ["on", 0, false], ["off", 255, false], ["unavailable", 255, false], ["unknown", 255, false], ["on", 128, true], [null, 255, false]]) {
    const result = await page.evaluate(({ value, brightness }) => {
      panel.hass = { ...panel.hass, states: value ? { "light.fixture": { state: value, attributes: { brightness } } } : {} };
      const binding = panel._lightBindings.get("light.fixture");
      return { active: binding.lights.every(l => l.intensity > 0), unavailable: binding.marker.classList.contains("unavailable") };
    }, { value, brightness });
    expect(result.active).toBe(active);
    expect(result.unavailable).toBe(["unknown", "unavailable", null].includes(value));
  }
});

test("all domains have one circular symbol-only marker and a native more-info event", async ({ page }) => {
  await load(page, {
    "light.fixture": state("off"), "media_player.fixture": state("off", { device_class: "tv" }),
    "switch.fixture": state("on", { icon: "mdi:printer-3d-nozzle" }), "vacuum.fixture": state("cleaning"),
    "climate.fixture": state("cool"), "binary_sensor.fixture": state("on", { device_class: "window" }), "sensor.fixture": state("17"),
  });
  await expect(page.locator(".lightMarker")).toHaveCount(7);
  expect(await page.evaluate(() => [...panel._lightBindings.values()].map(b => [b.icon.getAttribute("icon"), b.marker.textContent, getComputedStyle(b.marker).width]))).toEqual([
    ["mdi:lightbulb", "", "34px"], ["mdi:television", "", "34px"], ["mdi:printer-3d-nozzle", "", "34px"], ["mdi:robot-vacuum", "", "34px"], ["mdi:air-conditioner", "", "34px"], ["mdi:window-closed", "", "34px"], ["mdi:gauge", "", "34px"],
  ]);
  expect(await page.evaluate(() => {
    const received = [];
    document.addEventListener("hass-more-info", e => received.push(e.detail.entityId));
    panel._lightBindings.get("media_player.fixture").marker.click();
    return received;
  })).toEqual(["media_player.fixture"]);
});

test("TV is directional, follows state and fails closed for assumed_state with configurable source", async ({ page }) => {
  await load(page, { "media_player.fixture": state("off", { device_class: "tv" }) });
  for (const [value, assumed, active] of [["off", false, false], ["playing", false, true], ["paused", false, true], ["unavailable", false, false], ["on", true, false]]) {
    expect(await page.evaluate(({ value, assumed }) => {
      panel.hass = { ...panel.hass, states: { "media_player.fixture": { state: value, attributes: { device_class: "tv", assumed_state: assumed } } } };
      const light = panel._lightBindings.get("media_player.fixture").light;
      return { spot: light.isSpotLight, active: light.intensity > 0, direction: light.target.position.toArray() };
    }, { value, assumed })).toEqual({ spot: true, active, direction: [0, 0, -1] });
  }
  expect(await page.evaluate(() => {
    panel._lightBindings.get("media_player.fixture").metadata.state_entity = "binary_sensor.power";
    panel.hass = { ...panel.hass, states: { ...panel.hass.states, "binary_sensor.power": { state: "on", attributes: {} } } };
    return panel._lightBindings.get("media_player.fixture").light.intensity > 0;
  })).toBe(true);
});

test("exact matching has no friendly-name guesses and icon precedence is metadata then domain", async ({ page }) => {
  expect(await page.evaluate(() => {
    const names = ["light.valid", "LightNode_media_player.valid", "TV sala", "light_valid", "LightNode_LightNode_light.valid"];
    return { names: names.map(rules.entityIdFromName), icon: rules.iconFor("media_player.console", { attributes: { icon: "mdi:microsoft-xbox", device_class: "tv" } }), generic: rules.iconFor("custom.device", {}) };
  })).toEqual({ names: ["light.valid", "media_player.valid", null, null, null], icon: "mdi:microsoft-xbox", generic: "mdi:help-circle-outline" });
});

test("shadow budget bounds physical lights without enabling unshadowed spill", async ({ page }) => {
  expect(await page.evaluate(() => {
    const lights = Array.from({ length: 20 }, () => {
      const light = new THREE.PointLight();
      light.userData.ha3dDesiredIntensity = 1;
      return lighting.prepareLight(light, null);
    });
    const deferred = lighting.applyShadowBudget(lights, 12);
    return { deferred, active: lights.filter(l => l.intensity > 0).length, safe: lights.every(l => l.intensity === 0 || l.castShadow) };
  })).toEqual({ deferred: 18, active: 2, safe: true });
});

test("late device_class converts TV once without duplicating markers or losing state", async ({ page }) => {
  await load(page, { "media_player.fixture": state("off") });
  expect(await page.evaluate(() => panel._lightBindings.get("media_player.fixture").light.isPointLight)).toBe(true);
  expect(await page.evaluate(() => {
    panel.hass = { ...panel.hass, states: { "media_player.fixture": { state: "playing", attributes: { device_class: "tv" } } } };
    const binding = panel._lightBindings.get("media_player.fixture");
    const first = binding.light;
    panel.hass = { ...panel.hass };
    return { spot: first.isSpotLight, same: first === binding.light, active: first.intensity > 0, lights: panel._modelLights.length };
  })).toEqual({ spot: true, same: true, active: true, lights: 3 });
  await expect(page.locator(".lightMarker")).toHaveCount(1);
});

test("switching GLB frees old geometry and preserves a single registry", async ({ page }) => {
  await load(page, { "light.fixture": state("on") });
  expect(await page.evaluate(async () => {
    let freed = 0;
    panel._model.traverse(o => o.geometry?.addEventListener("dispose", () => freed++));
    await panel._loadModel(panel._config.model_url);
    return { freed, bindings: panel._lightBindings.size, lights: panel._lightBindings.get("light.fixture").lights.length };
  })).toEqual({ freed: 7, bindings: 1, lights: 2 });
});

test("local source direction survives rotated parent transforms", async ({ page }) => {
  const actual = await page.evaluate(() => {
    const parent = new THREE.Group(); parent.rotation.y = Math.PI / 2;
    const source = new THREE.PointLight(); parent.add(source);
    const spot = lighting.prepareLight(source, { attributes: { device_class: "tv" } });
    parent.updateMatrixWorld(true);
    const direction = spot.target.getWorldPosition(new THREE.Vector3()).sub(spot.getWorldPosition(new THREE.Vector3())).normalize();
    return direction.toArray();
  });
  [-1, 0, 0].forEach((value, index) => expect(actual[index]).toBeCloseTo(value));
});
