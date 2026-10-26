import ActivityKit
import Foundation

/// The Live Activity's data. The server sends ContentState as JSON with exactly these field names
/// (server/lib/schedule.mjs, liveContent) and iOS decodes it with plain JSONDecoder rules, so times are Unix
/// seconds as Double: a Swift Date would be read as seconds since 2001.
struct TrainAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var from: String
        var to: String
        /// The next three trains that stop at both stations, soonest first.
        var trains: [Train]
        /// When the server last looked at the trains.
        var updated: Double
        /// Shown when there's nothing better to say ("No trains in the next hour").
        var note: String?
        /// Minutes from setting off to standing on the platform, sent while there's a train you can still walk to:
        /// the countdown is then to when to set off ("Start walking in"), not to the train.
        var walk: Int?
        /// Every word shown, and what the countdowns count to, from the server (19 Oct 2026 on).
        var show: Show? = nil
    }

    /// "morning" or "evening" (started by the server at the set time), or "manual" (started in the app).
    var window: String
    /// "home" or "work": where the trip starts.
    var from: String
}

/// What the Live Activity says, decided by the server (server/lib/schedule.mjs, `show`), so its wording and what the
/// countdowns count to can change without a new build. Every field is optional: whatever is missing falls back to
/// the built-in wording worked out from `trains` and `walk` (the views' `ContentState` extension).
struct Show: Codable, Hashable {
    /// The header: "To Muratella"
    var title: String? = nil
    /// The header's right-hand side: "Platform 5"
    var corner: String? = nil
    /// Over the big countdown: "Start walking in", "Train leaves in"
    var label: String? = nil
    /// What the big countdown (and the Dynamic Island's) counts down to, Unix seconds
    var until: Double? = nil
    /// In red instead of the countdown: "Cancelled"
    var big: String? = nil
    /// Under the countdown in the expanded Dynamic Island: "to start walking"
    var after: String? = nil
    /// The Dynamic Island's symbol (an SF Symbols name): "figure.walk", "tram.fill"
    var icon: String? = nil
    /// On the right: the train's time, and under it how it's running ("2 min late") in `tone`
    var time: String? = nil
    var status: String? = nil
    /// "green", "orange", "red" or "white": `status`, and the Dynamic Island's countdown
    var tone: String? = nil
    /// The bottom line, in place of "Then 08:52": "Walking to the 08:37? Leaves in", with a countdown to
    /// `lineUntil` after it when that's set
    var line: String? = nil
    var lineUntil: Double? = nil
    var lineTone: String? = nil
    /// A button after the bottom line, "Yes" (to "Walking to the 08:37?") or "Undo", and the Watch's ("I'm walking
    /// to the 08:37"). Tapping either sends `buttonTrain` to the server (`WalkingTo`): a train's number, or "" for
    /// not walking after all. 26 Oct 2026 on.
    var button: String? = nil
    var buttonWatch: String? = nil
    var buttonTrain: String? = nil
}

struct Train: Codable, Hashable, Identifiable {
    /// Train number, e.g. "20423".
    var n: String
    /// Scheduled departure from the first station.
    var dep: Double
    /// Expected departure: scheduled plus the delay.
    var exp: Double
    /// Minutes late (never negative).
    var delay: Int
    /// Where the train ends its run, e.g. "Fiumicino Aeroporto".
    var dest: String
    var cancelled: Bool
    var plat: String?
    /// Expected arrival at the second station.
    var arr: Double?

    var id: String { n }
}
