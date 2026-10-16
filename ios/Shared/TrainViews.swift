import SwiftUI

// The Live Activity's views: the lock screen, the Dynamic Island's pieces and the Watch. They live here, outside the
// widget extension, so the app can show the same thing (its preview, and the CI's pictures of them).
// Few numbers on purpose (Jordan, 16 Oct 2026: "there are so many numbers there"): the countdown, the time and how
// late, the platform, and the one train after. No arrival time, and no "updated" unless the data has gone stale.
// With a walk time set (Settings), the countdown is to when to set off ("Leave in") until that has passed, then to
// the train ("Train leaves in"); the server decides which by sending `walk` or not.

enum Board {
    /// A departure board's dark blue.
    static let background = Color(red: 0.06, green: 0.09, blue: 0.17)
    static let accent = Color(red: 0.25, green: 0.82, blue: 0.48)
}

enum Fmt {
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = TimeZone(identifier: "Europe/Rome")
        return f
    }()

    /// Added to every time shown. Only the simulator's demo sets it, so its pictures read Monday 08:05 whenever they
    /// are taken (the countdowns still run on the real clock).
    static var shift: Double = 0

    static func hm(_ seconds: Double) -> String { formatter.string(from: Date(timeIntervalSince1970: seconds + shift)) }

    /// "Roma Tuscolana" → "Tuscolana": every station here is in Rome and the lock screen has little room.
    static func short(_ name: String) -> String {
        name.replacingOccurrences(of: "^Roma\\s+", with: "", options: [.regularExpression, .caseInsensitive])
    }
}

extension Train {
    var statusColor: Color { cancelled || delay >= 5 ? .red : delay > 0 ? .orange : .green }
    /// "on time", "2 min late", "cancelled"
    var statusText: String { cancelled ? "cancelled" : delay > 0 ? "\(delay) min late" : "on time" }

    /// The app's list has room for more: "Platform 5 · at Tuscolana 10:07"
    func detailLine(to: String) -> String {
        var parts: [String] = []
        if let plat { parts.append("Platform \(plat)") }
        if let arr { parts.append("at \(to) \(Fmt.hm(arr))") }
        return parts.isEmpty ? dest : parts.joined(separator: " · ")
    }
}

/// Minutes and seconds to the expected departure, or to the time to set off for it when `walk` is given. The phone
/// ticks it by itself between the server's updates. (A whole-minutes countdown that ticks by itself isn't reliable
/// in a Live Activity on iOS 18.)
struct Countdown: View {
    let train: Train
    /// When the data was fetched: the timer's range has to start no later than its end.
    let updated: Double
    var walk: Int? = nil

    var body: some View {
        let end = Date(timeIntervalSince1970: train.exp - Double((walk ?? 0) * 60))
        let start = min(Date(timeIntervalSince1970: updated), end)
        Text(timerInterval: start...end, countsDown: true, showsHours: false)
            .monospacedDigit()
    }
}

struct DelayBadge: View {
    let train: Train
    var body: some View {
        Text(train.statusText)
            .font(.caption.weight(.bold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(train.statusColor.opacity(0.22), in: Capsule())
            .foregroundStyle(train.statusColor)
    }
}

/// "Then 17:57", "Then 17:57 4 min late": only the train after the next one.
struct ThenLine: View {
    let train: Train
    var body: some View {
        HStack(spacing: 4) {
            Text("Then").foregroundStyle(.secondary)
            Text(Fmt.hm(train.dep)).fontWeight(.semibold).monospacedDigit().strikethrough(train.cancelled)
            if train.cancelled || train.delay > 0 {
                Text(train.statusText).fontWeight(.semibold).foregroundStyle(train.statusColor)
            }
        }
        .font(.caption)
        .lineLimit(1)
    }
}

/// The lock screen (and the banner on phones without a Dynamic Island).
struct LockScreenView: View {
    let state: TrainAttributes.ContentState
    var stale = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "tram.fill").foregroundStyle(Board.accent)
                Text("To \(state.to)").font(.subheadline.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 4)
                if let plat = state.trains.first?.plat {
                    Text("Platform \(plat)").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            if let t = state.trains.first {
                HStack(alignment: .bottom) {
                    if t.cancelled {
                        Text("Cancelled").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.red)
                    } else {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(state.walk == nil ? "Train leaves in" : "Leave in").font(.caption).foregroundStyle(.secondary)
                            Countdown(train: t, updated: state.updated, walk: state.walk)
                                .font(.system(size: 34, weight: .bold, design: .rounded))
                                .frame(maxWidth: 130, alignment: .leading)
                        }
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(Fmt.hm(t.dep)).font(.title3.weight(.semibold)).monospacedDigit().strikethrough(t.cancelled)
                        if !t.cancelled {
                            Text(t.statusText).font(.caption.weight(.semibold)).foregroundStyle(t.statusColor)
                        }
                    }
                    .padding(.bottom, 4)
                }
            } else {
                Text(state.note ?? "No trains right now").font(.headline)
            }
            if let note = state.note, !state.trains.isEmpty {
                Text(note).font(.caption).foregroundStyle(.orange)
            }
            if state.trains.count > 1 || stale {
                HStack {
                    if state.trains.count > 1 { ThenLine(train: state.trains[1]) }
                    Spacer(minLength: 4)
                    if stale {
                        Text("Not updated since \(Fmt.hm(state.updated))").font(.caption2).foregroundStyle(.orange)
                    }
                }
            }
        }
        .padding(14)
        .foregroundStyle(.white)
    }
}

// MARK: Dynamic Island

struct IslandCompactLeading: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        Image(systemName: state.walk == nil ? "tram.fill" : "figure.walk")
            .font(.caption)
            .foregroundStyle(Board.accent)
    }
}

struct IslandCompactTrailing: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        if let t = state.trains.first {
            if t.cancelled {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
            } else {
                Countdown(train: t, updated: state.updated, walk: state.walk)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(t.statusColor)
                    .frame(maxWidth: 44)
            }
        } else {
            Image(systemName: "tram").foregroundStyle(.secondary)
        }
    }
}

struct IslandMinimal: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        if let t = state.trains.first, !t.cancelled {
            Countdown(train: t, updated: state.updated, walk: state.walk)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(t.statusColor)
                .frame(maxWidth: 36)
        } else {
            Image(systemName: "tram.fill").foregroundStyle(Board.accent)
        }
    }
}

struct IslandExpandedLeading: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        if let t = state.trains.first {
            VStack(alignment: .leading, spacing: 0) {
                Text(Fmt.hm(t.dep)).font(.title2.weight(.bold)).monospacedDigit().strikethrough(t.cancelled)
                Text(t.statusText).font(.caption.weight(.semibold)).foregroundStyle(t.statusColor)
            }
            .padding(.leading, 4)
        }
    }
}

struct IslandExpandedTrailing: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        if let t = state.trains.first {
            if t.cancelled {
                Text("Cancelled").font(.headline).foregroundStyle(.red)
            } else {
                VStack(alignment: .trailing, spacing: 0) {
                    Countdown(train: t, updated: state.updated, walk: state.walk)
                        .font(.title2.weight(.semibold))
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 90, alignment: .trailing)
                    Text(state.walk == nil ? "till it leaves" : "till you leave").font(.caption).foregroundStyle(.secondary)
                }
                .padding(.trailing, 4)
            }
        }
    }
}

struct IslandExpandedCenter: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        Text("To \(state.to)").font(.caption.weight(.semibold)).lineLimit(1)
    }
}

struct IslandExpandedBottom: View {
    let state: TrainAttributes.ContentState
    var stale = false
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if state.trains.isEmpty {
                Text(state.note ?? "No trains right now").font(.caption)
            } else {
                HStack {
                    if let plat = state.trains.first?.plat {
                        Text("Platform \(plat)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 4)
                    if state.trains.count > 1 { ThenLine(train: state.trains[1]) }
                }
            }
            if stale {
                Text("Not updated since \(Fmt.hm(state.updated))").font(.caption2).foregroundStyle(.orange)
            }
        }
        .padding(.horizontal, 4)
    }
}

// MARK: Apple Watch (Smart Stack)

struct WatchView: View {
    let state: TrainAttributes.ContentState
    var stale = false
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: "tram.fill").foregroundStyle(Board.accent)
                Text("To \(state.to)").font(.caption2.weight(.semibold)).lineLimit(1)
            }
            if let t = state.trains.first {
                if t.cancelled {
                    Text("Cancelled").font(.title3.weight(.bold)).foregroundStyle(.red)
                } else {
                    HStack(spacing: 3) {
                        if state.walk != nil { Image(systemName: "figure.walk").foregroundStyle(Board.accent) }
                        Countdown(train: t, updated: state.updated, walk: state.walk)
                    }
                    .font(.title3.weight(.bold))
                }
                HStack(spacing: 4) {
                    Text(Fmt.hm(t.dep)).monospacedDigit().strikethrough(t.cancelled)
                    if !t.cancelled { Text(t.statusText).foregroundStyle(t.statusColor) }
                }
                .font(.caption2.weight(.semibold))
                .lineLimit(1)
            } else {
                Text(state.note ?? "No trains").font(.caption)
            }
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
        .opacity(stale ? 0.6 : 1)
    }
}
