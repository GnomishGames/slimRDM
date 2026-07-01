//! Session logging → Obsidian vault.
//!
//! Captures SSH session output as cleaned, redacted markdown notes in an
//! Obsidian vault (per-session notes + an auto-maintained daily index). SlimRDM
//! only captures and structures; summarizing/searching is left to Obsidian.

use chrono::{DateTime, Local};
use regex::Regex;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

lazy_static::lazy_static! {
    /// Serialises daily-index updates so concurrent session closes don't corrupt the file.
    static ref DAILY_LOCK: Mutex<()> = Mutex::new(());
}

/// Write (or overwrite) the session note at `SlimRDM/<YYYY>/<MM-DD>/<stem>.md`,
/// returning its path. Writes via a temp file + rename so a crash never leaves a
/// half-written note.
pub fn write_session_note(vault: &Path, meta: &NoteMeta, transcript: &str) -> std::io::Result<PathBuf> {
    let dir = vault
        .join("SlimRDM")
        .join(meta.start.format("%Y").to_string())
        .join(meta.start.format("%m-%d").to_string());
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.md", session_note_stem(meta)));
    let body = render_session_note(meta, transcript);
    write_atomic(&path, &body)?;
    Ok(path)
}

/// Create `Daily/<YYYY-MM-DD>.md` if missing and append `- [[<stem>]]` under the
/// Sessions section, deduping. Guarded so concurrent sessions can't clobber it.
pub fn upsert_daily_index(vault: &Path, meta: &NoteMeta) -> std::io::Result<()> {
    let _guard = DAILY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let date = meta.start.format("%Y-%m-%d").to_string();
    let dir = vault.join("Daily");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{date}.md"));
    let mut body = if path.exists() {
        std::fs::read_to_string(&path)?
    } else {
        daily_note_body(&date)
    };
    let link = format!("- [[{}]]", session_note_stem(meta));
    if !body.contains(&link) {
        if !body.ends_with('\n') {
            body.push('\n');
        }
        body.push_str(&link);
        body.push('\n');
        write_atomic(&path, &body)?;
    }
    Ok(())
}

fn write_atomic(path: &Path, body: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("md.tmp");
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, path)
}

/// Delete leftover `*.raw` capture files in the session-logs dir. These only
/// exist after a crash; their content is unredacted and their note was already
/// checkpointed, so they are safe to remove on startup. Silent if the dir is absent.
pub fn sweep_orphans(raw_dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(raw_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().map_or(false, |x| x == "raw") {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
}

/// Parameters resolved by the frontend and passed to `ssh_connect` when a
/// session should be logged. Absent = logging disabled for this session.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLogParams {
    pub vault_path: String,
    pub connection_id: String,
    pub group: Option<String>,
    pub tags: Vec<String>,
    pub redaction_patterns: Vec<String>,
}

struct Inner {
    raw_path: PathBuf,
    raw_file: std::fs::File,
    vault: PathBuf,
    meta: NoteMeta,
    redaction_patterns: Vec<String>,
    last_output: Instant,
    last_checkpoint: Instant,
    dirty: bool,
    daily_linked: bool,
}

/// Captures one SSH session's output to a crash-safe raw file and periodically
/// renders it to a markdown note in the vault. Idle-debounced checkpoints (4s
/// quiet) with a 90s cap keep writes cheap while bounding data loss.
pub struct SessionLogger {
    inner: Arc<Mutex<Inner>>,
    stop: Arc<AtomicBool>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl SessionLogger {
    pub fn start(
        session_id: &str,
        host: &str,
        port: u16,
        username: &str,
        raw_dir: PathBuf,
        params: SessionLogParams,
    ) -> std::io::Result<SessionLogger> {
        std::fs::create_dir_all(&raw_dir)?;
        let raw_path = raw_dir.join(format!("{session_id}.raw"));
        let raw_file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&raw_path)?;
        let now = Instant::now();
        let meta = NoteMeta {
            host: host.to_string(),
            port,
            username: username.to_string(),
            group: params.group.clone(),
            connection_id: params.connection_id.clone(),
            tags: params.tags.clone(),
            start: Local::now(),
            end: None,
        };
        let inner = Arc::new(Mutex::new(Inner {
            raw_path,
            raw_file,
            vault: PathBuf::from(&params.vault_path),
            meta,
            redaction_patterns: params.redaction_patterns,
            last_output: now,
            last_checkpoint: now,
            dirty: false,
            daily_linked: false,
        }));
        let stop = Arc::new(AtomicBool::new(false));

        let task = {
            let inner = inner.clone();
            let stop = stop.clone();
            tokio::spawn(async move {
                let mut tick = tokio::time::interval(Duration::from_secs(1));
                loop {
                    tick.tick().await;
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    let mut g = match inner.lock() {
                        Ok(g) => g,
                        Err(e) => e.into_inner(),
                    };
                    let idle = g.last_output.elapsed() >= Duration::from_secs(4);
                    let capped = g.last_checkpoint.elapsed() >= Duration::from_secs(90);
                    if g.dirty && (idle || capped) {
                        if let Err(e) = checkpoint(&mut g, false) {
                            log::warn!("session log checkpoint failed: {e}");
                        }
                    }
                }
            })
        };

        Ok(SessionLogger {
            inner,
            stop,
            task: Mutex::new(Some(task)),
        })
    }

    /// Append raw output bytes. Never fails the caller; write errors are logged.
    pub fn append(&self, bytes: &[u8]) {
        let mut g = match self.inner.lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
        if let Err(e) = g.raw_file.write_all(bytes).and_then(|_| g.raw_file.flush()) {
            log::warn!("session log write failed: {e}");
        }
        g.last_output = Instant::now();
        g.dirty = true;
    }

    /// Stop the checkpoint task, write the final note with end time/duration, and
    /// delete the raw working file on success. Idempotent: a second call is a
    /// no-op because the task handle has already been taken.
    pub async fn finalize(&self) {
        let handle = self.task.lock().ok().and_then(|mut t| t.take());
        if handle.is_none() {
            return;
        }
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = handle {
            let _ = h.await;
        }
        let mut g = match self.inner.lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
        g.meta.end = Some(Local::now());
        match checkpoint(&mut g, true) {
            Ok(()) => {
                let _ = std::fs::remove_file(&g.raw_path);
            }
            Err(e) => log::warn!("session log finalize failed (keeping raw): {e}"),
        }
    }
}

/// Read the accumulated raw capture, clean + redact it, and (re)write the
/// session note. On first successful write, also add the daily-index link.
fn checkpoint(inner: &mut Inner, force: bool) -> std::io::Result<()> {
    if !force && !inner.dirty {
        return Ok(());
    }
    let raw = std::fs::read(&inner.raw_path).unwrap_or_default();
    let text = String::from_utf8_lossy(&raw);
    let cleaned = clean(&text);
    let redacted = redact(&cleaned, &inner.redaction_patterns);
    write_session_note(&inner.vault, &inner.meta, &redacted)?;
    if !inner.daily_linked {
        upsert_daily_index(&inner.vault, &inner.meta)?;
        inner.daily_linked = true;
    }
    inner.dirty = false;
    inner.last_checkpoint = Instant::now();
    Ok(())
}

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
    // Normalise CRLF line endings first so the \r in a line terminator isn't
    // mistaken for a carriage-return overwrite (which would eat the line's text).
    let normalized = raw.replace("\r\n", "\n");
    let without_alt = replace_alt_screen(&normalized);
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

    #[tokio::test]
    async fn logger_writes_note_and_deletes_raw() {
        let base = std::env::temp_dir().join(format!("slimrdm-test-{}", uuid::Uuid::new_v4()));
        let raw_dir = base.join("raw");
        let vault = base.join("vault");
        let params = SessionLogParams {
            vault_path: vault.to_string_lossy().into_owned(),
            connection_id: "cid".into(),
            group: None,
            tags: vec!["slimrdm".into(), "ssh".into()],
            redaction_patterns: vec![],
        };
        let logger =
            SessionLogger::start("sess1", "web01", 22, "deploy", raw_dir.clone(), params).unwrap();
        logger.append(b"echo hi\r\nhi\r\n");
        logger.finalize().await;

        let now = chrono::Local::now();
        let dir = vault
            .join("SlimRDM")
            .join(now.format("%Y").to_string())
            .join(now.format("%m-%d").to_string());
        let md = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.path().extension().map_or(false, |x| x == "md"))
            .expect("a session note was written");
        let body = std::fs::read_to_string(md.path()).unwrap();
        assert!(body.contains("hi"), "note body: {body}");
        assert!(!raw_dir.join("sess1.raw").exists(), "raw file should be deleted");

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn sweep_removes_raw_files_but_keeps_notes() {
        let dir = std::env::temp_dir().join(format!("slimrdm-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.raw"), b"x").unwrap();
        std::fs::write(dir.join("b.raw"), b"y").unwrap();
        std::fs::write(dir.join("keep.md"), b"z").unwrap();
        sweep_orphans(&dir);
        assert!(!dir.join("a.raw").exists());
        assert!(!dir.join("b.raw").exists());
        assert!(dir.join("keep.md").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn writes_session_note_to_dated_path() {
        let vault = std::env::temp_dir().join(format!("slimrdm-test-{}", uuid::Uuid::new_v4()));
        let p = write_session_note(&vault, &fixed_meta(), "hello").unwrap();
        assert!(p.ends_with("SlimRDM/2026/06-30/2026-06-30 web01 (14-02).md"));
        let body = std::fs::read_to_string(&p).unwrap();
        assert!(body.contains("hello"));
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn daily_index_creates_and_dedupes() {
        let vault = std::env::temp_dir().join(format!("slimrdm-test-{}", uuid::Uuid::new_v4()));
        upsert_daily_index(&vault, &fixed_meta()).unwrap();
        upsert_daily_index(&vault, &fixed_meta()).unwrap();
        let daily = vault.join("Daily/2026-06-30.md");
        let body = std::fs::read_to_string(&daily).unwrap();
        assert_eq!(body.matches("[[2026-06-30 web01 (14-02)]]").count(), 1);
        std::fs::remove_dir_all(&vault).ok();
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
    fn treats_crlf_as_newline_not_overwrite() {
        assert_eq!(clean("echo hi\r\nhi\r\n"), "echo hi\nhi");
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
