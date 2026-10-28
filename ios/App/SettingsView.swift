import SwiftUI

/// Stations, the times the Live Activity starts by itself, and days off. Saved on the server, which does the starting.
struct SettingsView: View {
    @EnvironmentObject var model: Model
    @Environment(\.dismiss) private var dismiss
    @State private var settings: TreniSettings
    @State private var saving = false
    @State private var error: String?
    @State private var addingDayOff = false
    /// As it came from the server: Save waits for a change, and a swipe down can't throw one away.
    private let saved: TreniSettings

    init(settings: TreniSettings) {
        saved = settings
        _settings = State(initialValue: settings)
    }

    private var changed: Bool { settings != saved }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                Form {
                    Section {
                        NavigationLink {
                            StationSearch(title: "Home station") { settings.home = Station(code: $0.code, name: $0.name, walk: settings.home.walk) }
                        } label: { LabeledContent("Home", value: settings.home.name) }
                        Stepper(value: walk(\.home), in: 0...30) {
                            LabeledContent("Walk to the platform", value: "\(settings.home.walk ?? 0) min")
                        }
                        NavigationLink {
                            StationSearch(title: "Work station") { settings.work = Station(code: $0.code, name: $0.name, walk: settings.work.walk) }
                        } label: { LabeledContent("Work", value: settings.work.name) }
                        Stepper(value: walk(\.work), in: 0...30) {
                            LabeledContent("Walk to the platform", value: "\(settings.work.walk ?? 0) min")
                        }
                    } header: { Text("Stations") } footer: {
                        Text("Only trains that stop at both are shown. The walk is from setting off to standing on the platform, with a margin: the lock screen counts down to when to start walking, then to the train.")
                    }

                    ForEach($settings.windows) { $w in
                        Section {
                            Toggle("Start by itself", isOn: $w.on)
                            Group {
                                Group {
                                    DatePicker("From", selection: time($w.start), displayedComponents: .hourAndMinute)
                                    DatePicker("Until", selection: time($w.end), displayedComponents: .hourAndMinute)
                                }
                                .environment(\.locale, Locale(identifier: "en_GB")) // 24-hour, like the trains
                                DaysPicker(days: $w.days)
                            }
                            .disabled(!w.on) // kept for when it's switched back on, but greyed so it doesn't look in use
                        } header: {
                            Text("To \(Fmt.short(w.from == "home" ? settings.work.name : settings.home.name))")
                        }
                    }

                    // Only days that are off show a date. Until 28 Oct 2026 a date picker sat here ready for the next one,
                    // already showing tomorrow, and read as if tomorrow were a day off (Jordan). Picking is its own sheet.
                    Section {
                        ForEach(settings.skip ?? [], id: \.self) { day in
                            HStack {
                                Label { Text(Self.listed(day)) } icon: { Image(systemName: "moon.zzz").foregroundStyle(.orange) }
                                Spacer()
                                Button { settings.skip?.removeAll { $0 == day } } label: {
                                    Image(systemName: "xmark.circle.fill").font(.title3).foregroundStyle(.gray) // grey: blue read as "chosen"
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Not a day off")
                            }
                        }
                        .onDelete { settings.skip?.remove(atOffsets: $0) }
                        Button { addingDayOff = true } label: { Label("Add a day off", systemImage: "plus.circle.fill") }
                            .id("daysoff")
                    } header: { Text("Days off") } footer: {
                        Text("Holidays and days at home: it won't start by itself on these.")
                    }

                    if let error {
                        Section { Text(error).foregroundStyle(.red) }
                    }
                }
                .sheet(isPresented: $addingDayOff) {
                    AddDayOff(taken: settings.skip ?? [], first: firstWorkingDay) { day in
                        settings.skip = Array(Set((settings.skip ?? []) + [day])).sorted()
                    }
                }
                // -screen daysoff / addday: scrolled to the days off, or picking one, for the CI's pictures.
                .task {
                    let args = ProcessInfo.processInfo.arguments
                    guard args.contains("daysoff") || args.contains("addday") else { return }
                    try? await Task.sleep(for: .milliseconds(600))
                    proxy.scrollTo("daysoff", anchor: .bottom)
                    if args.contains("addday") { try? await Task.sleep(for: .milliseconds(400)); addingDayOff = true }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save") {
                            Task {
                                saving = true
                                defer { saving = false }
                                do { try await model.save(settings); dismiss() } catch { self.error = error.localizedDescription }
                            }
                        }
                        .disabled(!valid || !changed)
                    }
                }
            }
        }
        // A day off added and then the sheet swiped away was lost without a word: with changes, only Cancel discards.
        .interactiveDismissDisabled(changed)
    }

    /// The first day the calendar offers: the next one it would start by itself on that isn't off already.
    private var firstWorkingDay: Date {
        let calendar = Calendar.current
        let days = Set(settings.windows.filter(\.on).flatMap(\.days))
        for ahead in 1...21 {
            guard let date = calendar.date(byAdding: .day, value: ahead, to: Date()) else { break }
            let dow = (calendar.component(.weekday, from: date) + 5) % 7 + 1 // Monday = 1
            if days.isEmpty || days.contains(dow), !(settings.skip ?? []).contains(Self.iso(date)) { return date }
        }
        return calendar.date(byAdding: .day, value: 1, to: Date()) ?? Date()
    }

    private var valid: Bool {
        settings.home.code != settings.work.code && settings.windows.allSatisfy { $0.end > $0.start }
    }

    private func walk(_ station: WritableKeyPath<TreniSettings, Station>) -> Binding<Int> {
        Binding(get: { settings[keyPath: station].walk ?? 0 }, set: { settings[keyPath: station].walk = $0 })
    }

    /// "07:30" ⇄ a time for the picker.
    private func time(_ text: Binding<String>) -> Binding<Date> {
        Binding(get: {
            let p = text.wrappedValue.split(separator: ":").compactMap { Int($0) }
            return Calendar.current.date(bySettingHour: p.first ?? 0, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date()) ?? Date()
        }, set: { date in
            let c = Calendar.current.dateComponents([.hour, .minute], from: date)
            text.wrappedValue = String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
        })
    }

    static func iso(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func pretty(_ iso: String) -> String {
        let p = iso.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, let date = Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) else { return iso }
        return date.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }

    /// In the days off list: "Tomorrow (Thursday 29 October)"
    static func listed(_ iso: String) -> String {
        let p = iso.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, let date = Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) else { return iso }
        if Calendar.current.isDateInToday(date) { return "Today (\(pretty(iso)))" }
        if Calendar.current.isDateInTomorrow(date) { return "Tomorrow (\(pretty(iso)))" }
        return pretty(iso)
    }
}

struct DaysPicker: View {
    @Binding var days: [Int]
    @Environment(\.isEnabled) private var enabled
    private let labels = ["M", "T", "W", "T", "F", "S", "S"]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(1...7, id: \.self) { day in
                let on = days.contains(day)
                Button {
                    if on { days.removeAll { $0 == day } } else { days = (days + [day]).sorted() }
                } label: {
                    Text(labels[day - 1])
                        .font(.subheadline.weight(.semibold))
                        .frame(width: 34, height: 34)
                        .background(on ? Color.accentColor : Color.secondary.opacity(0.15), in: Circle())
                        .foregroundStyle(on ? Color.white : Color.primary)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity)
        .opacity(enabled ? 1 : 0.4)
    }
}

/// A calendar to pick one day off, with what it means under it. "Add" adds it to the list; Settings' Save keeps it.
struct AddDayOff: View {
    let taken: [String]
    let add: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var day: Date

    init(taken: [String], first: Date, add: @escaping (String) -> Void) {
        self.taken = taken
        self.add = add
        _day = State(initialValue: first)
    }

    var body: some View {
        let iso = SettingsView.iso(day)
        let already = taken.contains(iso)
        NavigationStack {
            Form {
                Section {
                    DatePicker("Day", selection: $day, in: Calendar.current.startOfDay(for: Date())..., displayedComponents: .date)
                        .datePickerStyle(.graphical)
                } footer: {
                    Text(already ? "\(SettingsView.pretty(iso)) is a day off already."
                                 : "It won't start by itself on \(SettingsView.pretty(iso)).")
                }
            }
            .navigationTitle("Add a day off")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { add(iso); dismiss() }.disabled(already)
                }
            }
        }
    }
}

struct StationSearch: View {
    let title: String
    let pick: (Station) -> Void
    @EnvironmentObject var model: Model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [Station] = []

    var body: some View {
        List(results, id: \.code) { station in
            Button {
                pick(station)
                dismiss()
            } label: {
                LabeledContent(station.name, value: station.code)
            }
            .foregroundStyle(.primary)
        }
        .navigationTitle(title)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Start of the name, e.g. Tuscolana")
        .task(id: query) {
            guard query.count >= 2 else { results = []; return }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            results = await model.searchStations(query)
        }
    }
}
