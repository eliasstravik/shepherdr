"""Feedback for BossGoat (SHEP-78): an agent that hits a problem in BossGoat itself (a BossGoat,
herdr-task, web or window feature that doesn't work as meant, a command failing like our bug, the
person's frustration with BossGoat) offers, once, to file it as a GitHub issue, and files it only
with the person's yes.

- Any agent that isn't an Assistant (a task worker, its reviewer, an automation's run, an agent
  tab) runs `herdr-task feedback "<one line>" --details "…"`: it returns at once and its Assistant
  gets one <herdr-news event="feedback"> line (held while the person writes to it, as other news),
  so the agent carries on. A reviewer usually puts it in its findings for its worker instead.
- The Assistant runs the same command for a problem it noticed itself or was told: it says whether
  to offer (never twice for one problem, never after the person's No), then asks with its question
  tool. On yes: `--file` searches the repo's open issues for a duplicate first, then files a
  redacted issue with gh (or `--comment <n>` adds to the duplicate). On no: `--no`, remembered.
- Settings › Agents › Feedback offers (agents.feedback, on unless turned off, per space or
  Everywhere) and the repo it files to (agents.feedback_repo, Everywhere's; default upstream).

One problem is the words of its one line (key_of); what happened to it is kept in STATE."""

import fcntl
import hashlib
import json
import os
import platform
import pwd
import re
import socket
import subprocess
import sys
import tempfile
from contextlib import contextmanager

from .base import APP_HOME, ENTRY, Fail, GH, HOME, hc_json, now, run, STORE
from .settings import DEFAULTS, bare, read_settings

STATE = os.path.join(STORE, ".feedback.json")
REPO = DEFAULTS["agents"]["feedback_repo"]
AGAIN_MS = 12 * 3600000            # told or offered: not again within this (about a working session)
FILING_MS = 10 * 60000             # a filing under way: another --file of the same problem waits this long
KEEP_MS = 90 * 24 * 3600000        # what's remembered of a problem, the person's No too
LINE_MAX = 160
FIELD_MAX = 1500                   # a body section's length: never a log pasted whole
FIELD_LINES = 25
FIELDS = [("goal", "Goal"), ("happened", "What happened"), ("tried", "What was tried"), ("expected", "Expected"),
          ("fix", "Suggested fix"), ("repro", "Steps to reproduce")]
STOP = set("a an and are as at be but by can could did do does doesnt dont for from had has have i in is isnt it its "
           "me my no not of on or our so that the their them then there these this to too was wasnt we were what when "
           "where which while who why will with wont would you your".split())


# What every agent that isn't an Assistant is told at its session's start (reactions.agent_note), with offers on.
AGENT_NOTE = ("Feedback for BossGoat (on in Settings): when BossGoat itself misbehaves, not the project's own code (a BossGoat, "
              "herdr-task, web app or window feature that doesn't work as meant, a Herdr command failing like a bug, the person "
              "frustrated with BossGoat), run herdr-task feedback \"<one line>\" --details \"<goal, what was tried, what went wrong, "
              "expected, suggested fix>\" once per problem and carry on: it returns at once and the space's Assistant asks the "
              "person whether to file it. Never file an issue yourself; no secrets, private paths or whole logs.")


# ---- the settings ---------------------------------------------------------------------------

def feedback_on(space=None, d=None):
    """Settings › Agents › Feedback offers in a space: its own, else Everywhere's, else on."""
    d = read_settings() if d is None else d
    own = (d.get("spaces") or {}).get(bare(space)) if space else None
    for layer in (own, d.get("everywhere")):
        a = layer.get("agents") if isinstance(layer, dict) else None
        if isinstance(a, dict) and isinstance(a.get("feedback"), bool):
            return a["feedback"]
    return DEFAULTS["agents"]["feedback"]


def repo_of(value):
    """owner/name from a repo setting ("owner/name", a github.com URL), else None."""
    v = str(value or "").strip()
    v = re.sub(r"^(?:https?://)?(?:www\.)?github\.com/", "", v).rstrip("/")
    v = re.sub(r"\.git$", "", v)
    return v if re.fullmatch(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+", v) else None


def feedback_repo(d=None):
    """The repo feedback is filed to: Everywhere's agents.feedback_repo, else upstream BossGoat's."""
    d = read_settings() if d is None else d
    a = (d.get("everywhere") or {}).get("agents") if isinstance(d.get("everywhere"), dict) else None
    return repo_of((a or {}).get("feedback_repo") if isinstance(a, dict) else None) or REPO


# ---- one problem ----------------------------------------------------------------------------

def one_line(text, n=LINE_MAX):
    s = " ".join(str(text or "").split())
    return s if len(s) <= n else s[:n - 1].rstrip() + "…"


def words_of(line):
    return [w for w in re.findall(r"[a-z0-9]+", str(line).lower().replace("'", "")) if w not in STOP]


def key_of(line):
    """A problem's key: the words of its one line that say something, in order."""
    return hashlib.sha1(" ".join(words_of(line)).encode()).hexdigest()[:10]


@contextmanager
def problems():
    """STATE's {key: {line, state, at, space, ...}} under its lock (an agent and the Assistant may
    write it at once). state: told (sent to the Assistant), later (noted on an Autopilot wake, to
    offer once the person is back), offered, declined, filed."""
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            with open(STATE) as f:
                d = json.load(f)
        except (OSError, ValueError):
            d = {}
        ps = d.get("problems") if isinstance(d.get("problems"), dict) else {}
        for k in [k for k, p in ps.items() if now() - (p.get("at") or 0) > KEEP_MS and p.get("state") != "filed"]:
            ps.pop(k)
        yield ps
        tmp = f"{STATE}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump({"problems": ps}, f)
        os.replace(tmp, STATE)


def recent(p):
    return now() - (p.get("at") or 0) < AGAIN_MS


# ---- redaction ------------------------------------------------------------------------------

SECRETS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)"),
    re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
    re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}"),  # a JWT
    # a long run of letters and digits mixed (a key, a token): 32 or more
    re.compile(r"(?<![\w/.-])(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{32,}={0,2}(?![\w/.-])"),
]
NAMED_SECRET = re.compile(r"(?i)\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?)[A-Z0-9_]*)"
                          r"(\s*[=:]\s*)(\"[^\"]*\"|'[^']*'|\S+)")
BEARER = re.compile(r"(?i)\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{12,}")
URL_AUTH = re.compile(r"(\b[a-z][a-z0-9+.-]*://)[^/\s:@]+(?::[^/\s@]*)?@")
EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
HOME_PATH = re.compile(r"(?:/home|/Users)/[^/\s'\"`]+")
TAILNET = re.compile(r"\b[\w-]+(?:\.[\w-]+)*\.ts\.net\b")
IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")


def private_words():
    """Words that name this machine and its people: the account, its full name, git's user name,
    the host's name. Longest first, so a full name goes before its parts."""
    out = set()
    try:
        pw = pwd.getpwuid(os.getuid())
        out.add(pw.pw_name)
        out.update(x.strip() for x in (pw.pw_gecos or "").split(",")[:1])
    except KeyError:
        pass
    out.add(os.path.basename(HOME.rstrip("/")))
    try:
        r = subprocess.run(["git", "config", "--global", "user.name"], capture_output=True, text=True, timeout=3)
        out.add(r.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        pass
    host = socket.gethostname()
    out.update([host, host.split(".")[0]])
    words = {w for x in out for w in [x, *x.split()] if w and len(w) >= 3 and w.lower() not in ("root", "user", "admin", "localhost")}
    return sorted(words, key=len, reverse=True)


def redact(text, private=None):
    """Text fit for a public issue: secrets, tokens, credentials in URLs, e-mail addresses, home
    paths (made ~), tailnet names and IP addresses, and the names of this machine and its people
    gone. private: the words to hide (private_words() when None)."""
    s = str(text or "")
    s = HOME_PATH.sub("~", s.replace(HOME.rstrip("/") + "/", "~/")) if HOME.rstrip("/") else HOME_PATH.sub("~", s)
    for rx in SECRETS:
        s = rx.sub("<redacted>", s)
    s = NAMED_SECRET.sub(lambda m: f"{m.group(1)}{m.group(2)}<redacted>", s)
    s = BEARER.sub(lambda m: f"{m.group(1)} <redacted>", s)
    s = URL_AUTH.sub(r"\1<redacted>@", s)
    s = EMAIL.sub("<email>", s)
    s = TAILNET.sub("<host>", s)
    s = IPV4.sub("<ip>", s)
    for w in private_words() if private is None else private:
        s = re.sub(rf"(?i)(?<![\w-]){re.escape(w)}(?![\w-])", "<name>", s)
    return s


def trim(text):
    """A section's words, never a log whole: at most FIELD_LINES lines and FIELD_MAX characters."""
    s = str(text or "").strip()
    lines = s.split("\n")
    if len(lines) > FIELD_LINES:
        s = "\n".join(lines[:FIELD_LINES]) + "\n… (cut)"
    return s if len(s) <= FIELD_MAX else s[:FIELD_MAX].rstrip() + " … (cut)"


# ---- the issue ------------------------------------------------------------------------------

def shepherdr_version():
    try:
        with open(os.path.join(APP_HOME, "data", "shepherdr", "installed.json")) as f:
            return str(json.load(f).get("version") or "unknown")
    except (OSError, ValueError, AttributeError):
        return "unknown"


def os_words():
    if platform.system() == "Darwin":
        return f"macOS {platform.mac_ver()[0] or ''} ({platform.machine()})".replace("  ", " ")
    try:
        with open("/etc/os-release") as f:
            name = next((l.split("=", 1)[1].strip().strip('"') for l in f if l.startswith("PRETTY_NAME=")), None)
    except OSError:
        name = None
    return f"{name or platform.system()} ({platform.machine()})"


def cli_version(agent):
    """`<cli> --version`'s first line, for claude or codex; else ''."""
    if agent not in ("claude", "codex"):
        return ""
    try:
        r = subprocess.run([agent, "--version"], capture_output=True, text=True, timeout=5)
        return one_line(r.stdout.split("\n")[0], 60) if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def environment(agent=None, surface=None):
    agent = agent if agent in ("claude", "codex") else None
    names = {"claude": "Claude Code", "codex": "Codex"}
    v = cli_version(agent) if agent else ""
    return {"shepherdr": shepherdr_version(), "os": os_words(),
            "agent": (f"{names[agent]} {v}".strip() if agent else "not known"),
            "surface": {"web": "the web app", "window": "the Herdr window", "both": "the web app and the Herdr window"}.get(surface or "", "not stated")}


def issue_body(line, fields, env, private=None):
    """The issue's body, redacted: each section (Not known when empty), then Environment."""
    parts = []
    for key, head in FIELDS:
        words = trim(fields.get(key))
        parts.append(f"## {head}\n\n{words or '_Not known._'}")
    parts.append("## Environment\n\n" + "\n".join([
        f"- BossGoat: {env.get('shepherdr') or 'unknown'}",
        f"- Machine: {env.get('os') or 'unknown'}",
        f"- Agent CLI: {env.get('agent') or 'not known'}",
        f"- Used from: {env.get('surface') or 'not stated'}",
    ]))
    parts.append("_Filed by a BossGoat agent with the person's yes (Settings › Agents › Feedback offers)._")
    return redact("\n\n".join(parts), private)


def search_terms(line):
    """The words a duplicate search uses: the line's telling words once redacted (it leaves this
    machine too), at most six."""
    marks = {"redacted", "name", "email", "host", "ip"}
    return [w for w in words_of(redact(line)) if len(w) > 2 and w not in marks][:6]


def duplicates(repo, line):
    """Open issues in the repo that may be this one: [{number, title, url}] (gh issue list's search;
    all six words first, then the first three)."""
    words = search_terms(line)
    for ws in (words, words[:3]) if len(words) > 3 else (words,):
        if not ws:
            return []
        r = run([GH, "issue", "list", "--repo", repo, "--state", "open", "--search", " ".join(ws),
                 "--json", "number,title,url", "--limit", "5"])
        if r.returncode != 0:
            raise Fail("Couldn't search the repo's issues: " + one_line((r.stderr or r.stdout).strip() or "gh failed", 200)
                       + ". Is gh signed in (gh auth status)?")
        try:
            found = [x for x in json.loads(r.stdout or "[]") if isinstance(x, dict) and x.get("number")]
        except ValueError:
            found = []
        if found:
            return [{"number": x["number"], "title": x.get("title") or "", "url": x.get("url") or ""} for x in found]
    return []


def gh_with_body(args, body):
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(body)
    try:
        r = run([*args, "--body-file", f.name])
    finally:
        os.unlink(f.name)
    if r.returncode != 0:
        raise Fail(one_line((r.stderr or r.stdout).strip() or "gh failed", 300))
    urls = re.findall(r"https://\S+", r.stdout or "")
    return urls[-1] if urls else (r.stdout or "").strip()


# ---- the command ----------------------------------------------------------------------------

def me():
    addr = os.environ.get("HC_TERMINAL_ID")
    k = hc_json("get", addr) if addr else None
    return addr, k or {}


def agent_of(k):
    """The CLI an agent runs (claude, codex), from its label or its program, else None."""
    from .settings import agent_key
    labels = k.get("labels") or {}
    argv = (k.get("foreground") or {}).get("argv") or k.get("argv") or []
    return labels.get("herdr.agent") or (agent_key([str(x) for x in argv]) if argv else None)


def task_ref(labels):
    """The caller's task as people name it (SHEP-7), from its herdr.task label, else None."""
    slug, _, n = str(labels.get("herdr.task") or "").rpartition("#")
    if not slug or not n:
        return None
    try:
        with open(os.path.join(STORE, f"{slug}.json")) as f:
            d = json.load(f)
        pre = d.get("prefix")
        t = next((t for t in d.get("tasks") or [] if str(t.get("id")) == n), None)
        return (f"{pre}-{n}" if pre else f"#{n}"), (t or {}).get("title")
    except (OSError, ValueError, AttributeError):
        return None


def queue_news(to, text):
    """Hands the news line to a background herdr-task that holds it for the Assistant (news.hold,
    sent by the scheduler's next pass): the held messages' lock may be busy for seconds while a
    send goes out, and a report never waits on it."""
    subprocess.Popen([sys.executable, ENTRY, "_hold-news", to, text], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)


def news_line(ref, title, line, details, key):
    attr = lambda x: str(x).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")
    more = one_line(details, 900)
    text = f"{ref} feedback: {line}" + (f" · {more}" if more else "") + f" ({one_line(title or 'BossGoat', 80)})"
    return f'<herdr-news task="{attr(ref)}" event="feedback" key="{key}">{text.replace("<", "‹").replace(">", "›")}</herdr-news>'


def offer_words(line, key):
    return (f"Offer it once, when you're between things (never mid-work, never while the person is in the middle of "
            f"something urgent): ask with your question tool \"Leave feedback for BossGoat about {line}?\" with Yes, No and "
            f"Edit first. Yes: herdr-task feedback --key {key} \"{line}\" --file --goal … --happened … --tried … "
            f"--expected … --fix … --repro … --surface web|window. Edit first: show the draft (add --dry-run), take their "
            f"changes, then file. No: herdr-task feedback --key {key} \"{line}\" --no.")


def cmd_feedback(args):
    from .launch import caller_space, is_coordinator
    from .output import say
    from . import reactions
    line = one_line(args.line)
    addr, k = me()
    labels = k.get("labels") or {}
    assistant = bool(k) and is_coordinator(k)
    d = read_settings()
    space = caller_space() or reactions.space_of(k, d)
    if args.list:
        with problems() as ps:
            rows = [{"key": key, **p} for key, p in ps.items() if p.get("state") in ("told", "later")
                    and (not space or not p.get("space") or bare(p["space"]) == bare(space))]
        return say(args, rows, "\n".join(f"{r['key']}  {r['state']}  {r['line']}" for r in rows) or "Nothing waits to be offered.")
    if not line and not args.key:
        raise Fail("Say the problem in one line: herdr-task feedback \"Ready refused a reviewed commit\" --details \"…\"")
    if (args.file or args.no or args.later) and not assistant:
        raise Fail("Only an Assistant asks the person and files feedback: run herdr-task feedback \"<one line>\" --details \"…\" "
                   "and your Assistant offers it. Carry on with your work.")
    key = args.key or key_of(line)
    on = feedback_on(space, d)
    with problems() as ps:
        p = ps.get(key)
        line = line or (p or {}).get("line") or ""
        if args.no:
            ps[key] = {**(p or {}), "line": line, "state": "declined", "at": now(), "space": space}
            return say(args, {"key": key, "state": "declined"}, "Remembered: the person said no. Never offer this one again.")
        if not on and not args.dry_run:
            return say(args, {"key": key, "sent": False, "why": "off"},
                       "Feedback offers are off in Settings: nothing sent, nothing to offer. Carry on." if not args.file else
                       "Feedback offers are off in Settings: nothing filed.")
        if not args.file:
            return offer_or_tell(args, ps, key, p, line, k, addr, labels, assistant, space)
        known = dict(p or {})
        if known.get("state") == "filed" and not args.dry_run:
            return say(args, {"key": key, "filed": True, "url": known.get("url")}, f"Already filed: {known.get('url')}. Nothing filed again.")
        if known.get("state") == "filing" and now() - (known.get("at") or 0) < FILING_MS and not args.dry_run:
            return say(args, {"key": key, "filed": False, "why": "filing"}, "It's being filed right now: nothing filed again.")
        if not args.dry_run:
            ps[key] = {**known, "line": line, "state": "filing", "at": now()}
    # Filing talks to GitHub: outside the lock, so an agent's report never waits on it. Marked
    # "filing" meanwhile, so a second --file of the same problem can't file it twice.
    try:
        return file_it(args, key, known, line, d, agent_of(k))
    finally:
        if not args.dry_run:
            with problems() as ps:
                if (ps.get(key) or {}).get("state") == "filing":  # not filed (duplicates found, or gh failed): as it was
                    if known:
                        ps[key] = known
                    else:
                        ps.pop(key, None)


def offer_or_tell(args, ps, key, p, line, k, addr, labels, assistant, space):
    """Not filing, under STATE's lock: an Assistant is told whether to offer; any other agent's
    report goes to its Assistant as news, once per problem."""
    from .launch import coordinator_in
    from .output import say
    state = (p or {}).get("state")
    if state == "filing" and now() - (p.get("at") or 0) < FILING_MS:
        return say(args, {"key": key, "sent": False, "why": "filing"}, "Your Assistant is filing this one right now: nothing to do. Carry on.")
    if state == "declined":
        return say(args, {"key": key, "sent": False, "why": "declined"}, "The person said no to this before: nothing to do. Carry on.")
    if state == "filed":
        return say(args, {"key": key, "sent": False, "why": "filed", "url": p.get("url")},
                   f"Already filed: {p.get('url')}. Nothing to do. Carry on.")
    entry = {**(p or {}), "line": line, "at": now(), "space": space,
             **({"details": trim(args.details)} if args.details else {}),
             **({"agent": agent_of(k)} if agent_of(k) and not assistant else {})}
    if assistant:
        if state == "offered" and recent(p):
            return say(args, {"key": key, "offer": False, "why": "offered"}, "Already offered: don't offer it again.")
        if args.later:
            ps[key] = {**entry, "state": "later"}
            return say(args, {"key": key, "state": "later"}, "Noted: offer it once the person is back (herdr-task feedback --list).")
        ps[key] = {**entry, "state": "offered"}
        return say(args, {"key": key, "offer": True}, offer_words(line, key))
    if state in ("told", "offered", "later") and recent(p):
        return say(args, {"key": key, "sent": False, "why": "told"}, "Your Assistant already has this one: nothing sent. Carry on.")
    to = coordinator_in(space)
    if not to:
        return say(args, {"key": key, "sent": False, "why": "no-assistant"},
                   "No Assistant runs here to offer it: nothing sent. Say it in one line in your final message. Carry on.")
    ref, title = task_ref(labels) or (k.get("name") or addr or "Agent", None)
    queue_news(to, news_line(ref, title, line, args.details, key))
    ps[key] = {**entry, "state": "told", "by": ref}
    return say(args, {"key": key, "sent": True, "to": to},
               "Sent to your Assistant: it asks the person whether to file it. Carry on with your work.")


def file_it(args, key, p, line, d, agent):
    """The person said yes: a duplicate search first, then the issue (or a comment on one). Runs
    outside STATE's lock (gh may be slow); notes it as filed after."""
    from .output import say
    repo = repo_of(args.repo) or feedback_repo(d)
    p = p or {}
    fields = {f: getattr(args, f, None) for f, _ in FIELDS}
    if not fields.get("happened") and p.get("details"):
        fields["happened"] = p["details"]
    env = environment(p.get("agent") or agent, args.surface)
    title = redact(one_line(args.title or line, 120))
    body = issue_body(line, fields, env)
    dups = [] if args.new else duplicates(repo, line) if not args.comment else []
    if args.dry_run:
        out = {"repo": repo, "title": title, "body": body, "duplicates": dups}
        return say(args, out, f"Draft for {repo} (nothing filed):\n\nTitle: {title}\n\n{body}" +
                   ("\n\nPossible duplicates: " + "; ".join(f"#{x['number']} {x['title']}" for x in dups) if dups else ""))
    if dups:
        return say(args, {"key": key, "filed": False, "duplicates": dups},
                   "Possible duplicates are open:\n" + "\n".join(f"- #{x['number']} {x['title']} {x['url']}" for x in dups) +
                   f"\nAsk the person: add a comment there instead (--comment <number>), or file a new one anyway (--new).")
    if args.comment:
        url = gh_with_body([GH, "issue", "comment", str(args.comment), "--repo", repo], body)
    else:
        url = gh_with_body([GH, "issue", "create", "--repo", repo, "--title", title], body)
    with problems() as ps:
        ps[key] = {**ps.get(key, p), "line": line, "state": "filed", "at": now(), "url": url}
    return say(args, {"key": key, "filed": True, "url": url}, f"{'Commented' if args.comment else 'Filed'}: {url} — tell the person this link in one line.")
