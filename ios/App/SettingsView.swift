import SwiftUI

/// Stations, the times the Live Activity starts by itself, and days off. Saved on the server, which does the starting.
struct SettingsView: View {
    @EnvironmentObject var model: Model
    @Environment(\.dismiss) private var dismiss
    @State private var settings: TreniSettings
    @State private var saving = false
    @State private var error: String?
    @State private var newDayOff = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()

    init(settings: TreniSettings) { _settings = State(initialValue: settings) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    NavigationLink {
                        StationSearch(title: "Home station") { settings.home = $0 }
                    } label: { LabeledContent("Home", value: settings.home.name) }
                    NavigationLink {
                        StationSearch(title: "Work station") { settings.work = $0 }
                    } label: { LabeledContent("Work", value: settings.work.name) }
                } header: { Text("Stations") } footer: {
                    Text("Only trains that stop at both are shown.")
                }

                ForEach($settings.windows) { $w in
                    Section {
                        Toggle("Start by itself", isOn: $w.on)
                        Group {
                            DatePicker("From", selection: time($w.start), displayedComponents: .hourAndMinute)
                            DatePicker("Until", selection: time($w.end), displayedComponents: .hourAndMinute)
                        }
                        .environment(\.locale, Locale(identifier: "en_GB")) // 24-hour, like the trains
                        DaysPicker(days: $w.days)
                    } header: {
                        Text("To \(Fmt.short(w.from == "home" ? settings.work.name : settings.home.name))")
                    }
                }

                Section {
                    ForEach(settings.skip ?? [], id: \.self) { day in Text(Self.pretty(day)) }
                        .onDelete { settings.skip?.remove(atOffsets: $0) }
                    DatePicker("Day", selection: $newDayOff, in: Date()..., displayedComponents: .date)
                    Button("Add day off") {
                        let day = Self.iso(newDayOff)
                        settings.skip = Array(Set((settings.skip ?? []) + [day])).sorted()
                    }
                } header: { Text("Days off") } footer: {
                    Text("Holidays and days at home: it won't start by itself on these.")
                }

                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            saving = true
                            defer { saving = false }
                            do { try await model.save(settings); dismiss() } catch { self.error = error.localizedDescription }
                        }
                    }
                    .disabled(saving || !valid)
                }
            }
        }
    }

    private var valid: Bool {
        settings.home.code != settings.work.code && settings.windows.allSatisfy { $0.end > $0.start }
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
}

struct DaysPicker: View {
    @Binding var days: [Int]
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
