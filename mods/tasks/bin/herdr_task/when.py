"""When: a one-off time in plain words (--at), a span from now (--in), and how people read them.
Times are this machine's time zone. Automations' "once …" uses parse_at too."""

import datetime
import re

from .base import Fail

AT_HOW = ('Write a time like "2026-11-06 09:00", "tomorrow 9:00", "fri 8:15", "today 18:00" or "18:00" '
          '(this machine\'s time zone).')
IN_HOW = 'Write a span like "6h", "90m", "2 days", "6 hours" or "1h 30m".'
UNITS = {"m": 1, "min": 1, "mins": 1, "minute": 1, "minutes": 1, "h": 60, "hr": 60, "hrs": 60, "hour": 60, "hours": 60,
         "d": 1440, "day": 1440, "days": 1440, "w": 10080, "wk": 10080, "week": 10080, "weeks": 10080}


def _now(now_ms):
    return datetime.datetime.fromtimestamp(now_ms / 1000) if now_ms is not None else datetime.datetime.now()


def _ms(d):
    return int(d.timestamp() * 1000)


def parse_clock(text, how=AT_HOW):
    """"9:00", "18.30", "9am", "9:30 pm", "noon", "midnight" -> (hour, minute)."""
    t = text.strip().lower()
    if t in ("noon", "midday"):
        return 12, 0
    if t == "midnight":
        return 0, 0
    m = re.fullmatch(r"(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?", t)
    if not m or (m.group(2) is None and m.group(3) is None):
        raise Fail(f"Unknown time {text.strip()!r}. " + how)
    h, mi, ap = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "").replace(".", "")
    if ap:
        if not 1 <= h <= 12:
            raise Fail(f"Unknown time {text.strip()!r}. " + how)
        h = (h % 12) + (12 if ap == "pm" else 0)
    if h > 23 or mi > 59:
        raise Fail(f"Unknown time {text.strip()!r}. " + how)
    return h, mi


def parse_at(text, now_ms=None, how=AT_HOW):
    """A moment from plain words, strictly (anything else is refused with `how`), as ms:
    "2026-11-06 09:00", "tomorrow 9:00", "fri 8:15" (the next Friday, today if still to come),
    "today 18:00", "18:00" (today, else tomorrow). It may be in the past only for a full date."""
    t = re.sub(r"\s+", " ", (text or "").strip().lower())
    t = re.sub(r"(^| )at (?=\d|noon|midnight)", r"\1", t).strip()
    t = re.sub(r",", " ", t).strip()
    t = re.sub(r"\s+", " ", t)
    if not t:
        raise Fail("Say when. " + how)
    now = _now(now_ms)
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t](.+))?", t)
    if m:
        if not m.group(4):
            raise Fail(f"Give a time of day too, like \"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d} 09:00\".")
        h, mi = parse_clock(m.group(4), how)
        try:
            return _ms(datetime.datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), h, mi))
        except ValueError:
            raise Fail(f"No such date: {text.strip()}")
    m = re.fullmatch(r"(?:((?:next |this )?[a-z]+) )?(.+)", t)
    day_word, clock = m.group(1), m.group(2)
    if day_word is None and day_of(t) is not None:
        raise Fail(f"Give a time of day too, like \"{t} 9:00\". " + how)
    ahead = day_of(day_word, now) if day_word else None
    if day_word and ahead is None:
        raise Fail(f"Unknown day {day_word!r}. " + how)
    h, mi = parse_clock(clock, how)
    base = now.replace(hour=h, minute=mi, second=0, microsecond=0)
    if day_word is None:
        return _ms(base if base > now else base + datetime.timedelta(days=1))
    d = base + datetime.timedelta(days=ahead)
    if day_word in ("today", "tonight") and d <= now:
        raise Fail(f"{clock} today has passed. " + how)
    if d <= now:
        d += datetime.timedelta(days=7)
    return _ms(d)


NAMES = "monday tuesday wednesday thursday friday saturday sunday".split()


def day_of(word, now=None):
    """Days ahead of today for a day word ("today" 0, "tomorrow" 1, "fri" the next Friday's,
    today's when it is Friday), or None for a word that isn't a day."""
    w = re.sub(r"^(next|this) ", "", (word or "").strip().lower())
    if w in ("today", "tonight"):
        return 0
    if w in ("tomorrow", "tmrw", "tmr"):
        return 1
    hit = [i for i, n in enumerate(NAMES) if len(w) >= 2 and n.startswith(w) or w in (n[:3], n[:3] + "s", n[:4])]
    if not hit:
        return None
    return (hit[0] - (now or datetime.datetime.now()).weekday()) % 7


def parse_in(text, how=IN_HOW):
    """A span from now in plain words, strictly: "6h", "90m", "2 days", "6 hours", "1h 30m",
    "in 6 hours" -> ms."""
    t = re.sub(r"\s+", " ", (text or "").strip().lower())
    t = re.sub(r"^in ", "", t).replace(" and ", " ").replace(",", " ").strip()
    if not t:
        raise Fail("Say how long from now. " + how)
    total, pos = 0.0, 0
    for m in re.finditer(r"\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*", t):
        if m.start() != pos or m.group(2) not in UNITS:
            raise Fail(f"Unknown span {text.strip()!r}. " + how)
        total += float(m.group(1)) * UNITS[m.group(2)]
        pos = m.end()
    if pos != len(t) or total <= 0:
        raise Fail(f"Unknown span {text.strip()!r}. " + how)
    return int(round(total * 60000))


def when_from(at=None, within=None, now_ms=None):
    """--at / --in to a moment (ms). Refuses both at once and a moment already passed."""
    import time
    now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
    if at is not None and within is not None:
        raise Fail("Give --at or --in, not both.")
    if within is not None:
        return now_ms + parse_in(within)
    try:
        ms = parse_at(at, now_ms)
    except Fail as e:
        # A span typed where a time goes ("6h", "in 6 hours": the web's Other time… field) is from now.
        try:
            return now_ms + parse_in(at)
        except Fail:
            raise Fail(f"{e} Or a span from now, like \"6h\" or \"in 2 days\".")
    if ms <= now_ms:
        raise Fail(f"{at.strip()} has passed. " + AT_HOW)
    return ms


def span(ms):
    """"45m", "6h", "6h 30m", "2d" (rounded as people read a countdown)."""
    m = max(0, -(-ms // 60000))
    if m < 60:
        return f"{max(1, m)}m"
    if m < 24 * 60:
        h, r = divmod(m, 60)
        return f"{h}h" + (f" {r}m" if r and h < 10 else "")
    return f"{round(m / 1440)}d"


def clock_words(ms, now_ms):
    """"Today 18:00", "Tomorrow 9:00", "Fri 09:00", "Nov 20 09:00" (as core/tasks.js startsAt())."""
    d, n = datetime.datetime.fromtimestamp(ms / 1000), datetime.datetime.fromtimestamp(now_ms / 1000)
    hm = f"{d.hour}:{d.minute:02d}"
    days = (d.date() - n.date()).days
    if days == 0:
        return f"Today {hm}"
    if days == 1:
        return f"Tomorrow {hm}"
    if 1 < days < 7:
        return f"{d.strftime('%a')} {hm}"
    return f"{d.strftime('%b')} {d.day} {hm}"


def starts_words(ms, now_ms):
    """A scheduled task's why: "Starts Fri 9:00 (in 6h)", or "Starts now" once due."""
    if ms <= now_ms:
        return "Starts now"
    return f"Starts {clock_words(ms, now_ms)} (in {span(ms - now_ms)})"
