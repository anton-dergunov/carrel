from pathlib import Path

import pytest

from carrel import agent, cli


def test_agent_definition():
    definition = agent.plist(
        "/repo/.venv/bin/carrel",
        ["--library", "/Users/someone/papers"],
        {"PATH": "/opt/homebrew/bin:/usr/bin", "HOME": "/Users/someone"},
    )

    assert definition["Label"] == "com.anton.carrel"
    assert definition["ProgramArguments"] == [
        "/repo/.venv/bin/carrel",
        "serve",
        "--library",
        "/Users/someone/papers",
    ]
    # The shell's PATH, for rg, uv and tailscale; nothing else of its environment.
    assert definition["EnvironmentVariables"] == {"PATH": "/opt/homebrew/bin:/usr/bin"}
    assert definition["RunAtLoad"] is True
    # Restarted after a crash, not after it steps aside for a carrel already running.
    assert definition["KeepAlive"] == {"SuccessfulExit": False}
    assert definition["StandardOutPath"].endswith("Library/Logs/carrel.log")


def test_the_state_folder_goes_along_when_it_is_set():
    env = agent.plist("/bin/carrel", [], {"PATH": "/bin", "XDG_STATE_HOME": "/scratch"})
    assert env["EnvironmentVariables"] == {"PATH": "/bin", "XDG_STATE_HOME": "/scratch"}


def parsed(*argv: str):
    parser = cli.argparse.ArgumentParser()
    cli.serve_options(parser)
    return parser.parse_args(argv)


def test_serve_options_are_written_out_in_full(tmp_path, monkeypatch):
    monkeypatch.delenv("CARREL_ENGINE", raising=False)
    monkeypatch.chdir(tmp_path)
    (tmp_path / "papers").mkdir()
    (tmp_path / "notes").mkdir()

    args = parsed("--library", "papers", "--port", "9000", "--login", "a@b.c", "--add-dir", "notes")

    assert cli.serve_arguments(args) == [
        "--library",
        str((tmp_path / "papers").resolve()),
        "--port",
        "9000",
        "--login",
        "a@b.c",
        "--add-dir",
        str((tmp_path / "notes").resolve()),
    ]


@pytest.mark.parametrize("given", [("--engine", "engine"), ()])
def test_the_engine_is_named_when_it_is_not_the_default(tmp_path, monkeypatch, given):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CARREL_ENGINE", str(tmp_path / "engine"))

    arguments = cli.serve_arguments(parsed("--library", str(tmp_path), *given))

    assert arguments[2:] == ["--engine", str((tmp_path / "engine").resolve())]


def test_status_reads_the_service_and_not_its_nested_sections():
    printed = """gui/502/com.anton.carrel = {
\tstate = running
\tprogram = /repo/.venv/bin/carrel
\tpid = 67191
\tlast exit code = (never exited)
\tendpoints = {
\t\tstate = active
\t}
}"""
    assert agent.describe(printed) == "running (pid 67191)"
    assert agent.describe("\tstate = waiting\n\tlast exit code = 1\n").startswith(
        "loaded, not running (last exit code 1"
    )


def test_the_installed_options_are_read_back(tmp_path, monkeypatch):
    monkeypatch.setattr(agent, "plist_path", lambda: tmp_path / "agent.plist")
    assert agent.installed_arguments() == []
    with (tmp_path / "agent.plist").open("wb") as file:
        agent.plistlib.dump(agent.plist("/bin/carrel", ["--port", "9000"], {}), file)
    assert agent.installed_arguments() == ["--port", "9000"]


def test_a_running_carrel_is_recognised_and_anything_else_is_not(monkeypatch):
    class Reply:
        def __init__(self, body):
            self.body = body

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self, *_):
            return self.body

    monkeypatch.setattr(
        cli.urllib.request, "urlopen", lambda *a, **k: Reply(b'{"app": "carrel", "library": "/p"}')
    )
    assert cli.running(8517) == {"app": "carrel", "library": "/p"}
    monkeypatch.setattr(cli.urllib.request, "urlopen", lambda *a, **k: Reply(b'{"app": "x"}'))
    assert cli.running(8517) is None
    monkeypatch.setattr(cli.urllib.request, "urlopen", lambda *a, **k: Reply(b"<html>"))
    assert cli.running(8517) is None


def test_nothing_on_the_port():
    assert cli.running(1) is None
    assert Path(agent.log_path()).name == "carrel.log"


def test_the_agent_never_runs_carrel_tied_to_stdin():
    # launchd gives the agent no stdin, so the option would stop it at once.
    args = parsed("--library", "/papers")
    assert "--exit-with-stdin" not in cli.serve_arguments(args)
    assert not hasattr(args, "exit_with_stdin")


def test_exit_with_stdin_stops_the_process_when_stdin_closes():
    import signal
    import subprocess
    import sys

    child = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import time; from carrel import cli; cli.exit_with_stdin(); "
            "print('ready', flush=True); time.sleep(30)",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    assert child.stdout.readline().strip() == "ready"
    child.stdin.close()
    assert child.wait(timeout=10) == -signal.SIGTERM
