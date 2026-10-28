import ActivityKit
import SwiftUI

/// Sample trains for the simulator (-demo), timed from now so the countdowns run, and shown as if it were
/// `moment` (Fmt.shift): the morning trip to work.
enum Demo {
    /// Monday 19 October 2026, 08:05 in Rome (the simulator's status bar says 8:05 too: ci/sim-shots.sh).
    static let moment: Double = 1_792_389_900

    static let home = Station(code: "S08408", name: "Roma Tuscolana", walk: 13)
    static let work = Station(code: "S08400", name: "Muratella", walk: 8)

    static func trains(from: String, now: Double = Date().timeIntervalSince1970) -> [Train] {
        let toWork = from == "home"
        func train(_ n: String, inMinutes: Double, delay: Int, cancelled: Bool = false) -> Train {
            let exp = ((now + inMinutes * 60) / 60).rounded(.down) * 60
            return Train(n: n, dep: exp - Double(delay * 60), exp: exp, delay: delay,
                         dest: toWork ? "Fiumicino Aeroporto" : "Fara Sabina-Montelibretti",
                         cancelled: cancelled, plat: toWork ? "5" : "1", arr: exp + 24 * 60)
        }
        return [train("20423", inMinutes: 6.5, delay: 2), train("20443", inMinutes: 21, delay: 0),
                train("20445", inMinutes: 37, delay: 4), train("20447", inMinutes: 51, delay: 0, cancelled: true),
                train("20439", inMinutes: 66, delay: 1)]
    }

    static func content(from: String, trains: [Train], now: Double = Date().timeIntervalSince1970, note: String? = nil,
                        walk: Int? = nil) -> TrainAttributes.ContentState {
        let (a, b) = from == "home" ? (home, work) : (work, home)
        return .init(from: Fmt.short(a.name), to: Fmt.short(b.name), trains: Array(trains.prefix(3)), updated: now, note: note, walk: walk)
    }

    /// -dayoff: today is a day off (the switch's other side, for ci/sim-shots.sh). `live`: a Live Activity is up
    /// here, until 09:00.
    static func snapshot(from: String, live: Bool = false) -> Snapshot {
        let list = trains(from: from)
        let now = Date().timeIntervalSince1970
        let dayoff = ProcessInfo.processInfo.arguments.contains("-dayoff")
        let settings = TreniSettings(home: home, work: work, windows: [
            TripWindow(id: "morning", from: "home", start: "07:30", end: "09:00", days: [1, 2, 3, 4, 5], on: true),
            TripWindow(id: "evening", from: "work", start: "16:45", end: "18:45", days: [1, 2, 3, 4, 5], on: true),
        ], skip: dayoff ? ["2026-10-19", SettingsView.iso(Date().addingTimeInterval(86400))] : []) // and tomorrow, for Settings
        return Snapshot(now: now, from: from, settings: settings, trains: list,
                        content: content(from: from, trains: list), channel: "demo",
                        live: live ? .init(kind: "manual", from: from, until: now + 55 * 60) : nil,
                        next: dayoff ? .init(id: "morning", date: "2026-10-20", dow: 2, start: "07:30")
                                     : .init(id: "evening", date: "2026-10-19", dow: 1, start: "16:45"),
                        today: "2026-10-19", registered: 1, dry: true)
    }
}

/// -shots: draws the Live Activity's views into Documents/shots/*.png, for the CI to send back (ios/ci/sim-shots.sh).
/// The Dynamic Island is drawn here roughly as iOS lays it out; the real one is in the CI's island.png.
@MainActor
enum Shots {
    static func write() {
        guard ProcessInfo.processInfo.arguments.contains("-shots") else { return }
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("shots")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        func save<V: View>(_ name: String, width: CGFloat, _ view: V) {
            let renderer = ImageRenderer(content: view.frame(width: width).environment(\.colorScheme, .dark))
            renderer.scale = 3
            if let png = renderer.uiImage?.pngData() { try? png.write(to: dir.appendingPathComponent("\(name).png")) }
        }
        let list = Demo.trains(from: "home")
        let s = Demo.content(from: "home", trains: list, walk: 4) // 6½ minutes to the train, 4 to walk: "Start walking in 2:30"
        let train = Demo.content(from: "home", trains: list) // too late to walk it: counting to the train
        var cancelled = list
        cancelled[0].cancelled = true
        save("lock", width: 370, lock(s))
        save("lock-home", width: 370, lock(Demo.content(from: "work", trains: Demo.trains(from: "work"))))
        save("lock-train", width: 370, lock(train))
        save("lock-stale", width: 370, lock(s, stale: true))
        save("lock-cancelled", width: 370, lock(Demo.content(from: "home", trains: cancelled)))
        save("lock-empty", width: 370, lock(Demo.content(from: "home", trains: [], note: "No trains in the next hour")))
        // Set off in time for the first train, so on the way to it; the countdown is already to leaving for the next
        // (the server's `show`, as lib/schedule.mjs words it).
        var onWay = Demo.content(from: "home", trains: Array(list.dropFirst()), walk: 13)
        onWay.show = Show(line: "Walking to the \(Fmt.hm(list[0].dep)) +2? Leaves in", lineUntil: list[0].exp,
                          button: "Yes", buttonWatch: "I'm walking to the \(Fmt.hm(list[0].dep))", buttonTrain: list[0].n)
        save("lock-onway", width: 370, lock(onWay))
        save("island-onway", width: 370, island(onWay))
        save("watch-onway", width: 184, watch(onWay))
        // After "Yes": counting to that train, with Undo.
        var walking = Demo.content(from: "home", trains: list)
        walking.show = Show(label: "Train leaves in", until: list[0].exp, button: "Undo", buttonTrain: "")
        save("lock-walking", width: 370, lock(walking))
        save("watch-walking", width: 184, watch(walking))
        save("island-expanded", width: 370, island(s))
        save("island-compact", width: 250,
             HStack {
                 IslandCompactLeading(state: s)
                 Spacer()
                 IslandCompactTrailing(state: s)
             }
             .padding(.horizontal, 14)
             .frame(height: 37)
             .background(.black, in: Capsule()))
        save("watch", width: 184, watch(s))
        // For the promo sheet (../promo/): a whole lock screen and a Watch face, drawn here to have Apple's fonts.
        save("promo-lock", width: 402, PromoLock(state: s).frame(height: 874))
        save("promo-watch", width: 208, PromoWatch(state: s).frame(height: 248))
    }

    private static func lock(_ s: TrainAttributes.ContentState, stale: Bool = false) -> some View {
        LockScreenView(state: s, stale: stale).background(Board.background, in: RoundedRectangle(cornerRadius: 22))
    }

    private static func watch(_ s: TrainAttributes.ContentState) -> some View {
        WatchView(state: s).padding(10).background(Color(white: 0.12), in: RoundedRectangle(cornerRadius: 20))
    }

    private static func island(_ s: TrainAttributes.ContentState) -> some View {
        VStack(spacing: 6) {
            HStack(alignment: .top) {
                IslandExpandedLeading(state: s)
                Spacer()
                IslandExpandedCenter(state: s)
                Spacer()
                IslandExpandedTrailing(state: s)
            }
            IslandExpandedBottom(state: s)
        }
        .padding(18)
        .foregroundStyle(.white)
        .background(.black, in: RoundedRectangle(cornerRadius: 40))
    }
}

/// A lock screen around the Live Activity, laid out like an iPhone 16 Pro's (402 × 874 points).
struct PromoLock: View {
    let state: TrainAttributes.ContentState

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.04, green: 0.06, blue: 0.16), Color(red: 0.16, green: 0.13, blue: 0.34),
                                    Color(red: 0.55, green: 0.27, blue: 0.40), Color(red: 0.96, green: 0.58, blue: 0.36)],
                           startPoint: .top, endPoint: .bottom)
            RadialGradient(colors: [Color(red: 1, green: 0.78, blue: 0.45).opacity(0.55), .clear],
                           center: UnitPoint(x: 0.3, y: 0.95), startRadius: 0, endRadius: 420)
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Spacer()
                    Image(systemName: "cellularbars")
                    Image(systemName: "wifi")
                    Image(systemName: "battery.100percent")
                }
                .font(.system(size: 15, weight: .semibold))
                .padding(.horizontal, 30)
                .frame(height: 59)
                .overlay(Capsule().fill(.black).frame(width: 126, height: 37))
                Text(Promo.format("EEEE d MMMM", state.updated)).font(.system(size: 21, weight: .semibold)).opacity(0.85)
                    .padding(.top, 34)
                Text(Promo.format("H:mm", state.updated)).font(.system(size: 100, weight: .bold)).monospacedDigit().opacity(0.92)
                    .padding(.top, -10)
                Spacer()
                LockScreenView(state: state)
                    .background(Board.background, in: RoundedRectangle(cornerRadius: 24))
                    .padding(.horizontal, 16)
                HStack {
                    Promo.roundButton("flashlight.off.fill")
                    Spacer()
                    Promo.roundButton("camera.fill")
                }
                .padding(.horizontal, 46)
                .padding(.top, 44)
                Capsule().fill(.white).frame(width: 140, height: 5).padding(.top, 26).padding(.bottom, 8)
            }
        }
        .foregroundStyle(.white)
    }
}

/// An Apple Watch face (46 mm: 208 × 248 points) with the Live Activity at the top of the Smart Stack.
struct PromoWatch: View {
    let state: TrainAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(Promo.format("H:mm", state.updated)).font(.system(size: 17, weight: .semibold, design: .rounded))
                .frame(maxWidth: .infinity, alignment: .trailing).padding(.trailing, 14).padding(.top, 10)
            Spacer()
            WatchView(state: state).padding(12).background(Color(white: 0.16), in: RoundedRectangle(cornerRadius: 24))
            Spacer()
            Spacer()
        }
        .padding(.horizontal, 6)
        .background(.black)
        .foregroundStyle(.white)
    }
}

enum Promo {
    static func format(_ pattern: String, _ seconds: Double) -> String {
        let f = DateFormatter()
        f.dateFormat = pattern
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = TimeZone(identifier: "Europe/Rome")
        return f.string(from: Date(timeIntervalSince1970: seconds + Fmt.shift))
    }

    static func roundButton(_ symbol: String) -> some View {
        Image(systemName: symbol).font(.system(size: 21)).frame(width: 50, height: 50)
            .background(Color.black.opacity(0.28), in: Circle())
    }
}
