import Foundation

/// Where a setting's value came from, said beside it in Settings.
enum SetupSource: String, Equatable, Sendable {
    case settings = "set here"
    case agent = "from the login agent"
    case shell = "from your shell"
    case standard = "the default"
}

/// What the login agent runs: `carrel serve` and its options, read from its plist.
struct AgentConfig: Equatable, Sendable {
    static let label = "com.anton.carrel"

    var command: String
    var library: String?
    var engine: String?
    var port: Int?
    /// The options the app passes on as they are (`--login`, `--add-dir`).
    var extra: [String] = []

    static var plistURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/\(label).plist")
    }

    /// The agent's configuration, or nil when there is none or it is not `carrel serve`.
    static func load(from url: URL = plistURL) -> AgentConfig? {
        guard let data = try? Data(contentsOf: url),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              let arguments = plist["ProgramArguments"] as? [String] else { return nil }
        return parse(arguments)
    }

    static func parse(_ arguments: [String]) -> AgentConfig? {
        guard arguments.count >= 2, arguments[1] == "serve" else { return nil }
        var config = AgentConfig(command: arguments[0])
        var rest = arguments.dropFirst(2).makeIterator()
        while let option = rest.next() {
            guard let value = rest.next() else { break }
            switch option {
            case "--library": config.library = value
            case "--engine": config.engine = value
            case "--port": config.port = Int(value)
            default: config.extra += [option, value]
            }
        }
        return config
    }
}

/// What Settings holds; an empty value means "find it".
struct ServerSettings: Equatable, Sendable {
    var command = ""
    var library = ""
    var engine = ""
    var port = 0
}

/// The server the app looks for, and the command that starts one.
struct ServerSetup: Equatable, Sendable {
    static let defaultPort = 8517

    var command: String?
    var library: String?
    var engine: String?
    var port: Int
    var extra: [String] = []
    var sources: [String: SetupSource] = [:]

    var origin: URL { URL(string: "http://127.0.0.1:\(port)")! }

    /// Enough to start a carrel: a command and a library.
    var canStart: Bool { command != nil && library != nil }

    /// `carrel serve`'s arguments, tied to the app's stdin so the server never outlives it.
    var arguments: [String] {
        var arguments = ["serve", "--library", library ?? ""]
        if let engine { arguments += ["--engine", engine] }
        arguments += ["--port", String(port)] + extra + ["--exit-with-stdin"]
        return arguments
    }

    /// The first of: what Settings says, what the login agent runs, what the login shell has.
    static func resolve(
        settings: ServerSettings,
        agent: AgentConfig?,
        shell: [String: String],
        carrelOnPath: String?
    ) -> ServerSetup {
        var sources: [String: SetupSource] = [:]
        func pick(_ key: String, _ choices: [(String?, SetupSource)]) -> String? {
            for (value, source) in choices {
                if let value, !value.isEmpty {
                    sources[key] = source
                    return value
                }
            }
            return nil
        }
        let command = pick("command", [(settings.command, .settings), (agent?.command, .agent), (carrelOnPath, .shell)])
        let library = pick("library", [(settings.library, .settings), (agent?.library, .agent), (shell["PAPER_LIBRARY"], .shell)])
        let engine = pick("engine", [(settings.engine, .settings), (agent?.engine, .agent), (shell["CARREL_ENGINE"], .shell)])
        let port: Int
        if settings.port > 0 {
            port = settings.port
            sources["port"] = .settings
        } else if let agentPort = agent?.port, agentPort > 0 {
            port = agentPort
            sources["port"] = .agent
        } else {
            port = defaultPort
            sources["port"] = .standard
        }
        // The agent's other options belong to the library it serves.
        let extra = sources["library"] == .agent ? agent?.extra ?? [] : []
        return ServerSetup(
            command: command.map(expandTilde),
            library: library.map(expandTilde),
            engine: engine.map(expandTilde),
            port: port,
            extra: extra,
            sources: sources
        )
    }

    static func expandTilde(_ path: String) -> String { (path as NSString).expandingTildeInPath }
}

/// What a carrel says about itself at `/api/ping`.
struct Ping: Decodable, Equatable, Sendable {
    var app: String
    var version: String
    var library: String
    /// Where the tablet opens it, when the tailnet publishes it.
    var tablet: String?

    /// A carrel's answer, or nil for anything else answering on the port.
    static func parse(_ data: Data) -> Ping? {
        guard let ping = try? JSONDecoder().decode(Ping.self, from: data), ping.app == "carrel" else { return nil }
        return ping
    }
}
