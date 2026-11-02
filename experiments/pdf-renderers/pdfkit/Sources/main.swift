// A paper in Apple's PDFView, laid out as carrel lays out its PDF: continuous, as wide as the pane,
// the pages 8 pt apart on carrel's grey, with an empty WKWebView where the chat would be.
//   open -n build/Build/Products/Debug/PDFKitSpike.app --args PDF PAGE [PANE_WIDTH CHAT_WIDTH HEIGHT]
// Given a URL rather than a PDF, the pane is a WKWebView of that page instead (PAGE unused): the web
// viewers in the engine carrel's Mac app and the iPad's Safari use, in the same window.
import AppKit
import PDFKit
import WebKit

let arguments = CommandLine.arguments
let page = arguments.count >= 3 ? Int(arguments[2]) ?? 0 : 0
guard page > 0 else {
    FileHandle.standardError.write("PDFKitSpike PDF PAGE [PANE_WIDTH CHAT_WIDTH HEIGHT]\n".data(using: .utf8)!)
    exit(2)
}
let web = arguments[1].hasPrefix("http")
let url = web ? URL(string: arguments[1])! : URL(fileURLWithPath: arguments[1])
let number = { (i: Int, fallback: Double) in arguments.count > i ? Double(arguments[i]) ?? fallback : fallback }
let paneWidth = number(3, 1230)
let chatWidth = number(4, 520)
let height = number(5, 1000)

final class Delegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let frame = NSRect(x: 0, y: 0, width: paneWidth + chatWidth, height: height)
        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = web ? url.absoluteString : url.deletingPathExtension().lastPathComponent
        let content = NSView(frame: frame)
        let chat = WKWebView(frame: NSRect(x: paneWidth, y: 0, width: chatWidth, height: height))
        chat.autoresizingMask = [.minXMargin, .height]
        chat.loadHTMLString("<body style='background:#fff'></body>", baseURL: nil)
        content.addSubview(chat)
        window.contentView = content
        window.setFrameTopLeftPoint(NSPoint(x: 0, y: NSScreen.main!.visibleFrame.maxY))
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        if web {
            let pane = WKWebView(frame: NSRect(x: 0, y: 0, width: paneWidth, height: height))
            pane.autoresizingMask = [.width, .height]
            pane.isInspectable = true
            pane.load(URLRequest(url: url))
            content.addSubview(pane)
            return
        }
        let pdfView = PDFView(frame: NSRect(x: 0, y: 0, width: paneWidth, height: height))
        pdfView.autoresizingMask = [.width, .height]
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical
        pdfView.displaysPageBreaks = true
        pdfView.pageBreakMargins = NSEdgeInsets(top: 4, left: 0, bottom: 4, right: 0)
        pdfView.pageShadowsEnabled = false
        pdfView.backgroundColor = NSColor(white: 223 / 255, alpha: 1)
        pdfView.autoScales = true
        content.addSubview(pdfView)

        pdfView.document = PDFDocument(url: url)
        DispatchQueue.main.async {
            if let target = pdfView.document?.page(at: page - 1) { pdfView.go(to: target) }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
