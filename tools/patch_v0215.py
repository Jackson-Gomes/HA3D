from pathlib import Path

INITIAL = {
    "visible": False,
    "x": 0.27715605,
    "z": -1.0158935,
    "y": 0.24,
    "scale": 0.05,
    "rotation": -89,
    "opacity": 0.8,
}

http = Path('custom_components/ha3d/http.py')
text = http.read_text(encoding='utf-8')
old = '''        "id", "name", "vacuum_entity", "position_entity", "object_name", "display",
        "floor_y", "floor_plane", "visible_states", "smoothing_ms", "stale_after_s",
        "remote_pulse_ms", "remote_settle_ms", "calibration",
'''
new = '''        "id", "name", "vacuum_entity", "position_entity", "map_entity", "map_overlay", "object_name", "display",
        "floor_y", "floor_plane", "visible_states", "smoothing_ms", "stale_after_s",
        "remote_pulse_ms", "remote_settle_ms", "calibration",
'''
if old not in text:
    raise SystemExit('robot allowed block not found')
text = text.replace(old, new, 1)
anchor = '''    if "object_name" in value and (not isinstance(value["object_name"], str) or len(value["object_name"]) > 255):
        return False
'''
addition = anchor + '''    if "map_entity" in value and not _is_entity_id(value["map_entity"]):
        return False
    if "map_overlay" in value:
        overlay = value["map_overlay"]
        if not isinstance(overlay, dict) or set(overlay) - {"visible", "x", "z", "y", "scale", "rotation", "opacity"}:
            return False
        if "visible" in overlay and not isinstance(overlay["visible"], bool):
            return False
        for key in ("x", "z", "y", "scale", "rotation", "opacity"):
            if key in overlay and not _is_number(overlay[key]):
                return False
'''
if anchor not in text:
    raise SystemExit('object_name validation anchor not found')
http.write_text(text.replace(anchor, addition, 1), encoding='utf-8')

tests = Path('tests/test_robot_schema.py')
text = tests.read_text(encoding='utf-8')
marker = '''    def test_invalid_plane(self):
        self.robot["floor_plane"] = "zz"
        self.assertFalse(valid(self.robot))
'''
extra = marker + '''
    def test_map_overlay_shared_config(self):
        self.robot["map_entity"] = "image.xiaomi_map"
        self.robot["map_overlay"] = {"visible": False, "x": 0.27715605, "z": -1.0158935, "y": 0.24, "scale": 0.05, "rotation": -89, "opacity": 0.8}
        self.assertTrue(valid(self.robot))

    def test_invalid_map_overlay_rejected(self):
        robot = deepcopy(self.robot)
        robot["map_overlay"] = {"visible": "no", "x": 0}
        self.assertFalse(valid(robot))
        robot = deepcopy(self.robot)
        robot["map_overlay"] = {"x": 0, "unexpected": 1}
        self.assertFalse(valid(robot))
'''
if marker not in text:
    raise SystemExit('test marker not found')
tests.write_text(text.replace(marker, extra, 1), encoding='utf-8')

shared = Path('custom_components/ha3d/frontend/ha3d-robot-map-shared-config.js')
shared.write_text(r'''/*
 * Shared Xiaomi map alignment for HA3D.
 * Mirrors the browser overlay transform into HA3D's Home Assistant-backed
 * robot config so every device opens with the same alignment.
 */
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const proto = Panel.prototype;

const STORAGE_KEY = "ha3d_xiaomi_map_overlay_v1";
const MAP_ENTITY = "image.xiaomi_robot_vacuum_h50_live_map";
const INITIAL = Object.freeze({ visible: false, x: 0.27715605, z: -1.0158935, y: 0.24, scale: 0.05, rotation: -89, opacity: 0.8 });
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function sanitize(value = {}) {
  return {
    visible: typeof value.visible === "boolean" ? value.visible : INITIAL.visible,
    x: num(value.x, INITIAL.x),
    z: num(value.z, INITIAL.z),
    y: num(value.y, INITIAL.y),
    scale: clamp(num(value.scale, INITIAL.scale), 0.0001, 10),
    rotation: num(value.rotation, INITIAL.rotation),
    opacity: clamp(num(value.opacity, INITIAL.opacity), 0, 1),
  };
}

function readLocal(robotId) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return all && typeof all === "object" && all[robotId] && typeof all[robotId] === "object" ? sanitize(all[robotId]) : null;
  } catch (_error) {
    return null;
  }
}

function writeLocal(robotId, value) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const all = parsed && typeof parsed === "object" ? parsed : {};
    all[robotId] = sanitize(value);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (_error) {
    // The shared Home Assistant config remains authoritative.
  }
}

function robotFor(panel, robotId) {
  return (panel._config?.robots || []).find((robot) => robot.id === robotId);
}

function effective(panel, robotId) {
  const robot = robotFor(panel, robotId);
  if (robot?.map_overlay && typeof robot.map_overlay === "object") return sanitize(robot.map_overlay);
  return readLocal(robotId) || { ...INITIAL };
}

const persistTimers = new WeakMap();
async function persist(panel, robotId, settings) {
  if (!panel?._saveConfigPatch || !panel._config?.robots) return;
  const robots = panel._config.robots.map((robot) => robot.id === robotId
    ? { ...robot, map_entity: robot.map_entity || MAP_ENTITY, map_overlay: sanitize(settings) }
    : robot);
  try {
    await panel._saveConfigPatch({ robots });
  } catch (error) {
    console.error("HA3D: unable to persist shared Xiaomi map alignment", error);
  }
}

function queuePersist(panel, robotId, settings, delay = 180) {
  const previous = persistTimers.get(panel);
  if (previous) clearTimeout(previous);
  persistTimers.set(panel, setTimeout(() => {
    persistTimers.delete(panel);
    persist(panel, robotId, settings);
  }, delay));
}

function syncSharedToLocal(panel, persistMissing = true) {
  for (const robot of panel?._config?.robots || []) {
    if (!robot?.id) continue;
    const hadShared = Boolean(robot.map_overlay && typeof robot.map_overlay === "object");
    const settings = effective(panel, robot.id);
    writeLocal(robot.id, settings);
    if (!hadShared && persistMissing) queuePersist(panel, robot.id, settings, 80);
  }
}

function wire(panel) {
  if (!panel?.shadowRoot) return;
  for (const robot of panel._config?.robots || []) {
    if (!robot?.id) continue;
    const row = panel.shadowRoot.querySelector(`[data-robot-id="${CSS.escape(robot.id)}"]`);
    const box = row?.querySelector("[data-map-overlay-box]");
    if (!box || box.dataset.sharedConfigBound === "1") continue;
    box.dataset.sharedConfigBound = "1";

    const saveAfterOverlay = () => setTimeout(() => {
      queuePersist(panel, robot.id, readLocal(robot.id) || effective(panel, robot.id));
    }, 0);

    box.querySelector("[data-map-visible]")?.addEventListener("change", saveAfterOverlay);
    box.querySelectorAll("[data-map-range], [data-map-value]").forEach((input) => input.addEventListener("change", saveAfterOverlay));
    box.querySelector("[data-map-reset]")?.addEventListener("click", saveAfterOverlay);
  }
}

if (!proto.__ha3dRobotMapSharedConfigV1) {
  proto.__ha3dRobotMapSharedConfigV1 = true;

  const originalRender = proto._renderRobotsPanel;
  proto._renderRobotsPanel = function (...args) {
    syncSharedToLocal(this);
    const result = originalRender?.apply(this, args);
    queueMicrotask(() => wire(this));
    return result;
  };

  const originalRebuild = proto._rebuildRobots;
  proto._rebuildRobots = function (...args) {
    syncSharedToLocal(this);
    const result = originalRebuild?.apply(this, args);
    queueMicrotask(() => wire(this));
    return result;
  };

  queueMicrotask(() => {
    const walk = (root) => {
      for (const element of root?.querySelectorAll?.("*") || []) {
        if (element.localName === "ha3d-panel") {
          syncSharedToLocal(element);
          wire(element);
        }
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    walk(document);
  });
}
''', encoding='utf-8')

entry = Path('custom_components/ha3d/frontend/ha3d-entry.js')
text = entry.read_text(encoding='utf-8')
anchor = 'import "./ha3d-robot-map-hotfix.js?v=robot-map-hotfix-1";'
if anchor not in text or 'ha3d-robot-map-shared-config.js' in text:
    raise SystemExit('entry import anchor missing or duplicate shared module')
entry.write_text(text.replace(anchor, anchor + '\nimport "./ha3d-robot-map-shared-config.js?v=robot-map-shared-config-1";', 1), encoding='utf-8')

manifest = Path('custom_components/ha3d/manifest.json')
text = manifest.read_text(encoding='utf-8')
if '"version": "0.2.14"' not in text:
    raise SystemExit('manifest 0.2.14 not found')
manifest.write_text(text.replace('"version": "0.2.14"', '"version": "0.2.15"', 1), encoding='utf-8')

init = Path('custom_components/ha3d/__init__.py')
text = init.read_text(encoding='utf-8')
if 'FRONTEND_VERSION = "0.2.14"' not in text:
    raise SystemExit('frontend 0.2.14 not found')
init.write_text(text.replace('FRONTEND_VERSION = "0.2.14"', 'FRONTEND_VERSION = "0.2.15"', 1), encoding='utf-8')
