import ActivityKit
import SwiftUI
import WidgetKit

// The widget extension: only the Live Activity. Its views are in ../Shared/TrainViews.swift.

@main
struct TreniLiveBundle: WidgetBundle {
    var body: some Widget {
        TrainLiveActivity()
    }
}

struct TrainLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TrainAttributes.self) { context in
            ActivityRoot(state: context.state, stale: context.isStale)
                .activityBackgroundTint(Board.background)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { IslandExpandedLeading(state: context.state) }
                DynamicIslandExpandedRegion(.trailing) { IslandExpandedTrailing(state: context.state) }
                DynamicIslandExpandedRegion(.center) { IslandExpandedCenter(state: context.state) }
                DynamicIslandExpandedRegion(.bottom) { IslandExpandedBottom(state: context.state, stale: context.isStale) }
            } compactLeading: {
                IslandCompactLeading(state: context.state)
            } compactTrailing: {
                IslandCompactTrailing(state: context.state)
            } minimal: {
                IslandMinimal(state: context.state)
            }
            .keylineTint(Board.accent)
        }
        .supplementalActivityFamilies([.small])
    }
}

/// The lock screen, or the Watch's Smart Stack (the .small family).
struct ActivityRoot: View {
    @Environment(\.activityFamily) private var family
    let state: TrainAttributes.ContentState
    let stale: Bool

    var body: some View {
        switch family {
        case .small:
            WatchView(state: state, stale: stale).padding(8)
        default:
            LockScreenView(state: state, stale: stale)
        }
    }
}
