#!/bin/bash
# Uploads dist/ to the Liara static app «leon-gold-web» (a NEW app; the sync server «leon-gold» is never touched here).
# Needs LIARA_TOKEN (Liara panel → API) in the environment or in .env (git-ignored). Run build.sh first.
set -e
cd "$(dirname "$0")"
[ -f .env ] && . ./.env
: "${LIARA_TOKEN:?set LIARA_TOKEN (Liara panel → حساب کاربری → API)}"
[ -f dist/index.html ] && [ -f dist/daftar/index.html ] || { echo "run build.sh first"; exit 1; }
DOMAIN=$(grep -o 'og:image" content="https://[^/]*' dist/index.html | sed 's#.*https://##')
node test.mjs dist "$DOMAIN"
npx -y @liara/cli deploy --path dist --app leon-gold-web --platform static --api-token "$LIARA_TOKEN" --detach
echo "deployed: https://$DOMAIN/  (check / , /panel/ , /hesab/ , /daftar/ on the phone)"
