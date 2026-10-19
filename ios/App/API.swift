import Foundation

/// The Treni server on the VM (server/treni.mjs), at treni.jordancox.org. Every call carries the shared secret,
/// which the cloud build puts in Info.plist from the repo's secrets (TRENI_SECRET); it's never in the repo.
struct API {
    let base: URL
    let secret: String

    static let shared: API = {
        let info = Bundle.main.infoDictionary ?? [:]
        let base = (info["TreniServer"] as? String).flatMap { URL(string: $0) } ?? URL(string: "https://treni.jordancox.org")!
        return API(base: base, secret: info["TreniSecret"] as? String ?? "")
    }()

    var configured: Bool { !secret.isEmpty }

    /// This phone's id on the server: random, made once and kept. Each phone has its own settings and Live Activity
    /// there (server/lib/phones.mjs).
    static let phone: String = {
        if let id = UserDefaults.standard.string(forKey: "phone") { return id }
        let id = UUID().uuidString.lowercased()
        UserDefaults.standard.set(id, forKey: "phone")
        return id
    }()

    func call<T: Decodable>(_ method: String, _ path: String, query: [String: String] = [:],
                            body: (any Encodable)? = nil, as type: T.Type = T.self) async throws -> T {
        var parts = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { parts.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var request = URLRequest(url: parts.url!, timeoutInterval: 20)
        request.httpMethod = method
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.setValue(API.phone, forHTTPHeaderField: "X-Treni-Phone")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
                ?? HTTPURLResponse.localizedString(forStatusCode: status)
            throw APIError(message: "The train server said: \(message) (\(status))")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct OK: Decodable { var ok: Bool? }

// What the server sends and takes (server/treni.mjs, snapshot and routes).

struct Station: Codable, Hashable {
    var code: String
    var name: String
    /// Minutes from setting off to standing on this station's platform (Settings).
    var walk: Int? = nil
}

struct TripWindow: Codable, Hashable, Identifiable {
    var id: String
    /// "home" or "work"
    var from: String
    /// "07:30", Rome time
    var start: String
    var end: String
    /// 1 = Monday … 7 = Sunday
    var days: [Int]
    var on: Bool
}

struct TreniSettings: Codable, Hashable {
    var home: Station
    var work: Station
    var windows: [TripWindow]
    /// Days off, "2026-11-01"
    var skip: [String]?
}

struct Snapshot: Decodable {
    struct Live: Decodable { var kind: String; var from: String; var until: Double }
    struct Next: Decodable { var id: String; var date: String; var dow: Int; var start: String }

    var now: Double
    var from: String
    var settings: TreniSettings
    var trains: [Train]
    /// Ready to hand to ActivityKit when the app starts the Live Activity itself.
    var content: TrainAttributes.ContentState
    /// The broadcast channel for this direction.
    var channel: String
    var live: Live?
    var next: Next?
    var today: String
    var registered: Int
    /// A phone the server has only just met: its owner hasn't saved their own stations and times yet.
    var setup: Bool? = nil
    /// The line at the top that opens Settings (the welcome on a new phone), worded by the server. Without it, a new
    /// phone gets `Snapshot.welcome`.
    var welcome: String? = nil
    /// The server has no push key yet, so a Live Activity started here won't be updated.
    var dry: Bool
}

extension Snapshot {
    static let welcome = "Welcome! Set your home station, the walk to each platform, and when it should turn up on your lock screen by itself."
}

struct LiveRequest: Encodable { var from: String }
struct RegisterRequest: Encodable { var token: String; var device: String; var frequent: Bool }
