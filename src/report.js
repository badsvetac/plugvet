import { SEVERITIES } from './rules.js';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint(1), dim = paint(2), red = paint(31), yellow = paint(33), magenta = paint(35), cyan = paint(36);
const SEV_PAINT = { critical: (s) => bold(red(s)), high: red, medium: yellow, low: cyan, info: dim };

const SECTIONS = [
  ['machine', 'RUNS ON YOUR MACHINE, outside the sandbox, with your permissions'],
  ['network', 'TALKS TO THE NETWORK by itself'],
  ['context', "PUTS INSTRUCTIONS IN CLAUDE'S CONTEXT"],
  ['info', 'ASKS YOU FOR'],
];

export function textReport(result, { minSeverity = 'low', explain = false } = {}) {
  const out = [];
  out.push(`${bold(result.name)} ${dim(`(${result.kind}, ${result.files} files, ${size(result.bytes)}) ${result.root}`)}`, '');
  for (const [reach, title] of SECTIONS) {
    const items = result.components.filter((c) => c.reach === reach);
    if (!items.length) continue;
    out.push(bold(title));
    // The same hook declared by twenty skills is one thing to review, not twenty.
    const groups = new Map();
    for (const c of items) {
      const k = `${c.kind}|${c.name}|${c.summary}`;
      if (!groups.has(k)) groups.set(k, { c, files: [] });
      groups.get(k).files.push(c.file);
    }
    for (const { c, files } of groups.values()) {
      const where = files.length > 1 ? `${files[0]} and ${files.length - 1} more` : files[0];
      out.push(`  ${c.kind.padEnd(12)} ${c.name.padEnd(24)} ${files.length > 1 ? bold(`×${files.length} `) : ''}${c.summary}  ${dim(where)}`);
    }
    out.push('');
  }
  if (!result.components.some((c) => c.reach === 'machine' || c.reach === 'network')) out.push(dim('Nothing in it runs code or reaches the network on its own.'), '');

  const shown = result.findings.filter((f) => SEVERITIES.indexOf(f.severity) >= SEVERITIES.indexOf(minSeverity));
  if (shown.length) {
    out.push(bold('FINDINGS'));
    for (const f of shown) {
      out.push(`  ${SEV_PAINT[f.severity](f.severity.toUpperCase().padEnd(8))} ${f.title}  ${dim(f.rule)}`);
      out.push(`           ${f.file}${f.line ? `:${f.line}` : ''}${f.component ? dim(` · ${f.component}`) : ''}`);
      if (f.excerpt) out.push(`           ${magenta('│')} ${f.excerpt}`);
      if (explain && f.why) out.push(...wrap(f.why, 72).map((l) => `           ${dim(l)}`));
      if (explain && f.fix) out.push(...wrap(`Fix: ${f.fix}`, 72).map((l) => `           ${dim(l)}`));
      if (explain && f.author?.name) out.push(`           ${dim(`rule by ${f.author.name}${f.author.url ? ` (${f.author.url})` : ''}`)}`);
    }
    out.push('');
  }
  const counts = SEVERITIES.slice().reverse().map((s) => [s, result.findings.filter((f) => f.severity === s).length]).filter(([, n]) => n);
  out.push(counts.length ? counts.map(([s, n]) => SEV_PAINT[s](`${n} ${s}`)).join(', ') + (shown.length < result.findings.length ? dim(` (below ${minSeverity} hidden; --all shows them)`) : '') : 'No findings.');
  return out.join('\n');
}

export function diffReport(name, d) {
  const out = [bold(`${name}: what the new version changes`), ''];
  const line = (sign, c) => `  ${sign} ${c.kind.padEnd(12)} ${c.name.padEnd(24)} ${c.summary}  ${dim(c.file)}`;
  if (d.added.length) out.push(bold('ADDED'), ...d.added.map((c) => line(red('+'), c)), '');
  if (d.changed.length) out.push(bold('CHANGED'), ...d.changed.flatMap((x) => [line(yellow('~'), x.after), dim(`      was: ${x.before.summary}`)]), '');
  if (d.removed.length) out.push(bold('REMOVED'), ...d.removed.map((c) => line(dim('-'), c)), '');
  if (d.newFindings.length) {
    out.push(bold('NEW FINDINGS'));
    for (const f of d.newFindings) out.push(`  ${SEV_PAINT[f.severity](f.severity.toUpperCase().padEnd(8))} ${f.title}  ${dim(`${f.file}${f.line ? `:${f.line}` : ''}`)}`);
    out.push('');
  }
  if (!d.added.length && !d.changed.length && !d.removed.length && !d.newFindings.length) out.push('Nothing that runs, connects or instructs has changed.');
  return out.join('\n');
}

function size(n) { return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`; }
function wrap(s, width) {
  const words = s.replace(/\s+/g, ' ').split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > width) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}
