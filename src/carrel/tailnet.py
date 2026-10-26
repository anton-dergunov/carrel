"""What Tailscale says about this machine: its name on the tailnet, its user, what it serves."""

import json
import subprocess


def _status(*args: str) -> dict:
    try:
        done = subprocess.run(
            ["tailscale", *args, "--json"], capture_output=True, text=True, timeout=5
        )
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if done.returncode != 0:
        return {}
    try:
        return json.loads(done.stdout or "{}")
    except ValueError:
        return {}


def identity() -> tuple[str | None, str | None]:
    """This machine's name on the tailnet (`name.tailnet.ts.net`) and its user's login."""
    status = _status("status")
    me = status.get("Self") or {}
    name = (me.get("DNSName") or "").rstrip(".") or None
    user = (status.get("User") or {}).get(str(me.get("UserID")), {})
    return name, user.get("LoginName")


def serves(https_port: int, local_port: int) -> bool:
    """Whether `tailscale serve` already publishes 127.0.0.1:local_port on https_port."""
    config = _status("serve", "status")
    for site, handlers in (config.get("Web") or {}).items():
        if site.endswith(f":{https_port}"):
            for handler in (handlers.get("Handlers") or {}).values():
                if handler.get("Proxy", "").rstrip("/").endswith(f":{local_port}"):
                    return True
    return False
