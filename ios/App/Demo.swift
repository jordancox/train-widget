import ActivityKit
import SwiftUI

/// Sample trains for the simulator (-demo), timed from now so the countdowns run.
enum Demo {
    static let home = Station(code: "S08408", name: "Roma Tuscolana")
    static let work = Station(code: "S08400", name: "Muratella")

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

    static func content(from: String, trains: [Train], now: Double = Date().timeIntervalSince1970, note: String? = nil) -> TrainAttributes.ContentState {
        let (a, b) = from == "home" ? (home, work) : (work, home)
        return .init(from: Fmt.short(a.name), to: Fmt.short(b.name), trains: Array(trains.prefix(3)), updated: now, note: note)
    }

    static func snapshot(from: String) -> Snapshot {
        let list = trains(from: from)
        let settings = TreniSettings(home: home, work: work, windows: [
            TripWindow(id: "morning", from: "home", start: "07:30", end: "09:00", days: [1, 2, 3, 4, 5], on: true),
            TripWindow(id: "evening", from: "work", start: "16:45", end: "18:45", days: [1, 2, 3, 4, 5], on: true),
        ], skip: [])
        return Snapshot(now: Date().timeIntervalSince1970, from: from, settings: settings, trains: list,
                        content: content(from: from, trains: list), channel: "demo", live: nil,
                        next: .init(id: "morning", date: "2026-10-19", dow: 1, start: "07:30"),
                        today: "2026-10-16", registered: 1, dry: true)
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
        let s = Demo.content(from: "home", trains: list)
        var cancelled = list
        cancelled[0].cancelled = true
        save("lock", width: 370, lock(s))
        save("lock-home", width: 370, lock(Demo.content(from: "work", trains: Demo.trains(from: "work"))))
        save("lock-stale", width: 370, lock(s, stale: true))
        save("lock-cancelled", width: 370, lock(Demo.content(from: "home", trains: cancelled)))
        save("lock-empty", width: 370, lock(Demo.content(from: "home", trains: [], note: "No trains in the next hour")))
        save("island-expanded", width: 370,
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
             .background(.black, in: RoundedRectangle(cornerRadius: 40)))
        save("island-compact", width: 250,
             HStack {
                 IslandCompactLeading(state: s)
                 Spacer()
                 IslandCompactTrailing(state: s)
             }
             .padding(.horizontal, 14)
             .frame(height: 37)
             .background(.black, in: Capsule()))
        save("watch", width: 184, WatchView(state: s).padding(10).background(Color(white: 0.12), in: RoundedRectangle(cornerRadius: 20)))
    }

    private static func lock(_ s: TrainAttributes.ContentState, stale: Bool = false) -> some View {
        LockScreenView(state: s, stale: stale).background(Board.background, in: RoundedRectangle(cornerRadius: 22))
    }
}
