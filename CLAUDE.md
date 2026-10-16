# train-widget: Jordan's train commute on his iPhone

Jordan takes the FL1 from **Roma Tuscolana** to **Muratella** (WFP HQ) in the morning and back in the evening. This
started as a Scriptable script (Sept 2025). Since 16 Oct 2026 it's **Treni**: his own iPhone app with a Live
Activity (lock screen, Dynamic Island, Watch Smart Stack) that a server on the VM starts by itself at set weekday
times and keeps up to date. Public repo (`jordancox/train-widget`): never commit a secret, a token or the push key.

## Pieces

- `server/` (Node 24, no packages): `treni.mjs` + `lib/`. User service `treni` (`server/treni.service`, linked into
  `~/.config/systemd/user/`), on `127.0.0.1:8795`, published by the VM's Cloudflare tunnel as
  **treni.jordancox.org**, deliberately outside Cloudflare Access (the app can't log in there); every `/api` call
  carries `TRENI_SECRET`. Config in `~/.config/treni/env` (mode 600: the secret, team, bundle ID, APNs key ID and
  path). Settings (stations, windows, days off) and state (phone tokens, channels, what's live) in
  `~/.local/share/treni/`. Logs: `journalctl --user -u treni`. `node treni.mjs --print` shows what the Live Activity
  would say now. Tests: `cd server && node --test test.mjs` (real Viaggiatreno answers saved in `fixtures/`).
- `ios/`: the app (SwiftUI, iOS 18+, bundle `org.jordancox.treni`) and its widget extension (`org.jordancox.treni.live`,
  the Live Activity's UI). `project.yml` for XcodeGen; `Shared/` is in both targets. Built on GitHub's cloud Mac
  (`.github/workflows/ios.yml`): every push touching `ios/` builds for the simulator and sends back screenshots;
  TestFlight with `gh workflow run ios.yml -f testflight=true`. How all that works: the **ios-testflight** skill.
- `train-widget.js`: the old Scriptable script, kept working until the app is on his phone (no more mock data).

## How it works

- **Trains**: Viaggiatreno (RFI's live feed, plain http). It answers 403 to curl's User-Agent, so the server sends a
  browser one. A train counts if it's on the first station's departure board and the second's arrival board with a
  later time (that drops the other direction and branches that don't stop there). The board keeps a train ~10
  minutes after it has left, so trains near their time are checked against their own run (`andamentoTreno`).
- **Live Activity**: in a window (default weekdays 07:30–09:00 from home, 16:45–18:45 from work) the server sends
  push-to-start to the phone's push-to-start token with `input-push-channel`, so the activity listens on that
  direction's **broadcast channel** (iOS 18) and the app never has to wake up to report a token. Every 45 s it
  re-reads the trains and broadcasts when something changes (priority 10 if it changes what you'd do, 5 otherwise),
  plus every 4 min so the stale date moves on; it ends the activity when the window closes. The countdown ticks on
  the phone by itself. The app can start one by hand, stop it, or skip today.
- The content-state's fields must match `ios/Shared/TrainAttributes.swift` and `server/lib/schedule.mjs`
  (`liveContent`) exactly; times are Unix seconds.

## Apple and Cloudflare pieces (all done 16 Oct 2026)

- App ID `org.jordancox.treni` (+ `.live`), registered with push by Claude through the API. Broadcast Capability
  ticked on it by Jordan.
- APNs key **Q8JU8V9YFU** ("Treni push", Production, Team Scoped), at `~/.config/apple/AuthKey_Q8JU8V9YFU.p8`, named
  in `~/.config/treni/env`. Apple made the home and work channels with it (ids in `~/.local/share/treni/state.json`),
  and a test broadcast got 200 from both `api.push.apple.com` and `api-broadcast.push.apple.com`.
- App Store Connect record "Treni Jordan" (app id 6823608242, SKU `treni`). Only Jordan sees it: the other user
  on the team (Marketing role) sees Super Lettore only.
- Tunnel route: treni.jordancox.org → `http://localhost:8795`, a published application route with no Access.
- GitHub secrets on the repo: the ASC key, the shared dev certificate, the team, and `TRENI_SECRET` (set by Jordan
  with the skill's `set-secrets.sh`).
