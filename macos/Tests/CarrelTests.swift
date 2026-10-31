import XCTest
@testable import Carrel

final class ServerSetupTests: XCTestCase {
    let agentArguments = [
        "/repo/.venv/bin/carrel", "serve", "--library", "/Users/someone/papers",
        "--engine", "/Users/someone/engine", "--port", "8600", "--add-dir", "/Users/someone/notes",
    ]

    func testTheAgentsPlistGivesItsCommandAndOptions() {
        let agent = AgentConfig.parse(agentArguments)
        XCTAssertEqual(agent?.command, "/repo/.venv/bin/carrel")
        XCTAssertEqual(agent?.library, "/Users/someone/papers")
        XCTAssertEqual(agent?.engine, "/Users/someone/engine")
        XCTAssertEqual(agent?.port, 8600)
        XCTAssertEqual(agent?.extra, ["--add-dir", "/Users/someone/notes"])
        XCTAssertNil(AgentConfig.parse(["/bin/carrel", "tools"]))
    }

    func testWithTheAgentInstalledNothingNeedsSetting() {
        let setup = ServerSetup.resolve(
            settings: ServerSettings(), agent: AgentConfig.parse(agentArguments),
            shell: ["PAPER_LIBRARY": "/elsewhere"], carrelOnPath: "/usr/local/bin/carrel"
        )
        XCTAssertEqual(setup.command, "/repo/.venv/bin/carrel")
        XCTAssertEqual(setup.library, "/Users/someone/papers")
        XCTAssertEqual(setup.port, 8600)
        XCTAssertEqual(setup.sources["library"], .agent)
        XCTAssertEqual(setup.arguments, [
            "serve", "--library", "/Users/someone/papers", "--engine", "/Users/someone/engine",
            "--port", "8600", "--add-dir", "/Users/someone/notes", "--exit-with-stdin",
        ])
    }

    func testSettingsComeFirstAndTheShellLast() {
        var settings = ServerSettings()
        settings.library = "~/mine"
        let setup = ServerSetup.resolve(
            settings: settings, agent: AgentConfig.parse(agentArguments), shell: [:], carrelOnPath: nil
        )
        XCTAssertEqual(setup.library, NSHomeDirectory() + "/mine")
        XCTAssertEqual(setup.sources["library"], .settings)
        // The agent's other options belong to its library, not to this one.
        XCTAssertFalse(setup.arguments.contains("--add-dir"))

        let shellOnly = ServerSetup.resolve(
            settings: ServerSettings(), agent: nil,
            shell: ["PAPER_LIBRARY": "/papers", "CARREL_ENGINE": "/engine"], carrelOnPath: "/bin/carrel"
        )
        XCTAssertEqual(shellOnly.command, "/bin/carrel")
        XCTAssertEqual(shellOnly.library, "/papers")
        XCTAssertEqual(shellOnly.engine, "/engine")
        XCTAssertEqual(shellOnly.port, 8517)
        XCTAssertEqual(shellOnly.sources["command"], .shell)
        XCTAssertTrue(shellOnly.canStart)
    }

    func testWithNothingFoundThereIsNothingToStart() {
        let setup = ServerSetup.resolve(settings: ServerSettings(), agent: nil, shell: [:], carrelOnPath: nil)
        XCTAssertFalse(setup.canStart)
        XCTAssertEqual(setup.origin.absoluteString, "http://127.0.0.1:8517")
    }

    func testOnlyACarrelsPingCounts() {
        let ping = Ping.parse(Data(#"{"app":"carrel","version":"0.1.0","library":"/p","tablet":"https://m.ts.net:8443/"}"#.utf8))
        XCTAssertEqual(ping?.tablet, "https://m.ts.net:8443/")
        // An older carrel says nothing of the tablet.
        XCTAssertNotNil(Ping.parse(Data(#"{"app":"carrel","version":"0.1.0","library":"/p"}"#.utf8)))
        XCTAssertNil(Ping.parse(Data(#"{"app":"lectern","version":"1","library":"/p"}"#.utf8)))
        XCTAssertNil(Ping.parse(Data("<html>".utf8)))
    }
}

final class ShellEnvironmentTests: XCTestCase {
    func testTheEnvironmentIsReadAfterTheMarker() {
        var output = Data("Welcome! fortune of the day\n".utf8)
        output += Data(ShellEnvironment.marker.utf8)
        output += Data("PATH=/opt/homebrew/bin:/usr/bin\0NOTE=a=b\nc\0EMPTY=\0".utf8)
        let parsed = ShellEnvironment.parse(output)
        XCTAssertEqual(parsed["PATH"], "/opt/homebrew/bin:/usr/bin")
        XCTAssertEqual(parsed["NOTE"], "a=b\nc")
        XCTAssertEqual(parsed["EMPTY"], "")
        XCTAssertEqual(ShellEnvironment.parse(Data("no marker".utf8)), [:])
    }

    func testTheServerGetsTheShellsCarriedNamesOnly() {
        let environment = ShellEnvironment.forServer(
            app: ["PATH": "/usr/bin:/bin", "HOME": "/Users/someone"],
            shell: ["PATH": "/opt/homebrew/bin:/usr/bin", "PAPER_LIBRARY": "/papers", "SECRET": "x"]
        )
        XCTAssertEqual(environment["PATH"], "/opt/homebrew/bin:/usr/bin")
        XCTAssertEqual(environment["PAPER_LIBRARY"], "/papers")
        XCTAssertEqual(environment["HOME"], "/Users/someone")
        XCTAssertNil(environment["SECRET"])
        // A shell that could not be read still finds Homebrew's commands.
        let fallback = ShellEnvironment.forServer(app: ["PATH": "/usr/bin"], shell: [:])
        XCTAssertEqual(fallback["PATH"], ShellEnvironment.fallbackPath)
    }
}

final class RouteTests: XCTestCase {
    let origin = URL(string: "http://127.0.0.1:8517/")!

    func testCarrelsOwnPagesStayInTheWindow() {
        XCTAssertEqual(route(URL(string: "http://127.0.0.1:8517/read/a.pdf")!, origin: origin), .allow)
        XCTAssertEqual(route(URL(string: "about:blank")!, origin: origin), .allow)
    }

    func testTheRestOfTheWebOpensInTheBrowser() {
        XCTAssertEqual(route(URL(string: "https://arxiv.org/abs/1606.07792")!, origin: origin), .browser)
        // Another port on this Mac is another app.
        XCTAssertEqual(route(URL(string: "http://127.0.0.1:9000/")!, origin: origin), .browser)
        XCTAssertEqual(route(URL(string: "mailto:a@example.com")!, origin: origin), .browser)
    }

    func testPaperLinksAndOtherSchemesGoNowhere() {
        XCTAssertEqual(route(URL(string: "http://pdf.invalid/a.pdf?page=2")!, origin: origin), .cancel)
        XCTAssertEqual(route(URL(string: "file:///etc/passwd")!, origin: origin), .cancel)
        XCTAssertEqual(route(URL(string: "javascript:alert(1)")!, origin: origin), .cancel)
    }

    func testTheStatusPagesButtonsAreActions() {
        XCTAssertEqual(route(URL(string: "carrel-app://retry")!, origin: origin), .action("retry"))
    }
}
