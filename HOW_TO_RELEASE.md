# How to Release a New Version

No laptop needed. Do everything from GitHub in your browser.

---

## Step 1 — Make your changes

Go to your repo → press `.` to open the browser editor (github.dev)  
Edit files → commit directly from the editor  
CI runs automatically and checks everything

---

## Step 2 — Bump the version

Edit `manifest.json` — change `"version": "1.1.0"` to your new version  
Edit `CHANGELOG.md` — add a new section at the top describing what changed  
Commit both files

---

## Step 3 — Create a tag (this triggers the release)

Go to your repo on GitHub  
Click **Releases** (right sidebar) → **Draft a new release**  
Click **Choose a tag** → type `v1.2.0` (or whatever your version is) → **Create new tag**  
Fill in the release title and notes → click **Publish release**

**That's it.** GitHub Actions will automatically:
- Validate all the code
- Check the tag matches the manifest version
- Build the ZIP
- Attach it to the release

You'll get the ZIP on the release page within ~2 minutes.

---

## Step 4 — Submit to AMO

Download the ZIP from the release page  
Go to addons.mozilla.org/developers → your extension → **Upload New Version**  
Upload the ZIP → fill in release notes → submit

---

## What each workflow does

| Workflow | Triggers | What it does |
|----------|----------|-------------|
| `validate.yml` | Every push to main | Syntax, manifest, security checks, builds ZIP artifact |
| `pr-check.yml` | Every pull request | Same checks + posts review checklist comment |
| `auto-label.yml` | Every new issue | Labels issues automatically by keyword |
| `release.yml` | Every `v*` tag push | Validates, builds ZIP, uploads to GitHub Release |
| Dependabot | Weekly (Monday) | Keeps GitHub Actions versions up to date |

---

## Filing issues for AI help (future Copilot agent)

Write detailed issues — the more specific, the better the AI can handle it:

**Good issue:**
> **Title:** Skip button doesn't appear on Crunchyroll  
> **Body:** On crunchyroll.com/watch/xxxxx, the skip intro button never appears even though IntroDB has data for this show. The show is "My Hero Academia" S1E1 (tt3801398). Console shows: `[SkipStream] Could not identify episode`

**Bad issue:**
> skip not working

