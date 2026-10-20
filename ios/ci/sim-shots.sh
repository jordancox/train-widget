#!/bin/bash
# On the cloud Mac: runs the simulator build on an iPhone Pro simulator with sample trains (-demo) and sends back
# pictures: the app's screens, the Live Activity's views as the app draws them (-shots: lock screen, Dynamic Island,
# Watch), and the real Dynamic Island with a Live Activity running while another app is open.
# Pattern from flashcards/ios/ci/sim-shots.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
APP=ios/build/dd/Build/Products/Debug-iphonesimulator/Treni.app
ID=org.jordancox.treni
OUT=$PWD/ios/build/shots; mkdir -p "$OUT"
# The newest iPhone Pro (not Max): it has a Dynamic Island.
UDID=$(xcrun simctl list -j devices available | python3 -c '
import json, sys
d = json.load(sys.stdin)["devices"]
sims = [x for k, v in d.items() if "iOS" in k for x in v if x["name"].startswith("iPhone") and "Pro" in x["name"] and "Max" not in x["name"]]
sims.sort(key=lambda x: x["name"])
print(sims[-1]["udid"] if sims else "")')
[ -n "$UDID" ] || { echo "no iPhone Pro simulator"; xcrun simctl list devices available; exit 1; }
xcrun simctl list devices | grep "$UDID"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl status_bar "$UDID" override --time 08:05 --batteryState charged --batteryLevel 100 2>/dev/null || true
plutil -p "$APP/Info.plist" > "$OUT/info.txt" 2>&1 || true
xcrun simctl install "$UDID" "$APP"
shot() { xcrun simctl io "$UDID" screenshot "$OUT/$1.png" >/dev/null 2>&1; echo "shot $1"; }
launch() { xcrun simctl launch --terminate-running-process --stdout="$OUT/$1.log" --stderr="$OUT/$1.log" "$UDID" "$ID" "${@:2}" >/dev/null; }

launch app -demo -shots; sleep 7; shot app
DATA=$(xcrun simctl get_app_container "$UDID" "$ID" data)
cp "$DATA"/Documents/shots/*.png "$OUT/" 2>/dev/null && ls "$DATA/Documents/shots" || echo "no -shots pictures"
# Today switched off, scrolled to the switches. On 20 Oct 2026 a tester turned today off with a button that read like a
# status, and couldn't tell: this is the picture to check that the off side says so.
launch dayoff -demo -dayoff -screen bottom; sleep 6; shot app-dayoff
launch settings -demo -screen settings; sleep 5; shot settings
xcrun simctl ui "$UDID" appearance dark
launch settings-dark -demo -screen settings; sleep 5; shot settings-dark
launch live -demo -live; sleep 6; shot app-live
# Another app in front: the Live Activity moves to the Dynamic Island.
xcrun simctl launch "$UDID" com.apple.Preferences >/dev/null; sleep 4; shot island
# The island is sometimes slow to show up (16 Oct 2026): a second try.
sleep 6; shot island-2
# Back in the app, scrolled to the switches: the lock screen one on, with how long it stays.
launch live-bottom -demo -live -screen bottom; sleep 6; shot app-live-bottom
xcrun simctl terminate "$UDID" "$ID" || true

# A reinstall is still the same phone: its id comes back from the Keychain. On 20 Oct 2026 a reinstall made Jordan a
# new phone on the server with nothing starting by itself, while the server went on starting the deleted copy's.
phone_id() {
  launch "$1" -demo -phone
  for _ in $(seq 20); do grep -q '^phone ' "$OUT/$1.log" 2>/dev/null && break; sleep 0.5; done
  sed -n 's/^phone \([^ ]*\).*/\1/p' "$OUT/$1.log" | head -1
}
first=$(phone_id phone-1)
xcrun simctl uninstall "$UDID" "$ID"
xcrun simctl install "$UDID" "$APP"
again=$(phone_id phone-2)
cat "$OUT/phone-1.log" "$OUT/phone-2.log"
if [ -z "$first" ] || [ "$first" != "$again" ]; then
  echo "::error::a reinstall made a new phone id (${first:-none} → ${again:-none}): it should come back from the Keychain"
  exit 1
fi
echo "phone id kept through a reinstall: $first"
