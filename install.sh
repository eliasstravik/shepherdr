#!/bin/sh
# Shepherdr's installer: the service, the web app and the helpers (herdr-task, herdr-artifact, ...), under
# ~/.local/share/shepherdr. It needs herdr-core (hc); the Herdr app is optional (it gets an "Open Shepherdr" button).
# ./install.sh [--root DIR] [--dry-run] [--no-hooks] ...   (bin/shepherdr install --help for all)
# Run it again to update; `shepherdr uninstall` takes it all back out.
here=$(cd "$(dirname "$0")" && pwd -P)
command -v python3 >/dev/null 2>&1 || { echo "Shepherdr needs python3 (3.8 or newer)." >&2; exit 1; }
exec python3 "$here/bin/shepherdr" install "$@"
