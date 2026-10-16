import ActivityKit
import Foundation
import UIKit

@MainActor
final class Model: ObservableObject {
    @Published var snap: Snapshot?
    @Published var error: String?
    @Published var loading = false
    /// "home" or "work" when picked in the app; nil lets the server choose (what's live, or the time of day).
    @Published var choice: String?
    /// A Live Activity is up on this phone.
    @Published var liveHere = false

    let api = API.shared
    /// -demo: sample trains, no server (the CI's screenshots).
    let demo = ProcessInfo.processInfo.arguments.contains("-demo")

    init() { refreshLiveHere() }

    func refresh() async {
        defer { refreshLiveHere() }
        if demo { snap = Demo.snapshot(from: choice ?? "home"); return }
        guard api.configured else { error = "This build has no server secret: it needs the cloud build."; return }
        loading = true
        defer { loading = false }
        do {
            var query: [String: String] = [:]
            if let choice { query["from"] = choice }
            snap = try await api.call("GET", "/api/state", query: query)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func refreshLiveHere() {
        liveHere = Activity<TrainAttributes>.activities.contains { $0.activityState == .active || $0.activityState == .stale }
    }

    /// Puts the trains on the lock screen now, and asks the server to keep them up to date.
    func startLive() async {
        guard let snap else { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            error = "Live Activities are off for Treni: Settings → Treni → Live Activities."
            return
        }
        for activity in Activity<TrainAttributes>.activities { await activity.end(nil, dismissalPolicy: .immediate) }
        let content = ActivityContent(state: snap.content, staleDate: Date().addingTimeInterval(12 * 60))
        do {
            // A channel the server hasn't really made (no push key yet, or the demo) would stop it starting at all.
            let push: PushType? = snap.dry || demo ? nil : .channel(snap.channel)
            _ = try Activity.request(attributes: TrainAttributes(window: "manual", from: snap.from), content: content, pushType: push)
            if !demo {
                self.snap = try await api.call("POST", "/api/live", body: LiveRequest(from: snap.from))
            }
            error = nil
        } catch {
            self.error = "Couldn't put it on the lock screen: \(error.localizedDescription)"
        }
        refreshLiveHere()
    }

    func stopLive() async {
        for activity in Activity<TrainAttributes>.activities { await activity.end(nil, dismissalPolicy: .immediate) }
        if !demo { _ = try? await api.call("DELETE", "/api/live", as: OK.self) }
        await refresh()
    }

    /// No automatic start today (working from home, a day off).
    func skipToday() async {
        guard !demo else { return }
        do {
            _ = try await api.call("POST", "/api/skip", as: TreniSettings.self)
            for activity in Activity<TrainAttributes>.activities where activity.attributes.window != "manual" {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        } catch { self.error = error.localizedDescription }
        await refresh()
    }

    func unskip(_ date: String) async {
        guard !demo else { return }
        _ = try? await api.call("DELETE", "/api/skip", query: ["date": date], as: TreniSettings.self)
        await refresh()
    }

    func save(_ settings: TreniSettings) async throws {
        guard !demo else { return }
        _ = try await api.call("PUT", "/api/settings", body: settings, as: TreniSettings.self)
        await refresh()
    }

    func searchStations(_ query: String) async -> [Station] {
        if demo { return [Station(code: "S08408", name: "Roma Tuscolana"), Station(code: "S08406", name: "Roma Ostiense")] }
        return (try? await api.call("GET", "/api/stations", query: ["q": query], as: [Station].self)) ?? []
    }

    /// The token that lets the server start a Live Activity on this phone by itself. iOS hands it over (and
    /// sometimes a new one) while the app runs; the server keeps the latest.
    func watchPushToStart() async {
        guard !demo, api.configured else { return }
        for await data in Activity<TrainAttributes>.pushToStartTokenUpdates {
            let token = data.map { String(format: "%02x", $0) }.joined()
            let body = RegisterRequest(token: token, device: UIDevice.current.name,
                                       frequent: ActivityAuthorizationInfo().frequentPushesEnabled)
            _ = try? await api.call("POST", "/api/register", body: body, as: OK.self)
        }
    }

    func watchActivities() async {
        for await _ in Activity<TrainAttributes>.activityUpdates { refreshLiveHere() }
    }
}
