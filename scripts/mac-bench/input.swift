// Real input events for bench.py: what a free-spinning mouse wheel and a click send.
//   input spin X Y up|down COUNT START_LINES END_LINES INTERVAL_MS
//       COUNT wheel events, INTERVAL_MS apart, their size falling from START_LINES to END_LINES
//   input click X Y          prints when the button came up (wall clock, ms)
//   input window BUNDLE_ID   prints the app's largest window: x y width height (or a process id's)
// X and Y are screen points. Posting events needs Accessibility for the app running this.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

let args = CommandLine.arguments
if args[1] == "window" {
    let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
    let bounds = windows.compactMap { info -> CGRect? in
        guard let pid = info[kCGWindowOwnerPID as String] as? pid_t,
              Int32(args[2]).map({ $0 == pid }) ?? (NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == args[2]),
              let dict = info[kCGWindowBounds as String] as? NSDictionary else { return nil }
        return CGRect(dictionaryRepresentation: dict)
    }.max { $0.width * $0.height < $1.width * $1.height }
    guard let frame = bounds else { print("no window"); exit(1) }
    print(Int(frame.minX), Int(frame.minY), Int(frame.width), Int(frame.height))
    exit(0)
}
guard AXIsProcessTrusted() else {
    print("allow Accessibility for the terminal (System Settings → Privacy & Security)"); exit(1)
}
let point = CGPoint(x: Double(args[2])!, y: Double(args[3])!)
CGWarpMouseCursorPosition(point)
usleep(30_000)
switch args[1] {
case "spin":
    let sign: Int32 = args[4] == "up" ? 1 : -1
    let count = Int(args[5])!, start = Double(args[6])!, end = Double(args[7])!, interval = Double(args[8])!
    for i in 0..<count {
        let lines = Int32((start + (end - start) * Double(i) / Double(max(1, count - 1))).rounded())
        let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: sign * lines, wheel2: 0, wheel3: 0)!
        event.location = point
        event.post(tap: .cghidEventTap)
        usleep(useconds_t(interval * 1000))
    }
case "click":
    for type in [CGEventType.leftMouseDown, .leftMouseUp] {
        if type == .leftMouseUp { usleep(20_000) }
        CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)!.post(tap: .cghidEventTap)
    }
    // When the button came up, for bench.py.
    print(String(format: "%.1f", Date().timeIntervalSince1970 * 1000))
default:
    print("input spin|click …"); exit(2)
}
