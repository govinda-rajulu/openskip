#!/usr/bin/env python3
"""Find/replace output contract for SkipStream fix agents.

Models used to return COMPLETE file contents. With an 8192-token answer
limit that cannot cover content.js (~86 KB), and a cut-off answer would be
committed as a truncated file. Now the model returns small edits; this
module applies them only when every guard passes, then hands the workflow
the full resulting files in the old shape:
    [{"filename": ..., "content": ..., "description": ...}]
so the existing "open PR" steps stay unchanged.

Guards (any failure = nothing is written, the agent reports the reason):
- file on the allowlist, no path tricks
- every "find" occurs EXACTLY ONCE in the current text (after earlier edits)
- at most MAX_EDITS edits; a file may not shrink below 70% of its size
- no NEW innerHTML / console.log anywhere, no NEW localStorage / fetch( in content.js
- node --check on every changed .js file, then the full test suite: 0 failures
  (files are restored if a gate fails)
"""
import json
import os
import re
import subprocess

MAX_EDITS = 12
ALLOWED = {
    "background.js", "content-scripts/content.js", "options.js", "options.html",
    "popup.js", "popup.html", "popup.css", "options.css", "theme-engine.js",
    "CHANGELOG.md", "README.md", "PRIVACY.md",
}
ALLOWED_TEST = re.compile(r"^tests/[A-Za-z0-9_-]+\.test\.mjs$")
BANNED_ALL = ["innerHTML", "console.log"]
BANNED_CONTENT = ["localStorage", "fetch("]

CONTRACT = """Respond ONLY with one JSON object (no markdown, no code fences):
{"edits":[{"file":"path/in/repo","find":"exact text copied from the CURRENT file","replace":"new text","why":"max 72 chars"}]}
Rules for edits:
- "find" is copied character for character from the file (same spaces and indentation) and occurs EXACTLY ONCE in it. Include 1-3 neighbouring lines so it is unique.
- Keep edits small. NEVER rewrite a whole file. At most 12 edits.
- To add code, "find" an existing line and repeat it inside "replace" next to the new code.
- A new test file: {"file":"tests/name.test.mjs","find":"","replace":"<whole new file>"}.
- Editable files: background.js, content-scripts/content.js, options.js, options.html, popup.js, popup.html, popup.css, options.css, theme-engine.js, CHANGELOG.md, README.md, PRIVACY.md, tests/*.test.mjs
If it cannot be done safely, answer {"stop":"CANNOT_FIX: reason"} (or "CLARIFY: question", or "DISCUSS: reason")."""


class EditError(Exception):
    pass


def _strip_fences(text):
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        t = t.rsplit("```", 1)[0]
    return t.strip()


def parse(text):
    try:
        obj = json.loads(_strip_fences(text))
    except Exception as e:
        raise EditError("answer is not JSON: " + str(e)[:120])
    if isinstance(obj, list):
        raise EditError("answer used the retired COMPLETE-file format; edits are required")
    if not isinstance(obj, dict):
        raise EditError("answer is not a JSON object")
    return obj


def _allowed(path):
    if not isinstance(path, str) or not path or path.startswith("/") or ".." in path.split("/") or "\\" in path:
        return False
    return path in ALLOWED or bool(ALLOWED_TEST.match(path))


def _read(root, path):
    p = os.path.join(root, path)
    if not os.path.exists(p):
        return None
    with open(p, "rb") as fh:
        return fh.read().decode("utf-8")


def _run(cmd, root):
    env = dict(os.environ)
    env.pop("NODE_TEST_CONTEXT", None)  # a parent node --test would make the child skip every file
    return subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=600, env=env)


def _tests(root):
    tdir = os.path.join(root, "tests")
    files = sorted("tests/" + f for f in os.listdir(tdir) if f.endswith(".test.mjs")) if os.path.isdir(tdir) else []
    if not files:
        return None
    r = _run(["node", "--test", "--test-reporter=tap"] + files, root)
    out = r.stdout + r.stderr
    m_pass = re.search(r"^# pass (\d+)$", out, re.M)
    m_fail = re.search(r"^# fail (\d+)$", out, re.M)
    passed = int(m_pass.group(1)) if m_pass else -1
    failed = int(m_fail.group(1)) if m_fail else -1
    return {"code": r.returncode, "pass": passed, "fail": failed, "tail": out[-1500:]}


def apply_edits(obj, root=".", run_gates=True):
    """Validate + apply. Returns the legacy list for the PR step. Raises EditError."""
    if "stop" in obj:
        return [{"filename": "", "content": "", "description": str(obj.get("stop"))[:300]}]
    edits = obj.get("edits")
    if not isinstance(edits, list) or not edits:
        raise EditError("no edits in answer")
    if len(edits) > MAX_EDITS:
        raise EditError("too many edits: %d (max %d)" % (len(edits), MAX_EDITS))

    before, after, whys = {}, {}, {}
    for i, e in enumerate(edits):
        if not isinstance(e, dict):
            raise EditError("edit %d is not an object" % i)
        path, find, rep = e.get("file"), e.get("find"), e.get("replace")
        if not _allowed(path):
            raise EditError("edit %d: file not allowed: %r" % (i, path))
        if not isinstance(find, str) or not isinstance(rep, str):
            raise EditError("edit %d: find/replace must be strings" % i)
        if path not in after:
            cur = _read(root, path)
            before[path] = cur
            after[path] = cur
        cur = after[path]
        if find == "":
            if cur is not None or not ALLOWED_TEST.match(path):
                raise EditError("edit %d: empty find is only for creating a NEW tests/*.test.mjs file" % i)
            after[path] = rep
        else:
            if cur is None:
                raise EditError("edit %d: %s does not exist" % (i, path))
            n = cur.count(find)
            if n != 1:
                raise EditError("edit %d: find occurs %d times in %s (need exactly 1): %r" % (i, n, path, find[:80]))
            after[path] = cur.replace(find, rep, 1)
        whys.setdefault(path, []).append(str(e.get("why") or "edit")[:72])

    for path, new in after.items():
        old = before[path] or ""
        if new == old:
            raise EditError("%s: edits change nothing" % path)
        if before[path] is not None and len(new.encode()) < 0.7 * len(old.encode()):
            raise EditError("%s would shrink from %d to %d bytes; refusing" % (path, len(old.encode()), len(new.encode())))
        banned = BANNED_ALL + (BANNED_CONTENT if path == "content-scripts/content.js" else [])
        if path.endswith((".js", ".html")):
            for tok in banned:
                if new.count(tok) > old.count(tok):
                    raise EditError("%s: edit adds banned %r" % (path, tok))

    for path, new in after.items():
        p = os.path.join(root, path)
        os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
        with open(p, "wb") as fh:
            fh.write(new.encode("utf-8"))

    def restore():
        for path, old in before.items():
            p = os.path.join(root, path)
            if old is None:
                if os.path.exists(p):
                    os.remove(p)
            else:
                with open(p, "wb") as fh:
                    fh.write(old.encode("utf-8"))

    if run_gates:
        for path in after:
            if path.endswith(".js"):
                r = _run(["node", "--check", path], root)
                if r.returncode != 0:
                    restore()
                    raise EditError("node --check failed on %s: %s" % (path, (r.stderr or r.stdout)[-400:]))
        t = _tests(root)
        if t is not None and (t["code"] != 0 or t["fail"] != 0 or t["pass"] <= 0):
            restore()
            raise EditError("tests failed after edits (pass %d, fail %d):\n%s" % (t["pass"], t["fail"], t["tail"][-800:]))

    return [{"filename": p, "content": after[p], "description": "; ".join(whys[p])[:72]} for p in after]


def apply_text(text, root=".", run_gates=True):
    return apply_edits(parse(text), root=root, run_gates=run_gates)
