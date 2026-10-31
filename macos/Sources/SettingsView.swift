import AppKit
import SwiftUI

struct SettingsView: View {
    @ObservedObject var settings: AppSettings
    @ObservedObject var server: ServerController
    var apply: () -> Void
    var showLog: () -> Void

    @State private var openAtLogin = LoginItem.isEnabled

    var body: some View {
        Form {
            Section {
                path("Carrel command", \.command, found: server.setup.command, key: "command", folders: false)
                path("Library", \.library, found: server.setup.library, key: "library", folders: true)
                path("Engine", \.engine, found: server.setup.engine, key: "engine", folders: true,
                     missing: "carrel's default")
                LabeledContent {
                    TextField("Port", text: port, prompt: Text(verbatim: "\(server.setup.port)"))
                        .labelsHidden()
                        .frame(width: 90)
                } label: {
                    labelled("Port", key: "port")
                }
                HStack {
                    Text(statusText).foregroundStyle(.secondary).font(.callout)
                    Spacer()
                    Button("Show Log", action: showLog)
                    Button("Apply", action: apply).keyboardShortcut(.defaultAction)
                }
            } header: {
                Text("Server")
            } footer: {
                Text("Carrel shows the carrel answering on the port, such as the login agent's. With none, it starts `carrel serve` with these settings and stops it on quit. Leave a field empty to use what is found.")
                    .foregroundStyle(.secondary)
                    .font(.callout)
            }
            Section("App") {
                Toggle("Show in the menu bar", isOn: $settings.showInMenuBar)
                Toggle("Open at login", isOn: $openAtLogin)
                    .onChange(of: openAtLogin) { _, wanted in
                        LoginItem.setEnabled(wanted)
                        openAtLogin = LoginItem.isEnabled
                    }
            }
        }
        .formStyle(.grouped)
        .frame(width: 560)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var statusText: String {
        switch server.state {
        case .probing: "Looking for carrel…"
        case .attached(let ping): "Showing carrel \(ping.version), not started here"
        case .starting: "Starting…"
        case .running(let ping): "Running carrel \(ping.version), started here"
        case .stopped: "Stopped"
        case .needsSetup: "Not running: name a command and a library"
        case .failed: "Failed: see the log"
        }
    }

    /// The port as text: empty when it is found rather than set.
    private var port: Binding<String> {
        Binding(
            get: { settings.server.port > 0 ? String(settings.server.port) : "" },
            set: { settings.server.port = Int($0.filter(\.isNumber)) ?? 0 }
        )
    }

    /// A field's name, with where its value comes from under it when it is not set here.
    private func labelled(_ label: String, key: String) -> some View {
        let source = server.setup.sources[key]
        return VStack(alignment: .leading, spacing: 1) {
            Text(label)
            if let source, source != .settings {
                Text(source.rawValue).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func path(
        _ label: String, _ field: WritableKeyPath<ServerSettings, String>,
        found: String?, key: String, folders: Bool, missing: String = "Not found"
    ) -> some View {
        let prompt = found.map { ($0 as NSString).abbreviatingWithTildeInPath } ?? missing
        return LabeledContent {
            HStack {
                TextField(label, text: $settings.server[dynamicMember: field], prompt: Text(verbatim: prompt))
                    .labelsHidden()
                    .truncationMode(.head)
                Button("Choose…") { choose(field, folders: folders) }
            }
        } label: {
            labelled(label, key: key)
        }
    }

    private func choose(_ field: WritableKeyPath<ServerSettings, String>, folders: Bool) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = folders
        panel.canChooseFiles = !folders
        panel.showsHiddenFiles = !folders
        if panel.runModal() == .OK, let url = panel.url { settings.server[keyPath: field] = url.path }
    }
}

@MainActor
final class SettingsWindow {
    private var window: NSWindow?

    var isVisible: Bool { window?.isVisible == true }
    var nsWindow: NSWindow? { window }

    func show(settings: AppSettings, server: ServerController, apply: @escaping () -> Void,
              showLog: @escaping () -> Void, delegate: NSWindowDelegate) {
        if window == nil {
            let view = SettingsView(settings: settings, server: server, apply: apply, showLog: showLog)
            let window = NSWindow(contentViewController: NSHostingController(rootView: view))
            window.title = "Carrel Settings"
            window.styleMask = [.titled, .closable]
            window.isReleasedWhenClosed = false
            window.center()
            self.window = window
        }
        window?.delegate = delegate
        AppActivation.bringForward(window)
    }
}
