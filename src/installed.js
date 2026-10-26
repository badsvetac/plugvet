// Finds the plugins Claude Code has installed for this user, with the marketplace entry for each:
// an entry can stand in for a missing plugin.json, or add components to one, so the installed
// folder alone does not always tell the whole story.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function pluginsHome() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plugins');
}

/** @returns {Promise<{id: string, name: string, marketplace: string, version: string, dir: string, entry: object|null}[]>} */
export async function installedPlugins(home = pluginsHome()) {
  const index = await readJson(path.join(home, 'installed_plugins.json'));
  if (!index) return [];
  const markets = (await readJson(path.join(home, 'known_marketplaces.json'))) || {};
  const catalogs = new Map();
  const out = [];
  for (const [id, installs] of Object.entries(index.plugins || index)) {
    const [name, marketplace] = id.split('@');
    const install = [].concat(installs)[0];
    if (!install?.installPath) continue;
    if (!catalogs.has(marketplace)) {
      const loc = markets[marketplace]?.installLocation;
      catalogs.set(marketplace, loc ? await readJson(path.join(loc, '.claude-plugin', 'marketplace.json')) : null);
    }
    const entry = catalogs.get(marketplace)?.plugins?.find((p) => p.name === name) || null;
    out.push({ id, name, marketplace, version: install.version, dir: install.installPath, entry: entry && componentKeys(entry) });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Only an entry's component fields matter here; its source, version and display fields do not.
function componentKeys(entry) {
  const keys = ['commands', 'agents', 'skills', 'hooks', 'mcpServers', 'lspServers', 'outputStyles', 'settings', 'channels', 'userConfig', 'experimental', 'strict'];
  const picked = Object.fromEntries(Object.entries(entry).filter(([k]) => keys.includes(k)));
  return Object.keys(picked).some((k) => k !== 'strict') ? picked : null;
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}
