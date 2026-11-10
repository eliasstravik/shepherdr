#!/usr/bin/env python3
"""Translate Cursor lifecycle hooks to Herdr core's program status protocol."""
import json
import os
import sys
import re
import subprocess


def status(payload):
    event = payload.get("hook_event_name")
    if event == "stop":
        return {"completed": "done", "aborted": "idle", "error": "error"}.get(payload.get("status"))
    return {"sessionStart": "idle", "beforeSubmitPrompt": "working", "sessionEnd": "clear"}.get(event)


def parent_ttys():
    pid = os.getppid()
    for _ in range(6):
        if pid <= 1:
            return
        try:
            result = subprocess.run(["ps", "-p", str(pid), "-o", "ppid=,tty="],
                                    capture_output=True, text=True, timeout=0.5, check=True)
            parent, tty = result.stdout.split()
            pid = int(parent)
        except (OSError, subprocess.SubprocessError, ValueError):
            return
        if re.fullmatch(r"(?:ttys?[0-9]+|pts/[0-9]+)", tty):
            yield "/dev/" + tty


def report(state):
    # Cursor runs hooks in detached shells, so their controlling tty may be the ancestor's.
    for path in tty_paths():
        try:
            fd = os.open(path, os.O_WRONLY | os.O_NOCTTY)
            try:
                os.write(fd, f"\x1b]7501;state={state}:app=cursor-agent\x1b\\".encode())
            finally:
                os.close(fd)
            return
        except OSError:
            continue


def tty_paths():
    yield "/dev/tty"
    yield from parent_ttys()


def main():
    if not os.environ.get("HC_TERMINAL_ID"):
        return
    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError):
        return
    state = status(payload) if isinstance(payload, dict) else None
    if not state:
        return
    # Hook stdout belongs to Cursor's JSON response.
    report(state)


if __name__ == "__main__":
    main()
