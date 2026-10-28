import SwiftUI

struct ContentView: View {
    @EnvironmentObject var model: Model
    // -screen settings, daysoff or addday: Settings open, for the CI's pictures (ci/sim-shots.sh).
    @State private var showSettings = ["settings", "daysoff", "addday"].contains { ProcessInfo.processInfo.arguments.contains($0) }
    @Environment(\.scenePhase) private var phase

    var body: some View {
        NavigationStack {
            // Top to bottom: which way, the lock screen as it looks, its switches, then the trains. The preview was
            // at the bottom until 28 Oct 2026 (Jordan: "should just be at the top of the app screen itself").
            List {
                if let error = model.error {
                    Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
                }
                if let snap = model.snap {
                    if let welcome = snap.welcome ?? (snap.setup == true ? Snapshot.welcome : nil) {
                        Section {
                            Button { showSettings = true } label: { Label(welcome, systemImage: "hand.wave.fill") }
                        }
                    }
                    directionSection(snap)
                    Section("What the lock screen shows") {
                        LockScreenView(state: snap.content)
                            .background(Board.background, in: RoundedRectangle(cornerRadius: 22))
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                    }
                    liveSection(snap)
                    trainsSection(snap)
                } else if model.loading || model.error == nil {
                    Section { HStack { Spacer(); ProgressView(); Spacer() } }
                }
            }
            .listSectionSpacing(.compact)
            .navigationTitle("Treni")
            .refreshable { await model.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .disabled(model.snap == nil)
                        .accessibilityLabel("Settings")
                }
            }
            .sheet(isPresented: $showSettings) {
                if let settings = model.snap?.settings {
                    SettingsView(settings: settings).environmentObject(model)
                }
            }
        }
        // Fresh trains every 30 seconds while the app is open.
        .task(id: phase) {
            guard phase == .active else { return }
            if ProcessInfo.processInfo.arguments.contains("-live"), !model.liveHere {
                await model.refresh()
                await model.startLive()
            }
            while !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    /// To work or to home: it sets both the preview and the trains under it.
    private func directionSection(_ snap: Snapshot) -> some View {
        Section {
            Picker("Direction", selection: Binding(get: { snap.from }, set: { new in
                model.choice = new
                Task { await model.refresh() }
            })) {
                Text("To \(Fmt.short(snap.settings.work.name))").tag("home")
                Text("To \(Fmt.short(snap.settings.home.name))").tag("work")
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
    }

    private func trainsSection(_ snap: Snapshot) -> some View {
        Section {
            if snap.trains.isEmpty {
                Text(snap.content.note ?? "No trains in the next hour").foregroundStyle(.secondary)
            }
            ForEach(snap.trains) { TrainRow(train: $0, to: snap.content.to, now: snap.now) }
        } header: {
            Text("Next trains")
        } footer: {
            Text("Trains that stop at both stations, from Viaggiatreno. Updated \(Fmt.hm(snap.now)).")
        }
    }

    // Switches, not buttons. "Day off today: don't start by itself" read like a status, and so did what it turned
    // into; on 20 Oct 2026 a tester skipped a day without knowing, then wondered why nothing came up. A switch shows
    // which way it's set, and the line under it says what that means today.
    private func liveSection(_ snap: Snapshot) -> some View {
        let skipped = snap.settings.skip?.contains(snap.today) ?? false
        let auto = skipped || todayHasWindows(snap)
        let next = nextStart(snap).map { "Next: \($0)." }
        let autoDetail = skipped ? ["Day off today.", next].compactMap { $0 }.joined(separator: " ") : next
        return Section {
            Toggle(isOn: Binding(get: { model.liveHere }, set: { on in
                model.liveHere = on // now, or the switch flicks back until iOS catches up
                Task { if on { await model.startLive() } else { await model.stopLive() } }
            })) {
                SwitchLabel(title: "On the lock screen now", icon: "lock.iphone",
                            detail: model.liveHere ? snap.live.map { "Until \(Fmt.hm($0.until))." } : nil)
            }
            if auto {
                Toggle(isOn: Binding(get: { !skipped }, set: { on in
                    Task { if on { await model.unskip(snap.today) } else { await model.skipToday() } }
                })) {
                    SwitchLabel(title: "Start by itself today", icon: skipped ? "moon.zzz" : "calendar.badge.clock",
                                detail: autoDetail, warn: skipped)
                }
            }
        } footer: {
            Text(liveFooter(snap, next: !auto))
        }
    }

    private func todayHasWindows(_ snap: Snapshot) -> Bool {
        let dow = (Calendar(identifier: .iso8601).component(.weekday, from: Date()) + 5) % 7 + 1 // Monday = 1
        return snap.settings.windows.contains { $0.on && $0.days.contains(dow) }
    }

    /// "today at 16:45, to Tuscolana"
    private func nextStart(_ snap: Snapshot) -> String? {
        guard let next = snap.next, let w = snap.settings.windows.first(where: { $0.id == next.id }) else { return nil }
        let to = Fmt.short(w.from == "home" ? snap.settings.work.name : snap.settings.home.name)
        let day = next.date == snap.today ? "today" : ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][next.dow]
        return "\(day) at \(next.start), to \(to)"
    }

    private func liveFooter(_ snap: Snapshot, next: Bool) -> String {
        var lines: [String] = []
        if next, let start = nextStart(snap) { lines.append("Next by itself: \(start).") }
        if snap.registered == 0 { lines.append("This phone hasn't been registered for automatic starts yet: keep the app open a moment.") }
        if snap.dry { lines.append("The server has no push key yet, so the lock screen won't update by itself.") }
        return lines.joined(separator: " ")
    }
}

/// A switch's words: what it does, and under it how things stand.
struct SwitchLabel: View {
    let title: String
    let icon: String
    var detail: String?
    var warn = false

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let detail { Text(detail).font(.footnote).foregroundStyle(warn ? Color.orange : Color.secondary) }
            }
        } icon: { Image(systemName: icon).foregroundStyle(warn ? Color.orange : Color.accentColor) }
    }
}

struct TrainRow: View {
    let train: Train
    let to: String
    let now: Double

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(Fmt.hm(train.dep)).font(.title3.weight(.bold)).monospacedDigit().strikethrough(train.cancelled)
                    DelayBadge(train: train)
                }
                Text(train.detailLine(to: to)).font(.subheadline).foregroundStyle(.secondary)
                Text("\(train.dest) · \(train.n)").font(.caption).foregroundStyle(.tertiary)
            }
            Spacer()
            // Not past the hour: "65:41" read as a clock, not a countdown. The time on the left says enough.
            if !train.cancelled, train.exp - now < 3600 {
                Countdown(until: train.exp, updated: now)
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 80, alignment: .trailing)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine) // VoiceOver reads each train as one line
    }
}
