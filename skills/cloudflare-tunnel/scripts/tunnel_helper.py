#!/usr/bin/env python3
"""Small helper for Cloudflare Tunnel agent workflows.

The quick command starts cloudflared in the background, waits for the
trycloudflare URL, and records state under .cloudflare-tunnel/ in the
current working directory. Run status/stop from the same directory.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


STATE_DIR = Path(".cloudflare-tunnel")
PID_FILE = STATE_DIR / "quick.pid"
URL_FILE = STATE_DIR / "quick-url.txt"
LOCAL_URL_FILE = STATE_DIR / "quick-local-url.txt"
LOG_FILE = STATE_DIR / "quick.log"
EMPTY_CONFIG = STATE_DIR / "cloudflared-empty.yml"
DEFAULT_TIMEOUT = 120
START_ATTEMPTS = 3
URL_PATTERN = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
DOH_URL = "https://1.1.1.1/dns-query"
IS_WINDOWS = os.name == "nt"
SCRIPT_PATH = Path(__file__).resolve()

# cloudflared log fragments that indicate a transient edge/API failure worth retrying.
TRANSIENT_MARKERS = (
    "failed to request quick Tunnel",
    "context deadline exceeded",
    "Client.Timeout exceeded",
)


def fail(message: str, code: int = 1) -> int:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    return code


def print_json(data: dict[str, object]) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def stop_command_hint() -> str:
    python = Path(sys.executable).name or "python3"
    return f"{python} {SCRIPT_PATH} stop"


def require_cloudflared() -> str:
    path = shutil.which("cloudflared")
    if not path:
        raise RuntimeError("cloudflared not found. Install it first.")
    return path


def normalize_url(args: argparse.Namespace) -> str:
    if args.url:
        return args.url
    if args.port:
        return f"http://localhost:{args.port}"
    raise RuntimeError("provide --url or --port")


def run_curl(url: str, timeout: int, extra_args: tuple[str, ...] = ()) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["curl", "--noproxy", "*", "-sS", "-L", "--max-time", str(timeout), *extra_args, "-w", "\n%{http_code}", url],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def fetch(url: str, timeout: int = 15) -> tuple[int | None, str]:
    if shutil.which("curl"):
        result = run_curl(url, timeout)
        if result.returncode == 6:
            # DNS resolution failed. Fake-IP proxy resolvers and slow trycloudflare
            # propagation both break the system resolver, so retry via DNS-over-HTTPS.
            doh_result = run_curl(url, timeout, ("--doh-url", DOH_URL))
            if doh_result.returncode == 0:
                result = doh_result
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"curl exited {result.returncode}")
        body, _, status_text = result.stdout.rpartition("\n")
        try:
            status = int(status_text)
        except ValueError:
            status = None
        return status, body

    req = Request(url, headers={"User-Agent": "cloudflare-tunnel-skill/2.0"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except URLError as exc:
        raise RuntimeError(str(exc)) from exc


def verify_local(url: str) -> None:
    status, _ = fetch(url, timeout=10)
    if status is None:
        return
    if status in {200, 204, 301, 302, 304, 401, 403} or 200 <= status < 500:
        return
    raise RuntimeError(f"local service returned HTTP {status}")


def is_pid_running(pid: int) -> bool:
    if IS_WINDOWS:
        # os.kill(pid, 0) is not a safe liveness probe on Windows.
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return re.search(rf"\s{pid}\s", result.stdout) is not None
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def send_terminate(pid: int, force: bool = False) -> None:
    if IS_WINDOWS:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return
    sig = signal.SIGKILL if force else signal.SIGTERM
    try:
        os.killpg(pid, sig)
    except ProcessLookupError:
        pass
    except PermissionError:
        os.kill(pid, sig)


def stop_pid(pid: int) -> None:
    send_terminate(pid)
    deadline = time.time() + 8
    while time.time() < deadline:
        if not is_pid_running(pid):
            return
        time.sleep(0.2)
    if is_pid_running(pid):
        send_terminate(pid, force=True)


def read_pid() -> int | None:
    if not PID_FILE.exists():
        return None
    try:
        return int(PID_FILE.read_text(encoding="utf-8").strip())
    except ValueError:
        return None


def read_state_file(path: Path) -> str | None:
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8").strip() or None


def popen_kwargs() -> dict[str, object]:
    if IS_WINDOWS:
        flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        return {"creationflags": flags}
    return {"start_new_session": True}


def cmd_check(_: argparse.Namespace) -> int:
    try:
        path = require_cloudflared()
        result = subprocess.run([path, "--version"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        print_json({"ok": True, "cloudflared": path, "version": result.stdout.strip()})
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI diagnostics
        return fail(str(exc))


def launch_and_wait(cloudflared: str, local_url: str, args: argparse.Namespace) -> tuple[str | None, str | None, bool]:
    """Start cloudflared once. Returns (public_url, error, transient)."""
    cmd = [
        cloudflared,
        "--config",
        str(EMPTY_CONFIG),
        "tunnel",
        "--no-autoupdate",
        "--protocol",
        args.protocol,
    ]
    if args.no_tls_verify:
        cmd.append("--no-tls-verify")
    cmd.extend(["--url", local_url])

    log = LOG_FILE.open("w", encoding="utf-8")
    try:
        proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, text=True, **popen_kwargs())
        PID_FILE.write_text(str(proc.pid), encoding="utf-8")

        public_url = None
        registered = False
        deadline = time.time() + args.timeout
        while time.time() < deadline:
            content = LOG_FILE.read_text(encoding="utf-8", errors="replace") if LOG_FILE.exists() else ""
            if proc.poll() is not None:
                transient = any(marker in content for marker in TRANSIENT_MARKERS)
                return None, f"cloudflared exited early with code {proc.returncode}. See {LOG_FILE}", transient
            match = URL_PATTERN.search(content)
            if match:
                public_url = match.group(0)
            if "Registered tunnel connection" in content:
                registered = True
            if public_url and registered:
                return public_url, None, False
            time.sleep(0.5)
    finally:
        log.close()

    stop_pid(proc.pid)
    if public_url:
        return None, f"cloudflared did not register an edge connection in time. See {LOG_FILE}", True
    return None, f"did not find trycloudflare.com URL in {LOG_FILE}", False


def cmd_quick(args: argparse.Namespace) -> int:
    try:
        cloudflared = require_cloudflared()
        local_url = normalize_url(args)
        verify_local(local_url)

        existing_pid = read_pid()
        if existing_pid and is_pid_running(existing_pid) and URL_FILE.exists():
            previous_local = read_state_file(LOCAL_URL_FILE)
            if previous_local == local_url:
                print_json(
                    {
                        "ok": True,
                        "mode": "quick",
                        "reused": True,
                        "pid": existing_pid,
                        "local_url": local_url,
                        "public_url": read_state_file(URL_FILE),
                        "log_file": str(LOG_FILE),
                        "stop_command": stop_command_hint(),
                    }
                )
                return 0
            # A quick tunnel for a different local URL is running; replace it.
            stop_pid(existing_pid)

        STATE_DIR.mkdir(parents=True, exist_ok=True)
        EMPTY_CONFIG.write_text("", encoding="utf-8")

        last_error = "quick tunnel failed"
        for attempt in range(1, START_ATTEMPTS + 1):
            public_url, error, transient = launch_and_wait(cloudflared, local_url, args)
            if public_url:
                URL_FILE.write_text(public_url + "\n", encoding="utf-8")
                LOCAL_URL_FILE.write_text(local_url + "\n", encoding="utf-8")
                print_json(
                    {
                        "ok": True,
                        "mode": "quick",
                        "pid": read_pid(),
                        "attempt": attempt,
                        "local_url": local_url,
                        "public_url": public_url,
                        "log_file": str(LOG_FILE),
                        "stop_command": stop_command_hint(),
                    }
                )
                return 0
            last_error = error or last_error
            if not transient or attempt == START_ATTEMPTS:
                break
            time.sleep(2)
        return fail(last_error)
    except Exception as exc:  # noqa: BLE001 - CLI diagnostics
        return fail(str(exc))


def cmd_status(_: argparse.Namespace) -> int:
    pid = read_pid()
    running = bool(pid and is_pid_running(pid))
    print_json(
        {
            "ok": True,
            "mode": "quick",
            "running": running,
            "pid": pid,
            "local_url": read_state_file(LOCAL_URL_FILE),
            "public_url": read_state_file(URL_FILE),
        }
    )
    return 0


def cmd_stop(_: argparse.Namespace) -> int:
    pid = read_pid()
    if not pid:
        print_json({"ok": True, "stopped": False, "message": "no quick tunnel pid file found"})
        return 0
    if not is_pid_running(pid):
        print_json({"ok": True, "stopped": False, "message": "process is not running", "pid": pid})
        return 0
    stop_pid(pid)
    print_json({"ok": True, "stopped": True, "pid": pid})
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    try:
        status, body = fetch(args.url, timeout=args.timeout)
        contains = args.contains in body if args.contains else None
        ok = status is not None and 200 <= status < 500
        if args.contains:
            ok = ok and bool(contains)
        print_json({"ok": ok, "url": args.url, "status": status, "contains": contains})
        return 0 if ok else 1
    except Exception as exc:  # noqa: BLE001 - CLI diagnostics
        return fail(str(exc))


def safe_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "-", name).strip("-")


def cmd_named_config(args: argparse.Namespace) -> int:
    try:
        local_url = normalize_url(args)
        name = safe_name(args.name)
        if not name:
            raise RuntimeError("invalid tunnel name")
        if not args.hostname or "." not in args.hostname:
            raise RuntimeError("provide a valid --hostname")
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        config_path = STATE_DIR / f"{name}.yml"
        lines = [
            f"tunnel: {name}",
        ]
        if args.credentials_file:
            lines.append(f"credentials-file: {args.credentials_file}")
        lines.extend(
            [
                "",
                "ingress:",
                f"  - hostname: {args.hostname}",
                f"    service: {local_url}",
                "  - service: http_status:404",
                "",
            ]
        )
        config_path.write_text("\n".join(lines), encoding="utf-8")
        print_json(
            {
                "ok": True,
                "mode": "named",
                "config": str(config_path),
                "hostname": args.hostname,
                "local_url": local_url,
                "run_command": f"cloudflared tunnel --config {config_path} run {name}",
            }
        )
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI diagnostics
        return fail(str(exc))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Cloudflare Tunnel skill helper")
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check", help="check cloudflared")
    check.set_defaults(func=cmd_check)

    quick = sub.add_parser("quick", help="start a quick tunnel in the background")
    quick.add_argument("--url", help="local URL, for example http://localhost:3000")
    quick.add_argument("--port", type=int, help="local HTTP port")
    quick.add_argument("--protocol", default="http2", choices=["http2", "quic"], help="cloudflared protocol")
    quick.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    quick.add_argument("--no-tls-verify", action="store_true", help="allow self-signed local HTTPS")
    quick.set_defaults(func=cmd_quick)

    status = sub.add_parser("status", help="show quick tunnel status")
    status.set_defaults(func=cmd_status)

    stop = sub.add_parser("stop", help="stop helper-started quick tunnel")
    stop.set_defaults(func=cmd_stop)

    verify = sub.add_parser("verify", help="verify a public URL")
    verify.add_argument("--url", required=True)
    verify.add_argument("--contains", help="optional response substring to require")
    verify.add_argument("--timeout", type=int, default=20)
    verify.set_defaults(func=cmd_verify)

    named = sub.add_parser("named-config", help="write a named tunnel config")
    named.add_argument("--name", required=True, help="tunnel name")
    named.add_argument("--hostname", required=True, help="public hostname")
    named.add_argument("--url", help="local URL")
    named.add_argument("--port", type=int, help="local HTTP port")
    named.add_argument("--credentials-file", help="optional Cloudflare tunnel credentials JSON")
    named.set_defaults(func=cmd_named_config)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
