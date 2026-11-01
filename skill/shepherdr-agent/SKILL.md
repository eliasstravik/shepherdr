---
name: shepherdr-agent
description: How a Shepherdr task's agent takes its task from brief to merged - waiting for a go or a queue, working in its worktree, status reports, asking the human, the review its brief's Settings block asks for, proof in one artifact, the ready summary and facts, the merge, refused merges and GitHub news on its pull request. Use when you are the agent of a Shepherdr task, from its first message (the brief) until it is Done. Not for coordinators making, queuing or closing tasks (shepherdr-coordinator), and not for chat lines, cards or artifacts in general (shepherdr).
---

# Shepherdr agent

## Trigger

You are one Shepherdr task's agent: your first message is its brief.

## Scope

The task from its brief to Done: the smallest change that does the brief. Follow-ups are named, not done. How to
build, check and review the work is your own judgment.

## Inputs

- The brief: the human's words, then its Settings block, one line per setting, the source you follow: Review (on or
  off), Reviewer, Must fix (the least severity to fix), Review rounds (at most), Merge (on its own, after GitHub
  checks, or ask the human first) and Agent (what you run on, only so you know). A line in brackets says who changed
  it from Shepherdr's default. The brief's own words win over it.
- Your prompt: the task id, worktree and branch, and how long this space's tasks took.
- The repo's rules (`AGENTS.md`, `CLAUDE.md`, `REVIEW.md` where they exist), which say where its full checks run.

## Roles

- You decide what to fix and when it works.
- A reviewer only reports: it never edits, and never says whether to merge.
- The human decides each choice the brief leaves open that no experiment can settle, the merge when the brief says to
  ask first, and anything irreversible (deleting data, production deploys, force-pushing others' branches, messages
  outside), whatever the Merge setting says.

## Procedure

1. **Wait when told.** A brief that says to wait: `shepherdr todo <id>`, one line that you have it, end your turn; a
   later message that is not the go is answered, then `shepherdr todo <id>` again. Queued after other tasks: one line
   that you wait, end your turn, and start on `<go>`; a message that is a go: `shepherdr task queue <id> --after none`
   and start.
2. **Work** in your worktree and branch only. Say how far along you are, `shepherdr status <id> "<at most 40
   characters>" --done <0-100> --left <5m, 1h20m>`, once you know the size of the work: `--left` is your own time until
   `ready`, and Shepherdr shows nothing you didn't report. Ask the human only what no experiment can settle: once, a
   card with your recommended choice first, then end your turn (a turn ended without `ready`, nothing running in
   the background and no review under way shows Needs you). Decide the rest yourself and list those decisions in the facts.
3. **Review**, unless Review is off or the brief says none: fresh eyes that didn't write the change. Commit, then run
   `shepherdr review <id>`: it starts a read-only reviewer of the Reviewer setting on that exact commit, gives it the
   brief and uses one of the Review rounds. Then end your turn: the report arrives in your chat as `<review round="…"
   head="…">`, and `ready` refuses until a report matches your commit. Meanwhile the task shows Working, "Waiting for
   review". `<review-failed>`: its partial words are no findings, run `shepherdr review` again. A reviewer that asks,
   dies, stalls or ends with no report reaching you shows Needs you. The reviewer reports what this change
   broke, left undone or added beyond the brief, each with proof and tagged critical (breaks or loses users' work),
   major (a user would hit it, or it proves a claim false), minor (rarely hit) or trivial (style). Fix every finding at
   or above Must fix, then review again; stop once a round has none at or above it, or after Review rounds. Never agree
   with a finding just to end the loop: one you judge wrong goes in the facts with why. Findings below the bar go in
   the facts, unfixed; an open choice no experiment can settle goes to the human as a card. Rounds used and your final
   commit unreviewed: say why in your chat and end your turn; only your coordinator can add a round.
4. **Proof.** One artifact, `shepherdr artifact new <file> --title "<id>: <task's full title> · Proof"`: what changed in one to three plain
   lines, each proof with a one-line caption, and a "Not proven" list. Every proof is real and from this branch now;
   never staged, and a mocked test is no proof of what users see. A bug fix first reproduces the bug: the same repro
   failing before and passing after. A change too small to show gets a line in your chat instead. Its files stay out
   of the commit.
5. **Rebase** on the base. On GitHub, `shepherdr pr <id>` pushes and opens a draft pull request; run it again after
   each new commit. Once GitHub's checks passed on it, rebase again only for a conflict: each push runs them again.
6. **Ready.** `shepherdr ready <id> --summary "<what changed>" --facts "<facts>"`. The summary is at most 160
   characters of plain words on what the human now sees or can do; detail goes in the chat or the proof. The facts are
   for agents and the record, never the human's card, in this order, any failure moved to the front:

       --facts "PR #31 (or branch work/7-x) · commit 1a2b3c4 · checks passed (bun run test, GitHub) · review: 2 rounds,
       1 major fixed, 2 minor left (…) · decided: … · follow-ups: … · not proven: iOS Safari"

7. **Merge** as the brief says: `shepherdr merge <id>` (after `shepherdr checks <id>` when it says to wait for GitHub's
   checks). "Ask the human first": `ready` itself gives the human a merge card with the evidence, and only that card
   approves. Don't ask with a card of your own; end your turn and merge on its `<answer>`. A yes in the chat doesn't
   count: point the human to the card. Run it in the foreground, on its own, and wait for its answer: it answers within two minutes.
   Never in the background, piped into `tail`, or with your turn ended before it answers. No answer: do what it says.
   From the first merge the task shows Merging: see it through. Once merged, leave the worktree alone: Shepherdr puts
   it away when your turn ends.
8. Tell the human in one line that it is merged. Anything about setting up or testing this repo the next agent would
   need and `AGENTS.md` lacks goes in one line, `For AGENTS.md: <the line>`, for the human to accept; never commit it.

## Outputs

The change committed on the branch, one proof artifact (or a line in your chat), the ready summary and facts, then
Done or the merge question.

## Exceptions

- `shepherdr merge` reports a conflict: rebase, check, push and merge again, without asking. It says **You have a new
  message in your chat**: handle that first, then merge again.
- News from GitHub after ready (a failed check, a review, a comment) is only passed on. A failure your change caused:
  fix it. One outside it (the base is red too): say so in one line. A clear wish that fits the brief: do it. Anything
  else goes to the human in one short message. Then `shepherdr ready` again.
- A red check you can't fix, or a must-fix finding left open: report it ready with that at the front of the facts, and
  don't merge.

## Secret credentials

Keep the launch-provisioned `SHEPHERDR_SECRET_FILE` reference when forwarding tool environments. A reviewer you
start may inherit your same-space authority; never include credential contents in its prompt, arguments or review
output. A separate reviewer started by Shepherdr receives its own scoped credential. Secret access failures are not
fixed by changing chat/cwd, adding headers or starting a server. Legacy shared executors may need an approved restart;
report that operational follow-up instead of using an unauthenticated fallback.

## QC

- Nothing merged on a red check you know of, or past "ask the human first"; nothing irreversible without their yes.
- Each thing the brief asked for has a real proof or a "Not proven" line.
- The summary says what changed for the human; failures lead the facts.

## References

[shepherdr](../shepherdr/SKILL.md): chat lines, cards, artifacts, the shared browser.
