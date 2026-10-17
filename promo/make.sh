#!/bin/bash
# Treni's promo pictures (App Store style) from the CI's screenshots: out/sheet.png, the contact sheet to paste to
# someone, and out/panel-1.png … panel-6.png, each panel on its own at twice the size.
#   promo/make.sh            renders from the pictures already in shots/
#   promo/make.sh <run id>   downloads that ios run's pictures first (they come from ios/App/Demo.swift)
# The simulator doesn't always show the Dynamic Island (16 Oct 2026): look at shots/island.png before using a run.
# Headless Chrome goes through the motion kit's wrapper (one Chrome at a time, in its own memory cap).
set -euo pipefail
cd "$(dirname "$0")"
if [ -n "${1:-}" ]; then
  rm -rf shots dl
  gh run download "$1" -n shots -D dl
  mv dl/shots shots && rm -rf dl
fi
cp ../ios/Assets.xcassets/AppIcon.appiconset/icon.png icon.png
chrome=$(ls -d ~/.cache/puppeteer/chrome/*/chrome-linux64/chrome | tail -1)
mkdir -p out
shoot() { # name, width,height, scale
  ~/projects/videos/tools/motionkit/chrome.sh "$chrome" --headless --hide-scrollbars --no-sandbox \
    --force-device-scale-factor="$3" --window-size="$2" --virtual-time-budget=4000 \
    --screenshot="$PWD/out/$1.png" "file://$PWD/sheet.html#$1" 2>/dev/null
}
shoot sheet 1992,3040 1
for n in 1 2 3 4 5 6; do shoot "panel-$n" 600,1300 2; done
ls -l out
