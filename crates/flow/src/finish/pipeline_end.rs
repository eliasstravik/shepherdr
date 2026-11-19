//! The pipeline's second half: the adversarial review (or the one that still stands), the loop that sends failing work
//! back, the limits, and then done, the approval gate, or the merge by itself.
use super::auto_merge::by_itself;
use super::hand_over::hand_over;
use super::review::run_review;
use super::review_screen::with_screen;
use super::shared::{approval_message_with, fail, failure, first_line, FailHow};
use crate::clock::now;
use crate::err::Res;
use crate::flow;
use crate::gate;
use crate::json::*;
use crate::limits::reached::{stop_at, tokens_over, StopHow};
use crate::runner::Guard;
use crate::store::reviews::{log_kept, log_review, review_round};
use crate::store::settings::lookup::work;
use crate::store::tasks::{get, one_line, Task};
use crate::sync;
use std::path::Path;

pub struct Ctx<'a> {
    pub id: &'a str, pub text: &'a str, pub keep_intent: bool, pub reason: &'a str, pub sync: Option<&'a sync::Synced>, pub research: bool,
    pub tree: &'a str, pub folder: &'a Path, pub root: &'a Path, pub check: &'a str, pub note: String, pub kept: Option<Value>, pub kept_how: Option<Value>,
}
fn finished(text: &str) -> String { let f = first_line(text); if f.is_empty() { "Finished".into() } else { f } }
/// A pull-request blocker found by polling survives a passing local check: remote CI must confirm. Failed checks of an
/// older commit than the one pushed now say nothing of it: they are cleared, and GitHub's checks are looked at anew (#309).
fn hold_pr_failure(g: &mut Guard, t: &mut Task) -> Res<bool> {
    if crate::land::checks::stale(t, t.s("prHead")) { *t = g.set(|t| { t.put("prFailure", Value::Null); if t.s("prState") == "failing" { t.put("prState", Value::Null); } })?; }
    if !t.b("prFailure") { return Ok(false); }
    let h = g.set(|t| { t.put("stage", "approval"); t.put("failure", Value::Null); let m = format!("Local checks passed; pull request still blocked: {}. Wait for remote confirmation or send the details to the agent", t.at("prFailure").s("title")); t.put("msg", m); })?;
    flow::sidebar::tell_sidebar(&h);
    Ok(true)
}
pub fn done(g: &mut Guard, t: &Task, msg: &str, review: Option<&Value>) -> Res<()> {
    let mark = flow::spaces::tidy_mark(t, "merged", "");
    let d = g.set(|t| { t.put("stage", "done"); t.put("tidy", mark.clone().unwrap_or(Value::Null)); t.put("msg", one_line(msg, 2048)); t.put("failure", Value::Null); t.put("mergeIntent", Value::Null); if let Some(r) = review { t.put("review", r.clone()); } })?;
    flow::sidebar::tell_sidebar(&d);
    crate::land::tidy(d.s("id"), "merged"); // done with nothing to merge leaves herdr's sidebar like merged work does
    Ok(())
}
/// Work that is on main already (the agent merged it itself) closes its issues (`merge.closes`) as a merge does: the
/// words for its line, after a space. Nothing for work that needed no change.
fn on_main_closes(t: &Obj, root: &Path) -> String {
    let closed = if t.s("doneWhy").starts_with("Already") { crate::land::closes::after_landing(t, root, "") } else { String::new() };
    if closed.is_empty() { closed } else { format!(" {closed}") }
}
pub fn after_review(c: Ctx, g: &mut Guard) -> Res<()> {
    let id = c.id;
    let mut t = g.check()?;
    let change = if !c.tree.is_empty() && !c.research { flow::git::change_of(&t) } else { None };
    let to_land = change.as_ref().map(|ch| ch.b("stat")).unwrap_or(false);
    let ch = work(Some(&t));
    // Nothing to land: it is simply done, unless work outside a repo is reviewed too (review "always").
    if !to_land && ch.s("review.when") != "always" && !(c.research && ch.s("review.when") != "never") {
        if hold_pr_failure(g, &mut t)? { return Ok(()); }
        return done(g, &t, &format!("{}{}{}", finished(c.text), c.note, on_main_closes(&t, c.root)), None);
    }
    // An adversarial review before it reaches you. Its settings are read now, as the review starts.
    let ch = work(get(id).as_ref());
    let review_needed = ch.s("review.when") != "never";
    let mut review: Option<Value> = None;
    let identity = change.as_ref().and_then(|change| super::review_reuse::input_identity(&t, change, c.text, &ch, c.check));
    let cached = identity.as_deref().and_then(|key| super::review_reuse::reusable(&t, key));
    let kept = c.kept.clone().or(cached);
    if review_needed && kept.is_some() && to_land {
        let head = change.as_ref().map(|x| x.t("head")).unwrap_or_default();
        let mut k = kept.and_then(|v| v.as_object().cloned()).unwrap_or_default();
        let mut how = c.kept_how.clone().and_then(|v| v.as_object().cloned()).unwrap_or_default();
        how.put("head", head.clone()); how.put("check", c.check);
        k.put("head", head); k.put("keptAt", now()); k.put("kept", how.clone());
        g.set(|t| log_kept(t, &Value::Object(how.clone())))?; // the task's history says what happened instead of a review
        review = Some(Value::Object(k));
    } else if review_needed {
        let mut r = run_review(id, g, c.text, change.as_ref(), to_land, &ch, c.check)?;
        if let (Some(key), Some(rv), Some(change)) = (&identity, &mut r.review, &change) {
            let current = g.check()?;
            if super::review_reuse::input_identity(&current, change, c.text, &ch, c.check).as_ref() == Some(key) {
                rv.put("inputIdentity", key.clone());
            }
        }
        if r.aborted { return Ok(()); }
        // The task keeps every review it had. A review the provider cut off is not one: it is not on the list.
        if !r.cut { let entry = r.review.clone().map(Value::Object).unwrap_or_else(|| json!({ "error": r.error })); g.set(|t| log_review(t, &entry))?; }
        let Some(rv) = r.review else {
            let mut f = failure("review", if r.auth { "Needs a login" } else { "Review failed" }, &with_screen(&format!("Review failed: {}", r.error), &r.screen), "Investigate the reviewer failure, then finish again for a fresh review. Do not bypass review or merge approval.");
            if r.auth { f.put("auth", true); }
            f.put("msg", if r.auth { "The reviewer needs a login".to_string() } else { format!("Review failed: {}. Retry the task to review again", one_line(&r.error, 200)) });
            fail(g, f, FailHow { patch: obj(json!({ "review": null })), ..Default::default() })?;
            return Ok(());
        };
        let rv = Value::Object(rv);
        // The pull request says what the review found, the findings below the gate marked as not required.
        if t.b("pr") && to_land { let round = get(id).map(|x| review_round(&x)).unwrap_or(0); flow::git::gh(&["pr", "comment", &flow::git::pr_number(t.s("pr")), "--body", &format!("{}{}", gate::pr_comment(&rv, round), flow::git::BOARD_COMMENT)], c.root, 60000); }
        review = Some(rv);
    }
    // A conflict with main that was repaired on the way here: one line in the record, with whether a review followed.
    let reviewed_anew = review_needed && !review.as_ref().map(|r| r.b("keptAt")).unwrap_or(false);
    g.set(|t| { sync::conflict_log::conflict_logged(t, reviewed_anew); })?;
    // A merge the board itself was on its way to is only kept while that setting still says so.
    t = g.set(|t| { t.put("failure", Value::Null); if t.at("mergeIntent").b("auto") && !by_itself(t) { t.put("mergeIntent", Value::Null); } })?;
    // The loop: a review that fails the gate goes straight back, at most `review.rounds` times (0: never).
    let rounds = t.i("reviewRounds");
    let max = ch.i("review.rounds");
    let passed = review.as_ref().map(gate::passes).unwrap_or(true);
    let fresh = review.as_ref().map(|r| !r.b("keptAt")).unwrap_or(false);
    // The task's tokens, the reviewer's now among them. At the limit the task stops here, under "needs you".
    let over = tokens_over(id, "");
    if let (Some((limit, used)), Some(rv)) = (&over, &review) { if fresh && !passed && rounds < max {
        let stat = change.as_ref().map(|x| x.at("stat").clone()).unwrap_or(Value::Null);
        g.set(|t| { t.put("review", rv.clone()); t.put("stat", stat.clone()); })?;
        stop_at(id, "tokens", limit, *used, StopHow { role: "reviewer".into(), review: true, ..Default::default() });
        return Ok(());
    } }
    if let (Some((limit, used)), true) = (&over, to_land) {
        let why = c.sync.map(sync::held_why).unwrap_or_default();
        let ch2 = change.clone().unwrap_or(Value::Null);
        let head = { let h = ch2.t("head"); if h.is_empty() { flow::git::head_of(c.folder) } else { h } };
        g.set(|t| { t.put("review", review.clone().unwrap_or(Value::Null)); t.put("stat", ch2.at("stat").clone()); t.put("reviewedHead", if head.is_empty() { Value::Null } else { json!(head) }); t.put("mergeFailed", false); t.put("failure", Value::Null); t.put("syncBlocked", if why.is_empty() { Value::Null } else { sync::blocked(&why, c.sync) }); })?;
        stop_at(id, "tokens", limit, *used, StopHow { role: "reviewer".into(), ready: true, ..Default::default() });
        return Ok(());
    }
    // The same with nothing to land (a report, work outside a repo): reviewed, over its limit, it stops here too.
    if let (Some((limit, used)), Some(rv)) = (&over, &review) {
        g.set(|t| { t.put("review", rv.clone()); t.put("failure", Value::Null); })?;
        stop_at(id, "tokens", limit, *used, StopHow { role: "reviewer".into(), ready: true, done: one_line(&format!("{} {}{}", gate::sentence(rv, "accept"), finished(c.text), c.note), 2048), ..Default::default() });
        return Ok(());
    }
    if let Some(rv) = &review { if fresh && !passed && rounds < max {
        let mut stale = rv.as_object().cloned().unwrap_or_default(); stale.put("stale", true);
        flow::send::send_own(id, &gate::review_message(rv, false), "review", t.b("mergeIntent"), obj(json!({ "review": stale, "reviewRounds": rounds + 1 })), 0)?;
        return Ok(());
    } }
    // Still failing after the last round: the next agent on `worker.fallback` takes over, with the open findings.
    if let Some(rv) = &review { if fresh && !passed && max > 0 && !t.b("mergeIntent") {
        let mut stale = rv.as_object().cloned().unwrap_or_default(); stale.put("stale", true);
        g.set(|t| t.put("review", stale.clone()))?;
        if hand_over(id, g, &format!("its work still failed review after {rounds} round{}", if rounds == 1 { "" } else { "s" }), "")? { return Ok(()); }
    } }
    let head = change.as_ref().map(|x| x.t("head")).filter(|h| !h.is_empty()).unwrap_or_else(|| flow::git::head_of(c.folder));
    let head_v = if head.is_empty() { Value::Null } else { json!(head) };
    if t.b("mergeIntent") { // an approved merge being re-verified after a sync with main or a conflict repair
        if let Some(rv) = review.as_ref().filter(|_| fresh && !passed) {
            let mut f = failure("review", "Approved merge repair is not ready", &format!("A reviewer went through the repair and found it not ready: {}.\n\n{}", gate::result(rv, "merge"), gate::findings_text(rv, false)), "The agent could not make this repair pass review. Address the findings before retrying.");
            f.put("agentCanFix", true);
            fail(g, f, FailHow::default())?;
            return Ok(());
        }
        let stat = change.as_ref().map(|x| x.at("stat").clone()).unwrap_or(Value::Null);
        t = g.set(|t| { t.put("review", review.clone().unwrap_or(Value::Null)); t.put("stat", stat.clone()); t.put("reviewedHead", head_v.clone()); t.obj_mut("mergeIntent").put("verifiedHead", head_v.clone()); })?;
        if hold_pr_failure(g, &mut t)? { return Ok(()); }
        g.set(|t| { t.put("stage", "merging"); t.put("msg", "Merging"); })?;
        return crate::land::land_core(id, g);
    }
    if !to_land {
        let msg = format!("{}{}{}{}", review.as_ref().map(|r| format!("{} ", gate::sentence(r, "accept"))).unwrap_or_default(), finished(c.text), c.note, on_main_closes(&t, c.root));
        return done(g, &t, &msg, review.as_ref());
    }
    let stat = change.as_ref().map(|x| x.at("stat").clone()).unwrap_or(Value::Null);
    t = g.set(|t| { t.put("review", review.clone().unwrap_or(Value::Null)); t.put("stat", stat.clone()); t.put("reviewedHead", head_v.clone()); t.put("mergeFailed", false); })?;
    if hold_pr_failure(g, &mut t)? { return Ok(()); }
    // A task that merges by itself (`merge.by`, read now) still wants a review that passed the gate.
    let skip = c.sync.map(|s| !sync::held_why(s).is_empty()).unwrap_or(false);
    if by_itself(&t) && !t.b("requireApproval") && !t.b("chat") && !skip && (!review_needed || (review.is_some() && passed)) {
        g.set(|t| { t.put("stage", "merging"); t.put("msg", "Merging"); t.put("mergeIntent", json!({ "approvedAt": now(), "repairs": 0, "verifiedHead": head_v, "auto": true })); })?;
        return crate::land::land_core(id, g);
    }
    // Finished work that waits for your yes is not done: it is blocked on you. Checked and reviewed, but not against where
    // it would land (your checkout is on another branch, or main could not be fetched): not approvable yet.
    let behind = c.sync.map(sync::held_why).unwrap_or_default();
    let note = c.note.clone();
    t = g.set(|t| { t.put("stage", "approval"); let m = if behind.is_empty() { approval_message_with(t, &note) } else { sync::behind_msg(&behind) }; t.put("msg", m); if !behind.is_empty() { t.put("syncBlocked", sync::blocked(&behind, c.sync)); } })?;
    flow::sidebar::tell_sidebar(&t);
    let _ = (c.keep_intent, c.reason);
    Ok(())
}
