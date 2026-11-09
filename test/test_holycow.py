"""Skill routing must launch the chosen CLI, preserve task rules and fail on missing skills."""
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mods/tasks/bin"))
from herdr_task import settings, holycow, launch, assistant_settings, commands
from herdr_task.base import Fail


class HolyCow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.file = self.root / "settings.json"
        self.cfg = {"everywhere": {"worker": {"agent": "claude", "model": "opus", "effort": "high"},
                    "coordinator": {"agent": "cursor", "model": "auto"},
                    "holycow": {"enabled": True, "hc-plan": {"agent": "cursor", "model": "auto", "perm": "auto"},
                                "hc-build": {"agent": "codex", "model": "build-model", "effort": "high", "fast": True},
                                "hc-review": {"agent": "cursor", "model": "review-model", "perm": "full"}}},
                    "spaces": {"one": {"folder": str(self.root), "holycow": {"hc-build": {"agent": "claude", "model": "space-model"}}}}}
        self.file.write_text(json.dumps(self.cfg))
        self.s = SimpleNamespace(loc={"folder": str(self.root), "kind": "repo"}, ref=lambda t: "TEST-1")
        for obj, key, value in [(settings, "SETTINGS", str(self.file)), (holycow, "HOME", str(self.root / "home"))]:
            p = patch.object(obj, key, value); p.start(); self.addCleanup(p.stop)

    def test_skill_flag_is_validated_and_resettable(self):
        task = {}
        settings.set_opts(task, SimpleNamespace(skill="hc-plan"))
        self.assertEqual(task["skill"], "hc-plan")
        with self.assertRaises(Fail):
            settings.set_task(task, "skill", "../../unknown")
        settings.set_task(task, "skill", "default")
        self.assertNotIn("skill", task)

    def test_skill_choice_is_atomic_and_explicit_task_choice_wins(self):
        p = settings.worker_pick(self.s, {"skill": "hc-build"}, "one")
        self.assertEqual(p, {"agent": "claude", "model": "space-model"})
        p = settings.worker_pick(self.s, {"skill": "hc-plan", "agent": "codex", "model": "explicit"})
        self.assertEqual(p, {"agent": "codex", "model": "explicit"})
        argv = settings.worker_argv(self.s, {"skill": "hc-plan"})
        self.assertEqual(argv, ["cursor-agent", "--model", "auto", "--auto-review"])

    def test_unset_skills_follow_their_roles_and_unmarked_tasks_keep_workers(self):
        self.assertEqual(settings.worker_pick(self.s, {"skill": "holycow-guide"}), {"agent": "cursor", "model": "auto"})
        self.assertEqual(settings.worker_pick(self.s, {"skill": "hc-retro"}), settings.worker_pick(self.s, {}))

    def install_skill(self, skill):
        p = self.root / "home/.agents/skills" / skill / "SKILL.md"
        p.parent.mkdir(parents=True, exist_ok=True); p.write_text("Skill instructions.")
        return p

    def test_skill_brief_requires_installed_instructions_and_keeps_task_protocol(self):
        task = {"skill": "hc-plan", "title": "Plan", "mode": "here", "prompt": "Only this scope"}
        with self.assertRaisesRegex(Fail, "not installed"):
            launch.holycow_brief(self.s, task)
        path = self.install_skill("hc-plan")
        with patch.object(launch, "instructions", return_value="Existing role protocol"), patch.object(launch, "closing_line", return_value="Existing ready protocol"):
            brief = launch.brief(self.s, task)
        for part in (str(path), "Existing role protocol", "Existing ready protocol", "Only this scope", "HolyCow skill: hc-plan"):
            self.assertIn(part, brief)
        self.assertEqual(launch.holycow_brief(self.s, {"title": "No skill"}), "")

    def test_review_uses_selected_model_read_only_without_extra_review_loop(self):
        task = {"skill": "hc-build", "set": {"review": "on"}, "mode": "here"}
        self.install_skill("hc-build"); self.install_skill("hc-review")
        rows = settings.task_settings(self.s, task)
        rv = next(x for x in rows if x["label"] == "Reviewer")
        self.assertEqual(rv["value"]["model"], "review-model")
        self.assertIn("cursor-agent --model review-model --mode ask", rv["text"])
        self.assertNotIn("--force", rv["text"])
        note = launch.holycow_brief(self.s, task)
        self.assertIn("For the existing review round only", note)
        self.assertIn("do not create a duplicate review loop", note)
        argv = settings.worker_argv(self.s, {"skill": "hc-review", "agent": "claude", "model": "chosen"})
        self.assertIn("plan", argv)

    def test_repository_skill_takes_precedence_and_missing_reviewer_fails(self):
        self.install_skill("hc-build")
        own = self.root / ".claude/skills/hc-build/SKILL.md"
        own.parent.mkdir(parents=True); own.write_text("Local skill")
        self.assertEqual(holycow.skill_file("hc-build", str(self.root), "claude"), str(own))
        with self.assertRaisesRegex(Fail, "hc-review is not installed"):
            launch.holycow_brief(self.s, {"skill": "hc-build", "set": {"review": "on"}})

    def test_assistant_knows_choices_and_changes_are_noticed(self):
        cfg = assistant_settings.resolve(assistant_settings.layers(self.cfg, "one"))
        words = holycow.assistant_words(cfg)
        self.assertIn("--skill <skill-id>", words)
        self.assertIn("hc-build: claude/space-model", words)
        before = assistant_settings.rows("one", self.cfg, (False, "every hour", ""))
        self.cfg["spaces"]["one"]["holycow"]["hc-build"]["model"] = "new-model"
        after = assistant_settings.rows("one", self.cfg, (False, "every hour", ""))
        self.assertNotEqual(assistant_settings.digest(before), assistant_settings.digest(after))
        self.assertTrue(holycow.assistant_words({}).startswith("off"))

    def test_missing_skill_does_not_mark_a_task_running_or_create_a_worktree(self):
        task = {"skill": "hc-plan", "state": "todo", "mode": "worktree"}
        with patch.object(commands, "folder_for") as folder:
            with self.assertRaisesRegex(Fail, "not installed"):
                commands.begin(self.s, task, ["cursor-agent"], "one")
            folder.assert_not_called()
        self.assertEqual(task["state"], "todo")

    def test_read_only_review_tasks_do_not_spawn_a_review_of_the_review(self):
        rows = settings.task_settings(self.s, {"skill": "hc-review", "set": {"review": "on"}})
        self.assertFalse(next(r for r in rows if r["label"] == "Review")["value"])
        self.assertFalse(any(r["label"] == "Reviewer" for r in rows))

    def test_worktree_can_read_skills_from_original_checkout(self):
        own = self.root / ".agents/skills/hc-plan/SKILL.md"
        own.parent.mkdir(parents=True); own.write_text("Project instructions")
        note = launch.holycow_brief(self.s, {"skill": "hc-plan", "worktree": str(self.root / "worktree")})
        self.assertIn(str(own), note)
