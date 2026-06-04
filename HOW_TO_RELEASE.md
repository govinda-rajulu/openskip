# How to Release a New Version

No laptop needed. Do everything from GitHub in your browser.

---

## Step 1 - Make your changes

Go to your repo → press `.` to open the browser editor (github.dev)  
Edit files → commit directly from the editor  
CI runs automatically and checks everything

---

## Step 2 - Bump the version

Edit `manifest.json` - change `"version"` to your new version  
Edit `manifest-chrome.json` - **must match `manifest.json` exactly** (CI fails if mismatched)  
Edit `CHANGELOG.md` - add a new `## [X.Y.Z]` section at the top  
Edit `popup.js` - update the version header comment on line 1  
Edit `README.md` - update the version badge near the top  
Commit all five files

---

## Step 3 - Create a tag (this triggers the release)

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

## Step 4 - Submit to AMO

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

Write detailed issues - the more specific, the better the AI can handle it:

**Good issue:**
> **Title:** Skip button doesn't appear on Crunchyroll  
> **Body:** On crunchyroll.com/watch/xxxxx, the skip intro button never appears even though IntroDB has data for this show. The show is "My Hero Academia" S1E1 (tt3801398). Console shows: `[SkipStream] Could not identify episode`

**Bad issue:**
> skip not working


---

## Using the AI agent (after Gemini key is added)

### Step 1 - Get a free Gemini API key
1. Go to **aistudio.google.com** → sign in with Google
2. Click **Get API key** → **Create API key**
3. Copy the key

### Step 2 - Add it to your repo
1. Go to your repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `GEMINI_API_KEY` → paste your key → Save

### Step 3 - The full AI workflow
```
You open an issue (from phone, describe bug or feature)
         ↓
AI reads it, posts analysis: type / priority / component / suggestion
         ↓
If it looks fixable: add label "ai-fix"
         ↓
AI reads full codebase, writes fix, opens PR automatically
         ↓
CI runs on the PR (syntax, security, manifest checks)
         ↓
You review the PR - read the diff, check CI is green
         ↓
Merge → done
```

### Workflows summary (all 6 active)

| Workflow | Triggers | What it does |
|----------|----------|-------------|
| `validate.yml` | Every push | Syntax, manifest, security, builds ZIP |
| `pr-check.yml` | Every PR | Same checks + posts review checklist |
| `auto-label.yml` | New issue | Labels by keyword automatically |
| `release.yml` | `v*` tag push | Validates, builds ZIP, attaches to release |
| `codeql.yml` | Push/PR/weekly | Security vulnerability scanning |
| `ai-issue-triage.yml` | New issue | Gemini analyzes and comments |
| `ai-fix-pr.yml` | `ai-fix` label added | Gemini writes fix, opens PR |
| Dependabot | Weekly Monday | Keeps action versions current |

