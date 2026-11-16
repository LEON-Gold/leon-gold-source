#!/bin/bash
# Builds both Windows apps on the Mac into dist/ (one exe each, nothing to install on Windows 10/11).
set -euo pipefail
cd "$(dirname "$0")"
DOTNET=${DOTNET:-$HOME/.local/opt/dotnet/dotnet}
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
mkdir -p dist
for APP in LEDGER HESAB; do
  "$DOTNET" build LeonGold.csproj -c Release -p:App=$APP -v q -nologo 2>&1 | grep -E "error|Warn|warn CS" || true
done
cp bin/LEDGER/LeonGold-Ledger.exe bin/HESAB/LeonGold-Hesab.exe dist/
ls -lh dist
