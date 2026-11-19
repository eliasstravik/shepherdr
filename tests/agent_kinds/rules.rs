//! Standing rules are read once per retained context, and unchanged content keeps its file timestamp.
use crate::common;
use common::*;
use std::fs::{File, FileTimes};
use std::time::{Duration, UNIX_EPOCH};
use sw::agents::adapter::standing;
use sw::agents::hand_limits::{rules_pointer, typed_command, LINE_MAX};

#[test]
fn unchanged_rules_keep_the_file_timestamp_for_codex_and_claude() {
    let w = world();
    for kind in ["codex", "claude"] {
        let dir = w.base.join(kind);
        std::fs::create_dir_all(&dir).unwrap();
        let content = "All standing requirements remain in force.\n".repeat(12);
        let first = standing(kind, &content, &dir).unwrap();
        let file = dir.join("rules.md");
        let fixed = UNIX_EPOCH + Duration::from_secs(12345);
        File::open(&file).unwrap().set_times(FileTimes::new().set_modified(fixed)).unwrap();
        assert_eq!(standing(kind, &content, &dir).unwrap(), first);
        assert_eq!(std::fs::metadata(&file).unwrap().modified().unwrap(), fixed);
        let changed = format!("{content}A changed requirement.\n");
        standing(kind, &changed, &dir).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), changed);
        assert_ne!(std::fs::metadata(&file).unwrap().modified().unwrap(), fixed);
    }
}

#[test]
fn the_pointer_distinguishes_initial_read_from_resume_and_fits_a_long_task_path() {
    let w = world();
    let dir = w.base.join("task-name-with-a-long-but-ordinary-work-board-identifier-123456789");
    std::fs::create_dir_all(&dir).unwrap();
    let words = rules_pointer(&dir.join("rules.md"));
    assert!(words.contains("Read it fully before starting work"));
    assert!(words.contains("On resume, check for changes and restore your checkpoint"));
    assert!(words.contains("reread changed, missing or uncertain instructions"));
    assert!(!words.contains("Read all of that file now"));
    let args = standing("codex", &"requirement\n".repeat(60), &dir).unwrap();
    assert!(typed_command("codex", &args).len() <= LINE_MAX);
}

#[test]
fn short_codex_rules_stay_inline_and_write_failures_are_returned() {
    let w = world();
    let args = standing("codex", "short rule", &w.base).unwrap();
    assert!(args[1].contains("short rule"));
    assert!(!w.base.join("rules.md").exists());
    std::fs::create_dir(w.base.join("rules.md")).unwrap();
    assert!(standing("claude", "rules", &w.base).is_err());
}
