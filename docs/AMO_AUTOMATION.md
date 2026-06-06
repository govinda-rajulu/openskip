# AMO Automation

Automated submission to Firefox Add-ons (AMO) runs on every release via `amo-submit.yml`.

## How it works

1. `release.yml` builds and uploads `skipstream-X.Y.Z-firefox.zip` to the GitHub Release
2. `amo-submit.yml` triggers on `workflow_run` after `release.yml` completes
3. `scripts/amo-update.js` handles the full AMO API flow:
   - Uploads the ZIP to AMO
   - Polls until validation passes
   - Creates a new version on the listing
   - Updates listing metadata (name, summary, description, categories, tags)

## Secrets required

| Secret | Where to get |
|--------|--------------|
| `AMO_API_KEY` | AMO Developer Hub - API credentials |
| `AMO_API_SECRET` | AMO Developer Hub - API credentials |

## Manual trigger

Go to **Actions** - **Submit & update AMO listing** - **Run workflow**.
Set `dry_run: true` to test without writing to AMO.

## Valid AMO tags

Only `privacy` is a valid tag. The `productivity` tag is not accepted by the AMO API (returns HTTP 400).

## Listing metadata

Managed in `scripts/amo-update.js` in the `buildDescription()` function and the `listingBody` object.
Edit those to update the AMO listing description and categories.

## Android update feed

`updates.json` at the repo root is served via `raw.githubusercontent.com` and referenced in
`manifest.json` as `update_url`. Firefox for Android checks this URL to prompt users to update.
Update `updates.json` as part of every version bump (before pushing the tag).
