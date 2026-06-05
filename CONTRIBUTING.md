# Contributing

Plain JavaScript Firefox extension - no build tools, no npm, no framework.

## Setup

1. Fork and clone the repo
2. Firefox: `about:debugging` - **This Firefox** - **Load Temporary Add-on** - select `manifest.json`
3. Edit files - click **Reload** on the debugging page to apply changes

No `npm install`. No build step.

## Rules

- Vanilla ES2020+ JS only - no TypeScript, no external dependencies
- No `innerHTML` - use DOM API
- No `console.log` - use `console.warn` only
- No `localStorage` in `content-scripts/` - use `browser.storage.local`
- Bump version in `manifest.json`, `manifest-chrome.json`, `popup.js`, `README.md`, and `CHANGELOG.md` together

## Pull requests

- Keep PRs focused - one thing at a time
- Test in Firefox before opening a PR
- Check [issues](https://github.com/govinda-rajulu/openskip/issues) first - good first issues are tagged

## Questions

Open a [discussion](https://github.com/govinda-rajulu/openskip/discussions) or file an issue.
