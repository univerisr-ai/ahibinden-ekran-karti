"""Run a child process and mask obvious secrets in stdout/stderr."""
from __future__ import annotations

import argparse
import re
import signal
import subprocess
import sys
import threading
from typing import TextIO


REDACTIONS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b\d{6,}:[A-Za-z0-9_-]{20,}\b"), "[REDACTED_TELEGRAM_TOKEN]"),
    (re.compile(r'("cookie"\s*:\s*")[^"]+(")', re.IGNORECASE), r"\1[REDACTED_COOKIE]\2"),
    (re.compile(r"(?i)(Cookie:\s*)(.+)$"), r"\1[REDACTED_COOKIE]"),
    (re.compile(r"(?i)\b(cf_clearance|__cf_bm|_GRECAPTCHA|st|csid|csss)=([^;\s]+)"), r"\1=[REDACTED]"),
    (
        re.compile(r"(?i)\b(TELEGRAM_BOT_TOKEN|SAHIBINDEN_PASS|PASSWORD|PASSW|API_KEY|SECRET)\s*=\s*([^\s]+)"),
        r"\1=[REDACTED]",
    ),
    (
        re.compile(r"([A-Za-z0-9._%+-]{1})[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})"),
        r"\1***\2",
    ),
]


def _sanitize(text: str) -> str:
    value = text
    for pattern, replacement in REDACTIONS:
        value = pattern.sub(replacement, value)
    return value


def _pump(stream: TextIO | None, target: TextIO) -> None:
    if stream is None:
        return
    try:
        for line in iter(stream.readline, ""):
            target.write(_sanitize(line))
            target.flush()
    finally:
        stream.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Secret-safe process runner")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        print("Kullanim: redacted_runner.py -- <komut> [arguman...]", file=sys.stderr)
        raise SystemExit(2)

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        text=True,
        bufsize=1,
    )

    def _forward(_signum: int, _frame: object) -> None:
        if process.poll() is None:
            try:
                process.terminate()
            except OSError:
                pass

    for sig_name in ("SIGTERM", "SIGINT"):
        sig = getattr(signal, sig_name, None)
        if sig is not None:
            signal.signal(sig, _forward)

    threads = [
        threading.Thread(target=_pump, args=(process.stdout, sys.stdout), daemon=True),
        threading.Thread(target=_pump, args=(process.stderr, sys.stderr), daemon=True),
    ]
    for thread in threads:
        thread.start()

    code = process.wait()
    for thread in threads:
        thread.join(timeout=2)

    raise SystemExit(code)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(130)
