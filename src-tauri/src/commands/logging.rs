//! Session logging → Obsidian vault.
//!
//! Captures SSH session output as cleaned, redacted markdown notes in an
//! Obsidian vault (per-session notes + an auto-maintained daily index). SlimRDM
//! only captures and structures; summarizing/searching is left to Obsidian.

use chrono::{DateTime, Local};
use regex::Regex;

/// Metadata for a captured session, used to render the note and its filename.
#[derive(Debug, Clone)]
pub struct NoteMeta {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub group: Option<String>,
    pub connection_id: String,
    pub tags: Vec<String>,
    pub start: DateTime<Local>,
    pub end: Option<DateTime<Local>>,
}

/// Short host label (up to the first dot) used in note filenames.
fn host_short(host: &str) -> &str {
    host.split('.').next().unwrap_or(host)
}

/// Human-readable duration, e.g. 90s → "1m30s", 7505s → "2h5m5s".
fn fmt_duration(total_secs: i64) -> String {
    let s = total_secs.max(0);
    let (h, m, sec) = (s / 3600, (s % 3600) / 60, s % 60);
    let mut out = String::new();
    if h > 0 {
        out.push_str(&format!("{h}h"));
    }
    if h > 0 || m > 0 {
        out.push_str(&format!("{m}m"));
    }
    out.push_str(&format!("{sec}s"));
    out
}

/// Filename stem (no extension) for a session note, e.g. `2026-06-30 web01 (14-02)`.
pub fn session_note_stem(meta: &NoteMeta) -> String {
    format!(
        "{} {} ({})",
        meta.start.format("%Y-%m-%d"),
        host_short(&meta.host),
        meta.start.format("%H-%M"),
    )
}

/// Render a full session note: YAML frontmatter + fenced transcript block.
pub fn render_session_note(meta: &NoteMeta, transcript: &str) -> String {
    let mut fm = String::from("---\n");
    fm.push_str("type: ssh\n");
    fm.push_str(&format!("host: {}\n", meta.host));
    fm.push_str(&format!("port: {}\n", meta.port));
    fm.push_str(&format!("username: {}\n", meta.username));
    if let Some(ref g) = meta.group {
        fm.push_str(&format!("group: {}\n", g));
    }
    fm.push_str(&format!("connectionId: {}\n", meta.connection_id));
    fm.push_str(&format!("tags: [{}]\n", meta.tags.join(", ")));
    fm.push_str(&format!("start: {}\n", meta.start.format("%Y-%m-%dT%H:%M:%S")));
    if let Some(end) = meta.end {
        fm.push_str(&format!("end: {}\n", end.format("%Y-%m-%dT%H:%M:%S")));
        let secs = (end - meta.start).num_seconds();
        fm.push_str(&format!("duration: {}\n", fmt_duration(secs)));
    }
    fm.push_str("---\n\n## Transcript\n\n```text\n");
    fm.push_str(transcript);
    if !transcript.ends_with('\n') {
        fm.push('\n');
    }
    fm.push_str("```\n");
    fm
}

/// Fresh daily-index note skeleton. The `## Summary` section is intentionally
/// left empty for the user's Obsidian LLM plugin to fill.
pub fn daily_note_body(date: &str) -> String {
    format!(
        "---\ndate: {date}\ntags: [slimrdm, daily]\n---\n\n## Summary\n\n<!-- left empty for your Obsidian LLM plugin to fill -->\n\n## Sessions\n\n"
    )
}

/// Turn a raw terminal output stream into a readable plain-text transcript:
/// remove alt-screen (TUI) regions, apply carriage-return overwrites, strip
/// ANSI/OSC escapes and stray control chars, and normalise blank lines.
pub fn clean(raw: &str) -> String {
    let without_alt = replace_alt_screen(raw);
    let mut result: Vec<String> = Vec::new();
    let mut blanks = 0;
    for segment in without_alt.split('\n') {
        let line = apply_carriage_returns_and_escapes(segment);
        let trimmed = line.trim_end().to_string();
        if trimmed.is_empty() {
            blanks += 1;
            if blanks <= 1 {
                result.push(String::new());
            }
        } else {
            blanks = 0;
            result.push(trimmed);
        }
    }
    while result.first().map_or(false, |l| l.is_empty()) {
        result.remove(0);
    }
    while result.last().map_or(false, |l| l.is_empty()) {
        result.pop();
    }
    result.join("\n")
}

/// Replace ESC[?1049h..ESC[?1049l (and legacy ?47) alt-screen regions — the
/// full-screen redraws of TUI apps like vim/htop — with a single marker.
fn replace_alt_screen(raw: &str) -> String {
    let re = Regex::new(r"(?s)\x1b\[\?(?:1049|47)h.*?\x1b\[\?(?:1049|47)l").unwrap();
    re.replace_all(raw, "\n[interactive application]\n").into_owned()
}

/// Within one line, keep only the text after the last carriage return (the
/// final overwrite state, e.g. the end value of a progress bar), then strip
/// escape sequences.
fn apply_carriage_returns_and_escapes(segment: &str) -> String {
    let last = segment.rsplit('\r').next().unwrap_or(segment);
    strip_escapes(last)
}

/// Strip CSI/SGR escapes, OSC sequences, other two-byte escapes, and remaining
/// control characters (keeping tabs).
fn strip_escapes(s: &str) -> String {
    let csi = Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]").unwrap();
    let osc = Regex::new(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)").unwrap();
    let other = Regex::new(r"\x1b[@-Z\\-_]").unwrap();
    let s = csi.replace_all(s, "");
    let s = osc.replace_all(&s, "");
    let s = other.replace_all(&s, "");
    s.chars().filter(|&c| c == '\t' || !c.is_control()).collect()
}

const BUILTIN_PATTERNS: &[&str] = &[
    r"(?i)(password|passwd|secret|token|api[_-]?key|bearer)\s*[:=]\s*(\S+)",
    r"AKIA[0-9A-Z]{16}",
    r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
];

/// Best-effort redaction. Built-in patterns run first (masking the secret span
/// with ████), then user-supplied regexes. Invalid user regexes are skipped so
/// a bad pattern can never break capture.
pub fn redact(text: &str, user_patterns: &[String]) -> String {
    let mut out = text.to_string();
    for pat in BUILTIN_PATTERNS {
        let re = Regex::new(pat).unwrap();
        out = re
            .replace_all(&out, |caps: &regex::Captures| {
                // When a value group (2) is present, keep the label and mask only the value.
                if let Some(val) = caps.get(2) {
                    caps[0].replacen(val.as_str(), "████", 1)
                } else {
                    "████".to_string()
                }
            })
            .into_owned();
    }
    for pat in user_patterns {
        if let Ok(re) = Regex::new(pat) {
            out = re.replace_all(&out, "████").into_owned();
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::TimeZone;

    fn fixed_meta() -> NoteMeta {
        NoteMeta {
            host: "web01".into(),
            port: 22,
            username: "deploy".into(),
            group: Some("Production".into()),
            connection_id: "abc".into(),
            tags: vec!["slimrdm".into(), "ssh".into()],
            start: chrono::Local.with_ymd_and_hms(2026, 6, 30, 14, 2, 11).unwrap(),
            end: Some(chrono::Local.with_ymd_and_hms(2026, 6, 30, 14, 3, 41).unwrap()),
        }
    }

    #[test]
    fn session_stem_uses_host_and_start_time() {
        assert_eq!(session_note_stem(&fixed_meta()), "2026-06-30 web01 (14-02)");
    }

    #[test]
    fn session_note_has_frontmatter_and_transcript() {
        let note = render_session_note(&fixed_meta(), "line1\nline2");
        assert!(note.starts_with("---\n"));
        assert!(note.contains("host: web01"));
        assert!(note.contains("duration: 1m30s"));
        assert!(note.contains("## Transcript"));
        assert!(note.contains("line1\nline2"));
    }

    #[test]
    fn daily_body_has_summary_and_sessions_headings() {
        let b = daily_note_body("2026-06-30");
        assert!(b.contains("## Summary"));
        assert!(b.contains("## Sessions"));
        assert!(b.contains("date: 2026-06-30"));
    }

    #[test]
    fn redacts_key_value_secrets() {
        let out = redact("password: hunter2\napikey=ABC123", &[]);
        assert!(out.contains("████"), "got: {out}");
        assert!(!out.contains("hunter2"));
        assert!(!out.contains("ABC123"));
    }

    #[test]
    fn redacts_aws_access_key() {
        let out = redact("key AKIAIOSFODNN7EXAMPLE here", &[]);
        assert!(!out.contains("AKIAIOSFODNN7EXAMPLE"));
    }

    #[test]
    fn applies_user_pattern() {
        let out = redact("token PRIVATE-XYZ done", &[r"PRIVATE-\w+".to_string()]);
        assert!(!out.contains("PRIVATE-XYZ"));
        assert!(out.contains("done"));
    }

    #[test]
    fn invalid_user_pattern_is_ignored() {
        let out = redact("safe text", &["(".to_string()]);
        assert_eq!(out, "safe text");
    }

    #[test]
    fn strips_sgr_color_codes() {
        assert_eq!(clean("\x1b[32mhello\x1b[0m world"), "hello world");
    }

    #[test]
    fn collapses_carriage_return_overwrites() {
        assert_eq!(clean("10%\r50%\r100%\n"), "100%");
    }

    #[test]
    fn replaces_alt_screen_region_with_marker() {
        let raw = "before\x1b[?1049hVIM STUFF\x1b[?1049lafter";
        assert_eq!(clean(raw), "before\n[interactive application]\nafter");
    }

    #[test]
    fn strips_osc_title_sequence() {
        // clean() trims trailing whitespace per line, so no trailing space.
        assert_eq!(clean("\x1b]0;my title\x07prompt$ "), "prompt$");
    }

    #[test]
    fn collapses_excess_blank_lines() {
        assert_eq!(clean("a\n\n\n\n\nb"), "a\n\nb");
    }
}
