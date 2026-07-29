#!/usr/bin/env python3
"""CI guard: every element id a script hard-dereferences must exist in its HTML."""
import re
import sys
from pathlib import Path

PAIRS = [("popup.js", "popup.html"), ("options.js", "options.html")]
ID_RE = re.compile(r"""id=["']([^"']+)["']""")
HARD_RE = re.compile(
    r"""(?:\$|document\.getElementById)\(\s*["']([A-Za-z0-9_-]+)["']\s*\)\s*\."""
)


def main():
    failures = []
    for js_name, html_name in PAIRS:
        js = Path(js_name).read_text(encoding="utf-8")
        html = Path(html_name).read_text(encoding="utf-8")
        ids = set(ID_RE.findall(html))
        for ref in sorted(set(HARD_RE.findall(js))):
            if ref not in ids:
                failures.append(
                    f"{js_name} hard-dereferences #{ref}, absent from {html_name}"
                )
    if failures:
        print("DOM contract violations:")
        for line in failures:
            print("  -", line)
        return 1
    print("DOM contract OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
