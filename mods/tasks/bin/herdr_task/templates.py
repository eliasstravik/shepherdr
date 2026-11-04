"""The instructions agents start with: ~/.config/herdr-core/templates, and the built-in ones."""

import os
import re

from .settings import OLD_INSTRUCTIONS, TEMPLATES


WORKER_MD_BEFORE_NEWS = """You work on one Herdr task. Stay within the task's scope and folder.
- Your brief ends with a Settings block: one line per setting that shapes how you work. A line ending in parentheses says who changed it from Herdr's default. Where the brief's own words say otherwise, they win.
- Commit as you go, with clear messages. Don't merge, push, rebase shared branches or start other agents unless the task says so (the reviewer of your own review is fine).
- If something blocks you or the task is unclear, ask in your chat and wait.
- Say how it's going: at the start and at each natural step, run the `herdr-task status` command given at the end of your brief with what you're doing now (at most 40 characters), how far through the whole task you are and about how long is left. The person sees it in the Tasks panel.
- Run the project's checks before you say you're done.
- Review, when the Settings block says Review: on. Commit, then have fresh eyes that didn't write the change review it, read-only: a subagent, or a headless run of the Reviewer line's CLI with its model and effort (`codex exec --sandbox read-only "<prompt>" < /dev/null`, `claude -p --permission-mode plan "<prompt>" < /dev/null`: without `< /dev/null` they wait for input forever), your choice. Give it the brief, the diff against the base branch and ~/.herdr/instructions/reviewer.md. It reports what the change broke, left undone or added beyond the brief, each with proof and a level: blocker (breaks or loses people's work, or unsafe), major (someone would hit it, or it proves a claim false), minor (rarely hit, or style). Fix every finding at or above Must fix, commit, and review again; stop once a round finds none at or above it, or after Review rounds. Never agree with a finding just to end the loop: one you judge wrong goes in your summary with why, as do findings below the bar.
- When the work is finished, run the `herdr-task ready` command given at the end of your brief, with a short summary. That puts the task in Ready for the person, who accepts it. Never mark a task done yourself. Merging then goes as the Merge line says; don't merge yourself unless told.
"""

# Since task news: why it waits is the agent's own status line, and its ask one full question.
WORKER_MD_BEFORE_TEMPLATES = WORKER_MD_BEFORE_NEWS.replace(
    "- If something blocks you or the task is unclear, ask in your chat and wait.\n",
    "- If something blocks you or the task is unclear, ask in your chat and wait. Before you ask the person or stop to wait, "
    "set your status line to why, in your own words (the `herdr-task status` command below, at most 40 characters, e.g. "
    "\"Needs a go to screenshot the menu\"): the person and the Assistant see it. End your message with one full question "
    "that names what you need and why (\"Can I take the window for 30s to screenshot the More menu?\"), never a bare \"Go?\".\n")
# Since the roles are templates: the reviewer's words are in its template.
WORKER_MD_BEFORE_GATE = WORKER_MD_BEFORE_TEMPLATES.replace("~/.herdr/instructions/reviewer.md", "~/.config/herdr-core/templates/reviewer.md")
# Since ready waits for a reviewed final commit (HERD-49), with GitHub news and "For AGENTS.md".
REVIEW_GATE = (" After each round, record it on the commit it reviewed with the `herdr-task reviewed` command given at the end "
               "of your brief: `ready` refuses a final commit no round was recorded on. Rounds used and your final commit "
               "unreviewed: say why in your chat, set your status line to it and end your turn; only your Assistant can add a round.")
AFTER_READY = ("- After ready, GitHub news on your pull request may arrive (a <herdr-github> message: a failed check, a review "
               "or comment with words). A failure your change caused: fix it. One outside it (the base is red too): say so in "
               "one line. A clear wish that fits the brief: do it. Anything else: ask the person in one short message. Then "
               "run ready again.\n"
               "- Anything about setting up or testing this repo that the next agent would need and AGENTS.md lacks: add "
               "`--agents-md \"<one line>\"` to your ready command. The Assistant decides whether it goes in; never commit it yourself.\n")
_REVIEW_END = "as do findings below the bar."
WORKER_MD_BEFORE_SUMMARY = WORKER_MD_BEFORE_GATE.replace(_REVIEW_END, _REVIEW_END + REVIEW_GATE) + AFTER_READY
# Since the ready summary is short and for the person (HERD-64, as Shepherdr's).
READY_LINE = ("- When the work is finished, run the `herdr-task ready` command given at the end of your brief, with a short summary.")
SUMMARY_RULE = ("- When the work is finished, run the `herdr-task ready` command given at the end of your brief. Its summary is for "
                "the person, like explaining it to a five-year-old: at most 160 characters of plain words on what they now see or "
                "can do (\"The Accept card is bigger and starts with a short summary\"), no file names, flags, numbers or jargon. "
                "Technical detail goes in `--details \"…\"` (any length, folded in the Accept card) or your proof; ready refuses "
                "a longer summary.")
WORKER_MD_BEFORE_ESTIMATE = WORKER_MD_BEFORE_SUMMARY.replace(READY_LINE, SUMMARY_RULE)
# Since time left waits for a real estimate (HERD-72): no --left at the start.
ESTIMATE_OLD = "how far through the whole task you are and about how long is left. The person sees it in the Tasks panel."
ESTIMATE_RULE = ("how far through the whole task you are (`--done`). Leave out `--left` at the start: add about how long is left "
                 "only once you know the work well enough for a real estimate, never a first guess. The person sees it in the Tasks panel.")
WORKER_MD_BEFORE_CUT = WORKER_MD_BEFORE_ESTIMATE.replace(ESTIMATE_OLD, ESTIMATE_RULE)
# Since a longer status line is cut at a word (HERD-84, as Shepherdr's): the agent knows before it writes one.
CUT_OLD = "with what you're doing now (at most 40 characters), how far"
CUT_RULE = "with what you're doing now (at most 40 characters; a longer one is cut at a word), how far"
WORKER_MD_BEFORE_DETAILS = WORKER_MD_BEFORE_CUT.replace(CUT_OLD, CUT_RULE)
# Since details are short markdown bullets, not one dense paragraph (HERD-85).
DETAILS_OLD = ("Technical detail goes in `--details \"…\"` (any length, folded in the Accept card) or your proof; ready refuses "
               "a longer summary.")
DETAILS_RULE = ("Ready refuses a longer summary. Technical detail goes in your proof or in `--details \"…\"` (folded in the "
                "Accept card): a few short bullets in plain words, one `- ` per line: what changed for the person first, then how "
                "it was checked; file names only where they help; never one dense paragraph.")
WORKER_MD_BEFORE_LEFT = WORKER_MD_BEFORE_DETAILS.replace(DETAILS_OLD, DETAILS_RULE)
# Since every status gives the time left, a rough guess beats none (SHEP-13).
LEFT_OLD = ("Leave out `--left` at the start: add about how long is left only once you know the work well enough for a real "
            "estimate, never a first guess.")
LEFT_RULE = ("Always add `--left` with your best estimate of how long is left (like 20m or 2h), from your very first status "
             "on, and update it at every step as you learn more. A rough guess beats none.")
WORKER_MD = WORKER_MD_BEFORE_LEFT.replace(LEFT_OLD, LEFT_RULE)

REVIEWER_MD = """You review one Herdr task's work before it can merge. Read only: never edit files, commit or push.
- Read the task, then the diff of its branch against its base, and run the project's checks.
- Report each finding with a level: blocker (wrong, breaks something, or unsafe), major (should be fixed before merging), minor (a nit or a later improvement).
- Be concrete: file, line, what is wrong and what to do instead. No praise, no summaries of the diff.
"""


# Earlier worker defaults: a file still saying one, unedited, gets today's.
OLD_WORKER_REVIEW = WORKER_MD_BEFORE_NEWS.replace(WORKER_MD_BEFORE_NEWS.split("\n")[4] + "\n", "")
OLD_WORKER_FIRST = "You work on one Herdr task, in your own tab. Stay within the task's scope and folder."
OLD_WORKER_READY = """You work on one Herdr task. Stay within the task's scope and folder.
- Commit as you go, with clear messages. Don't merge, push, rebase shared branches or start other agents unless the task says so.
- If something blocks you or the task is unclear, ask in your chat and wait.
- Run the project's checks before you say you're done.
- When the work is finished, run the `herdr-task ready` command given at the end of your brief, with a short summary. That puts the task in Ready for the person, who accepts it. Never mark a task done yourself.
"""
OLD_WORKER_MD = OLD_WORKER_READY.split("- When the work is finished")[0]
OLD_WORKERS = (WORKER_MD_BEFORE_LEFT, WORKER_MD_BEFORE_DETAILS, WORKER_MD_BEFORE_CUT, WORKER_MD_BEFORE_ESTIMATE, WORKER_MD_BEFORE_SUMMARY, WORKER_MD_BEFORE_GATE, WORKER_MD_BEFORE_TEMPLATES, WORKER_MD_BEFORE_NEWS, OLD_WORKER_READY, OLD_WORKER_MD, OLD_WORKER_MD.replace(OLD_WORKER_MD.split("\n")[0], OLD_WORKER_FIRST), OLD_WORKER_REVIEW)


TEMPLATE_HEADS = {
    "worker": "---\nname: worker\ndescription: Works on one Herdr task in its folder or its own git worktree: commits as it goes, "
              "says how it is going with herdr-task status, and herdr-task ready when finished. herdr-task starts it with the "
              "task's brief after these words.\ncommand: claude\n---\n",
    "reviewer": "---\nname: reviewer\ndescription: Reviews one Herdr task's work read-only before it merges and reports each "
                "finding with a level (blocker, major, minor).\ncommand: claude\n---\n",
}
FRONT = re.compile(r"\A---[ \t]*\n.*?\n---[ \t]*(?:\n|\Z)", re.S)


def instructions(role):
    """The role's instructions: the words of its herdr-core template (TEMPLATES/<role>.md, which
    `hc templates` lists and the settings window opens for the person to edit), without the
    frontmatter. A missing one is made from the person's old ~/.herdr/instructions file, else the
    defaults; an unedited earlier worker default gets today's."""
    path = os.path.join(TEMPLATES, f"{role}.md")
    head = TEMPLATE_HEADS[role]
    try:
        with open(path) as f:
            text = f.read()
        m = FRONT.match(text)
        head, body = (m.group(0), text[m.end():]) if m else (head, text)
    except OSError:
        try:
            with open(os.path.join(OLD_INSTRUCTIONS, f"{role}.md")) as f:
                body = f.read()
        except OSError:
            body = None
        text = None
    if body is None or (role == "worker" and body.strip() in [x.strip() for x in OLD_WORKERS]):
        body = WORKER_MD if role == "worker" else REVIEWER_MD
    new = head + body.strip() + "\n"
    if text is None or new.strip() != text.strip():
        try:
            os.makedirs(TEMPLATES, exist_ok=True)
            tmp = os.path.join(TEMPLATES, f".{role}.md.tmp")
            with open(tmp, "w") as f:
                f.write(new)
            os.replace(tmp, path)
        except OSError:
            pass
    return body.strip()
