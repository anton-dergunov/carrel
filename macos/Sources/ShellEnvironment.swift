import Foundation

/// The login shell's environment. An app opened from the Finder gets launchd's, whose PATH lacks
/// Homebrew's `rg`, `uv` (which runs `paperlib`) and `tailscale` — the same gap the login agent
/// fills by carrying the installing shell's PATH.
enum ShellEnvironment {
    /// What carrel needs from it: the agent's carried names, and where the library and engine are.
    static let carried = ["PATH", "XDG_STATE_HOME", "PAPER_LIBRARY", "CARREL_ENGINE"]
    static let marker = "__CARREL_ENVIRONMENT__"
    static let fallbackPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    /// The variables an interactive login shell sets, read once, with a timeout: a shell whose
    /// startup files wait for input must not hold the app up.
    static func read(timeout: TimeInterval = 5) async -> [String: String] {
        await Task.detached(priority: .userInitiated) { () -> [String: String] in
            let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
            let process = Process()
            process.executableURL = URL(fileURLWithPath: shell)
            process.arguments = ["-l", "-i", "-c", "printf '%s' \(marker); env -0"]
            let output = Pipe()
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            process.standardInput = FileHandle.nullDevice
            do { try process.run() } catch { return [:] }
            let deadline = Date().addingTimeInterval(timeout)
            let reading = Task.detached { output.fileHandleForReading.readDataToEndOfFile() }
            while process.isRunning, Date() < deadline { try? await Task.sleep(nanoseconds: 50_000_000) }
            if process.isRunning {
                process.terminate()
                return [:]
            }
            return parse(await reading.value)
        }.value
    }

    /// `env -0`'s output after the marker, as a dictionary; what the startup files printed before
    /// it is skipped.
    static func parse(_ data: Data) -> [String: String] {
        guard let marked = data.range(of: Data(marker.utf8)) else { return [:] }
        var environment: [String: String] = [:]
        for entry in data[marked.upperBound...].split(separator: 0) {
            guard let text = String(data: Data(entry), encoding: .utf8),
                  let equals = text.firstIndex(of: "=") else { continue }
            environment[String(text[..<equals])] = String(text[text.index(after: equals)...])
        }
        return environment
    }

    /// The environment carrel runs with: the app's own, with the shell's carried names over it.
    static func forServer(app: [String: String], shell: [String: String]) -> [String: String] {
        var environment = app
        for name in carried { if let value = shell[name], !value.isEmpty { environment[name] = value } }
        if shell["PATH"]?.isEmpty ?? true { environment["PATH"] = fallbackPath }
        return environment
    }

    /// The first executable `name` along `path`.
    static func find(_ name: String, path: String?) -> String? {
        for folder in (path ?? fallbackPath).split(separator: ":") {
            let candidate = URL(fileURLWithPath: String(folder)).appendingPathComponent(name).path
            if FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
        }
        return nil
    }
}
