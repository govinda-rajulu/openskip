// os-147 (5 Oct 2026): knowledge/ names no unlicensed streaming site either, and the
// agent clean-up stays done (retired workflows stay retired, one rules file).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = path.resolve('.');
const BANNED = new Set(['935692bbc33dddd4', '2156e911290c8e4d', '19e15df04c07a773', '2f9bad7b791be024', '2b072a52b50caead',
  '858d9f8214f8dd04', '167dc31f526bb9fa', 'd13a094424561c30', '3b97b8eff0244f74', 'd751d926bdf5db2a', '8444417f5fdb471a',
  '022b57187b71a8f7', '632576c9c30d85fe', 'fdfee49755a5c5c1', 'fd350a999d788c21', 'e533d55ec58aa696', 'ebaa3dad218f7353']);
const hits = (text) => [...new Set((String(text).toLowerCase().match(/[a-z0-9]+/g) || [])
  .filter((w) => BANNED.has(createHash('sha256').update(w).digest('hex').slice(0, 16))).map((w) => w.length + ' chars'))];
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(md|tsv|py|yml|sh|txt|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('knowledge/ names no unlicensed streaming site (hash check)', () => {
  const files = walk(path.join(ROOT, 'knowledge'));
  assert.ok(files.length > 30);
  for (const p of files) assert.deepEqual(hits(fs.readFileSync(p, 'utf8')), [], path.relative(ROOT, p));
  assert.deepEqual(hits('play.' + ['x', 'pass'].join('') + '.top'), ['5 chars'], 'the check itself finds a name');
});

test('5S: retired workflows stay retired, cws-submit is manual, release no longer pushes updates.json', () => {
  const wf = (f) => path.join(ROOT, '.github/workflows', f);
  for (const f of ['version-bump.yml', 'store-version-check.yml', 'ai-weekly-audit.yml']) {
    assert.equal(fs.existsSync(wf(f)), false, f);
    assert.equal(fs.existsSync(path.join(ROOT, 'knowledge/archive/unused', f)), true, f + ' kept for history');
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts/agent.sh')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'knowledge/archive/unused/agent.sh')), true);
  const cws = fs.readFileSync(wf('cws-submit.yml'), 'utf8');
  assert.match(cws, /\non:\n  workflow_dispatch:/);
  assert.doesNotMatch(cws, /workflow_run:/);
  const rel = fs.readFileSync(wf('release.yml'), 'utf8');
  assert.doesNotMatch(rel, /git add updates\.json|git push origin HEAD:main/);
  assert.match(fs.readFileSync(wf('validate.yml'), 'utf8'), /updates\.json latest version/, 'Lint & Validate still checks updates.json');
});

test('one rules file: AGENTS.md; CLAUDE.md and GEMINI.md only point to it; agents read AGENTS.md', () => {
  const r = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const f of ['CLAUDE.md', 'GEMINI.md']) {
    assert.ok(r(f).length < 400, f + ' is a pointer');
    assert.match(r(f), /\[AGENTS\.md\]\(AGENTS\.md\)/);
  }
  const a = r('AGENTS.md');
  for (const want of ['## Hard rules', '## Versions and releases', '## Verify before you claim', '## UI rules', '## Agents', 'AGENTS_PAUSED'])
    assert.ok(a.includes(want), want);
  assert.doesNotMatch(a, /REPORT_SEGMENT|DELETE_ALL_HISTORY|claude-sonnet|version-bump\.yml automates/, 'no message type or workflow that does not exist');
  for (const f of fs.readdirSync(path.join(ROOT, '.github/workflows')))
    assert.doesNotMatch(r('.github/workflows/' + f), /cat (CLAUDE|GEMINI)\.md/, f);
});
