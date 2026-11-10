"""Assistant roles remain available on resume without becoming terminal messages."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader("assistant_context_test", str(ROOT / "bin" / "herdr-assistant-context"))
spec = importlib.util.spec_from_loader(loader.name, loader)
context = importlib.util.module_from_spec(spec)
loader.exec_module(context)


class AssistantContext(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.template = self.root / "assistant.md"
        self.role = "Custom role: keep <words>, apostrophes and `code`.\r\n\r\n"
        self.template.write_bytes(("---\r\nname: assistant\r\ncommand: claude\r\n---\r\n" + self.role).encode())
        self.patch = mock.patch.object(context, "CONTEXT", self.root / "herdr-core" / "assistant-context")
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_role_is_exact_private_background_context_and_request_stays_positional(self):
        argv = context.context_argv(self.template, ["claude", "--model", "opus", "Please fix <this>."])
        self.assertEqual(argv[:2], ["claude", "--append-system-prompt-file"])
        path = Path(argv[2])
        self.assertEqual(path.read_bytes().decode(), self.role)
        self.assertEqual(argv[3:], ["--model", "opus", "Please fix <this>."])
        self.assertTrue(path.is_absolute())
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(path.with_suffix(".json").stat().st_mode), 0o600)
        self.assertNotIn(self.role, argv)

    def test_custom_append_sources_survive_without_replacing_the_default_system(self):
        custom = self.root / "custom instructions.txt"
        custom.write_text("File custom instructions.")
        argv = context.context_argv(self.template, ["/opt/tools/claude", "--append-system-prompt", "Inline custom instructions.",
            f"--append-system-prompt-file={custom}", "--system-prompt", "User's explicit system choice", "--resume", "session"])
        self.assertEqual(Path(argv[2]).read_text(), self.role.replace("\r\n", "\n") + "\n\nInline custom instructions.\n\nFile custom instructions.")
        self.assertEqual(argv[3:], ["--system-prompt", "User's explicit system choice", "--resume", "session"])
        self.assertEqual(argv.count("--append-system-prompt-file"), 1)

    def test_restarting_replaces_role_but_keeps_custom_additions_and_old_resume_file(self):
        first = context.context_argv(self.template, ["claude", "--append-system-prompt=Custom addendum."])
        old = Path(first[2])
        self.template.write_text("---\ncommand: claude\n---\nUpdated role.")
        again = context.context_argv(self.template, first)
        self.assertNotEqual(again[2], first[2])
        self.assertEqual(Path(again[2]).read_text(), "Updated role.\n\nCustom addendum.")
        self.assertEqual(old.read_bytes().decode(), self.role + "\n\nCustom addendum.")
        self.assertEqual(context.context_argv(self.template, again), again)

    def test_empty_role_and_argument_separator_preserve_the_request(self):
        self.template.write_text("---\ncommand: claude\n---\n")
        argv = context.context_argv(self.template, ["claude", "--", "--append-system-prompt", "actual request"])
        self.assertEqual(Path(argv[2]).read_text(), "")
        self.assertEqual(argv[3:], ["--", "--append-system-prompt", "actual request"])

    def test_unreadable_instructions_fail_before_launching(self):
        with mock.patch.object(context.os, "execvp") as launch:
            with self.assertRaises(FileNotFoundError):
                context.main([str(self.root / "missing.md"), "--", "claude"])
            with self.assertRaises(FileNotFoundError):
                context.main([str(self.template), "--", "claude", "--append-system-prompt-file", str(self.root / "missing.txt")])
            launch.assert_not_called()

    def test_main_execs_claude_with_context_and_no_synthetic_first_message(self):
        with mock.patch.object(context.os, "execvp") as launch:
            context.main([str(self.template), "--", "claude", "--model", "sonnet"])
        program, argv = launch.call_args.args
        self.assertEqual(program, "claude")
        self.assertEqual(argv[3:], ["--model", "sonnet"])
        self.assertEqual(Path(argv[2]).read_bytes().decode(), self.role)

    def test_bad_command_or_missing_flag_value_fails_loudly(self):
        for argv in (["codex"], ["claude", "--append-system-prompt-file"]):
            with self.assertRaises(ValueError):
                context.context_argv(self.template, argv)


if __name__ == "__main__":
    unittest.main()
