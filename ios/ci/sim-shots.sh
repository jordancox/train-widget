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
launch settings -demo -screen settings; sleep 5; shot settings
xcrun simctl ui "$UDID" appearance dark
launch settings-dark -demo -screen settings; sleep 5; shot settings-dark
launch live -demo -live; sleep 6; shot app-live
# Another app in front: the Live Activity moves to the Dynamic Island.
xcrun simctl launch "$UDID" com.apple.Preferences >/dev/null; sleep 4; shot island
# The island is sometimes slow to show up (16 Oct 2026): a second try.
sleep 6; shot island-2
xcrun simctl terminate "$UDID" "$ID" || true
