#!/bin/bash
# On the cloud Mac: archives the app, signs it with Jordan's App Store Connect key (automatic signing: Xcode makes
# the profiles itself, with the one development certificate the workflow puts in a keychain from the repo's secrets)
# and uploads it to TestFlight. The build number is the workflow run's. Copied from flashcards/ios/ci/testflight.sh
# (the ios-testflight skill keeps the master copy); only the project, scheme and TRENI_SECRET differ.
# Needs KEY_ID, ISSUER, TEAM and TRENI_SECRET, and the key at ~/.appstoreconnect/private_keys/AuthKey_$KEY_ID.p8.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -n "${TRENI_SECRET:-}" ] || { echo "TRENI_SECRET is empty: the app couldn't talk to the server"; exit 1; }
KEY=~/.appstoreconnect/private_keys/AuthKey_$KEY_ID.p8
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$KEY" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER")
BUILD=${GITHUB_RUN_NUMBER:-1}
mkdir -p ios/build
xcodebuild archive -project ios/Treni.xcodeproj -scheme Treni -configuration Release \
  -destination 'generic/platform=iOS' -archivePath ios/build/Treni.xcarchive \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION="$BUILD" TRENI_SECRET="$TRENI_SECRET" "${AUTH[@]}" \
  > ios/build/archive.log 2>&1 || { grep -E "error|Error" ios/build/archive.log | head -40; exit 1; }
echo "archived, build $BUILD"
# Swift packages' static xcframeworks get copied into the app although their code is already linked into it, and Apple
# throws the build away (Insieme's build 12, ITMS-90208). Take out every framework the app doesn't load; the export
# signs the app again. Then fail here if any static library is still inside.
APP=ios/build/Treni.xcarchive/Products/Applications/Treni.app
LOADS=$(otool -L "$APP/Treni") # in a variable: grep -q on a pipe can end it early, and pipefail calls that a miss
for f in "$APP"/Frameworks/*.framework; do
  [ -e "$f" ] || continue
  n=$(basename "$f" .framework)
  grep -q "/$n.framework/" <<< "$LOADS" || { echo "not loaded, taken out: $n.framework"; rm -rf "$f"; }
done
STATIC=$(find "$APP" -type f -exec file {} + | grep "ar archive" || true)
if [ -n "$STATIC" ]; then echo "$STATIC"; echo "a static library is still in the app"; exit 1; fi
# Not testFlightInternalTestingOnly (the skill's template has it): a build uploaded that way can never go to
# outside testers, and Jordan's colleagues are outside testers (17 Oct 2026).
cat > ios/build/export.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath ios/build/Treni.xcarchive -exportOptionsPlist ios/build/export.plist \
  -exportPath ios/build/export "${AUTH[@]}" > ios/build/export.log 2>&1 || { grep -iE "error|fail" ios/build/export.log | head -40; exit 1; }
grep -iE "upload|EXPORT SUCCEEDED" ios/build/export.log | tail -5
echo "sent to TestFlight: build $BUILD"
# "Upload succeeded" isn't "accepted": Apple checks the build afterwards and can throw it away, saying so only by email.
# Public repo (free minutes): wait here for its answer, so a refusal fails the run with Apple's reasons. Private repo
# (each Mac minute counts as 10): ACCEPT_MINUTES=0, and check from the VM: scripts/asc.py accepted <bundle id> <build>.
if [ "${ACCEPT_MINUTES:-20}" -gt 0 ]; then
  set +e
  python3 ios/ci/asc.py accepted org.jordancox.treni "$BUILD" "${ACCEPT_MINUTES:-20}"
  ACCEPTED=$?
  case $ACCEPTED in
    0) ;;
    1) exit 1 ;;
    *) echo "::warning::Apple hasn't finished checking build $BUILD: look in App Store Connect" ;;
  esac
fi
# Every build goes to the colleagues too (Jordan, 29 Oct 2026, after builds 26 and 35 went only to him): added to their
# group and sent to Apple's beta review. A refusal fails the run; a review still going is a warning.
TO_GROUP="python3 ios/ci/asc.py to-group org.jordancox.treni $BUILD Colleagues"
if [ "${ACCEPTED:-2}" -eq 0 ]; then
  $TO_GROUP 10
  case $? in
    0) ;;
    1) exit 1 ;;
    *) echo "::warning::build $BUILD isn't with the colleagues yet: look again from the VM with $TO_GROUP" ;;
  esac
else
  echo "::warning::build $BUILD hasn't gone to the colleagues: once Apple accepts it, from the VM: $TO_GROUP"
fi
