import { loadTarget } from './load.js';
import { inventory } from './inventory.js';
import { loadRules, runRules, SEVERITIES } from './rules.js';

/**
 * Audits one plugin or skill folder: the permission report plus every rule's findings.
 * Reads files only. Nothing in the target is run, and nothing goes over the network.
 */
export async function audit(dir, { rules, entry } = {}) {
  const target = await loadTarget(dir);
  const inv = inventory(target, { entry });
  rules ??= await loadRules();
  const findings = [
    ...runRules(rules, inv.units),
    ...inv.notes.map((n) => ({ rule: n.id, severity: n.severity, title: n.message, file: n.file, line: null, builtIn: true })),
  ].sort((a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  return {
    root: target.root,
    kind: inv.kind,
    name: inv.name,
    files: target.files.size,
    bytes: [...target.files.values()].reduce((n, f) => n + f.size, 0),
    components: inv.components,
    findings,
    worst: worst(findings),
  };
}

export function worst(findings) {
  let i = 0;
  for (const f of findings) i = Math.max(i, SEVERITIES.indexOf(f.severity));
  return findings.length ? SEVERITIES[i] : null;
}

// What the command line exits with, so CI can gate on it: 0 when nothing reaches `failOn`, 2 when
// something is critical, 1 otherwise. 3 is reserved for "could not audit". The default gate is
// medium; a team loosens or tightens it with --fail-on.
export function exitCode(findings, failOn = 'medium') {
  const w = worst(findings);
  if (!w || SEVERITIES.indexOf(w) < SEVERITIES.indexOf(failOn)) return 0;
  return w === 'critical' ? 2 : 1;
}
