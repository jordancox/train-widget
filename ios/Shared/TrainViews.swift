import SwiftUI

// The Live Activity's views: the lock screen, the Dynamic Island's pieces and the Watch. They live here, outside the
// widget extension, so the app can show the same thing (its preview, and the CI's pictures of them).

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

    static func hm(_ seconds: Double) -> String { formatter.string(from: Date(timeIntervalSince1970: seconds)) }

    /// "Roma Tuscolana" → "Tuscolana": every station here is in Rome and the lock screen has little room.
    static func short(_ name: String) -> String {
        name.replacingOccurrences(of: "^Roma\\s+", with: "", options: [.regularExpression, .caseInsensitive])
    }
}

extension Train {
    var statusColor: Color { cancelled || delay >= 5 ? .red : delay > 0 ? .orange : .green }
    var statusText: String { cancelled ? "cancelled" : delay > 0 ? "+\(delay)" : "on time" }

    /// "Platform 5 · arrives 09:32"
    var detailLine: String {
        var parts: [String] = []
        if let plat { parts.append("Platform \(plat)") }
        if let arr { parts.append("arrives \(Fmt.hm(arr))") }
        return parts.isEmpty ? dest : parts.joined(separator: " · ")
    }
}

/// Minutes and seconds to the expected departure. The phone ticks it by itself between the server's updates.
struct Countdown: View {
    let train: Train
    /// When the data was fetched: the timer's range has to start no later than its end.
    let updated: Double

    var body: some View {
        let end = Date(timeIntervalSince1970: train.exp)
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

/// "Then 09:22 · 09:37 +3"
struct ThenLine: View {
    let trains: [Train]
    var body: some View {
        HStack(spacing: 10) {
            Text("Then").foregroundStyle(.secondary)
            ForEach(trains) { t in
                HStack(spacing: 3) {
                    Text(Fmt.hm(t.dep)).fontWeight(.semibold).monospacedDigit().strikethrough(t.cancelled)
                    if t.cancelled || t.delay > 0 {
                        Text(t.cancelled ? "✕" : "+\(t.delay)").fontWeight(.bold).foregroundStyle(t.statusColor)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .font(.caption)
    }
}

/// The lock screen (and the banner on phones without a Dynamic Island).
struct LockScreenView: View {
    let state: TrainAttributes.ContentState
    var stale = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "tram.fill").foregroundStyle(Board.accent)
                Text("\(state.from) → \(state.to)").font(.subheadline.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 4)
                Text(stale ? "Not updated since \(Fmt.hm(state.updated))" : "Updated \(Fmt.hm(state.updated))")
                    .font(.caption2)
                    .foregroundStyle(stale ? Color.orange : Color.secondary)
            }
            if let t = state.trains.first {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(Fmt.hm(t.dep))
                                .font(.system(size: 30, weight: .bold, design: .rounded))
                                .monospacedDigit()
                                .strikethrough(t.cancelled)
                            DelayBadge(train: t)
                        }
                        Text(t.detailLine).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    if t.cancelled {
                        Text("Cancelled").font(.title3.weight(.bold)).foregroundStyle(.red)
                    } else {
                        Countdown(train: t, updated: state.updated)
                            .font(.system(size: 30, weight: .semibold, design: .rounded))
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 110, alignment: .trailing)
                    }
                }
            } else {
                Text(state.note ?? "No trains right now").font(.headline)
            }
            if let note = state.note, !state.trains.isEmpty {
                Text(note).font(.caption).foregroundStyle(.orange)
            }
            if state.trains.count > 1 {
                ThenLine(trains: Array(state.trains.dropFirst()))
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
        HStack(spacing: 3) {
            Image(systemName: "tram.fill")
            if let plat = state.trains.first?.plat { Text(plat).fontWeight(.bold) }
        }
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
                Countdown(train: t, updated: state.updated)
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
            Countdown(train: t, updated: state.updated)
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
            VStack(alignment: .leading, spacing: 2) {
                Text(Fmt.hm(t.dep)).font(.title2.weight(.bold)).monospacedDigit().strikethrough(t.cancelled)
                DelayBadge(train: t)
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
                Countdown(train: t, updated: state.updated)
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 90, alignment: .trailing)
                    .padding(.trailing, 4)
            }
        }
    }
}

struct IslandExpandedCenter: View {
    let state: TrainAttributes.ContentState
    var body: some View {
        Text("\(state.from) → \(state.to)").font(.caption.weight(.semibold)).lineLimit(1)
    }
}

struct IslandExpandedBottom: View {
    let state: TrainAttributes.ContentState
    var stale = false
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let t = state.trains.first {
                Text(t.detailLine).font(.caption).foregroundStyle(.secondary)
            } else {
                Text(state.note ?? "No trains right now").font(.caption)
            }
            if state.trains.count > 1 { ThenLine(trains: Array(state.trains.dropFirst())) }
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
                Text("→ \(state.to)").font(.caption2.weight(.semibold)).lineLimit(1)
            }
            if let t = state.trains.first {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(Fmt.hm(t.dep)).font(.headline).monospacedDigit().strikethrough(t.cancelled)
                    Text(t.statusText).font(.caption2.weight(.bold)).foregroundStyle(t.statusColor)
                }
                if t.cancelled {
                    Text("Cancelled").font(.title3.weight(.bold)).foregroundStyle(.red)
                } else {
                    Countdown(train: t, updated: state.updated).font(.title3.weight(.bold))
                }
                Text(t.plat.map { "Platform \($0)" } ?? t.dest).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            } else {
                Text(state.note ?? "No trains").font(.caption)
            }
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
        .opacity(stale ? 0.6 : 1)
    }
}
