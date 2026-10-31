import AppKit
import Combine
import WebKit

@main
struct CarrelApplication {
    static func main() {
        let application = NSApplication.shared
        // Carrel has tabs of its own, in the page; the window's would only add Show Tab Bar. Set
        // before the window is made.
        NSWindow.allowsAutomaticWindowTabbing = false
        let delegate = AppDelegate()
        application.delegate = delegate
        application.run()
        withExtendedLifetime(delegate) {}
    }
}

/// Carrel in a window of its own: carrel's page in a WebView, the server found or started behind
/// it, and the menu bar item when Settings turns it on.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let settings = AppSettings.shared
    private(set) lazy var server = ServerController(settings: settings)
    private let main = MainWindow()
    private let settingsWindow = SettingsWindow()
    private var statusItem: StatusItem?
    private var watching: Set<AnyCancellable> = []
    /// Settings opens by itself once, when nothing is known to start a carrel with.
    private var askedForSetup = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        // As the unit tests' host, it opens nothing and starts nothing.
        guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
        let menu = Menus.main(target: self)
        NSApp.mainMenu = menu
        AppActivation.mainMenu = menu

        main.onAction = { [weak self] action in self?.statusAction(action) }
        main.onClose = { [weak self] in self?.returnToMenuBarIfAlone() }
        server.onChange = { [weak self] state in self?.show(state) }
        settings.$showInMenuBar
            .sink { [weak self] on in self?.setMenuBarItem(on) }
            .store(in: &watching)

        // Opened at login with the menu bar item, Carrel waits there; opened by hand, it shows itself.
        let quiet = settings.showInMenuBar
            && LaunchContext.wasLaunchedAsLoginItem(NSAppleEventManager.shared().currentAppleEvent)
        if quiet { NSApp.setActivationPolicy(.accessory) } else { openWindow() }
        Task { await server.connect() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        !settings.showInMenuBar
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openWindow()
        return true
    }

    /// A server the app started is stopped first, so its chats close before it goes.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard server.ownsServer else { return .terminateNow }
        Task {
            await server.stop()
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    // MARK: - The window

    private func show(_ state: ServerController.State) {
        switch state {
        case .probing:
            main.showStatus("Looking for carrel…", "On port \(server.setup.port).")
        case .starting:
            main.showStatus(
                "Starting carrel…", "Serving \(server.setup.library ?? "the library") on port \(server.setup.port).",
                buttons: [("Show Log", "log")]
            )
        case .attached, .running:
            if let url = server.pageURL { main.load(url) }
        case .stopped:
            main.showStatus("Carrel is stopped", "The server this app started has stopped.", buttons: [("Start", "start")])
        case .needsSetup:
            main.showStatus(
                "Carrel is not running",
                "Nothing answers on port \(server.setup.port), and Carrel does not know which library to serve or where the carrel command is. Name them in Settings, or start carrel yourself (carrel serve, or carrel agent install) and try again.",
                buttons: [("Settings", "settings"), ("Try Again", "retry")]
            )
            if !askedForSetup, main.window.isVisible {
                askedForSetup = true
                showSettings()
            }
        case .failed(let reason):
            main.showStatus(
                "Carrel could not start", reason, detail: ServerController.logTail(),
                buttons: [("Try Again", "retry"), ("Settings", "settings"), ("Show Log", "log")]
            )
        }
    }

    private func statusAction(_ action: String) {
        switch action {
        case "retry": Task { await server.connect() }
        case "start": Task { await server.start() }
        case "settings": showSettings()
        case "log": showLog()
        default: break
        }
    }

    @objc func openWindow() { AppActivation.bringForward(main.window) }

    func toggleWindow() {
        if main.window.isVisible, NSApp.isActive {
            main.window.orderOut(nil)
            returnToMenuBarIfAlone()
        } else {
            openWindow()
        }
    }

    private func returnToMenuBarIfAlone() {
        guard settings.showInMenuBar else { return }
        AppActivation.returnToMenuBar(owning: [main.window, settingsWindow.nsWindow])
    }

    func windowWillClose(_ notification: Notification) { returnToMenuBarIfAlone() }

    private func setMenuBarItem(_ on: Bool) {
        if on, statusItem == nil { statusItem = StatusItem(app: self) }
        if !on {
            statusItem?.remove()
            statusItem = nil
        }
    }

    var statusLine: String {
        switch server.state {
        case .probing: "Looking for carrel…"
        case .attached(let ping): "Serving \(Self.short(ping.library))"
        case .starting: "Starting…"
        case .running(let ping): "Serving \(Self.short(ping.library)), started by Carrel"
        case .stopped: "Stopped"
        case .needsSetup: "Not running"
        case .failed: "Could not start"
        }
    }

    private static func short(_ path: String) -> String { (path as NSString).abbreviatingWithTildeInPath }

    // MARK: - Menu actions

    @objc func pageCommand(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        openWindow()
        main.command(name)
    }

    /// ⌘W closes the tab showing; on the library, which has no tab to close, the window.
    @objc func closeTab() {
        guard NSApp.keyWindow === main.window else { return NSApp.keyWindow?.performClose(nil) ?? () }
        main.command("close-tab") { [weak self] closed in
            if !closed { self?.main.window.performClose(nil) }
        }
    }

    /// Zoom is the paper's or the meaning map's, as the page decides; with neither showing, the
    /// whole page's.
    @objc func actualSize() { zoom("zoom-reset") { $0.pageZoom = 1 } }
    @objc func zoomIn() { zoom("zoom-in") { $0.pageZoom = min($0.pageZoom * 1.1, 3) } }
    @objc func zoomOut() { zoom("zoom-out") { $0.pageZoom = max($0.pageZoom / 1.1, 0.5) } }

    private func zoom(_ command: String, otherwise: @escaping (WKWebView) -> Void) {
        main.command(command) { [weak self] done in
            if !done, let view = self?.main.webView { otherwise(view) }
        }
    }
    @objc func reload() {
        if server.pageURL == nil { Task { await server.connect() } } else { main.webView.reload() }
    }

    @objc func showAbout() {
        NSApp.orderFrontStandardAboutPanel(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func showSettings() {
        settingsWindow.show(
            settings: settings, server: server,
            apply: { [weak self] in Task { await self?.server.reconnect() } },
            showLog: { [weak self] in self?.showLog() },
            delegate: self
        )
    }

    /// The log of the server this app starts; the login agent's is ~/Library/Logs/carrel.log.
    @objc func showLog() {
        let url = ServerController.logURL
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        NSWorkspace.shared.open(url)
    }

    @objc func copyTabletAddress() {
        guard let tablet = server.ping?.tablet else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(tablet, forType: .string)
    }

    @objc func startServer() { Task { await server.connect() } }
    @objc func stopServer() { Task { await server.stop() } }
}
