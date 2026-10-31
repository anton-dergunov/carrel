import Foundation

/// Finds the carrel serving this Mac, or starts one.
///
/// A carrel already answering on the port (the login agent's, or one started in a terminal) is
/// only shown, and never stopped. With none, the app runs `carrel serve` itself, holding the
/// server's stdin: carrel stops when it closes, so a server the app started goes with it, even
/// when the app is killed.
@MainActor
final class ServerController: ObservableObject {
    enum State: Equatable {
        /// Looking for a carrel on the port.
        case probing
        /// One was answering: someone else's, shown and never stopped.
        case attached(Ping)
        /// The app is starting its own.
        case starting
        /// The app's own, answering.
        case running(Ping)
        /// The app's own, stopped from the menu.
        case stopped
        /// No carrel answering, and not enough known to start one.
        case needsSetup
        case failed(String)
    }

    static var logURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/carrel-app.log")
    }

    /// How long a starting carrel has to answer its ping.
    private static let startTimeout: TimeInterval = 90
    /// How long a stopping one has to close its chats before it is killed.
    private static let stopTimeout: TimeInterval = 15

    @Published private(set) var state: State = .probing
    @Published private(set) var setup: ServerSetup
    var onChange: ((State) -> Void)?

    private let settings: AppSettings
    private var shell: [String: String]?
    private var process: Process?
    private var lifeline: Pipe?
    private var stopping = false

    init(settings: AppSettings) {
        self.settings = settings
        setup = ServerSetup.resolve(settings: settings.server, agent: AgentConfig.load(), shell: [:], carrelOnPath: nil)
    }

    /// Whether the server showing is the app's own, so quitting stops it.
    var ownsServer: Bool { process?.isRunning == true }

    var ping: Ping? {
        switch state {
        case .attached(let ping), .running(let ping): ping
        default: nil
        }
    }

    /// Where carrel's page is, once a carrel answers.
    var pageURL: URL? { ping == nil ? nil : setup.origin.appendingPathComponent("/") }

    /// Looks for a carrel, and starts one when none answers and the setup allows it.
    func connect() async {
        guard process?.isRunning != true else { return }
        set(.probing)
        await resolve()
        if let ping = await Self.ping(setup.origin) {
            set(.attached(ping))
        } else if setup.canStart {
            await start()
        } else {
            set(.needsSetup)
        }
    }

    /// The settings changed: the app's own server is started again with them; someone else's is
    /// left alone unless the port moved.
    func reconnect() async {
        if ownsServer { await stop() }
        await connect()
    }

    private func resolve() async {
        if shell == nil { shell = await ShellEnvironment.read() }
        let shell = shell ?? [:]
        setup = ServerSetup.resolve(
            settings: settings.server,
            agent: AgentConfig.load(),
            shell: shell,
            carrelOnPath: ShellEnvironment.find("carrel", path: shell["PATH"])
        )
    }

    // MARK: - The app's own server

    func start() async {
        guard process?.isRunning != true else { return }
        guard let command = setup.command, setup.canStart else { return set(.needsSetup) }
        set(.starting)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: command)
        process.arguments = setup.arguments
        process.environment = ShellEnvironment.forServer(app: ProcessInfo.processInfo.environment, shell: shell ?? [:])
        process.currentDirectoryURL = setup.library.map { URL(fileURLWithPath: $0) }
        let lifeline = Pipe()
        process.standardInput = lifeline
        let log = openLog()
        log?.write(Data("\n--- \(Date()) \(command) \(setup.arguments.joined(separator: " "))\n".utf8))
        process.standardOutput = log
        process.standardError = log
        process.terminationHandler = { [weak self] ended in
            let status = ended.terminationStatus
            Task { @MainActor in self?.ended(ended, status: status) }
        }
        do {
            try process.run()
        } catch {
            return set(.failed("Carrel could not run \(command): \(error.localizedDescription)"))
        }
        self.process = process
        self.lifeline = lifeline
        stopping = false

        let deadline = Date().addingTimeInterval(Self.startTimeout)
        while Date() < deadline, self.process === process {
            if let ping = await Self.ping(setup.origin) {
                // A carrel that found another one answering steps aside and exits 0: show that one.
                return set(process.isRunning ? .running(ping) : .attached(ping))
            }
            try? await Task.sleep(nanoseconds: 300_000_000)
        }
        if self.process === process, process.isRunning {
            await stop()
            set(.failed("Carrel did not answer within \(Int(Self.startTimeout)) seconds."))
        }
    }

    /// Stops the app's own server: SIGTERM, which closes its chats, and SIGKILL if it lingers.
    func stop() async {
        guard let process, process.isRunning else { return }
        stopping = true
        process.terminate()
        let deadline = Date().addingTimeInterval(Self.stopTimeout)
        while process.isRunning, Date() < deadline { try? await Task.sleep(nanoseconds: 100_000_000) }
        if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        while process.isRunning { try? await Task.sleep(nanoseconds: 50_000_000) }
        set(.stopped)
    }

    private func ended(_ ended: Process, status: Int32) {
        guard ended === process else { return }
        process = nil
        lifeline = nil
        if stopping {
            stopping = false
            return set(.stopped)
        }
        switch state {
        case .starting where status == 0:
            break // stepped aside for another carrel: the start loop finds it
        case .starting, .running:
            set(.failed("carrel serve stopped (exit code \(status))."))
        default:
            break
        }
    }

    private func openLog() -> FileHandle? {
        let url = Self.logURL
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        let handle = try? FileHandle(forWritingTo: url)
        handle?.seekToEndOfFile()
        return handle
    }

    /// The last lines the latest start wrote to the log, for a failure's page.
    static func logTail(lines: Int = 20) -> String {
        guard let text = try? String(contentsOf: logURL, encoding: .utf8) else { return "" }
        let run = text.components(separatedBy: "\n--- ").last ?? text
        return run.split(separator: "\n").dropFirst().suffix(lines).joined(separator: "\n")
    }

    private func set(_ state: State) {
        self.state = state
        onChange?(state)
    }

    /// What answers `/api/ping` on the origin, if it is a carrel.
    static func ping(_ origin: URL) async -> Ping? {
        var request = URLRequest(url: origin.appendingPathComponent("api/ping"))
        request.timeoutInterval = 2
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return Ping.parse(data)
    }
}
