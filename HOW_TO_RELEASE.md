# How to Release

## Steps

**1. Make your changes** - edit files directly on GitHub (press `.` to open github.dev)

**2. Bump the version** - update these 7 files to `X.Y.Z` (or run the Version Bump workflow, which does all 7):
- `manifest.json` - `"version"` field
- `manifest-chrome.json` - must match exactly
- `popup.js` - header comment on line 1
- `popup.css` - header comment on line 1
- `README.md` - version badge
- `CHANGELOG.md` - add `## [X.Y.Z]` at the top
- `updates.json` - bump `version` and download URL to match

**3. Commit all 7 files** in one commit. Lint & Validate fails if `updates.json` does not end with the new version

**4. Push the tag** (this publishes: CI uploads the ZIP to AMO by itself):
```
git tag vX.Y.Z
git push origin vX.Y.Z
```

Or on GitHub: Releases - Draft a new release - create tag `vX.Y.Z`

## What CI does automatically

1. Validates JS syntax and security checks
2. Verifies tag matches manifest version
3. Checks `manifest-chrome.json` version matches
4. Checks `CHANGELOG.md` has the entry
5. Builds and uploads `skipstream-X.Y.Z-firefox.zip` to the release
6. Submits the ZIP to AMO and updates the listing

## If CI fails

- **Tag version mismatch** - bump all 7 files to match the tag, delete and recreate the tag
- **Security check** - remove `innerHTML`, `console.log`, or `localStorage` from content scripts
- **AMO 400** - check `tags` array in `scripts/amo-update.js` - only `privacy` is a valid tag
