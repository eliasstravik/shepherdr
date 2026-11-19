//! How much can be handed to a program through herdr, and the files that carry what is longer. A start command is typed
//! into the pane's shell, and a terminal takes at most 4096 bytes on one line while that shell is still starting (its
//! line editor not yet up), macOS only 1024: a longer one arrives cut off, the shell waits at its continuation prompt and
//! herdr times out (seen on herdr 0.9.3 with Codex's rules in `-c developer_instructions=…`), or herdr 0.9.5 refuses it
//! (herdr/shell_ready.rs). A message is one argument of `herdr agent prompt`, and Linux takes at most 128 KiB in one
//! argument.
use crate::err::Res;
use crate::store::files::{data_dir, write_atomic};
use std::path::Path;

/// The longest line a terminal takes while its shell is starting: macOS' (Linux: 4096).
pub const LINE_MAX: usize = 1024;
/// A launch argument longer than this goes in a file, so that the whole start command stays well under `LINE_MAX`.
pub const ARG_MAX: usize = 300;
/// The longest single argument Linux passes to a program.
pub const PROGRAM_ARG_MAX: usize = 131072;
/// A message longer than this is handed over in a file.
pub const MESSAGE_MAX: usize = 100_000;

/// The start command as herdr types it, to measure.
pub fn typed_command(kind: &str, args: &[String]) -> String {
    std::iter::once(kind.to_string()).chain(args.iter().map(|a| if a.chars().all(|c| c.is_ascii_alphanumeric() || "-_=./:,@%+".contains(c)) { a.clone() } else { crate::util::shq(a) })).collect::<Vec<_>>().join(" ")
}
/// The words that point a program at its standing rules in `file`, for a program that takes them only inline.
pub fn rules_pointer(file: &Path) -> String {
    format!("Your standing rules are in the file {}. Read it fully before starting work. On resume, check for changes and restore your checkpoint; reread changed, missing or uncertain instructions. Follow it throughout the session.", file.display())
}
fn message_file(text: &str) -> std::path::PathBuf {
    let h = sha1_smol::Sha1::from(text).digest().to_string();
    data_dir().join("messages").join(format!("{}.md", &h[..16]))
}
/// What is typed into the program for a message: the message itself, or for one too long to hand over, a line that
/// names the file it is in. The same message always gives the same line.
pub fn as_typed(text: &str) -> String {
    if text.len() <= MESSAGE_MAX { return text.to_string(); }
    format!("[This message is too long to be typed in, so it is in the file {}. Read all of that file now and take it as this message: do what it says.]", message_file(text).display())
}
/// The same, with the file written.
pub fn hand_over(text: &str) -> Res<String> {
    if text.len() > MESSAGE_MAX {
        let f = message_file(text);
        if let Some(d) = f.parent() { std::fs::create_dir_all(d)?; }
        write_atomic(&f, text.as_bytes())?;
    }
    Ok(as_typed(text))
}
/// Is the shell in the pane waiting at its continuation prompt (`>`, `quote>`, `dquote>`): was the command cut off?
pub fn cut_off(screen: &str) -> bool {
    let last = screen.lines().map(str::trim).rfind(|l| !l.is_empty()).unwrap_or("");
    last == ">" || (last.ends_with('>') && last.len() <= 12 && last[..last.len() - 1].chars().all(|c| c.is_ascii_lowercase() || c == ' '))
}
