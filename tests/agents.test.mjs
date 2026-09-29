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

test('F2: thinking is stripped, non-JSON answers fall through, probe needs a real OK', () => {
  const r = py([
    'import ai_call',
    'print("C1", repr(ai_call.clean("<think>plan</think>\\n{\\"a\\":1}")))',
    'print("C2", repr(ai_call.clean("<think>never closed")))',
    'def talk(p, m): return "The user wants me to"',
    'def js(p, m): return "{\\"edits\\": []}"',
    'ai_call.PROVIDERS = [("chatty", talk), ("json", js)]',
    'print("A1", ai_call.ask("x", accept=ai_call.looks_json))',
    'print("A2", ai_call.ask("x"))',
    'ai_call.PROVIDERS = [("chatty", talk)]',
    'print("P", ai_call.probe())',
  ].join('\n'));
  assert.match(r.out, /C1 '\{"a":1\}'/);
  assert.match(r.out, /C2 ''/);
  assert.match(r.out, /A1 \{"edits": \[\]\}/);
  assert.match(r.out, /A2 The user wants me to/);
  assert.match(r.out, /chatty: ANSWERED-BUT-NOT-OK/);
  assert.match(r.out, /P 0/);
});

test('F2: a retired Gemini model (404) switches to the newest live flash model', () => {
  const r = py([
    'import ai_call, urllib.error',
    'print("PICK", ai_call.gemini_pick(["gemini-1.5-flash","gemini-2.5-flash","gemini-2.5-flash-lite","gemini-3.0-flash-preview","gemini-2.5-pro","text-embedding-004"]))',
    'print("PICK2", ai_call.gemini_pick(["gemini-2.5-flash-lite","gemini-2.5-pro"]))',
    'ai_call.GEMINI_KEY = "k"; ai_call.MODEL_GEMINI = "gemini-2.0-flash"',
    'seen = []',
    'def once(model, p, m):',
    '    seen.append(model)',
    '    if model == "gemini-2.0-flash": raise urllib.error.HTTPError("u", 404, "nf", None, None)',
    '    return "OK"',
    'ai_call._gemini_once = once',
    'ai_call._gemini_live_models = lambda: ["gemini-2.5-flash"]',
    'print("ANS", ai_call._gemini("x", 10), seen)',
    'print("ANS2", ai_call._gemini("x", 10), seen)',
  ].join('\n'));
  assert.match(r.out, /PICK gemini-2\.5-flash\n/);
  assert.match(r.out, /PICK2 gemini-2\.5-flash-lite/);
  assert.match(r.out, /gemini tried gemini-2\.0-flash \(HTTP 404\); answered by gemini-2\.5-flash/);
  assert.match(r.out, /ANS OK \['gemini-2\.0-flash', 'gemini-2\.5-flash'\]/);
  assert.match(r.out, /ANS2 OK \['gemini-2\.0-flash', 'gemini-2\.5-flash', 'gemini-2\.5-flash'\]/);
});

test('F3: an overloaded Gemini model (503) walks the ranked live list and names every model tried', () => {
  const r = py([
    'import ai_call, urllib.error',
    'print("RANK", ai_call.gemini_rank(["gemini-2.5-flash-lite","gemini-3.8-flash","gemini-2.5-flash","gemini-3.8-flash-preview","gemini-2.5-pro"]))',
    'ai_call.GEMINI_KEY = "k"; ai_call.MODEL_GEMINI = "gemini-3.8-flash"',
    'seen = []',
    'def once(model, p, m):',
    '    seen.append(model)',
    '    if model in ("gemini-3.8-flash", "gemini-3.5-flash"): raise urllib.error.HTTPError("u", 503, "busy", None, None)',
    '    return "OK"',
    'ai_call._gemini_once = once',
    'ai_call._gemini_live_models = lambda: ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"]',
    'print("ANS", ai_call._gemini("x", 10), seen)',
    'def dead(model, p, m):',
    '    raise urllib.error.HTTPError("u", 503, "busy", None, None)',
    'ai_call._gemini_once = dead; ai_call._GEMINI_PICKED = None',
    'try:',
    '    ai_call._gemini("x", 10)',
    'except urllib.error.HTTPError as e:',
    '    print("RAISED", e.code)',
    'def bad(model, p, m):',
    '    raise urllib.error.HTTPError("u", 400, "bad", None, None)',
    'ai_call._gemini_once = bad',
    'try:',
    '    ai_call._gemini("x", 10)',
    'except urllib.error.HTTPError as e:',
    '    print("RAISED400", e.code)',
  ].join('\n'));
  assert.match(r.out, /RANK \['gemini-3\.8-flash', 'gemini-2\.5-flash', 'gemini-2\.5-flash-lite', 'gemini-2\.5-pro'\]/);
  assert.match(r.out, /gemini tried gemini-3\.8-flash \(HTTP 503\), gemini-3\.5-flash \(HTTP 503\); answered by gemini-2\.5-flash/);
  assert.match(r.out, /ANS OK \['gemini-3\.8-flash', 'gemini-3\.5-flash', 'gemini-2\.5-flash'\]/);
  assert.match(r.out, /gemini tried gemini-3\.8-flash \(HTTP 503\), gemini-3\.5-flash \(HTTP 503\), gemini-2\.5-flash \(HTTP 503\), gemini-2\.5-flash-lite \(HTTP 503\); no live model answered/);
  assert.match(r.out, /RAISED 503/);
  assert.match(r.out, /RAISED400 400/);
});

test('F3: one 503 is retried once on the same model before moving on', () => {
  const r = py([
    'import ai_call, urllib.error',
    'ai_call.GEMINI_KEY = "k"',
    'calls = []',
    'def post(url, payload, headers, timeout=0):',
    '    calls.append(url)',
    '    if len(calls) == 1: raise urllib.error.HTTPError(url, 503, "busy", None, None)',
    '    return {"candidates": [{"content": {"parts": [{"text": "OK"}]}}]}',
    'ai_call._post = post',
    'ai_call.time.sleep = lambda s: None',
    'print("ONCE", ai_call._gemini_once("gemini-3.8-flash", "x", 10), len(calls))',
    'calls.clear()',
    'def post2(url, payload, headers, timeout=0):',
    '    calls.append(url)',
    '    raise urllib.error.HTTPError(url, 503, "busy", None, None)',
    'ai_call._post = post2',
    'try:',
    '    ai_call._gemini_once("gemini-3.8-flash", "x", 10)',
    'except urllib.error.HTTPError as e:',
    '    print("GAVEUP", e.code, len(calls))',
  ].join('\n'));
  assert.match(r.out, /ONCE OK 2/);
  assert.match(r.out, /GAVEUP 503 2/);
});

test('F2: every JSON-contract agent asks with accept=looks_json', () => {
  assert.equal((wf('ai-fix-pr.yml').match(/accept=looks_json/g) || []).length, 2);
  assert.match(wf('sweep.yml'), /ask\(prompt, accept=looks_json\)/);
  assert.match(wf('ai-weekly-audit.yml'), /ask\(prompt, accept=looks_json\)/);
  assert.match(readFileSync('scripts/ai_call.py', 'utf8'), /"reasoning": \{"effort": "low", "exclude": True\}/);
});

test('F4: a seat that spends its whole budget thinking is asked once more with 4x tokens', () => {
  const r = py([
    'import ai_call, urllib.error',
    'ai_call.OPENROUTER_KEY = "k"; ai_call.NVIDIA_KEY = "k"; ai_call.GEMINI_KEY = "k"',
    'budgets = []',
    'def post(url, payload, headers, timeout=0):',
    '    if "generativelanguage" in url:',
    '        b = payload["generationConfig"]["maxOutputTokens"]; budgets.append(("g", b))',
    '        if b < 2048: return {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": "hm", "thought": True}]}}]}',
    '        return {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "OK"}]}}]}',
    '    budgets.append((payload["model"][:3], payload["max_tokens"]))',
    '    if payload["max_tokens"] < 2048: return {"choices": [{"finish_reason": "length", "message": {"content": None}}]}',
    '    return {"choices": [{"finish_reason": "stop", "message": {"content": "OK"}}]}',
    'ai_call._post = post',
    'print("OR", ai_call._openrouter("x", 512))',
    'print("NV", ai_call._nvidia("x", 512))',
    'print("GM", ai_call._gemini_once("gemini-3.6-flash", "x", 512))',
    'print("B", budgets)',
    'def stop(url, payload, headers, timeout=0):',
    '    return {"choices": [{"finish_reason": "stop", "message": {"content": ""}}]}',
    'ai_call._post = stop; budgets.clear()',
    'print("EMPTYSTOP", repr(ai_call._openrouter("x", 512)))',
  ].join('\n'));
  assert.match(r.out, /OR OK/);
  assert.match(r.out, /NV OK/);
  assert.match(r.out, /GM OK/);
  assert.match(r.out, /ran out of tokens while thinking, retrying with 2048/);
  assert.match(r.out, /B \[\('goo', 512\), \('goo', 2048\), \('ope', 512\), \('ope', 2048\), \('g', 512\), \('g', 2048\)\]/);
  assert.match(r.out, /EMPTYSTOP ''/);
});

test('F4: 429 and 5xx wait and retry (5s, 15s), other errors fail at once', () => {
  const r = py([
    'import ai_call, urllib.error',
    'ai_call.OPENROUTER_KEY = "k"',
    'waits = []; ai_call.time.sleep = lambda s: waits.append(s)',
    'codes = [429, 503]',
    'def post(url, payload, headers, timeout=0):',
    '    if codes: raise urllib.error.HTTPError(url, codes.pop(0), "busy", None, None)',
    '    return {"choices": [{"finish_reason": "stop", "message": {"content": "OK"}}]}',
    'ai_call._post = post',
    'print("ANS", ai_call._openrouter("x", 512), waits)',
    'codes[:] = [429, 429, 429]; waits.clear()',
    'try:',
    '    ai_call._openrouter("x", 512)',
    'except urllib.error.HTTPError as e:',
    '    print("GAVEUP", e.code, waits)',
    'codes[:] = [401]; waits.clear()',
    'try:',
    '    ai_call._openrouter("x", 512)',
    'except urllib.error.HTTPError as e:',
    '    print("AUTH", e.code, waits)',
  ].join('\n'));
  assert.match(r.out, /ANS OK \[5, 15\]/);
  assert.match(r.out, /GAVEUP 429 \[5, 15\]/);
  assert.match(r.out, /AUTH 401 \[\]/);
});
