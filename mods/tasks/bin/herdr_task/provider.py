"""Provider errors: a turn the model's provider cut off, and whether to retry it."""

import datetime
import re

from .agents import fit, from_person, log_tail, REASONS


# ---- provider errors ------------------------------------------------------------------------
# A turn cut off by the model's provider is no question for the person: Herdr waits and tells
# the agent to carry on after PROVIDER_WAITS minutes; only when the fifth try is cut off too (or
# the error is one waiting can't fix) does it need them. As Shepherdr's provider-error.ts: the
# CLI's own log says what cut it off (its code and HTTP status where it has them, else its words).

PROVIDER_WAITS = [1, 2, 4, 8]
CODE_PASSING = {"server_overloaded": "Provider overloaded", "overloaded": "Provider overloaded", "overloaded_error": "Provider overloaded",
                "model_cap": "Model at capacity", "http_connection_failed": "Connection dropped",
                "response_stream_connection_failed": "Connection dropped", "response_stream_disconnected": "Connection dropped",
                "response_too_many_failed_attempts": "Connection dropped", "internal_server_error": "Provider server error",
                "server_error": "Provider server error"}
CODE_LASTING = ["unauthorized", "bad_request", "context_window_exceeded", "usage_limit_exceeded", "sandbox_error", "authentication_failed",
                "billing_error", "invalid_request", "model_not_found", "max_output_tokens"]
WORDS_AUTH = re.compile(r"\b(?:status|error|HTTP)\b[^\n]{0,12}\b40[13]\b|\b401 Unauthorized\b|please run /login|login expired|not logged in|oauth token", re.I)
WORDS_ALLOWANCE = re.compile(r"usage limit|(?<!rate.)(?<!rate)limit reached|hit your [\w ]*limit|\bquota\b|billing|credit balance|payment", re.I)
WORDS_LASTING = re.compile(r"not supported|unsupported|does not exist|may not exist|not found|unknown (?:provider|model)|invalid|context (?:window|length)|flagged|content policy", re.I)
WORDS_PASSING = [
    (re.compile(r"at capacity", re.I), "Model at capacity"),
    (re.compile(r"rate.?limit|too many requests|\b429\b", re.I), "Rate limited"),
    (re.compile(r"overloaded|\b529\b", re.I), "Provider overloaded"),
    (re.compile(r"socket|connection|network|\bE(?:CONN\w+|TIMEDOUT|AI_AGAIN|PIPE)\b|timed? ?out|fetch failed|stream (?:ended|closed|disconnected|error)|disconnect", re.I), "Connection dropped"),
    (re.compile(r"\b(?:API error|status|HTTP)\b[^\n]{0,12}\b5\d\d\b|internal server error|bad gateway|service unavailable|upstream|server error|you can retry your request|try again later", re.I), "Provider server error"),
]


def provider_error(words, code="", status=0):
    """{passing, reason}: whether it passes by itself, and in a few words for a status line."""
    c, words, status = str(code or "").lower(), str(words or ""), status if isinstance(status, int) else 0
    told = next((r for rx, r in WORDS_PASSING if rx.search(words)), None)
    if c in ("unauthorized", "authentication_failed") or status in (401, 403) or WORDS_AUTH.search(words):
        return {"passing": False, "reason": REASONS["signed_out"]}
    if c in ("usage_limit_exceeded", "billing_error") or WORDS_ALLOWANCE.search(words):
        m = re.search(r"\bresets (?:at )?([^\n·.,;()]{1,24})|try again (?:at|after) ([^\n.,;()]{1,24})", words, re.I)
        when = (m.group(1) or m.group(2)).strip() if m else ""
        return {"passing": False, "reason": fit(f"Out of allowance until {when}" if when else "Out of allowance")}
    if c in CODE_LASTING or (400 <= status < 500 and status not in (408, 429)) or WORDS_LASTING.search(words):
        full = c == "context_window_exceeded" or re.search(r"context (?:window|length)|too long", words, re.I)
        model = c == "model_not_found" or re.search(r"model", words, re.I)
        return {"passing": False, "reason": "Context window full" if full else "Model not available" if model else "Provider refused it"}
    if c in CODE_PASSING:
        return {"passing": True, "reason": told or CODE_PASSING[c]}
    if status == 429 or c == "rate_limit":
        return {"passing": True, "reason": "Rate limited"}
    if status == 408 or status >= 500:
        return {"passing": True, "reason": told or ("Provider overloaded" if status == 529 else "Provider server error")}
    return {"passing": True, "reason": told} if told else {"passing": False, "reason": "Provider error"}


# Herdr's carry-on message; its words also mark it in the log, so a cut after it counts as another try.
NUDGE = ("Your last turn was cut off by the model's provider ({}). "
         "Carry on where you left off within your existing authorization.")
NUDGE_MARK = "cut off by the model's provider"


def provider_cut(log):
    """The provider error the agent's log ends on, or None: {id, text, code, status, tries}, where
    tries counts the cut turns since someone last wrote to it (Herdr's carry-on messages don't
    count: anything else written starts the count again)."""
    cut, tries = None, 0
    for d in log_tail(log):
        p = d.get("payload") or {}
        if d.get("type") == "assistant" and not d.get("isSidechain"):
            if d.get("isApiErrorMessage"):
                c = (d.get("message") or {}).get("content") or []
                text = "\n".join(x.get("text") or "" for x in c if isinstance(x, dict)) if isinstance(c, list) else str(c)
                tries += 1
                cut = {"id": d.get("uuid") or d.get("timestamp") or str(tries), "text": text, "ts": d.get("timestamp"),
                       "code": d.get("error") if isinstance(d.get("error"), str) else "",
                       "status": d.get("apiErrorStatus") if isinstance(d.get("apiErrorStatus"), int) else 0}
            else:
                cut = None
        elif d.get("type") == "event_msg" and p.get("type") == "task_started":
            cut = None
        elif d.get("type") == "event_msg" and p.get("type") in ("task_complete", "turn_aborted") and isinstance(p.get("error"), dict):
            err = p["error"]
            tries += 1
            cut = {"id": f"codex-{p.get('turn_id') or d.get('timestamp')}", "text": str(err.get("message") or ""), "ts": d.get("timestamp"),
                   "code": err.get("codex_error_info") if isinstance(err.get("codex_error_info"), str) else "", "status": 0}
        elif d.get("type") == "response_item" and p.get("role") == "assistant":
            cut = None
        else:
            words = from_person(d)
            if words is not None:
                cut = None
                if NUDGE_MARK not in words:
                    tries = 0
    if cut:
        cut["tries"] = max(1, tries)
        try:
            cut["at"] = int(datetime.datetime.fromisoformat(str(cut.pop("ts")).replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            cut["at"] = None
    return cut
