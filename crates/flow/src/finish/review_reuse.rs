//! Reuse a passing review only when its source, task, policy and local evidence inputs are unchanged.
use crate::gate;
use crate::json::*;
use crate::store::repos::cwd_of;
use crate::store::tasks::Task;
use std::collections::BTreeMap;
use std::path::Path;

/// Unknown evidence, remote references or an uncommitted source tree require a fresh review.
pub fn input_identity(t: &Task, change: &Value, text: &str, ch: &Obj, check: &str) -> Option<String> {
    let head = change.s("head");
    if head.is_empty() || crate::flow::git::head_of(&cwd_of(t)) != head || !crate::flow::git::dirty(&cwd_of(t)).is_empty() { return None; }
    let note = crate::flow::task::note_stat(t)?.1;
    let root = cwd_of(t);
    let report = crate::research::report_folder(t);
    let mut evidence = BTreeMap::new();
    evidence.insert("closing-note".to_string(), digest(&note));
    collect(&root.join(".proof"), &mut evidence)?;
    collect(&report, &mut evidence)?;
    // A remote or out-of-tree artifact can change without any local input changing.
    for content in [text, note.as_str()] {
        local_references(content, &root, &report)?;
    }
    let policy: Obj = ch.iter().filter(|(k, _)| k.starts_with("reviewer.") || k.starts_with("review.") || k.starts_with("check.")).map(|(k, v)| (k.clone(), v.clone())).collect();
    Some(digest(&json!({ "id": t.at("id"), "head": head, "range": change.at("range"),
        "title": t.at("title"), "description": t.at("description"), "text": text, "evidence": evidence,
        "policy": policy, "check": check, "checkedWith": t.at("checkedWith"), "checkedHead": t.at("checkedHead"),
        "reviewerOn": t.at("reviewerOn") }).to_string()))
}

pub fn reusable(t: &Task, identity: &str) -> Option<Value> {
    let rv = t.at("review");
    if identity.is_empty() || rv.s("inputIdentity") != identity || rv.b("stale") || !gate::passes(rv) { return None; }
    Some(rv.clone())
}

fn digest(text: &str) -> String { sha1_smol::Sha1::from(text).digest().to_string() }

fn collect(path: &Path, evidence: &mut BTreeMap<String, String>) -> Option<()> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Some(()),
        Err(_) => return None,
    };
    if meta.is_dir() {
        for entry in std::fs::read_dir(path).ok()? { collect(&entry.ok()?.path(), evidence)?; }
    } else if meta.is_file() && meta.len() <= 4_000_000 {
        let text = std::fs::read_to_string(path).ok()?;
        if text.contains("://") { return None; }
        evidence.insert(path.display().to_string(), digest(&text));
    } else { return None; }
    Some(())
}

fn local_references(text: &str, root: &Path, report: &Path) -> Option<()> {
    if text.contains("://") { return None; }
    for link in crate::re!(r"\]\(([^)]+)\)").captures_iter(text) {
        let target = link.get(1)?.as_str().split('#').next()?.trim_matches(['<', '>']);
        if target.is_empty() { continue; }
        let path = if Path::new(target).is_absolute() { Path::new(target).to_path_buf() } else { root.join(target) };
        let path = path.canonicalize().ok()?;
        if !path.starts_with(root) && !path.starts_with(report) { return None; }
        // Tracked source is covered by head; local evidence must be in the collected directories.
        if path.starts_with(root) && !path.starts_with(root.join(".proof")) {
            let relative = path.strip_prefix(root).ok()?.to_str()?;
            crate::store::repos::git_out(root, &["ls-files", "--error-unmatch", relative]).ok()?;
        }
    }
    Some(())
}
