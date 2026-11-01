import AppKit
import CoreGraphics

/// How many of the monitor's own pixels there are per point of the screen a window is on, when
/// that is fewer than the screen's backing scale: the page then draws a paper's pages for the
/// monitor rather than for the screen (boot.js's `drawRatio`).
///
/// A HiDPI screen made for a monitor that has none (Crisp's virtual 4096-point screen at 2×,
/// mirrored onto a 5120×1440 panel) is drawn at 8192 pixels and scaled down to 5120 every frame,
/// so 1.25 of every 2 pixels per point reach the panel. The same holds, less, for a Mac's own
/// screen at a scaled resolution.
enum MonitorDensity {
    /// For `screen`, or nil when the monitor shows all the screen's pixels or cannot be read.
    @MainActor
    static func of(_ screen: NSScreen?) -> Double? {
        guard let screen,
              let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID,
              let mode = CGDisplayCopyDisplayMode(id) else { return nil }
        // The panel that shows it: a display mirroring it (a virtual screen's), or itself.
        let panel = onlineDisplays().first { CGDisplayMirrorsDisplay($0) == id } ?? id
        guard let native = nativeWidth(panel) else { return nil }
        return density(native: native, points: mode.width, backing: Double(screen.backingScaleFactor))
    }

    /// The panel's pixels per point, if fewer than the screen's backing scale.
    static func density(native: Int, points: Int, backing: Double) -> Double? {
        guard native > 0, points > 0 else { return nil }
        let density = Double(native) / Double(points)
        return density < backing - 0.01 ? (density * 1000).rounded() / 1000 : nil
    }

    private static func onlineDisplays() -> [CGDirectDisplayID] {
        var ids = [CGDirectDisplayID](repeating: 0, count: 16)
        var count: UInt32 = 0
        guard CGGetOnlineDisplayList(16, &ids, &count) == .success else { return [] }
        return Array(ids.prefix(Int(count)))
    }

    /// The width in pixels of the display's native mode: the panel's own.
    private static func nativeWidth(_ display: CGDirectDisplayID) -> Int? {
        let options = [kCGDisplayShowDuplicateLowResolutionModes: true] as CFDictionary
        let modes = (CGDisplayCopyAllDisplayModes(display, options) as? [CGDisplayMode]) ?? []
        return modes.filter { $0.ioFlags & UInt32(kDisplayModeNativeFlag) != 0 }.map(\.pixelWidth).max()
    }

    /// The script that tells the page: `window.carrelScreen`, and the `carrel:screen` event.
    static func script(_ density: Double?) -> String {
        let value = density.map { "{ density: \($0) }" } ?? "null"
        return "window.carrelScreen = \(value); document.dispatchEvent(new Event('carrel:screen'));"
    }
}
