//! A working task's line before the Watcher's first look of a run: the last sentence kept with its age, or "Just
//! started", never a bare "…"; and what the Watcher or an agent wrote, on the row exactly as written.
mod review_reuse;
use crate::common;
use common::*;
use serde_json::{json, Value};
use std::sync::Arc;
use sw::board::state::{Rec, State};
use sw::board::theme::Theme;
use sw::board::view::row::{row_layout, row_lines};
use sw::json::*;
use sw::state::show;
use sw::status_kept::{quiet_line, JUST_MS};
use sw::store::settings::{change::set_value, lookup::Scope};

const MIN: i64 = 60000;
const T0: i64 = 1_000_000_000_000;
fn base() -> Obj { obj(json!({ "id": "p/1", "owner": "me", "app": "claude", "link": { "pane": "w1:p1" }, "stage": "working", "since": T0, "workAt": T0 })) }
fn with(t: &Obj, extra: Value) -> Obj { let mut o = t.clone(); for (k, v) in extra.as_object().cloned().unwrap_or_default() { o.insert(k, v); } o }
fn said(t: &Obj, mins: i64) -> String { show(t, &json!({ "status": "working" }), T0 + mins * MIN).msg }
/// Whether there is a Watcher is your setting (`watcher.agent`, or `none`).
fn watcher(agent: &str) { set_value("watcher.agent", &json!(agent), &Scope::you()).unwrap(); }
fn off<R>(f: impl FnOnce() -> R) -> R { watcher("none"); let r = f(); watcher("claude"); r }

#[test]
fn first_run_a_task_whose_agent_has_just_started_says_so_until_the_watcher_s_first_sentence_and_then_says_that() {
    let _w = world(); watcher("claude");
    let task = base();
    assert_eq!(said(&task, 0), "Just started"); assert_eq!(said(&task, 1), "Just started");
    assert_eq!(said(&with(&task, json!({ "watch": { "msg": "Reading the code", "progress": 10, "role": "agent", "at": T0 + MIN } })), 2), "Reading the code");
    // Still no sentence long after it began (the Watcher's calls fail): no longer "just", and still words.
    assert_eq!(said(&task, JUST_MS / MIN), "No status yet");
    // With the Watcher off none will come: the plain word, which a row leaves out since its heading says it.
    assert_eq!(off(|| said(&task, 0)), "Working");
    assert!(off(|| show(&task, &json!({ "status": "working" }), T0).plain));
    // The reviewer is a new agent every round: its round says it has just started, never the round before's words.
    let review = with(&task, json!({ "stage": "reviewing", "msg": "Under review", "reviewAt": T0, "lastLine": { "msg": "Running the check", "at": T0 - MIN } }));
    assert_eq!(said(&review, 0), "Review just started");
    assert_eq!(said(&with(&review, json!({ "watch": { "msg": "Reading the diff", "progress": 5, "role": "reviewer" } })), 0), "Reading the diff");
}

#[test]
fn working_again_the_last_sentence_stays_said_with_its_age_until_a_new_one_arrives() {
    let _w = world(); watcher("claude");
    // A new turn, sent back after a review, a conflict, a retry: each drops the guess (`watch`), none the kept sentence.
    let again = with(&base(), json!({ "watch": null, "lastLine": { "msg": "Running the check", "at": T0 - 12 * MIN } }));
    assert_eq!(said(&again, 0), "12m ago: Running the check");
    // Its age is in the words, and grows: a kept sentence is never read as a fresh one.
    assert_eq!(said(&again, 5), "17m ago: Running the check");
    assert_eq!(quiet_line(&again, "agent", T0, T0 + 60 * MIN), "1h ago: Running the check");
    let next = show(&with(&again, json!({ "watch": { "msg": "Fixing the review's findings", "progress": 30, "role": "agent", "at": T0 + MIN } })), &json!({ "status": "working" }), T0 + MIN);
    assert_eq!((next.msg.as_str(), next.progress), ("Fixing the review's findings", Some(30.0)));
    // A guess left by the reviewer is not the agent's: the agent's own last sentence shows, with no percent of the reviewer's.
    let after = show(&with(&again, json!({ "watch": { "msg": "Reading the diff", "progress": 80, "role": "reviewer" } })), &json!({ "status": "working" }), T0);
    assert_eq!(after.msg, "12m ago: Running the check");
    assert!(after.progress.unwrap_or(0.0) == 0.0, "{:?}", after.progress);
    // What the board itself has to say about the run comes first.
    assert_eq!(said(&with(&again, json!({ "msg": "Resolving a conflict with main" })), 0), "Resolving a conflict with main");
}

#[test]
fn what_the_watcher_or_an_agent_wrote_is_on_the_row_exactly_as_written_only_the_board_s_own_plain_word_is_left_out() {
    let _w = world(); watcher("claude");
    sw::clock::set(Some(T0));
    let (mut s, theme) = (State::new(Default::default(), Default::default()), Theme::default_dark(false));
    let mut row_of = |t: &Obj, live: Value| -> String {
        let sh = show(t, &live, T0);
        let r: Rec = Arc::new(with(t, json!({ "state": sh.state, "kind": sh.kind, "msg": sh.msg, "plain": sh.plain, "at": T0, "title": "Work" })));
        let lay = row_layout(&mut s, &theme, std::slice::from_ref(&r), 120, &[vec![r.clone()]], 200);
        row_lines(&s, &theme, &r, 120, &lay).iter().map(|l| l.text()).collect::<Vec<_>>().join("\n")
    };
    // Under the task's name, where its name starts (the JS rows had no number, so two spaces there: the column is what counts).
    let col = |text: &str| { let first = text.lines().next().unwrap_or(""); first[..first.find("Work").unwrap_or(0)].chars().count() };
    let ends = |text: &str, re: &str| regex::Regex::new(&format!(r"\n[ ▌]{} *$", re.replace("{2}", &format!("{{{}}}", col(text) - 1)))).unwrap().is_match(text);
    for msg in ["Working", "WORKING", "Under review", "Needs you", "Idle"] {
        let r = row_of(&with(&base(), json!({ "watch": { "msg": msg, "progress": 10, "role": "agent", "at": T0 } })), json!({ "status": "working" }));
        assert!(ends(&r, &format!(" {{2}}{msg}")), "{msg}: {r}");
        let r = row_of(&with(&base(), json!({ "msg": msg })), json!({ "status": "working" }));
        assert!(ends(&r, &format!(" {{2}}{msg}")), "{msg}, reported: {r}");
    }
    let r = row_of(&with(&base(), json!({ "stage": "reviewing", "reviewAt": T0, "watch": { "msg": "Under review", "progress": 10, "role": "reviewer", "at": T0 } })), json!({ "status": "working" }));
    assert!(ends(&r, " {2}Under review"), "{r}");
    // The board's own plain words, with the Watcher off: no sentence will come, so the row's second line says where the
    // task stands. Never an empty line under a name.
    watcher("none");
    let r = row_of(&base(), json!({ "status": "working" })); assert!(ends(&r, " +Working"), "{r}");
    let r = row_of(&with(&base(), json!({ "stage": "reviewing", "msg": "Under review", "reviewAt": T0 })), json!({ "status": "working" })); assert!(ends(&r, " +Under review"), "{r}");
    watcher("claude");
    let r = row_of(&base(), json!({ "status": "blocked" })); assert!(ends(&r, " +Needs you"), "{r}");
}
