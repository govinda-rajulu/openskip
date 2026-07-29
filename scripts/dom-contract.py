#!/usr/bin/env python3
"""CI guard: every element id a script hard-dereferences must exist in its HTML.

A lookup counts as SAFE when, on the same line, the id is:
  - wrapped in a truthiness check      if ($('x')) $('x').value = ...
  - optionally chained                 $('x')?.addEventListener(...)
  - used as a ternary test             $('x') ? $('x').checked : false
  - assigned first, then checked       const el = $('x'); if (el) ...

Anything else that dereferences a missing id will throw at load and kill
every statement after it. That is the bug this guard exists to catch.
"""
import re
import sys
from pathlib import Path

PAIRS = [("popup.js", "popup.html"), ("options.js", "options.html")]

ID_RE = re.compile(r"""id=["']([^"']+)["']""")

# $('x').foo  or  document.getElementById('x').foo   (no ?. between)
HARD_RE = re.compile(
    r"""(?:\$|document\.getElementById)\(\s*["']([A-Za-z0-9_-]+)["']\s*\)\s*\."""
)

# $('x') followed by ) or ? or && or || or ; -> the id is being tested, not used
GUARD_RE = re.compile(
    r"""(?:\$|document\.getElementById)\(\s*["']([A-Za-z0-9_-]+)["']\s*\)\s*(?:\)|\?|&&|\|\||;|,)"""
)


def violations(js_name, html_name):
    js_lines = Path(js_name).read_text(encoding="utf-8").splitlines()
    ids = set(ID_RE.findall(Path(html_name).read_text(encoding="utf-8")))

    found = []
    for lineno, line in enumerate(js_lines, start=1):
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        guarded = set(GUARD_RE.findall(line))
        for ref in HARD_RE.findall(line):
            if ref in guarded or ref in ids:
                continue
            found.append(f"{js_name}:{lineno} dereferences #{ref}, absent from {html_name}")
    return found


def main():
    failures = []
    for js_name, html_name in PAIRS:
        failures.extend(violations(js_name, html_name))

    if failures:
        print("DOM contract violations:")
        for line in failures:
            print("  -", line)
        print()
        print("Either add the element to the HTML, or guard the lookup:")
        print("  const el = $('id'); if (el) el.textContent = ...")
        return 1

    print("DOM contract OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
