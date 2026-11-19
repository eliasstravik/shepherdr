//! herdr's other programs (issue #138, HP-13): how each is started from the table (its model, effort, access, a new
//! or a reopened conversation, its own executable), its one-shot for the Watcher, other names a setting may give it,
//! and every role a program cannot do refused with the reason.
mod rules;
use crate::common;
use common::*;
use serde_json::json;
use sw::json::*;
use sw::agents::adapter::{one_shot, OneShot};
use sw::agents::kinds::{all, kind, program};
use sw::agents::start::{start_args, StartOpts};
use sw::store::settings::change::set_value;
use sw::store::settings::lookup::Scope;

/// The skills and commands a program takes in its chat, read where it keeps them.
mod skills;
/// The skills of the other programs the herdr web UI lists them for.
mod skills_more;
/// Trusting a repo in Codex's config.toml, read as TOML (#314).
mod codex_trust;
/// pi's saved conversations, looked for only where pi keeps the agent's folder's (#393).
mod pi_sessions;
/// Trusting the folder pi starts in, in its trust.json (#413).
mod pi_trust;
/// OpenCode 2 started on its model through a conversation made first (#394).
mod opencode_v2;

fn args(k: &str, o: StartOpts) -> Vec<String> { start_args(k, &o).unwrap() }
fn opts(model: &str, effort: &str) -> StartOpts { StartOpts { model: model.into(), effort: effort.into(), ..Default::default() } }
fn has(text: &str, re: &str) -> bool { regex::Regex::new(re).unwrap().is_match(text) }
fn refused(name: &str, value: &str, re: &str) { let e = set_value(name, &json!(value), &Scope::you()).unwrap_err(); assert!(has(&e.msg, re), "{name} {value}: {re}: {}", e.msg); }
fn taken(name: &str, value: &str) -> String { set_value(name, &json!(value), &Scope::you()).unwrap_or_else(|e| panic!("{name} {value}: {}", e.msg)); sw::store::settings::lookup::setting_text(name, None) }

#[test]
fn every_program_herdr_has_an_integration_for_is_in_the_table_and_starts_on_its_own_flags() {
    let _w = world();
    for k in ["claude", "codex", "pi", "agy", "copilot", "cursor", "devin", "droid", "grok", "hermes", "kilo", "kimi", "letta", "mastracode", "omp", "opencode", "qodercli", "qwen"] { assert!(kind(k).is_some(), "{k}"); }
    assert_eq!(all().count(), 18);
    assert!(all().all(|k| !k.checked.is_empty()), "every program says what was tried on which version");
    // Model, effort and full access, each in the program's own words.
    assert_eq!(args("agy", opts("gemini-3-pro", "high")), ["--dangerously-skip-permissions", "--model", "gemini-3-pro", "--effort", "high"]);
    assert_eq!(args("copilot", opts("gpt-5.5", "xhigh")), ["--yolo", "--model", "gpt-5.5", "--reasoning-effort", "xhigh"]);
    assert_eq!(args("omp", opts("anthropic/claude-opus-5-5", "low")), ["--auto-approve", "--model=anthropic/claude-opus-5-5", "--thinking=low"]);
    assert_eq!(args("devin", opts("opus", "")), ["--permission-mode", "dangerous", "--model", "opus"]);
    assert_eq!(args("droid", opts("", "")), ["--auto", "high"]);
    // An effort the program does not take is never passed on (the setting refuses it: below).
    assert_eq!(args("kimi", opts("", "high")), ["--auto"]);
    assert_eq!(args("agy", opts("", "minimal")), ["--dangerously-skip-permissions"]);
    // Asking first: the program's own default, or its flag for it.
    assert_eq!(args("qwen", StartOpts { access: "ask".into(), ..Default::default() }), Vec::<String>::new());
    assert_eq!(args("omp", StartOpts { access: "ask".into(), ..Default::default() }), ["--approval-mode=write"]);
    // `hermes chat` first; Letta starts a new conversation, unless it reopens one.
    assert_eq!(args("hermes", opts("x", ""))[0], "chat");
    assert_eq!(args("letta", opts("", "")), ["--new", "--yolo"]);
    assert_eq!(args("letta", StartOpts { resume: "conv-1".into(), ..Default::default() }), ["--conversation", "conv-1", "--yolo"]);
    // A conversation the board names itself, and one reopened by the id herdr's integration gave.
    assert_eq!(sw::agents::adapter::new_session("copilot").map(|s| s.len()), Some(36));
    assert_eq!(sw::agents::adapter::new_session("agy"), None);
    assert_eq!(args("copilot", StartOpts { session: "u-1".into(), ..Default::default() }), ["--session-id", "u-1", "--yolo"]);
    assert_eq!(args("copilot", StartOpts { resume: "u-1".into(), ..Default::default() }), ["--resume=u-1", "--yolo"]);
    assert_eq!(args("kimi", StartOpts { resume: "s-1".into(), ..Default::default() }), ["--session", "s-1", "--auto"]);
    // The standing rules as a file where the program takes one; else they ride in the first prompt.
    let dir = std::env::temp_dir();
    assert_eq!(sw::agents::adapter::standing("droid", "rules", &dir).unwrap()[0], "--append-system-prompt-file");
    assert!(sw::agents::adapter::standing("agy", "rules", &dir).unwrap().is_empty());
    // herdr's kind, but its own executable.
    assert_eq!(program("cursor"), "cursor-agent");
    assert_eq!(program("agy"), "agy");
}

#[test]
fn the_watcher_one_shot_of_each_program_comes_from_the_table() {
    let _w = world();
    let shot = |k: &str, model: &str, system: &str| -> OneShot { one_shot(k, model, "", "How far along?", system, false).unwrap_or_else(|| panic!("{k}")) };
    let a = shot("agy", "gemini-3-flash", "Answer in one line.");
    assert_eq!((a.command.as_str(), a.args.clone(), a.stdin), ("agy", vec!["--disable-slash-commands", "--model", "gemini-3-flash", "-p", "Answer in one line.\n\nHow far along?"].into_iter().map(String::from).collect(), None));
    // Instructions by the program's own flag where it has one, else above the prompt.
    let d = shot("droid", "", "Answer in one line.");
    assert_eq!(d.args, ["exec", "--append-system-prompt", "Answer in one line.", "How far along?"]);
    let c = shot("cursor", "", "");
    assert_eq!(c.command, "cursor-agent");
    assert_eq!(c.args.last().unwrap(), "How far along?");
    for k in all() { assert!(one_shot(k.name, "", "", "p", "", false).is_some(), "{} has a one-shot", k.name); }
}

#[test]
fn a_program_that_cannot_do_a_role_or_take_what_it_is_given_is_refused_with_the_reason() {
    let _w = world();
    // mastracode cannot be told its model or to work without asking at start: never on a task, but the Watcher.
    refused("worker.agent", "mastracode", r"^worker\.agent: mastracode cannot work on a task: .*environment variables.* These can: claude, codex, pi, agy");
    refused("reviewer.fallback", "codex, mastracode", r"^reviewer\.fallback: mastracode cannot review");
    refused("attempts.by", "claude, mastracode", r"^attempts\.by: mastracode cannot work on a task");
    refused("plan.agent", "mastracode", r"mastracode cannot write a plan");
    refused("coordinator.agent", "mastracode", r"mastracode cannot be the Coordinator");
    assert_eq!(taken("watcher.agent", "mastracode/anthropic/claude-haiku-5-5"), "mastracode/anthropic/claude-haiku-5-5");
    // A model where the program takes none at start.
    refused("worker.agent", "droid/gpt-6-sol", r"droid takes no model when the board starts it: leave the model out");
    assert_eq!(taken("worker.agent", "droid"), "droid");
    assert_eq!(taken("watcher.agent", "droid/gpt-6-sol"), "droid/gpt-6-sol"); // its one-shot does
    // An effort: none at all, a level it does not have, or one it takes in its model's name.
    assert_eq!(taken("worker.agent", "devin"), "devin");
    refused("worker.effort", "high", r"devin takes no effort level when the board starts it: leave it at default");
    assert_eq!(taken("worker.agent", "agy/gemini-3-pro"), "agy/gemini-3-pro");
    refused("worker.effort", "minimal", r#"agy has no effort "minimal": it takes low, medium, high, xhigh, max"#);
    assert_eq!(taken("worker.effort", "high"), "high");
    assert_eq!(taken("worker.agent", "cursor/claude-opus-4-8[effort=high]"), "cursor/claude-opus-4-8[effort=high]");
    refused("worker.effort", "high", r"cursor takes its effort in the model's name: cursor/claude-opus-4-8\[effort=high\]");
    // herdr's integration name, and the executable's, name the program too.
    assert_eq!(taken("reviewer.agent", "antigravity-cli/gemini-3-pro"), "agy/gemini-3-pro");
    assert_eq!(taken("reviewer.fallback", "cursor-agent, Qwen"), r#"["cursor","qwen"]"#);
    refused("worker.agent", "gemni", r#"no agent program "gemni"\. It must be claude, codex, pi, agy, .*, qwen\."#);
}

#[test]
fn a_program_herdr_sees_only_through_its_integration_is_not_started_without_it() {
    let w = world_with(Opts { repo: true, settings: json!({ "worker.agent": "omp" }), ..Default::default() });
    w.patch(|s| s["integrations"] = json!("pi: installed (~/.pi/agent/extensions/herdr-agent-state.ts)\nomp: not installed (~/.omp/agent/extensions/herdr-omp-agent-state.ts)\n"));
    let id = w.add("On omp");
    delegate(&id);
    let t = settle(&id);
    assert!(has(&format!("{} {}", t.s("msg"), t.at("failure")), r"omp needs herdr's own integration.*herdr integration install omp"), "{} {}", t.s("msg"), t.at("failure"));
    assert!(!calls(&w).iter().any(|c| c.starts_with("agent start") && c.contains("--kind omp")), "never started");
    // With it, it is.
    w.patch(|s| s["integrations"] = json!("omp: installed (~/.omp/agent/extensions/herdr-omp-agent-state.ts)\n"));
    let id = w.add("On omp again");
    delegate(&id);
    settle(&id);
    assert!(calls(&w).iter().any(|c| c.starts_with("agent start") && c.contains("--kind omp")), "{:?}", calls(&w));
}
