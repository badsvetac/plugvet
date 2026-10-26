// Audit rules: one folder per rule under rules/, holding rule.yaml plus the fixtures that prove it
// (malicious/ it must flag, benign/ it must not). A rule reads units from the inventory, narrowed
// by what they are (targets) and where they come from (where), and matches regular expressions.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
const UNIT_TYPES = ['hook-command', 'hook-url', 'monitor-command', 'server-command', 'server-url', 'run-script', 'script', 'instructions', 'grant'];
const KINDS = ['pattern', 'structure', 'prose'];
export const RULES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'rules');

/** Loads and checks every rule. A malformed rule is an error, never skipped quietly. */
export async function loadRules(dir = RULES_DIR) {
  const ids = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const rules = [];
  for (const id of ids) {
    const file = path.join(dir, id, 'rule.yaml');
    const raw = parse(await fs.readFile(file, 'utf8'));
    rules.push(compile(raw, id, file));
  }
  return rules;
}

export function compile(raw, id, file = id) {
  const fail = (msg) => { throw new Error(`${file}: ${msg}`); };
  if (!raw || typeof raw !== 'object') fail('empty rule');
  if (raw.id !== id) fail(`id must be "${id}", the folder name`);
  if (!/^pv-[a-z0-9-]+$/.test(raw.id)) fail('id must look like pv-some-name');
  if (!raw.title) fail('title is required');
  if (!SEVERITIES.includes(raw.severity)) fail(`severity must be one of ${SEVERITIES.join(', ')}`);
  if (!KINDS.includes(raw.kind)) fail(`kind must be one of ${KINDS.join(', ')}`);
  if (!raw.why) fail('why is required: say what an attacker gets');
  const targets = [].concat(raw.targets || []);
  if (!targets.length) fail('targets is required');
  for (const t of targets) if (!UNIT_TYPES.includes(t)) fail(`unknown target "${t}"; use one of ${UNIT_TYPES.join(', ')}`);
  const flags = raw.flags ?? 'i';
  if (!/^[imsu]*$/.test(flags)) fail('flags may only use i, m, s and u');
  const re = (src) => {
    try { return new RegExp(src, flags.includes('g') ? flags : flags + 'g'); } catch (e) { return fail(`bad regex ${src}: ${e.message}`); }
  };
  const match = raw.match || {};
  const any = [].concat(match.any || []).map(re);
  const all = [].concat(match.all || []).map(re);
  const none = [].concat(match.none || []).map(re);
  if (!any.length && !all.length) fail('match needs "any" or "all"');
  const where = raw.where || {};
  return {
    id: raw.id, title: raw.title, severity: raw.severity, kind: raw.kind, why: String(raw.why).trim(),
    fix: raw.fix ? String(raw.fix).trim() : null, author: raw.author || null,
    targets, any, all, none,
    events: where.event ? [].concat(where.event) : null,
  };
}

/** Runs every rule over every unit it targets. */
export function runRules(rules, units) {
  const findings = [];
  const seen = new Set();
  for (const rule of rules) {
    for (const unit of units) {
      if (!rule.targets.includes(unit.type)) continue;
      if (rule.events && !rule.events.includes(unit.event)) continue;
      const hit = evaluate(rule, unit.text);
      if (!hit) continue;
      const line = lineOf(unit.text, hit.index);
      const key = `${rule.id}|${unit.file}|${line}|${unit.type === 'run-script' ? '' : unit.component || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        rule: rule.id, severity: rule.severity, title: rule.title, why: rule.why, fix: rule.fix, author: rule.author,
        file: unit.file, line: unit.type.endsWith('-command') || unit.type.endsWith('-url') || unit.type === 'grant' ? null : line,
        component: unit.component || null, excerpt: excerpt(unit.text, hit.index),
      });
    }
  }
  return findings;
}

// The whole text is searched: no window, no limit. "all" needs every pattern somewhere in the unit,
// "none" drops the unit if any exclusion matches. The finding points at the first "any" match, or
// the first "all" match when there is no "any".
function evaluate(rule, text) {
  for (const r of rule.none) { r.lastIndex = 0; if (r.test(text)) return null; }
  let first = null;
  for (const r of rule.all) {
    r.lastIndex = 0;
    const m = r.exec(text);
    if (!m) return null;
    first ??= m;
  }
  if (rule.any.length) {
    for (const r of rule.any) {
      r.lastIndex = 0;
      const m = r.exec(text);
      if (m) return m;
    }
    return null;
  }
  return first;
}

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// The line around a match, short, with invisible characters spelled out, so a person can see
// what a rule saw (a zero-width character shows as \u{200b}, not as nothing).
function excerpt(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  let end = text.indexOf('\n', index);
  if (end < 0) end = text.length;
  let s = text.slice(start, end).replace(/\r$/, '');
  const at = index - start;
  if (s.length > 160) { const from = Math.max(0, at - 60); s = (from ? '…' : '') + s.slice(from, from + 150) + '…'; }
  return s
    // Unicode tag characters are invisible copies of ASCII: decode them, so the reviewer reads
    // the hidden sentence itself rather than a row of code points.
    .replace(/[\u{e0020}-\u{e007e}]+/gu, (run) => `⟦hidden: "${[...run].map((c) => String.fromCharCode(c.codePointAt(0) - 0xe0000)).join('')}"⟧`)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{e0000}-\u{e007f}]/gu,
      (c) => `\\u{${c.codePointAt(0).toString(16)}}`).trim();
}
