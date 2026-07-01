//! Session logging → Obsidian vault.
//!
//! Captures SSH session output as cleaned, redacted markdown notes in an
//! Obsidian vault (per-session notes + an auto-maintained daily index). SlimRDM
//! only captures and structures; summarizing/searching is left to Obsidian.

use regex::Regex;

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
