import SwiftUI

// Treni: Jordan's commute (Roma Tuscolana ↔ Muratella by default) as a Live Activity. The app shows the next
// trains and the settings; the server on the VM (server/treni.mjs) starts the Live Activity at the set times and
// keeps it up to date. Launch arguments for the simulator: -demo (sample trains), -shots (pictures of the Live
// Activity's views), -live (start one), -screen settings.
@main
struct TreniApp: App {
    @StateObject private var model = Model()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .task { await model.watchPushToStart() }
                .task { await model.watchActivities() }
                .task { Shots.write() }
        }
    }
}
