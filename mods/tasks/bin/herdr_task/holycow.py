"""HolyCow skill choices and the instructions added to a task's existing protocol."""

import os
from .base import Fail, HOME

SKILLS = {
    "holycow-guide": "coordinator", "holycow-init": "worker", "hc-compass": "worker",
    "hc-refine": "worker", "hc-lab": "worker", "hc-plan": "worker", "hc-build": "worker",
    "hc-review": "reviewer", "hc-pr": "worker", "hc-retro": "worker",
}


def skill_pick(cfg, skill):
    if skill not in SKILLS:
        raise Fail(f"Unknown HolyCow skill: {skill}.")
    pick = dict((cfg.get("holycow") or {}).get(skill) or cfg.get(SKILLS[skill]) or {})
    if skill == "hc-review":
        pick["perm"] = "plan" if pick.get("agent") == "claude" else "read-only"
    return pick


def skill_file(skill, folder, agent, source=None):
    if skill not in SKILLS:
        raise Fail(f"Unknown HolyCow skill: {skill}.")
    roots = {"claude": [".claude", ".agents"], "codex": [".agents", ".codex"],
             "cursor": [".cursor", ".agents", ".claude"]}.get(agent, [".agents"])
    for base in (folder, source, HOME):
        if not base:
            continue
        for root in roots:
            path = os.path.join(base, root, "skills", skill, "SKILL.md")
            if os.path.isfile(path) and os.access(path, os.R_OK):
                return path
    raise Fail(f"HolyCow skill {skill} is not installed for {agent} on this machine. "
               "Install it in the repository or your agent's skills folder, then start the task again.")


def skill_note(skill, folder, agent, source=None):
    path = skill_file(skill, folder, agent, source)
    return (f"HolyCow skill: {skill}. Before doing this task, read {path} and its required references "
            "(relative references are relative to that skill's folder). Follow that skill within the task's scope. "
            "Keep the role instructions, task status, proof and review protocol; do not create a duplicate review loop."
            + (" This is a read-only review: never edit the repository, commit or push." if skill == "hc-review" else ""))


def assistant_words(cfg):
    if (cfg.get("holycow") or {}).get("enabled") is not True:
        return "off (skill tasks can still be explicitly requested with --skill)"
    picks = []
    for skill in SKILLS:
        pick = skill_pick(cfg, skill)
        words = "/".join(str(pick[k]) for k in ("agent", "model", "effort") if pick.get(k)) or f"{SKILLS[skill]} defaults"
        picks.append(f"{skill}: {words}")
    return ("on. For software work, read the installed holycow-guide/SKILL.md and its routing references "
            "from this repository's or your home agent skills folders (.agents/skills, .claude/skills, "
            ".codex/skills or .cursor/skills). Use the smallest relevant skill, without requiring a full pipeline. "
            "When creating a skill task, use `herdr-task add ... --skill <skill-id>`; BossGoat chooses its agent "
            "and model from HolyCow Agents settings. Do not copy stale model choices into --agent/--model/--effort; "
            "use those overrides only when the person asks. Guide's model is for delegated Guide tasks; it does "
            "not replace this running Assistant. Greetings, facts, status and board administration need no skill task. "
            "If a needed skill is missing, report it; do not silently run without it. The existing worker-led review "
            "uses hc-review, once, when review is on. Models for new skill tasks: " + "; ".join(picks))
