import AppKit
import WebKit

/// Where a navigation in the window goes.
enum Route: Equatable {
    /// Carrel's own page, or the app's status page.
    case allow
    /// Somewhere else on the web: the default browser.
    case browser
    /// A button on the app's status page (`carrel-app://<action>`).
    case action(String)
    case cancel
}

/// The window shows carrel's pages and nothing else; everything else on the web opens in the
/// browser. A paper link (`http://pdf.invalid/…`) is the page's to handle, so it never navigates.
func route(_ url: URL, origin: URL) -> Route {
    let scheme = url.scheme?.lowercased() ?? ""
    switch scheme {
    case "about":
        return .allow
    case "carrel-app":
        return .action(url.host ?? "")
    case "http", "https":
        if scheme == origin.scheme, url.host == origin.host, url.port == origin.port { return .allow }
        return url.host?.lowercased() == "pdf.invalid" ? .cancel : .browser
    case "mailto":
        return .browser
    default:
        return .cancel
    }
}

@MainActor
final class MainWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    let window: NSWindow
    let webView: WKWebView
    /// The status page's buttons.
    var onAction: ((String) -> Void)?
    var onClose: (() -> Void)?

    private var origin = URL(string: "http://127.0.0.1:\(ServerSetup.defaultPort)")!
    private var titleWatch: NSKeyValueObservation?
    private var showingStatus = false
    /// What the page was last told of the window's monitor (`MonitorDensity`).
    private var density: Double?
    private var screensWatch: NSObjectProtocol?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.applicationNameForUserAgent = "CarrelMac/\(Bundle.main.shortVersion)"
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsMagnification = false // a pinch is the page's: it zooms the PDF
        // Safari's Develop menu can attach its Web Inspector, to profile the page as the app draws it.
        webView.isInspectable = true
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window.title = "Carrel"
        window.minSize = NSSize(width: 700, height: 500)
        window.contentView = webView
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.center()
        window.setFrameAutosaveName("CarrelMainWindow")
        // WebKit reports its title on the main thread.
        titleWatch = webView.observe(\.title) { [weak self] view, _ in
            MainActor.assumeIsolated {
                let title = view.title ?? ""
                self?.window.title = title.isEmpty ? "Carrel" : title
            }
        }
        density = MonitorDensity.of(window.screen ?? NSScreen.main)
        tellScreen(force: true)
        screensWatch = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.tellScreen() }
        }
    }

    /// Tells the page the density of the monitor the window is on, if it changed: before its
    /// scripts run on each load, and at once to the page showing. The page draws a paper's pages
    /// for it, and works the same without it.
    private func tellScreen(force: Bool = false) {
        let now = MonitorDensity.of(window.screen ?? NSScreen.main)
        guard force || now != density else { return }
        density = now
        let script = MonitorDensity.script(now)
        let content = webView.configuration.userContentController
        content.removeAllUserScripts()
        content.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if !force { webView.evaluateJavaScript(script) }
    }

    func windowDidChangeScreen(_ notification: Notification) { tellScreen() }

    /// Shows carrel's page, unless it is already showing.
    func load(_ url: URL) {
        let same = webView.url.map { route($0, origin: url) == .allow && $0.scheme != "about" } ?? false
        origin = url
        if same, !showingStatus { return }
        showingStatus = false
        webView.load(URLRequest(url: url))
    }

    /// The app's own page, for when there is no carrel to show: a heading, some text, buttons.
    func showStatus(_ heading: String, _ text: String, detail: String? = nil, buttons: [(String, String)] = []) {
        showingStatus = true
        webView.loadHTMLString(StatusPage.html(heading, text, detail: detail, buttons: buttons), baseURL: nil)
    }

    // MARK: - Navigation

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        switch route(url, origin: origin) {
        case .allow:
            decisionHandler(.allow)
        case .browser:
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        case .action(let action):
            decisionHandler(.cancel)
            if showingStatus { onAction?(action) }
        case .cancel:
            decisionHandler(.cancel)
        }
    }

    /// `window.open(…, '_blank')`, for the links in answers, overviews and reviews.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, route(url, origin: origin) == .browser {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    /// A file input: adding a PDF. Without this WebKit opens no panel at all.
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { outcome in
            completionHandler(outcome == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard !showingStatus else { return }
        showStatus("Carrel is not answering", error.localizedDescription, buttons: [("Try Again", "retry")])
    }

    /// The page's process went away (memory, a crash): load it again rather than show a blank.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if !showingStatus { webView.reload() }
    }

    // MARK: - Page commands

    /// Runs one of the page's commands (`commands.js`); `done` gets whether it did anything.
    func command(_ name: String, done: ((Bool) -> Void)? = nil) {
        guard !showingStatus else { done?(false); return }
        webView.callAsyncJavaScript(
            "return window.carrel ? window.carrel.command(name) : false",
            arguments: ["name": name],
            in: nil,
            in: .page
        ) { result in
            if case .success(let value) = result { done?((value as? Bool) ?? false) } else { done?(false) }
        }
    }

    func windowWillClose(_ notification: Notification) { onClose?() }
}

enum StatusPage {
    static func html(_ heading: String, _ text: String, detail: String?, buttons: [(String, String)]) -> String {
        let links = buttons.map { "<a class=button href=\"carrel-app://\(escape($0.1))\">\(escape($0.0))</a>" }.joined()
        let pre = detail.map { $0.isEmpty ? "" : "<pre>\(escape($0))</pre>" } ?? ""
        return """
        <!doctype html><meta charset=utf-8><meta name=color-scheme content="light dark">
        <style>
        :root { --text: #2b2b28; --muted: #6b675d; --bg: #fdf6e3; --box: #efe7d1; --accent: #2a6f97; }
        @media (prefers-color-scheme: dark) {
          :root { --text: #e8e4d8; --muted: #a8a294; --bg: #1f1f1d; --box: #2c2b28; --accent: #6fb0d6; }
        }
        body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, sans-serif; }
        main { max-width: 620px; margin: 12vh auto; padding: 0 32px; }
        h1 { font-weight: 600; font-size: 24px; margin: 0 0 8px; }
        p { color: var(--muted); white-space: pre-wrap; }
        pre { background: var(--box); padding: 12px 14px; border-radius: 8px; font: 12px/1.45 ui-monospace, monospace;
              white-space: pre-wrap; max-height: 40vh; overflow: auto; }
        .button { display: inline-block; margin: 8px 8px 0 0; padding: 6px 14px; border-radius: 7px;
                  background: var(--accent); color: white; text-decoration: none; }
        .button + .button { background: var(--box); color: var(--text); }
        </style>
        <main><h1>\(escape(heading))</h1><p>\(escape(text))</p>\(pre)<div>\(links)</div></main>
        """
    }

    static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}

extension Bundle {
    var shortVersion: String { infoDictionary?["CFBundleShortVersionString"] as? String ?? "0" }
}
