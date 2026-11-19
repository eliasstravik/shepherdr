//! A task's reviews: the current one, which round, and every one it had.
use super::tasks::{one_line, Task};
use crate::clock::now;
use crate::gate::{is_int, is_tagged, passes};
use crate::json::*;

/// Keep findings and evidence for reference, but a verdict stops describing the work once it resumes.
pub fn current_review(t: &Task) -> Option<&Value> { let rv = t.at("review"); (rv.is_object() && !rv.b("stale")).then_some(rv) }
/// Which review a task is on: 1 for its first, counted up each time a reviewer starts on it. 0 before any review.
pub fn review_round(t: &Task) -> i64 { t.f("reviewRound").floor().max(0.0) as i64 }
/// Every review a task has had, oldest first. A review from before the gate keeps its score and its advice.
fn review_entry(rv: &Value, round: i64, at: &Value) -> Value {
    let mut e = obj(json!({ "round": round, "at": at }));
    if rv.b("by") { e.put("by", rv.at("by").clone()); }
    if rv.b("error") { e.put("error", one_line(&rv.t("error"), 400)); return Value::Object(e); }
    if is_tagged(rv) {
        for k in ["meets", "findings", "gate", "pass"] { e.put(k, rv.at(k).clone()); }
        e.put("left", if rv.b("left") { rv.at("left").clone() } else { json!(0) });
    } else {
        e.put("score", rv.at("score").clone()); e.put("recommend", rv.at("recommend").clone());
        e.put("problems", if rv.at("problems").is_array() { rv.at("problems").clone() } else { json!([]) });
    }
    e.put("text", rv.at("text").clone());
    e.put("checks", if rv.at("checks").is_array() { rv.at("checks").clone() } else { json!([]) });
    e.put("limitations", if rv.at("limitations").is_array() { rv.at("limitations").clone() } else { json!([]) });
    if rv.b("offPlan") { e.put("offPlan", rv.at("offPlan").clone()); } // where the build left its approved plan (plan/)
    if rv.b("inputIdentity") { e.put("inputIdentity", rv.at("inputIdentity").clone()); }
    e.put("head", if rv.b("head") { rv.at("head").clone() } else { Value::Null });
    Value::Object(e)
}
/// The one review saved on a task from before the list existed. `round`: which review it was.
fn saved_review(t: &Task, round: i64) -> Vec<Value> {
    let rv = t.at("review");
    if rv.is_object() && (is_int(rv.at("score")) || is_tagged(rv)) { vec![review_entry(rv, round.max(1), rv.at("at"))] } else { vec![] }
}
/// A review saved before the list existed is put on the list, under the number the counter stands at, before the
/// counter moves for the next review.
pub fn keep_saved_review(t: &mut Task) {
    if !t.arr("reviews").is_empty() { return; }
    let had = saved_review(t, review_round(t));
    if !had.is_empty() { t.put("reviews", had); }
}
/// Called once the new review's number is on the task.
pub fn log_review(t: &mut Task, rv: &Value) {
    let round = review_round(t).max(1);
    let mut had: Vec<Value> = if t.arr("reviews").is_empty() { saved_review(t, round - 1) } else { t.arr("reviews").to_vec() };
    had.push(review_entry(rv, round, &json!(now())));
    t.put("reviews", had);
}
pub fn review_history(t: &Task) -> Vec<Value> { if !t.arr("reviews").is_empty() { t.arr("reviews").to_vec() } else { saved_review(t, review_round(t)) } }
/// A review cut off by its provider waits and starts again as the same review: during it the review the task is on is the next one.
fn retrying(t: &Task) -> bool { t.at("waiting").s("who") == "reviewer" && matches!(t.s("stage"), "reviewing" | "reviewneeds") }
/// The number of the review a task is on or last had.
pub fn review_number(t: &Task) -> i64 {
    if retrying(t) { return review_round(t) + 1; }
    let r = review_round(t);
    if r > 0 { r } else { review_history(t).last().map(|e| e.i("round")).unwrap_or(0) }
}
/// How the review a task is on (or last had) came out: "pass", "fail", or "" with no verdict to go by.
pub fn review_result(t: &Task) -> &'static str {
    let round = review_number(t);
    let hist = review_history(t);
    let Some(e) = hist.iter().rev().find(|e| e.i("round") == round) else { return "" };
    if round == 0 { return ""; }
    if e.b("error") { return "fail"; }
    if is_tagged(e) { return if e.b("pass") { "pass" } else { "fail" }; }
    match e.at("recommend").as_bool() { Some(true) => "pass", Some(false) => "fail", None => "" }
}
/// The last review of the work, when it passed: the review as the task holds it, the commit the reviewer looked at,
/// and its round. None when there was none, it failed, or it gave no verdict.
pub fn passed_review(t: &Task) -> Option<(Value, String, i64)> {
    let hist = review_history(t);
    let last = hist.last()?;
    if last.b("error") || !last.b("head") || !passes(last) || !t.at("review").is_object() || !passes(t.at("review")) { return None; }
    let mut review = t.at("review").as_object().cloned().unwrap_or_default();
    review.del("stale");
    Some((Value::Object(review), last.t("head"), last.i("round")))
}
/// A review that still stands after main was merged in is written on the review it belongs to, each time.
pub fn log_kept(t: &mut Task, k: &Value) {
    keep_saved_review(t);
    let mut reviews = t.arr("reviews").to_vec();
    let Some(last) = reviews.last_mut().and_then(|v| v.as_object_mut()) else { return };
    let mut entry = obj(json!({ "at": now() }));
    if let Some(o) = k.as_object() { for (a, b) in o { entry.insert(a.clone(), b.clone()); } }
    let mut kept = last.arr("kept").to_vec();
    kept.push(Value::Object(entry));
    last.put("kept", kept);
    t.put("reviews", reviews);
}
/// "re-merged with main, tests pass, review 2 still stands"; "a chat changed no code, review 2 still stands"
pub fn kept_words(k: &Value, round: i64) -> String {
    if k.b("unchanged") { return format!("review inputs unchanged, review{} still stands", if round > 0 { format!(" {round}") } else { String::new() }); }
    if k.b("chat") { return format!("a chat changed no code, review{} still stands", if round > 0 { format!(" {round}") } else { String::new() }); }
    let n = k.arr("resolved").len();
    format!("re-merged with main{}, {}, review{} still stands",
        if n > 0 { format!(" (conflicts resolved in {n} file{})", if n == 1 { "" } else { "s" }) } else { String::new() },
        if k.b("check") { "tests pass" } else { "no check is set" }, if round > 0 { format!(" {round}") } else { String::new() })
}
