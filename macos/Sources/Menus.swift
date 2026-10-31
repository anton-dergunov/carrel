import AppKit

/// The app's menu bar. Each item that acts on the library runs one of the page's own commands
/// (`commands.js`), named in the item's `representedObject`: a menu, not a second implementation.
@MainActor
enum Menus {
    static func main(target: AppDelegate) -> NSMenu {
        let bar = NSMenu()
        bar.addItem(submenu(app(target)))
        bar.addItem(submenu(file(target)))
        bar.addItem(submenu(edit(target)))
        bar.addItem(submenu(view(target)))
        let window = windowMenu()
        bar.addItem(submenu(window))
        NSApp.windowsMenu = window
        return bar
    }

    private static func submenu(_ menu: NSMenu) -> NSMenuItem {
        let item = NSMenuItem()
        item.submenu = menu
        return item
    }

    private static func app(_ target: AppDelegate) -> NSMenu {
        let menu = NSMenu(title: "Carrel")
        menu.addItem(item("About Carrel", #selector(AppDelegate.showAbout), target: target))
        menu.addItem(.separator())
        menu.addItem(item("Settings…", #selector(AppDelegate.showSettings), ",", target: target))
        menu.addItem(item("Show Server Log", #selector(AppDelegate.showLog), target: target))
        menu.addItem(.separator())
        let services = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        services.submenu = NSMenu(title: "Services")
        NSApp.servicesMenu = services.submenu
        menu.addItem(services)
        menu.addItem(.separator())
        menu.addItem(item("Hide Carrel", #selector(NSApplication.hide(_:)), "h"))
        menu.addItem(item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]))
        menu.addItem(item("Show All", #selector(NSApplication.unhideAllApplications(_:))))
        menu.addItem(.separator())
        menu.addItem(item("Quit Carrel", #selector(NSApplication.terminate(_:)), "q"))
        return menu
    }

    private static func file(_ target: AppDelegate) -> NSMenu {
        let menu = NSMenu(title: "File")
        menu.addItem(page("Add Paper…", "add", "n", target: target))
        menu.addItem(.separator())
        menu.addItem(item("Close Tab", #selector(AppDelegate.closeTab), "w", target: target))
        menu.addItem(item("Close Window", #selector(NSWindow.performClose(_:)), "w", [.command, .shift]))
        return menu
    }

    private static func edit(_ target: AppDelegate) -> NSMenu {
        let menu = NSMenu(title: "Edit")
        menu.addItem(item("Undo", Selector(("undo:")), "z"))
        menu.addItem(item("Redo", Selector(("redo:")), "z", [.command, .shift]))
        menu.addItem(.separator())
        menu.addItem(item("Cut", #selector(NSText.cut(_:)), "x"))
        menu.addItem(item("Copy", #selector(NSText.copy(_:)), "c"))
        menu.addItem(item("Paste", #selector(NSText.paste(_:)), "v"))
        menu.addItem(item("Select All", #selector(NSText.selectAll(_:)), "a"))
        menu.addItem(.separator())
        menu.addItem(page("Find…", "find", "f", target: target))
        return menu
    }

    private static func view(_ target: AppDelegate) -> NSMenu {
        let menu = NSMenu(title: "View")
        menu.addItem(page("Library", "library", "1", target: target))
        menu.addItem(page("Next Tab", "next-tab", "]", [.command, .shift], target: target))
        menu.addItem(page("Previous Tab", "previous-tab", "[", [.command, .shift], target: target))
        menu.addItem(.separator())
        menu.addItem(page("Ask", "ask", "l", target: target))
        menu.addItem(page("Show or Hide Chat", "toggle-chat", "l", [.command, .shift], target: target))
        menu.addItem(.separator())
        menu.addItem(item("Actual Size", #selector(AppDelegate.actualSize), "0", target: target))
        menu.addItem(item("Zoom In", #selector(AppDelegate.zoomIn), "=", target: target))
        menu.addItem(item("Zoom Out", #selector(AppDelegate.zoomOut), "-", target: target))
        menu.addItem(.separator())
        menu.addItem(item("Reload", #selector(AppDelegate.reload), "r", target: target))
        menu.addItem(.separator())
        menu.addItem(item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]))
        return menu
    }

    private static func windowMenu() -> NSMenu {
        let menu = NSMenu(title: "Window")
        menu.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"))
        menu.addItem(item("Zoom", #selector(NSWindow.performZoom(_:))))
        menu.addItem(.separator())
        menu.addItem(item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))))
        return menu
    }

    private static func item(
        _ title: String, _ action: Selector, _ key: String = "",
        _ modifiers: NSEvent.ModifierFlags = .command, target: AnyObject? = nil
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.target = target
        return item
    }

    private static func page(
        _ title: String, _ command: String, _ key: String,
        _ modifiers: NSEvent.ModifierFlags = .command, target: AppDelegate
    ) -> NSMenuItem {
        let item = item(title, #selector(AppDelegate.pageCommand(_:)), key, modifiers, target: target)
        item.representedObject = command
        return item
    }
}
