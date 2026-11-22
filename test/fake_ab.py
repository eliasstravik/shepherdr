"""A stand-in agent-browser for herdr-browser's tests (3.2: a browser per space, a tab per agent). It answers what
herdr-browser asks to start a space's browser and join it (session list, get cdp-url, the space's own open about:blank,
the join `tab <id>`), and hands every other call to `body` (sh) with the leading --session/--cdp/--pin-tab/
--idle-timeout taken off, so "$@" is the command the agent typed. ENV goes on the run's environment: the new window's
id comes from a command instead of a real Chrome."""

ENV = {"HERDR_BROWSER_NEW_WINDOW": "echo T1"}

SCRIPT = """#!/bin/sh
[ "$1" = --version ] && { echo "agent-browser 0.41.1"; exit 0; }
all="$*"
sess=default
while :; do case "$1" in --session) sess=$2; shift 2 ;; --profile|--cdp|--idle-timeout) shift 2 ;; --pin-tab) shift ;; *) break ;; esac; done
case "$sess:$1 ${2-}" in
  *":session list") exit 0 ;;
  *":get cdp-url") echo "ws://127.0.0.1:1/devtools/browser/fake"; exit 0 ;;
  herdr-s-*) exit 0 ;;
  *":tab T1"|*":close ") exit 0 ;;
esac
%s
"""


def script(body):
    return SCRIPT % body
