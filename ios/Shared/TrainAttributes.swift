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
        /// Minutes from setting off to standing on the platform, sent only while there's still time to set off for
        /// the first train: the countdown is then to when to leave ("Leave in"), not to the train.
        var walk: Int?
    }

    /// "morning" or "evening" (started by the server at the set time), or "manual" (started in the app).
    var window: String
    /// "home" or "work": where the trip starts.
    var from: String
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
