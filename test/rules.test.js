// Every rule proves itself: each folder in malicious/ must be flagged by it, each in benign/ must
// not. A rule without both kinds of fixture fails here, so it cannot be merged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../src/audit.js';
import { loadRules, RULES_DIR } from '../src/rules.js';

const rules = await loadRules();

for (const rule of rules) {
  const dir = path.join(RULES_DIR, rule.id);
  const cases = (kind) => (fs.existsSync(path.join(dir, kind)) ? fs.readdirSync(path.join(dir, kind)).filter((n) => fs.statSync(path.join(dir, kind, n)).isDirectory()) : []);

  test(`${rule.id} has fixtures of both kinds`, () => {
    assert.ok(cases('malicious').length >= 2, 'needs at least two malicious/ fixtures');
    assert.ok(cases('benign').length >= 2, 'needs at least two benign/ fixtures');
  });

  for (const name of cases('malicious')) {
    test(`${rule.id} flags malicious/${name}`, async () => {
      const result = await audit(path.join(dir, 'malicious', name), { rules: [rule] });
      assert.ok(result.findings.some((f) => f.rule === rule.id), `not flagged; units seen:\n${JSON.stringify(result.components, null, 1)}`);
    });
  }
  for (const name of cases('benign')) {
    test(`${rule.id} leaves benign/${name} alone`, async () => {
      const result = await audit(path.join(dir, 'benign', name), { rules: [rule] });
      const hits = result.findings.filter((f) => f.rule === rule.id);
      assert.equal(hits.length, 0, `false alarm: ${hits.map((h) => `${h.file}:${h.line ?? ''} ${h.excerpt}`).join('; ')}`);
    });
  }
}
