import AppKit
import Carbon

// Both from Acervo's Mac app (acervo-llm-dictionary, macos/Sources/Activation.swift and
// LaunchContext.swift), which worked out what macOS leaves unfinished here.

/// Coming forward from the menu bar, and going back to it.
///
/// With the menu bar item on, Carrel with no window open is an accessory: no Dock icon and no menu
/// bar of its own. Showing a window means becoming a regular application first, and macOS does not
/// finish that on its own: the menu bar follows activation rather than the activation policy, so a
/// policy change made while another application owns the bar leaves that application's menu showing.
@MainActor
enum AppActivation {
    /// Assigned again on coming forward, which makes AppKit rebuild the bar for this application.
    static var mainMenu: NSMenu?

    static func bringForward(_ window: NSWindow?) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
        // Activation may lag the request; this second pass is unconditional, since the failure it is
        // for is the one where the application already believes it is active.
        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)
            if let menu = mainMenu {
                NSApp.mainMenu = nil
                NSApp.mainMenu = menu
            }
            window?.makeKeyAndOrderFront(nil)
        }
    }

    /// Back to the menu bar once none of `windows` is on screen. A closing window still reports
    /// itself visible while its delegate runs, so the decision waits for AppKit to finish closing it.
    static func returnToMenuBar(owning windows: [NSWindow?]) {
        DispatchQueue.main.async {
            guard !windows.contains(where: { $0?.isVisible == true }) else { return }
            NSApp.setActivationPolicy(.accessory)
        }
    }
}

/// Whether this launch was the system opening Carrel at login, which leaves it in the menu bar
/// rather than putting a window over whatever someone is doing as they log in.
enum LaunchContext {
    /// The system says so in the event that opens the application; no event reads as someone
    /// having opened it, the safe way to be wrong.
    static func wasLaunchedAsLoginItem(_ event: NSAppleEventDescriptor?) -> Bool {
        guard let event,
              event.eventClass == AEEventClass(kCoreEventClass),
              event.eventID == AEEventID(kAEOpenApplication) else { return false }
        return event.paramDescriptor(forKeyword: AEKeyword(keyAEPropData))?.enumCodeValue
            == OSType(keyAELaunchedAsLogInItem)
    }
}
