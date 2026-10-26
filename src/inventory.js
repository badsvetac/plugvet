// Builds the permission report: every component of a plugin or skill that can run code, reach the
// network, grant Claude tools, or put instructions in Claude's context. It follows Claude Code's
// own layout rules (code.claude.com/docs/en/plugins/manifest-reference): default folders, the
// manifest keys that replace, add to or merge with them, and inline definitions.
//
// Alongside the components it emits "units": the pieces of text audit rules read (a hook command,
// a script, a skill's instructions, one granted tool), each tagged with what it is and where it
// came from, so a rule can say "hook commands on SessionStart" rather than "any text anywhere".
import path from 'node:path';
import { frontmatter, toolList } from './frontmatter.js';

const CODE_EXT = /\.(sh|bash|zsh|fish|ps1|psm1|bat|cmd|py|js|mjs|cjs|ts|mts|cts|rb|pl|php|lua|go|rs)$/i;
// Paths a command refers to inside the plugin: "${CLAUDE_PLUGIN_ROOT}/x.sh", "$CLAUDE_PLUGIN_ROOT"/x.sh
const ROOT_REF = /\$\{?CLAUDE_PLUGIN_ROOT\}?"?[\\/]([^\s"'`;|&)<>]+)/g;
// Events that fire with no action from the user: a hook here runs on every session or every prompt.
export const UNPROMPTED_EVENTS = ['SessionStart', 'Setup', 'UserPromptSubmit', 'InstructionsLoaded', 'monitor'];

/**
 * @typedef {object} Component
 * @property {string} kind     hook | monitor | mod | mcp | mcp-bundle | lsp | bin | workflow | skill | command | agent | output-style | settings | channel | config
 * @property {string} name
 * @property {string} file     where it is declared
 * @property {'machine'|'network'|'context'|'grant'|'info'} reach
 * @property {string} summary  one line, for people
 *
 * @typedef {object} Unit
 * @property {string} type     hook-command | hook-url | monitor-command | server-command | server-url | run-script | script | instructions | grant
 * @property {string} text
 * @property {string} file
 * @property {number} [lineOffset]  added to line numbers found in text (inline text inside a file)
 * @property {string} [event]
 * @property {string} [component]
 */

export function inventory(target, { entry } = {}) {
  const { files } = target;
  /** @type {Component[]} */ const components = [];
  /** @type {Unit[]} */ const units = [];
  const notes = [];
  const note = (id, severity, file, message) => notes.push({ id, severity, file, message });

  // ── the manifest, and a marketplace entry that may stand in for it or add to it ──────────────
  const manifestRel = '.claude-plugin/plugin.json';
  let manifest = files.has(manifestRel) ? readJson(manifestRel) || {} : null;
  if (entry) manifest = mergeEntry(manifest, entry);
  manifest ||= {};

  // ── skills ───────────────────────────────────────────────────────────────────────────────────
  const skillDirs = new Set();
  const skillRoots = ['skills', ...paths(manifest.skills, 'skills')];
  for (const dir of skillRoots) {
    if (files.has(join(dir, 'SKILL.md'))) skillDirs.add(dir);
    for (const f of under(dir)) {
      const m = new RegExp(`^${esc(dir ? dir + '/' : '')}([^/]+)/SKILL\\.md$`).exec(f.rel);
      if (m) skillDirs.add(join(dir, m[1]));
    }
  }
  if (!under('skills').length && manifest.skills === undefined && files.has('SKILL.md')) skillDirs.add('');
  for (const dir of [...skillDirs].sort()) {
    const rel = join(dir, 'SKILL.md');
    const file = files.get(rel);
    if (!file?.text) continue;
    const fm = parsed(rel, file.text);
    const name = fm.data.name || (dir ? path.posix.basename(dir) : 'SKILL.md');
    const grants = toolList(fm.data['allowed-tools'] ?? fm.data.allowedTools);
    components.push({ kind: 'skill', name: String(name), file: rel, reach: 'context',
      summary: grants.length ? `instructions; grants ${grants.join(', ')}` : 'instructions' });
    grants.forEach((g) => units.push({ type: 'grant', text: g, file: rel, component: `skill ${name}` }));
    // Everything Markdown in the skill's folder can be loaded into context on demand.
    for (const f of under(dir)) if (/\.md$/i.test(f.rel) && f.text && (dir || f.rel === 'SKILL.md')) units.push({ type: 'instructions', text: f.text, file: f.rel, component: `skill ${name}` });
    if (fm.data.hooks && typeof fm.data.hooks === 'object') addHooksMap(fm.data.hooks, rel, `skill ${name}`);
  }

  // ── commands (the manifest replaces the default folder) ──────────────────────────────────────
  if (manifest.commands && typeof manifest.commands === 'object' && !Array.isArray(manifest.commands)) {
    for (const [name, def] of Object.entries(manifest.commands)) {
      const grants = toolList(def?.allowedTools);
      if (def?.source) markdownComponent('command', name, resolve(def.source)?.rel, grants);
      else if (typeof def?.content === 'string') {
        components.push({ kind: 'command', name, file: manifestRel, reach: 'context', summary: grants.length ? `inline instructions; grants ${grants.join(', ')}` : 'inline instructions' });
        units.push({ type: 'instructions', text: def.content, file: manifestRel, component: `command ${name}` });
        grants.forEach((g) => units.push({ type: 'grant', text: g, file: manifestRel, component: `command ${name}` }));
      }
    }
  } else {
    for (const p of manifest.commands !== undefined ? paths(manifest.commands) : ['commands']) {
      for (const f of under(p)) if (/\.md$/i.test(f.rel)) markdownComponent('command', commandName(p, f.rel), f.rel);
    }
  }

  // ── agents (the manifest replaces the default folder) ────────────────────────────────────────
  for (const p of manifest.agents !== undefined ? paths(manifest.agents) : ['agents']) {
    for (const f of under(p)) if (/\.md$/i.test(f.rel)) markdownComponent('agent', path.posix.basename(f.rel, '.md'), f.rel);
  }

  // ── output styles change how Claude writes every reply ───────────────────────────────────────
  for (const p of manifest.outputStyles !== undefined ? paths(manifest.outputStyles) : ['output-styles']) {
    for (const f of under(p)) if (/\.md$/i.test(f.rel)) markdownComponent('output-style', path.posix.basename(f.rel, '.md'), f.rel);
  }

  // ── hooks (default file and manifest merge) ──────────────────────────────────────────────────
  if (files.has('hooks/hooks.json')) addHooksFile('hooks/hooks.json');
  for (const v of list(manifest.hooks)) {
    if (typeof v === 'string') { const r = resolve(v); if (r?.rel && files.has(r.rel)) addHooksFile(r.rel); }
    else if (v && typeof v === 'object') addHooksMap(v, manifestRel, 'manifest');
  }

  // ── monitors ─────────────────────────────────────────────────────────────────────────────────
  const monitorsKey = manifest.experimental?.monitors ?? manifest.monitors;
  let monitorList = null, monitorsFile = 'monitors/monitors.json';
  if (Array.isArray(monitorsKey)) { monitorList = monitorsKey; monitorsFile = manifestRel; }
  else if (typeof monitorsKey === 'string') { monitorsFile = resolve(monitorsKey)?.rel; monitorList = monitorsFile && files.has(monitorsFile) ? readJson(monitorsFile) : null; }
  else if (files.has(monitorsFile)) monitorList = readJson(monitorsFile);
  for (const m of Array.isArray(monitorList) ? monitorList : []) {
    if (!m?.command) continue;
    const when = m.when && m.when !== 'always' ? ` (${m.when})` : ' (every session)';
    components.push({ kind: 'monitor', name: m.name || '?', file: monitorsFile, reach: 'machine', summary: `${m.command}${when}` });
    addCommand('monitor-command', m.command, monitorsFile, 'monitor', `monitor ${m.name}`);
  }

  // ── MCP servers: .mcp.json, then the manifest; later names replace earlier ones ──────────────
  if (files.has('.mcp.json')) addMcpFile('.mcp.json');
  for (const v of list(manifest.mcpServers)) {
    if (typeof v === 'string') {
      if (/\.(mcpb|dxt)$/i.test(v) || /^https?:/i.test(v)) {
        const remote = /^https?:/i.test(v);
        components.push({ kind: 'mcp-bundle', name: path.posix.basename(v), file: manifestRel, reach: 'machine',
          summary: remote ? `downloads and runs a packaged server from ${v}` : `runs a packaged server (${v}); its code is inside the bundle` });
        if (remote) units.push({ type: 'server-url', text: v, file: manifestRel, component: 'mcp bundle' });
      } else { const r = resolve(v); if (r?.rel && files.has(r.rel)) addMcpFile(r.rel); }
    } else if (v && typeof v === 'object') addServers('mcp', v, manifestRel);
  }

  // ── LSP servers ──────────────────────────────────────────────────────────────────────────────
  if (files.has('.lsp.json')) { const j = readJson('.lsp.json'); if (j) addServers('lsp', j, '.lsp.json'); }
  for (const v of list(manifest.lspServers)) {
    if (typeof v === 'string') { const r = resolve(v); if (r?.rel && files.has(r.rel)) { const j = readJson(r.rel); if (j) addServers('lsp', j, r.rel); } }
    else if (v && typeof v === 'object') addServers('lsp', v, manifestRel);
  }

  // ── bin/: on the PATH of every Bash command Claude runs ──────────────────────────────────────
  for (const f of under('bin')) {
    components.push({ kind: 'bin', name: f.rel.slice(4), file: f.rel, reach: 'machine',
      summary: f.link ? `link to ${f.link}` : f.binary ? `compiled program, ${kb(f.size)}` : `${plural(lines(f.text), 'line')}, ${scriptKind(f)}` });
  }

  // ── workflows: JavaScript that Claude Code runs to orchestrate subagents ─────────────────────
  for (const p of manifest.workflows !== undefined ? paths(manifest.workflows) : ['workflows']) {
    for (const f of under(p)) if (/\.js$/i.test(f.rel)) components.push({ kind: 'workflow', name: path.posix.basename(f.rel, '.js'), file: f.rel, reach: 'context', summary: `workflow script, ${plural(lines(f.text), 'line')}` });
  }

  // ── settings, channels, user configuration ───────────────────────────────────────────────────
  const settings = files.has('settings.json') ? readJson('settings.json') : manifest.settings;
  if (settings?.agent) components.push({ kind: 'settings', name: 'agent', file: files.has('settings.json') ? 'settings.json' : manifestRel, reach: 'context', summary: `the whole session runs as the plugin's agent "${settings.agent}"` });
  for (const c of list(manifest.channels)) if (c?.server) components.push({ kind: 'channel', name: c.server, file: manifestRel, reach: 'context', summary: `messages from outside (server "${c.server}") arrive in the session` });
  for (const [key, opt] of Object.entries(manifest.userConfig || {})) if (opt?.sensitive) components.push({ kind: 'config', name: key, file: manifestRel, reach: 'info', summary: `asks you for a secret: ${opt.title || key}` });

  // ── every code file is a script unit, whoever runs it ────────────────────────────────────────
  for (const f of files.values()) {
    if (!f.text) continue;
    if (CODE_EXT.test(f.rel) || f.text.startsWith('#!') || f.rel.startsWith('bin/')) units.push({ type: 'script', text: f.text, file: f.rel });
  }
  for (const f of files.values()) {
    if (f.link) note('pv-symlink', 'medium', f.rel, `symbolic link to ${f.link}; plugvet does not follow it, check where it points`);
  }
  for (const s of target.skipped) note('pv-not-read', 'info', s.rel, s.count != null ? `${s.reason}, ${s.count} files, not read` : `not read: ${s.reason}`);

  const isSkill = !files.has(manifestRel) && !entry && skillDirs.size === 1 && skillDirs.has('');
  const name = manifest.name || (isSkill ? components[0]?.name : null) || path.basename(target.root);
  return { kind: isSkill ? 'skill' : 'plugin', name, components, units, notes };

  // ── helpers ──────────────────────────────────────────────────────────────────────────────────

  function addHooksFile(rel) {
    const j = readJson(rel);
    if (!j) return;
    if (j.hooks && typeof j.hooks === 'object') addHooksMap(j.hooks, rel, 'hooks');
    else if (!j.modules) note('pv-hooks-shape', 'info', rel, 'no top-level "hooks" key: Claude Code fails to load this file');
    for (const m of list(j.modules)) {
      const p = typeof m === 'string' ? m : m?.path || m?.module || m?.file || JSON.stringify(m);
      components.push({ kind: 'mod', name: String(p), file: rel, reach: 'machine', summary: `JavaScript that runs inside Claude Code with your permissions (${p})` });
    }
  }

  function addHooksMap(map, file, origin) {
    for (const [event, groups] of Object.entries(map)) {
      for (const g of list(groups)) {
        for (const h of list(g?.hooks)) {
          const where = g.matcher ? `${event}(${g.matcher})` : event;
          const type = h?.type || 'command';
          if (type === 'command' && h.command) {
            const text = Array.isArray(h.args) ? [h.command, ...h.args].join(' ') : String(h.command);
            components.push({ kind: 'hook', name: where, file, reach: 'machine', summary: text + (h.async ? ' (in the background)' : '') });
            addCommand('hook-command', text, file, event, `hook ${where} (${origin})`);
          } else if (type === 'http' && h.url) {
            components.push({ kind: 'hook', name: where, file, reach: 'network', summary: `sends the event to ${h.url}` });
            units.push({ type: 'hook-url', text: String(h.url), file, event, component: `hook ${where}` });
          } else if (type === 'mcp_tool') {
            components.push({ kind: 'hook', name: where, file, reach: 'machine', summary: `calls ${h.server} → ${h.tool}` });
          } else if ((type === 'prompt' || type === 'agent') && h.prompt) {
            components.push({ kind: 'hook', name: where, file, reach: 'context', summary: `${type === 'agent' ? 'starts a subagent' : 'asks a model'} with a prompt` });
            units.push({ type: 'instructions', text: String(h.prompt), file, event, component: `hook ${where}` });
          }
        }
      }
    }
  }

  // A command line, plus the plugin's own scripts it runs: a SessionStart hook "bash setup.sh" is
  // only as safe as setup.sh, so the script is read in the hook's context too.
  function addCommand(type, text, file, event, component) {
    units.push({ type, text, file, event, component });
    for (const m of text.matchAll(ROOT_REF)) {
      const rel = path.posix.normalize(m[1].replace(/\\/g, '/'));
      const f = files.get(rel);
      if (f?.text) units.push({ type: 'run-script', text: f.text, file: rel, event, component });
    }
  }

  function addMcpFile(rel) {
    const j = readJson(rel);
    if (!j) return;
    addServers('mcp', j.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : j, rel);
  }

  function addServers(kind, map, file) {
    for (const [name, cfg] of Object.entries(map)) {
      if (!cfg || typeof cfg !== 'object') continue;
      if (cfg.command) {
        const text = [cfg.command, ...(Array.isArray(cfg.args) ? cfg.args : [])].join(' ');
        components.push({ kind, name, file, reach: 'machine', summary: text });
        addCommand('server-command', text, file, kind, `${kind} ${name}`);
      } else if (cfg.url) {
        components.push({ kind, name, file, reach: 'network', summary: `${cfg.type || 'remote'} server at ${cfg.url}` });
        units.push({ type: 'server-url', text: String(cfg.url), file, component: `${kind} ${name}` });
      }
      if (cfg.headersHelper) {
        components.push({ kind, name: `${name} headers`, file, reach: 'machine', summary: `runs ${cfg.headersHelper} to make request headers` });
        addCommand('server-command', String(cfg.headersHelper), file, kind, `${kind} ${name}`);
      }
    }
  }

  function markdownComponent(kind, name, rel, extraGrants = []) {
    const file = rel && files.get(rel);
    if (!file?.text) return;
    const fm = parsed(rel, file.text);
    const grants = [...toolList(fm.data['allowed-tools'] ?? fm.data.allowedTools), ...extraGrants];
    const agentTools = kind === 'agent' ? toolList(fm.data.tools) : [];
    const shown = String(fm.data.name || name);
    let summary = 'instructions';
    if (grants.length) summary += `; grants ${grants.join(', ')}`;
    if (kind === 'agent') summary += agentTools.length ? `; tools ${agentTools.join(', ')}` : '; every tool the session has';
    components.push({ kind, name: shown, file: rel, reach: 'context', summary });
    units.push({ type: 'instructions', text: file.text, file: rel, component: `${kind} ${shown}` });
    grants.forEach((g) => units.push({ type: 'grant', text: g, file: rel, component: `${kind} ${shown}` }));
  }

  function parsed(rel, text) {
    const fm = frontmatter(text);
    if (fm.error) note('pv-frontmatter', 'info', rel, `frontmatter does not parse (${fm.error}); Claude Code loads the file with every field ignored`);
    return fm;
  }

  function readJson(rel) {
    const f = files.get(rel);
    if (!f?.text) return null;
    try { return JSON.parse(f.text); } catch (e) { note('pv-json', 'info', rel, `not valid JSON (${e.message}); Claude Code will not load it`); return null; }
  }

  // A manifest path: relative to the root, "./"-prefixed by convention. One that leaves the
  // plugin is reported: Claude Code refuses it, and it is a classic traversal attempt.
  function resolve(p) {
    if (typeof p !== 'string') return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return { url: p };
    const s = p.replace(/\\/g, '/');
    if (s === '.' || s === './') return { rel: '' };
    const n = path.posix.normalize(s.replace(/^\.\//, '')).replace(/\/$/, '');
    if (s.startsWith('/') || /^[a-z]:/i.test(s) || n === '..' || n.startsWith('../')) {
      note('pv-path-escape', 'high', manifestRel, `path "${p}" points outside the plugin`);
      return null;
    }
    return { rel: n === '.' ? '' : n };
  }

  function paths(value) { return list(value).map(resolve).filter((r) => r && r.rel !== undefined).map((r) => r.rel); }
  function under(dir) { return [...files.values()].filter((f) => !dir || f.rel === dir || f.rel.startsWith(dir + '/')); }
}

function mergeEntry(manifest, entry) {
  const KEYS = ['commands', 'agents', 'skills', 'hooks', 'mcpServers', 'lspServers', 'outputStyles', 'settings', 'channels', 'userConfig'];
  if (!manifest) return Object.fromEntries(Object.entries(entry).filter(([k]) => KEYS.includes(k) || k === 'name' || k === 'experimental'));
  if (entry.strict === false) return manifest;
  const out = { ...manifest };
  for (const k of ['commands', 'agents', 'skills', 'hooks', 'mcpServers', 'lspServers']) {
    if (entry[k] === undefined) continue;
    out[k] = manifest[k] === undefined ? entry[k] : [...list(manifest[k]), ...list(entry[k])];
  }
  return out;
}

function commandName(dir, rel) { return rel.slice(dir ? dir.length + 1 : 0).replace(/\.md$/i, '').replace(/\//g, ':'); }
function list(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }
function join(a, b) { return a ? `${a}/${b}` : b; }
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function lines(text) { return text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0; }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
function kb(n) { return n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`; }
function scriptKind(f) {
  const shebang = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(f.text || '');
  if (shebang) return path.posix.basename(shebang[1] === '/usr/bin/env' && shebang[2] ? shebang[2] : shebang[1]) + ' script';
  return 'text';
}
