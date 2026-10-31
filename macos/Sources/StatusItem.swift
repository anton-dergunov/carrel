import AppKit

/// Carrel in the menu bar, when Settings turns it on: a click shows or hides the window, and a
/// right click (or a Control-click) opens its menu.
@MainActor
final class StatusItem: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private unowned let app: AppDelegate

    init(app: AppDelegate) {
        self.app = app
        super.init()
        guard let button = item.button else { return }
        // An SF Symbol, Apple's, for use in apps on its platforms.
        button.image = NSImage(systemSymbolName: "books.vertical", accessibilityDescription: "Carrel")
        button.image?.isTemplate = true
        button.target = self
        button.action = #selector(clicked)
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    func remove() { NSStatusBar.system.removeStatusItem(item) }

    @objc private func clicked() {
        let event = NSApp.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
            item.menu = menu()
            item.button?.performClick(nil)
            item.menu = nil
        } else {
            app.toggleWindow()
        }
    }

    private func menu() -> NSMenu {
        let menu = NSMenu()
        let status = NSMenuItem(title: app.statusLine, action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())
        menu.addItem(entry("Open Carrel", #selector(AppDelegate.openWindow)))
        let tablet = entry("Copy Tablet Address", #selector(AppDelegate.copyTabletAddress))
        tablet.isEnabled = app.server.ping?.tablet != nil
        tablet.toolTip = app.server.ping?.tablet ?? "Not published on the tailnet"
        menu.addItem(tablet)
        switch app.server.state {
        case .running, .starting:
            menu.addItem(entry("Stop Server", #selector(AppDelegate.stopServer)))
        case .stopped, .failed, .needsSetup:
            menu.addItem(entry("Start Server", #selector(AppDelegate.startServer)))
        default:
            break
        }
        menu.addItem(.separator())
        menu.addItem(entry("Settings…", #selector(AppDelegate.showSettings)))
        menu.addItem(NSMenuItem(title: "Quit Carrel", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        return menu
    }

    private func entry(_ title: String, _ action: Selector) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
        entry.target = app
        return entry
    }
}
