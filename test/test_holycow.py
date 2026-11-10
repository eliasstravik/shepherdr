"""Skill routing must launch the chosen CLI, preserve task rules and fail on missing skills."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import contextlib
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mods/tasks/bin"))
from herdr_task import settings, holycow, launch, assistant_settings, commands, automations
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

    def test_shared_permission_presets_reach_the_task_cli(self):
        for agent, modes in {"claude": ("manual", "auto", "bypassPermissions"),
                             "codex": ("ask", "approve", "full"), "cursor": ("ask", "auto", "full")}.items():
            for perm in modes:
                with self.subTest(agent=agent, perm=perm):
                    self.cfg["everywhere"]["holycow"]["hc-pr"] = {"agent": agent, "model": "chosen", "perm": perm}
                    self.file.write_text(json.dumps(self.cfg))
                    pick = settings.worker_pick(self.s, {"skill": "hc-pr"})
                    self.assertEqual(pick["perm"], perm)
                    args = settings.argv_for(pick)
                    if agent == "codex" and perm in ("ask", "approve"):
                        self.assertIn('approvals_reviewer="%s"' % ("user" if perm == "ask" else "auto_review"), args)
                        self.assertIn("workspace-write", args)
                        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", args)
                    if agent == "cursor" and perm == "ask":
                        self.assertNotIn("--auto-review", args)
                        self.assertNotIn("--force", args)
                    if agent == "cursor" and perm == "auto":
                        self.assertIn("--auto-review", args)
                    if agent == "claude" and perm != "bypassPermissions":
                        self.assertIn("default" if perm == "manual" else "auto", args)

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

    def test_unset_skills_follow_roles_and_only_nonsoftware_tasks_keep_workers(self):
        self.assertEqual(settings.worker_pick(self.s, {"skill": "holycow-guide"}), {"agent": "cursor", "model": "auto"})
        self.assertEqual(settings.worker_pick(self.s, {"skill": "hc-retro"}), settings.worker_pick(self.s, {"kind": "non-software"}))

    def test_saved_skill_permissions_reach_each_cli_without_changing_worker_defaults(self):
        for agent, perm, flags in (("claude", "acceptEdits", ["--permission-mode", "acceptEdits"]),
                                   ("codex", "auto", ["-s", "workspace-write", "-a", "on-request"]),
                                   ("cursor", "full", ["--force"])):
            with self.subTest(agent=agent):
                pick = {"agent": agent, "model": "skill-model", "perm": perm}
                self.cfg["everywhere"]["holycow"]["hc-pr"] = pick
                self.file.write_text(json.dumps(self.cfg))
                self.assertEqual(settings.worker_pick(self.s, {"skill": "hc-pr"}), pick)
                argv = settings.worker_argv(self.s, {"skill": "hc-pr"})
                self.assertEqual(settings.argv_model(argv)[0], "skill-model")
                self.assertEqual(argv[-len(flags):], flags)
                self.assertEqual(settings.worker_pick(self.s, {"kind": "non-software"}), self.cfg["everywhere"]["worker"])

    def test_pr_skill_reset_follows_worker_permissions_not_the_assistant(self):
        role = self.cfg["everywhere"]["worker"]
        role["perm"] = "manual"
        self.cfg["everywhere"]["coordinator"] = {"agent": "claude", "model": "assistant-model", "perm": "bypassPermissions"}
        self.file.write_text(json.dumps(self.cfg))
        self.assertEqual(settings.worker_pick(self.s, {"skill": "hc-pr"}), role)
        own = {"agent": "claude", "model": "pr-model", "effort": "medium", "fast": True, "perm": "auto"}
        self.cfg["everywhere"]["holycow"]["hc-pr"] = own
        self.file.write_text(json.dumps(self.cfg))
        self.assertEqual(settings.worker_pick(self.s, {"skill": "hc-pr"}), own)
        self.assertEqual(settings.worker_pick(self.s, {"skill": "hc-retro"}), role)
        del self.cfg["everywhere"]["holycow"]["hc-pr"]
        self.file.write_text(json.dumps(self.cfg))
        self.assertEqual(settings.worker_pick(self.s, {"skill": "hc-pr"}), role)
        self.assertNotIn("--dangerously-skip-permissions", settings.worker_argv(self.s, {"skill": "hc-pr"}))

    def test_review_permission_stays_read_only_for_every_configured_cli(self):
        for agent, full, restricted in (("claude", "bypassPermissions", "plan"), ("codex", "full", "read-only"), ("cursor", "full", "read-only")):
            with self.subTest(agent=agent):
                self.cfg["everywhere"]["holycow"]["hc-review"] = {"agent": agent, "model": "review-model", "perm": full}
                self.file.write_text(json.dumps(self.cfg))
                self.assertEqual(settings.worker_pick(self.s, {"skill": "hc-review"})["perm"], restricted)
                argv = settings.worker_argv(self.s, {"skill": "hc-review"})
                self.assertIn("ask" if agent == "cursor" else restricted, argv)
                self.assertFalse(set(argv) & {"--force", "--dangerously-skip-permissions", "--dangerously-bypass-approvals-and-sandbox"})

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
        self.assertEqual(launch.holycow_brief(self.s, {"title": "Agenda", "kind": "non-software"}), "")

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
        self.assertTrue(holycow.assistant_words({}).startswith("required"))
        self.assertIn("required", holycow.assistant_words({"holycow": {"enabled": False}}))

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

    def test_missing_assignment_never_resolves_normal_worker_defaults(self):
        for task in ({}, {"kind": "software"}, {"agent": "cursor", "model": "auto"}):
            with self.subTest(task=task), patch.object(settings, "settings_for") as cfg:
                with self.assertRaisesRegex(Fail, "require a HolyCow skill"):
                    settings.worker_argv(self.s, task)
                cfg.assert_not_called()

    def test_unassigned_drafts_are_readable_without_a_fallback_agent(self):
        rows = settings.task_settings(self.s, {"state": "todo"})
        self.assertIsNone(next(r for r in rows if r["label"] == "Agent")["value"])
        self.assertIn("require a HolyCow skill", next(r for r in rows if r["label"] == "HolyCow skill")["text"])

    def test_assignment_validation_rejects_invalid_exemptions(self):
        for task in ({"kind": "unknown"}, {"skill": "unknown"}, {"kind": "non-software", "skill": "hc-build"}):
            with self.subTest(task=task), self.assertRaises(Fail):
                holycow.require_assignment(task)
        holycow.require_assignment({"kind": "non-software"})
        task = {}
        settings.set_opts(task, SimpleNamespace(kind="non-software"))
        self.assertEqual(task["kind"], "non-software")
        settings.set_task(task, "kind", "default")
        with self.assertRaises(Fail):
            holycow.require_assignment(task)

    def test_cached_commands_cannot_bypass_launch_or_resume_guards(self):
        for state in ("todo", "queued", "scheduled", "running", "done"):
            task = {"state": state, "agents": [{"agent": "cursor", "argv": ["cursor-agent"], "session": "old", "at": 1}]}
            with self.subTest(state=state), patch.object(launch, "run") as run, patch.object(commands, "parent_for") as parent:
                with self.assertRaisesRegex(Fail, "require a HolyCow skill"):
                    launch.launch(self.s, task, ["cursor-agent"], "one", resume=["cursor-agent", "--resume", "old"])
                with self.assertRaisesRegex(Fail, "require a HolyCow skill"):
                    commands.start_again(self.s, task, "one", argv_json='["cursor-agent"]')
                run.assert_not_called(); parent.assert_not_called()
                self.assertEqual(task["state"], state)

    def test_start_refuses_unassigned_tasks_before_scheduling_or_queueing(self):
        task = {"id": 1, "state": "todo"}
        self.s.find = lambda _: task
        self.s.key = lambda _: "test#1"
        with patch.object(commands, "open_store", return_value=contextlib.nullcontext(self.s)), \
             patch.object(commands, "live_agents", return_value=[]), patch.object(commands, "schedule") as schedule:
            with self.assertRaisesRegex(Fail, "require a HolyCow skill"):
                commands.cmd_start(SimpleNamespace(id=1, at="tomorrow", argv='["cursor-agent"]'))
            schedule.assert_not_called()
        self.assertEqual(task["state"], "todo")

    def test_automation_passes_assignment_to_each_run_and_blocks_legacy_unassigned_runs(self):
        self.s.new = lambda *args: {"state": "todo"}
        a = {"id": 1, "title": "Build", "space": "one", "skill": "hc-build"}
        with patch.object(automations, "worktrees_on", return_value=False), \
             patch.object(automations, "queue_reason", return_value=None), patch.object(automations, "begin") as begin:
            t = automations.fire(self.s, a, "run now")
            self.assertEqual(t["skill"], "hc-build")
            self.assertEqual(begin.call_args.args[2][:3], ["claude", "--model", "space-model"])
            begin.reset_mock()
            del a["skill"]
            t = automations.fire(self.s, a, "run now")
            self.assertIn("require a HolyCow skill", t["attention"])
            begin.assert_not_called()
            a["kind"] = "non-software"
            t = automations.fire(self.s, a, "run now")
            self.assertEqual(t["kind"], "non-software")
            begin.assert_called_once()

    def test_resumed_sessions_receive_current_skill_instructions(self):
        skill = self.install_skill("hc-plan")
        self.s.key = lambda _: "test#1"
        task = {"skill": "hc-plan", "agents": []}
        with contextlib.ExitStack() as stack:
            for name, fn in {"own_argv": lambda x, folder=None: x, "coordinator_tab": lambda _: None,
                             "agent_name": lambda *a: "test", "folder_for": lambda *a: str(self.root),
                             "low_priority": lambda x, _: x, "in_shell": lambda x: x, "track": lambda *a: None}.items():
                stack.enter_context(patch.object(launch, name, fn))
            run = stack.enter_context(patch.object(launch, "run", return_value=SimpleNamespace(returncode=0, stdout='{"address":"t1"}')))
            launch.launch(self.s, task, ["cursor-agent"], "one", message="Continue the agreed work", resume=["cursor-agent", "--resume", "old"])
        prompt = run.call_args.args[0][-1]
        self.assertIn(str(skill), prompt)
        self.assertIn("Continue the agreed work", prompt)
