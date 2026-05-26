# Contributing to SkipStream

Thanks for your interest in contributing! This is a plain JavaScript Firefox extension — no build tools, no npm, no framework. If you can edit a `.js` file, you can contribute.

## Setup

1. Fork and clone the repo
2. Open Firefox → `about:debugging` → **This Firefox** → **Load Temporary Add-on**
3. Select `manifest.json` from your cloned folder
4. Edit files — changes take effect after clicking **Reload** on the debugging page

That's it. No `npm install`, no build step.

## Code style

- Plain ES2020+ JavaScript, no TypeScript
- No external dependencies
- `const`/`let` only, no `var`
- `async/await` over raw Promise chains where readable
- `console.warn` for diagnostic paths only — no `console.log`
- No `innerHTML` — use DOM API (`createElement`, `textContent`, `replaceChildren`)
- API keys must never appear in `content-scripts/content.js` — route all external calls through `background.js`

## Architecture rules (don't break these)

| Rule | Reason |
|------|--------|
| No `localStorage` in content script | Breaks Private Browsing; use `browser.storage.local` |
| User ID derived in background only | Deterministic SHA-256 hash of anon key — must not be random |
| All fetch() calls in background.js | Keys off page context; bypasses site CSPs |
| `segmentCache.clear()` on SPA nav | Prevents stale episode data after route change |

## What to work on

Check the [issues](https://github.com/govinda-rajulu/openskip/issues) tab. Good first issues are tagged `good first issue`.

High-value areas:
- Improving show detection for specific streaming sites
- Better error messages in the Settings page
- Retry/backoff improvements for flaky API calls
- Unit tests (there are currently none)

## Pull requests

- One logical change per PR
- Test manually on at least one streaming site before submitting
- Update `CHANGELOG.md` under an `[Unreleased]` section
- The CI workflow will check syntax, innerHTML, console.log, and manifest validity automatically

## Questions

Open a [discussion](https://github.com/govinda-rajulu/openskip/discussions) or file an issue — happy to help.
