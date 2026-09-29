<!-- archived from assistant skill 'Release and AMO', last updated 2026-09-05 18:00 (Asia/Calcutta), exported 2026-09-29 -->
<!-- summary: Load before cutting a SkipStream release, editing the manifest or version, submitting to Mozilla Add-ons, or running the weekly audit. -->

# RELEASE-AND-AMO (sub-skill of SKIPSTREAM-RELEASE-WORK)

## Release mechanics

A tag triggers `release.yml`: builds both ZIPs, cuts the Release, fires amo-submit and cws-submit. `store-version-check.yml` is manual-dispatch only now, so the tag is the real gate.

**Before tagging, build an unpacked copy and click through it.** The GitHub "download as zip" loads fine for casual testing since `manifest.json` is at the root, but it includes `scripts/`, `.github/` and docs that never ship, so it cannot catch "file missing from a workflow's copy list" (which shipped broken twice). For a pre-release check, build the real ZIP.

**Version bump touches 7 files:** `manifest.json`, `manifest-chrome.json`, `popup.js` line 1, `popup.css` line 1, `README.md` badge + release link, `CHANGELOG.md`, `updates.json`. `version-bump.yml` automates it (workflow_dispatch, opens a PR, does **not** tag) and **has still never run**.

The **`## [X.Y.Z]`** CHANGELOG heading is load-bearing. `extractChangelogNotes()` in `scripts/amo-update.js` pushes the body verbatim as AMO release notes, so write it for their. The listing description comes from `buildDescription()` and is PATCHed by CI: listing copy is a code edit.

**updates.json**: last element must match the manifest, so append, never prepend.

AMO requires `browser_specific_settings.gecko.data_collection_permissions`; declared `{"required": ["none"]}`. **This makes crash reporting or any telemetry a policy violation.** Android updates cannot be forced; AMO owns the channel and polls roughly daily.

**Minification is a trap.** Mozilla requires sources plus build instructions for minified code. A `.zip.gz` is not installable by either store.

## The AMO listing is the real growth blocker

`icon_url` points at Mozilla's default grey placeholder and `previews` is empty. **All four icons are inside the signed XPI**, so this is purely a developer-hub upload. Ten minutes, no code, biggest single lever available.

Second blocker was **requiring an IntroDB key before anything works**. `00c86f3` fixed the copy. What remains is making the first-run flow itself not look gated. Note Govind disagrees with one part: he wants the IntroDB key **included in backups** and used wherever configured, not merely labelled optional.

The listing names Apple TV+ among supported platforms. `getSiteName()` maps `appletv.apple.com`, but `NATIVE_SKIP_SITES` does not, so it gets the label matcher rather than a built selector. Do not describe it as fully supported.

If i18n ever happens, use `_locales/messages.json` + `browser.i18n.getMessage`. No npm, no build step. Never i18next.

## The weekly audit, corrected 15 Aug

`ai-weekly-audit.yml` (8,380 bytes) runs `cron: '0 8 * * 1'` and files one summary issue per run plus a separate issue per high-severity automatable finding. That fan-out is why one run produced three issues.

**Overturning an earlier entry:** its prompt's "Architecture rules" list is exactly four lines and all four match `validate.yml`. The two stale rules I once claimed were in that file are not. **Do not send him to edit that workflow.**

The real weaknesses are structural: it feeds only the first 8,000 chars of each file, has no dedupe against existing issues, and auto-files per-finding issues. If false findings keep arriving, cap the per-finding creation.

**Audit findings proven false**: MV2 deprecation, retry-on-4xx, `applyThemeFromSeed` (already guarded), the `Math.cbrt` polyfill. **#45 was actively harmful**: deriving userId from the anon key would let anyone holding it compute every row id; the random UUID at `skipstream_install_id` is the only thing preventing enumeration under permissive RLS. Only #46 was real, and its fix was one regex.
