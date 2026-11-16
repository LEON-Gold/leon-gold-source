#!/bin/bash
# Builds the whole Leon Gold web root for the real domain into dist/:
#   /         the public site (static export of ../leon-gold-site, branch main)
#   /panel/   the CRM panel, /hesab/ «حساب من» (both talk to the sync server)
#   /daftar/  the ledger phone app (../leon-gold, offline/build.ps1)
# It never touches the site's or the ledger's working folders: the site is built in its own git worktree
# under .build/site, and the ledger build writes only into dist/daftar (plus its own ignored offline file).
# Usage: bash build.sh <domain> [sync-server]    e.g. bash build.sh leongold.ir
set -e
DOMAIN="${1:?usage: bash build.sh <domain> [sync-server]}"
SYNC="${2:-https://api.leongold.net}"
export PATH="/c/Program Files/nodejs:$PATH"
cd "$(dirname "$0")"
HERE="$(pwd)"
SITE_REPO="../leon-gold-site"
WT=".build/site"

# 1. a clean copy of the site at its current main
if [ ! -d "$WT" ]; then
  git -C "$SITE_REPO" worktree add --detach "$HERE/$WT" main >/dev/null
else
  git -C "$WT" checkout -q -f --detach main
  git -C "$WT" clean -qfd -e node_modules
fi
if [ ! -d "$WT/node_modules" ] || ! cmp -s "$WT/package-lock.json" "$WT/node_modules/.lock-copy"; then
  (cd "$WT" && npm ci --no-audit --no-fund >/dev/null && cp package-lock.json node_modules/.lock-copy)
fi

# 2. static export at the domain root
mv "$WT/next.config.ts" "$WT/next.config.site.ts"
cp next.config.export.ts "$WT/next.config.ts"
rm -rf "$WT/.next" "$WT/out"
(cd "$WT" && SITE_URL="https://$DOMAIN/" NEXT_PUBLIC_SYNC_URL="$SYNC" npx next build)
rm -f "$WT"/out/t.html "$WT"/out/t[0-9].html "$WT"/out/t-*.html   # local screenshot helpers

rm -rf dist && cp -r "$WT/out" dist

# 3. the ledger at /daftar/, with the sync server filled in
powershell -NoProfile -ExecutionPolicy Bypass -File "../leon-gold/offline/build.ps1" -Site "$(cygpath -w "$HERE/dist/daftar")" -SyncUrl "$SYNC"

# 4. Liara files
cp liara/liara.json liara/liara_nginx.conf dist/

node test.mjs dist "$DOMAIN"
echo "built dist/ for https://$DOMAIN/ (sync: $SYNC)"
