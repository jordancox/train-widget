import SwiftUI

struct ContentView: View {
    @EnvironmentObject var model: Model
    @State private var showSettings = ProcessInfo.processInfo.arguments.contains("settings")
    @Environment(\.scenePhase) private var phase

    var body: some View {
        NavigationStack {
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
                    trainsSection(snap)
                    liveSection(snap)
                    Section("On the lock screen") {
                        LockScreenView(state: snap.content)
                            .background(Board.background, in: RoundedRectangle(cornerRadius: 22))
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                    }
                } else if model.loading || model.error == nil {
                    Section { HStack { Spacer(); ProgressView(); Spacer() } }
                }
            }
            .navigationTitle("Treni")
            .refreshable { await model.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .disabled(model.snap == nil)
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

    private func trainsSection(_ snap: Snapshot) -> some View {
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

            if snap.trains.isEmpty {
                Text(snap.content.note ?? "No trains in the next hour").foregroundStyle(.secondary)
            }
            ForEach(snap.trains) { TrainRow(train: $0, to: snap.content.to, now: snap.now) }
        } footer: {
            Text("Trains that stop at both stations, from Viaggiatreno. Updated \(Fmt.hm(snap.now)).")
        }
    }

    private func liveSection(_ snap: Snapshot) -> some View {
        Section {
            if model.liveHere {
                Button(role: .destructive) { Task { await model.stopLive() } } label: {
                    Label("Take off the lock screen", systemImage: "xmark.circle")
                }
            } else {
                Button { Task { await model.startLive() } } label: {
                    Label("Show on the lock screen now", systemImage: "lock.iphone")
                }
            }
            let skipped = snap.settings.skip?.contains(snap.today) ?? false
            if skipped {
                Button { Task { await model.unskip(snap.today) } } label: {
                    Label("Today is off. Start by itself again today", systemImage: "arrow.uturn.backward")
                }
            } else if todayHasWindows(snap) {
                Button { Task { await model.skipToday() } } label: {
                    Label("Day off today: don't start by itself", systemImage: "moon.zzz")
                }
            }
        } footer: {
            Text(liveFooter(snap))
        }
    }

    private func todayHasWindows(_ snap: Snapshot) -> Bool {
        let dow = (Calendar(identifier: .iso8601).component(.weekday, from: Date()) + 5) % 7 + 1 // Monday = 1
        return snap.settings.windows.contains { $0.on && $0.days.contains(dow) }
    }

    private func liveFooter(_ snap: Snapshot) -> String {
        var lines: [String] = []
        if let live = snap.live {
            lines.append("Live until \(Fmt.hm(live.until)).")
        }
        if let next = snap.next, let w = snap.settings.windows.first(where: { $0.id == next.id }) {
            let to = Fmt.short(w.from == "home" ? snap.settings.work.name : snap.settings.home.name)
            let day = next.date == snap.today ? "today" : ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][next.dow]
            lines.append("Next by itself: \(day) at \(next.start), to \(to).")
        }
        if snap.registered == 0 { lines.append("This phone hasn't been registered for automatic starts yet: keep the app open a moment.") }
        if snap.dry { lines.append("The server has no push key yet, so the lock screen won't update by itself.") }
        return lines.joined(separator: " ")
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
            if !train.cancelled {
                Countdown(until: train.exp, updated: now)
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 80, alignment: .trailing)
            }
        }
        .padding(.vertical, 2)
    }
}
