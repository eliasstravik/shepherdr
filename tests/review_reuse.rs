//! A completed review can be reused only for unchanged source, specification, policy and local evidence.
use crate::common;
use common::*;
use serde_json::{json, Value};
use sw::json::*;
use sw::finish::review_reuse::{input_identity, reusable};
use sw::store::tasks::{update, Change};

fn passing_work() -> Value { json!({ "files": { "f.txt": "v1\n" }, "commit": "v1", "note": "Did v1." }) }
fn pass() -> Value { json!({ "verdict": { "meets": true, "findings": [], "text": "Looks right." } }) }
fn reviewed() -> (World, String) {
    let w = world_with(Opts { repo: true, settings: json!({ "review.when": "always", "reviewer.agent": "agy" }), ..Default::default() });
    w.script(json!({ "worker": [passing_work()], "reviewer": [pass(), pass(), pass()] }));
    let id = w.add("Review inputs");
    delegate(&id);
    let t = settle(&id);
    assert_eq!(t.s("stage"), "approval", "{} {}", t.s("msg"), t.at("failure"));
    (w, id)
}
fn reviewers(w: &World) -> usize { calls(w).iter().filter(|c| c.starts_with("agent start") && c.contains("--kind agy")).count() }
fn finish_again(id: &str) {
    let mut g = sw::runner::Guard::free(id);
    sw::finish::pipeline::pipeline(id, &mut g, "Did v1.", false, "", None).unwrap();
}

#[test]
fn unchanged_finish_keeps_round_artifacts_and_does_not_launch_another_reviewer() {
    let (w, id) = reviewed();
    let first = task(&id);
    assert!(first.at("review").b("inputIdentity"));
    let artifacts = first.at("review").at("artifacts").clone();
    finish_again(&id);
    let next = task(&id);
    assert_eq!(reviewers(&w), 1);
    assert_eq!(next.i("reviewRound"), first.i("reviewRound"));
    assert_eq!(next.at("review").at("artifacts"), &artifacts);
    assert_eq!(next.s("stage"), "approval");
}

#[test]
fn new_evidence_or_specification_requires_a_new_review() {
    let (w, id) = reviewed();
    let proof = std::path::Path::new(task(&id).s("worktree")).join(".proof");
    std::fs::create_dir_all(&proof).unwrap();
    std::fs::write(proof.join("proof.md"), "New local evidence.\n").unwrap();
    finish_again(&id);
    assert_eq!(reviewers(&w), 2);
    update(&id, |t| { t.put("description", "A changed requirement."); Ok(Change::Write) }).unwrap();
    finish_again(&id);
    assert_eq!(reviewers(&w), 3);
}

#[test]
fn identities_change_for_head_policy_and_closing_note_and_remote_evidence_is_unknown() {
    let (_w, id) = reviewed();
    let t = task(&id);
    let change = sw::flow::git::change_of(&t).unwrap();
    let ch = sw::store::settings::lookup::work(Some(&t));
    let key = input_identity(&t, &change, "Did v1.", &ch, "").unwrap();
    let mut new_head = change.clone(); new_head["head"] = json!("different");
    assert_ne!(input_identity(&t, &new_head, "Did v1.", &ch, ""), Some(key.clone()));
    for field in ["reviewer.agent", "review.mustFix", "check.command"] {
        let mut policy = ch.clone(); policy.put(field, "changed");
        assert_ne!(input_identity(&t, &change, "Did v1.", &policy, ""), Some(key.clone()));
    }
    std::fs::write(sw::flow::task::note_file(&t), "Changed result.").unwrap();
    assert_ne!(input_identity(&t, &change, "Did v1.", &ch, ""), Some(key));
    std::fs::write(sw::flow::task::note_file(&t), "[remote](https://example.test/evidence)").unwrap();
    assert!(input_identity(&t, &change, "Did v1.", &ch, "").is_none());
}

#[test]
fn failed_stale_and_legacy_reviews_do_not_reuse_and_history_preserves_identity() {
    let (_w, id) = reviewed();
    let t = task(&id);
    let key = t.at("review").t("inputIdentity");
    assert!(reusable(&t, &key).is_some());
    assert_eq!(t.arr("reviews").last().unwrap().s("inputIdentity"), key);
    for patch in [json!({ "stale": true }), json!({ "meets": false, "pass": false }), json!({ "inputIdentity": null })] {
        let mut changed = t.clone();
        for (k, v) in patch.as_object().unwrap() { changed.obj_mut("review").put(k, v.clone()); }
        assert!(reusable(&changed, &key).is_none());
    }
}
