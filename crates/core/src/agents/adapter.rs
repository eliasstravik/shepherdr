//! How each program is started and found again: its turn-end hook, the conversation id it is given, the standing
//! rules, where it saves a conversation and which one is its newest, a headless call for the Watcher, and marking a
//! repo as trusted in its own settings. One match per question, one arm per program (kinds.rs has the plain facts).
use super::homes::*;
use super::kinds::fill;
use super::read_turn::{find_file, head_of, when};
use crate::err::Res;
use crate::json::*;
use crate::util::{shq, uuid};
use std::fs;
use std::path::{Path, PathBuf};

/// The hook's call back into the board, at each turn end.
pub struct Hook { pub shim: String, pub id: String, pub role: String, pub token: String, pub round: i64, pub dir: PathBuf }
fn hook_command(h: &Hook) -> Vec<String> {
    let mut c = vec![h.shim.clone(), "turn-ended".into(), "--id".into(), h.id.clone(), "--role".into(), h.role.clone(), "--token".into(), h.token.clone()];
    if h.role == "reviewer" { c.extend(["--round".to_string(), h.round.to_string()]); }
    c
}
pub(crate) fn write_private(file: &Path, text: &str) -> Res<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(file)?;
    std::io::Write::write_all(&mut f, text.as_bytes())?;
    Ok(())
}
/// Launch arguments that make the program call `turn-ended` at every turn end. None: no hook for it here.
pub fn hook_args(kind: &str, h: &Hook) -> Res<Option<Vec<String>>> {
    match kind {
        // A settings file of the task's own, added to the user's settings for this one launch (the user's own hooks
        // still run). The hooks are asynchronous, so a slow or failing one never holds the agent's turn. Idle
        // compaction is off: Claude Code would otherwise shrink a finished task's session left waiting an hour, which
        // herdr sees as a turn.
        "claude" => {
            let command = hook_command(h).iter().map(|s| shq(s)).collect::<Vec<_>>().join(" ");
            let file = h.dir.join(format!("hook-{}.json", h.role));
            let one = json!([{ "hooks": [{ "type": "command", "command": command, "async": true }] }]);
            write_private(&file, &json!({ "hooks": { "Stop": one, "StopFailure": one }, "idleCompaction": false }).to_string())?;
            Ok(Some(vec!["--settings".into(), file.display().to_string()]))
        }
        // Codex runs one `notify` program at each turn end. Given at launch it would replace one the user configured,
        // so a user who has one gets no hook (the hook-less route covers them).
        "codex" => {
            if let Ok(t) = fs::read_to_string(codex_file()) {
                let head = t.split("\n[").next().unwrap_or("");
                if head.lines().any(|l| l.trim_start().starts_with("notify") && l.trim_start()["notify".len()..].trim_start().starts_with('=')) { return Ok(None); }
            }
            Ok(Some(vec!["-c".into(), format!("notify={}", serde_json::to_string(&hook_command(h))?)]))
        }
        // A one-file extension of the task's own: pi's settled event runs the same command, with the session file on stdin.
        "pi" => {
            let file = h.dir.join(format!("hook-{}.ts", h.role));
            let cmd = serde_json::to_string(&hook_command(h))?;
            write_private(&file, &format!(r#"import {{ spawn }} from "node:child_process";
const cmd = {cmd};
export default function (pi: any) {{
  pi.on("agent_settled", (_e: any, ctx: any) => {{
    try {{
      let file = ""; try {{ file = ctx?.sessionManager?.getSessionFile?.() || ""; }} catch {{}}
      const c = spawn(cmd[0], cmd.slice(1), {{ stdio: ["pipe", "ignore", "ignore"], detached: true }});
      c.on("error", () => {{}}); c.stdin.on("error", () => {{}});
      c.stdin.end(JSON.stringify({{ transcript_path: file }})); c.unref();
    }} catch {{}}
  }});
}}
"#))?;
            Ok(Some(vec!["-e".into(), file.display().to_string()]))
        }
        _ => Ok(None),
    }
}
pub fn has_hook(kind: &str) -> bool { matches!(kind, "claude" | "codex" | "pi") }
/// A conversation id of the board's own choosing, where the program takes one (kinds.rs `session`).
pub fn new_session(kind: &str) -> Option<String> {
    match kind { "pi" => Some(format!("sw-{}", &uuid()[..13])), k => super::kinds::kind(k).filter(|a| !a.session.is_empty()).map(|_| uuid()) }
}
/// The arguments that start a new conversation: the id the board chose for it, and the program's own "a new one".
pub fn session_args(kind: &str, id: &str) -> Vec<String> { super::kinds::kind(kind).map(|a| if id.is_empty() { vec![] } else { fill(a.session, id) }).unwrap_or_default() }
pub fn fresh_args(kind: &str) -> Vec<String> { super::kinds::kind(kind).map(|a| fill(a.fresh, "")).unwrap_or_default() }
/// Launch arguments that keep the rules in force for the whole session. herdr refuses launch arguments that hold line
/// breaks, so a program reads them from a file (kinds.rs `standing`); Codex takes them as a setting, and is pointed at
/// a file when they are long.
pub fn standing(kind: &str, text: &str, dir: &Path) -> Res<Vec<String>> {
    // Inline when short; else a file it is told to read: a long start command is cut off by the terminal (hand_limits.rs).
    if kind == "codex" {
        let inline = serde_json::to_string(text)?;
        if inline.len() <= super::hand_limits::ARG_MAX { return Ok(vec!["-c".into(), format!("developer_instructions={inline}")]); }
        let f = dir.join("rules.md"); write_rules(&f, text)?;
        return Ok(vec!["-c".into(), format!("developer_instructions={}", serde_json::to_string(&super::hand_limits::rules_pointer(&f))?)]);
    }
    let Some(a) = super::kinds::kind(kind).filter(|a| !a.standing.is_empty()) else { return Ok(vec![]) };
    let f = dir.join("rules.md");
    write_rules(&f, text)?;
    Ok(fill(a.standing, &f.display().to_string()))
}
fn write_rules(file: &Path, text: &str) -> Res<()> {
    match fs::read(file) {
        Ok(before) if before == text.as_bytes() => Ok(()),
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => { fs::write(file, text)?; Ok(()) }
    }
}
pub fn has_standing(kind: &str) -> bool { kind == "codex" || super::kinds::kind(kind).map(|a| !a.standing.is_empty()).unwrap_or(false) }
fn real(p: &Path) -> PathBuf { fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()) }
fn dashed(p: &Path) -> String { p.display().to_string().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect() }
/// Where a conversation is saved.
pub fn transcript(kind: &str, session: &str, cwd: &Path) -> Option<PathBuf> {
    match kind {
        "claude" => {
            let direct = claude_home().join("projects").join(dashed(&real(cwd))).join(format!("{session}.jsonl"));
            if direct.exists() { return Some(direct); }
            let want = format!("{session}.jsonl");
            find_file(&claude_home().join("projects"), &|n| n == want, 1).into_iter().next()
        }
        "codex" => { let want = format!("{session}.jsonl"); find_file(&codex_home().join("sessions"), &|n| n.ends_with(&want), 4).into_iter().next() }
        // Also where it was saved before its folder moved (the Coordinator's, under the board's old home).
        "pi" => { let (want, was) = (format!("_{session}.jsonl"), crate::store::move_home::moved_from(cwd)); pi_files(&[Some(cwd), was.as_deref()].into_iter().flatten().collect::<Vec<_>>(), &|n| n.ends_with(&want)).into_iter().next() }
        _ => None,
    }
}
/// pi keeps each working folder's conversations in a folder of their own, named after its path (`--home-me-app--`).
fn pi_folder(cwd: &Path) -> PathBuf { let p = cwd.display().to_string(); pi_home().join("sessions").join(format!("--{}--", p.strip_prefix(['/', '\\']).unwrap_or(&p).replace(['/', '\\', ':'], "-"))) }
/// pi's conversations of these working folders (as given, and their real paths), newest first: only those folders are
/// read, never every folder of a long history (#393).
fn pi_files(cwds: &[&Path], test: &dyn Fn(&str) -> bool) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = vec![];
    for d in cwds.iter().flat_map(|c| [real(c), c.to_path_buf()]).map(|c| pi_folder(&c)) { if !dirs.contains(&d) { dirs.push(d); } }
    let mut hits: Vec<PathBuf> = dirs.iter().flat_map(|d| find_file(d, test, 0)).collect();
    hits.sort_by_key(|f| std::cmp::Reverse(mtime_ms(f)));
    hits
}
fn mtime_ms(f: &Path) -> Option<i64> { fs::metadata(f).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64) }
fn first_line(s: &str) -> &str { s.split('\n').next().unwrap_or("") }
/// The newest conversation saved in a folder since a time: the program's own "new chat" command starts another one.
/// `was`: the path this folder had before it was moved; a program started back then still saves under that one.
pub fn latest_session(kind: &str, cwd: &Path, since: i64, was: Option<&Path>) -> Option<String> {
    let real = real(cwd);
    match kind {
        "claude" => {
            // Only a chat of the interactive program itself: not a helper's side conversation and not a headless run.
            let own = |f: &Path| { let head = head_of(f, 65536); let entry = head.find("\"entrypoint\":\"").map(|i| head[i + 14..].split('"').next().unwrap_or("").to_string()); entry.map(|e| e == "cli").unwrap_or(true) && !first_line(&head).contains("\"isSidechain\":true") };
            let is_id = |n: &str| n.len() == 42 && n.ends_with(".jsonl") && n[..36].chars().all(|c| c.is_ascii_hexdigit() || c == '-') && n.as_bytes()[8] == b'-';
            for dir in [Some(real.as_path()), was].into_iter().flatten() {
                for f in find_file(&claude_home().join("projects").join(dashed(dir)), &is_id, 0) {
                    if mtime_ms(&f).map(|m| m < since).unwrap_or(true) { break; }
                    if own(&f) { return f.file_stem().map(|s| s.to_string_lossy().into_owned()); }
                }
            }
            None
        }
        "codex" => {
            for f in find_file(&codex_home().join("sessions"), &|n| n.ends_with(".jsonl"), 4) {
                if mtime_ms(&f).map(|m| m < since).unwrap_or(true) { return None; }
                let head = head_of(&f, 400000);
                let Ok(meta) = serde_json::from_str::<Value>(first_line(&head)) else { continue };
                let p = meta.at("payload");
                let cwd_ok = p.s("cwd") == real.display().to_string() || was.map(|w| p.s("cwd") == w.display().to_string()).unwrap_or(false);
                let source_ok = p.at("source").is_null() || (p.at("source").is_string() && p.s("source") != "exec");
                if cwd_ok && p.b("id") && !p.b("parent_thread_id") && source_ok { return Some(p.t("id")); }
            }
            None
        }
        "pi" => {
            for f in pi_files(&[Some(cwd), was].into_iter().flatten().collect::<Vec<_>>(), &|n| n.ends_with(".jsonl")) {
                if mtime_ms(&f).map(|m| m < since).unwrap_or(true) { return None; }
                let head = head_of(&f, 8192);
                let Ok(meta) = serde_json::from_str::<Value>(first_line(&head)) else { continue };
                let cwd_ok = meta.s("cwd") == real.display().to_string() || meta.s("cwd") == cwd.display().to_string() || was.map(|w| meta.s("cwd") == w.display().to_string()).unwrap_or(false);
                if meta.s("type") == "session" && meta.b("id") && !meta.b("parentSession") && cwd_ok { return Some(meta.t("id")); }
            }
            None
        }
        _ => None,
    }
}
/// Codex names its own conversations: without a hook, the one for this task is the file made after launch, in this
/// folder, whose prompts name this task and role. More than one: the one begun since launch (a review started again
/// has the same words as the one before it). No match, or still more than one: none.
pub fn find_session(kind: &str, cwd: &Path, since: i64, needle: &str) -> Option<String> { find_session_but(kind, cwd, since, needle, "") }
/// The same, leaving out a conversation already known to be another's (`but`: the one a review started again had).
pub fn find_session_but(kind: &str, cwd: &Path, since: i64, needle: &str, but: &str) -> Option<String> {
    if kind != "codex" { return None; }
    let real = real(cwd).display().to_string();
    let hits: Vec<(i64, String)> = find_file(&codex_home().join("sessions"), &|n| n.ends_with(".jsonl"), 4).into_iter()
        .filter(|f| mtime_ms(f).map(|m| m >= since - 60000).unwrap_or(false))
        .filter(|f| !super::helpers::codex_helper_file(f)) // a helper's conversation carries the agent's first prompt along
        .filter_map(|f| { let head = head_of(&f, 400000); let m = serde_json::from_str::<Value>(first_line(&head)).ok()?; let at = when(m.at("timestamp")); (m.at("payload").s("cwd") == real && at >= since - 5000 && head.contains(needle) && (but.is_empty() || m.at("payload").s("id") != but)).then(|| (at, m.at("payload").t("id"))) })
        .collect();
    let since_launch: Vec<&(i64, String)> = hits.iter().filter(|h| h.0 >= since).collect();
    match (hits.len(), since_launch.len()) { (1, _) => Some(hits[0].1.clone()), (_, 1) => Some(since_launch[0].1.clone()), _ => None }
}
pub fn can_find_session(kind: &str) -> bool { kind == "codex" }
pub fn resume_args(kind: &str, id: &str) -> Vec<String> { super::kinds::kind(kind).map(|a| fill(a.resume, id)).unwrap_or_default() }
/// pi takes a provider apart from its model (`pi/anthropic/claude-opus-5-5`).
pub fn model_args(kind: &str, m: &str) -> Vec<String> {
    match kind {
        "pi" => match m.split_once('/') { Some((p, mm)) => vec!["--provider".into(), p.into(), "--model".into(), mm.into()], None => vec!["--model".into(), m.into()] },
        k => super::kinds::kind(k).map(|a| fill(a.model, m)).unwrap_or_default(),
    }
}
pub fn effort_args(kind: &str, e: &str) -> Vec<String> { super::kinds::kind(kind).map(|a| fill(a.effort, e)).unwrap_or_default() }
/// Codex's Fast mode (every request carries `service_tier: "priority"`); off names the default tier, last on the line.
pub fn fast_args(kind: &str, on: bool) -> Vec<String> {
    match (kind, on) { ("codex", true) => vec!["-c".into(), "service_tier=\"fast\"".into()], ("codex", false) => vec!["-c".into(), "service_tier=\"default\"".into()], _ => vec![] }
}
/// A headless command for the Watcher: the program, its arguments, and what goes in on its stdin.
pub struct OneShot { pub command: String, pub args: Vec<String>, pub stdin: Option<String> }
pub fn one_shot(kind: &str, model: &str, effort: &str, prompt: &str, system: &str, lean: bool) -> Option<OneShot> {
    match kind {
        // The prompt goes in on stdin: --tools takes a list and would swallow a trailing prompt. `lean` starts it with
        // nothing of yours loaded and the helper's few words in place of Claude Code's own long instructions.
        "claude" => {
            let mut a: Vec<String> = vec!["-p".into()];
            if !model.is_empty() { a.extend(["--model".into(), model.into()]); }
            if !effort.is_empty() { a.extend(["--effort".into(), effort.into()]); }
            if lean { a.extend(["--safe-mode", "--strict-mcp-config", "--disable-slash-commands"].map(String::from)); }
            if !system.is_empty() { a.extend([if lean { "--system-prompt" } else { "--append-system-prompt" }.to_string(), system.into()]); }
            a.extend(["--no-session-persistence", "--tools", ""].map(String::from));
            Some(OneShot { command: "claude".into(), args: a, stdin: Some(prompt.into()) })
        }
        "codex" => {
            let mut a: Vec<String> = ["exec", "--skip-git-repo-check", "--ephemeral", "--color", "never"].map(String::from).to_vec();
            if !model.is_empty() { a.extend(["-m".into(), model.into()]); }
            a.push(prompt.into());
            Some(OneShot { command: "codex".into(), args: a, stdin: None })
        }
        "pi" => {
            let mut a: Vec<String> = ["-p", "--no-session", "--no-tools", "--no-skills", "--no-context-files"].map(String::from).to_vec();
            if !model.is_empty() { a.extend(model_args("pi", model)); }
            if !system.is_empty() { a.extend(["--append-system-prompt".into(), system.into()]); }
            a.extend(["--".into(), prompt.into()]);
            Some(OneShot { command: "pi".into(), args: a, stdin: None })
        }
        // herdr's others: their one-shot, from the table (kinds.rs `headless`); the instructions go above the prompt
        // where the program has no flag for them.
        k => {
            let a = super::kinds::kind(k)?;
            let h = a.headless.as_ref()?;
            let mut args = fill(h.args, "");
            if !model.is_empty() { args.extend(fill(h.model, model)); }
            let prompt = if !system.is_empty() && h.system.is_empty() { format!("{system}\n\n{prompt}") } else { prompt.to_string() };
            if !system.is_empty() { args.extend(fill(h.system, system)); }
            if h.prompt.is_empty() { return Some(OneShot { command: super::kinds::program(k).into(), args, stdin: Some(prompt) }); }
            args.extend(fill(h.prompt, &prompt));
            Some(OneShot { command: super::kinds::program(k).into(), args, stdin: None })
        }
    }
}
/// Can it be the Watcher: does it have a headless one-shot?
pub fn can_one_shot(kind: &str) -> bool { one_shot(kind, "", "", "", "", false).is_some() }
/// The program's own user-level skills folder, where it is installed.
pub fn skill_dir(kind: &str) -> Option<PathBuf> {
    let home = match kind { "claude" => claude_home(), "codex" => codex_home(), "pi" => pi_home(), _ => return None };
    home.exists().then(|| home.join("skills"))
}
/// Mark a repo as trusted in the program's own settings, so a new worktree starts without its "trust this folder?"
/// dialog. Claude keeps trust per repository root in ~/.claude.json; Codex in ~/.codex/config.toml (a command-line
/// override does not count, so the table is added to the file once: codex_trust.rs); pi in ~/.pi/agent/trust.json, per
/// folder and the folders above it, so it is given the folder it starts in (pi_trust.rs).
pub fn trust(kind: &str, root: &Path) -> bool {
    let root_s = root.display().to_string();
    match kind {
        "claude" => {
            let file = claude_file();
            let mut j: Obj = match fs::read_to_string(&file) { Ok(t) => match serde_json::from_str::<Value>(&t) { Ok(Value::Object(o)) => o, _ => return false }, Err(e) if e.kind() == std::io::ErrorKind::NotFound => Obj::new(), Err(_) => return false };
            if j.at("projects").at(&root_s).b("hasTrustDialogAccepted") { return true; }
            j.obj_mut("projects").obj_mut(&root_s).put("hasTrustDialogAccepted", true);
            let tmp = PathBuf::from(format!("{}.{}.sw.tmp", file.display(), std::process::id()));
            write_private(&tmp, &serde_json::to_string_pretty(&j).unwrap_or_default()).is_ok() && fs::rename(&tmp, &file).is_ok()
        }
        "codex" => super::codex_trust::trust(root),
        "pi" => super::pi_trust::trust(root),
        _ => false,
    }
}
pub fn can_trust(kind: &str) -> bool { matches!(kind, "claude" | "codex" | "pi") }
