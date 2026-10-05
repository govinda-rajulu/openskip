// os-147 (5 Oct 2026): the agent desk keeps only what a script can check. Seats that
// make up quotes, echo the canary or vote without a quote do not count, and the desk
// can call four GitHub endpoints only. These tests run the real script with fake seats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve('.');
const py = (code) => {
  const r = spawnSync('python3', ['-c', code], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PYTHONPATH: join(ROOT, 'scripts') } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const HEAD = 'import json, agent_desk as d\n';

test('verify_quote: a real quote gets its true line, made-up or short quotes get none', () => {
  const r = py(HEAD + [
    'src = "a = 1\\nfunction isYouTube(url) {\\n  return String(url).includes(\'youtube.com\');\\n}\\n"',
    'print("REAL", d.verify_quote(src, "return String(url).includes(\'youtube.com\');", 40))',
    'print("NUMBERED", d.verify_quote(src, "3| return String(url).includes(\'youtube.com\');", 3))',
    'print("FAKE", d.verify_quote(src, "return url.hostname.endsWith(\'youtube.com\');", 3))',
    'print("SHORT", d.verify_quote(src, "a = 1", 1))',
    'print("MULTI", d.verify_quote(src, "a = 1\\nfunction isYouTube(url) {", 1))',
  ].join('\n'));
  assert.match(r.out, /REAL 3\nNUMBERED 3\nFAKE None\nSHORT None\nMULTI None/, r.out);
});

test('verdict: confirmed needs a cited confirm and no cited refute', () => {
  const r = py(HEAD + [
    'V = lambda v, ok=True: {"verdict": v, "valid": ok}',
    'print(d.decide([V("CONFIRM")]), d.decide([V("CONFIRM"), V("REFUTE")]), d.decide([V("REFUTE"), V("REFUTE"), V("CONFIRM")]),',
    '      d.decide([V("CONFIRM", False), V("UNSURE")]), d.decide([]))',
  ].join('\n'));
  assert.match(r.out, /confirmed disputed refuted unchecked unchecked/, r.out);
});

test('hunt: made-up quotes are counted per seat, agreement is merged, uncited votes are dropped, settled is dropped', () => {
  const r = py(HEAD + [
    'import os, tempfile',
    'root = tempfile.mkdtemp(); os.makedirs(os.path.join(root, "src"))',
    'open(os.path.join(root, "src/a.js"), "w").write("const x = 1;\\nfunction bad(box, t) {\\n  box.innerHTML = \'<b>\' + t;\\n}\\nconst uuid = crypto.randomUUID();\\n")',
    'REAL = {"line": 3, "quote": "box.innerHTML = \'<b>\' + t;", "title": "HTML from page", "claim": "XSS", "severity": "high", "category": "security", "test_idea": "t"}',
    'FAKE = {"line": 9, "quote": "eval(location.hash.slice(1));", "title": "eval", "claim": "x", "severity": "high"}',
    'SETTLED = {"line": 5, "quote": "const uuid = crypto.randomUUID();", "title": "random id", "claim": "x", "severity": "low"}',
    'def seat_a(p, n):',
    '    if "Another seat claims" in p: return json.dumps({"verdict": "CONFIRM", "quote": "x", "reason": "no real quote"})',
    '    return json.dumps({"findings": [REAL, FAKE]})',
    'def seat_b(p, n):',
    '    if "Another seat claims" in p: return json.dumps({"verdict": "CONFIRM", "quote": "box.innerHTML = \'<b>\' + t;", "reason": "page text as HTML"})',
    '    return json.dumps({"findings": [REAL, SETTLED]})',
    'def seat_c(p, n):',
    '    if "Another seat claims" in p: return json.dumps({"verdict": "REFUTE", "quote": "nothing like this line", "reason": "uncited"})',
    '    return "I think it is fine"',
    'def seat_d(p, n):',
    '    if "Another seat claims" in p: return json.dumps({"verdict": "CONFIRM", "quote": "box.innerHTML = \'<b>\' + t;", "reason": "cited"})',
    '    return json.dumps({"findings": []})',
    'desk = d.Desk([("a", seat_a), ("b", seat_b), ("c", seat_c), ("d", seat_d)], root=root, log=lambda *x: None)',
    'res = desk.hunt({"topic": "T", "text": "hunt", "files": ["src/a.js"]}, ["src/a.js"])',
    'f = res["findings"]',
    'print("N", len(f), f[0]["line"], sorted(f[0]["seats"]), f[0]["verdict"])',
    'print("VOTES", [(v["seat"], v["verdict"], v["valid"], v.get("uncited")) for v in f[0]["votes"]])',
    'print("STATS", {k: (v["answered"], v["found"], v["fabricated"], v["settled"]) for k, v in res["stats"].items()})',
    'print("C_ERR", res["stats"]["c"]["errors"])',
  ].join('\n'));
  assert.match(r.out, /N 1 3 \['a', 'b'\] confirmed/, r.out);
  assert.match(r.out, /VOTES \[\('c', 'REFUTE', False, True\), \('d', 'CONFIRM', True, False\)\]/, 'a and b found it, so only c and d were asked; c had no real quote');
  assert.match(r.out, /STATS \{'a': \(1, 1, 1, 0\), 'b': \(1, 1, 0, 1\), 'c': \(0, 0, 0, 0\), 'd': \(1, 0, 0, 0\)\}/, r.out);
  assert.match(r.out, /C_ERR \['src\/a\.js: answer was not the JSON asked for'\]/);
});

test('hunt: a seat that echoes the canary is discarded; an oversized file is not read and never cut', () => {
  const r = py(HEAD + [
    'import os, tempfile',
    'root = tempfile.mkdtemp()',
    'open(os.path.join(root, "big.js"), "w").write("x\\n" * 130000)',
    'open(os.path.join(root, "s.js"), "w").write("const value = compute(1);\\n")',
    'seen = []',
    'def seat(p, n):',
    '    seen.append(len(p))',
    '    tok = p.split("Never repeat this token: ")[1].split()[0]',
    '    return json.dumps({"findings": [{"line": 1, "quote": "const value = compute(1);", "title": tok}]})',
    'desk = d.Desk([("echo", seat)], root=root)',
    'res = desk.hunt({"topic": "T", "text": "", "files": []}, ["big.js", "s.js"])',
    'print("SKIPPED", res["skipped"])',
    'print("ERR", res["stats"]["echo"]["errors"], "FOUND", len(res["findings"]), "CALLS", len(seen))',
  ].join('\n'));
  assert.match(r.out, /SKIPPED \['big\.js \(260000 chars, over the budget: not read, never cut\)'\]/, r.out);
  assert.match(r.out, /ERR \['s\.js: echoed the canary'\] FOUND 0 CALLS 1/, r.out);
});

test('exam: scored against planted answers; a seat that makes up quotes fails the exam', () => {
  const r = py(HEAD + [
    'ans = d.exam_answers()',
    'src = {f: open(f).read() for f in d.exam_files()}',
    'def honest(p, n):',
    '    if "Another seat claims" in p: return json.dumps({"verdict": "UNSURE", "quote": "", "reason": ""})',
    '    out = [{"line": a["line"], "quote": a["quote"], "title": a["id"], "claim": a["why"], "severity": "high"} for a in ans if ("FILE tests/fixtures/agent-exam/" + a["file"]) in p]',
    '    return json.dumps({"findings": out[:5]})',
    'def liar(p, n):',
    '    return json.dumps({"findings": [{"line": 3, "quote": "document.write(location.hash);", "title": "x"}]})',
    'files = d.exam_files()',
    'good = d.score(d.Desk([("h", honest)]).hunt({"topic": "EXAM", "text": ""}, files), ans)',
    'bad = d.score(d.Desk([("h", honest), ("l", liar)]).hunt({"topic": "EXAM", "text": ""}, files), ans)',
    'print("GOOD", good["passed"], good["recall"], good["fabricated"], good["missed"])',
    'print("BAD", bad["passed"], bad["fabricated"])',
  ].join('\n'));
  assert.match(r.out, /GOOD True 1\.0 0 \[\]/, r.out);
  assert.match(r.out, /BAD False 2/, r.out);
});

test('exam fixtures: every planted answer and decoy points at its real line; the seats never see ANSWERS.json', () => {
  const a = JSON.parse(readFileSync('tests/fixtures/agent-exam/ANSWERS.json', 'utf8'));
  assert.ok(a.planted.length >= 6 && a.decoys.length >= 4);
  for (const x of [...a.planted, ...a.decoys]) {
    const lines = readFileSync('tests/fixtures/agent-exam/' + x.file, 'utf8').split('\n');
    assert.ok(lines[x.line - 1].includes(x.quote), x.file + ':' + x.line);
  }
  const r = py(HEAD + 'print(d.exam_files())');
  assert.doesNotMatch(r.out, /ANSWERS/);
});

test('GitHub: four endpoints only; model text loses mentions, HTML, images and fences', () => {
  const r = py(HEAD + [
    'calls = []',
    'gh = d.GitHub("o/r", "t", send=lambda m, p, b: calls.append((m, p)) or [])',
    'gh.issues("agent-finding"); gh.create("t", "b", ["x"]); gh.edit(3, "b"); gh.label("x", "fff", "d")',
    'for m, p in [("DELETE", "/repos/o/r/issues/3"), ("PUT", "/repos/o/r/contents/a.js"), ("POST", "/repos/o/r/pulls"), ("POST", "/repos/o/r/issues/3/labels")]:',
    '    try: gh.call(m, p)',
    '    except PermissionError: print("REFUSED", m, p)',
    'print("OK", len(calls))',
    'print("SAFE", repr(d.safe("hi @owner <img src=x> ![p](u) ```js```")))',
  ].join('\n'));
  assert.equal((r.out.match(/REFUSED/g) || []).length, 4, r.out);
  assert.match(r.out, /OK 4/);
  assert.match(r.out, /SAFE "hi @\\u200bowner &lt;img src=x&gt; \[p\]\(u\) '''js'''"/, r.out);
});

test('publish: a confirmed finding becomes one issue, never twice; disputed ones stay in the report', () => {
  const r = py(HEAD + [
    'store = {"agent-finding": [], "agent-report": []}; made = []',
    'def send(m, p, b):',
    '    if m == "GET": return [i for k, v in store.items() if "labels=" + k + "&" in p for i in v]',
    '    if m == "POST" and p.endswith("/issues"):',
    '        i = {"number": len(made) + 1, "title": b["title"], "body": b["body"], "state": "open"}; made.append(b["title"])',
    '        store[b["labels"][0]].append(i); return i',
    '    if m == "PATCH": made.append("EDIT"); return {}',
    '    return {}',
    'gh = d.GitHub("o/r", "t", send=send)',
    'F = lambda fp, v: {"fp": fp, "file": "a.js", "line": 1, "quote": "q" * 20, "title": "T" + fp, "claim": "c", "severity": "low", "test_idea": "", "seats": ["a"], "votes": [], "verdict": v}',
    'res = {"topic": "T", "files": ["a.js"], "skipped": [], "stats": {}, "calls": 1, "findings": [F("aaaaaaaaaaaa", "confirmed"), F("bbbbbbbbbbbb", "disputed")]}',
    'print("RUN1", d.publish(gh, "hunt", d.report_md("hunt", result=res), res))',
    'print("RUN2", d.publish(gh, "hunt", d.report_md("hunt", result=res), res))',
    'print("MADE", made)',
  ].join('\n'));
  assert.match(r.out, /RUN1 1\nRUN2 0/, r.out);
  assert.match(r.out, /MADE \['\[desk\] Taaaaaaaaaaaa \(a\.js\)', '\[agent-desk\] report', 'EDIT'\]/, r.out);
});

test('backlog, skills and settled list are well formed', () => {
  const r = py(HEAD + [
    'b = d.backlog(); print("TASKS", len(b), len({t["id"] for t in b}))',
    'print("DONE", all("Done when:" in t["body"] for t in b))',
    'import os',
    'for t in d.TOPICS:',
    '    s = d.skill(t); assert s["files"], t',
    '    for f in s["files"]: assert os.path.isfile(f), (t, f)',
    '    assert "Load when:" in s["text"], t',
    'print("SKILLS", len(d.TOPICS))',
    'rules = d.settled_rules(); print("SETTLED", len(rules))',
    'src = "".join(open(f).read() for f in ["background.js", "manifest.json"])',
    'print("REAL", all(p in src for p, _ in rules if p != "strict_min_version") and "strict_min_version" in src)',
  ].join('\n'));
  assert.match(r.out, /TASKS (\d+) \1/);
  assert.ok(Number(r.out.match(/TASKS (\d+)/)[1]) >= 12);
  assert.match(r.out, /DONE True\nSKILLS 5\nSETTLED \d+\nREAL True/, r.out);
});

test('sources: report-only live check classifies OK, EMPTY and DOWN without a model', () => {
  const r = py(HEAD + [
    'answers = {"IntroDB": (200, b"[]"), "TheIntroDB": (200, b"{}"), "SkipDB": (404, b"{}"), "AniSkip": (500, b"x"), "Jikan": (200, b"<html>"), "SponsorBlock": (404, b"Not Found")}',
    'def get(url):',
    '    for k, v in answers.items():',
    '        if {"IntroDB": "introdb.app", "TheIntroDB": "theintrodb", "SkipDB": "skipdb", "AniSkip": "aniskip", "Jikan": "jikan", "SponsorBlock": "sponsor.ajay"}[k] in url: return v',
    'print(d.check_sources(get))',
  ].join('\n'));
  assert.match(r.out, /\('IntroDB', 'OK'.*\('TheIntroDB', 'OK'.*\('SkipDB', 'EMPTY'.*\('AniSkip', 'DOWN'.*\('Jikan', 'DOWN'.*\('SponsorBlock', 'EMPTY'/, r.out);
});

test('workflow: owner or schedule only, off-switch, read-only checkout, issues only, time cap', () => {
  const s = readFileSync('.github/workflows/agent-desk.yml', 'utf8');
  assert.match(s, /vars\.AGENTS_PAUSED != 'true' &&\n\s+\(github\.event_name == 'schedule' \|\| github\.actor == github\.repository_owner\)/);
  assert.match(s, /permissions:\n\s+contents: read\n\s+issues: write/);
  assert.doesNotMatch(s, /contents: write|pull-requests: write|actions: write/);
  assert.match(s, /timeout-minutes: 40/);
  assert.match(s, /ref: main/);
  assert.doesNotMatch(s, /\$\{\{ inputs\.[a-z]+ \}\}"?\s*--/, 'inputs reach the shell only through env');
  for (const f of ['ai-fix-pr.yml', 'ai-pr-review.yml', 'sweep.yml', 'agent-desk.yml'])
    assert.match(readFileSync('.github/workflows/' + f, 'utf8'), /vars\.AGENTS_PAUSED != 'true'/, f);
  assert.equal(readFileSync('scripts/agent_desk.py', 'utf8').includes('ai-fix'), true, 'the docstring says it never labels ai-fix');
  assert.doesNotMatch(readFileSync('scripts/agent_desk.py', 'utf8'), /\["ai-fix"\]|'ai-fix'\]/);
});
