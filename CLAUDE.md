# train-widget: Jordan's train commute on his iPhone

Jordan takes the FL1 from **Roma Tuscolana** to **Muratella** (WFP HQ) in the morning and back in the evening. This
started as a Scriptable script (Sept 2025). Since 16 Oct 2026 it's **Treni**: his own iPhone app with a Live
Activity (lock screen, Dynamic Island, Watch Smart Stack) that a server on the VM starts by itself at set weekday
times and keeps up to date. Since 17 Oct 2026 a few colleagues can have it too: each phone has its own settings
and Live Activity on the server (`server/lib/phones.mjs`). Public repo (`jordancox/train-widget`): never commit a secret, a token or the push key.

## Pieces

- `server/` (Node 24, no packages): `treni.mjs` + `lib/`. User service `treni` (`server/treni.service`, linked into
  `~/.config/systemd/user/`), on `127.0.0.1:8795`, published by the VM's Cloudflare tunnel as
  **treni.jordancox.org**, deliberately outside Cloudflare Access (the app can't log in there); every `/api` call
  carries `TRENI_SECRET`. Config in `~/.config/treni/env` (mode 600: the secret, team, bundle ID, APNs key ID and
  path). Everyone's phones (settings, push-to-start tokens, channels, what's live) in `~/.local/share/treni/state.json`
  (version 2; the single-phone files from before 17 Oct 2026 are kept there as `*.v1.json`). Logs: `journalctl --user
  -u treni`. `node treni.mjs --phones` lists who's on it; `--print` shows what each Live Activity would say now.
  `/privacy` is a public page saying what the server keeps (for TestFlight's external testers). Tests: `cd server && node --test test.mjs` (real Viaggiatreno answers saved in `fixtures/`).
- `ios/`: the app (SwiftUI, iOS 18+, bundle `org.jordancox.treni`) and its widget extension (`org.jordancox.treni.live`,
  the Live Activity's UI). `project.yml` for XcodeGen; `Shared/` is in both targets. Built on GitHub's cloud Mac
  (`.github/workflows/ios.yml`): every push touching `ios/` builds for the simulator and sends back screenshots;
  TestFlight with `gh workflow run ios.yml -f testflight=true`. How all that works: the **ios-testflight** skill.
- `promo/`: an App Store-style contact sheet to show people (`make.sh` → `out/sheet.png` and one PNG per panel,
  linked in `~/renders/treni-promo`), laid out in `sheet.html` around the CI's pictures. The demo pictures read
  Monday 08:05 (`Demo.moment`, `Fmt.shift`) whatever time the build runs. The simulator sometimes leaves the Dynamic
  Island empty: check `shots/island.png` before rendering from a new run.
- `train-widget.js`: the old Scriptable script, kept working until the app is on his phone (no more mock data).

## How it works

- **Trains**: Viaggiatreno (RFI's live feed, plain http). It answers 403 to curl's User-Agent, so the server sends a
  browser one. A train counts if it's on the first station's departure board and the second's arrival board with a
  later time (that drops the other direction and branches that don't stop there). The board keeps a train ~10
  minutes after it has left, so trains near their time are checked against their own run (`andamentoTreno`).
- **Live Activity**: in a window (default weekdays 07:30–09:00 from home, 16:45–18:45 from work) the server sends
  push-to-start to the phone's push-to-start token with `input-push-channel`, so the activity listens on that
  phone's **broadcast channel** for that direction (iOS 18) and the app never has to wake up to report a token.
  Channels are per phone, not shared by route: the content-state carries each person's walk time, and ending a
  channel ends every activity on it. Every 45 s it
  re-reads the trains and broadcasts when something changes (priority 10 if it changes what you'd do, 5 otherwise),
  plus every 4 min so the stale date moves on; it ends the activity when the window closes. The countdown ticks on
  the phone by itself. The app can start one by hand, stop it, or skip today: two switches since 20 Oct 2026 ("On
  the lock screen now", "Start by itself today"), each with a line under it saying where things stand. As buttons
  worded like statuses ("Day off today: don't start by itself"), a tester turned a day off without knowing and
  wondered why nothing came up. The CI shoots both sides (`app-dayoff.png`, `app-live.png`). Since 28 Oct 2026 the
  app's screen runs: direction, the lock screen preview, its two switches, then the trains (the preview had been at
  the bottom). Days off in Settings list only days that are off, each with a remove button, and "Add a day off" opens
  a calendar: a date picker always showing tomorrow under "Days off" read as if tomorrow were off already
  (`settings-daysoff.png`, `settings-addday.png`). The CI also shoots the app and Settings at a large text size
  (`app-bigtext.png`, `app-bigtext-trains.png`, `settings-bigtext.png`): there the train rows stack, and the
  switch and day-off rows use `IconLabel`, because a Label runs its words on under the icon.
- **Several phones** (17 Oct 2026, for 5–6 colleagues through TestFlight): the app sends a random id it makes once
  (`X-Treni-Phone`, `API.phone`); a new phone starts from `defaults.json` with nothing starting by itself and a
  welcome line until it saves its own Settings. Build 13 and older send no id and get the `legacy` record (Jordan's,
  moved over from the single-phone files); a newer build takes it over when it registers the same push-to-start
  token. At most 20 phones; a phone is forgotten a month after its token goes, or after four months unused. Apple's beta
  reviewers turn up as phones of their own, doing what the review notes say (three on 17–19 Oct 2026: 4ff289,
  68c9eb, 9d5fd2); they aren't Jordan's. Jordan's phone is **5c83f4** since he reinstalled the app on 19 Oct 2026.
- **Reinstalling** (20 Oct 2026): builds up to 21 keep the id only in UserDefaults, which a delete wipes, so a
  reinstall turns up as a new phone with nothing starting by itself. Apple still answered 200 to the deleted copy's
  push-to-start token, so the server logged "started" and Jordan's morning activity never appeared. Build 24 on
  keeps the id in the Keychain too (`PhoneID` in `ios/App/API.swift`; checked by a reinstall in
  `ios/ci/sim-shots.sh`). `--phones` shows `app`, when the app itself last called in; `seen` also moves when Apple
  takes a start.
- **Walk time** (Settings, per station: home 13, work 8 minutes, from Jordan's guess on 16 Oct 2026): the
  content-state carries `walk` and the countdown is to when to set off ("Start walking in") for the next train you
  can still walk to; trains out of reach are left out of the content-state, and a cancelled one you'd have gone for
  is skipped with a note. Until it leaves, the one you'd be walking to if you set off in time stays in a bottom
  line ("Walking to the 08:37? Leaves in 4:12"). Only with no train left in reach does it count to the train ("Train
  leaves in"). Until 19 Oct 2026 it counted to the first train, so with a train every 15 minutes the walk countdown
  showed for about 2 minutes in 15 (Jordan: "the whole leave desk logic thing is flawed"). Walking words and train
  words stay apart (Jordan: "'leave in' could be construed as train time not me time"). Around those moments the
  server checks every 15 s instead of 45.
- **"Yes, I'm walking to this one"** (26 Oct 2026, builds from 25): nothing can tell which train you've set off for
  (13-minute walk, a train every 15 minutes: there's one you may be walking to 13 minutes in 15), so on the way the
  big number was when to leave home for the *next* train, and the Watch doesn't even show the bottom line (Jordan:
  "it's not super clear what is what"). Location was ruled out (the school run, an "always" location prompt for
  colleagues). Now the bottom line's "Walking to the 08:37?" has a **Yes** button, and the Watch an "I'm walking to
  the 08:37" one in the title's place; from then on it counts to that train and the ones after it, not the walk, with
  **Undo**. The tap runs `WalkingTo` (`ios/Shared/WalkingTo.swift`, a LiveActivityIntent, so it runs in the app even
  from the Watch) → `POST /api/walking` → `p.live.walking`, and the answer goes on the lock screen at once. The
  button's words and train are in `show` (`button`, `buttonWatch`, `buttonTrain`).
- **Apple refusing updates** (429 "TooManyRequests"; Apple publishes no limit): seen on 20, 23 and 26 Oct 2026, a
  colleague's card frozen from 07:58 to 09:00 while the server retried urgently every 15–45 s. Since 26 Oct the server
  waits 1, 2, 4, 8 minutes, retries at the low priority and stays low for 15 minutes after; the log says once when it
  starts and when it ends, and each ended card's log line counts its urgent pushes, to learn where the limit is.
- **The wording is the server's** (19 Oct 2026, build 21 on): the content-state's `show` carries every word the Live
  Activity shows and what each countdown counts to (`show()` in `lib/schedule.mjs`), so wording changes need no
  build; the app falls back to its own words when a field is missing, and older builds ignore `show`. The welcome
  line in the app is the server's too (`WELCOME` in `lib/phones.mjs`). Only the look (layout, colours, fonts) needs
  a build.
- **Expected times**: Viaggiatreno's delay is whole minutes and lags, so for trains due within 20 minutes the
  server takes the train's own run instead: half a minute after it pulled in if it's at the platform, otherwise
  its last logged stop (to the half minute) plus the timetable from there (`estimate()` in `lib/viaggiatreno.mjs`).
  First evening: train 20693 showed +4 and left 3 late.
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
- TestFlight for colleagues (17 Oct 2026): external group **"Colleagues"**, joined by a public link capped at 10
  (https://testflight.apple.com/join/kgcPFaxS). The test information shows Jordan's Gmail as the feedback address
  and `/privacy` as the privacy policy; the beta review contact is Jordan. Builds from 19 on are uploaded for outside
  testers too (`ios/ci/testflight.sh`; 17 was internal-only and couldn't join the group). Each new build has to be
  added to the group by hand (API: `betaGroups/<id>/relationships/builds`).
- Tunnel route: treni.jordancox.org → `http://localhost:8795`, a published application route with no Access.
- GitHub secrets on the repo: the ASC key, the shared dev certificate, the team, and `TRENI_SECRET` (set by Jordan
  with the skill's `set-secrets.sh`).
