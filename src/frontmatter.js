import { parse } from 'yaml';

// Splits a Markdown file into its YAML frontmatter and body. Claude Code still loads a file whose
// frontmatter does not parse (with every field ignored), so a parse failure is returned, not thrown.
// @returns {{ data: object, error: string|null, bodyLine: number }}
export function frontmatter(text) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, error: null, bodyLine: 1 };
  const bodyLine = m[0].split('\n').length;
  try {
    const data = parse(m[1]);
    return { data: data && typeof data === 'object' ? data : {}, error: null, bodyLine };
  } catch (e) {
    return { data: {}, error: e.message.split('\n')[0], bodyLine };
  }
}

// Tool lists appear as "Read, Grep", as "Bash(git add *) Read", or as YAML arrays. Commas and
// spaces inside parentheses belong to the rule, not the list: "Bash(git add *)" is one entry.
export function toolList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  const out = [];
  let depth = 0, current = '';
  for (const ch of String(value)) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || /\s/.test(ch))) { push(); continue; }
    current += ch;
  }
  push();
  return out;
  function push() { const t = current.trim(); if (t) out.push(t); current = ''; }
}
