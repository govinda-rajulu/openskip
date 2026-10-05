// Packet G: CodeQL fixes stay fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { extractFunction } from './harness.mjs';

const content = readFileSync('content-scripts/content.js', 'utf8');
const amo = readFileSync('scripts/amo-update.js', 'utf8');
const sv = readFileSync('.github/workflows/supabase-validate.yml', 'utf8');

test('host checks are exact or subdomain, never substring (CodeQL #32)', () => {
  const hostIs = vm.runInNewContext('(' + extractFunction(content, '_hostIs') + ')');
  for (const h of ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']) {
    assert.equal(hostIs(h, 'youtube.com') || hostIs(h, 'youtu.be'), true, h);
  }
  for (const h of ['notyoutube.com', 'youtube.com.evil.net', 'evil.net', '', null]) {
    assert.equal(hostIs(h, 'youtube.com') || hostIs(h, 'youtu.be'), false, String(h));
  }
  assert.doesNotMatch(content, /host\.includes\('youtu/);
});

test('dead relay guard and dead selector list are gone (CodeQL #3 #4 #34)', () => {
  assert.doesNotMatch(content, /topFrameListening/);
  assert.doesNotMatch(content, /SKIP_SELECTORS/);
  assert.match(content, /const NEXT_EP_SELECTORS = \[/);
  assert.equal(content.match(/window\.addEventListener\('message'/g).length, 2);
});

test('changelog version is fully regex-escaped (CodeQL #21) and AMO_BASE is gone (#19)', () => {
  const esc = v => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.ok(amo.includes("String(version).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')"));
  assert.equal(new RegExp('^' + esc('1.10.0') + '$').test('1.10.0'), true);
  assert.equal(new RegExp('^' + esc('1.10.0') + '$').test('1x10x0'), false);
  assert.equal(new RegExp('^' + esc('a\\b(c)') + '$').test('a\\b(c)'), true);
  assert.doesNotMatch(amo, /AMO_BASE/);
});

test('CI can never apply SQL to the live Supabase project (CodeQL #30)', () => {
  assert.doesNotMatch(sv, /SUPABASE_DB_URL|run_on_supabase|psql /);
  assert.match(sv, /workflow_dispatch:/);
});

test('CodeQL scans shipped code only: tests/ is ignored, nothing else is', () => {
  const wf = readFileSync('.github/workflows/codeql.yml', 'utf8');
  const cfg = readFileSync('.github/codeql/codeql-config.yml', 'utf8');
  assert.match(wf, /\n {10}config-file: \.\/\.github\/codeql\/codeql-config\.yml\n/);
  assert.match(cfg, /\npaths-ignore:\n  - tests\n$/);
  assert.equal((cfg.match(/^  - /gm) || []).length, 1, 'only tests/ is ignored');
});

test('no condition that is always true after if (active) (CodeQL #48)', () => {
  assert.doesNotMatch(content, /\} else if \(!active && activeSegmentKey\) \{/);
  assert.match(content, /\n      \} else if \(activeSegmentKey\) \{\n        activeSegmentKey = '';\n        hideSkipBtn\(\);/);
});
