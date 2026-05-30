# AGENTS

## Purpose
This file helps AI coding agents understand the OpenSkip repository quickly and use the correct source tree, build commands, and conventions.

## Primary project layout
- `src/` is the main extension source tree in this repository.
- `src/content/index.ts` is the WXT extension manifest/config entrypoint.
- `src/lib/supabase.ts` creates the Supabase client used by extension logic.
- `dev/entrypoints/` contains helper runtime entrypoints and example content-script integration.
- `src/providers/`, `src/sync/`, and `src/utils/` are the main domain folders.

## Important build and runtime notes
- The repository uses `wxt` for browser extension development.
- There is a nested `openskip/` subproject with its own `package.json` and `wxt` build scripts.
- Prefer the root `src/` extension code for feature and bug-fix work.
- Use the nested `openskip/` package only when updating build/release tooling or inspecting the alternate packaged extension.

## Known commands
Most runnable extension commands appear in `openskip/package.json`:
- `cd openskip && npm install`
- `cd openskip && npm run dev`
- `cd openskip && npm run build`
- `cd openskip && npm run build:firefox`
- `cd openskip && npm run zip`
- `cd openskip && npm run zip:firefox`
- `cd openskip && npm run compile`

## What to watch for
- There is no existing `.github/copilot-instructions.md` or `AGENTS.md`; this file fills that gap.
- The repo contains two Supabase client files with hard-coded credentials:
  - `src/lib/supabase.ts`
  - `openskip/lib/supabase.ts`
  Verify which one is in use before editing credentials.
- The extension uses a Supabase table named `playback_states` for synced playback resume data.
- Runtime issues often stem from the public anon key requiring open Row Level Security (RLS) policies on `playback_states`.
- `src/content/index.ts` targets `firefox-mv3`.

## Reference documentation
- [README.md](README.md)
- [src/providers/README.md](src/providers/README.md)
- [src/sync/README.md](src/sync/README.md)
