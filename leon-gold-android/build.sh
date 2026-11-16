#!/bin/bash
# Builds leon-hesab.apk without Gradle. Needs JDK 17 + Android SDK (platform 35, build-tools 35.0.0).
# Signing key: ~/.leon-android/release.jks (never in git; losing it means users must reinstall).
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:-$HOME/.local/opt/android-sdk}
export JAVA_HOME=${JAVA_HOME:-$(ls -d $HOME/.local/opt/jdk-17*/Contents/Home | head -1)}
export PATH="$JAVA_HOME/bin:$PATH"
BT=$SDK/build-tools/35.0.0; JAR=$SDK/platforms/android-35/android.jar
KS=$HOME/.leon-android/release.jks
# password lives in the macOS Keychain (item "leon-android-keystore"), never in this file
KS_PASS=${KS_PASS:-$(security find-generic-password -s leon-android-keystore -w 2>/dev/null || true)}
[ -n "$KS_PASS" ] || { echo "no keystore password in Keychain"; exit 1; }
# a first copy of the site's files inside the APK (SiteCache.java); kept from the last build when offline
START=$(sed -n 's#.*<string name="start_url">\(.*\)</string>.*#\1#p' res/values/strings.xml)
python3 -I prefetch.py "$START" || echo "prefetch failed: keeping assets/ from the last build"
rm -rf out && mkdir -p out/gen out/classes out/dex
"$BT/aapt2" compile --dir res -o out/res.zip
"$BT/aapt2" link -I "$JAR" --manifest AndroidManifest.xml -A assets -o out/base.apk --java out/gen out/res.zip
javac --release 8 -classpath "$JAR" -d out/classes $(find src out/gen -name '*.java') 2>&1 | grep -v "^warning\|^1 warning\|bootstrap" || true
"$BT/d8" --lib "$JAR" --release --min-api 24 --output out/dex $(find out/classes -name '*.class')
cp out/base.apk out/unsigned.apk && (cd out/dex && zip -q ../unsigned.apk classes.dex)
"$BT/zipalign" -f 4 out/unsigned.apk out/aligned.apk
if [ ! -f "$KS" ]; then mkdir -p "$(dirname "$KS")"; keytool -genkeypair -keystore "$KS" -alias leon -keyalg RSA -keysize 2048 -validity 10000 -storepass "$KS_PASS" -keypass "$KS_PASS" -dname "CN=Leon Gold"; fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:"$KS_PASS" --out leon-hesab.apk out/aligned.apk
"$BT/apksigner" verify leon-hesab.apk && ls -lh leon-hesab.apk
