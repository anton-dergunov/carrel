import Foundation
import ServiceManagement

/// This Mac's preferences for the app. What the page remembers (tabs, layout, the model) stays in
/// the page's own storage, as on any other device.
@MainActor
final class AppSettings: ObservableObject {
    static let shared = AppSettings()

    private enum Key {
        static let command = "CarrelCommand"
        static let library = "CarrelLibrary"
        static let engine = "CarrelEngine"
        static let port = "CarrelPort"
        static let menuBar = "CarrelShowInMenuBar"
    }

    private let defaults: UserDefaults

    @Published var server: ServerSettings { didSet { saveServer() } }
    @Published var showInMenuBar: Bool { didSet { defaults.set(showInMenuBar, forKey: Key.menuBar) } }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        server = ServerSettings(
            command: defaults.string(forKey: Key.command) ?? "",
            library: defaults.string(forKey: Key.library) ?? "",
            engine: defaults.string(forKey: Key.engine) ?? "",
            port: defaults.integer(forKey: Key.port)
        )
        showInMenuBar = defaults.bool(forKey: Key.menuBar)
    }

    private func saveServer() {
        defaults.set(server.command.trimmingCharacters(in: .whitespaces), forKey: Key.command)
        defaults.set(server.library.trimmingCharacters(in: .whitespaces), forKey: Key.library)
        defaults.set(server.engine.trimmingCharacters(in: .whitespaces), forKey: Key.engine)
        defaults.set(server.port, forKey: Key.port)
    }
}

/// Opening at login, read from the system each time: a login item removed in System Settings
/// must not still show as on here. Borrowed from Acervo's app, but never turned on by itself.
enum LoginItem {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    @discardableResult
    static func setEnabled(_ enabled: Bool) -> Bool {
        do {
            if enabled, SMAppService.mainApp.status != .enabled { try SMAppService.mainApp.register() }
            if !enabled, SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            return true
        } catch {
            NSLog("Carrel could not change its login item: \(error.localizedDescription)")
            return false
        }
    }
}
