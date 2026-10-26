import AppIntents
import SwiftUI

// The Live Activity's views: the lock screen, the Dynamic Island's pieces and the Watch. They live here, outside the
// widget extension, so the app can show the same thing (its preview, and the CI's pictures of them).
// Few numbers on purpose (Jordan, 16 Oct 2026: "there are so many numbers there"): the countdown, the time and how
// late, the platform, and the one train after. No arrival time, and no "updated" unless the data has gone stale.
// The words and what the countdowns count to come from the server (`show`, 19 Oct 2026), so they change without a
// new build; the `ContentState` extension below has the built-in wording for when it sends none.

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

/// What to say, from the server's `show` or else worked out here as before it sent one.
extension TrainAttributes.ContentState {
    var main: Train? { trains.first }
    var title: String { show?.title ?? "To \(to)" }
    var corner: String? { show?.corner ?? main?.plat.map { "Platform \($0)" } }
    /// Instead of the countdown: "Cancelled"
    var big: String? { show?.big ?? (main?.cancelled == true ? "Cancelled" : nil) }
    var label: String { show?.label ?? (walk == nil ? "Train leaves in" : "Start walking in") }
    var after: String { show?.after ?? (walk == nil ? "till it leaves" : "to start walking") }
    /// What the big countdown counts to: leaving for the train, or the train itself.
    var target: Double? { show?.until ?? main.map { $0.exp - Double((walk ?? 0) * 60) } }
    var icon: String { show?.icon ?? (walk == nil ? "tram.fill" : "figure.walk") }
    func time(_ t: Train) -> String { show?.time ?? Fmt.hm(t.dep) }
    func status(_ t: Train) -> String { show?.status ?? t.statusText }
    func tone(_ t: Train) -> Color { Board.tone(show?.tone) ?? t.statusColor }
}

extension Board {
    static func tone(_ name: String?) -> Color? {
        switch name {
        case "green": return Color.green
        case "orange": return Color.orange
        case "red": return Color.red
        case "white": return Color.white
        case "accent": return Board.accent
        default: return nil
        }
    }
}

/// Minutes and seconds to `until` (leaving, or the train). The phone ticks it by itself between the server's
/// updates. (A whole-minutes countdown that ticks by itself isn't reliable in a Live Activity on iOS 18.)
struct Countdown: View {
    let until: Double
    /// When the data was fetched: the timer's range has to start no later than its end.
    let updated: Double

    var body: some View {
        let end = Date(timeIntervalSince1970: until)
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

/// The server's bottom line (`show.line`), in place of "Then …": "Walking to the 08:37? Leaves in 4:12"
struct ExtraLine: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        HStack(spacing: 4) {
            Text(state.show?.line ?? "").foregroundStyle(Board.tone(state.show?.lineTone) ?? .secondary)
            if let until = state.show?.lineUntil {
                Countdown(until: until, updated: state.updated).fontWeight(.semibold).frame(maxWidth: 44, alignment: .leading)
            }
        }
        .font(.caption)
        .lineLimit(1)
    }
}

/// The server's button after the bottom line: "Yes" to "Walking to the 08:37?", or "Undo" (`WalkingTo`).
struct WalkButton: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        if let text = state.show?.button, let train = state.show?.buttonTrain {
            Button(intent: WalkingTo(train: train)) {
                Text(text)
                    .font(.caption.weight(.bold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 5)
                    .background(Board.accent.opacity(0.22), in: Capsule())
                    .foregroundStyle(Board.accent)
            }
            .buttonStyle(.plain)
        }
    }
}

/// "Then 17:57", or the server's line instead.
struct BottomLine: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        if state.show?.line != nil { ExtraLine(state: state) }
        else if state.trains.count > 1 { ThenLine(train: state.trains[1]) }
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
                Text(state.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 4)
                if let corner = state.corner {
                    Text(corner).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            if let t = state.main {
                HStack(alignment: .bottom) {
                    if let big = state.big {
                        Text(big).font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.red)
                    } else if let until = state.target {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(state.label).font(.caption).foregroundStyle(.secondary)
                            Countdown(until: until, updated: state.updated)
                                .font(.system(size: 34, weight: .bold, design: .rounded))
                                .frame(maxWidth: 130, alignment: .leading)
                        }
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(state.time(t)).font(.title3.weight(.semibold)).monospacedDigit().strikethrough(t.cancelled)
                        if !t.cancelled {
                            Text(state.status(t)).font(.caption.weight(.semibold)).foregroundStyle(state.tone(t))
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
            if state.trains.count > 1 || state.show?.line != nil || state.show?.button != nil || stale {
                HStack {
                    BottomLine(state: state)
                    Spacer(minLength: 4)
                    if stale {
                        Text("Not updated since \(Fmt.hm(state.updated))").font(.caption2).foregroundStyle(.orange)
                    }
                    WalkButton(state: state)
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
        Image(systemName: state.icon)
            .font(.caption)
            .foregroundStyle(Board.accent)
    }
}

struct IslandCompactTrailing: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        if let t = state.main {
            if state.big != nil {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
            } else if let until = state.target {
                Countdown(until: until, updated: state.updated)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(state.tone(t))
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
        if let t = state.main, state.big == nil, let until = state.target {
            Countdown(until: until, updated: state.updated)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(state.tone(t))
                .frame(maxWidth: 36)
        } else {
            Image(systemName: "tram.fill").foregroundStyle(Board.accent)
        }
    }
}

struct IslandExpandedLeading: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        if let t = state.main {
            VStack(alignment: .leading, spacing: 0) {
                Text(state.time(t)).font(.title2.weight(.bold)).monospacedDigit().strikethrough(t.cancelled)
                Text(t.cancelled ? t.statusText : state.status(t)).font(.caption.weight(.semibold))
                    .foregroundStyle(t.cancelled ? t.statusColor : state.tone(t))
            }
            .padding(.leading, 4)
        }
    }
}

struct IslandExpandedTrailing: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        if state.main != nil {
            if let big = state.big {
                Text(big).font(.headline).foregroundStyle(.red)
            } else if let until = state.target {
                VStack(alignment: .trailing, spacing: 0) {
                    Countdown(until: until, updated: state.updated)
                        .font(.title2.weight(.semibold))
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 90, alignment: .trailing)
                    Text(state.after).font(.caption).foregroundStyle(.secondary)
                }
                .padding(.trailing, 4)
            }
        }
    }
}

struct IslandExpandedCenter: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        Text(state.title).font(.caption.weight(.semibold)).lineLimit(1)
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
                    if let corner = state.corner {
                        Text(corner).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 4)
                    BottomLine(state: state)
                    WalkButton(state: state)
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
            // The Smart Stack has little room: the button ("I'm walking to the 08:37") takes the title's place.
            if let text = state.show?.buttonWatch, let train = state.show?.buttonTrain {
                Button(intent: WalkingTo(train: train)) {
                    Text(text)
                        .font(.caption2.weight(.bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                        .background(Board.accent.opacity(0.22), in: Capsule())
                        .foregroundStyle(Board.accent)
                }
                .buttonStyle(.plain)
            } else {
                HStack(spacing: 4) {
                    Image(systemName: "tram.fill").foregroundStyle(Board.accent)
                    Text(state.title).font(.caption2.weight(.semibold)).lineLimit(1)
                }
            }
            if let t = state.main {
                if let big = state.big {
                    Text(big).font(.title3.weight(.bold)).foregroundStyle(.red)
                } else if let until = state.target {
                    HStack(spacing: 3) {
                        if state.icon != "tram.fill" { Image(systemName: state.icon).foregroundStyle(Board.accent) }
                        Countdown(until: until, updated: state.updated)
                    }
                    .font(.title3.weight(.bold))
                }
                HStack(spacing: 4) {
                    Text(state.time(t)).monospacedDigit().strikethrough(t.cancelled)
                    if !t.cancelled { Text(state.status(t)).foregroundStyle(state.tone(t)) }
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
