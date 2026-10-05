# TEST-WRITER
Load when: writing or reviewing a test for a fix.
Files: (none: workers read tests/harness.mjs and the files under test)

- A new test must fail on the old code. Run it on main first and record that it failed.
- Use `tests/harness.mjs` (`loadBackground`, `contentFns`, `extractFunction`). No new
  dependencies; `node --test --test-reporter=tap tests/*.test.mjs`.
- Fake browser timers must check `this` (strictTimers in v113c.test.mjs).
- Compare objects made inside a vm context as JSON, not with deepEqual (cross-realm).
- A fake fetch must fail like the real service does (status codes, empty bodies, 406 quota).
- Read the version from manifest.json; never hard-code it.
