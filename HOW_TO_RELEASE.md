# How to Release

Releases are made by a release packet (a script the owner runs), which opens a PR. These
are the rules it follows; AGENTS.md "Versions and releases" is the same list.

## Steps

**1. Bump the version** in these 7 places to `X.Y.Z` (there is no bump workflow; it was retired on 5 Oct 2026):
- `manifest.json` - `"version"` field
- `manifest-chrome.json` - must match exactly
- `popup.js` - header comment on line 1: `/* SkipStream - popup vX.Y.Z */`
- `popup.css` - header comment on line 1
- `README.md` - version badge and release link
- `CHANGELOG.md` - add `## [X.Y.Z] - YYYY-MM-DD` at the top
- `updates.json` - append the new version and its download URL (Lint & Validate fails if the last entry is not the new version)

**2. Merge the PR** after every check passes, CodeQL included.

**3. Push the tag** (this publishes: CI uploads the ZIP to AMO by itself):
```
git tag vX.Y.Z
git push origin vX.Y.Z
```

## What CI does automatically

1. Validates JS syntax and security checks
2. Verifies the tag matches the manifest version and manifest-chrome.json matches
3. Checks `CHANGELOG.md` has the entry
4. Builds `skipstream-X.Y.Z-firefox.zip` and `skipstream-X.Y.Z-chrome.zip` and attaches both to the GitHub release
5. Submits the Firefox ZIP to AMO and updates the listing (Submit to AMO)

Chrome Web Store: not published (no account); `Submit to Chrome Web Store` is manual only.
Edge Add-ons: upload the Chrome ZIP by hand in Partner Center.

## If CI fails

- **Tag version mismatch** - bump all 7 places to match the tag, delete and recreate the tag
- **Security check** - remove `innerHTML`, `console.log`, or `localStorage`/`fetch()` from content scripts
- **AMO 400** - check `tags` array in `scripts/amo-update.js` - only `privacy` is a valid tag
