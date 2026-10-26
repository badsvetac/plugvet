// What changed between two versions of a plugin: the review an update needs, since auto-update
// replaces files after you looked at them. Components are matched by kind and name; a component
// whose summary changed (a hook now runs a different command) counts as changed.
export function diffAudits(before, after) {
  const key = (c) => `${c.kind}|${c.name}|${c.file}`;
  const old = new Map(before.components.map((c) => [key(c), c]));
  const now = new Map(after.components.map((c) => [key(c), c]));
  const added = [], removed = [], changed = [];
  for (const [k, c] of now) {
    const o = old.get(k);
    if (!o) added.push(c);
    else if (o.summary !== c.summary) changed.push({ before: o, after: c });
  }
  for (const [k, c] of old) if (!now.has(k)) removed.push(c);
  const fkey = (f) => `${f.rule}|${f.file}|${f.component || ''}|${f.excerpt || f.title}`;
  const oldFindings = new Set(before.findings.map(fkey));
  const newFindings = after.findings.filter((f) => !oldFindings.has(fkey(f)));
  return { added, removed, changed, newFindings };
}
