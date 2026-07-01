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

#[cfg(test)]
mod tests {
    use super::*;

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
