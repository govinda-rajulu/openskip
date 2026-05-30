# AMO Automation Setup

SkipStream uses a GitHub Actions workflow (`amo-submit.yml`) to automatically submit new versions and update the listing on addons.mozilla.org after every tagged release.

## One-time setup

### 1. Get AMO API credentials

1. Log in to [addons.mozilla.org](https://addons.mozilla.org) as the add-on author
2. Go to **[API Credentials](https://addons.mozilla.org/en-US/developers/addon/api/key/)**
3. Click **Generate new credentials**
4. Copy the **JWT issuer (key)** and **JWT secret** — you will not see the secret again

### 2. Add secrets to the GitHub repository

Go to the repo → **Settings → Secrets and variables → Actions** and add:

| Secret name | Value |
|-------------|-------|
| `AMO_API_KEY` | JWT issuer string, e.g. `user:12345:67` |
| `AMO_API_SECRET` | JWT secret (long random string) |

### 3. Verify the add-on slug

The workflow uses `skipstream` as the slug. If your AMO URL differs, update `AMO_ADDON_SLUG` in `amo-submit.yml`.

---

## How it works

```
push tag v1.x.x
    └─► validate.yml       — lint + manifest check
    └─► release.yml        — build ZIP → GitHub Release + artifact
            └─► amo-submit.yml  (triggers on release.yml success)
                    ├─ download ZIP artifact
                    ├─ POST /api/v5/addons/upload/            upload + validate
                    ├─ poll until valid (up to 10 min)
                    ├─ POST /api/v5/addons/addon/skipstream/versions/   create version
                    └─ PATCH /api/v5/addons/addon/skipstream/           update listing
```

Release notes are extracted automatically from `CHANGELOG.md` for the current version.

Listing metadata (description, categories, tags) lives in `scripts/amo-update.js` → `buildDescription()`. Edit that function to change what appears on the AMO listing page.

---

## Manual trigger

Actions tab → **Submit to AMO** → **Run workflow**. A **Dry run** option prints request bodies without writing to AMO.

---

## What is updated automatically

| Field | Source |
|-------|--------|
| Name, Summary, Description | `buildDescription()` in `scripts/amo-update.js` |
| Homepage, Support URL | Hardcoded in script |
| Categories, Tags | Hardcoded in script |
| Release notes | Extracted from `CHANGELOG.md` |

## What is NOT automated

- Add-on icon and screenshots — upload manually in Developer Hub
- Privacy policy / EULA — update manually if needed

---

## Troubleshooting

**`AMO_API_KEY and AMO_API_SECRET must be set`** → secrets not configured; follow step 2.

**HTTP 401** → JWT secret is wrong; regenerate credentials on AMO.

**HTTP 404 on version create** → slug doesn't exist on AMO yet; upload one version manually first to claim the slug, then the workflow handles all subsequent ones.

**Validation failed** → ZIP has an error; check the error messages in the workflow log.

**`workflow_run` didn't fire** → both workflows must be on the default branch; use the manual trigger for branch testing.
