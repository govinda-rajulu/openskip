import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const wf = (n) => fs.readFileSync(new URL('../.github/workflows/' + n, import.meta.url), 'utf8');

test('W4: sweep only runs for the repo owner, on both triggers', () => {
  const s = wf('sweep.yml');
  const issuesGate = s.slice(s.indexOf("github.event_name == 'issues'"), s.indexOf("github.event_name == 'issue_comment'"));
  assert.ok(issuesGate.includes('github.event.sender.login == github.repository_owner'));
  assert.ok(s.includes('github.event.comment.user.login == github.repository_owner'));
});

test('W1: pr-check syntax loop fails on any file, comment reflects job status', () => {
  const s = wf('pr-check.yml');
  assert.ok(/set -e\n\s+for f in [^\n]*theme-engine\.js/.test(s));
  assert.equal(s.includes('[ -f "$f" ] && node --check'), false);
  assert.ok(s.includes('JOB_STATUS: ${{ job.status }}'));
});

test('W7: cleanup keeps 180 days of runs and never deletes PR-less branches', () => {
  const s = wf('cleanup.yml');
  assert.ok(s.includes('180 * 24 * 60 * 60 * 1000'));
  assert.equal(s.includes('noPr'), false);
});

test('W5: no agent prompt still claims userId is derived from the anon key', () => {
  for (const n of fs.readdirSync(new URL('../.github/workflows/', import.meta.url)))
    assert.equal(wf(n).includes('SHA-256("skipstream:uid:"'), false, n);
});

test('W2: release does not hide a rejected push behind || echo', () => {
  assert.equal(wf('release.yml').includes('git push origin HEAD:main ||'), false);
});
