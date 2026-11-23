"""A task's agent can't take down the session it runs in (SHEP-323).

On 2026-11-23 a task's agent tried a throwaway herdr-core with `export HC_SESSION=<test>` in one shell call and a
bare `hc server stop` in the next. Each call is a new shell, so the export was gone: the terminal's own
HC_SESSION=shepherdr was back, and the stop took down Shepherdr's live core with every Assistant and task agent in it.

So every task agent starts with a folder of small stand-ins first on its PATH (guard_argv): hc, herdr-core,
systemctl, pkill, killall and shepherdr. Each runs the real one, except for what would stop, restart, replace or
reconfigure the live session: `hc server stop|restart` aimed at a protected session, `hc update`, systemctl
stopping or restarting herdr-core's or Shepherdr's units, pkill/killall naming herdr-core or Shepherdr, and
`shepherdr install|update|uninstall|migrate|web|secrets` on the real home. Those are refused with why and how to do it
right (a throwaway session named on the same command). Protected sessions: the one the task runs in
(HERDR_GUARD_SESSION, set at launch), Shepherdr's ("shepherdr") and the Herdr app's ("default"). The person does
those from their own terminal; nothing inside a task's terminal can say yes for them.

It's a guard against mistakes, not against an agent set on getting round it (a full path to the real hc does).
"""
import os

from .base import SESSION

GUARDED = ("hc", "herdr-core", "systemctl", "pkill", "killall", "shepherdr")

# One POSIX sh script for every name: it looks at $0's name, then runs the next one of that name on PATH after its
# own folder. Exit 77 when it refuses.
SCRIPT = r'''#!/bin/sh
# Shepherdr's guard (SHEP-323): a task's agent can't take down the session it runs in. Written by herdr-task
# (herdr_task/guard.py); edits here are overwritten.
me=${0##*/}
here=$(cd "${0%/*}" 2>/dev/null && pwd -P)
own=${HERDR_GUARD_SESSION:-shepherdr}

refuse() {
  echo "Shepherdr refused: $1" >&2
  echo "A task's terminal can't stop, restart, update or reconfigure the live session it runs in ($own), nor" >&2
  echo "Shepherdr's own services. Tests use a throwaway session named on the same command, every time:" >&2
  echo "  HC_SESSION=<throwaway> hc server stop     (an export from an earlier shell call is gone)" >&2
  echo "If the person wants the live one changed, they do it from their own terminal." >&2
  exit 77
}

protected() {
  case "$1" in "$own"|shepherdr|default) return 0 ;; esac
  return 1
}

hc_check() {
  cmd= sub=
  for a in "$@"; do
    case "$a" in
      -h|--help|help) return 0 ;;
      -*) ;;
      *) if [ -z "$cmd" ]; then cmd=$a; elif [ -z "$sub" ]; then sub=$a; fi ;;
    esac
  done
  target=${HC_SESSION:-default}
  case "$cmd" in
    server)
      case "$sub" in stop|restart)
        protected "$target" && refuse "\`$me server $sub\` here would $sub the live session \"$target\"" ;;
      esac ;;
    update) refuse "\`$me update\` replaces the herdr-core every live session runs on" ;;
    serve|hold)
      protected "$target" && refuse "\`$me $cmd\` here would start a second core on the live session \"$target\"" ;;
  esac
  return 0
}

systemctl_check() {
  verb= hit=
  for a in "$@"; do
    case "$a" in
      stop|restart|try-restart|reload-or-restart|try-reload-or-restart|kill|disable|mask|isolate|reload|edit|revert|link|set-property)
        [ -z "$verb" ] && verb=$a ;;
      -*) ;;
      hc-serve*|hc-hold*|hc-shutdown*|herdr-core*|shepherdr*|herdr-*) hit=$a ;;
    esac
  done
  [ -n "$verb" ] && [ -n "$hit" ] && refuse "\`systemctl $verb $hit\` would touch the live herdr-core or Shepherdr"
  return 0
}

kill_check() {
  for a in "$@"; do
    case "$a" in
      hc|*herdr-core*|*shepherdr*|*hc-serve*|*hc-hold*|*"service/main.ts"*)
        refuse "\`$me $a\` would end the live herdr-core or Shepherdr" ;;
    esac
  done
  return 0
}

shepherdr_check() {
  cmd= root= dry=
  for a in "$@"; do
    case "$a" in
      -h|--help) return 0 ;;
      --root|--root=*) root=1 ;;
      --dry-run) dry=1 ;;
      -*) ;;
      *) [ -z "$cmd" ] && cmd=$a ;;
    esac
  done
  case "$cmd" in
    install|update|uninstall|migrate)
      [ -z "$root$dry" ] && refuse "\`shepherdr $cmd\` would change the live install (use --root <scratch> for a try)" ;;
    web|secrets)
      case " $* " in *" status "*|*" where "*) ;; *) refuse "\`shepherdr $cmd\` would reconfigure the live Shepherdr" ;; esac ;;
  esac
  return 0
}

case "$me" in
  hc|herdr-core) hc_check "$@" ;;
  systemctl) systemctl_check "$@" ;;
  pkill|killall) kill_check "$@" ;;
  shepherdr) shepherdr_check "$@" ;;
esac

# the real one: the first of that name on PATH that isn't in this folder
real=
rest=$PATH
while [ -n "$rest" ]; do
  d=${rest%%:*}
  case "$rest" in *:*) rest=${rest#*:} ;; *) rest= ;; esac
  [ -n "$d" ] || d=.
  [ "$(cd "$d" 2>/dev/null && pwd -P)" = "$here" ] && continue
  if [ -f "$d/$me" ] && [ -x "$d/$me" ]; then real=$d/$me; break; fi
done
[ -n "$real" ] || { echo "$me: command not found" >&2; exit 127; }
exec "$real" "$@"
'''


def guard_dir(store=None):
    """The guard's folder (written when missing or changed): beside the task lists, so every machine's herdr-task
    has its own."""
    if store is None:
        from .base import STORE as store
    d = os.path.join(store, ".guard", "bin")
    os.makedirs(d, exist_ok=True)
    main = os.path.join(d, "guard.sh")
    try:
        with open(main) as f:
            same = f.read() == SCRIPT
    except OSError:
        same = False
    if not same:
        tmp = f"{main}.{os.getpid()}"
        with open(tmp, "w") as f:
            f.write(SCRIPT)
        os.chmod(tmp, 0o755)
        os.replace(tmp, main)
    for name in GUARDED:
        p = os.path.join(d, name)
        if os.path.islink(p) and os.readlink(p) == "guard.sh":
            continue
        try:
            os.remove(p)
        except FileNotFoundError:
            pass
        os.symlink("guard.sh", p)
    return d


# Run after the person's interactive shell (in_shell) has read its rc files, which put ~/.local/bin (the real hc)
# first: the guard goes first again, and the agent and every shell it opens inherit it.
def guard_argv(argv, session=None, store=None):
    """argv run with the guard first on PATH and the live session it protects (see the module's words)."""
    try:
        d = guard_dir(store)
    except OSError:
        return argv   # a guard that can't be written never stops a task from starting
    return ["sh", "-c", 'export PATH="$0:$PATH" HERDR_GUARD_SESSION="$1"; shift; exec "$@"', d, session or SESSION, *argv]
