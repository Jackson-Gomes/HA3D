import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const dir = "custom_components/ha3d/frontend";
const version = "20260919-3";
for (const file of readdirSync(dir).filter(f => f.endsWith(".js"))) {
  const result = spawnSync(process.execPath, ["--check", `${dir}/${file}`], { stdio: "inherit" });
  if (result.status !== 0) process.exit(1);
  const source = readFileSync(`${dir}/${file}`, "utf8");
  for (const match of source.matchAll(/from\s+["'](\.\/[^"']+)|import\s+["'](\.\/[^"']+)/g)) {
    if (!(match[1] || match[2]).endsWith(`?v=${version}`)) throw new Error(`Unversioned import in ${file}: ${match[0]}`);
  }
  if (/LEGACY_LIGHTS|light\.luz_da_|escritorio_tomada/.test(source)) throw new Error(`House-specific mapping in ${file}`);
}
console.log("All frontend modules: syntax, import versions, generic mappings OK");
