import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const [, , commandName, maybePluginId] = process.argv;

if (!commandName) {
  console.error("Usage: node scripts/plugin-runner.mjs <command> [plugin-id]");
  process.exit(1);
}

const rootDir = process.cwd();
const pluginsDir = path.join(rootDir, "plugins");

async function getPluginDirs() {
  const entries = await readdir(pluginsDir, { withFileTypes: true });
  const discovered = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(pluginsDir, entry.name);
    const manifestPath = path.join(dir, "plugin.json");

    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (typeof manifest?.id !== "string" || !manifest.id.trim()) continue;
      discovered.push({ id: manifest.id.trim(), dir });
    } catch {
      continue;
    }
  }

  return discovered.sort((a, b) => a.id.localeCompare(b.id));
}

function runCommand(cwd, command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      stdio: "inherit",
      shell: true,
    });

    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed in ${cwd}: ${command}`));
    });

    child.on("error", reject);
  });
}

const commandMap = {
  install: "npm install",
  build: "npm run build",
};

async function main() {
  const command = commandMap[commandName];
  if (!command) {
    console.error(`Unsupported command: ${commandName}`);
    process.exit(1);
  }

  const plugins = await getPluginDirs();
  const selected = maybePluginId
    ? plugins.filter((plugin) => plugin.id === maybePluginId)
    : plugins;

  if (maybePluginId && selected.length === 0) {
    console.error(`Plugin '${maybePluginId}' not found in ${pluginsDir}`);
    process.exit(1);
  }

  for (const plugin of selected) {
    console.log(`[plugin:${plugin.id}] ${command}`);
    await runCommand(plugin.dir, command);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
