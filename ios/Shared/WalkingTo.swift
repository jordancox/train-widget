import ActivityKit
import AppIntents
import Foundation

/// The Live Activity's button: "Yes" to "Walking to the 08:37?" (from then on it counts to that train, not to when to
/// set off for the next), or "Undo". Nothing else can tell which train you've set off for: with a 13-minute walk and
/// a train every 15 minutes, there's one you may be walking to 13 minutes in 15 (Jordan, 26 Oct 2026, glancing at
/// the Watch on the way to the station and seeing when to leave home for the next one).
///
/// A LiveActivityIntent runs in the app, which iOS wakes in the background if need be, also for a tap on the Watch;
/// the widget extension only draws the button, so the call to the server is in `#if TRENI_APP` (project.yml). The
/// server's answer goes on the lock screen at once, without waiting for Apple's push.
struct WalkingTo: LiveActivityIntent {
    static var title: LocalizedStringResource = "Walking to a train"
    static var isDiscoverable = false

    /// The train's number, or "" for not walking after all.
    @Parameter(title: "Train") var train: String

    init() {}
    init(train: String) { self.train = train }

    func perform() async throws -> some IntentResult {
        #if TRENI_APP
        let answer: WalkingAnswer = try await API.shared.call("POST", "/api/walking", body: WalkingRequest(train: train))
        let content = ActivityContent(state: answer.content, staleDate: Date().addingTimeInterval(12 * 60))
        for activity in Activity<TrainAttributes>.activities where activity.attributes.from == answer.from {
            await activity.update(content)
        }
        #endif
        return .result()
    }
}
