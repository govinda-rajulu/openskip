// Packet F: the agent fleet cannot commit truncated files, falls through dead seats,
// and the weekly audit cannot publish findings it did not quote from the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve('.');
const py = (code, cwd = ROOT) => {
  const r = spawnSync('python3', ['-c', code], { cwd, encoding: 'utf8', env: { ...process.env, PYTHONPATH: join(ROOT, 'scripts') } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const wf = f => readFileSync('.github/workflows/' + f, 'utf8');

function sandbox() {
  const d = mkdtempSync(join(tmpdir(), 'ai-edits-'));
  mkdirSync(join(d, 'content-scripts'));
  mkdirSync(join(d, 'tests'));
  writeFileSync(join(d, 'content-scripts/content.js'), 'const a = 1;\nconst b = 2;\nfunction f() { return a + b; }\n'.repeat(1) + '// pad\n'.repeat(40));
  writeFileSync(join(d, 'tests/ok.test.mjs'), "import test from 'node:test'; test('ok', () => {});\n");
  return d;
}
const run = (d, obj, gates = false) => py(
  'import json,ai_edits\n' +
  'try:\n  r = ai_edits.apply_edits(json.loads(' + JSON.stringify(JSON.stringify(obj)) + '), root=' + JSON.stringify(d) + ', run_gates=' + (gates ? 'True' : 'False') + ')\n  print("OK", json.dumps([[x["filename"], len(x["content"])] for x in r]))\n' +
  'except ai_edits.EditError as e:\n  print("REFUSED", e)\n');

test('edits apply only when every find matches exactly once', () => {
  const d = sandbox();
  assert.match(run(d, { edits: [{ file: 'content-scripts/content.js', find: 'const b = 2;', replace: 'const b = 3;', why: 'x' }] }).out, /^OK/);
  assert.match(readFileSync(join(d, 'content-scripts/content.js'), 'utf8'), /const b = 3;/);
  assert.match(run(d, { edits: [{ file: 'content-scripts/content.js', find: 'const zz = 9;', replace: 'y' }] }).out, /REFUSED.*occurs 0 times/);
  assert.match(run(d, { edits: [{ file: 'content-scripts/content.js', find: '// pad', replace: '' }] }).out, /REFUSED.*occurs 40 times/);
});

test('refuses the old COMPLETE-file format, path tricks, banned tokens and big shrinks', () => {
  const d = sandbox();
  assert.match(py('import ai_edits\ntry:\n  ai_edits.parse(\'[{"filename":"a.js","content":"x"}]\')\nexcept ai_edits.EditError as e:\n  print("REFUSED", e)').out, /retired COMPLETE-file/);
  assert.match(run(d, { edits: [{ file: '../x.js', find: 'a', replace: 'b' }] }).out, /REFUSED.*not allowed/);
  assert.match(run(d, { edits: [{ file: '.github/workflows/release.yml', find: 'a', replace: 'b' }] }).out, /REFUSED.*not allowed/);
  assert.match(run(d, { edits: [{ file: 'content-scripts/content.js', find: 'const a = 1;', replace: 'const a = localStorage.x;' }] }).out, /REFUSED.*banned 'localStorage'/);
  assert.match(run(d, { edits: [{ file: 'content-scripts/content.js', find: 'const a = 1;', replace: 'el.innerHTML = 1;' }] }).out, /REFUSED.*banned 'innerHTML'/);
  const big = readFileSync(join(d, 'content-scripts/content.js'), 'utf8');
  assert.match(run(d, { edits: [{ file: 'content-scripts/content.js', find: big.slice(0, big.length - 10), replace: '' }] }).out, /REFUSED.*shrink/);
  assert.match(run(d, { edits: Array.from({ length: 13 }, () => ({ file: 'content-scripts/content.js', find: 'a', replace: 'b' })) }).out, /REFUSED.*too many/);
  assert.match(run(d, { stop: 'CLARIFY: which site?' }).out, /^OK \[\["", 0\]\]/);
});

test('a syntax error or a failing test restores the files (gates on)', () => {
  const d = sandbox();
  const before = readFileSync(join(d, 'content-scripts/content.js'), 'utf8');
  assert.match(run(d, { edits: [{ file: 'content-scripts/content.js', find: 'const b = 2;', replace: 'const b = ;' }] }, true).out, /REFUSED.*node --check/);
  assert.equal(readFileSync(join(d, 'content-scripts/content.js'), 'utf8'), before);
  assert.match(run(d, { edits: [{ file: 'tests/bad.test.mjs', find: '', replace: "import test from 'node:test'; test('no', () => { throw new Error('x'); });\n" }] }, true).out, /REFUSED.*tests failed/);
  assert.match(run(d, { edits: [{ file: 'content-scripts/content.js', find: 'const b = 2;', replace: 'const b = 4;' }] }, true).out, /^OK/);
});

test('ai_call: dead or empty seats fall through, GitHub Models is gone', () => {
  const r = py([
    'import ai_call, urllib.error',
    'def dead(p, m): raise urllib.error.HTTPError("u", 410, "Gone", None, None)',
    'def empty(p, m): return ""',
    'def good(p, m): return "OK"',
    'ai_call.PROVIDERS = [("a", dead), ("b", empty), ("c", good)]',
    'print(ai_call.ask("x"))',
    'ai_call.PROVIDERS = [("a", dead), ("b", empty)]',
    'try:\n  ai_call.ask("x")\nexcept RuntimeError as e:\n  print("ALLFAIL", e)',
  ].join('\n'));
  assert.match(r.out, /provider=c/);
  assert.match(r.out, /ALLFAIL.*a: HTTP Error 410.*b: empty answer/);
  const src = readFileSync('scripts/ai_call.py', 'utf8');
  assert.doesNotMatch(src, /models\.github\.ai/);
  assert.match(src, /PROVIDERS = \[\("openrouter", _openrouter\), \("gemini", _gemini\), \("nvidia", _nvidia\)\]/);
});

test('every agent workflow uses the edit contract and passes the NVIDIA seat', () => {
  for (const f of ['ai-fix-pr.yml', 'sweep.yml', 'ai-pr-review.yml', 'ai-weekly-audit.yml']) {
    const s = wf(f);
    assert.doesNotMatch(s, /COMPLETE file content/, f);
    assert.equal((s.match(/NVIDIA_API_KEY: \$\{\{ secrets\.NVIDIA_API_KEY \}\}/g) || []).length,
                 (s.match(/OPENROUTER_API_KEY: +\$\{\{ secrets\.OPENROUTER_API_KEY \}\}/g) || []).length, f);
  }
  assert.equal((wf('ai-fix-pr.yml').match(/apply_text\(/g) || []).length, 2);
  assert.equal((wf('sweep.yml').match(/apply_text\(/g) || []).length, 1);
  assert.match(wf('ai-probe.yml'), /ai_call\.py --probe/);
});

test('weekly audit keeps only findings whose quote is really in the file', () => {
  const s = wf('ai-weekly-audit.yml');
  assert.match(s, /if src and len\(q\) >= 12 and q in src:/);
  assert.match(s, /"quote": "ONE line copied/);
  assert.match(s, /if \(findings\.length === 0\) \{ core\.notice/);
});

test('setup SQL drops the allow_all policy found live on 29 Sep', () => {
  assert.match(readFileSync('supabase_setup.sql', 'utf8'), /drop policy if exists allow_all on public\.playback_states;/);
});
