#!/bin/bash
# Builds both Mac apps into dist/ (Apple silicon, macOS 12+), ad-hoc signed, each zipped for download.
set -euo pipefail
cd "$(dirname "$0")"
ICON=../leon-gold-app/icon-512.png
rm -rf dist out && mkdir -p dist out
# icon set
mkdir -p out/app.iconset
for s in 16 32 128 256 512; do sips -z $s $s "$ICON" --out out/app.iconset/icon_${s}x${s}.png >/dev/null; d=$((s*2)); [ $d -le 512 ] && sips -z $d $d "$ICON" --out out/app.iconset/icon_${s}x${s}@2x.png >/dev/null; done
cp "$ICON" out/app.iconset/icon_256x256@2x.png
iconutil -c icns out/app.iconset -o out/app.icns
build() { # $1 name  $2 bundle id  $3 flag  $4 file name
  local APP="dist/$1.app"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  # Apple-silicon Macs only: this Mac's toolchain no longer builds for Intel
  swiftc -O $3 -target arm64-apple-macos12.0 -o "$APP/Contents/MacOS/$4" src/main.swift
  cp out/app.icns "$APP/Contents/Resources/app.icns"
  cat > "$APP/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$1</string>
  <key>CFBundleDisplayName</key><string>$1</string>
  <key>CFBundleIdentifier</key><string>$2</string>
  <key>CFBundleExecutable</key><string>$4</string>
  <key>CFBundleIconFile</key><string>app</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.2</string>
  <key>CFBundleVersion</key><string>3</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleDevelopmentRegion</key><string>fa</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.business</string>
</dict></plist>
PL
  codesign --force --deep -s - "$APP"
  (cd dist && ditto -c -k --keepParent "$1.app" "$4.zip")
}
# owner only: «دفتر» + «حساب من» in one app (never on the public site)
build "لئون گلد" net.leongold.mac "" LeonGold
# public site: «حساب من» alone
build "حساب من" net.leongold.hesab "-D HESAB" LeonGold-Hesab
# test builds (local test server, never shipped): make with TEST=1
if [ "${TEST:-}" = 1 ]; then build "لئون گلد تست" net.leongold.mactest "-D TEST" LeonGold-Test; fi
ls -lh dist
