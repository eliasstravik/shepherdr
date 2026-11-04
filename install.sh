#!/bin/sh
# Shepherdr's installer: puts the Shepherdr layout, its mods and helpers into your Herdr app.
# ./install.sh [--root DIR] [--dry-run] [--guard] ...   (bin/shepherdr install --help for all)
# ./install.sh --web                                   web only: no herdr-app (the service, the web app, herdr-task)
# Run it again to update; `shepherdr uninstall` takes it all back out.
here=$(cd "$(dirname "$0")" && pwd -P)
command -v python3 >/dev/null 2>&1 || { echo "Shepherdr needs python3 (3.8 or newer)." >&2; exit 1; }
exec python3 "$here/bin/shepherdr" install "$@"
