# Leon Gold on real hosting

- The owner writes in Persian and uses an iPhone. Reply in Persian.
- This folder only builds and ships; the code lives in `../leon-gold-site` and `../leon-gold`. It never edits them: the site is built in its own git worktree (`.build/site`, at the site's local `main`).
- Ask the owner before buying anything, changing DNS, or touching the live Liara app `leon-gold` (the sync server and the ledger's real data). Ledger data moves only with the owner (backup first, then sync).

## The layout on the owner's domain

| Path | What | From |
|---|---|---|
| `/` `/museum/` | public site | static export of the site |
| `/panel/` `/hesab/` | CRM panel, «حساب من» | same export; they call the sync server |
| `/daftar/` | the ledger phone app | `../leon-gold/offline/build.ps1 -Site dist/daftar -SyncUrl …` |

- Static files go to a NEW Liara static app `leon-gold-web`. The API stays on `leon-gold` at `https://api.leongold.net`; its `ALLOWED_ORIGINS` lists `https://leon-gold.github.io,https://leongold.net,https://www.leongold.net` by default. When the static app takes `leongold.net` and `www`, remove those two from the `leon-gold` app's domains first.

## Scripts (Git Bash)

- `bash build.sh <domain> [sync-url]`: worktree → `npm ci` when the lock changed → swaps in `next.config.export.ts` (imports the site's own config as `next.config.site.ts`, adds `output: export` at the root) with `SITE_URL` and `NEXT_PUBLIC_SYNC_URL` → `dist/`, ledger into `dist/daftar`, Liara files, then `test.mjs`.
- `node test.mjs dist <domain> [--serve 3200]`: required pages, no leftover `/leon-gold-app/site` links, og:image on the domain, every root link resolves. `--serve` serves `dist` like the host, for `../leon-gold-site/scripts/shot.ps1`.
- `bash deploy.sh`: re-runs the test and uploads `dist/` with the Liara CLI (`LIARA_TOKEN` in env or `.env`, git-ignored).
- `node redirects.mjs <domain>`: forwarding pages for the old preview (`leon-gold-app/site/…` → domain, keeps `?` and `#`) in `.build/redirect-site`. The ledger root on GitHub Pages is never forwarded.
- `liara/liara_nginx.conf`: cache rules only. Unverified on Liara's static platform: if the first deploy rejects it, delete it from `liara/`.

## State

- 2026-10-28: rebuilt against site main ce1a656 (vitrin pages, hesab #owner, idle GSAP, leaf.webp): 149 files, all checks pass; test now also checks assets named in JS/CSS. Server `SITE` (server.mjs:129) is still the GitHub address: move-day step 3. Waiting for the owner: domain, Liara static app, token.
- No GitHub repo yet (`gh` is not installed here); local git only.
