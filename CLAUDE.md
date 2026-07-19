# SkipStream — Claude Code Agent Guide

Plain JS browser extension (Firefox MV2 + Chrome MV3). No build step. Zero dependencies.

## Architecture

```
background.js          Service worker / background page. ALL network calls live here.
content-scripts/       Injected into streaming sites. NO fetch(), NO localStorage.
  content.js
popup.html / popup.js  Toolbar popup.
options.html / options.js  Settings page.
manifest.json          Firefox MV2.
manifest-chrome.json   Chrome MV3.
supabase_setup.sql     One-time DDL. Safe to re-run (fully idempotent).
scripts/amo-update.js  AMO release script (Node, no deps).
updates.json           Firefox auto-update manifest.
```

## Hard Rules (CI enforces all of these)

| Rule | Why |
|------|-----|
| No `fetch()` in `content-scripts/` | CSP + privilege separation |
| No `localStorage` in `content-scripts/` | Use `browser.storage.local` via message |
| No `innerHTML` anywhere | XSS prevention |
| No `console.log` anywhere | Use `console.warn` for diagnostics |
| `userId` = `crypto.randomUUID()` per install | Stored in `skipstream_install_id` |
| SPA nav: `checkUrlChange()` in timeupdate handler | Resets segments on URL change |
| Video detection: width ≥ 25%, height ≥ 20%, aspect ratio 1.2–3.0 | Avoids thumbnails |

## Message Protocol (content → background)

All content script → network calls go through `browser.runtime.sendMessage`:

```js
// Save playback position
{ type: 'SUPABASE_UPSERT', body: { user_id, media_id, playback_time, ... } }

// Fetch skip segments
{ type: 'FETCH_SEGMENTS', imdbId, season, episode }

// Get user ID
{ type: 'GET_USER_ID' }  // → { userId }
```

## Supabase Setup

Users run `supabase_setup.sql` once in their project SQL Editor.

To manually apply: `psql "$SUPABASE_DB_URL" -f supabase_setup.sql`

## Release Process

```bash
# 1. Bump versions (both manifests must match)
#    manifest.json, manifest-chrome.json, popup.js header comment

# 2. Add CHANGELOG.md entry: ## [X.Y.Z] - YYYY-MM-DD

# 3. Tag and push
git tag vX.Y.Z && git push origin vX.Y.Z
```

Workflow `Build & Release` then:
- Builds Firefox + Chrome ZIPs
- Creates GitHub Release with CHANGELOG notes as body
- Commits updated `updates.json`
- Triggers `Submit to AMO` and `Submit to Chrome Web Store`

## AI Automation

## Agent Fleet

Five AI agents run on every event. All prefer Claude (`claude-sonnet-4-6`) when `ANTHROPIC_API_KEY` set, else fallback Gemini.

| Agent | Trigger | Does |
|-------|---------|------|
| `ai-issue-triage` | Issue opened | Labels, priority, complexity, posts analysis comment |
| `ai-fix-pr` | `ai-fix` label added, or slash command on issue | Opens fix PR |
| `ai-pr-review` | PR opened/updated | Posts code review, checks arch rules |
| `ai-weekly-audit` | Monday 08:00 UTC | Scans codebase, opens issues for findings |
| `sweep` | Issue title starts `sweep:` or comment starts `sweep:` | Implements task, opens PR |

### Slash Commands (comment on issue or PR)

| Command | Effect |
|---------|--------|
| `/ai-fix [optional hint]` | AI writes fix, opens PR |
| `/ai-review <code or question>` | AI reviews and responds inline |
| `/ai-explain <target>` | AI explains code/concept |
| `/ai-task <instruction>` | AI does arbitrary task - code or analysis |
| `sweep: <task description>` | Sweep agent implements task end-to-end |

### Workflow (you as master)

1. Issue opened -> triage agent auto-labels + suggests if automatable
2. If automatable: add `ai-fix` label OR comment `/ai-fix` -> PR opens
3. Review PR, CI must pass, test in Firefox, merge
4. Weekly audit opens issues for anything found, high-severity ones auto-labeled `ai-fix`
5. For new features: open issue with title `sweep: add X` -> Sweep implements, opens PR



`GEMINI_API_KEY` (set) — used by `ai-issue-triage` and `ai-fix-pr` workflows.

To switch to Claude: add `ANTHROPIC_API_KEY` secret in repo settings. Workflows
will prefer Claude (`claude-sonnet-4-6`) over Gemini when the key is present.

## Secrets Required

| Secret | Used by | Where to get |
|--------|---------|--------------|
| `AMO_API_KEY` | amo-submit.yml | addons.mozilla.org/developers/addon/api/key/ |
| `AMO_API_SECRET` | amo-submit.yml | same page |
| `GEMINI_API_KEY` | ai-*.yml | aistudio.google.com |
| `ANTHROPIC_API_KEY` | ai-*.yml (preferred) | console.anthropic.com |
| `CWS_EXTENSION_ID` | cws-submit.yml | Chrome Developer Dashboard |
| `CWS_CLIENT_ID` | cws-submit.yml | Google Cloud Console OAuth |
| `CWS_CLIENT_SECRET` | cws-submit.yml | same |
| `CWS_REFRESH_TOKEN` | cws-submit.yml | OAuth flow |
| `SUPABASE_DB_URL` | supabase-validate.yml | Supabase → Settings → Database → URI |

## Common Tasks

**Add a new streaming site:**
- Add domain to `content_scripts.matches` in both manifests
- Add host permission in `manifest-chrome.json`
- Add site detection in `content.js` `getSiteKey()` / `resolveShowInfo()`

**Add a new skip segment source:**
- Add provider function in `background.js` (follow `providerIntroDB` / `providerAnimeSkip` pattern)
- Wire into `FETCH_SEGMENTS` handler

**Debug in Firefox:**
`about:debugging` → This Firefox → Load Temporary Add-on → select `manifest.json`

**Debug in Chrome:**
`chrome://extensions` → Developer mode → Load unpacked → select repo folder (with `manifest-chrome.json` renamed to `manifest.json`)
---

# UI SYSTEM (OpenSkip)

## UI ROLE

The UI is responsible for:
- popup.html
- options.html
- popup.css
- options.css
- minimal UI inside content scripts

UI MUST NOT interfere with extension logic.

---

## DESIGN GOAL

The UI must feel:
- native to the browser
- lightweight and fast
- consistent across popup + options
- structured, not decorative
- accessible by default

NOT:
- flashy
- animated-heavy
- framework-driven
- design-tool aesthetic

---

## MATERIAL 3 EXPRESSIVE (CONSTRAINED USE)

Material 3 Expressive is used ONLY as inspiration.

DO NOT:
- import Material libraries
- use Android-specific behavior
- assume dynamic wallpaper / Monet system

ONLY USE:
- design principles (spacing, hierarchy, shape, tone)
- semantic color roles
- responsive layout ideas

---

## THEMING MODEL

Supported themes:
- light
- dark
- system (prefers-color-scheme)

Rules:
- theme toggle in popup is source of truth
- options page must follow stored theme
- no divergence between popup and options

NO:
- OS wallpaper color extraction
- external theme systems

---

## DESIGN TOKENS (MANDATORY)

All UI values must use tokens:

- spacing scale (no random px)
- typography scale
- radius scale
- color roles
- motion tokens

If a value is missing:
- extend token system
- do NOT introduce one-off values

---

## RESPONSIVENESS RULES

- Popup must adapt to width changes
- Options page must scale cleanly across screen sizes
- Use flex/grid only
- Avoid fixed layouts

---

## TYPOGRAPHY RULES

- rem + clamp() preferred
- consistent type hierarchy:
  title → section → body → label → meta
- no arbitrary font-size values

---

## ACCESSIBILITY RULES

Mandatory:
- semantic HTML (button, label, heading)
- keyboard navigation support
- visible focus states
- WCAG AA contrast
- reduced motion support

Avoid:
- div-based interactive controls unless necessary
- color-only state indicators

---

## CROSS-BROWSER RULES

Must behave identically in:
- Chrome
- Firefox
- Edge
- Brave

No browser-specific UI differences.

---

## COMPONENT CONSISTENCY RULE

Popup and Options must:
- share the same visual language
- differ only in layout density
- not have separate design systems

---

## FORBIDDEN PRACTICES (UI)

- UI redesign without instruction
- introducing frameworks (React/Vue/etc)
- introducing build tools
- duplicating components across popup/options
- hardcoded spacing or colors
- changing extension logic during UI work

---

## UI WORKFLOW RULE

Before any UI change:

1. Inspect existing pattern
2. Reuse if possible
3. Modify minimally
4. Avoid behavior changes
5. Keep diff small

After change:

- verify no layout regressions
- verify theme consistency
- verify accessibility

---

## FINAL UI PRINCIPLE

If unsure:

→ choose consistency  
→ choose simplicity  
→ preserve behavior  
→ improve only measurable UX issues