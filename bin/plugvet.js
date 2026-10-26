#!/usr/bin/env node
// plugvet: see what a Claude Code plugin or skill can do before you install it.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { audit, exitCode, worst } from '../src/audit.js';
import { diffAudits } from '../src/diff.js';
import { installedPlugins } from '../src/installed.js';
import { loadRules, SEVERITIES } from '../src/rules.js';
import { textReport, diffReport } from '../src/report.js';

const HELP = `plugvet: see what a Claude Code plugin or skill can do before you install it

  plugvet audit <folder>              the permission report and findings for one plugin or skill
  plugvet audit <name@marketplace>    the same for a plugin Claude Code has installed
  plugvet audit --installed           a one-line summary for every installed plugin
  plugvet diff <old folder> <new folder>   only what a new version changes
  plugvet rules                       list the audit rules

Options
  --json             machine-readable output
  --fail-on <level>  exit non-zero from this severity up (default: medium)
                     levels: ${SEVERITIES.join(', ')}
  --all              also show info findings
  --explain          say why each finding matters, how to fix it, and who wrote the rule

Exit codes: 0 nothing at or above --fail-on, 1 found something, 2 found something critical,
3 could not audit. plugvet only reads files: it never runs the plugin or touches the network.`;

let args;
try {
  args = parseArgs({ allowPositionals: true, options: {
    json: { type: 'boolean' }, 'fail-on': { type: 'string', default: 'medium' }, all: { type: 'boolean' },
    explain: { type: 'boolean' }, installed: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  } });
} catch (e) { fail(e.message); }
const { values: opt, positionals: [cmd, ...rest] } = args;

if (opt.version) { console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version); process.exit(0); }
if (opt.help || !cmd) { console.log(HELP); process.exit(cmd || opt.help ? 0 : 3); }
if (!SEVERITIES.includes(opt['fail-on'])) fail(`--fail-on must be one of ${SEVERITIES.join(', ')}`);
const minSeverity = opt.all ? 'info' : 'low';

try {
  const rules = await loadRules();
  if (cmd === 'audit') await runAudit(rules);
  else if (cmd === 'diff') await runDiff(rules);
  else if (cmd === 'rules') listRules(rules);
  else fail(`unknown command "${cmd}"\n\n${HELP}`);
} catch (e) { fail(e.message); }

async function runAudit(rules) {
  if (opt.installed) {
    const plugins = await installedPlugins();
    if (!plugins.length) fail('no installed plugins found');
    const results = [];
    for (const p of plugins) results.push({ plugin: p, result: await audit(p.dir, { rules, entry: p.entry }).catch((e) => ({ error: e.message })) });
    if (opt.json) { console.log(JSON.stringify(results.map(({ plugin, result }) => ({ id: plugin.id, dir: plugin.dir, ...result })), null, 2)); }
    else {
      for (const { plugin, result } of results) {
        if (result.error) { console.log(`${plugin.id.padEnd(48)} could not audit: ${result.error}`); continue; }
        const runs = result.components.filter((c) => c.reach === 'machine').length;
        const net = result.components.filter((c) => c.reach === 'network').length;
        const top = worst(result.findings.filter((f) => f.severity !== 'info'));
        console.log(`${plugin.id.padEnd(48)} ${String(runs).padStart(2)} run · ${String(net).padStart(2)} net · ${top ? `${top} (${result.findings.filter((f) => f.severity === top).length})` : 'clean'}`);
      }
    }
    const all = results.flatMap(({ result }) => result.findings || []);
    process.exit(exitCode(all, opt['fail-on']));
  }
  const [target] = rest;
  if (!target) fail('audit needs a folder, a name@marketplace, or --installed');
  let dir = target, entry;
  if (/^[\w.-]+@[\w.-]+$/.test(target)) {
    const p = (await installedPlugins()).find((x) => x.id === target);
    if (!p) fail(`${target} is not installed (plugvet audit --installed lists what is)`);
    dir = p.dir; entry = p.entry;
  }
  const result = await audit(dir, { rules, entry });
  console.log(opt.json ? JSON.stringify(result, null, 2) : textReport(result, { minSeverity, explain: opt.explain }));
  process.exit(exitCode(result.findings, opt['fail-on']));
}

async function runDiff(rules) {
  const [a, b] = rest;
  if (!a || !b) fail('diff needs two folders: the old version and the new one');
  const before = await audit(a, { rules });
  const after = await audit(b, { rules });
  const d = diffAudits(before, after);
  console.log(opt.json ? JSON.stringify(d, null, 2) : diffReport(after.name, d));
  process.exit(exitCode(d.newFindings, opt['fail-on']));
}

function listRules(rules) {
  if (opt.json) { console.log(JSON.stringify(rules.map(({ id, title, severity, kind, author }) => ({ id, title, severity, kind, author })), null, 2)); return; }
  for (const r of rules) console.log(`${r.severity.padEnd(9)}${r.id.padEnd(34)}${r.title}${r.author?.name ? `  (by ${r.author.name})` : ''}`);
}

function fail(message) { console.error(`plugvet: ${message}`); process.exit(3); }
