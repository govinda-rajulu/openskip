# Settled: not findings

Each line: a piece of text that appears in the quoted code line, then why a finding on it
is not new. The desk drops a finding whose quote contains the text. Add a line only by a
reviewed PR, with the date and the issue or lesson that settled it.

- `function isValidSupabaseUrl(url)` | anchored single-label regex; investigated 15 Aug 2026 (issues 46, 50, 55)
- `const uuid = crypto.randomUUID();` | the per-install random id is deliberate; deriving it from the anon key would allow row enumeration (issue 45)
- `"persistent": false` | Firefox stays MV2 with an event page; decided, Mozilla supports MV2 with no end date
- `strict_min_version` | Firefox 140 minimum is decided (GEMINI.md history, 15 Aug 2026)
